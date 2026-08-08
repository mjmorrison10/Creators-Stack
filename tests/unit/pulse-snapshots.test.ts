import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as port from "../../src/domain/pulse/snapshots";
import type { PulsePost, Snapshot } from "../../src/data/schemas/pulse";

const PULSE_JS = resolve(import.meta.dirname, "../../../pulse/app.js");

/**
 * Checkpoint math decides what PULSE calls "due", and the formatters decide
 * what every number on a card reads as. Both are pure and both are sliced out
 * of the original and diffed — hand-asserting a rounding table is exactly how
 * an off-by-one ships.
 */
function loadLegacy(): {
  fmtNum: (n: unknown) => string;
  stepFor: (v: unknown) => number;
  relTime: (ms: number) => string;
  inHours: (ms: number) => string;
  maxCovered: (p: unknown) => number;
  nextDue: (p: unknown, now: number) => number | null;
  latestSnap: (p: unknown) => Snapshot | null;
  velocityPerHr: (p: unknown) => number | null;
  recordSnapshot: (p: unknown, d: unknown, s: string) => void;
  setNow: (n: number) => void;
} {
  const src = readFileSync(PULSE_JS, "utf8");
  const start = src.indexOf("  function fmtNum(n) {");
  const end = src.indexOf("  function isYouTube(post)");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("could not locate the snapshot block in pulse/app.js");
  }
  // The clock is injected so relTime/inHours/recordSnapshot are deterministic.
  const prelude = `
    var CHECKPOINTS = [1, 2, 6, 24, 48, 168];
    var __now = 0;
    var Date = { now: function () { return __now; } };
    function ckLabel(h) { return h < 24 ? h + "h" : (h / 24) + "d"; }
  `;
  return new Function(
    `${prelude}${src.slice(start, end)}
     return {fmtNum, stepFor, relTime, inHours, maxCovered, nextDue, latestSnap,
             velocityPerHr, recordSnapshot, setNow: function (n) { __now = n; }};`,
  )() as ReturnType<typeof loadLegacy>;
}

const legacy = loadLegacy();

function snap(elapsedMin: number, views: number, at = 0): Snapshot {
  return { at, elapsedMin, views, likes: null, comments: null, source: "manual" };
}

function post(snapshots: Snapshot[], postedAt = 0): PulsePost {
  return {
    id: "p_1",
    platform: "TikTok",
    url: "",
    caption: "",
    hook: "",
    postedAt,
    snapshots,
    outcome: null,
    ledgerLoggedAt: null,
  };
}

const HOUR = 3600000;

describe("the formatters, against the original", () => {
  const NUMBERS = [
    0, 1, 99, 100, 999, 1000, 1001, 1234, 1999, 9999, 10000, 12345, 99999, 100000, 999999,
    1000000, 1500000, 1234567, 12345678,
  ];

  it("formats every magnitude identically", () => {
    for (const n of NUMBERS) expect(port.fmtNum(n), String(n)).toBe(legacy.fmtNum(n));
  });

  it("survives junk the same way", () => {
    for (const v of [null, undefined, "", "abc", NaN, -5]) {
      expect(port.fmtNum(v), String(v)).toBe(legacy.fmtNum(v));
    }
  });

  it("strips the trailing .0 rather than showing 1.0K", () => {
    expect(port.fmtNum(1000)).toBe("1K");
    expect(port.fmtNum(1234)).toBe("1.2K");
    expect(port.fmtNum(12345)).toBe("12K");
    expect(port.fmtNum(1500000)).toBe("1.5M");
  });

  it("steps by the same ~1% of scale", () => {
    for (const n of NUMBERS) expect(port.stepFor(n), String(n)).toBe(legacy.stepFor(n));
  });

  it("renders relative times identically across the boundaries", () => {
    const now = 1_000_000_000;
    legacy.setNow(now);
    const offsets = [0, 30_000, 59_999, 60_000, 90_000, 59 * 60_000, 60 * 60_000,
      47 * HOUR, 48 * HOUR, 72 * HOUR, 30 * 24 * HOUR];
    for (const off of offsets) {
      expect(port.relTime(now - off, now), String(off)).toBe(legacy.relTime(now - off));
    }
  });

  it("renders countdowns identically across the boundaries", () => {
    const now = 1_000_000_000;
    legacy.setNow(now);
    const offsets = [0, 30_000, 59 * 60_000, HOUR, 2 * HOUR, 47 * HOUR, 48 * HOUR,
      72 * HOUR, 7 * 24 * HOUR];
    for (const off of offsets) {
      expect(port.inHours(now + off, now), String(off)).toBe(legacy.inHours(now + off));
    }
  });

  it("never counts down to zero minutes", () => {
    // "in 0m" reads as "now" when it is not; the floor is one minute.
    const now = 1_000_000_000;
    expect(port.inHours(now + 1000, now)).toBe("in 1m");
  });
});

describe("checkpoint math, against the original", () => {
  const cases: { name: string; post: PulsePost; now: number }[] = [
    { name: "nothing read yet, nothing elapsed", post: post([]), now: 0 },
    { name: "nothing read yet, one hour elapsed", post: post([]), now: HOUR },
    { name: "an hour read, an hour elapsed", post: post([snap(60, 100)]), now: HOUR },
    { name: "an hour read, two hours elapsed", post: post([snap(60, 100)]), now: 2 * HOUR },
    {
      name: "a late reading covers everything below it",
      post: post([snap(30 * 60, 5000)]),
      now: 30 * HOUR,
    },
    {
      name: "a late reading does not cover the checkpoint above",
      post: post([snap(30 * 60, 5000)]),
      now: 50 * HOUR,
    },
    { name: "everything covered", post: post([snap(168 * 60, 9000)]), now: 200 * HOUR },
    { name: "read exactly at the checkpoint minute", post: post([snap(120, 1)]), now: 2 * HOUR },
    { name: "the final 7d checkpoint", post: post([snap(48 * 60, 1)]), now: 168 * HOUR },
  ];

  for (const c of cases) {
    it(`agrees on nextDue: ${c.name}`, () => {
      expect(port.nextDue(c.post, c.now)).toBe(legacy.nextDue(c.post, c.now));
    });
  }

  it("reports maxCovered identically, including the empty -1", () => {
    for (const p of [post([]), post([snap(60, 1)]), post([snap(60, 1), snap(360, 2)])]) {
      expect(port.maxCovered(p)).toBe(legacy.maxCovered(p));
    }
    expect(port.maxCovered(post([]))).toBe(-1);
  });

  it("actually returned a due checkpoint somewhere, so the diff means something", () => {
    const due = cases.filter((c) => port.nextDue(c.post, c.now) !== null);
    expect(due.length).toBeGreaterThanOrEqual(4);
  });

  it("takes the last element as latest, not the newest reading", () => {
    // The array is sorted by elapsedMin, so a reading taken later but covering
    // an earlier checkpoint is NOT the latest.
    const p = post([snap(60, 100, 9999), snap(360, 200, 1)]);
    expect(port.latestSnap(p)!.views).toBe(200);
    expect(port.latestSnap(p)).toEqual(legacy.latestSnap(p));
    expect(port.latestSnap(post([]))).toBe(legacy.latestSnap(post([])));
  });
});

describe("velocity, against the original", () => {
  const cases: PulsePost[] = [
    post([]),
    post([snap(60, 100)]),
    post([snap(60, 100), snap(120, 200)]),
    post([snap(60, 100), snap(120, 100)]),
    post([snap(60, 500), snap(120, 100)]),
    post([snap(60, 100), snap(60, 200)]),
    post([snap(60, 100), snap(120, 200), snap(1440, 5000)]),
  ];

  for (const [i, p] of cases.entries()) {
    it(`agrees on case ${i}`, () => {
      expect(port.velocityPerHr(p)).toBe(legacy.velocityPerHr(p));
    });
  }

  it("returns null rather than dividing by zero on a same-minute pair", () => {
    expect(port.velocityPerHr(post([snap(60, 100), snap(60, 200)]))).toBeNull();
  });

  it("reports a decline honestly rather than clamping at zero", () => {
    // Platforms do revise counts down; showing 0 would hide it.
    // 500 → 100 views across one hour of elapsed time.
    expect(port.velocityPerHr(post([snap(60, 500), snap(120, 100)]))).toBe(-400);
  });
});

describe("recording a reading, against the original", () => {
  const cases: { name: string; data: port.ReadingInput; source: "auto" | "manual"; now: number }[] =
    [
      { name: "a manual views-only reading", data: { views: 1200 }, source: "manual", now: HOUR },
      {
        name: "an auto reading with likes and comments",
        data: { views: 5000, likes: 120, comments: 8 },
        source: "auto",
        now: 6 * HOUR,
      },
      {
        name: "an auto reading whose likes are genuinely zero",
        data: { views: 5000, likes: 0, comments: 0 },
        source: "auto",
        now: 6 * HOUR,
      },
      { name: "a reading of zero views", data: { views: 0 }, source: "manual", now: HOUR },
      {
        name: "a reading taken before the posted time",
        data: { views: 10 },
        source: "manual",
        now: 0,
      },
    ];

  for (const c of cases) {
    it(`matches the legacy: ${c.name}`, () => {
      const base = post([snap(1, 5)], 0);

      legacy.setNow(c.now);
      const theirs = structuredClone(base);
      legacy.recordSnapshot(theirs, c.data, c.source);

      const mine = port.recordSnapshot(base, c.data, c.source, c.now);
      expect(mine.snapshots).toEqual(theirs.snapshots);
    });
  }

  it("leaves likes and comments null when they were never measured", () => {
    // Storing 0 would claim a measurement nobody took.
    const s = port.recordSnapshot(post([], 0), { views: 10 }, "manual", HOUR).snapshots[0]!;
    expect(s.likes).toBeNull();
    expect(s.comments).toBeNull();
  });

  it("never records a negative elapsed time", () => {
    const s = port.recordSnapshot(post([], HOUR), { views: 10 }, "manual", 0).snapshots[0]!;
    expect(s.elapsedMin).toBe(0);
  });

  it("keeps the array sorted by elapsed time", () => {
    const p = port.recordSnapshot(post([snap(600, 9)], 0), { views: 1 }, "manual", HOUR);
    expect(p.snapshots.map((s) => s.elapsedMin)).toEqual([60, 600]);
  });

  it("does NOT dedupe a same-minute reading", () => {
    // Preserved quirk: heal is the only deduper, and only across merged twins.
    // Collapsing here would change what a later merge sees.
    const once = port.recordSnapshot(post([], 0), { views: 10 }, "manual", HOUR);
    const twice = port.recordSnapshot(once, { views: 20 }, "manual", HOUR);
    expect(twice.snapshots).toHaveLength(2);
  });

  it("does not mutate the post it was handed", () => {
    const p = post([], 0);
    port.recordSnapshot(p, { views: 10 }, "manual", HOUR);
    expect(p.snapshots).toHaveLength(0);
  });
});

describe("platform inference from a pasted link", () => {
  const table: [string, string | null][] = [
    ["https://www.youtube.com/shorts/abc123", "YouTube Shorts"],
    ["https://youtu.be/abc123", "YouTube Shorts"],
    ["https://www.tiktok.com/@me/video/1", "TikTok"],
    ["https://www.instagram.com/reel/xyz/", "Instagram Reels"],
    ["https://www.snapchat.com/spotlight/1", "Snapchat Spotlight"],
    ["https://fb.watch/abc/", "Facebook Reels"],
    ["https://www.facebook.com/reel/1", "Facebook Reels"],
    ["https://x.com/me/status/1", "X"],
    ["https://twitter.com/me/status/1", "X"],
    ["https://www.threads.net/@me/post/1", "Threads"],
    ["https://www.linkedin.com/feed/update/1", "LinkedIn"],
    ["https://pinterest.com/pin/1", "Pinterest"],
    ["https://www.pinterest.co.uk/pin/1", "Pinterest"],
    ["https://example.com/whatever", null],
    ["", null],
  ];

  for (const [url, expected] of table) {
    it(`maps ${url || "(empty)"} to ${expected ?? "nothing"}`, () => {
      expect(port.platformForUrl(url)).toBe(expected);
    });
  }
});

describe("which platforms the add form offers", () => {
  const ALL = [...port.PLATFORMS];

  it("prefers the creator's stored picks", () => {
    expect(port.runningPlatforms(["X", "TikTok"], ["LinkedIn"], ["Threads"])).toEqual([
      "TikTok",
      "X",
    ]);
  });

  it("returns stored picks in display order, not the order they were saved", () => {
    expect(port.runningPlatforms(["Pinterest", "TikTok"], [], [])).toEqual(["TikTok", "Pinterest"]);
  });

  it("ignores stored names that are no longer platforms", () => {
    expect(port.runningPlatforms(["X", "Vine"], [], [])).toEqual(["X"]);
  });

  it("falls back to the platforms you actually post on", () => {
    expect(port.runningPlatforms(null, ["LinkedIn", "TikTok"], ["Threads"])).toEqual([
      "TikTok",
      "LinkedIn",
    ]);
  });

  it("then to your BLAST presets", () => {
    expect(port.runningPlatforms(null, [], ["Threads", "X"])).toEqual(["X", "Threads"]);
  });

  it("then to everything", () => {
    expect(port.runningPlatforms(null, [], [])).toEqual(ALL);
  });

  it("treats a stored empty list as 'not chosen' rather than 'none'", () => {
    // Legacy's filter-then-check-length lands here; an empty pick would make
    // the add form unusable with no way back.
    expect(port.runningPlatforms([], ["TikTok"], [])).toEqual(["TikTok"]);
  });
});
