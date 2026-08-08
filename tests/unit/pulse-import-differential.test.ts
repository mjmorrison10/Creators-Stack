import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as port from "../../src/domain/pulse/import";
import type { PulsePost } from "../../src/data/schemas/pulse";

const PULSE_JS = resolve(import.meta.dirname, "../../../pulse/app.js");

/**
 * The differential the Fable audit asked for.
 *
 * `importClipRecord` was pinned by 29 behavior tests and 5 mutations, but —
 * unlike the promotion block — it was never sliced and diffed against the
 * original. Everything Phase 5 got wrong lived exactly where the tests stopped,
 * so the importer gets the same treatment the other engines got before it grows
 * a UI caller.
 *
 * The slice runs from `HOOK_MAX` through the end of `importClipRecord`. It
 * touches `posts` and `uid` from the enclosing IIFE scope, so those are
 * injected; nothing else in the range reaches outside it.
 */
function loadLegacy(): {
  importClipRecord: (s: unknown, clipKeyOverride: string | null, counters: unknown) => void;
  getPosts: () => PulsePost[];
  setPosts: (p: PulsePost[]) => void;
} {
  const src = readFileSync(PULSE_JS, "utf8");
  const start = src.indexOf("  var HOOK_MAX = 300;");
  const end = src.indexOf("  function importFromBlast() {");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("could not locate the import block in pulse/app.js");
  }

  // Ids are injected so the diff is about identity rules, not about randomness.
  // `Date.now` is frozen for the same reason: `postedAt[name] || Date.now()`.
  const prelude = `
    var posts = [];
    var __seq = 0;
    function uid() { return "p_test" + (++__seq); }
    var PATTERN_FIELDS = ["patternId", "patternName", "patternFamily"];
    var __now = 9000;
    var Date = { now: function () { return __now; } };
  `;
  return new Function(
    `${prelude}${src.slice(start, end)}
     return {
       importClipRecord: importClipRecord,
       getPosts: function () { return posts; },
       setPosts: function (p) { posts = p; __seq = 0; },
     };`,
  )() as ReturnType<typeof loadLegacy>;
}

const legacy = loadLegacy();

/** Verify the slice is the real thing rather than an empty match. */
describe("the legacy import slice", () => {
  it("carries the functions it is supposed to", () => {
    expect(typeof legacy.importClipRecord).toBe("function");
    const src = readFileSync(PULSE_JS, "utf8");
    expect(src).toContain("var HOOK_MAX = 300;");
    expect(src).toContain("function importClipRecord(s, clipKeyOverride, counters)");
  });
});

/**
 * Every case is run through both engines from the same starting posts, and the
 * resulting arrays plus counters are diffed whole — not spot-asserted, so
 * ordering, id assignment and field-by-field content all have to agree.
 */
interface Case {
  name: string;
  start?: PulsePost[];
  record: Record<string, unknown>;
  override: string | null;
}

const POSTED = {
  status: { TikTok: "posted", X: "posted" },
  postUrl: { TikTok: "https://tiktok.com/1" },
  postedAt: { TikTok: 5000, X: 5001 },
  postedCaption: { TikTok: "what went out on TikTok" },
  captions: { X: "the X caption" },
  base: "the base caption",
};

const cases: Case[] = [
  { name: "an empty record", record: {}, override: null },
  { name: "a quick clip posted to two platforms", record: POSTED, override: null },
  {
    name: "the same clip scoped by a RECALL key",
    record: POSTED,
    override: "ep41@41@2",
  },
  {
    name: "platforms that were only copied or skipped",
    record: { status: { TikTok: "copied", X: "skipped" }, postedAt: {} },
    override: null,
  },
  {
    name: "a post with no link yet",
    record: { status: { Pinterest: "posted" }, postedAt: { Pinterest: 5000 }, base: "cap" },
    override: null,
  },
  {
    name: "a clip carrying its RECALL pattern",
    record: {
      ...POSTED,
      videoHook: "the hardest rep is the one nobody sees",
      patternId: "p_identity",
      patternName: "Identity claim",
      patternFamily: "identity",
    },
    override: null,
  },
  {
    name: "a hook that falls back to the caption's first line",
    record: {
      status: { TikTok: "posted" },
      postedAt: { TikTok: 5000 },
      postedCaption: { TikTok: "first line is the hook\nsecond line is not" },
    },
    override: null,
  },
  {
    name: "a hook longer than the 300-char cap",
    record: {
      status: { TikTok: "posted" },
      postedAt: { TikTok: 5000 },
      videoHook: "h".repeat(400),
      base: "b",
    },
    override: null,
  },
  {
    name: "a clipKey longer than its 300-char cap",
    record: { status: { TikTok: "posted" }, postedAt: { TikTok: 5000 }, base: "b".repeat(400) },
    override: null,
  },
  {
    // Mutation testing found this gap: with no videoHook the hook comes from
    // the CAPTION's first line, and that path caps in `captionHook` rather
    // than in `makePost`. Removing that cap survived a corpus whose only long
    // hook arrived via videoHook.
    name: "a caption first line longer than the 300-char cap, with no hook",
    record: {
      status: { TikTok: "posted" },
      postedAt: { TikTok: 5000 },
      postedCaption: { TikTok: "c".repeat(400) + "\nsecond line" },
    },
    override: null,
  },
  {
    name: "a long caption first line reached through the base caption",
    record: { status: { X: "posted" }, postedAt: { X: 5000 }, base: "d".repeat(350) },
    override: null,
  },
  {
    name: "a missing postedAt falling back to the clock",
    record: { status: { TikTok: "posted" }, postedAt: {}, base: "cap" },
    override: null,
  },
  {
    name: "urls that need trimming",
    record: {
      status: { TikTok: "posted" },
      postUrl: { TikTok: "   https://tiktok.com/9   " },
      postedAt: { TikTok: 5000 },
    },
    override: null,
  },
  {
    name: "no hook and no base caption at all",
    record: { status: { X: "posted" }, postedAt: { X: 5000 } },
    override: null,
  },
];

/** A post as a previous import would have left it. */
function tracked(over: Partial<PulsePost> = {}): PulsePost {
  return {
    id: "p_existing",
    platform: "TikTok",
    url: "https://tiktok.com/1",
    caption: "already here",
    hook: "already here",
    postedAt: 4000,
    snapshots: [],
    outcome: null,
    ledgerLoggedAt: null,
    blastKey: "TikTok|5000",
    clipKey: "the base caption",
    clipId: "c_existing",
    ...over,
  };
}

const dedupeCases: Case[] = [
  {
    name: "re-importing a clip already tracked",
    start: [tracked()],
    record: POSTED,
    override: null,
  },
  {
    name: "re-importing after postedAt was re-stamped",
    start: [tracked()],
    record: { ...POSTED, postedAt: { TikTok: 7777, X: 7778 } },
    override: null,
  },
  {
    name: "healing a post stamped with a divergent clip id",
    start: [tracked({ clipId: "c_divergent" })],
    record: POSTED,
    override: null,
  },
  {
    name: "healing a post that never had a clip id",
    start: [tracked({ clipId: undefined })],
    record: POSTED,
    override: null,
  },
  {
    name: "enriching a post missing its hook and pattern",
    start: [tracked({ hook: "", patternId: "", patternFamily: "" })],
    record: { ...POSTED, videoHook: "a real hook", patternId: "p1", patternFamily: "identity" },
    override: null,
  },
  {
    name: "refusing to overwrite a hand-edited hook",
    start: [tracked({ hook: "my own words" })],
    record: { ...POSTED, videoHook: "a different hook" },
    override: null,
  },
  {
    name: "replacing a hook that is just the caption's first line",
    start: [tracked({ caption: "the fallback line\nrest", hook: "the fallback line" })],
    record: { ...POSTED, videoHook: "a real hook at last" },
    override: null,
  },
  {
    // The ONLY place `captionHook`'s 300-char cap is observable. `makePost`
    // slices twice (captionHook, then again on the result), so a missing cap
    // there changes nothing — but here the capped output is COMPARED to a
    // stored hook, and an uncapped comparison never matches, so enrichment
    // silently stops replacing the caption-derived fallback. Found by a
    // mutation that survived the first two rounds of this corpus.
    name: "replacing a caption-derived hook that was truncated at the cap",
    start: [
      tracked({
        caption: "e".repeat(400) + "\nrest",
        hook: "e".repeat(300),
      }),
    ],
    record: { ...POSTED, videoHook: "a real hook at last" },
    override: null,
  },
  {
    name: "matching an older post by platform and url alone",
    start: [tracked({ blastKey: undefined, clipId: undefined, clipKey: undefined })],
    record: POSTED,
    override: null,
  },
  {
    name: "reusing the clip id of the oldest matching post",
    start: [
      tracked({ id: "p_old", postedAt: 1000, clipId: "c_old" }),
      tracked({ id: "p_new", platform: "X", postedAt: 8000, clipId: "c_new" }),
    ],
    record: POSTED,
    override: null,
  },
];

function runBoth(c: Case) {
  const start = c.start ?? [];

  // Legacy mutates its module-scope array in place.
  legacy.setPosts(structuredClone(start).map((p) => ({ ...p })));
  const theirCounters = { added: 0, skipped: 0, nolink: 0, healed: 0, enriched: 0 };
  legacy.importClipRecord(structuredClone(c.record), c.override, theirCounters);
  const theirPosts = legacy.getPosts();

  let seq = 0;
  const mine = structuredClone(start);
  const myCounters = port.emptyCounters();
  port.importClipRecord(mine, c.record, c.override, myCounters, 9000, () => `p_test${++seq}`);

  return { theirPosts, theirCounters, minePosts: mine, myCounters };
}

describe("the port against the original, importing one clip record", () => {
  for (const c of [...cases, ...dedupeCases]) {
    it(`matches the legacy on: ${c.name}`, () => {
      const r = runBoth(c);
      expect(r.myCounters).toEqual(r.theirCounters);
      expect(r.minePosts).toEqual(r.theirPosts);
    });
  }

  it("actually imported something across the corpus, so the diff means something", () => {
    // A differential where both sides always produce [] proves nothing.
    const added = [...cases, ...dedupeCases].filter((c) => runBoth(c).myCounters.added > 0);
    expect(added.length).toBeGreaterThanOrEqual(8);
  });

  it("exercised every counter the importer reports", () => {
    const totals = port.emptyCounters();
    for (const c of [...cases, ...dedupeCases]) {
      const { myCounters } = runBoth(c);
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += myCounters[k];
    }
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
      expect(totals[k], `${k} was never exercised`).toBeGreaterThan(0);
    }
  });
});
