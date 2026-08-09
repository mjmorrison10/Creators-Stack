import { describe, it, expect, beforeEach } from "vitest";
import { mergeStates, WorkspaceMismatchError } from "../../src/data/stackdata/merge";
import { loadLegacy, normalizeExport, type LegacyStackData } from "./legacy-harness";
import type { StackBackup } from "../../src/data/schemas/stack";

/**
 * Differential tests: run the ORIGINAL stackdata.js and the TypeScript port
 * over the same inputs, and require identical JSON.
 *
 * This is the whole safety argument for rewriting the merge engine. A subtly
 * wrong merge does not throw — it silently duplicates or drops user data on the
 * next device sync, days later. Hand-review cannot catch that; a diff can.
 */

let legacy: LegacyStackData;

beforeEach(() => {
  localStorage.clear();
  legacy = loadLegacy();
});

const FIXED = () => "2026-08-06T00:00:00.000Z";

function envelope(
  exportedAt: string,
  ls: Record<string, unknown>,
  recallLibrary: unknown = null,
): StackBackup {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(ls)) {
    raw[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return {
    format: "mjm-stack-backup",
    version: 2,
    exportedAt,
    localStorage: raw,
    recallLibrary: recallLibrary as StackBackup["recallLibrary"],
  };
}

/** Assert both engines agree on the merged payload. */
function expectParity(a: StackBackup, b: StackBackup): void {
  const mine = mergeStates(a, b, FIXED);
  const theirs = legacy.mergeStates(a, b);
  expect(normalizeExport(mine.data as unknown as Record<string, unknown>)).toEqual(
    normalizeExport(theirs.data),
  );
  expect(mine.report).toEqual(theirs.report);
}

describe("merge engine parity with the original stackdata.js", () => {
  it("matches on an empty merge", () => {
    expectParity(envelope("2026-01-01T00:00:00Z", {}), envelope("2026-01-02T00:00:00Z", {}));
  });

  it("matches when unioning RECALL sources, with more-segments winning", () => {
    const truncated = {
      sources: [{ id: "s1", title: "One", segments: [{ t: "0:00:01", sec: 1, text: "a" }] }],
      enabled: ["s1"],
      bin: [],
    };
    const full = {
      sources: [
        {
          id: "s1",
          title: "One",
          segments: [
            { t: "0:00:01", sec: 1, text: "a" },
            { t: "0:00:05", sec: 5, text: "b" },
          ],
        },
        { id: "s2", title: "Two", segments: [] },
      ],
      enabled: ["s1", "s2"],
      bin: [{ key: "s1@1@0", srcId: "s1", srcTitle: "One", t: "0:00:01", sec: 1, text: "a" }],
    };
    // Older side carries the FULL copy, so this also proves the newer side does
    // not win by recency alone.
    expectParity(
      envelope("2026-01-02T00:00:00Z", {}, truncated),
      envelope("2026-01-01T00:00:00Z", {}, full),
    );
  });

  it("matches on PULSE snapshot merging and duplicate collapse", () => {
    const postA = {
      id: "p_aaa",
      platform: "TikTok",
      url: "https://tiktok.com/x",
      caption: "c",
      hook: "h",
      postedAt: 1000,
      snapshots: [{ at: 5000, elapsedMin: 60, views: 10, likes: null, comments: null, source: "manual" }],
      outcome: null,
      ledgerLoggedAt: null,
    };
    // Same platform+url, different id → must collapse, keeping the lower id.
    const postB = {
      ...postA,
      id: "p_zzz",
      postedAt: 900,
      snapshots: [
        { at: 9000, elapsedMin: 60, views: 99, likes: 1, comments: 2, source: "auto" },
        { at: 9000, elapsedMin: 120, views: 120, likes: null, comments: null, source: "auto" },
      ],
      outcome: "winner",
    };
    expectParity(
      envelope("2026-01-02T00:00:00Z", { pulse_posts_v1: [postA] }),
      envelope("2026-01-01T00:00:00Z", { pulse_posts_v1: [postB] }),
    );
  });

  it("matches on HOOKLAB ledger union with newest-edit winning", () => {
    const a = {
      ledger: [
        { id: "id_1", hook: "old", outcome: "meh", createdAt: "2026-01-01T00:00:00Z" },
        { id: "id_2", hook: "keep", outcome: "winner", createdAt: "2026-01-03T00:00:00Z" },
      ],
      comps: [{ id: "c1", hook: "comp", createdAt: "2026-01-01T00:00:00Z" }],
    };
    const b = {
      ledger: [
        {
          id: "id_1",
          hook: "edited",
          outcome: "winner",
          createdAt: "2026-01-01T00:00:00Z",
          editedAt: "2026-01-05T00:00:00Z",
        },
      ],
      comps: [{ id: "c2", hook: "other", createdAt: "2026-01-02T00:00:00Z" }],
    };
    expectParity(
      envelope("2026-01-04T00:00:00Z", { hooklab_state_v1: a }),
      envelope("2026-01-06T00:00:00Z", { hooklab_state_v1: b }),
    );
  });

  it("matches on BLAST queue per-clip union, quick clip sorted first", () => {
    const qA = {
      v: 1,
      updatedAt: 500,
      defaultPlatforms: null,
      batchCount: 2,
      clips: [
        { key: "b", text: "later", platforms: null, captions: {}, titles: {}, suggestions: {}, picked: {}, status: {}, postUrl: {}, postedAt: {}, postedCaption: {}, createdAt: 200, updatedAt: 400 },
        { key: "quick", text: "q", platforms: null, captions: {}, titles: {}, suggestions: {}, picked: {}, status: {}, postUrl: {}, postedAt: {}, postedCaption: {}, createdAt: 999, updatedAt: 999 },
      ],
    };
    const qB = {
      v: 1,
      updatedAt: 700,
      defaultPlatforms: ["X"],
      batchCount: 1,
      clips: [
        // Same key, newer updatedAt → wins.
        { key: "b", text: "newest", platforms: null, captions: {}, titles: {}, suggestions: {}, picked: {}, status: {}, postUrl: {}, postedAt: {}, postedCaption: {}, createdAt: 200, updatedAt: 800 },
        { key: "a", text: "only on B", platforms: null, captions: {}, titles: {}, suggestions: {}, picked: {}, status: {}, postUrl: {}, postedAt: {}, postedCaption: {}, createdAt: 100, updatedAt: 100 },
      ],
    };
    expectParity(
      envelope("2026-01-01T00:00:00Z", { blast_queue_v1: qA }),
      envelope("2026-01-02T00:00:00Z", { blast_queue_v1: qB }),
    );
  });

  it("matches on tombstone suppression across both test styles", () => {
    // hooklabLedger uses the strict "tombstone newer than item" rule; pulsePost
    // uses plain key presence. Both must behave exactly as the original.
    const tomb = {
      "hooklabLedger:id_1": Date.parse("2026-01-10T00:00:00Z"),
      "pulsePost:p_aaa": Date.parse("2026-01-10T00:00:00Z"),
    };
    const ledger = {
      ledger: [
        { id: "id_1", hook: "deleted", outcome: "meh", createdAt: "2026-01-01T00:00:00Z" },
        { id: "id_2", hook: "kept", outcome: "meh", createdAt: "2026-01-02T00:00:00Z" },
      ],
      comps: [],
    };
    const posts = [
      { id: "p_aaa", platform: "X", url: "", caption: "", hook: "", postedAt: 1, snapshots: [], outcome: null, ledgerLoggedAt: null },
      { id: "p_bbb", platform: "X", url: "", caption: "", hook: "", postedAt: 2, snapshots: [], outcome: null, ledgerLoggedAt: null },
    ];
    expectParity(
      envelope("2026-01-11T00:00:00Z", {
        stack_tombstones_v1: tomb,
        hooklab_state_v1: ledger,
        pulse_posts_v1: posts,
      }),
      envelope("2026-01-09T00:00:00Z", { hooklab_state_v1: ledger, pulse_posts_v1: posts }),
    );
  });

  it("matches on presets, topclips and unknown forward-compatible keys", () => {
    expectParity(
      envelope("2026-01-02T00:00:00Z", {
        blast_presets_v1: { X: "{caption} #a", TikTok: "{caption}" },
        recall_topclips_v1: { s1: { savedAt: 10, meta: {}, candidates: [] } },
        stack_future_thing_v9: { hello: "from a newer build" },
      }),
      envelope("2026-01-01T00:00:00Z", {
        blast_presets_v1: { X: "older", Threads: "{caption}" },
        recall_topclips_v1: { s1: { savedAt: 99, meta: {}, candidates: [] } },
        stack_future_thing_v9: { hello: "older value" },
      }),
    );
  });

  it("never lets an API key reach the merged payload", () => {
    const { data } = mergeStates(
      envelope("2026-01-02T00:00:00Z", {
        stack_settings_v1: { geminiKey: "AIzaSECRET", openrouterKey: "sk-SECRET" },
        blast_session_v1: { base: "stale projection" },
        hooklab_state_v1: { ledger: [], comps: [] },
      }),
      envelope("2026-01-01T00:00:00Z", {}),
      FIXED,
    );
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("AIzaSECRET");
    expect(serialized).not.toContain("sk-SECRET");
    expect(data.localStorage).not.toHaveProperty("stack_settings_v1");
    expect(data.localStorage).not.toHaveProperty("blast_session_v1");
  });

  it("hard-blocks a workspace mismatch, like the original", () => {
    const a = envelope("2026-01-02T00:00:00Z", {
      stack_workspace_v1: { id: "ws_a", name: "Alice", createdAt: 1 },
    });
    const b = envelope("2026-01-01T00:00:00Z", {
      stack_workspace_v1: { id: "ws_b", name: "Bob", createdAt: 2 },
    });
    expect(() => mergeStates(a, b, FIXED)).toThrow(WorkspaceMismatchError);
    expect(() => legacy.mergeStates(a, b)).toThrow();

    try {
      mergeStates(a, b, FIXED);
    } catch (e) {
      const err = e as WorkspaceMismatchError;
      expect(err.code).toBe("WORKSPACE_MISMATCH");
      expect(err.localName).toBe("Alice");
      expect(err.remoteName).toBe("Bob");
    }
  });
});

describe("merge idempotence", () => {
  const a = envelope(
    "2026-01-02T00:00:00Z",
    {
      pulse_posts_v1: [
        { id: "p_b", platform: "X", url: "u1", caption: "", hook: "", postedAt: 2, snapshots: [{ at: 5, elapsedMin: 60, views: 5, likes: null, comments: null, source: "manual" }], outcome: null, ledgerLoggedAt: null },
        { id: "p_a", platform: "X", url: "u2", caption: "", hook: "", postedAt: 1, snapshots: [], outcome: "winner", ledgerLoggedAt: null },
      ],
      hooklab_state_v1: {
        ledger: [{ id: "id_1", hook: "h", outcome: "winner", createdAt: "2026-01-01T00:00:00Z" }],
        comps: [],
      },
      blast_presets_v1: { X: "{caption}" },
    },
    {
      sources: [
        { id: "s2", title: "B", segments: [] },
        { id: "s1", title: "A", segments: [{ t: "0:00:01", sec: 1, text: "x" }] },
      ],
      enabled: ["s2", "s1"],
      bin: [{ key: "s1@1@0", srcId: "s1", srcTitle: "A", t: "0:00:01", sec: 1, text: "x" }],
    },
  );
  const b = envelope("2026-01-01T00:00:00Z", {
    pulse_posts_v1: [
      { id: "p_c", platform: "Threads", url: "u3", caption: "", hook: "", postedAt: 3, snapshots: [], outcome: null, ledgerLoggedAt: null },
    ],
    hooklab_state_v1: {
      ledger: [{ id: "id_2", hook: "h2", outcome: "meh", createdAt: "2026-01-02T00:00:00Z" }],
      comps: [],
    },
  });

  it("is idempotent: merge(merge(a,b),b) === merge(a,b)", () => {
    // The property the sorted output exists to guarantee. Losing it makes two
    // devices ping-pong edits at each other indefinitely.
    const once = mergeStates(a, b, FIXED).data;
    const twice = mergeStates(once, b, FIXED).data;
    expect(twice).toEqual(once);
  });

  it("reaches a fixed point after repeated re-merges", () => {
    let cur = mergeStates(a, b, FIXED).data;
    for (let i = 0; i < 5; i++) cur = mergeStates(cur, b, FIXED).data;
    expect(cur).toEqual(mergeStates(mergeStates(a, b, FIXED).data, b, FIXED).data);
  });

  it("agrees on content regardless of argument order", () => {
    // Order decides tiebreaks, not membership: both directions must carry the
    // same posts and ledger entries.
    const ab = mergeStates(a, b, FIXED).data;
    const ba = mergeStates(b, a, FIXED).data;
    const ids = (env: typeof ab, key: string): string[] => {
      const arr = JSON.parse(env.localStorage[key] ?? "[]") as { id: string }[];
      return arr.map((x) => x.id).sort();
    };
    expect(ids(ab, "pulse_posts_v1")).toEqual(ids(ba, "pulse_posts_v1"));
    const led = (env: typeof ab): string[] =>
      (JSON.parse(env.localStorage["hooklab_state_v1"] ?? "{}").ledger as { id: string }[])
        .map((x) => x.id)
        .sort();
    expect(led(ab)).toEqual(led(ba));
  });
});
