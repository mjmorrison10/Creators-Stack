/**
 * RECALL shapes, transcribed from recall/app.js and recall/topclips.js.
 *
 * These types describe data that already exists in users' browsers and in
 * Drive sync files. They are a contract, not a design: field names, optionality
 * and value domains must match the legacy apps exactly, because the old apps
 * are still deployed against the same origin and read the same keys.
 */

/** One timestamped chunk of a transcript. */
export interface RecallSegment {
  /** Normalized "H:MM:SS". */
  t: string;
  /** Same instant in whole seconds. */
  sec: number;
  text: string;
}

export interface RecallSource {
  id: string;
  title: string;
  segments: RecallSegment[];
}

/**
 * A moment saved to the clip bin. `key` is `${srcId}@${sec}@${idx}` and is the
 * merge identity. The pattern fields ride along from HOOKLAB via RECALL into
 * BLAST and finally PULSE, so an auto-promoted ledger entry can name the
 * pattern family instead of "unknown".
 */
export interface RecallBinItem {
  key: string;
  srcId: string;
  srcTitle: string;
  t: string;
  sec: number;
  text: string;
  hookText?: string;
  label?: string;
  patternId?: string;
  patternName?: string;
  patternFamily?: string;
}

/**
 * The whole library. Lives in IndexedDB (db "recall", store "library", key
 * "current"); `recall_state_v2` in localStorage is a legacy fallback only.
 */
export interface RecallLibrary {
  sources: RecallSource[];
  /** Source ids currently switched on. */
  enabled: string[];
  bin: RecallBinItem[];
}

export const EMPTY_RECALL_LIBRARY: RecallLibrary = {
  sources: [],
  enabled: [],
  bin: [],
};

export interface RecallSettings {
  provider: "gemini" | "openrouter";
  geminiKey: string;
  openrouterKey: string;
  openrouterModel: string;
  channelName: string;
  channelNiche: string;
  postAttribution: string;
}

export interface RecallUiState {
  chipsCollapsed: boolean;
}

/**
 * What a candidate matched, and how. Persisted inside `recall_topclips_v1`, so
 * the shape is a contract with the still-deployed RECALL — it stores this
 * object, not a summary string.
 */
export type TopClipMatch =
  | { kind: "ledger"; hook: string; patternId: string }
  | { kind: "pattern"; patternId: string; patternName: string; scaffold: string };

/** A TOP CLIPS candidate. `label` null means it surfaced without a badge. */
export interface TopClipCandidate {
  srcId: string;
  srcTitle: string;
  idx: number;
  t: string;
  sec: number;
  text: string;
  key: string;
  ctxPrev: string;
  ctxNext: string;
  label: "proof" | "ai_proof" | "ai" | null;
  proofType?: "ledger" | "pattern" | null;
  match?: TopClipMatch;
  personalProof?: boolean;
  grounding?: string;
  reason?: string;
  sim?: number;
  spec?: number;
  noise?: number;
  rank?: number;
}

export interface TopClipsScan {
  savedAt: number;
  meta: {
    aiNote?: string;
    scout?: boolean;
    scoutTitle?: string;
    scoutSrcId?: string;
    [k: string]: unknown;
  };
  candidates: TopClipCandidate[];
}

/** `recall_topclips_v1`: one saved scan per source id. */
export type TopClipsState = Record<string, TopClipsScan>;

/** The RECALL library export envelope. */
export interface RecallLibraryExport {
  schema: "recall.library.v1";
  version: 1;
  exportedAt: string;
  app: "RECALL";
  library: RecallLibrary;
}

export const RECALL_LIBRARY_SCHEMA = "recall.library.v1";
