/**
 * Checkpoint math, readings, and the display formatters.
 *
 * Ported from pulse/app.js (~lines 190-256). All pure — `recordSnapshot`
 * returns a new post rather than pushing into one, so the caller owns
 * persistence and the repo's immutability rule holds.
 */

import { CHECKPOINTS, type PulsePost, type Snapshot } from "../../data/schemas/pulse";

/** The nine platforms PULSE tracks, in display order. Order is significant. */
export const PLATFORMS = [
  "YouTube Shorts",
  "TikTok",
  "Instagram Reels",
  "Snapchat Spotlight",
  "Facebook Reels",
  "X",
  "Threads",
  "LinkedIn",
  "Pinterest",
] as const;

export function ckLabel(h: number): string {
  return h < 24 ? `${h}h` : `${h / 24}d`;
}

/** `-1` when nothing has been read yet, so checkpoint 0 would still be due. */
export function maxCovered(post: PulsePost): number {
  const s = post.snapshots || [];
  return s.length ? Math.max(...s.map((x) => x.elapsedMin)) : -1;
}

/**
 * The next checkpoint owed, or null.
 *
 * A single late reading covers EVERY checkpoint at or below its elapsed time —
 * there is no backfilling, because a reading taken at 30h genuinely tells you
 * nothing about what the 1h number was.
 */
export function nextDue(post: PulsePost, now: number): number | null {
  const covered = maxCovered(post);
  for (const h of CHECKPOINTS) {
    const hMin = h * 60;
    if (now >= post.postedAt + hMin * 60000 && hMin > covered) return h;
  }
  return null;
}

/**
 * The last element — which is the LARGEST-elapsed reading, not necessarily the
 * most recently taken, because the array is sorted by `elapsedMin`.
 */
export function latestSnap(post: PulsePost): Snapshot | null {
  const s = post.snapshots || [];
  return s.length ? s[s.length - 1]! : null;
}

/**
 * Views per hour across the last two readings. Null under two readings or when
 * they share an elapsed time; can go negative if a later reading is lower
 * (platforms do revise counts down).
 */
export function velocityPerHr(post: PulsePost): number | null {
  const s = post.snapshots || [];
  if (s.length < 2) return null;
  const a = s[s.length - 2]!;
  const b = s[s.length - 1]!;
  const dt = (b.elapsedMin - a.elapsedMin) / 60;
  if (dt <= 0) return null;
  return Math.round((b.views - a.views) / dt);
}

export interface ReadingInput {
  views: number;
  likes?: number | null;
  comments?: number | null;
}

/**
 * Record a reading, returning a new post.
 *
 * Deliberately does NOT dedupe on `elapsedMin`: two readings in the same minute
 * produce two entries, exactly as legacy. `healImportTwins` is the only place
 * that collapses them, and only across merged twins. Changing that here would
 * alter what a merge later sees.
 *
 * `likes`/`comments` become null unless actually supplied — a manual entry
 * records views only, and storing 0 there would claim a measurement nobody took.
 */
export function recordSnapshot(
  post: PulsePost,
  data: ReadingInput,
  source: "auto" | "manual",
  now = Date.now(),
): PulsePost {
  const snap: Snapshot = {
    at: now,
    elapsedMin: Math.max(0, Math.round((now - post.postedAt) / 60000)),
    views: Number(data.views) || 0,
    likes: data.likes != null ? Number(data.likes) : null,
    comments: data.comments != null ? Number(data.comments) : null,
    source,
  };
  return {
    ...post,
    snapshots: [...(post.snapshots || []), snap].sort((a, b) => a.elapsedMin - b.elapsedMin),
  };
}

/**
 * Views move in orders of magnitude — step ~1% of scale so ± is useful at 300
 * views and at 300k.
 */
export function stepFor(v: unknown): number {
  const n = Number(v) || 0;
  return n < 100 ? 1 : n < 1000 ? 10 : n < 10000 ? 100 : 1000;
}

export function fmtNum(v: unknown): string {
  const n = Number(v) || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
}

export function relTime(ms: number, now = Date.now()): string {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function inHours(ms: number, now = Date.now()): string {
  const d = ms - now;
  const h = d / 3600000;
  if (h < 1) return `in ${Math.max(1, Math.round(d / 60000))}m`;
  if (h < 48) return `in ${Math.round(h)}h`;
  return `in ${Math.round(h / 24)}d`;
}

/** Which platform a pasted link belongs to, or null when it isn't recognized. */
export function platformForUrl(url: string): string | null {
  const u = String(url || "").toLowerCase();
  if (!u) return null;
  if (/youtube\.com|youtu\.be/.test(u)) return "YouTube Shorts";
  if (/tiktok\.com/.test(u)) return "TikTok";
  if (/instagram\.com/.test(u)) return "Instagram Reels";
  if (/snapchat\.com/.test(u)) return "Snapchat Spotlight";
  if (/facebook\.com|fb\.watch/.test(u)) return "Facebook Reels";
  if (/(^|\/\/)(x|twitter)\.com/.test(u)) return "X";
  if (/threads\.net/.test(u)) return "Threads";
  if (/linkedin\.com/.test(u)) return "LinkedIn";
  if (/pinterest\./.test(u)) return "Pinterest";
  return null;
}

/**
 * Which platforms the manual-add form offers, in precedence order.
 *
 * These used to be derived live from BLAST on every sync, which silently
 * un-ticked choices the creator had made. They are a STORED preference now —
 * including the empty list, which is why the first branch checks for an array
 * rather than for truthiness.
 */
export function runningPlatforms(
  stored: string[] | null,
  trackedPlatforms: string[],
  presetNames: string[],
): string[] {
  const known = new Set<string>(PLATFORMS);
  if (Array.isArray(stored)) {
    const picked = stored.filter((n) => known.has(n));
    if (picked.length) return PLATFORMS.filter((n) => picked.includes(n));
  }
  const tracked = PLATFORMS.filter((n) => trackedPlatforms.includes(n));
  if (tracked.length) return [...tracked];
  const presets = PLATFORMS.filter((n) => presetNames.includes(n));
  if (presets.length) return [...presets];
  return [...PLATFORMS];
}
