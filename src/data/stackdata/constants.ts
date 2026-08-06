/**
 * Ported verbatim from stackdata.js (lines 20-80). These lists are load-bearing
 * for privacy and for merge correctness — the comments explaining *why* each
 * entry is excluded are kept, because each one encodes a bug that was already
 * paid for once.
 */

export const STACK_BUILD = "2026-07-16.2";

/** RECALL's IndexedDB coordinates — same constants as the legacy recall/app.js. */
export const IDB_NAME = "recall";
export const IDB_VERSION = 1;
export const IDB_STORE = "library";
export const IDB_KEY = "current";

/**
 * Public OAuth Web client id (the token flow carries no secret). Scope is
 * drive.file only, so the app sees nothing in Drive it did not create.
 */
export const DRIVE_CLIENT_ID =
  "695946260157-i2mlinkucs93c4le05buv5lcj0cceln1.apps.googleusercontent.com";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export function isDriveConfigured(): boolean {
  return Boolean(DRIVE_CLIENT_ID) && !DRIVE_CLIENT_ID.includes("REPLACE_WITH");
}

/**
 * Each workspace gets its OWN sync file in the same Drive, so one Google
 * account can run several stacks without them fighting over one file.
 * Discovery is by appProperties; the filename only has to be recognizable.
 */
export function syncMarker(ws: { id?: string } | null | undefined) {
  return { app: "mjm-stack", ws: (ws && ws.id) || "default" };
}

export function syncFileName(ws: { name?: string } | null | undefined): string {
  const slug =
    ((ws && ws.name) || "workspace")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";
  return `mjm-stack-sync-${slug}.json`;
}

/**
 * Keys that NEVER leave the device via Drive/merge: secrets, device prefs,
 * regenerable caches, and transient inboxes. mergeStates strips these from
 * BOTH inputs, so a payload is structurally guaranteed to carry no API keys.
 */
export const SYNC_EXCLUDE: readonly string[] = [
  "stack_settings_v1", // shared API keys
  "recall_settings_v1",
  "hooklab_settings_v1",
  "blast_settings_v1",
  "pulse_settings_v1", // keys + prefs
  "hooklab_theme",
  "blast-theme",
  "pulse-theme", // device themes
  // The unified theme, device-scoped like the three above. Caveat while the
  // legacy apps are still deployed: their copy of this list predates the key,
  // and their isStackKey matches it, so a sync run FROM an old app will carry
  // stack_theme_v1 into the Drive payload and hand it to other devices. Only a
  // theme string is at stake, so this is noise rather than a leak — it stops
  // once the old apps are retired.
  "stack_theme_v1",
  "stack_models_cache_v1", // 24h model-list cache
  "blast_handoff_v1", // transient consumed inbox
  // blast_session_v1 is a PROJECTION of the queue's Quick clip, re-stamped with
  // a fresh updatedAt on any keystroke. Syncing it let a device sitting on an
  // old clip win a newest-wins merge and overwrite real work everywhere. The
  // queue (blast_queue_v1) is the source of truth and syncs instead; each
  // device rebuilds its own projection from it.
  "blast_session_v1",
  "recall_state_v2", // legacy LS library fallback (library syncs via recallLibrary)
];

/**
 * Excluded from EVERY export, including local file backups — device-specific
 * Drive bookkeeping must not travel to another machine.
 */
export const ALWAYS_EXCLUDE: readonly string[] = ["stack_sync_meta_v1"];

/**
 * On a REPLACE restore we wipe all stack app-data keys first, so switching to a
 * stack that lacks PULSE/BLAST data doesn't leave the old stack's data behind.
 * These device-scoped keys survive the wipe: a backup that simply doesn't carry
 * API keys or themes shouldn't blank them on this device. When the backup DOES
 * carry them, the overlay overwrites them anyway.
 */
export const DEVICE_PRESERVE: readonly string[] = [
  "stack_settings_v1",
  "recall_settings_v1",
  "hooklab_settings_v1",
  "blast_settings_v1",
  "pulse_settings_v1",
  "hooklab_theme",
  "blast-theme",
  "pulse-theme",
  "stack_theme_v1",
];
