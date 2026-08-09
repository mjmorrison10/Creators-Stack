/**
 * BLAST shapes, transcribed from blast/app.js.
 *
 * Two timestamp conventions live side by side in this stack: BLAST uses
 * ms-epoch numbers (createdAt/updatedAt), HOOKLAB uses ISO strings. The merge
 * engine has separate comparators per type — do not normalize one to the other.
 */

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

export type Platform = (typeof PLATFORMS)[number];

/** Forward-only: a clip never moves backwards through these. */
export type PostStatus = "none" | "copied" | "opened" | "posted" | "skipped";

export const STATUS_ORDER: Record<PostStatus, number> = {
  none: 0,
  copied: 1,
  opened: 2,
  posted: 3,
  skipped: 3,
};

/** A Pinterest suggestion carries a title; every other platform is a string. */
export type CaptionSuggestion = string | { title: string; description: string };

/**
 * One queued clip. `key` is the merge identity — "quick" is reserved for the
 * permanent Quick clip, everything else is assigned by RECALL.
 */
export interface BlastClip {
  key: string;
  srcId?: string;
  srcTitle?: string;
  t?: string;
  sec?: number;
  /** Base caption. */
  text: string;
  hookText?: string;
  label?: string;
  /** null means "fall back to the queue default", which means all platforms. */
  platforms: string[] | null;
  patternId?: string;
  patternName?: string;
  patternFamily?: string;
  captions: Record<string, string>;
  titles: Record<string, string>;
  suggestions: Record<string, CaptionSuggestion[]>;
  picked: Record<string, number>;
  status: Record<string, PostStatus>;
  postUrl: Record<string, string>;
  postedAt: Record<string, number>;
  postedCaption: Record<string, string>;
  genState?: string;
  genError?: string;
  source?: "quick" | "recall";
  /** ms epoch. */
  createdAt: number;
  /** ms epoch. */
  updatedAt: number;
}

/** `blast_queue_v1` — the source of truth, and what syncs. */
export interface BlastQueue {
  v: 1;
  updatedAt: number;
  defaultPlatforms: string[] | null;
  batchCount?: 1 | 2 | 3;
  clips: BlastClip[];
}

/**
 * `blast_session_v1` — a one-way projection of the Quick clip, and a public
 * contract PULSE reads. Deliberately excluded from sync: it is re-stamped on
 * every keystroke, so a device sitting on a stale clip used to win newest-wins
 * merges and clobber real work. The queue syncs instead and each device
 * rebuilds its own projection.
 *
 * `transcript` exists only here — never in the queue, never in a sync payload.
 */
export interface BlastSession {
  base: string;
  videoHook: string;
  transcript: string;
  captions: Record<string, string>;
  titles: Record<string, string>;
  suggestions: Record<string, CaptionSuggestion[]>;
  picked: Record<string, number>;
  status: Record<string, PostStatus>;
  postUrl: Record<string, string>;
  postedAt: Record<string, number>;
  postedCaption: Record<string, string>;
  updatedAt: number;
}

/** Per-platform template containing a `{caption}` token. */
export type BlastPresets = Record<string, string>;

export interface BlastSettings {
  provider: "gemini" | "openrouter";
  geminiKey: string;
  openrouterKey: string;
  openrouterModel: string;
}

/** RECALL's write-once inbox, consumed and deleted by BLAST. */
export interface BlastHandoff {
  caption: string;
  source?: string;
  createdAt?: number;
}

/** Advisory caption limits per platform (blast/app.js PLATFORM_RULES). */
export const PLATFORM_RULES: Record<string, { limit: number; hashtagMax: number }> = {
  "YouTube Shorts": { limit: 100, hashtagMax: 3 },
  TikTok: { limit: 2200, hashtagMax: 5 },
  "Instagram Reels": { limit: 2200, hashtagMax: 5 },
  "Snapchat Spotlight": { limit: 80, hashtagMax: 3 },
  "Facebook Reels": { limit: 2200, hashtagMax: 3 },
  X: { limit: 280, hashtagMax: 2 },
  Threads: { limit: 500, hashtagMax: 3 },
  LinkedIn: { limit: 3000, hashtagMax: 3 },
  Pinterest: { limit: 500, hashtagMax: 3 },
};
