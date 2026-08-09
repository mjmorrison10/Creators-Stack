import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { healImportTwins, migrateClipIds } from "../../src/domain/pulse/healers";
import type { PulsePost, Snapshot } from "../../src/data/schemas/pulse";

const PULSE_JS = resolve(import.meta.dirname, "../../../pulse/app.js");

/**
 * The two boot healers repair damage two earlier importers did. They run before
 * the first paint on every load, against rows that are still in people's
 * browsers and still arrive over sync — so a drifted port silently rewrites
 * real data on somebody's machine.
 *
 * Both are pure apart from the module-scope `posts` they mutate, so the
 * originals are sliced out of the IIFE with `posts`, `savePosts`, `toast` and
 * `window.StackData.tombstone` injected, and diffed against the port.
 */
function loadLegacy(): {
  migrateClipIds: () => void;
  healImportTwins: () => void;
  getPosts: () => PulsePost[];
  setPosts: (p: PulsePost[]) => void;
  tombstoned: () => string[];
} {
  const src = readFileSync(PULSE_JS, "utf8");
  const start = src.indexOf("  function migrateClipIds() {");
  const end = src.indexOf("  // ---------- toast ----------");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("could not locate the healer block in pulse/app.js");
  }
  const prelude = `
    var posts = [];
    var __tomb = [];
    var PATTERN_FIELDS = ["patternId", "patternName", "patternFamily"];
    function savePosts() { return true; }
    function toast() {}
    var setTimeout = function () {};
    var window = { StackData: { tombstone: function (kind, id) { __tomb.push(kind + ":" + id); } } };
  `;
  return new Function(
    `${prelude}${src.slice(start, end)}
     return {
       migrateClipIds: migrateClipIds,
       healImportTwins: healImportTwins,
       getPosts: function () { return posts; },
       setPosts: function (p) { posts = p; __tomb = []; },
       tombstoned: function () { return __tomb; },
     };`,
  )() as ReturnType<typeof loadLegacy>;
}

const legacy = loadLegacy();

describe("the legacy healer slice", () => {
  it("carries both healers", () => {
    expect(typeof legacy.migrateClipIds).toBe("function");
    expect(typeof legacy.healImportTwins).toBe("function");
  });
});

let seq = 0;
function snap(elapsedMin: number, views: number, at: number): Snapshot {
  return { at, elapsedMin, views, likes: null, comments: null, source: "manual" };
}

function post(over: Partial<PulsePost> = {}): PulsePost {
  return {
    id: `p_${++seq}`,
    platform: "TikTok",
    url: "",
    caption: "",
    hook: "",
    postedAt: 1000,
    snapshots: [],
    outcome: null,
    ledgerLoggedAt: null,
    ...over,
  };
}

interface Case {
  name: string;
  posts: PulsePost[];
}

const migrateCases: Case[] = [
  { name: "no posts", posts: [] },
  {
    name: "posts with no clipKey at all — never touched",
    posts: [post({ clipId: "a" }), post({ clipId: "b" })],
  },
  {
    name: "a bucket whose posts have no clipId — nothing to canonicalize",
    posts: [post({ clipKey: "the clip" }), post({ clipKey: "the clip" })],
  },
  {
    name: "two ids for one clipKey, older wins",
    posts: [
      post({ clipKey: "the clip", clipId: "c_new", postedAt: 8000 }),
      post({ clipKey: "the clip", clipId: "c_old", postedAt: 2000 }),
    ],
  },
  {
    name: "the canonical id is the one whose EARLIEST post is oldest",
    posts: [
      post({ clipKey: "k", clipId: "c_a", postedAt: 5000 }),
      post({ clipKey: "k", clipId: "c_a", postedAt: 9000 }),
      post({ clipKey: "k", clipId: "c_b", postedAt: 6000 }),
      post({ clipKey: "k", clipId: "c_b", postedAt: 7000 }),
    ],
  },
  {
    name: "a tie keeps the first-encountered id",
    posts: [
      post({ clipKey: "k", clipId: "c_first", postedAt: 3000 }),
      post({ clipKey: "k", clipId: "c_second", postedAt: 3000 }),
    ],
  },
  {
    name: "a clipId-less post in the bucket ADOPTS the canonical with no stash",
    posts: [
      post({ clipKey: "k", clipId: "c_a", postedAt: 2000 }),
      post({ clipKey: "k", postedAt: 3000 }),
    ],
  },
  {
    name: "clipKey matching is case- and whitespace-insensitive",
    posts: [
      post({ clipKey: "  The Clip  ", clipId: "c_a", postedAt: 2000 }),
      post({ clipKey: "the clip", clipId: "c_b", postedAt: 5000 }),
    ],
  },
  {
    name: "an existing clipIdPrev is overwritten by a new rewrite",
    posts: [
      post({ clipKey: "k", clipId: "c_a", postedAt: 2000 }),
      post({ clipKey: "k", clipId: "c_b", postedAt: 5000, clipIdPrev: "c_ancient" }),
    ],
  },
  {
    name: "separate clipKeys stay separate",
    posts: [
      post({ clipKey: "one", clipId: "c_a", postedAt: 2000 }),
      post({ clipKey: "two", clipId: "c_b", postedAt: 5000 }),
    ],
  },
  {
    name: "already unified — a no-op",
    posts: [
      post({ clipKey: "k", clipId: "c_a", postedAt: 2000 }),
      post({ clipKey: "k", clipId: "c_a", postedAt: 5000 }),
    ],
  },
];

const healCases: Case[] = [
  { name: "no posts", posts: [] },
  {
    name: "hand-added posts with no clipId are never merged",
    posts: [post({ platform: "X" }), post({ platform: "X" })],
  },
  {
    name: "one post per clip per platform — nothing to do",
    posts: [post({ clipId: "c", platform: "X" }), post({ clipId: "c", platform: "TikTok" })],
  },
  {
    name: "a plain twin pair",
    posts: [
      post({ clipId: "c", platform: "X", postedAt: 5000 }),
      post({ clipId: "c", platform: "X", postedAt: 9000 }),
    ],
  },
  {
    name: "a manual verdict outranks a live link",
    posts: [
      post({ clipId: "c", platform: "X", url: "https://x.com/1", postedAt: 5000 }),
      post({ clipId: "c", platform: "X", outcome: "winner", ledgerLoggedAt: 77, postedAt: 9000 }),
    ],
  },
  {
    name: "a live link outranks more readings",
    posts: [
      post({ clipId: "c", platform: "X", snapshots: [snap(60, 10, 1), snap(120, 20, 2)] }),
      post({ clipId: "c", platform: "X", url: "https://x.com/1" }),
    ],
  },
  {
    name: "more readings outrank an earlier post",
    posts: [
      post({ clipId: "c", platform: "X", postedAt: 1000 }),
      post({ clipId: "c", platform: "X", postedAt: 9000, snapshots: [snap(60, 10, 1)] }),
    ],
  },
  {
    name: "the earliest post breaks a full tie",
    posts: [
      post({ clipId: "c", platform: "X", postedAt: 9000 }),
      post({ clipId: "c", platform: "X", postedAt: 1000 }),
    ],
  },
  {
    name: "snapshots union, newest reading wins a checkpoint",
    posts: [
      post({ clipId: "c", platform: "X", snapshots: [snap(60, 100, 500), snap(120, 200, 600)] }),
      post({ clipId: "c", platform: "X", snapshots: [snap(60, 999, 900), snap(360, 300, 700)] }),
    ],
  },
  {
    name: "an equal `at` keeps the first encountered, in original order",
    posts: [
      post({ clipId: "c", platform: "X", snapshots: [snap(60, 111, 500)] }),
      post({ clipId: "c", platform: "X", snapshots: [snap(60, 222, 500)] }),
    ],
  },
  {
    name: "the earliest postedAt is kept, restoring real ordering",
    posts: [
      post({ clipId: "c", platform: "X", url: "https://x.com/1", postedAt: 9000 }),
      post({ clipId: "c", platform: "X", postedAt: 1000 }),
    ],
  },
  {
    name: "a url, hook, caption and pattern only the twin had",
    posts: [
      post({ clipId: "c", platform: "X", outcome: "meh", postedAt: 5000 }),
      post({
        clipId: "c",
        platform: "X",
        url: "https://x.com/1",
        hook: "the hook",
        caption: "the caption",
        patternId: "p1",
        patternFamily: "identity",
        postedAt: 9000,
      }),
    ],
  },
  {
    name: "the ledger stamp rides along with an inherited verdict",
    posts: [
      post({ clipId: "c", platform: "X", url: "https://x.com/1", postedAt: 5000 }),
      post({ clipId: "c", platform: "X", outcome: "winner", ledgerLoggedAt: 4242, postedAt: 9000 }),
    ],
  },
  {
    name: "a twin's ledger stamp is NOT inherited without its verdict",
    posts: [
      post({ clipId: "c", platform: "X", url: "https://x.com/1", postedAt: 5000 }),
      post({ clipId: "c", platform: "X", ledgerLoggedAt: 4242, postedAt: 9000 }),
    ],
  },
  {
    name: "keep's own values always win over a twin's",
    posts: [
      post({
        clipId: "c",
        platform: "X",
        outcome: "winner",
        url: "https://keep.example/1",
        hook: "keep hook",
        patternFamily: "keep-family",
        postedAt: 5000,
      }),
      post({
        clipId: "c",
        platform: "X",
        url: "https://twin.example/2",
        hook: "twin hook",
        patternFamily: "twin-family",
        postedAt: 9000,
      }),
    ],
  },
  {
    name: "a whitespace-only url does not count as a link",
    posts: [
      post({ clipId: "c", platform: "X", url: "   ", postedAt: 5000 }),
      post({ clipId: "c", platform: "X", url: "https://x.com/1", postedAt: 9000 }),
    ],
  },
  {
    name: "three twins collapse to one",
    posts: [
      post({ clipId: "c", platform: "X", postedAt: 5000 }),
      post({ clipId: "c", platform: "X", postedAt: 7000, snapshots: [snap(60, 5, 1)] }),
      post({ clipId: "c", platform: "X", url: "https://x.com/1", postedAt: 9000 }),
    ],
  },
  {
    name: "twins on two platforms of one clip heal independently",
    posts: [
      post({ clipId: "c", platform: "X", postedAt: 5000 }),
      post({ clipId: "c", platform: "X", postedAt: 6000 }),
      post({ clipId: "c", platform: "TikTok", postedAt: 7000 }),
      post({ clipId: "c", platform: "TikTok", postedAt: 8000 }),
    ],
  },
  {
    name: "untouched posts keep their place in the array",
    posts: [
      post({ id: "p_keepme", platform: "LinkedIn" }),
      post({ clipId: "c", platform: "X", postedAt: 5000 }),
      post({ id: "p_alsokeep", platform: "Threads" }),
      post({ clipId: "c", platform: "X", postedAt: 9000 }),
    ],
  },
];

function runMigrate(c: Case) {
  legacy.setPosts(structuredClone(c.posts));
  legacy.migrateClipIds();
  const theirs = legacy.getPosts();
  const mine = migrateClipIds(structuredClone(c.posts));
  return { theirs, mine };
}

function runHeal(c: Case) {
  legacy.setPosts(structuredClone(c.posts));
  legacy.healImportTwins();
  const theirs = legacy.getPosts();
  const theirTomb = legacy.tombstoned();
  const mine = healImportTwins(structuredClone(c.posts));
  return { theirs, theirTomb, mine };
}

describe("migrateClipIds against the original", () => {
  for (const c of migrateCases) {
    it(`matches the legacy on: ${c.name}`, () => {
      const { theirs, mine } = runMigrate(c);
      expect(mine.posts).toEqual(theirs);
    });
  }

  it("actually rewrote ids somewhere, so the diff means something", () => {
    const rewrote = migrateCases.filter((c) => runMigrate(c).mine.changed > 0);
    expect(rewrote.length).toBeGreaterThanOrEqual(5);
  });

  it("is idempotent — a second pass changes nothing", () => {
    for (const c of migrateCases) {
      const once = migrateClipIds(structuredClone(c.posts));
      const twice = migrateClipIds(once.posts);
      expect(twice.changed, c.name).toBe(0);
      expect(twice.posts, c.name).toEqual(once.posts);
    }
  });
});

describe("healImportTwins against the original", () => {
  for (const c of healCases) {
    it(`matches the legacy on: ${c.name}`, () => {
      const { theirs, theirTomb, mine } = runHeal(c);
      expect(mine.posts).toEqual(theirs);
      // Every dropped twin must be tombstoned, or a Drive merge brings it back.
      expect(mine.dropped.map((id) => `pulsePost:${id}`).sort()).toEqual(theirTomb.sort());
    });
  }

  it("actually merged something, so the diff means something", () => {
    const healed = healCases.filter((c) => runHeal(c).mine.merged > 0);
    expect(healed.length).toBeGreaterThanOrEqual(10);
  });

  it("counts dropped POSTS, not groups", () => {
    const three = healCases.find((c) => c.name === "three twins collapse to one")!;
    expect(healImportTwins(structuredClone(three.posts)).merged).toBe(2);
    const twoPlatforms = healCases.find((c) => c.name.startsWith("twins on two platforms"))!;
    expect(healImportTwins(structuredClone(twoPlatforms.posts)).merged).toBe(2);
  });

  it("is idempotent — a second pass changes nothing", () => {
    for (const c of healCases) {
      const once = healImportTwins(structuredClone(c.posts));
      const twice = healImportTwins(once.posts);
      expect(twice.merged, c.name).toBe(0);
      expect(twice.posts, c.name).toEqual(once.posts);
    }
  });

  it("does not mutate the array it was handed", () => {
    // The port returns new arrays where the legacy mutates in place. That is a
    // deliberate deviation (the repo's immutability rule) and this is what
    // makes it real rather than nominal.
    const c = healCases.find((x) => x.name === "a plain twin pair")!;
    const before = structuredClone(c.posts);
    healImportTwins(c.posts);
    expect(c.posts).toEqual(before);
  });

  it("does not mutate the array migrateClipIds was handed", () => {
    const c = migrateCases.find((x) => x.name === "two ids for one clipKey, older wins")!;
    const before = structuredClone(c.posts);
    migrateClipIds(c.posts);
    expect(c.posts).toEqual(before);
  });
});
