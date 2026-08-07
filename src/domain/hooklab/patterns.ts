/**
 * Typed surface over the verbatim pattern bank in ./patterns.data.ts.
 *
 * The data file is a copy of the legacy patterns.js so a differential test can
 * prove it unchanged; this file gives it types without touching the values.
 */

import * as data from "./patterns.data";
import type { Medium, Outcome } from "../../data/schemas/hooklab";

/** What job a pattern does on the viewer. */
export interface Mechanism {
  id: string;
  name: string;
  job: string;
}

export type Tier = "core" | "text-native" | "extended" | "historical";
export type Evidence = "market-observed" | "documented" | "inferred" | string;

/**
 * A scaffold with slots — never a finished line. `strength` is the market-level
 * prior; personal ledger evidence outranks it at scoring time.
 */
export interface Pattern {
  id: string;
  name: string;
  family: string;
  mechanism: string;
  tier: Tier;
  scaffold: string;
  slots: string[];
  why: string;
  niches: string[];
  strength: number;
  platforms: string[];
  mediums: Medium[];
  evidence: Evidence;
  era: string;
  textOnScreen: boolean;
  spoken: boolean;
  relatedCore: string[];
}

/** A documented historical campaign, used as evidence rather than a candidate. */
export interface HistoricalInstance {
  id: string;
  title: string;
  year: string | number;
  patternIds: string[];
  mechanism: string;
  source: string;
  surface: string;
  mechanismNote: string;
  modernParallel: string;
  viability: string;
  wtfJob: string;
  risk: string;
}

export interface Angle {
  id: string;
  name: string;
  description: string;
  patternFamilies: string[];
}

export interface CtaPattern {
  id: string;
  name: string;
  scaffold: string;
  why: string;
  mediums: Medium[];
}

/** Note: these carry `label`, not `name` — the two conventions coexist. */
export interface Niche {
  id: string;
  label: string;
}

export interface HooklabPlatformDef {
  id: string;
  label: string;
  medium: Medium;
}

export interface MediumDef {
  id: Medium;
  label: string;
  icon: string;
}

/** `score`, not `weight` — winner 1.0, meh 0.45, dead 0.05. */
export interface OutcomeDef {
  id: Outcome;
  label: string;
  score: number;
  color: string;
}

export const MECHANISMS = data.MECHANISMS as Mechanism[];
export const PATTERNS = data.PATTERNS as Pattern[];
export const HISTORICAL_INSTANCES = data.HISTORICAL_INSTANCES as HistoricalInstance[];
export const ANGLES = data.ANGLES as Angle[];
export const CTA_PATTERNS = data.CTA_PATTERNS as CtaPattern[];
export const NICHES = data.NICHES as Niche[];
export const PLATFORMS = data.PLATFORMS as HooklabPlatformDef[];
export const MEDIUMS = data.MEDIUMS as Record<Medium, MediumDef>;
export const EVIDENCE_LABELS = data.EVIDENCE_LABELS as Record<string, string>;
export const TIER_LABELS = data.TIER_LABELS as Record<string, string>;

/** Relative weight each outcome carries in the personal score. */
export const OUTCOMES = data.OUTCOMES as OutcomeDef[];

/** Outcome id → score, the form the scoring math actually wants. */
export const OUTCOME_SCORE: Record<string, number> = Object.fromEntries(
  OUTCOMES.map((o) => [o.id, o.score]),
);

export const mediumForPlatform = data.mediumForPlatform as (platformId: string) => Medium;
export const patternsByTier = data.patternsByTier as (tier: Tier) => Pattern[];
export const countByTier = data.countByTier as () => Record<string, number>;

/** Fast lookup — the AI path resolves a returned patternId against this. */
export const PATTERNS_BY_ID: ReadonlyMap<string, Pattern> = new Map(
  PATTERNS.map((p) => [p.id, p]),
);
