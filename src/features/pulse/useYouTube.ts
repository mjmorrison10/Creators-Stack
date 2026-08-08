import { useCallback, useRef, useState } from "react";
import type { PulsePost } from "../../data/schemas/pulse";
import { nextDue } from "../../domain/pulse/snapshots";
import { fetchYouTubeStats, ytId } from "../../services/youtube";
import type { usePulse } from "./usePulse";

export function isYouTube(post: PulsePost): boolean {
  return /youtu\.?be|youtube\.com/i.test(post.url) || post.platform === "YouTube Shorts";
}

export interface YtStatus {
  tone: "ok" | "error";
  text: string;
}

/**
 * The only network call PULSE makes.
 *
 * "Auto" means event-driven, not scheduled: there is no timer anywhere. Checks
 * fire on boot, after an import, after a key is saved, when a link is pasted,
 * and when the creator asks — and only for posts that are actually DUE, so a
 * library of two hundred posts doesn't burn two hundred units of quota to learn
 * nothing.
 *
 * `loud` controls the running commentary, NOT the errors: a quiet check that
 * fails still reports, because silence would be indistinguishable from
 * "nothing was due".
 */
export function useYouTube(pulse: ReturnType<typeof usePulse>) {
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const lastError = useRef("");

  const checkOne = useCallback(
    async (post: PulsePost, loud: boolean): Promise<boolean> => {
      const key = pulse.settingsRef.current.ytKey;
      if (!key) {
        if (loud) {
          setStatus({ tone: "error", text: "Add a YouTube API key in Settings to auto-track." });
        }
        return false;
      }
      const id = ytId(post.url);
      if (!id) {
        if (loud) setStatus({ tone: "error", text: "Couldn't read a video id from that URL." });
        return false;
      }
      try {
        const stats = await fetchYouTubeStats(id, key);
        pulse.record(post.id, stats, "auto");
        if (loud) setStatus({ tone: "ok", text: "Updated from YouTube." });
        return true;
      } catch (e) {
        // Recorded even when quiet — the batch summary needs the reason.
        lastError.current = e instanceof Error ? e.message : "YouTube check failed";
        if (loud) setStatus({ tone: "error", text: lastError.current });
        return false;
      }
    },
    [pulse],
  );

  const checkDue = useCallback(
    async (loud: boolean): Promise<void> => {
      const key = pulse.settingsRef.current.ytKey;
      if (!key) {
        if (loud) setStatus({ tone: "error", text: "Add a YouTube API key in Settings first." });
        return;
      }
      const now = Date.now();
      const due = pulse.postsRef.current.filter(
        (p) => isYouTube(p) && ytId(p.url) && nextDue(p, now) != null,
      );
      if (!due.length) {
        if (loud) {
          setStatus({ tone: "ok", text: "No YouTube posts are due for a check right now." });
        }
        return;
      }

      setBusy(true);
      lastError.current = "";
      let ok = 0;
      try {
        // Sequential on purpose: parallel requests against one API key trip
        // rate limiting, and the whole point is to come back with numbers.
        for (const [i, p] of due.entries()) {
          if (loud) setStatus({ tone: "ok", text: `Checking ${i + 1}/${due.length}…` });
          if (await checkOne(p, false)) ok++;
        }
      } finally {
        setBusy(false);
      }

      const failed = due.length - ok;
      if (failed) {
        setStatus({
          tone: "error",
          text: `${ok} updated, ${failed} failed: ${lastError.current}`,
        });
      } else if (loud) {
        setStatus({ tone: "ok", text: `${ok} updated.` });
      }
    },
    [checkOne, pulse],
  );

  return { status, busy, checkOne, checkDue, clearStatus: () => setStatus(null) };
}
