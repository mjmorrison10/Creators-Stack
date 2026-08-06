/**
 * HOOKLAB shapes, transcribed from Hooklabs/app.js.
 *
 * `hooklab_state_v1` is a public contract: BLAST reads winners as prompt
 * evidence, and PULSE writes entries into it with reserved id prefixes.
 * Timestamps here are ISO strings (BLAST's are ms numbers).
 */

export type Outcome = "winner" | "meh" | "dead";

/** Relative weights the underwriting math gives each outcome. */
export const OUTCOME_WEIGHTS: Record<Outcome, number> = {
  winner: 1.0,
  meh: 0.45,
  dead: 0.05,
};

export type HooklabPlatform =
  | "tiktok"
  | "reels"
  | "shorts"
  | "youtube"
  | "linkedin"
  | "x"
  | "threads";

export type Medium = "video" | "text";

/**
 * A logged outcome.
 *
 * `id` carries provenance by convention and the merge engine depends on it:
 *   `id_*`          hand-logged in HOOKLAB
 *   `pulse_<postId>`     hand-logged from PULSE
 *   `pulseauto_<postId>` auto-promoted by PULSE's statistical pass
 */
export interface LedgerEntry {
  id: string;
  hook: string;
  patternId?: string;
  family?: string;
  outcome: Outcome;
  platform?: string;
  medium?: Medium;
  niche?: string;
  /** Free-text from a number input, so "" is a normal value. */
  retention?: string;
  views?: string | number;
  notes?: string;
  hypothesis?: string;
  hypothesisNote?: string;
  /** ISO string. */
  createdAt?: string;
  /** ISO string, present only after an edit. */
  editedAt?: string;
  source?: "pulse" | "pulse-auto";
}

/** A competitor/market hook kept for comparison. */
export interface CompEntry {
  id: string;
  hook: string;
  creator?: string;
  niche?: string;
  notes?: string;
  /** ISO string. */
  createdAt?: string;
}

/**
 * `hooklab_state_v1`. Only ledger and comps persist — results, selected angles
 * and the pattern bank are in-memory. Newest entries are unshifted to index 0;
 * the fatigue and recency logic depends on that ordering.
 */
export interface HooklabState {
  ledger: LedgerEntry[];
  comps: CompEntry[];
}

export const EMPTY_HOOKLAB_STATE: HooklabState = { ledger: [], comps: [] };

export interface HooklabSettings {
  provider: "gemini" | "openrouter";
  geminiKey: string;
  openrouterKey: string;
  openrouterModel: string;
  brandVoice: string;
}

/** HOOKLAB's own export envelope — note it carries no format/version marker. */
export interface HooklabExport {
  ledger: LedgerEntry[];
  comps: CompEntry[];
  exportedAt: string;
}

/** Ids PULSE owns. Auto entries are derived state and are rewritten wholesale. */
export const PULSE_LEDGER_PREFIX = "pulse_";
export const PULSE_AUTO_LEDGER_PREFIX = "pulseauto_";
