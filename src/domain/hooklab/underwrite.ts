/**
 * Hook underwriting — ported from Hooklabs/app.js lines 207-350, 470-510.
 *
 * The product rule this file exists to enforce: HOOKLAB *underwrites*, it does
 * not invent virality. Personal ledger evidence outranks market comps, which
 * outrank generic pattern strength, and a percentage is never shown unless it
 * was actually measured. That hierarchy is expressed in the weights below and
 * in the badge ladder — changing either changes what the product claims.
 *
 * This logic lives in a DOM-coupled IIFE in the original, so it cannot be
 * imported for a differential test the way the pattern bank could. Instead the
 * numbers are pinned as executable tests.
 */

import {
  ANGLES,
  OUTCOME_SCORE,
  PATTERNS,
  mediumForPlatform,
  type Pattern,
} from "./patterns";
import type { LedgerEntry, Medium } from "../../data/schemas/hooklab";

/** Default when the ledger has nothing to say about a family. */
const NEUTRAL_PERSONAL = 0.5;
/** Score used for an entry whose outcome is unrecognized. */
const UNKNOWN_OUTCOME_SCORE = 0.45;

export interface FamilyStat {
  wins: number;
  total: number;
  recentHooks: string[];
  scoreSum: number;
}

export function entryMedium(e: LedgerEntry): string {
  return e.medium || mediumForPlatform(e.platform ?? "");
}

/** Per-family performance from the user's own ledger, optionally by medium. */
export function familyStats(
  ledger: LedgerEntry[],
  medium?: Medium | string,
): Record<string, FamilyStat> {
  const map: Record<string, FamilyStat> = {};
  for (const e of ledger) {
    if (medium && entryMedium(e) !== medium) continue;
    const fam = e.family || "unknown";
    const stat = (map[fam] ??= { wins: 0, total: 0, recentHooks: [], scoreSum: 0 });
    stat.total++;
    stat.scoreSum += OUTCOME_SCORE[e.outcome] ?? UNKNOWN_OUTCOME_SCORE;
    if (e.outcome === "winner") stat.wins++;
    if (stat.recentHooks.length < 8) stat.recentHooks.push(e.hook);
  }
  return map;
}

/** Token-set similarity, used to spot a hook that echoes a market comp. */
export function jaccard(a: string, b: string): number {
  const ta = new Set(String(a).toLowerCase().split(/\W+/).filter(Boolean));
  const tb = new Set(String(b).toLowerCase().split(/\W+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * How hard the user has leaned on this family lately. Looks only at the last 10
 * entries — repeating a structure works until the audience notices, so recency
 * is what matters, not lifetime totals.
 */
export function fatigueScore(
  ledger: LedgerEntry[],
  patternId: string,
  family: string,
): number {
  const recent = ledger.slice(0, 10);
  const hits = recent.filter((e) => e.patternId === patternId || e.family === family).length;
  if (hits >= 3) return 1; // fatigued
  if (hits === 2) return 0.55;
  if (hits === 1) return 0.25;
  return 0;
}

/**
 * Rewards concreteness and penalizes marketing filler. A specific claim is
 * checkable; "game-changer" is not.
 */
export function specificityScore(text: string): number {
  let s = 0;
  if (/\d/.test(text)) s += 0.35;
  if (/\b(I|my|we)\b/i.test(text)) s += 0.15;
  if (text.split(/\s+/).length <= 16) s += 0.15;
  if (/[?]/.test(text)) s += 0.1;
  if (!/\b(amazing|incredible|game[- ]?changer|unlock|revolutionary)\b/i.test(text)) s += 0.15;
  return Math.min(1, s);
}

export function tierBoost(tier: string): number {
  if (tier === "core") return 0.12;
  if (tier === "historical") return 0.06;
  if (tier === "extended") return 0.0;
  return 0;
}

export interface ScoredPattern {
  pattern: Pattern;
  score: number;
  /** null means the ledger has no history for this family — never render 0%. */
  winRate: number | null;
  fatigue: number;
  personal: number;
  compMatch?: string;
  grounding?: string;
}

export interface SelectOptions {
  preferCore?: boolean;
  poolLimit?: number;
}

/** Weights. Personal ledger evidence carries the most, by design. */
export const WEIGHTS = {
  strength: 0.26,
  personal: 0.32,
  niche: 0.12,
  platform: 0.09,
  angle: 0.12,
  histBonus: 0.04,
  fatiguePenalty: 0.35,
  extendedPenalty: 0.04,
} as const;

export const SELECTION = {
  poolLimit: 20,
  maxCore: 12,
  maxHistorical: 4,
  maxExtended: 8,
  maxPerFamily: 2,
  /** The final coverage pass relaxes the per-family cap. */
  maxPerFamilyFallback: 3,
} as const;

export function selectPatterns(
  ledger: LedgerEntry[],
  niche: string,
  platform: string,
  angleIds: string[] = [],
  opts: SelectOptions = {},
): ScoredPattern[] {
  const preferCore = opts.preferCore !== false;
  // ?? not ||, so an explicit poolLimit of 0 means zero rather than silently
  // falling back to the default.
  const poolLimit = opts.poolLimit ?? SELECTION.poolLimit;

  let allowedFamilies: Record<string, boolean> | null = null;
  if (angleIds.length) {
    allowedFamilies = {};
    for (const a of ANGLES) {
      if (angleIds.includes(a.id)) {
        for (const f of a.patternFamilies) allowedFamilies[f] = true;
      }
    }
  }

  const medium = mediumForPlatform(platform);
  const stats = familyStats(ledger, medium);

  // Hard filter: a video scaffold is not a text post, so medium is not a score.
  const pool = PATTERNS.filter((p) => (p.mediums ?? ["video", "text"]).includes(medium as Medium));

  const scored: ScoredPattern[] = pool.map((p) => {
    const nicheFit = !p.niches || p.niches.includes(niche) || p.niches.includes("general") ? 1 : 0.35;
    const platformFit = !p.platforms || p.platforms.includes(platform) ? 1 : 0.5;
    const angleFit =
      !allowedFamilies || allowedFamilies[p.family] || allowedFamilies[p.mechanism] ? 1 : 0.15;

    const fam = stats[p.family] ?? stats[p.mechanism];
    let personal = NEUTRAL_PERSONAL;
    let winRate: number | null = null;
    if (fam && fam.total > 0) {
      winRate = fam.wins / fam.total;
      personal = fam.scoreSum / fam.total;
    }

    const fatigue = fatigueScore(ledger, p.id, p.family);
    const histBonus = p.evidence === "historically-documented" ? WEIGHTS.histBonus : 0;

    let score =
      p.strength * WEIGHTS.strength +
      personal * WEIGHTS.personal +
      nicheFit * WEIGHTS.niche +
      platformFit * WEIGHTS.platform +
      angleFit * WEIGHTS.angle +
      (preferCore ? tierBoost(p.tier) : 0) +
      histBonus -
      fatigue * WEIGHTS.fatiguePenalty;

    // Soft-penalize extended so core dominates unless angle/niche demands depth.
    if (preferCore && p.tier === "extended") score -= WEIGHTS.extendedPenalty;

    return { pattern: p, score, winRate, fatigue, personal };
  });

  scored.sort((a, b) => b.score - a.score);

  const picked: ScoredPattern[] = [];
  const familyCount: Record<string, number> = {};
  const tierCount: Record<string, number> = { core: 0, extended: 0, historical: 0 };

  const tryPick = (item: ScoredPattern, maxPerFamily: number, maxTier: number | null): boolean => {
    const famName = item.pattern.family;
    const tier = item.pattern.tier || "core";
    familyCount[famName] ??= 0;
    if (familyCount[famName]! >= maxPerFamily) return false;
    if (maxTier != null && (tierCount[tier] ?? 0) >= maxTier) return false;
    familyCount[famName]!++;
    tierCount[tier] = (tierCount[tier] ?? 0) + 1;
    picked.push(item);
    return true;
  };

  // Four passes, in this order, so the daily drivers lead and depth fills in.
  // The poolLimit guard is an addition to the legacy loop, which could overrun
  // a caller-supplied limit below 12 because only later passes checked it.
  for (
    let i = 0;
    i < scored.length && (tierCount.core ?? 0) < SELECTION.maxCore && picked.length < poolLimit;
    i++
  ) {
    if (scored[i]!.pattern.tier === "core") tryPick(scored[i]!, SELECTION.maxPerFamily, SELECTION.maxCore);
  }
  for (
    let h = 0;
    h < scored.length && (tierCount.historical ?? 0) < SELECTION.maxHistorical && picked.length < poolLimit;
    h++
  ) {
    if (scored[h]!.pattern.tier === "historical") {
      tryPick(scored[h]!, SELECTION.maxPerFamily, SELECTION.maxHistorical);
    }
  }
  for (let e = 0; e < scored.length && picked.length < poolLimit; e++) {
    if (scored[e]!.pattern.tier === "extended") {
      tryPick(scored[e]!, SELECTION.maxPerFamily, SELECTION.maxExtended);
    }
  }
  if (picked.length < Math.min(12, poolLimit)) {
    for (let j = 0; j < scored.length && picked.length < poolLimit; j++) {
      if (!picked.includes(scored[j]!)) tryPick(scored[j]!, SELECTION.maxPerFamilyFallback, 99);
    }
  }

  picked.sort((a, b) => b.score - a.score);
  return picked;
}

export type BadgeStatus = "fatigued" | "proven" | "market" | "hypo";

/**
 * The provenance ladder, checked in order. "Proven" requires the user's OWN
 * ledger to back it — market strength alone can never earn that word, which is
 * the whole difference between underwriting and hype.
 */
export function statusFor(item: ScoredPattern): BadgeStatus {
  if (item.fatigue >= 1) return "fatigued";
  if (item.winRate != null && item.winRate >= 0.5 && item.personal >= 0.6) return "proven";
  if (item.winRate != null && item.personal >= 0.45) return "market"; // personal signal, mixed
  if (item.pattern && item.pattern.strength >= 0.8) return "market";
  return "hypo";
}

/**
 * Always states the real win rate, or says plainly that there is none. Never
 * renders a percentage that wasn't measured.
 */
export function evidenceLine(item: ScoredPattern, topic?: string): string {
  const parts: string[] = [];
  if (item.winRate != null) {
    parts.push(
      `Personal win rate on this family: ${Math.round(item.winRate * 100)}% across ledger entries.`,
    );
  } else {
    parts.push("No personal history yet for this family — ranked as market structure.");
  }
  if (item.compMatch) parts.push(`Similar to market comp: “${item.compMatch}”.`);
  if (item.grounding) parts.push(`Grounded in your brief/source: ${item.grounding}`);
  else if (topic) parts.push("Tied to topic brief.");
  if (item.fatigue >= 1) {
    parts.push("You've used this family heavily in recent posts — fatigue risk.");
  }
  parts.push(`Pattern why: ${item.pattern.why}`);
  return parts.join(" ");
}

/** Below this, a group's win rate is not reported at all. */
export const MIN_INSIGHT_SAMPLE = 3;

export interface InsightRow {
  key: string;
  wins: number;
  total: number;
  winRate: number;
}

/**
 * Win-rate tables, grouped by whatever key the caller picks.
 *
 * Groups with fewer than three entries are omitted entirely, and `total` is
 * always returned so the UI can show the n. Reporting "100%" off a single post
 * would be the fake-percentage the product explicitly refuses to show.
 */
export function insightRows(
  ledger: LedgerEntry[],
  keyOf: (e: LedgerEntry) => string | undefined,
): InsightRow[] {
  const groups: Record<string, { wins: number; total: number }> = {};
  for (const e of ledger) {
    const k = keyOf(e);
    if (!k) continue;
    const g = (groups[k] ??= { wins: 0, total: 0 });
    g.total++;
    if (e.outcome === "winner") g.wins++;
  }
  return Object.entries(groups)
    .filter(([, g]) => g.total >= MIN_INSIGHT_SAMPLE)
    .map(([key, g]) => ({ key, wins: g.wins, total: g.total, winRate: g.wins / g.total }))
    .sort((a, b) => b.winRate - a.winRate || b.total - a.total);
}
