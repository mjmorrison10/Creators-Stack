/**
 * Stack-wide shapes, transcribed from stackdata.js (byte-identical in all four
 * legacy repos). These describe the backup envelope and the sync bookkeeping,
 * so they are the most compatibility-sensitive types in the app: a Drive file
 * written by an old app must round-trip through this one unchanged.
 */

import type { RecallLibrary } from "./recall";

/** `stack_settings_v1` — shared across the stack, never leaves the device. */
export interface StackSettings {
  geminiKey?: string;
  openrouterKey?: string;
  openrouterModel?: string;
  ytKey?: string;
  aiThinking?: "on" | "off";
  updatedAt?: string;
}

/**
 * `stack_workspace_v1`. Each workspace gets its own Drive file, so one Google
 * account can run several stacks. A mismatch hard-blocks sync rather than
 * merging two unrelated stacks together.
 */
export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

/** Entities that can be deleted, and therefore need tombstones. */
export type TombstoneKind =
  | "recallSource"
  | "pulsePost"
  | "hooklabLedger"
  | "hooklabComp"
  | "blastClip";

/** `stack_tombstones_v1`: "kind:id" -> deletedAt ms. */
export type Tombstones = Record<string, number>;

/** How long a delete keeps suppressing a re-synced item. */
export const TOMB_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** `stack_sync_meta_v1` — device-local Drive bookkeeping, never exported. */
export interface SyncMeta {
  fileId: string;
  wsId: string;
  lastSyncAt: string;
}

/**
 * The backup / Drive sync envelope.
 *
 * `localStorage` holds RAW SERIALIZED STRINGS, not parsed objects — matching
 * what the legacy engine writes. `recallLibrary` is carried separately because
 * RECALL's library lives in IndexedDB rather than localStorage.
 */
export interface StackBackup {
  format: "mjm-stack-backup";
  version: 2;
  exportedAt: string;
  localStorage: Record<string, string>;
  recallLibrary: RecallLibrary | null;
}

export const BACKUP_FORMAT = "mjm-stack-backup";
export const BACKUP_VERSION = 2;

/** Thrown when a sync file belongs to a different workspace. */
export interface WorkspaceMismatch {
  code: "WORKSPACE_MISMATCH";
  local?: Workspace | null;
  remote?: Workspace | null;
}

/** What a merge did, surfaced to the user after a sync. */
export interface MergeReport {
  added: { sources: number; posts: number; ledger: number; comps: number };
  tombstoned: number;
  conflicts: number;
  /** Stack-prefixed keys this build does not know about, carried through. */
  unknownKeys: string[];
}
