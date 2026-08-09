import { useCallback, useEffect, useRef, useState } from "react";
import { KEYS } from "../../data/keys";
import { subscribe } from "../../data/storage";
import {
  loadQueue,
  migrateSessionIntoQuick,
  QUICK_KEY,
  removePost,
  resetQuick,
  saveQueue,
  updatePost,
  writeBatchCount,
  writeSessionProjection,
  type BlastPost,
  type BlastQueue,
} from "../../domain/blast/queue";
import { bumpStatus, type PostStatus } from "../../domain/blast/platforms";
import { consumeHandoff } from "../../domain/blast/handoff";
import { tombstone } from "../../data/stackdata/tombstones";

const SAVE_FAILED = "Couldn't save — storage is full. Mark a few clips posted and clear them.";

export interface BlastState {
  queue: BlastQueue;
  activeKey: string;
  active: BlastPost;
  /** Set when a write didn't land, or landed only after shedding suggestions. */
  notice: string | null;
  clearNotice: () => void;
  setActiveKey: (key: string) => void;
  mutate: (key: string, fn: (p: BlastPost) => BlastPost) => void;
  setStatus: (key: string, platform: string, next: PostStatus, explicit?: boolean) => void;
  reset: () => void;
  remove: (key: string) => void;
  clearQueue: () => void;
  setBatchCount: (n: number) => void;
  setDefaultPlatforms: (names: string[] | null) => void;
}

/**
 * BLAST's queue, and the one path every write takes.
 *
 * `blast_session_v1` is a projection of the Quick post that PULSE reads, and
 * the whole reason it has a single writer is that a second one drifts. So all
 * mutations funnel through `commit` here: it saves the queue, then rewrites the
 * projection whenever the Quick post was what changed. Nothing else in the
 * feature may call `saveQueue` or `writeSessionProjection` directly.
 */
export function useBlast(): BlastState {
  const [queue, setQueue] = useState<BlastQueue>(() => migrateSessionIntoQuick(loadQueue()));
  const [activeKey, setActiveKey] = useState<string>(QUICK_KEY);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The committed queue, readable synchronously.
   *
   * Mutations used to run through `setQueue((cur) => …)` and do their storage
   * writes inside the updater. State updaters must be pure: StrictMode
   * double-invokes them, so every keystroke saved twice, and a render React
   * discarded still left its localStorage write behind. Handlers read the ref
   * instead, so two writes in the same tick still see each other without any
   * side effect happening during render.
   */
  const queueRef = useRef(queue);

  const adopt = useCallback((q: BlastQueue) => {
    queueRef.current = q;
    setQueue(q);
  }, []);

  // Another tab — or a still-deployed legacy BLAST — writing the queue should
  // show up here without a refresh.
  useEffect(() => subscribe(KEYS.blastQueue, () => adopt(loadQueue())), [adopt]);

  /**
   * The legacy upgrade, and the projection rebuild, in that order.
   *
   * Both must work from the SAME migrated queue. Persisting it is what makes
   * the rescue survive a reload, and building the projection from a second
   * `loadQueue()` was actively destructive: at that moment the queue key does
   * not exist yet, so the read returned a blank Quick post and the write
   * blanked the session — the only copy of an in-flight caption. Legacy does
   * `savePosts()` then projects from the in-memory clip (blast/app.js:489-506).
   */
  useEffect(() => {
    const migrated = migrateSessionIntoQuick(loadQueue());
    // Legacy RECALL is still deployed and still writes a single caption to
    // `blast_handoff_v1`. Draining it here is what makes its "Send to BLAST"
    // button keep working against the unified app.
    const handed = consumeHandoff(migrated);
    const saved = saveQueue(handed.queue);
    adopt(saved.queue);
    writeSessionProjection(saved.queue);
    if (handed.took) setNotice(null);
  }, [adopt]);

  const commit = useCallback(
    (next: BlastQueue, touchedKey: string | null) => {
      const result = saveQueue(next);
      // Use the SAVED queue, not the one passed in: a shed actually dropped
      // suggestions, and carrying on with the pre-shed object would put them
      // straight back on the next write.
      adopt(result.queue);
      if (!result.ok) setNotice(SAVE_FAILED);
      else if (result.shed) {
        setNotice(
          `Storage was full — dropped unused caption options on ${result.shed} clip${
            result.shed === 1 ? "" : "s"
          } to keep your captions.`,
        );
      } else setNotice(null);

      if (touchedKey === QUICK_KEY) writeSessionProjection(result.queue);
    },
    [adopt],
  );

  const mutate = useCallback(
    (key: string, fn: (p: BlastPost) => BlastPost) => {
      commit(updatePost(queueRef.current, key, fn), key);
    },
    [commit],
  );

  /**
   * Status moves forward only. `explicit` is for the two the user chooses
   * outright — posted and skipped — which are set rather than bumped.
   */
  const setStatus = useCallback(
    (key: string, platform: string, next: PostStatus, explicit = false) => {
      mutate(key, (p) => ({
        ...p,
        status: { ...p.status, [platform]: explicit ? next : bumpStatus(p.status[platform], next) },
      }));
    },
    [mutate],
  );

  /**
   * Reset clears the Quick post only — a queued batch is the user's work, not
   * session scratch. The transcript goes too: the user asked for a clean slate,
   * and carrying it forward is not that.
   */
  const reset = useCallback(() => {
    const next = resetQuick(queueRef.current);
    const result = saveQueue(next);
    adopt(result.queue);
    setNotice(result.ok ? null : SAVE_FAILED);
    writeSessionProjection(result.queue, "");
  }, [adopt]);

  const remove = useCallback(
    (key: string) => {
      // The queue syncs, so a delete needs a tombstone or the next merge with
      // a device that still has the clip brings it straight back — legacy
      // learned this the hard way and says so at blast/app.js:885. The port
      // read `blastClip` tombstones in the merge engine but never wrote one.
      tombstone("blastClip", key);
      commit(removePost(queueRef.current, key), null);
      setActiveKey((k) => (k === key ? QUICK_KEY : k));
    },
    [commit],
  );

  /**
   * Clear every queued clip, keeping Quick. Legacy's `#queueClear`
   * (blast/app.js:2104) had no port at all — a creator who batch-sent 24
   * clips from RECALL could only remove them one at a time.
   *
   * Tombstones each key for the same reason `remove` does.
   */
  const clearQueue = useCallback(() => {
    const doomed = queueRef.current.clips.filter((p) => p.key !== QUICK_KEY);
    if (!doomed.length) return;
    for (const p of doomed) tombstone("blastClip", p.key);
    commit(
      { ...queueRef.current, clips: queueRef.current.clips.filter((p) => p.key === QUICK_KEY) },
      null,
    );
    setActiveKey(QUICK_KEY);
  }, [commit]);

  const setBatchCount = useCallback(
    (n: number) => {
      try {
        writeBatchCount(n);
      } catch {
        // Legacy catches this too (blast/app.js:436). Say so rather than
        // throwing past the click handler and leaving the radio silently wrong.
        setNotice(SAVE_FAILED);
        return;
      }
      // Re-save so the blob's copy — the one that rides along on sync — agrees
      // with the setting that just changed.
      commit(queueRef.current, null);
    },
    [commit],
  );

  const setDefaultPlatforms = useCallback(
    (names: string[] | null) => {
      commit({ ...queueRef.current, defaultPlatforms: names }, null);
    },
    [commit],
  );

  const active = queue.clips.find((p) => p.key === activeKey) ?? queue.clips[0]!;

  return {
    queue,
    activeKey,
    active,
    notice,
    clearNotice: () => setNotice(null),
    setActiveKey,
    mutate,
    setStatus,
    reset,
    remove,
    clearQueue,
    setBatchCount,
    setDefaultPlatforms,
  };
}
