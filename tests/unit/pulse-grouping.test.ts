import { describe, it, expect } from "vitest";
import {
  buildClipGroups,
  buildPlatformGroups,
  clipGroupKey,
  clipSummary,
  pickPlatform,
} from "../../src/domain/pulse/grouping";
import type { PulsePost, Snapshot } from "../../src/data/schemas/pulse";

/**
 * How the two views group and order posts.
 *
 * Grouping is render-layer, but it decides whether a clip posted to five
 * platforms reads as one thing or five — and whether the check-in you owe is at
 * the top of the page or buried.
 */
let seq = 0;
function snap(views: number): Snapshot {
  return { at: 1000, elapsedMin: 60, views, likes: null, comments: null, source: "manual" };
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

const HOUR = 3600000;
const NOW = 1_000_000_000;

describe("clip group identity", () => {
  it("prefers the stored clip id", () => {
    expect(clipGroupKey(post({ clipId: "c1", clipKey: "k", hook: "h" }))).toBe("g:c1");
  });

  it("falls back to the clip key, case-insensitively", () => {
    expect(clipGroupKey(post({ clipKey: "  The Clip  ", hook: "h" }))).toBe("c:the clip");
  });

  it("then to the hook", () => {
    expect(clipGroupKey(post({ hook: "  The Hook  " }))).toBe("h:the hook");
  });

  it("finally to the post's own id, so hookless posts don't all fuse", () => {
    // Every hookless hand-added post sharing one group would be worse than no
    // grouping at all.
    const a = post({ id: "p_a" });
    const b = post({ id: "p_b" });
    expect(clipGroupKey(a)).toBe("i:p_a");
    expect(clipGroupKey(a)).not.toBe(clipGroupKey(b));
  });
});

describe("the by-clip view", () => {
  it("gathers a clip's platforms into one group", () => {
    const g = buildClipGroups(
      [
        post({ clipId: "c", platform: "TikTok" }),
        post({ clipId: "c", platform: "X" }),
        post({ clipId: "other", platform: "X" }),
      ],
      NOW,
    );
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.key === "g:c")!.posts).toHaveLength(2);
  });

  it("puts anything due ahead of everything else", () => {
    // The whole point of the section is not missing the window, so a check-in
    // you owe outranks a clip that is merely recent.
    const groups = buildClipGroups(
      [
        post({ clipId: "recent", postedAt: NOW - 60_000 }),
        post({ clipId: "due", postedAt: NOW - 5 * HOUR }),
      ],
      NOW,
    );
    expect(groups[0]!.key).toBe("g:due");
    expect(groups[0]!.anyDue).toBe(true);
  });

  it("orders the rest newest first", () => {
    const groups = buildClipGroups(
      [
        post({ clipId: "old", postedAt: NOW - 300 * HOUR, snapshots: [snap(1)] }),
        post({ clipId: "new", postedAt: NOW - 200 * HOUR, snapshots: [snap(1)] }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["g:new", "g:old"]);
  });

  it("orders a clip's platforms by display order, not by insertion", () => {
    const g = buildClipGroups(
      [
        post({ clipId: "c", platform: "Pinterest" }),
        post({ clipId: "c", platform: "TikTok" }),
        post({ clipId: "c", platform: "YouTube Shorts" }),
      ],
      NOW,
    );
    expect(g[0]!.posts.map((p) => p.platform)).toEqual([
      "YouTube Shorts",
      "TikTok",
      "Pinterest",
    ]);
  });

  it("labels the group from the first post it saw", () => {
    const g = buildClipGroups(
      [
        post({ clipId: "c", clipKey: "the clip key", hook: "first hook" }),
        post({ clipId: "c", hook: "second hook" }),
      ],
      NOW,
    );
    expect(g[0]!.hook).toBe("the clip key");
  });

  it("reports the clip's best showing and where", () => {
    const g = buildClipGroups(
      [
        post({ clipId: "c", platform: "TikTok", snapshots: [snap(500)] }),
        post({ clipId: "c", platform: "X", snapshots: [snap(9000)] }),
      ],
      NOW,
    );
    expect(g[0]!.best).toEqual({ views: 9000, platform: "X" });
  });

  it("keeps the credit with the first platform to reach a tied best", () => {
    const g = buildClipGroups(
      [
        post({ clipId: "c", platform: "TikTok", snapshots: [snap(500)] }),
        post({ clipId: "c", platform: "X", snapshots: [snap(500)] }),
      ],
      NOW,
    );
    expect(g[0]!.best!.platform).toBe("TikTok");
  });

  it("says there are no views rather than showing a zero", () => {
    const g = buildClipGroups([post({ clipId: "c" })], NOW);
    expect(g[0]!.best).toBeNull();
    expect(clipSummary(g[0]!)).toContain("no views yet");
  });

  it("summarizes the platforms, what is due, and the best number", () => {
    const g = buildClipGroups(
      [
        post({ clipId: "c", platform: "TikTok", postedAt: NOW - 5 * HOUR, snapshots: [snap(12000)] }),
        post({ clipId: "c", platform: "X", postedAt: NOW - 60_000 }),
      ],
      NOW,
    );
    const s = clipSummary(g[0]!);
    expect(s).toContain("2 platforms");
    expect(s).toContain("1 due now");
    expect(s).toContain("best 12,000 on TikTok");
  });

  it("says none due rather than 0 due", () => {
    // Posted a minute ago, so the 1h checkpoint has not come round yet.
    const g = buildClipGroups([post({ clipId: "c", postedAt: NOW - 60_000 })], NOW);
    expect(clipSummary(g[0]!)).toContain("none due");
  });
});

describe("the by-platform view", () => {
  it("orders platforms by display order", () => {
    const g = buildPlatformGroups(
      [post({ platform: "Pinterest" }), post({ platform: "YouTube Shorts" }), post({ platform: "X" })],
      NOW,
    );
    expect(g.map((x) => x.platform)).toEqual(["YouTube Shorts", "X", "Pinterest"]);
  });

  it("orders posts within a platform newest first", () => {
    // This is the walk-down list: you work through what you posted most
    // recently, which is where the readings are owed.
    const g = buildPlatformGroups(
      [
        post({ id: "p_old", platform: "X", postedAt: 1000 }),
        post({ id: "p_new", platform: "X", postedAt: 9000 }),
      ],
      NOW,
    );
    expect(g[0]!.posts.map((p) => p.id)).toEqual(["p_new", "p_old"]);
  });

  it("counts what is due per platform", () => {
    const g = buildPlatformGroups(
      [
        post({ platform: "X", postedAt: NOW - 5 * HOUR }),
        post({ platform: "X", postedAt: NOW - 60_000 }),
      ],
      NOW,
    );
    expect(g[0]!.dueCount).toBe(1);
  });

  it("puts an unknown platform last rather than dropping it", () => {
    // A platform that no longer exists in the table still has the creator's
    // posts in it.
    const g = buildPlatformGroups([post({ platform: "Vine" }), post({ platform: "X" })], NOW);
    expect(g.map((x) => x.platform)).toEqual(["X", "Vine"]);
  });
});

describe("which platform the view opens on", () => {
  const groups = (now = NOW) =>
    buildPlatformGroups(
      [
        post({ platform: "YouTube Shorts", postedAt: now - 60_000 }),
        post({ platform: "X", postedAt: now - 5 * HOUR }),
      ],
      now,
    );

  it("keeps the creator's pick when it still has posts", () => {
    expect(pickPlatform(groups(), "X")).toBe("X");
  });

  it("falls to the first platform with something owed", () => {
    // Opening on an empty column wastes the trip.
    expect(pickPlatform(groups(), "Threads")).toBe("X");
  });

  it("then to the first platform with anything at all", () => {
    const g = buildPlatformGroups([post({ platform: "Pinterest", postedAt: NOW - 60_000 })], NOW);
    expect(pickPlatform(g, "")).toBe("Pinterest");
  });

  it("returns empty when there is nothing to show", () => {
    expect(pickPlatform([], "X")).toBe("");
  });
});
