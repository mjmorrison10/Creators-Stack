/**
 * PULSE shapes, transcribed from pulse/app.js.
 */

import type { Outcome } from "./hooklab";

/** Hours after posting at which a check-in is due. */
export const CHECKPOINTS = [1, 2, 6, 24, 48, 168] as const;

/**
 * One reading. A reading covers every checkpoint at or below its actual
 * elapsed time — late reads are recorded honestly rather than backfilled.
 */
export interface Snapshot {
  /** ms epoch when the reading was taken. */
  at: number;
  elapsedMin: number;
  views: number;
  likes: number | null;
  comments: number | null;
  source: "auto" | "manual";
}

export interface PulsePost {
  /** "p_" + base36 random + base36 now. */
  id: string;
  platform: string;
  /** "" is valid — a post can be tracked before its link is known. */
  url: string;
  caption: string;
  /** Falls back to the caption's first line. */
  hook: string;
  /** ms epoch. */
  postedAt: number;
  /** Ascending by elapsedMin. */
  snapshots: Snapshot[];
  outcome: Outcome | null;
  ledgerLoggedAt: number | null;
  /** `${clipKey}|${platform}|${postedAt}`; quick clips keep a legacy unscoped form. */
  blastKey?: string;
  /** Clip-level identity: the hook, else BLAST's base caption. */
  clipKey?: string;
  /** Canonical per-clip id — one BLAST import produces one clipId. */
  clipId?: string;
  /** Kept when healing merges clips, so the change stays reversible. */
  clipIdPrev?: string;
  patternId?: string;
  patternName?: string;
  patternFamily?: string;
}

export interface PulseSettings {
  ytKey: string;
  view: "clips" | "platforms";
  platforms: string[] | null;
}

/** PULSE's export envelope — no format or version marker, unlike the others. */
export interface PulseExport {
  posts: PulsePost[];
  exportedAt: string;
}

/** Platforms whose posts are text rather than video. */
export const TEXT_PLATFORMS = new Set(["X", "Threads", "LinkedIn", "Pinterest"]);

export function mediumForPlatform(platform: string): "text" | "video" {
  return TEXT_PLATFORMS.has(platform) ? "text" : "video";
}

/**
 * Gates a hook must clear before PULSE promotes it into the HOOKLAB ledger on
 * its own. Deliberately conservative: an auto-promotion asserts evidence, and
 * the product rule is that a percentage is never invented.
 */
export const AUTO_PROMOTE = {
  MIN_SAMPLE: 8,
  TOP_PCT: 0.1,
  OUTLIER_MULT: 3,
  CROSS_MULT: 2,
  MIN_VIEWS: 10000,
  /** Token-Jaccard similarity above which two hooks count as the same. */
  HOOK_SIM: 0.55,
} as const;

export const HOOK_MAX = 300;
