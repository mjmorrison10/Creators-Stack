/**
 * Ledger reads and writes — ported from Hooklabs/app.js.
 *
 * `hooklab_state_v1` is a public contract, not private state: BLAST reads
 * winners as prompt evidence, RECALL reads them for PROOF labels, and PULSE
 * writes entries into it under reserved id prefixes. So the id conventions and
 * timestamp formats here are load-bearing across the whole stack.
 */

import { KEYS } from "../../data/keys";
import { readJSON, writeJSON } from "../../data/storage";
import { tombstone } from "../../data/stackdata/tombstones";
import { mediumForPlatform, PATTERNS_BY_ID } from "./patterns";
import {
  EMPTY_HOOKLAB_STATE,
  PULSE_AUTO_LEDGER_PREFIX,
  PULSE_LEDGER_PREFIX,
  type CompEntry,
  type HooklabState,
  type LedgerEntry,
} from "../../data/schemas/hooklab";

/** Same id shape the legacy app writes, so ids stay recognizable across apps. */
export function uid(): string {
  return `id_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function readState(): HooklabState {
  const raw = readJSON<Partial<HooklabState>>(KEYS.hooklabState, EMPTY_HOOKLAB_STATE);
  return {
    ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
    comps: Array.isArray(raw.comps) ? raw.comps : [],
  };
}

export function writeState(state: HooklabState): void {
  writeJSON(KEYS.hooklabState, state);
}

/** True for entries PULSE owns. Auto entries are derived and get rewritten. */
export function isPulseEntry(e: LedgerEntry): boolean {
  return e.id.startsWith(PULSE_LEDGER_PREFIX) || e.id.startsWith(PULSE_AUTO_LEDGER_PREFIX);
}

export function isAutoPromoted(e: LedgerEntry): boolean {
  return e.id.startsWith(PULSE_AUTO_LEDGER_PREFIX) || e.source === "pulse-auto";
}

export type LedgerFields = Omit<LedgerEntry, "id" | "createdAt" | "editedAt" | "source">;

/** Fill derived fields the form doesn't ask for directly. */
export function deriveFields(fields: Partial<LedgerFields> & { hook: string }): LedgerFields {
  const pattern = fields.patternId ? PATTERNS_BY_ID.get(fields.patternId) : undefined;
  const platform = fields.platform ?? "";
  return {
    hook: fields.hook,
    patternId: fields.patternId,
    // "unknown" rather than blank: the scoring code groups on family, and an
    // empty key would silently merge unrelated entries together.
    family: pattern?.family ?? "unknown",
    outcome: fields.outcome ?? "meh",
    platform,
    medium: fields.medium ?? (mediumForPlatform(platform) as LedgerEntry["medium"]),
    niche: fields.niche ?? "general",
    retention: fields.retention ?? "",
    views: fields.views ?? "",
    notes: fields.notes ?? "",
    hypothesis: fields.hypothesis,
    hypothesisNote: fields.hypothesisNote,
  };
}

export function createEntry(fields: Partial<LedgerFields> & { hook: string }): LedgerEntry {
  return {
    id: uid(),
    ...deriveFields(fields),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Update in place, preserving `id`, `createdAt` and `source`.
 *
 * `source` matters: an entry PULSE created keeps its provenance through a hand
 * edit, so a later PULSE re-log still matches it instead of creating a twin.
 */
export function updateEntry(orig: LedgerEntry, fields: Partial<LedgerFields> & { hook: string }): LedgerEntry {
  const updated: LedgerEntry = {
    id: orig.id,
    createdAt: orig.createdAt,
    editedAt: new Date().toISOString(),
    ...deriveFields(fields),
  };
  if (orig.source) updated.source = orig.source;
  return updated;
}

/** Newest first — the fatigue and recency logic reads index 0 as most recent. */
export function addEntry(state: HooklabState, entry: LedgerEntry): HooklabState {
  return { ...state, ledger: [entry, ...state.ledger] };
}

export function replaceEntry(state: HooklabState, entry: LedgerEntry): HooklabState {
  return { ...state, ledger: state.ledger.map((e) => (e.id === entry.id ? entry : e)) };
}

/**
 * Delete, leaving a tombstone. Without it the next sync sees the entry on the
 * other device, unions it back in, and the deletion undoes itself.
 */
export function deleteEntry(state: HooklabState, id: string): HooklabState {
  tombstone("hooklabLedger", id);
  return { ...state, ledger: state.ledger.filter((e) => e.id !== id) };
}

export function createComp(fields: Omit<CompEntry, "id" | "createdAt">): CompEntry {
  return { id: uid(), ...fields, createdAt: new Date().toISOString() };
}

export function addComp(state: HooklabState, comp: CompEntry): HooklabState {
  return { ...state, comps: [comp, ...state.comps] };
}

export function deleteComp(state: HooklabState, id: string): HooklabState {
  tombstone("hooklabComp", id);
  return { ...state, comps: state.comps.filter((c) => c.id !== id) };
}

export interface HooklabExportEnvelope {
  ledger: LedgerEntry[];
  comps: CompEntry[];
  exportedAt: string;
}

/** Note: no format or version marker — that is the legacy envelope as-is. */
export function buildExport(state: HooklabState): HooklabExportEnvelope {
  return {
    ledger: state.ledger,
    comps: state.comps,
    exportedAt: new Date().toISOString(),
  };
}

export const EXPORT_FILENAME = "hooklab-ledger.json";

/**
 * Drop entries with no hook text and mint ids for any that lack one.
 *
 * The id guard is not cosmetic: an entry with an empty id once made Delete
 * match every other id-less entry and wipe the ledger.
 */
export function normalizeLedgerImport(arr: unknown): LedgerEntry[] {
  if (!Array.isArray(arr)) return [];
  return (arr as LedgerEntry[])
    .filter((e) => e && typeof e.hook === "string" && e.hook.trim())
    .map((e) => (e.id ? e : { ...e, id: uid() }));
}

export function normalizeCompImport(arr: unknown): CompEntry[] {
  if (!Array.isArray(arr)) return [];
  return (arr as CompEntry[])
    .filter((c) => c && typeof c.hook === "string" && c.hook.trim())
    .map((c) => (c.id ? c : { ...c, id: uid() }));
}

/**
 * Accept either a bare ledger array or a `{ledger, comps}` object, and prepend
 * rather than dedupe — matching the legacy importer. Two imports of the same
 * file produce duplicates, which is the existing behaviour and is left alone:
 * silently dropping entries that merely look alike would lose real re-tests of
 * the same hook.
 */
export function applyImport(state: HooklabState, data: unknown): HooklabState {
  const asObj = data as { ledger?: unknown; comps?: unknown };
  const incomingLedger = normalizeLedgerImport(Array.isArray(data) ? data : asObj?.ledger);
  const incomingComps = normalizeCompImport(Array.isArray(data) ? [] : asObj?.comps);
  return {
    ledger: [...incomingLedger, ...state.ledger],
    comps: [...incomingComps, ...state.comps],
  };
}
