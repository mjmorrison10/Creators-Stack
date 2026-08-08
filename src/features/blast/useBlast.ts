import { useCallback, useEffect, useState } from "react";
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

  // Another tab — or a still-deployed legacy BLAST — writing the queue should
  // show up here without a refresh.
  useEffect(() => subscribe(KEYS.blastQueue, () => setQueue(loadQueue())), []);

  // The projection is rebuilt from the clip on mount too, so a session left by
  // an older build (or synced while BLAST was closed) can never be what PULSE
  // imports.
  useEffect(() => {
    writeSessionProjection(loadQueue());
  }, []);

  const commit = useCallback((next: BlastQueue, touchedKey: string | null) => {
    const result = saveQueue(next);
    // Use the SAVED queue, not the one passed in: a shed actually dropped
    // suggestions, and carrying on with the pre-shed object would put them
    // straight back on the next write.
    setQueue(result.queue);
    if (!result.ok) setNotice(SAVE_FAILED);
    else if (result.shed) {
      setNotice(
        `Storage was full — dropped unused caption options on ${result.shed} clip${
          result.shed === 1 ? "" : "s"
        } to keep your captions.`,
      );
    } else setNotice(null);

    if (touchedKey === QUICK_KEY) writeSessionProjection(result.queue);
  }, []);

  const mutate = useCallback(
    (key: string, fn: (p: BlastPost) => BlastPost) => {
      setQueue((cur) => {
        const next = updatePost(cur, key, fn);
        commit(next, key);
        return next;
      });
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

  const reset = useCallback(() => {
    setQueue((cur) => {
      const next = resetQuick(cur);
      commit(next, QUICK_KEY);
      return next;
    });
  }, [commit]);

  const remove = useCallback(
    (key: string) => {
      setQueue((cur) => {
        const next = removePost(cur, key);
        commit(next, null);
        return next;
      });
      setActiveKey((k) => (k === key ? QUICK_KEY : k));
    },
    [commit],
  );

  const setBatchCount = useCallback(
    (n: number) => {
      writeBatchCount(n);
      // Re-save so the blob's copy — the one that rides along on sync — agrees
      // with the setting that just changed.
      setQueue((cur) => {
        commit(cur, null);
        return cur;
      });
    },
    [commit],
  );

  const setDefaultPlatforms = useCallback(
    (names: string[] | null) => {
      setQueue((cur) => {
        const next = { ...cur, defaultPlatforms: names };
        commit(next, null);
        return next;
      });
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
    setBatchCount,
    setDefaultPlatforms,
  };
}
