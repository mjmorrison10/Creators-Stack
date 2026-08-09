/**
 * The legacy HOOKLAB pattern bank is imported by the differential test to prove
 * the port is unchanged. It is plain JavaScript with no types of its own, and
 * it lives outside this project, so declare it loosely — the test's job is
 * value equality, not type agreement.
 */
declare module "*/Hooklabs/patterns.js" {
  export const MECHANISMS: unknown[];
  export const PATTERNS: unknown[];
  export const HISTORICAL_INSTANCES: unknown[];
  export const ANGLES: unknown[];
  export const CTA_PATTERNS: unknown[];
  export const NICHES: unknown[];
  export const PLATFORMS: { id: string }[];
  export const MEDIUMS: Record<string, unknown>;
  export const OUTCOMES: unknown[];
  export const EVIDENCE_LABELS: Record<string, string>;
  export const TIER_LABELS: Record<string, string>;
  export function mediumForPlatform(platformId: string): string;
  export function patternsByTier(tier: string): unknown[];
  export function countByTier(): Record<string, number>;
}
