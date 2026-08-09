import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bumpStatus,
  checkCaption,
  countHashtags,
  DEFAULT_RULES,
  PLATFORMS,
  PLATFORM_NAMES,
  PLATFORM_RULES,
  platformByName,
  rulesFor,
  STATUS_LABEL,
  STATUS_ORDER,
  type PostStatus,
} from "../../src/domain/blast/platforms";

const APP_JS = resolve(import.meta.dirname, "../../../blast/app.js");

/**
 * The platform table and the status machine are both persisted contracts:
 * every map in `blast_queue_v1` and `blast_session_v1` is keyed by the display
 * NAME, and PULSE reads those keys. blast/app.js declares them at module scope
 * (it is an ES module, not an IIFE), so the originals are sliced out by marker
 * and diffed against the port.
 */
function loadLegacy(): {
  PLATFORMS: { icon: string; name: string; url: string; note?: string }[];
  PLATFORM_RULES: Record<string, { limit: number; hashtagMax: number }>;
  DEFAULT_RULES: { limit: number; hashtagMax: number };
  STATUS_ORDER: Record<string, number>;
  STATUS_LABEL: Record<string, string>;
} {
  const src = readFileSync(APP_JS, "utf8");
  const slice = (from: string, to: string): string => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a === -1 || b === -1 || b <= a) throw new Error(`could not slice ${from}`);
    return src.slice(a, b);
  };
  const block =
    slice("var PLATFORMS = [", "// Per-platform target caption lengths") +
    slice("var STATUS_ORDER =", "function statusOf(name)");
  return new Function(
    `${block}
     return {PLATFORMS, PLATFORM_RULES, DEFAULT_RULES, STATUS_ORDER, STATUS_LABEL};`,
  )() as ReturnType<typeof loadLegacy>;
}

const legacy = loadLegacy();

describe("platform table parity with blast/app.js", () => {
  it("carries every platform unchanged, in order", () => {
    // Order is what the UI renders, and the names are persisted map keys.
    expect(PLATFORMS.map((p) => ({ ...p }))).toEqual(legacy.PLATFORMS);
  });

  it("carries the caption rules unchanged", () => {
    expect(PLATFORM_RULES).toEqual(legacy.PLATFORM_RULES);
    expect(DEFAULT_RULES).toEqual(legacy.DEFAULT_RULES);
  });

  it("has a rule for every platform it lists", () => {
    // A missing rule silently falls back to the 2200 default, which would let
    // a 2200-char caption look fine for X.
    for (const name of PLATFORM_NAMES) {
      expect(PLATFORM_RULES[name], name).toBeDefined();
    }
  });

  it("keeps the two deliberately conservative caps", () => {
    // Not the numbers in the platforms' own docs: YouTube's 100 is the Short
    // *title*, not the 5000-char description BLAST doesn't model, and
    // Snapchat's 80 is a conservative overlay cap.
    expect(PLATFORM_RULES["YouTube Shorts"]!.limit).toBe(100);
    expect(PLATFORM_RULES["Snapchat Spotlight"]!.limit).toBe(80);
  });

  it("looks platforms up by their exact persisted name", () => {
    expect(platformByName("YouTube Shorts")?.url).toContain("youtube.com/upload");
    expect(platformByName("Youtube Shorts")).toBeUndefined();
  });

  it("falls back to the default rules for an unknown platform", () => {
    expect(rulesFor("Some New Network")).toEqual(DEFAULT_RULES);
  });
});

describe("the posting status machine", () => {
  it("matches the legacy order and labels", () => {
    expect(STATUS_ORDER).toEqual(legacy.STATUS_ORDER);
    expect(STATUS_LABEL).toEqual(legacy.STATUS_LABEL);
  });

  it("advances forward through the ladder", () => {
    expect(bumpStatus("none", "copied")).toBe("copied");
    expect(bumpStatus("copied", "opened")).toBe("opened");
    expect(bumpStatus("opened", "posted")).toBe("posted");
  });

  it("never moves backward", () => {
    // Copying a caption again after opening the uploader must not undo it.
    expect(bumpStatus("opened", "copied")).toBe("opened");
    expect(bumpStatus("posted", "copied")).toBe("posted");
  });

  it("treats posted and skipped as terminal", () => {
    // Both sit at rank 3, so neither can bump the other — a posted platform
    // must never silently become "skipped" because a handler fired twice.
    expect(bumpStatus("posted", "skipped")).toBe("posted");
    expect(bumpStatus("skipped", "posted")).toBe("skipped");
    expect(bumpStatus("posted", "opened")).toBe("posted");
  });

  it("never leaves a terminal state, for any input", () => {
    // Stated exhaustively rather than by example: once a platform is posted or
    // skipped, nothing the UI can fire may change it. The implementation
    // defends this twice over — strict `>` and an explicit name check — and
    // each defense alone is enough today, so only the whole property is worth
    // asserting.
    const all = Object.keys(STATUS_ORDER) as PostStatus[];
    for (const terminal of ["posted", "skipped"] as const) {
      for (const next of all) {
        expect(bumpStatus(terminal, next), `${terminal} -> ${next}`).toBe(terminal);
      }
    }
  });

  it("only ever returns a status at or above where it started", () => {
    const all = Object.keys(STATUS_ORDER) as PostStatus[];
    for (const cur of all) {
      for (const next of all) {
        expect(STATUS_ORDER[bumpStatus(cur, next)], `${cur} -> ${next}`).toBeGreaterThanOrEqual(
          STATUS_ORDER[cur],
        );
      }
    }
  });

  it("treats a missing status as not started", () => {
    expect(bumpStatus(undefined, "copied")).toBe("copied");
  });

  it("labels every status it can produce", () => {
    for (const s of Object.keys(STATUS_ORDER) as PostStatus[]) {
      expect(STATUS_LABEL[s], s).toBeTruthy();
    }
  });
});

describe("caption checking", () => {
  it("counts hashtags, not every hash character", () => {
    expect(countHashtags("no tags here")).toBe(0);
    expect(countHashtags("#one #two")).toBe(2);
    // A hash mid-word isn't a tag, and "#" alone isn't either.
    expect(countHashtags("C# is a language")).toBe(0);
    expect(countHashtags("just a # alone")).toBe(0);
  });

  it("reports how far over the cap a caption is", () => {
    const c = checkCaption("X", "x".repeat(300));
    expect(c.limit).toBe(280);
    expect(c.over).toBe(20);
    expect(c.tooLong).toBe(true);
  });

  it("reports zero over when within the cap", () => {
    const c = checkCaption("X", "short");
    expect(c.over).toBe(0);
    expect(c.tooLong).toBe(false);
  });

  it("flags too many hashtags separately from length", () => {
    const c = checkCaption("X", "#a #b #c");
    expect(c.tooManyHashtags).toBe(true);
    expect(c.tooLong).toBe(false);
  });

  it("uses the right cap per platform for the same text", () => {
    const text = "x".repeat(500);
    expect(checkCaption("X", text).tooLong).toBe(true);
    expect(checkCaption("TikTok", text).tooLong).toBe(false);
  });
});
