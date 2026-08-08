import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  captionSuggestPrompt,
  clipContextBlock,
  hooklabEvidenceBlock,
  isPartial,
  lengthGuidanceBlock,
  loadHooklabEvidence,
  MAX_EVIDENCE_WINNERS,
  NonJsonError,
  optionsToStrings,
  parseCaptionJSON,
  readLengthPref,
  salvageCaptionObject,
  writeLengthPref,
} from "../../src/domain/blast/suggest";
import { PLATFORM_NAMES } from "../../src/domain/blast/platforms";
import { KEYS } from "../../src/data/keys";
import type { LedgerEntry } from "../../src/data/schemas/hooklab";

const APP_JS = resolve(import.meta.dirname, "../../../blast/app.js");

/**
 * The prompt builder and the response parser are the two halves of one
 * contract, and both are pure. Sliced out of app.js and diffed, so a drifted
 * prompt or a lost salvage path fails here rather than as "the AI got worse".
 */
function loadLegacy(pref: string): {
  captionSuggestPrompt: (names: string[], count: number) => string;
  parseCaptionJSON: (t: string) => unknown;
  salvageCaptionObject: (t: string) => unknown;
  hooklabEvidenceBlock: (ev: unknown) => string;
  clipContextBlock: (c: string) => string;
  lengthGuidanceBlock: (pref: string, names: string[]) => string;
} {
  const src = readFileSync(APP_JS, "utf8");
  const slice = (from: string, to: string): string => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a === -1 || b === -1 || b <= a) throw new Error(`could not slice ${from}`);
    return src.slice(a, b);
  };
  const block =
    slice("var PLATFORMS = [", "var DEFAULT_RULES") +
    "var DEFAULT_RULES = { limit: 2200, hashtagMax: 10 };" +
    slice("var LENGTH_TARGETS = {", "// Caption-length preference") +
    slice("function lengthGuidanceBlock(pref, names)", "function captionTokenBudget") +
    slice("function captionSuggestPrompt(names, count)", "// === HOOKLAB evidence") +
    slice("function hooklabEvidenceBlock(ev)", "async function suggestCaptionsForNames");

  return new Function(
    "PREF",
    `function getCaptionLengthPref() { return PREF; }
     ${block}
     return {captionSuggestPrompt: captionSuggestPrompt, parseCaptionJSON: parseCaptionJSON,
             salvageCaptionObject: salvageCaptionObject,
             hooklabEvidenceBlock: hooklabEvidenceBlock, clipContextBlock: clipContextBlock,
             lengthGuidanceBlock: lengthGuidanceBlock};`,
  )(pref) as ReturnType<typeof loadLegacy>;
}

beforeEach(() => localStorage.clear());

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "id_1",
    hook: "Confidence comes after the work",
    outcome: "winner",
    family: "identity",
    medium: "video",
    platform: "tiktok",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("HOOKLAB evidence", () => {
  it("distinguishes never-opened from empty from no-winners", () => {
    expect(loadHooklabEvidence().reason).toBe("absent");
    localStorage.setItem(KEYS.hooklabState, JSON.stringify({ ledger: [], comps: [] }));
    expect(loadHooklabEvidence().reason).toBe("empty");
    localStorage.setItem(
      KEYS.hooklabState,
      JSON.stringify({ ledger: [entry({ outcome: "dead" })], comps: [] }),
    );
    expect(loadHooklabEvidence().reason).toBe("no-winners");
    localStorage.setItem(KEYS.hooklabState, JSON.stringify({ ledger: [entry()], comps: [] }));
    expect(loadHooklabEvidence().reason).toBe("ok");
  });

  it("bounds how many winners reach the prompt", () => {
    const many = Array.from({ length: 40 }, (_, i) => entry({ id: `id_${i}` }));
    localStorage.setItem(KEYS.hooklabState, JSON.stringify({ ledger: many, comps: [] }));
    expect(loadHooklabEvidence().winners).toHaveLength(MAX_EVIDENCE_WINNERS);
  });

  it("says nothing at all when there are no winners", () => {
    // An evidence block with no evidence would tell the model the creator has a
    // proven history they don't have.
    expect(hooklabEvidenceBlock({ winners: [], found: true, reason: "empty" })).toBe("");
    expect(hooklabEvidenceBlock(null)).toBe("");
  });

  it("still forbids inventing claims when evidence IS present", () => {
    const block = hooklabEvidenceBlock({
      winners: ["Confidence comes after the work"],
      found: true,
      reason: "ok",
    });
    expect(block).toContain("Confidence comes after the work");
    expect(block).toMatch(/never invent claims or numbers/i);
  });

  it("matches the legacy block exactly", () => {
    const legacy = loadLegacy("medium");
    const ev = { winners: ["hook one", "hook two"], found: true, reason: "ok" as const };
    expect(hooklabEvidenceBlock(ev)).toBe(legacy.hooklabEvidenceBlock(ev));
    expect(hooklabEvidenceBlock({ winners: [], found: false, reason: "absent" })).toBe(
      legacy.hooklabEvidenceBlock({ winners: [] }),
    );
  });
});

describe("clip context", () => {
  it("is empty for a blank context", () => {
    expect(clipContextBlock("")).toBe("");
    expect(clipContextBlock("   ")).toBe("");
    expect(clipContextBlock(null)).toBe("");
  });

  it("frames the clip without licensing invention", () => {
    const b = clipContextBlock("this is really about burnout");
    expect(b).toContain("burnout");
    expect(b).toMatch(/do not state anything as fact/i);
  });

  it("matches the legacy block", () => {
    const legacy = loadLegacy("medium");
    for (const c of ["", "  ", "a real angle"]) {
      expect(clipContextBlock(c), c).toBe(legacy.clipContextBlock(c));
    }
  });
});

describe("the caption prompt", () => {
  it("names every requested platform and the exact count", () => {
    const p = captionSuggestPrompt(["X", "TikTok"], 3, "medium");
    expect(p).toContain("exactly 3 distinct caption options");
    expect(p).toContain("X, TikTok");
    expect(p).toMatch(/arrays of exactly 3 options/);
  });

  it("uses the singular for one option", () => {
    const p = captionSuggestPrompt(["X"], 1, "medium");
    expect(p).toContain("exactly 1 distinct caption option for");
    expect(p).not.toContain("caption options");
  });

  it("states each platform's hard cap as absolute", () => {
    const p = captionSuggestPrompt(["X"], 1, "medium");
    expect(p).toContain("hard cap 280 chars (never exceed)");
    expect(p).toContain("ABSOLUTE");
  });

  it("keeps Snapchat short at every length preference", () => {
    for (const pref of ["short", "medium", "long"] as const) {
      expect(lengthGuidanceBlock(pref, ["Snapchat Spotlight"]), pref).toContain("Always <=80");
    }
  });

  it("only asks for story-style captions where a long caption belongs", () => {
    // Lines come out in platform display order, not the order asked for, so
    // find each one rather than slicing between them.
    const lines = lengthGuidanceBlock("long", ["LinkedIn", "X"]).split("\n");
    const lineFor = (name: string): string => lines.find((l) => l.startsWith(`- ${name}:`)) ?? "";
    expect(lineFor("LinkedIn")).toContain("story-style");
    expect(lineFor("X")).not.toContain("story-style");
  });

  it("asks for Pinterest as an object, since it needs a title too", () => {
    const p = captionSuggestPrompt(["Pinterest"], 1, "medium");
    expect(p).toContain('"title"');
    expect(p).toContain('"description"');
  });

  it("matches the legacy prompt for every preference and platform set", () => {
    for (const pref of ["short", "medium", "long"] as const) {
      const legacy = loadLegacy(pref);
      for (const names of [["X"], ["X", "TikTok"], [...PLATFORM_NAMES]]) {
        for (const count of [1, 3]) {
          expect(captionSuggestPrompt(names, count, pref), `${pref}/${names.length}/${count}`).toBe(
            legacy.captionSuggestPrompt(names, count),
          );
        }
      }
    }
  });
});

describe("the length preference", () => {
  it("lives in its own key, defaulting to medium", () => {
    // Settings rewrites blast_settings_v1 wholesale, so a preference stored
    // there would be wiped on every save.
    expect(readLengthPref()).toBe("medium");
    writeLengthPref("long");
    expect(localStorage.getItem(KEYS.blastCaptionLen)).toBe("long");
    expect(readLengthPref()).toBe("long");
  });

  it("falls back to medium for an unrecognized value", () => {
    localStorage.setItem(KEYS.blastCaptionLen, "enormous");
    expect(readLengthPref()).toBe("medium");
  });
});

describe("reading the model's answer", () => {
  it("parses a clean response", () => {
    expect(parseCaptionJSON('{"X":["a","b"]}')).toEqual({ X: ["a", "b"] });
  });

  it("rescues JSON wrapped in a markdown fence", () => {
    expect(parseCaptionJSON('```json\n{"X":["a"]}\n```')).toEqual({ X: ["a"] });
    expect(parseCaptionJSON('```\n{"X":["a"]}\n```')).toEqual({ X: ["a"] });
  });

  it("strips a reasoning model's leaked monologue", () => {
    expect(parseCaptionJSON('<think>hmm, let me consider</think>{"X":["a"]}')).toEqual({
      X: ["a"],
    });
  });

  it("keeps the platforms that arrived when the reply was cut off", () => {
    // Discarding a mostly-good response wastes the call and the user's wait.
    const truncated = '{"X":["one","two"],"TikTok":["three"],"Threads":["fou';
    const out = parseCaptionJSON(truncated);
    expect(out.X).toEqual(["one", "two"]);
    expect(out.TikTok).toEqual(["three"]);
    expect(out.Threads).toBeUndefined();
  });

  it("marks a salvaged response partial without adding an enumerable key", () => {
    // Callers iterate platform keys; a visible marker would read as a platform.
    const out = parseCaptionJSON('{"X":["one"],"TikTok":["tw');
    expect(isPartial(out)).toBe(true);
    expect(Object.keys(out)).toEqual(["X"]);
  });

  it("is not confused by a brace or quote inside a caption", () => {
    const tricky = '{"X":["a {brace} and a \\"quote\\""],"TikTok":["b"],"Threads":["c';
    const out = parseCaptionJSON(tricky);
    expect(out.X).toEqual(['a {brace} and a "quote"']);
    expect(out.TikTok).toEqual(["b"]);
  });

  it("names a rate limit that arrived as prose with a 200", () => {
    // This sails past every status-code check; on a phone the message is the
    // only diagnostics the user gets, so it has to name the real problem.
    expect(() => parseCaptionJSON("Rate limit exceeded, please try again later")).toThrow(
      /rate limited/i,
    );
    expect(() => parseCaptionJSON("Error: quota exhausted for this project")).toThrow(
      /rate limited/i,
    );
  });

  it("reports an empty response as empty rather than as bad JSON", () => {
    expect(() => parseCaptionJSON("")).toThrow(/empty response/i);
    expect(() => parseCaptionJSON("   ")).toThrow(/empty response/i);
  });

  it("quotes what the model actually said when it isn't JSON", () => {
    try {
      parseCaptionJSON("I'm sorry, I can't help with that request.");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NonJsonError);
      expect((e as Error).message).toContain("I'm sorry");
    }
  });

  it("truncates a very long non-JSON reply rather than dumping it", () => {
    const msg = (() => {
      try {
        parseCaptionJSON("z".repeat(500));
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(200);
  });

  it("matches the legacy parser on every case", () => {
    const legacy = loadLegacy("medium");
    const cases = [
      '{"X":["a","b"]}',
      '```json\n{"X":["a"]}\n```',
      '<think>x</think>{"X":["a"]}',
      '{"X":["one","two"],"TikTok":["three"],"Threads":["fou',
      '{"X":["a {brace} and a \\"quote\\""],"TikTok":["b"],"Threads":["c',
      '{"Pinterest":[{"title":"t","description":"d"}]}',
    ];
    for (const c of cases) {
      expect(parseCaptionJSON(c), c.slice(0, 30)).toEqual(legacy.parseCaptionJSON(c));
    }
  });

  it("salvages nothing from text with no object at all", () => {
    expect(salvageCaptionObject("no json here")).toBeNull();
    expect(salvageCaptionObject("")).toBeNull();
  });
});

describe("turning options into stored captions", () => {
  it("passes plain strings through", () => {
    expect(optionsToStrings(["a", "b"])).toEqual(["a", "b"]);
  });

  it("folds a Pinterest object into title then description", () => {
    expect(optionsToStrings([{ title: "T", description: "D" }])).toEqual(["T\n\nD"]);
  });

  it("drops empty and malformed options rather than storing blanks", () => {
    expect(optionsToStrings(["", null as never, { title: "", description: "" } as never])).toEqual(
      [],
    );
  });

  it("tolerates a missing or non-array value", () => {
    expect(optionsToStrings(undefined)).toEqual([]);
    expect(optionsToStrings("nope" as never)).toEqual([]);
  });
});
