/**
 * YouTube stats — ported from pulse/app.js lines 259-300.
 *
 * The only network call PULSE makes. Used to auto-fill view counts at each
 * check-in so the user isn't retyping numbers off a phone screen.
 */

import { sleep } from "./llm/timeouts";

const STATS_URL = "https://www.googleapis.com/youtube/v3/videos";

/**
 * A hung fetch never rejects on its own — without a deadline the check-all loop
 * would stall forever on one dead request. 15s per attempt is generous for a
 * stats call that normally answers in under a second.
 */
const YT_TIMEOUT_MS = 15_000;
const YT_BACKOFF_MS = [3000, 9000];
const YT_MAX_ATTEMPTS = 3;

/** Extract a video id from any of YouTube's URL shapes. */
export function ytId(url: string): string | null {
  const m = String(url).match(
    /(?:youtube\.com\/(?:shorts|live|embed)\/|youtu\.be\/|[?&]v=)([\w-]{6,})/,
  );
  return m?.[1] ?? null;
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("YouTube request timed out — check your connection and try again");
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithRetry(make: () => Promise<Response>): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await make();
    if (!isRetryable(res.status) || attempt >= YT_MAX_ATTEMPTS) return res;
    await sleep(YT_BACKOFF_MS[attempt - 1] ?? 9000);
  }
}

export interface YouTubeStats {
  views: number;
  likes: number | null;
  comments: number | null;
}

export async function fetchYouTubeStats(id: string, key: string): Promise<YouTubeStats> {
  const url =
    `${STATS_URL}?part=statistics&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`;
  const res = await fetchWithRetry(() => fetchWithTimeout(url, YT_TIMEOUT_MS));

  if (!res.ok) {
    if (res.status === 400 || res.status === 403) {
      throw new Error("YouTube API key rejected or quota exhausted — check Settings");
    }
    throw new Error(`YouTube error ${res.status}`);
  }

  const j = (await res.json()) as {
    items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[];
  };
  const item = j.items?.[0];
  if (!item) throw new Error("Video not found (private, deleted, or wrong link)");

  const st = item.statistics ?? {};
  return {
    views: parseInt(st.viewCount ?? "0", 10),
    // null rather than 0: the creator can hide likes, and "hidden" is not "none".
    likes: st.likeCount != null ? parseInt(st.likeCount, 10) : null,
    comments: st.commentCount != null ? parseInt(st.commentCount, 10) : null,
  };
}
