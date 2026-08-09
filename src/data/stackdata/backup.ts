/**
 * Full-stack backup — ported from stackdata.js lines 441-499.
 *
 * The envelope is the interchange format between every app in the stack and
 * every device: a file written by the legacy apps must import here unchanged,
 * and a file written here must import there. Values in `localStorage` are RAW
 * SERIALIZED STRINGS, not parsed objects.
 */

import { isStackKey } from "../keys";
import { allKeys, readRaw, removeKey, writeRaw } from "../storage";
import { readLibrary, writeLibrary, clearLibrary } from "../idb";
import { ALWAYS_EXCLUDE, DEVICE_PRESERVE, SYNC_EXCLUDE } from "./constants";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type StackBackup,
} from "../schemas/stack";

/** Every localStorage key belonging to the stack. */
export function stackKeys(): string[] {
  return allKeys().filter(isStackKey);
}

export interface ExportOptions {
  /** Also strip SYNC_EXCLUDE — secrets and device prefs never reach Drive. */
  forSync?: boolean;
}

export async function exportAll(opts: ExportOptions = {}): Promise<StackBackup> {
  const lib = await readLibrary();
  const excl = new Set<string>(ALWAYS_EXCLUDE);
  if (opts.forSync) for (const k of SYNC_EXCLUDE) excl.add(k);

  const ls: Record<string, string> = {};
  for (const k of stackKeys()) {
    if (excl.has(k)) continue;
    const raw = readRaw(k);
    if (raw != null) ls[k] = raw;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    localStorage: ls,
    recallLibrary: lib,
  };
}

export function isStackBackup(data: unknown): data is StackBackup {
  return Boolean(
    data && typeof data === "object" && (data as StackBackup).format === BACKUP_FORMAT,
  );
}

export interface ImportOptions {
  /**
   * REPLACE semantics (STACK RESTORE): wipe stack app-data keys first, so
   * restoring a backup that lacks some apps' data doesn't leave the previous
   * stack's data behind. Without this it is a per-key OVERLAY, used by sync.
   */
  replace?: boolean;
}

export async function importAll(data: unknown, opts: ImportOptions = {}): Promise<boolean> {
  if (!isStackBackup(data)) throw new Error("Not a stack backup file");
  if ((data.version || 1) > BACKUP_VERSION) {
    throw new Error("This backup is from a newer version of the app — update first");
  }

  const replace = Boolean(opts.replace);
  const ls = data.localStorage ?? {};

  if (replace) {
    const preserve = new Set<string>(DEVICE_PRESERVE);
    for (const k of stackKeys()) {
      if (preserve.has(k)) continue;
      removeKey(k);
    }
  }

  for (const k of Object.keys(ls)) {
    const v = ls[k];
    if (v != null) {
      try {
        writeRaw(k, v);
      } catch {
        // A single oversized key must not abort the whole restore.
      }
    }
  }

  if (data.recallLibrary) {
    await writeLibrary(data.recallLibrary);
    return true;
  }
  // In replace mode a backup with no library must CLEAR the old one, or the
  // previous stack's RECALL library leaks into the restored stack. Overlay mode
  // deliberately keeps the no-op: sync must never destroy the library on a
  // transient read failure.
  if (replace) await clearLibrary();
  return true;
}

/** Human-readable one-liner describing what a backup contains. */
export function summary(data: StackBackup): string {
  const ls = data?.localStorage ?? {};

  const countIn = (key: string, path: string[]): number => {
    try {
      let o: unknown = JSON.parse(ls[key] ?? "null");
      for (const p of path) o = o && (o as Record<string, unknown>)[p];
      return Array.isArray(o) ? o.length : 0;
    } catch {
      return 0;
    }
  };

  const parts: string[] = [];
  const srcs = data.recallLibrary?.sources?.length ?? 0;
  if (srcs) parts.push(`${srcs} RECALL source${srcs === 1 ? "" : "s"}`);

  const led = countIn("hooklab_state_v1", ["ledger"]);
  if (led) parts.push(`${led} ledger entr${led === 1 ? "y" : "ies"}`);

  let posts = 0;
  try {
    const p: unknown = JSON.parse(ls["pulse_posts_v1"] ?? "null");
    posts = Array.isArray(p) ? p.length : 0;
  } catch {
    posts = 0;
  }
  if (posts) parts.push(`${posts} tracked post${posts === 1 ? "" : "s"}`);

  if (ls["blast_session_v1"]) parts.push("a BLAST session");

  let keys: Record<string, unknown> = {};
  try {
    keys = (JSON.parse(ls["stack_settings_v1"] ?? "{}") as Record<string, unknown>) ?? {};
  } catch {
    keys = {};
  }
  const nk = ["geminiKey", "openrouterKey", "ytKey"].filter((f) => keys[f]).length;
  if (nk) parts.push(`${nk} saved API key${nk === 1 ? "" : "s"}`);

  let wsp: { name?: string } | null = null;
  try {
    wsp = JSON.parse(ls["stack_workspace_v1"] ?? "null") as { name?: string } | null;
  } catch {
    wsp = null;
  }
  const prefix = wsp?.name ? `workspace "${wsp.name}" · ` : "";
  return prefix + (parts.length ? parts.join(", ") : "no app data (keys/settings only)");
}
