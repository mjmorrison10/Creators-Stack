import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadQueue,
  migrateSessionIntoQuick,
  quickPost,

  saveQueue,
  writeSessionProjection,
  type BlastSession,
} from "../../src/domain/blast/queue";
import { consumeHandoff } from "../../src/domain/blast/handoff";
import { KEYS } from "../../src/data/keys";

/**
 * The legacy-upgrade path: a creator mid-session in the still-deployed BLAST
 * opens the unified app for the first time.
 *
 * This is the one path the EXACT-compatibility rule exists to protect, and it
 * is the seam the domain differential tests don't span — the migration is a
 * pure function, but whether its result is ever WRITTEN is a question about the
 * mount sequence. A code review found the answer was no. These tests pin the
 * sequence itself.
 */

const SESSION: BlastSession = {
  base: "my in-flight caption",
  videoHook: "the opening line",
  transcript: "a transcript I pasted",
  captions: { X: "xcap" },
  titles: {},
  suggestions: {},
  picked: {},
  status: { X: "copied" },
  postUrl: {},
  postedAt: {},
  postedCaption: {},
  updatedAt: 1000,
};

function readSession(): Partial<BlastSession> | null {
  const raw = localStorage.getItem(KEYS.blastSession);
  return raw ? (JSON.parse(raw) as Partial<BlastSession>) : null;
}

describe("upgrading from a legacy in-flight session", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(KEYS.blastSession, JSON.stringify(SESSION));
  });

  it("rescues the caption, hook, per-platform captions and status", () => {
    const migrated = migrateSessionIntoQuick(loadQueue());
    const quick = quickPost(migrated);
    expect(quick.text).toBe("my in-flight caption");
    expect(quick.hookText).toBe("the opening line");
    expect(quick.captions).toEqual({ X: "xcap" });
    expect(quick.status).toEqual({ X: "copied" });
  });

  it("persists the migrated queue, so a reload before typing loses nothing", () => {
    // The failure this pins: the migration returning a rescued Quick post that
    // only ever lived in React state. Reload, and the session is the only copy
    // left — and the projection rewrite below has already blanked it.
    const migrated = migrateSessionIntoQuick(loadQueue());
    saveQueue(migrated);

    expect(localStorage.getItem(KEYS.blastQueue)).not.toBeNull();
    expect(quickPost(loadQueue()).text).toBe("my in-flight caption");
  });

  it("rebuilds the projection from the MIGRATED queue, not a second disk read", () => {
    // Re-reading storage here is what destroyed the session: at that moment the
    // queue key does not exist yet, so loadQueue() hands back a blank Quick post
    // and the projection write blanks the only copy of the user's work.
    const migrated = migrateSessionIntoQuick(loadQueue());
    saveQueue(migrated);
    writeSessionProjection(migrated);

    const after = readSession();
    expect(after?.base).toBe("my in-flight caption");
    expect(after?.captions).toEqual({ X: "xcap" });
    expect(after?.status).toEqual({ X: "copied" });
  });

  it("keeps the transcript, which the queue has nowhere to store", () => {
    const migrated = migrateSessionIntoQuick(loadQueue());
    saveQueue(migrated);
    writeSessionProjection(migrated);
    expect(readSession()?.transcript).toBe("a transcript I pasted");
  });

  it("does not absorb a session when a queue already exists", () => {
    // The documented back door: a stale session arriving from another device
    // must never replace current work.
    saveQueue({
      v: 1,
      updatedAt: 2000,
      defaultPlatforms: null,
      batchCount: 1,
      clips: [{ ...quickPost(loadQueue()), text: "work I did on this device" }],
    });
    const migrated = migrateSessionIntoQuick(loadQueue());
    expect(quickPost(migrated).text).toBe("work I did on this device");
  });
});

describe("a full store must not take the app down with it", () => {
  const realSetItem = Storage.prototype.setItem;

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    Storage.prototype.setItem = realSetItem;
    vi.restoreAllMocks();
  });

  /** Quota errors are DOMExceptions — a plain Error is not what the code detects. */
  function fillStorage(): void {
    Storage.prototype.setItem = function () {
      throw new DOMException("full", "QuotaExceededError");
    };
  }

  it("swallows a quota failure when writing the projection", () => {
    // Legacy wraps this exact write in a catch and calls the failure non-fatal
    // (blast/app.js:487). Letting it throw takes down the whole render — there
    // is no error boundary — at the very moment the shedding machinery is
    // supposed to be degrading gracefully.
    const q = loadQueue();
    fillStorage();
    expect(() => writeSessionProjection(q)).not.toThrow();
  });

  it("still reports the queue save failure rather than hiding it", () => {
    // Non-fatal is not the same as silent: saveQueue must still say no.
    const q = loadQueue();
    fillStorage();
    expect(saveQueue(q).ok).toBe(false);
  });
});

describe("the single-caption inbox legacy RECALL still writes", () => {
  beforeEach(() => localStorage.clear());

  it("drains blast_handoff_v1 into the Quick post", () => {
    // RECALL is still deployed and its per-moment "Send to BLAST" writes here
    // rather than queueing a clip. Nothing consuming it means those captions
    // silently never arrive — and the key is SYNC_EXCLUDEd, so nothing ever
    // cleans it up either.
    localStorage.setItem(
      KEYS.blastHandoff,
      JSON.stringify({ caption: "a caption from RECALL", source: "recall", createdAt: 1 }),
    );
    const r = consumeHandoff(loadQueue());
    expect(r.took).toBe(true);
    expect(quickPost(r.queue).text).toBe("a caption from RECALL");
    expect(localStorage.getItem(KEYS.blastHandoff)).toBeNull();
  });

  it("waits rather than overwriting work in progress", () => {
    // Legacy leaves the key in place when the caption box has text, so the
    // handoff arrives after the current post is cleared instead of clobbering
    // it.
    localStorage.setItem(KEYS.blastHandoff, JSON.stringify({ caption: "incoming" }));
    saveQueue({
      ...loadQueue(),
      clips: [{ ...quickPost(loadQueue()), text: "mid-sentence" }],
    });
    const r = consumeHandoff(loadQueue());
    expect(r.took).toBe(false);
    expect(quickPost(r.queue).text).toBe("mid-sentence");
    expect(localStorage.getItem(KEYS.blastHandoff)).not.toBeNull();
  });

  it("garbage-collects a malformed handoff instead of retrying it forever", () => {
    localStorage.setItem(KEYS.blastHandoff, JSON.stringify({ caption: "   " }));
    expect(consumeHandoff(loadQueue()).took).toBe(false);
    expect(localStorage.getItem(KEYS.blastHandoff)).toBeNull();
  });

  it("is a no-op when there is no handoff", () => {
    const q = loadQueue();
    const r = consumeHandoff(q);
    expect(r.took).toBe(false);
    expect(r.queue).toBe(q);
  });
});

describe("clips arriving from a sync or another app", () => {
  beforeEach(() => localStorage.clear());

  it("fills in maps a stored clip is missing rather than crashing on them", () => {
    // Three deployed apps and a merge write this key. A clip without `status`
    // crashed the queue rail; one without `text` crashed its label.
    localStorage.setItem(
      KEYS.blastQueue,
      JSON.stringify({ v: 1, updatedAt: 1, clips: [{ key: "partial" }] }),
    );
    const clip = loadQueue().clips.find((p) => p.key === "partial")!;
    for (const f of ["captions", "titles", "suggestions", "picked", "status"] as const) {
      expect(clip[f], f).toEqual({});
    }
    expect(clip.text).toBe("");
    expect(() => Object.values(clip.status).length).not.toThrow();
  });

  it("keeps the values a clip does carry", () => {
    localStorage.setItem(
      KEYS.blastQueue,
      JSON.stringify({
        v: 1,
        updatedAt: 1,
        clips: [{ key: "k", text: "kept", status: { X: "posted" }, patternFamily: "identity" }],
      }),
    );
    const clip = loadQueue().clips.find((p) => p.key === "k")!;
    expect(clip.text).toBe("kept");
    expect(clip.status).toEqual({ X: "posted" });
    expect(clip.patternFamily).toBe("identity");
  });
});
