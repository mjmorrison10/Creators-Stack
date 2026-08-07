/**
 * Shared API keys — ported from stackdata.js lines 79-112 (Part A).
 *
 * One key entered anywhere works everywhere. The shared store wins on read; a
 * key still sitting only in a legacy per-app settings blob is PROMOTED into the
 * shared store on first read, which is how the four apps converged without a
 * migration step.
 *
 * `stack_settings_v1` is in SYNC_EXCLUDE — these values never leave the device.
 */

import { KEYS } from "../keys";
import { readJSON, writeJSON } from "../storage";
import type { StackSettings } from "../schemas/stack";

export type SharedKeyField = keyof Omit<StackSettings, "updatedAt">;

export function readSharedKeys(): StackSettings {
  return readJSON<StackSettings>(KEYS.stackSettings, {});
}

/**
 * Merge non-empty values into the shared store. Empty values are ignored here
 * on purpose — clearing is an explicit act, see clearSharedKey.
 */
export function writeSharedKeys(partial: Partial<StackSettings>): boolean {
  try {
    const cur = readSharedKeys();
    for (const k of Object.keys(partial) as (keyof StackSettings)[]) {
      const v = partial[k];
      if (v != null && v !== "") (cur as Record<string, unknown>)[k] = v;
    }
    cur.updatedAt = new Date().toISOString();
    writeJSON(KEYS.stackSettings, cur);
    return true;
  } catch {
    return false;
  }
}

/** Blank a field across the whole stack. */
export function clearSharedKey(field: SharedKeyField): boolean {
  try {
    const cur = readSharedKeys();
    (cur as Record<string, unknown>)[field] = "";
    cur.updatedAt = new Date().toISOString();
    writeJSON(KEYS.stackSettings, cur);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `fields` against the shared store, falling back to the caller's local
 * settings. A local-only value is promoted into the shared store as a side
 * effect, so entering a key in one section makes it available in all of them.
 */
export function resolveKeys<T extends Record<string, unknown>>(
  local: T | null | undefined,
  fields: readonly SharedKeyField[],
): T & Record<string, unknown> {
  const src = (local ?? {}) as Record<string, unknown>;
  const shared = readSharedKeys() as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  const promote: Record<string, unknown> = {};
  let has = false;

  for (const f of fields) {
    const sv = shared[f];
    const lv = src[f];
    if (sv != null && sv !== "") {
      out[f] = sv;
    } else if (lv != null && lv !== "") {
      out[f] = lv;
      promote[f] = lv;
      has = true;
    }
  }

  if (has) writeSharedKeys(promote as Partial<StackSettings>);
  return out as T & Record<string, unknown>;
}
