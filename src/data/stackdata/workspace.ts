/**
 * Workspace identity — ported from stackdata.js lines 176-192.
 *
 * Each workspace gets its own Drive sync file, so one Google account can run
 * several stacks (say two social accounts) without them fighting over one file.
 * The guard exists because merging two unrelated stacks is unrecoverable: it
 * hard-blocks rather than asking the merge engine to guess.
 */

import { KEYS } from "../keys";
import { readJSON, writeJSON } from "../storage";
import type { StackBackup, Workspace } from "../schemas/stack";

export function getWorkspace(): Workspace | null {
  return readJSON<Workspace | null>(KEYS.stackWorkspace, null);
}

/**
 * Returns the existing workspace, or creates one.
 *
 * Unlike the legacy version this does NOT call window.prompt — the name comes
 * from the caller, so the UI can ask properly instead of blocking the thread
 * mid-sync. The id shape and the "My workspace" default are unchanged.
 */
export function ensureWorkspace(name?: string): Workspace {
  const existing = getWorkspace();
  if (existing && existing.id) return existing;

  const ws: Workspace = {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name: (name || "").trim() || "My workspace",
    createdAt: Date.now(),
  };
  writeJSON(KEYS.stackWorkspace, ws);
  return ws;
}

/** Read the workspace out of an export envelope's raw localStorage map. */
export function wsOf(exp: Partial<StackBackup> | null | undefined): Workspace | null {
  const raw = (exp?.localStorage ?? {})[KEYS.stackWorkspace];
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as Workspace;
  } catch {
    return null;
  }
}

/**
 * Returns the two names when the exports carry DIFFERENT workspace ids — the
 * hard-block case — else null. A missing id on either side is not a conflict:
 * an older backup may predate workspaces entirely.
 */
export function workspaceConflict(
  a: Partial<StackBackup> | null | undefined,
  b: Partial<StackBackup> | null | undefined,
): { localName: string; remoteName: string } | null {
  const wa = wsOf(a);
  const wb = wsOf(b);
  if (wa && wb && wa.id && wb.id && wa.id !== wb.id) {
    return {
      localName: wa.name || "(unnamed)",
      remoteName: wb.name || "(unnamed)",
    };
  }
  return null;
}
