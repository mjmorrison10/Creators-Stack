import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as port from "../../src/domain/pulse/promotion";
import type { PulsePost, Snapshot } from "../../src/data/schemas/pulse";

const PULSE_JS = resolve(import.meta.dirname, "../../../pulse/app.js");

/**
 * Auto-promotion is the only place in the stack where one app writes into
 * another's ledger with no human in the loop, and TOP CLIPS reads those entries
 * back as the creator's own proof. A false promotion doesn't add a row, it
 * teaches every downstream ranking a lie.
 *
 * `computeAutoWinners` and its helpers are pure, so the ORIGINAL is sliced out
 * of pulse/app.js's IIFE and run against the same inputs as the port. Below the
 * differential, each gate is mutation-tested on its own: a gate you can delete
 * with no test failing is a gate with no test.
 */
function loadLegacy(): {
  computeAutoWinners: (list: unknown[]) => unknown[];
  tokens: (s: unknown) => { set: Record<string, 1>; size: number };
  jaccardSets: (a: unknown, b: unknown) => number;
  medianOf: (n: number[]) => number;
  autoViews: (p: unknown) => number;
  autoHook: (p: unknown) => string;
  mediumFor: (n: string) => string;
} {
  const src = readFileSync(PULSE_JS, "utf8");
  const start = src.indexOf("var AUTO_PROMOTE = {");
  const end = src.indexOf("// postId -> 1 for every post");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("could not locate the promotion block in pulse/app.js");
  }
  // `latestSnap` and `mediumFor` live outside the sliced range; both are tiny
  // and are reproduced here verbatim so the slice runs standalone.
  const prelude = `
    var TEXT_PLATFORMS = { "X": 1, "Threads": 1, "LinkedIn": 1, "Pinterest": 1 };
    function mediumFor(name) { return TEXT_PLATFORMS[name] ? "text" : "video"; }
    function latestSnap(post) {
      return post.snapshots.length ? post.snapshots[post.snapshots.length - 1] : null;
    }
  `;
  return new Function(
    `${prelude}${src.slice(start, end)}
     return {computeAutoWinners, tokens, jaccardSets, medianOf, autoViews, autoHook, mediumFor};`,
  )() as ReturnType<typeof loadLegacy>;
}

const legacy = loadLegacy();

/** Verify the slice really is the legacy code, not an empty match. */
describe("the legacy slice", () => {
  it("carries the gate constants it is supposed to", () => {
    const src = readFileSync(PULSE_JS, "utf8");
    expect(src).toContain(
      "var AUTO_PROMOTE = { MIN_SAMPLE: 8, TOP_PCT: 0.10, OUTLIER_MULT: 3, CROSS_MULT: 2, MIN_VIEWS: 10000 };",
    );
    expect(typeof legacy.computeAutoWinners).toBe("function");
  });

  it("pins the gate values in the port to the legacy literals", () => {
    expect(port.AUTO_PROMOTE).toEqual({
      MIN_SAMPLE: 8,
      TOP_PCT: 0.1,
      OUTLIER_MULT: 3,
      CROSS_MULT: 2,
      MIN_VIEWS: 10000,
    });
    expect(port.AUTO_HOOK_SIM).toBe(0.55);
    expect(port.AUTO_PREFIX).toBe("pulseauto_");
  });
});

let seq = 0;
function snap(views: number): Snapshot {
  return { at: 1_700_000_000_000, elapsedMin: 60, views, likes: null, comments: null, source: "manual" };
}

function post(over: Partial<PulsePost> & { platform: string; views?: number }): PulsePost {
  const { views, ...rest } = over;
  return {
    id: `p_${++seq}`,
    url: "",
    caption: "",
    hook: "a hook",
    postedAt: 1_700_000_000_000 + seq,
    snapshots: views === undefined ? [] : [snap(views)],
    outcome: null,
    ledgerLoggedAt: null,
    ...rest,
  };
}

/** A platform pool big enough to have a trustworthy median. */
function pool(platform: string, viewsList: number[], over: Partial<PulsePost> = {}): PulsePost[] {
  return viewsList.map((v, i) =>
    post({ platform, views: v, hook: `filler hook ${platform} ${i}`, clipId: `c${platform}${i}`, ...over }),
  );
}

describe("the port against the original, on the same posts", () => {
  /**
   * Each case is run through both engines and the output diffed. Hand-asserting
   * the notes string alone would miss ordering, grouping and id selection.
   */
  const cases: { name: string; posts: PulsePost[] }[] = [
    { name: "no posts at all", posts: [] },
    { name: "posts with no measurements", posts: pool("TikTok", []).concat(post({ platform: "TikTok" })) },
    {
      name: "a platform below MIN_SAMPLE",
      posts: pool("TikTok", [1000, 2000, 90000]),
    },
    {
      name: "a flat account: top decile exists but nothing is 3x the middle",
      posts: pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 2000]),
    },
    {
      name: "a genuine breakout on one platform",
      posts: [
        ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
        post({ platform: "TikTok", views: 900000, hook: "the breakout hook", clipId: "win" }),
      ],
    },
    {
      name: "a breakout under the MIN_VIEWS floor",
      posts: [
        ...pool("X", [10, 20, 30, 40, 50, 60, 70, 80]),
        post({ platform: "X", views: 9000, hook: "small pond winner", clipId: "sp" }),
      ],
    },
    {
      name: "a big multiple on a small platform that the other platform agrees with",
      posts: [
        ...pool("X", [100, 120, 140, 160, 180, 200, 220, 240]),
        ...pool("Snapchat Spotlight", [3000, 3100, 3200, 3300, 3400, 3500, 3600, 3700]),
        post({ platform: "X", views: 30000, hook: "same clip", clipId: "cross" }),
        post({ platform: "Snapchat Spotlight", views: 3519, hook: "same clip", clipId: "cross" }),
      ],
    },
    {
      name: "a marginal multiple its other platform calls ordinary",
      posts: [
        ...pool("X", [3500, 3600, 3700, 3800, 4000, 4200, 4400, 4600]),
        ...pool("Snapchat Spotlight", [20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000]),
        post({ platform: "X", views: 14000, hook: "marginal clip", clipId: "marg" }),
        post({ platform: "Snapchat Spotlight", views: 20000, hook: "marginal clip", clipId: "marg" }),
      ],
    },
    {
      name: "one clip breaking out on several platforms",
      posts: [
        ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
        ...pool("Instagram Reels", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
        post({ platform: "TikTok", views: 400000, hook: "multi hook", clipId: "m" }),
        post({ platform: "Instagram Reels", views: 300000, hook: "multi hook", clipId: "m" }),
      ],
    },
    {
      name: "a post the user already judged by hand",
      posts: [
        ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
        post({ platform: "TikTok", views: 900000, hook: "judged", clipId: "j", outcome: "dead" }),
      ],
    },
    {
      name: "two wordings of the same hook, grouped by similarity",
      posts: [
        ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
        post({
          platform: "TikTok",
          views: 800000,
          hook: "the hardest rep is the one nobody sees",
          clipId: "a",
        }),
        post({
          platform: "TikTok",
          views: 700000,
          hook: "the hardest rep is the one that nobody ever sees",
          clipId: "b",
        }),
      ],
    },
    {
      name: "a winner carrying its RECALL pattern",
      posts: [
        ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
        post({
          platform: "TikTok",
          views: 900000,
          hook: "pattern hook",
          clipId: "pt",
          patternId: "p_identity",
          patternFamily: "identity",
          url: "https://tiktok.com/@me/video/1",
        }),
      ],
    },
    {
      name: "a hook that falls back to the caption's first line",
      posts: [
        ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
        post({
          platform: "TikTok",
          views: 900000,
          hook: "",
          caption: "first line becomes the hook\nsecond line does not",
          clipId: "cap",
        }),
      ],
    },
    {
      name: "ties at the cutoff all qualify",
      posts: [
        ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500]),
        post({ platform: "TikTok", views: 500000, hook: "tie one", clipId: "t1" }),
        post({ platform: "TikTok", views: 500000, hook: "tie two", clipId: "t2" }),
      ],
    },
  ];

  for (const c of cases) {
    it(`matches the legacy on: ${c.name}`, () => {
      const mine = port.computeAutoWinners(c.posts);
      const theirs = legacy.computeAutoWinners(structuredClone(c.posts));
      expect(mine).toEqual(theirs);
    });
  }

  it("actually promoted something in at least one case, so the diff means something", () => {
    // A differential where both sides always return [] proves nothing.
    const promoted = cases.filter((c) => port.computeAutoWinners(c.posts).length > 0);
    expect(promoted.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the helpers, against the original", () => {
  const TEXTS = [
    "The hardest rep is the one nobody sees",
    "the hardest rep is the one that nobody ever sees",
    "",
    "   ",
    "Numbers: 3 minutes, 41 seconds!",
  ];

  it("tokenizes identically", () => {
    for (const t of TEXTS) expect(port.tokens(t)).toEqual(legacy.tokens(t));
  });

  it("computes the same Jaccard similarity", () => {
    for (const a of TEXTS)
      for (const b of TEXTS)
        expect(port.jaccardSets(port.tokens(a), port.tokens(b))).toBe(
          legacy.jaccardSets(legacy.tokens(a), legacy.tokens(b)),
        );
  });

  it("computes the same median, including the even-length rounding", () => {
    const sets = [[], [5], [1, 2], [1, 2, 3], [1, 2, 3, 4], [3, 1, 2], [1, 2, 4, 5]];
    for (const s of sets) expect(port.medianOf(s)).toBe(legacy.medianOf(s));
  });

  it("rounds the even-length median rather than truncating", () => {
    // (1+2)/2 = 1.5 → 2. A floor here would shift every cutoff by one view.
    expect(port.medianOf([1, 2])).toBe(2);
  });

  it("treats 0 views as unmeasured, not as a measured zero", () => {
    expect(port.autoViews(post({ platform: "X", views: 0 }))).toBe(0);
    expect(port.autoViews(post({ platform: "X" }))).toBe(0);
    expect(legacy.autoViews(post({ platform: "X", views: 0 }))).toBe(0);
  });

  it("splits text and video platforms the way HOOKLAB does", () => {
    for (const n of ["X", "Threads", "LinkedIn", "Pinterest", "TikTok", "YouTube Shorts"]) {
      expect(port.mediumFor(n)).toBe(legacy.mediumFor(n));
    }
  });
});

/**
 * Each gate, alone. The differential above proves the port matches; these prove
 * the gates are load-bearing — that removing any one of them changes an outcome
 * a test can see.
 */
describe("each gate carries its own weight", () => {
  const base = (over: Partial<PulsePost> = {}) => [
    ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
    post({ platform: "TikTok", views: 900000, hook: "the winner", clipId: "w", ...over }),
  ];

  it("MIN_SAMPLE: seven measured posts is not enough of a baseline", () => {
    const seven = [
      ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500]),
      post({ platform: "TikTok", views: 900000, hook: "the winner", clipId: "w" }),
    ];
    expect(seven.filter((p) => port.autoViews(p) > 0)).toHaveLength(7);
    expect(port.computeAutoWinners(seven)).toEqual([]);
    // The eighth post is the only difference.
    expect(port.computeAutoWinners(base())).toHaveLength(1);
  });

  it("OUTLIER_MULT: a top-decile post that is only 2x the median is not a breakout", () => {
    // Median of the pool is 1350; 2600 is top of the pool but under 3x.
    const flat = [
      ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
      post({ platform: "TikTok", views: 2600, hook: "not quite", clipId: "n" }),
    ];
    expect(port.computeAutoWinners(flat)).toEqual([]);
  });

  it("MIN_VIEWS: clearing every relative gate on a tiny platform still promotes nothing", () => {
    const tiny = [
      ...pool("X", [10, 20, 30, 40, 50, 60, 70, 80]),
      post({ platform: "X", views: 9999, hook: "big fish small pond", clipId: "s" }),
    ];
    // It IS top of its platform and far past 3x the median — only the floor stops it.
    const med = port.medianOf([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(9999).toBeGreaterThan(med * port.AUTO_PROMOTE.OUTLIER_MULT);
    expect(port.computeAutoWinners(tiny)).toEqual([]);

    // One view over the floor, everything else equal, and it promotes.
    const over = [
      ...pool("X", [10, 20, 30, 40, 50, 60, 70, 80]),
      post({ platform: "X", views: 10000, hook: "big fish small pond", clipId: "s" }),
    ];
    expect(port.computeAutoWinners(over)).toHaveLength(1);
  });

  it("CROSS_MULT: a clip its other platform calls ordinary is not promoted", () => {
    // Tuned to isolate THIS gate: the X post clears MIN_SAMPLE, MIN_VIEWS, the
    // top-decile cutoff and 3x the X median (14000 vs a 3900 median), so every
    // per-platform gate passes. Its Snapchat twin landing exactly at that
    // platform's median drags the geometric mean to ~1.9, under CROSS_MULT.
    const crossed = [
      ...pool("X", [3500, 3600, 3700, 3800, 4000, 4200, 4400, 4600]),
      ...pool("Snapchat Spotlight", [20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000]),
      post({ platform: "X", views: 14000, hook: "same clip", clipId: "cross" }),
      post({ platform: "Snapchat Spotlight", views: 20000, hook: "same clip", clipId: "cross" }),
    ];
    expect(port.computeAutoWinners(crossed)).toEqual([]);

    // The identical X post, with no ordinary sibling to weigh against it, DOES
    // promote — so it is the cross gate doing the work here, not the floor or
    // the outlier multiple.
    const alone = [
      ...pool("X", [3500, 3600, 3700, 3800, 4000, 4200, 4400, 4600]),
      post({ platform: "X", views: 14000, hook: "same clip", clipId: "cross" }),
    ];
    expect(port.computeAutoWinners(alone)).toHaveLength(1);
  });

  it("a manual verdict outranks the math, in both directions", () => {
    expect(port.computeAutoWinners(base({ outcome: "dead" }))).toEqual([]);
    expect(port.computeAutoWinners(base({ outcome: "winner" }))).toEqual([]);
  });

  it("groups a clip by clipId even when its per-platform hooks differ", () => {
    const spread = [
      ...pool("TikTok", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
      ...pool("Instagram Reels", [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]),
      post({ platform: "TikTok", views: 400000, hook: "wording one", clipId: "same" }),
      post({ platform: "Instagram Reels", views: 300000, hook: "totally different words", clipId: "same" }),
    ];
    const winners = port.computeAutoWinners(spread);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.postIds).toHaveLength(2);
  });

  it("names the entry after the top post and prefixes its id", () => {
    const winners = port.computeAutoWinners(base({ id: "p_top" }));
    expect(winners[0]!.entry.id).toBe("pulseauto_p_top");
    expect(winners[0]!.entry.source).toBe("pulse-auto");
    expect(winners[0]!.entry.outcome).toBe("winner");
  });

  it("says unknown rather than guessing a pattern it was never told", () => {
    // Honesty rule: a hand-added post that never went through RECALL has no
    // pattern, and inventing one would put a fabricated family in the ledger.
    expect(port.computeAutoWinners(base())[0]!.entry.family).toBe("unknown");
    expect(port.computeAutoWinners(base())[0]!.entry.patternId).toBe("");
  });

  it("reports the real numbers in its notes", () => {
    const notes = port.computeAutoWinners(base())[0]!.entry.notes;
    expect(notes).toContain("top 10% on TikTok");
    expect(notes).toContain("900,000 views");
    expect(notes).toContain("median (n=9)");
  });
});
