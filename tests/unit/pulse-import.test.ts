import { describe, it, expect } from "vitest";
import * as port from "../../src/domain/pulse/import";
import type { PulsePost } from "../../src/data/schemas/pulse";
import type { BlastPost, BlastQueue } from "../../src/domain/blast/queue";
import { blankPost, QUICK_KEY } from "../../src/domain/blast/queue";

/**
 * BLAST → PULSE, and PULSE's own backup restore.
 *
 * The dedup rules here are the difference between "24 clips stay 24 clips" and
 * a card list that silently fuses or duplicates. Ids are injected so the
 * assertions are about identity rather than about randomness.
 */
let n = 0;
const ids = () => `p_test${++n}`;

function queue(clips: BlastPost[]): BlastQueue {
  return { v: 1, updatedAt: 1000, defaultPlatforms: null, batchCount: 1, clips };
}

function clip(key: string, over: Partial<BlastPost> = {}): BlastPost {
  return blankPost(key, over, 1000);
}

const POSTED = {
  status: { TikTok: "posted" as const, X: "posted" as const },
  postUrl: { TikTok: "https://tiktok.com/1" },
  postedAt: { TikTok: 5000, X: 5001 },
  postedCaption: { TikTok: "what went out on TikTok" },
};

describe("importing from BLAST", () => {
  it("imports every platform a clip was posted to", () => {
    const r = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    expect(r.counters.added).toBe(2);
    expect(r.posts.map((p) => p.platform).sort()).toEqual(["TikTok", "X"]);
  });

  it("keeps a link-less post rather than dropping it", () => {
    // X has no url here. Import-from-blast routinely creates these — that is
    // exactly what `nolink` counts — and they are still real posts.
    const r = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    expect(r.counters.nolink).toBe(1);
    expect(r.posts.find((p) => p.platform === "X")).toBeTruthy();
  });

  it("ignores platforms that were only copied or skipped", () => {
    const r = port.importFromBlast(
      [],
      queue([clip(QUICK_KEY, { status: { TikTok: "copied", X: "skipped" }, postedAt: {} })]),
      null,
      9000,
      ids,
    );
    expect(r.counters.added).toBe(0);
  });

  it("lets the queue win over a stale session projection", () => {
    // A stale projection beating the real clip is how "only part of my
    // platforms transferred" happened.
    const session = { status: { LinkedIn: "posted" }, postedAt: { LinkedIn: 1 }, base: "stale" };
    const r = port.importFromBlast(
      [],
      queue([clip(QUICK_KEY, POSTED)]),
      session,
      9000,
      ids,
    );
    expect(r.posts.some((p) => p.platform === "LinkedIn")).toBe(false);
    expect(r.clipsSeen).toBe(1);
  });

  it("falls back to the session when there is no queue at all", () => {
    // Legacy devices that never got the batch queue.
    const session = { status: { LinkedIn: "posted" }, postedAt: { LinkedIn: 1 }, base: "cap" };
    const r = port.importFromBlast([], null, session, 9000, ids);
    expect(r.posts.map((p) => p.platform)).toEqual(["LinkedIn"]);
  });

  it("says so when there is nothing in this browser to import", () => {
    const r = port.importFromBlast([], null, null, 9000, ids);
    expect(r.empty).toBe(true);
    expect(port.importSummary(r)).toBe("Nothing marked Posted in BLAST yet");
  });

  it("keeps a batch of clips separate rather than fusing them", () => {
    // 24 clips must stay 24 clips. Two clips posted to the same platform in the
    // same millisecond would collide if the key weren't scoped by RECALL id.
    const same = { status: { TikTok: "posted" as const }, postedAt: { TikTok: 5000 } };
    const r = port.importFromBlast(
      [],
      queue([clip("ep41@10@1", same), clip("ep41@20@2", same)]),
      null,
      9000,
      ids,
    );
    expect(r.counters.added).toBe(2);
    expect(new Set(r.posts.map((p) => p.clipId)).size).toBe(2);
  });

  it("keeps the quick clip's blastKey unscoped", () => {
    // Scoping it would re-import every link-less post already tracked from the
    // session path as a duplicate.
    const r = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    expect(r.posts.find((p) => p.platform === "TikTok")!.blastKey).toBe("TikTok|5000");
  });

  it("scopes a batch clip's blastKey by its RECALL key", () => {
    const r = port.importFromBlast(
      [],
      queue([clip("ep41@10@1", { status: { TikTok: "posted" }, postedAt: { TikTok: 5000 } })]),
      null,
      9000,
      ids,
    );
    expect(r.posts[0]!.blastKey).toBe("ep41@10@1|TikTok|5000");
  });

  it("carries the pattern provenance RECALL worked out", () => {
    const r = port.importFromBlast(
      [],
      queue([
        clip(QUICK_KEY, {
          ...POSTED,
          hookText: "the hardest rep",
          patternId: "p_identity",
          patternFamily: "identity",
        }),
      ]),
      null,
      9000,
      ids,
    );
    const p = r.posts.find((x) => x.platform === "TikTok")!;
    expect(p.patternFamily).toBe("identity");
    expect(p.hook).toBe("the hardest rep");
  });

  it("does not re-import a post it already tracks", () => {
    const first = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    const second = port.importFromBlast(
      first.posts,
      queue([clip(QUICK_KEY, POSTED)]),
      null,
      9500,
      ids,
    );
    expect(second.counters.added).toBe(0);
    expect(second.counters.skipped).toBe(2);
    expect(second.posts).toHaveLength(2);
  });

  it("dedupes on clip+platform even when postedAt was re-stamped", () => {
    // Toggling a platform's Posted mark off and on re-stamps postedAt, which is
    // why the blastKey alone is not a stable identity.
    const first = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    const restamped = clip(QUICK_KEY, { ...POSTED, postedAt: { TikTok: 7777, X: 7778 } });
    const second = port.importFromBlast(first.posts, queue([restamped]), null, 9500, ids);
    expect(second.counters.added).toBe(0);
    expect(second.posts).toHaveLength(2);
  });

  it("enriches an already-tracked post that was missing its pattern", () => {
    const first = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    const withPattern = clip(QUICK_KEY, {
      ...POSTED,
      hookText: "a real hook",
      patternId: "p1",
      patternFamily: "identity",
    });
    const second = port.importFromBlast(first.posts, queue([withPattern]), null, 9500, ids);
    expect(second.counters.enriched).toBeGreaterThan(0);
    expect(second.posts.find((p) => p.platform === "TikTok")!.patternFamily).toBe("identity");
  });

  it("never overwrites a hook the user edited by hand", () => {
    const first = port.importFromBlast(
      [],
      queue([clip(QUICK_KEY, { ...POSTED, hookText: "original" })]),
      null,
      9000,
      ids,
    );
    const edited = first.posts.map((p) => ({ ...p, hook: "my own words" }));
    const second = port.importFromBlast(
      edited,
      queue([clip(QUICK_KEY, { ...POSTED, hookText: "a different hook" })]),
      null,
      9500,
      ids,
    );
    expect(second.posts.find((p) => p.platform === "TikTok")!.hook).toBe("my own words");
  });

  it("keeps the previous grouping reversible when it heals one", () => {
    const first = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    const split = first.posts.map((p) =>
      p.platform === "X" ? { ...p, clipId: "a-divergent-id" } : p,
    );
    const second = port.importFromBlast(split, queue([clip(QUICK_KEY, POSTED)]), null, 9500, ids);
    expect(second.counters.healed).toBe(1);
    const x = second.posts.find((p) => p.platform === "X")!;
    expect(x.clipIdPrev).toBe("a-divergent-id");
    expect(x.clipId).toBe(second.posts.find((p) => p.platform === "TikTok")!.clipId);
  });

  it("records the caption as it actually went out", () => {
    const r = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    expect(r.posts.find((p) => p.platform === "TikTok")!.caption).toBe("what went out on TikTok");
  });

  it("summarizes honestly, naming the link-less posts", () => {
    const r = port.importFromBlast([], queue([clip(QUICK_KEY, POSTED)]), null, 9000, ids);
    expect(port.importSummary(r)).toContain("Imported 2 posts from BLAST");
    expect(port.importSummary(r)).toContain("1 without links yet");
  });
});

describe("restoring a PULSE backup", () => {
  const existing: PulsePost[] = [
    {
      id: "p_have",
      platform: "TikTok",
      url: "https://tiktok.com/1",
      caption: "c",
      hook: "h",
      postedAt: 1000,
      snapshots: [],
      outcome: null,
      ledgerLoggedAt: null,
    },
  ];

  const linkless = (id: string, platform: string): PulsePost => ({
    id,
    platform,
    url: "",
    caption: "no link yet",
    hook: "a hook",
    postedAt: 2000,
    snapshots: [],
    outcome: null,
    ledgerLoggedAt: null,
  });

  it("imports link-less posts instead of silently discarding them", () => {
    // THE LEGACY BUG (pulse/app.js:1264): `if (!p || !p.url) return;` dropped
    // every post with no live link — and import-from-blast routinely creates
    // those, so a backup taken right after an import lost them on restore.
    const r = port.importBackupPosts(existing, {
      posts: [linkless("p_a", "X"), linkless("p_b", "Threads")],
    });
    expect(r.added).toBe(2);
    expect(r.posts.map((p) => p.id)).toContain("p_a");
    expect(r.posts.map((p) => p.id)).toContain("p_b");
  });

  it("does not collapse several link-less posts onto one key", () => {
    // The legacy dedup key was `platform|url`, so with url empty every
    // link-less post of a platform shared the key "X|" and all but one
    // vanished even if the guard above had let them through.
    const r = port.importBackupPosts(existing, {
      posts: [linkless("p_a", "X"), linkless("p_b", "X"), linkless("p_c", "X")],
    });
    expect(r.added).toBe(3);
  });

  it("round-trips: export then import adds nothing back", () => {
    const withLinkless = [...existing, linkless("p_a", "X")];
    const r = port.importBackupPosts(withLinkless, { posts: structuredClone(withLinkless) });
    expect(r.added).toBe(0);
    expect(r.posts).toHaveLength(2);
  });

  it("still dedupes on platform+url for old backups whose posts have no id", () => {
    const r = port.importBackupPosts(existing, {
      posts: [{ platform: "TikTok", url: "https://tiktok.com/1", caption: "dupe" }],
    });
    expect(r.added).toBe(0);
  });

  it("mints an id for a post that has none", () => {
    const r = port.importBackupPosts([], { posts: [{ platform: "X", url: "" }] }, ids);
    expect(r.added).toBe(1);
    expect(r.posts[0]!.id).toMatch(/^p_test/);
  });

  it("gives a post without snapshots an empty array to work with", () => {
    const r = port.importBackupPosts([], { posts: [{ id: "p_x", platform: "X" }] });
    expect(r.posts[0]!.snapshots).toEqual([]);
  });

  it("accepts a bare array as well as the enveloped shape", () => {
    const r = port.importBackupPosts([], [linkless("p_a", "X")]);
    expect(r.added).toBe(1);
  });

  it("ignores junk entries rather than storing them", () => {
    const r = port.importBackupPosts([], { posts: [null, "nope", 42, linkless("p_a", "X")] });
    expect(r.added).toBe(1);
  });

  it("does not mutate the posts it was handed", () => {
    const before = structuredClone(existing);
    port.importBackupPosts(existing, { posts: [linkless("p_a", "X")] });
    expect(existing).toEqual(before);
  });
});

/**
 * The one place this port DELIBERATELY differs from the legacy.
 *
 * Rather than asserting the divergence from memory, the legacy loop is
 * reproduced from pulse/app.js:1263-1270 and run on the same input, so the test
 * fails if someone "fixes" the port back toward it.
 */
describe("the legacy backup importer, for the record", () => {
  const legacyImport = (current: { platform: string; url: string }[], incoming: unknown[]) => {
    const posts = [...current];
    const byKey: Record<string, boolean> = {};
    posts.forEach((p) => {
      byKey[p.platform + "|" + p.url] = true;
    });
    let added = 0;
    incoming.forEach((raw) => {
      const p = raw as { platform: string; url: string };
      if (!p || !p.url) return;
      if (byKey[p.platform + "|" + p.url]) return;
      posts.unshift(p);
      added++;
    });
    return { posts, added };
  };

  const linkless = (id: string, platform: string) => ({
    id,
    platform,
    url: "",
    caption: "no link yet",
    hook: "a hook",
    postedAt: 2000,
    snapshots: [],
    outcome: null,
    ledgerLoggedAt: null,
  });

  it("drops every link-less post — which is the bug", () => {
    const backup = [linkless("p_a", "X"), linkless("p_b", "Threads")];
    expect(legacyImport([], backup).added).toBe(0);
  });

  it("and the port keeps them", () => {
    const backup = [linkless("p_a", "X"), linkless("p_b", "Threads")];
    expect(port.importBackupPosts([], backup).added).toBe(2);
  });

  it("agrees with the legacy on posts that DO have links", () => {
    // The fix is additive: nothing that used to import stops importing.
    const linked = [
      { id: "p_1", platform: "X", url: "https://x.com/1", snapshots: [] },
      { id: "p_2", platform: "TikTok", url: "https://tiktok.com/2", snapshots: [] },
    ];
    expect(port.importBackupPosts([], linked as never).added).toBe(
      legacyImport([], linked).added,
    );
  });
});
