/**
 * Tombstones — ported from stackdata.js lines 195-207.
 *
 * Without these, a delete on one device is resurrected by the next merge: the
 * other device still has the item, the union adds it back, and it reappears
 * forever. A tombstone suppresses an item while it is NEWER than the item's own
 * timestamp, so deliberately re-adding something later still works.
 */

import { KEYS } from "../keys";
import { readJSON, writeJSON } from "../storage";
import { TOMB_TTL_MS, type TombstoneKind, type Tombstones } from "../schemas/stack";

export function readTombstones(): Tombstones {
  return readJSON<Tombstones>(KEYS.stackTombstones, {});
}

/** Drop entries past the TTL so the map cannot grow without bound. */
export function pruneTomb(map: Tombstones, now: number = Date.now()): Tombstones {
  const cut = now - TOMB_TTL_MS;
  const out: Tombstones = {};
  for (const k of Object.keys(map)) {
    const v = map[k];
    if (v && v >= cut) out[k] = v;
  }
  return out;
}

export function tombKey(kind: TombstoneKind, id: string | number): string {
  return `${kind}:${id}`;
}

/**
 * Record a delete. Must be called for anything that syncs and can be removed.
 *
 * A quota failure is swallowed, exactly as legacy does (stackdata.js:203).
 * Returns false when the record didn't land. This is deliberately non-fatal:
 * callers reach it while deleting things, and a full store is the one state
 * where the user most needs the delete to go through. Throwing here took the
 * whole section down on mount when the boot healers tombstoned their merges —
 * on a full store that left no way to delete anything to free space.
 */
export function tombstone(kind: TombstoneKind, id: string | number | null | undefined): boolean {
  if (!kind || id == null) return false;
  const map = readTombstones();
  map[tombKey(kind, id)] = Date.now();
  try {
    writeJSON(KEYS.stackTombstones, pruneTomb(map));
  } catch {
    return false;
  }
  return true;
}

/** Union of two tombstone maps, later delete wins, then pruned. */
export function mergeTomb(a: Tombstones, b: Tombstones, now: number = Date.now()): Tombstones {
  const out: Tombstones = {};
  for (const k of Object.keys(a)) out[k] = a[k]!;
  for (const k of Object.keys(b)) {
    const v = b[k]!;
    if (!(k in out) || v > out[k]!) out[k] = v;
  }
  return pruneTomb(out, now);
}
