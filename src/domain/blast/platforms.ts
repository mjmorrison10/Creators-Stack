/**
 * BLAST's platform table and caption rules. Ported from blast/app.js.
 *
 * Platforms are identified by their display NAME, not an id — every persisted
 * map in `blast_queue_v1` and `blast_session_v1` (captions, status, postUrl,
 * postedAt…) is keyed by these exact strings, and PULSE reads them. Renaming
 * one here orphans a user's captions and posting history for that platform.
 */

export interface Platform {
  icon: string;
  name: string;
  url: string;
  note?: string;
}

export const PLATFORMS: readonly Platform[] = [
  { icon: "▶️", name: "YouTube Shorts", url: "https://www.youtube.com/upload" },
  { icon: "🎵", name: "TikTok", url: "https://www.tiktok.com/upload" },
  { icon: "📷", name: "Instagram Reels", url: "https://www.instagram.com/", note: "app recommended" },
  { icon: "👻", name: "Snapchat Spotlight", url: "https://www.snapchat.com/", note: "app recommended" },
  { icon: "📘", name: "Facebook Reels", url: "https://www.facebook.com/reels/create", note: "app recommended" },
  { icon: "✖️", name: "X", url: "https://x.com/compose/post" },
  { icon: "🧵", name: "Threads", url: "https://www.threads.net/" },
  { icon: "💼", name: "LinkedIn", url: "https://www.linkedin.com/post/new/" },
  { icon: "📌", name: "Pinterest", url: "https://www.pinterest.com/pin-builder/" },
] as const;

export const PLATFORM_NAMES: readonly string[] = PLATFORMS.map((p) => p.name);

export interface PlatformRules {
  /** Practical caption character cap. */
  limit: number;
  /** Recommended ceiling, never enforced. */
  hashtagMax: number;
}

/**
 * Soft validation only — these drive a live counter and warnings, never a hard
 * block, because the platforms themselves move these numbers and a stale cap
 * should not stop someone posting.
 *
 * Two are deliberately not the number you'd find in the platform's docs:
 * YouTube Shorts caps the *title* (the text under a Short) at 100 — the
 * 5000-char description is a separate box BLAST doesn't model, so 100 is the
 * limiting field. Snapchat Spotlight captions are a short overlay, so 80 is a
 * conservative cap rather than a documented one.
 */
export const PLATFORM_RULES: Record<string, PlatformRules> = {
  "YouTube Shorts": { limit: 100, hashtagMax: 3 },
  TikTok: { limit: 2200, hashtagMax: 5 },
  "Instagram Reels": { limit: 2200, hashtagMax: 10 },
  "Snapchat Spotlight": { limit: 80, hashtagMax: 3 },
  "Facebook Reels": { limit: 2200, hashtagMax: 5 },
  X: { limit: 280, hashtagMax: 2 },
  Threads: { limit: 500, hashtagMax: 3 },
  LinkedIn: { limit: 3000, hashtagMax: 5 },
  Pinterest: { limit: 500, hashtagMax: 5 },
};

export const DEFAULT_RULES: PlatformRules = { limit: 2200, hashtagMax: 10 };

export type LengthPref = "short" | "medium" | "long";

/**
 * Target caption lengths per platform, in characters, for the Short/Medium/Long
 * preference. The hard cap always comes from PLATFORM_RULES and is never
 * exceeded — these only steer the model within it.
 *
 * Snapchat stays short at every setting (it is a tiny overlay) and YouTube's
 * cap dominates because it is the visible Short title.
 */
export const LENGTH_TARGETS: Record<string, Record<LengthPref, string>> = {
  "YouTube Shorts": { short: "under 50", medium: "60-90", long: "90-100" },
  TikTok: { short: "under 100", medium: "150-300", long: "400-700" },
  "Instagram Reels": { short: "under 125", medium: "300-600", long: "900-1500" },
  "Snapchat Spotlight": { short: "under 40", medium: "under 80", long: "under 80" },
  "Facebook Reels": { short: "under 100", medium: "200-400", long: "700-1200" },
  X: { short: "under 120", medium: "180-260", long: "260-280" },
  Threads: { short: "under 120", medium: "200-350", long: "400-500" },
  LinkedIn: { short: "under 200", medium: "400-800", long: "1200-2000" },
  Pinterest: { short: "under 120", medium: "200-350", long: "400-500" },
};

export function rulesFor(name: string): PlatformRules {
  return PLATFORM_RULES[name] ?? DEFAULT_RULES;
}

export function platformByName(name: string): Platform | undefined {
  return PLATFORMS.find((p) => p.name === name);
}

// ── caption validation ──────────────────────────────────────────────────

export interface CaptionCheck {
  length: number;
  limit: number;
  over: number;
  hashtags: number;
  hashtagMax: number;
  /** True when the caption exceeds the cap — a warning, never a block. */
  tooLong: boolean;
  tooManyHashtags: boolean;
}

export function countHashtags(text: string): number {
  return (String(text).match(/(^|\s)#[^\s#]+/g) || []).length;
}

export function checkCaption(name: string, text: string): CaptionCheck {
  const rules = rulesFor(name);
  const length = String(text).length;
  const hashtags = countHashtags(text);
  return {
    length,
    limit: rules.limit,
    over: Math.max(0, length - rules.limit),
    hashtags,
    hashtagMax: rules.hashtagMax,
    tooLong: length > rules.limit,
    tooManyHashtags: hashtags > rules.hashtagMax,
  };
}

// ── posting status ──────────────────────────────────────────────────────

export type PostStatus = "none" | "copied" | "opened" | "posted" | "skipped";

export const STATUS_ORDER: Record<PostStatus, number> = {
  none: 0,
  copied: 1,
  opened: 2,
  posted: 3,
  skipped: 3,
};

export const STATUS_LABEL: Record<PostStatus, string> = {
  none: "Not started",
  copied: "Caption copied",
  opened: "Upload opened",
  posted: "Posted",
  skipped: "Skipped",
};

/**
 * Status only ever moves forward. Copying a caption after you have already
 * posted must not knock the platform back to "copied", and `posted`/`skipped`
 * are terminal — they are set explicitly, never bumped into or out of.
 *
 * The strict `>` and the terminal-name check are redundant with each other as
 * the table stands: `posted` and `skipped` both sit at 3, which is the maximum,
 * so `>` alone already blocks every transition out of them. Both are kept —
 * mutation testing confirmed that removing either alone changes nothing but
 * removing both lets a posted platform silently become "skipped". The name
 * check is what still holds if a status above 3 is ever added.
 *
 * Returns the status that should be stored, so callers stay immutable.
 */
export function bumpStatus(current: PostStatus | undefined, next: PostStatus): PostStatus {
  const cur = current || "none";
  if (STATUS_ORDER[next] > STATUS_ORDER[cur] && cur !== "posted" && cur !== "skipped") {
    return next;
  }
  return cur;
}

/** Explicit set, for the two terminal states the user chooses directly. */
export function setStatus(next: PostStatus): PostStatus {
  return next;
}
