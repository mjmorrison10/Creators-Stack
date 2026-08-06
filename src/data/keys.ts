/**
 * Every persisted key this app touches, in one place.
 *
 * These names are a compatibility contract with four still-deployed apps that
 * share this origin. Renaming one does not migrate data — it orphans it, and
 * can silently drop it from backups (see `isStackKey`). Tests assert that every
 * name here matches the stack prefix the backup engine filters on.
 *
 * Quirks preserved deliberately:
 *   - `blast-theme` uses a hyphen where every other BLAST key uses `blast_`.
 *   - `pulse_expanded_v1` / `pulse_platform_v1` live in sessionStorage.
 *   - `recall_state_v2` is a legacy fallback; the live library is in IndexedDB.
 */

export const KEYS = {
  // ---- stack-wide ----
  /** Shared API keys. Never synced. */
  stackSettings: "stack_settings_v1",
  stackWorkspace: "stack_workspace_v1",
  stackTombstones: "stack_tombstones_v1",
  /** Device-local Drive bookkeeping; excluded from every export. */
  stackSyncMeta: "stack_sync_meta_v1",
  /** 24h OpenRouter model-list cache. Regenerable, so not synced. */
  stackModelsCache: "stack_models_cache_v1",
  /** New in the unified app: one theme instead of three. */
  stackTheme: "stack_theme_v1",

  // ---- RECALL ----
  recallSettings: "recall_settings_v1",
  recallUi: "recall_ui_v1",
  recallTopclips: "recall_topclips_v1",
  recallAiMs: "recall_ai_ms_v1",
  recallTcAiMs: "recall_tc_ai_ms_v1",
  recallThinking: "recall_thinking_v1",
  /** Legacy localStorage library. Read for migration; the live copy is IDB. */
  recallStateLegacy: "recall_state_v2",

  // ---- BLAST ----
  blastQueue: "blast_queue_v1",
  /** Projection PULSE reads. Written, never synced. */
  blastSession: "blast_session_v1",
  blastPresets: "blast_presets_v1",
  blastSettings: "blast_settings_v1",
  blastHandoff: "blast_handoff_v1",
  blastBatchCount: "blast_batch_count_v1",
  blastCaptionLen: "blast_caption_len_v1",
  blastAiMs: "blast_ai_ms_v1",
  blastThinking: "blast_thinking_v1",
  /** Hyphen is intentional — this is the legacy name. */
  blastTheme: "blast-theme",

  // ---- HOOKLAB ----
  hooklabState: "hooklab_state_v1",
  hooklabSettings: "hooklab_settings_v1",
  hooklabTheme: "hooklab_theme",
  hooklabAiMs: "hooklab_ai_ms_v1",
  hooklabThinking: "hooklab_thinking_v1",

  // ---- PULSE ----
  pulsePosts: "pulse_posts_v1",
  pulseSettings: "pulse_settings_v1",
  pulseTheme: "pulse-theme",
} as const;

/** sessionStorage, not localStorage — they are per-tab view state. */
export const SESSION_KEYS = {
  pulseExpanded: "pulse_expanded_v1",
  pulsePlatform: "pulse_platform_v1",
} as const;

export type StackKeyName = (typeof KEYS)[keyof typeof KEYS];
export type SessionKeyName = (typeof SESSION_KEYS)[keyof typeof SESSION_KEYS];

/**
 * Which keys the backup engine considers part of the stack. Any key that fails
 * this test is invisible to backup, restore and sync — which is why new keys
 * must keep one of these five prefixes.
 */
export const STACK_KEY_RE = /^(recall|hooklab|blast|pulse|stack)[-_]/i;

export function isStackKey(key: string): boolean {
  return STACK_KEY_RE.test(key);
}

export const ALL_KEYS: readonly string[] = Object.values(KEYS);
export const ALL_SESSION_KEYS: readonly string[] = Object.values(SESSION_KEYS);
