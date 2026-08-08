import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyTemplate,
  INTENT_URL_MAX,
  isMobile,
  navTarget,
  readPresets,
  setPreset,
  writePresets,
} from "../../src/domain/blast/compose";
import { PLATFORMS, platformByName } from "../../src/domain/blast/platforms";
import { KEYS } from "../../src/data/keys";

const APP_JS = resolve(import.meta.dirname, "../../../blast/app.js");

/**
 * `applyTemplate` and `navTarget` decide what text gets posted and where the
 * user lands. Both are pure once the platform table and a UA are supplied, so
 * the originals are sliced out of app.js and diffed against the port.
 */
function loadLegacy(ua: string): {
  applyTemplate: (tpl: string, base: string) => string;
  navTarget: (p: unknown, text: string) => { url: string; mode: string };
} {
  const src = readFileSync(APP_JS, "utf8");
  const slice = (from: string, to: string): string => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a === -1 || b === -1 || b <= a) throw new Error(`could not slice ${from}`);
    return src.slice(a, b);
  };
  const block =
    slice("var PLATFORMS = [", "// Per-platform caption rules") +
    slice("// Compose-intent URLs", "// Test hook") +
    slice("function applyTemplate(tpl, base)", "function currentBase()");

  return new Function(
    "navigator",
    `var window = undefined;
     ${block}
     return {applyTemplate: applyTemplate, navTarget: navTarget};`,
  )({ userAgent: ua }) as ReturnType<typeof loadLegacy>;
}

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

beforeEach(() => localStorage.clear());

describe("caption templates", () => {
  it("substitutes the base caption", () => {
    expect(applyTemplate("{caption}\n\n#tag", "hello")).toBe("hello\n\n#tag");
  });

  it("substitutes EVERY occurrence, not just the first", () => {
    // A plain .replace with a string needle only does the first one.
    expect(applyTemplate("{caption} — {caption}", "x")).toBe("x — x");
  });

  it("treats $-sequences in the caption literally", () => {
    // "$&" would re-insert the match and "$'" the tail if this went through
    // .replace. Creators write "$$$" in captions; it has to survive verbatim.
    expect(applyTemplate("{caption}!", "earn $$$ fast")).toBe("earn $$$ fast!");
    expect(applyTemplate("{caption}", "$& and $' and $`")).toBe("$& and $' and $`");
  });

  it("leaves a template with no token alone", () => {
    expect(applyTemplate("no token here", "ignored")).toBe("no token here");
  });

  it("matches the legacy on every case", () => {
    const legacy = loadLegacy(DESKTOP_UA);
    const cases: [string, string][] = [
      ["{caption}\n#a", "hello"],
      ["{caption} — {caption}", "x"],
      ["{caption}!", "earn $$$ fast"],
      ["{caption}", "$& $' $` $0"],
      ["no token", "ignored"],
      ["", "base"],
      ["{caption}", ""],
    ];
    for (const [tpl, base] of cases) {
      expect(applyTemplate(tpl, base), `${tpl}|${base}`).toBe(legacy.applyTemplate(tpl, base));
    }
  });
});

describe("presets", () => {
  it("round-trips through its own key", () => {
    writePresets({ X: "{caption} #tag" });
    expect(readPresets()).toEqual({ X: "{caption} #tag" });
    expect(localStorage.getItem(KEYS.blastPresets)).toContain("{caption}");
  });

  it("treats a missing or corrupt store as empty", () => {
    expect(readPresets()).toEqual({});
    localStorage.setItem(KEYS.blastPresets, "{oops");
    expect(readPresets()).toEqual({});
  });

  it("clears a preset when the template is blanked", () => {
    // Storing an empty template would apply an empty caption, not "no preset".
    const p = setPreset({ X: "{caption} #tag" }, "X", "   ");
    expect(p).not.toHaveProperty("X");
  });

  it("keeps leading and trailing whitespace that is part of the template", () => {
    // A hashtag block starts with newlines; only an all-blank value clears.
    const p = setPreset({}, "X", "{caption}\n\n#a #b");
    expect(p.X).toBe("{caption}\n\n#a #b");
  });

  it("does not mutate the presets it was given", () => {
    const before = { X: "a" };
    setPreset(before, "TikTok", "b");
    expect(before).toEqual({ X: "a" });
  });
});

describe("where copy-and-open sends the user", () => {
  it("uses a prefilled compose intent for X and Threads on desktop", () => {
    const x = navTarget("X", "my caption", false);
    expect(x.mode).toBe("tab");
    expect(x.url).toContain("x.com/intent/post?text=");
    expect(x.url).toContain(encodeURIComponent("my caption"));
    expect(navTarget("Threads", "my caption", false).url).toContain("threads.net/intent/post");
  });

  it("uses the plain upload page for everything else", () => {
    const t = navTarget("TikTok", "my caption", false);
    expect(t.mode).toBe("tab");
    expect(t.url).toBe(platformByName("TikTok")!.url);
  });

  it("launches the native app for X and TikTok on mobile", () => {
    // X's web intent gets hijacked into an in-app browser that freezes, and
    // TikTok's web upload is useless without a desktop login.
    const x = navTarget("X", "my caption", true);
    expect(x.mode).toBe("scheme");
    expect(x.url).toContain("twitter://post?message=");

    const t = navTarget("TikTok", "my caption", true);
    expect(t.mode).toBe("scheme");
    expect(t.url).toBe("snssdk1233://");
  });

  it("keeps the https URL on mobile for platforms with no scheme", () => {
    const th = navTarget("Threads", "my caption", true);
    expect(th.mode).toBe("tab");
    expect(th.url).toContain("threads.net/intent/post");
  });

  it("falls back to the plain page when the intent URL would be absurd", () => {
    // The caption is already on the clipboard; a truncated intent is worse
    // than none.
    const huge = "x".repeat(INTENT_URL_MAX * 2);
    const x = navTarget("X", huge, false);
    expect(x.url).toBe(platformByName("X")!.url);
  });

  it("falls back to the bare scheme when a mobile deep link would be absurd", () => {
    const huge = "x".repeat(INTENT_URL_MAX * 2);
    const x = navTarget("X", huge, true);
    expect(x.mode).toBe("scheme");
    expect(x.url).toBe("twitter://post");
  });

  it("degrades safely for a platform that no longer exists", () => {
    expect(navTarget("Vine", "caption", false)).toEqual({ url: "", mode: "tab" });
  });

  it("detects mobile from the user agent", () => {
    expect(isMobile(IPHONE_UA)).toBe(true);
    expect(isMobile("Mozilla/5.0 (Linux; Android 14)")).toBe(true);
    expect(isMobile(DESKTOP_UA)).toBe(false);
  });

  it("matches the legacy target for every platform, on desktop and mobile", () => {
    for (const [ua, mobile] of [
      [DESKTOP_UA, false],
      [IPHONE_UA, true],
    ] as const) {
      const legacy = loadLegacy(ua);
      for (const p of PLATFORMS) {
        for (const text of ["short caption", "with $pecial & chars?", "x".repeat(3000)]) {
          expect(navTarget(p, text, mobile), `${p.name}/${mobile}/${text.length}`).toEqual(
            legacy.navTarget(p, text),
          );
        }
      }
    }
  });
});
