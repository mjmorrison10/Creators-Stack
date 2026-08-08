import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  blankPost,
  buildSessionProjection,
  loadQueue,
  migrateSessionIntoQuick,
  normalizeBatchCount,
  QUICK_KEY,
  quickPost,
  readBatchCount,
  removePost,
  resetQuick,
  saveQueue,
  selectedNames,
  SESSION_FIELDS,
  updatePost,
  writeBatchCount,
  writeSessionProjection,
  type BlastPost,
  type BlastQueue,
} from "../../src/domain/blast/queue";
import { bumpStatus, PLATFORMS } from "../../src/domain/blast/platforms";
import { KEYS } from "../../src/data/keys";

const APP_JS = resolve(import.meta.dirname, "../../../blast/app.js");

/**
 * The legacy queue functions read and write `localStorage` directly, which
 * jsdom provides, so they run as-is once sliced out of app.js. That keeps the
 * differential guarantee on the two things here that are persisted contracts:
 * the queue blob PULSE syncs, and the `blast_session_v1` projection PULSE reads.
 */
function loadLegacy(): {
  loadPosts: () => Record<string, unknown>;
  savePosts: () => void;
  writeSessionProjection: () => void;
  migrateSessionIntoQuick: (q: Record<string, unknown>) => void;
  blankPost: (key: string, extra?: unknown) => Record<string, unknown>;
  getBatchCount: () => number;
  getPosts: () => Record<string, unknown>[];
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
    slice('var LS_SESSION = "blast_session_v1";', "function loadSession()") +
    slice("function resetSession()", "// === Per-platform presets");

  // The legacy body reaches for DOM inputs and a toast; both are absent in a
  // unit context, so they are stubbed to the "no element" branch it already
  // handles. Nothing about the persisted shapes depends on them.
  return new Function(
    `var document = { querySelector: function () { return null; } };
     function toast() {}
     function getBatchCount() {
       var v = 1;
       try { v = parseInt(localStorage.getItem("blast_batch_count_v1"), 10) || 1; } catch (e) {}
       return v === 2 || v === 3 ? v : 1;
     }
     ${block}
     return {loadPosts: loadPosts, savePosts: savePosts,
             writeSessionProjection: writeSessionProjection,
             migrateSessionIntoQuick: migrateSessionIntoQuick,
             blankPost: blankPost, getBatchCount: getBatchCount,
             getPosts: function () { return posts; }};`,
  )() as ReturnType<typeof loadLegacy>;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function post(key: string, over: Partial<BlastPost> = {}): BlastPost {
  return blankPost(key, over, 1000);
}

function queue(clips: BlastPost[], over: Partial<BlastQueue> = {}): BlastQueue {
  return {
    v: 1,
    updatedAt: 1000,
    defaultPlatforms: null,
    batchCount: 1,
    clips,
    ...over,
  };
}

describe("the queue blob", () => {
  it("always has a Quick post, first, even from nothing", () => {
    const q = loadQueue();
    expect(q.clips[0]?.key).toBe(QUICK_KEY);
    expect(q.clips).toHaveLength(1);
  });

  it("pulls an existing Quick post to the front", () => {
    localStorage.setItem(
      KEYS.blastQueue,
      JSON.stringify({ v: 1, clips: [post("c1"), post(QUICK_KEY)] }),
    );
    expect(loadQueue().clips.map((p) => p.key)).toEqual([QUICK_KEY, "c1"]);
  });

  it("treats a wrong-version or malformed blob as empty rather than crashing", () => {
    localStorage.setItem(KEYS.blastQueue, JSON.stringify({ v: 2, clips: [post("c1")] }));
    expect(loadQueue().clips.map((p) => p.key)).toEqual([QUICK_KEY]);
    localStorage.setItem(KEYS.blastQueue, "{oops");
    expect(loadQueue().clips.map((p) => p.key)).toEqual([QUICK_KEY]);
  });

  it("writes the same envelope the legacy does", () => {
    const legacy = loadLegacy();
    legacy.loadPosts();
    legacy.savePosts();
    const fromLegacy = JSON.parse(localStorage.getItem(KEYS.blastQueue)!);

    localStorage.clear();
    saveQueue(loadQueue());
    const fromPort = JSON.parse(localStorage.getItem(KEYS.blastQueue)!);

    expect(Object.keys(fromPort).sort()).toEqual(Object.keys(fromLegacy).sort());
    expect(fromPort.v).toBe(1);
    expect(fromPort.clips).toHaveLength(1);
  });

  it("mints a Quick post with the same fields the legacy does", () => {
    const legacy = loadLegacy();
    // createdAt/updatedAt are clock stamps; the field SET is the contract.
    expect(Object.keys(blankPost(QUICK_KEY)).sort()).toEqual(
      Object.keys(legacy.blankPost(QUICK_KEY)).sort(),
    );
  });

  it("marks a Quick post as quick-sourced and a queued one as recall-sourced", () => {
    expect(blankPost(QUICK_KEY).source).toBe("quick");
    expect(blankPost("c1").source).toBe("recall");
  });
});

describe("the batch count setting", () => {
  it("reads its own key, not the copy inside the queue blob", () => {
    // The blob copy exists so the value rides along on sync. Reading it would
    // let a queue synced from another device silently change this device's
    // setting.
    localStorage.setItem(KEYS.blastBatchCount, "3");
    localStorage.setItem(
      KEYS.blastQueue,
      JSON.stringify({ v: 1, clips: [post(QUICK_KEY)], batchCount: 1 }),
    );
    expect(loadQueue().batchCount).toBe(3);
  });

  it("accepts only 1, 2 and 3", () => {
    for (const [input, want] of [
      ["1", 1],
      ["2", 2],
      ["3", 3],
      ["4", 1],
      ["0", 1],
      ["nonsense", 1],
      [null, 1],
    ] as const) {
      expect(normalizeBatchCount(input), String(input)).toBe(want);
    }
  });

  it("agrees with the legacy reader on every stored value", () => {
    const legacy = loadLegacy();
    for (const raw of ["1", "2", "3", "4", "0", "", "nonsense", "2.9"]) {
      localStorage.setItem(KEYS.blastBatchCount, raw);
      expect(readBatchCount(), raw).toBe(legacy.getBatchCount());
    }
  });

  it("round-trips through its own writer", () => {
    writeBatchCount(3);
    expect(localStorage.getItem(KEYS.blastBatchCount)).toBe("3");
    expect(readBatchCount()).toBe(3);
    writeBatchCount(9);
    expect(readBatchCount()).toBe(1);
  });

  it("stamps the current setting into the blob on save, for sync", () => {
    writeBatchCount(2);
    saveQueue(loadQueue());
    expect(JSON.parse(localStorage.getItem(KEYS.blastQueue)!).batchCount).toBe(2);
  });
});

describe("quota shedding", () => {
  /** Fail the first `failures` writes to the queue key, then let them through. */
  function failWrites(failures: number): () => number {
    const real = Storage.prototype.setItem;
    let seen = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (k === KEYS.blastQueue && seen++ < failures) {
        // A real DOMException, which is what a browser throws — the storage
        // layer's detection requires it, so a plain Error would test nothing.
        throw new DOMException("quota", "QuotaExceededError");
      }
      return real.call(this, k, v);
    });
    return () => seen;
  }

  const withSuggestions = (key: string) =>
    post(key, { suggestions: { X: ["a", "b"], TikTok: ["c"] }, captions: { X: "kept" } });

  it("drops unpicked suggestions to keep the captions", () => {
    failWrites(1);
    const r = saveQueue(queue([post(QUICK_KEY), withSuggestions("c1")]));
    expect(r.ok).toBe(true);
    expect(r.shed).toBe(1);
    expect(r.queue.clips[1]!.suggestions).toEqual({});
    expect(r.queue.clips[1]!.captions).toEqual({ X: "kept" });
  });

  it("sheds the most recently added clip first", () => {
    // The legacy comment says "oldest clips first"; its loop runs backwards and
    // does the opposite. Behavior ported, not the comment.
    failWrites(1);
    const r = saveQueue(
      queue([post(QUICK_KEY), withSuggestions("older"), withSuggestions("newer")]),
    );
    expect(r.queue.clips[2]!.suggestions).toEqual({});
    expect(r.queue.clips[1]!.suggestions).not.toEqual({});
  });

  it("never sheds the Quick post", () => {
    // It is the one the user is looking at.
    failWrites(1);
    const r = saveQueue(queue([withSuggestions(QUICK_KEY), withSuggestions("c1")]));
    expect(r.queue.clips[0]!.suggestions).not.toEqual({});
  });

  it("gives up rather than shedding Quick when it is the only thing left", () => {
    // The previous test passes even without the guard, because the queued clip
    // gets shed first either way. This is the case that actually needs it.
    failWrites(99);
    const r = saveQueue(queue([withSuggestions(QUICK_KEY), post("c1")]));
    expect(r.ok).toBe(false);
    expect(r.shed).toBe(0);
    expect(r.queue.clips[0]!.suggestions).not.toEqual({});
  });

  it("keeps shedding until it fits", () => {
    failWrites(2);
    const r = saveQueue(
      queue([post(QUICK_KEY), withSuggestions("c1"), withSuggestions("c2")]),
    );
    expect(r.ok).toBe(true);
    expect(r.shed).toBe(2);
  });

  it("reports failure when there is nothing left to shed", () => {
    // The caller has to be able to say so; a silent failure here is the Phase 4
    // blocker all over again.
    failWrites(99);
    const r = saveQueue(queue([post(QUICK_KEY), post("c1")]));
    expect(r.ok).toBe(false);
    expect(r.shed).toBe(0);
  });

  it("returns the shed queue so the drop is not undone on the next save", () => {
    failWrites(1);
    const r = saveQueue(queue([post(QUICK_KEY), withSuggestions("c1")]));
    const persisted = JSON.parse(localStorage.getItem(KEYS.blastQueue)!);
    expect(persisted.clips[1].suggestions).toEqual({});
    expect(r.queue.clips[1]!.suggestions).toEqual(persisted.clips[1].suggestions);
  });

  it("rethrows anything that is not a quota failure", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new TypeError("something else entirely");
    });
    expect(() => saveQueue(queue([post(QUICK_KEY)]))).toThrow(TypeError);
  });
});

describe("the blast_session_v1 projection", () => {
  it("has exactly the fields the legacy writes, and no others", () => {
    // PULSE reads this shape. An extra field is noise; a missing one is a bug
    // that only shows up in another app.
    const legacy = loadLegacy();
    legacy.loadPosts();
    legacy.writeSessionProjection();
    const fromLegacy = JSON.parse(localStorage.getItem(KEYS.blastSession)!);

    localStorage.clear();
    writeSessionProjection(loadQueue());
    const fromPort = JSON.parse(localStorage.getItem(KEYS.blastSession)!);

    expect(Object.keys(fromPort).sort()).toEqual(Object.keys(fromLegacy).sort());
    expect(Object.keys(fromPort).sort()).toEqual([...SESSION_FIELDS].sort());
    expect(SESSION_FIELDS).toHaveLength(12);
  });

  it("projects the Quick post's values, not another clip's", () => {
    const q = queue([
      post(QUICK_KEY, { text: "quick caption", captions: { X: "quick X" } }),
      post("c1", { text: "queued caption", captions: { X: "queued X" } }),
    ]);
    const s = buildSessionProjection(quickPost(q), "", 5000);
    expect(s.base).toBe("quick caption");
    expect(s.captions).toEqual({ X: "quick X" });
  });

  it("carries the transcript forward rather than dropping it", () => {
    // The queue does not hold the transcript, so rebuilding from the clip alone
    // would silently erase it every time anything else changed.
    localStorage.setItem(
      KEYS.blastSession,
      JSON.stringify({ transcript: "the spoken words" }),
    );
    expect(buildSessionProjection(post(QUICK_KEY), null, 5000).transcript).toBe(
      "the spoken words",
    );
  });

  it("prefers an explicitly supplied transcript over the stored one", () => {
    localStorage.setItem(KEYS.blastSession, JSON.stringify({ transcript: "stale" }));
    expect(buildSessionProjection(post(QUICK_KEY), "fresh", 5000).transcript).toBe("fresh");
  });

  it("defaults every map rather than writing undefined", () => {
    const bare = { key: QUICK_KEY } as BlastPost;
    const s = buildSessionProjection(bare, "", 5000);
    for (const f of ["captions", "titles", "suggestions", "picked", "status"] as const) {
      expect(s[f], f).toEqual({});
    }
    expect(s.base).toBe("");
  });
});

describe("every Quick-post mutation reaches the projection", () => {
  const platform = PLATFORMS[0]!.name;

  /** Apply a mutation the way the app will, then read what PULSE would see. */
  function mutateAndProject(fn: (p: BlastPost) => BlastPost): Record<string, unknown> {
    let q = queue([post(QUICK_KEY), post("c1")]);
    q = updatePost(q, QUICK_KEY, fn, 9000);
    saveQueue(q, 9000);
    writeSessionProjection(q, "", 9000);
    return JSON.parse(localStorage.getItem(KEYS.blastSession)!);
  }

  it("carries a caption edit", () => {
    expect(mutateAndProject((p) => ({ ...p, text: "new base" })).base).toBe("new base");
  });

  it("carries a per-platform caption", () => {
    const s = mutateAndProject((p) => ({ ...p, captions: { [platform]: "tailored" } }));
    expect(s.captions).toEqual({ [platform]: "tailored" });
  });

  it("carries a picked suggestion", () => {
    expect(mutateAndProject((p) => ({ ...p, picked: { [platform]: 2 } })).picked).toEqual({
      [platform]: 2,
    });
  });

  it("carries a status bump", () => {
    const s = mutateAndProject((p) => ({
      ...p,
      status: { [platform]: bumpStatus(p.status[platform], "copied") },
    }));
    expect(s.status).toEqual({ [platform]: "copied" });
  });

  it("carries marking a platform posted, with its url and caption", () => {
    const s = mutateAndProject((p) => ({
      ...p,
      status: { [platform]: "posted" },
      postUrl: { [platform]: "https://example.com/p/1" },
      postedAt: { [platform]: 9000 },
      postedCaption: { [platform]: "what actually went out" },
    }));
    expect(s.status).toEqual({ [platform]: "posted" });
    expect(s.postUrl).toEqual({ [platform]: "https://example.com/p/1" });
    expect(s.postedCaption).toEqual({ [platform]: "what actually went out" });
  });

  it("carries the video hook", () => {
    expect(mutateAndProject((p) => ({ ...p, hookText: "the opening line" })).videoHook).toBe(
      "the opening line",
    );
  });

  it("clears the projection's working fields on reset", () => {
    let q = queue([post(QUICK_KEY, { text: "old", captions: { [platform]: "old" } })]);
    q = resetQuick(q, 9000);
    writeSessionProjection(q, "", 9000);
    const s = JSON.parse(localStorage.getItem(KEYS.blastSession)!);
    expect(s.base).toBe("");
    expect(s.captions).toEqual({});
  });

  it("stamps updatedAt on the clip for every mutation, including posted", () => {
    // Without the bump a merge can't tell that an afternoon of posting is newer
    // than a stale clip on another device.
    const q = updatePost(
      queue([post(QUICK_KEY)]),
      QUICK_KEY,
      (p) => ({ ...p, status: { [platform]: "posted" } }),
      9999,
    );
    expect(quickPost(q).updatedAt).toBe(9999);
  });

  it("leaves other clips untouched", () => {
    const q = updatePost(
      queue([post(QUICK_KEY), post("c1", { text: "queued" })]),
      QUICK_KEY,
      (p) => ({ ...p, text: "changed" }),
      9000,
    );
    expect(q.clips[1]!.text).toBe("queued");
    expect(q.clips[1]!.updatedAt).toBe(1000);
  });
});

describe("the one-way session migration", () => {
  const SESSION = {
    base: "in-flight caption",
    videoHook: "in-flight hook",
    captions: { X: "session X" },
    status: { X: "copied" },
  };

  it("absorbs an in-flight session when no queue exists yet", () => {
    localStorage.setItem(KEYS.blastSession, JSON.stringify(SESSION));
    const q = migrateSessionIntoQuick(loadQueue());
    expect(quickPost(q).text).toBe("in-flight caption");
    expect(quickPost(q).hookText).toBe("in-flight hook");
    expect(quickPost(q).captions).toEqual({ X: "session X" });
  });

  it("refuses to absorb once a queue exists on this device", () => {
    // This is the documented back door: a stale session arriving from another
    // device got absorbed into the Quick card and replaced current work.
    localStorage.setItem(KEYS.blastSession, JSON.stringify(SESSION));
    localStorage.setItem(
      KEYS.blastQueue,
      JSON.stringify({ v: 1, clips: [blankPost(QUICK_KEY, { text: "current work" })] }),
    );
    const q = migrateSessionIntoQuick(loadQueue());
    expect(quickPost(q).text).toBe("current work");
  });

  it("refuses to absorb a stale session even when Quick is still empty", () => {
    // The real back door, and the one the other tests miss: a session synced
    // from another device arrives next to an untouched local Quick post. The
    // untouched-check alone would let it through — only the queue-exists check
    // stops it. Both guards are kept; this is the case that needs the second.
    localStorage.setItem(KEYS.blastSession, JSON.stringify(SESSION));
    localStorage.setItem(
      KEYS.blastQueue,
      JSON.stringify({ v: 1, clips: [blankPost(QUICK_KEY)] }),
    );
    const q = migrateSessionIntoQuick(loadQueue());
    expect(quickPost(q).text).toBe("");
    expect(quickPost(q).captions).toEqual({});
  });

  it("refuses to absorb over a Quick post that has been touched", () => {
    localStorage.setItem(KEYS.blastSession, JSON.stringify(SESSION));
    const q = migrateSessionIntoQuick(queue([post(QUICK_KEY, { text: "typed already" })]));
    expect(quickPost(q).text).toBe("typed already");
  });

  it("is a no-op with no session at all", () => {
    const q = loadQueue();
    expect(migrateSessionIntoQuick(q)).toBe(q);
  });

  it("matches the legacy migration field for field", () => {
    localStorage.setItem(KEYS.blastSession, JSON.stringify(SESSION));
    const legacy = loadLegacy();
    const legacyQuick = legacy.loadPosts();
    legacy.migrateSessionIntoQuick(legacyQuick);

    const ported = quickPost(migrateSessionIntoQuick(loadQueue()));
    for (const f of [
      "text",
      "hookText",
      "captions",
      "titles",
      "suggestions",
      "picked",
      "status",
      "postUrl",
      "postedAt",
      "postedCaption",
    ] as const) {
      expect(ported[f], f).toEqual(legacyQuick[f]);
    }
  });
});

describe("reset and removal", () => {
  it("resets only the Quick post, leaving the batch alone", () => {
    // A queued batch is the user's work, not session scratch.
    const q = resetQuick(
      queue([
        post(QUICK_KEY, { text: "scratch", captions: { X: "a" } }),
        post("c1", { text: "real work", captions: { X: "b" } }),
      ]),
      9000,
    );
    expect(q.clips[0]!.text).toBe("");
    expect(q.clips[0]!.captions).toEqual({});
    expect(q.clips[1]!.text).toBe("real work");
    expect(q.clips[1]!.captions).toEqual({ X: "b" });
  });

  it("refuses to remove the Quick post", () => {
    // It is permanent; without it the projection has nothing to derive from.
    const q = queue([post(QUICK_KEY), post("c1")]);
    expect(removePost(q, QUICK_KEY)).toBe(q);
    expect(removePost(q, "c1").clips.map((p) => p.key)).toEqual([QUICK_KEY]);
  });
});

describe("platform selection", () => {
  it("falls back to every platform when nothing is chosen", () => {
    const q = queue([post(QUICK_KEY)]);
    expect(selectedNames(q, quickPost(q))).toEqual(PLATFORMS.map((p) => p.name));
  });

  it("prefers the clip's own choice over the queue default", () => {
    const q = queue([post(QUICK_KEY, { platforms: ["X"] })], { defaultPlatforms: ["TikTok"] });
    expect(selectedNames(q, quickPost(q))).toEqual(["X"]);
  });

  it("uses the queue default when the clip has none", () => {
    const q = queue([post(QUICK_KEY)], { defaultPlatforms: ["TikTok"] });
    expect(selectedNames(q, quickPost(q))).toEqual(["TikTok"]);
  });

  it("returns names in display order, whatever order they were stored in", () => {
    const q = queue([post(QUICK_KEY, { platforms: ["Threads", "TikTok"] })]);
    expect(selectedNames(q, quickPost(q))).toEqual(["TikTok", "Threads"]);
  });

  it("drops a stored name that is no longer a platform", () => {
    const q = queue([post(QUICK_KEY, { platforms: ["X", "Vine"] })]);
    expect(selectedNames(q, quickPost(q))).toEqual(["X"]);
  });

  it("treats an empty selection as all platforms, not none", () => {
    const q = queue([post(QUICK_KEY, { platforms: [] })]);
    expect(selectedNames(q, quickPost(q))).toHaveLength(PLATFORMS.length);
  });
});
