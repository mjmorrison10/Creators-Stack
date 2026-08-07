import { useCallback, useMemo } from "react";
import { KEYS } from "../../data/keys";
import { useStackKey } from "../../data/hooks";
import { readJSON } from "../../data/storage";
import {
  addComp,
  addEntry,
  applyImport,
  createComp,
  createEntry,
  deleteComp,
  deleteEntry,
  replaceEntry,
  updateEntry,
  type LedgerFields,
} from "../../domain/hooklab/ledger";
import {
  EMPTY_HOOKLAB_STATE,
  type CompEntry,
  type HooklabState,
  type LedgerEntry,
} from "../../data/schemas/hooklab";

/** A corrupt or partial blob must not crash the section — other apps write here. */
function normalize(raw: Partial<HooklabState> | null | undefined): HooklabState {
  return {
    ledger: Array.isArray(raw?.ledger) ? raw.ledger : [],
    comps: Array.isArray(raw?.comps) ? raw.comps : [],
  };
}

/**
 * HOOKLAB state, read through the shared storage layer so a write from PULSE —
 * or from a still-deployed legacy app in another tab — shows up here without a
 * refresh.
 *
 * Mutations read the CURRENT stored value rather than the render-time snapshot.
 * Closing over the snapshot meant two writes in the same tick (an import
 * immediately followed by a log, say) both started from the same base and the
 * second silently discarded the first.
 */
export function useHooklab() {
  const [stored, setStored] = useStackKey<HooklabState>(KEYS.hooklabState, EMPTY_HOOKLAB_STATE);

  // Memoized so the value is referentially stable between renders; without it
  // every consumer prop changed on every render.
  const state = useMemo(() => normalize(stored), [stored]);

  /** Apply a change to the freshest stored value, not a captured one. */
  const mutate = useCallback(
    (fn: (current: HooklabState) => HooklabState) => {
      const current = normalize(readJSON<Partial<HooklabState>>(KEYS.hooklabState, EMPTY_HOOKLAB_STATE));
      setStored(fn(current));
    },
    [setStored],
  );

  const logEntry = useCallback(
    (fields: Partial<LedgerFields> & { hook: string }) =>
      mutate((s) => addEntry(s, createEntry(fields))),
    [mutate],
  );

  const editEntry = useCallback(
    (orig: LedgerEntry, fields: Partial<LedgerFields> & { hook: string }) =>
      mutate((s) => replaceEntry(s, updateEntry(orig, fields))),
    [mutate],
  );

  const removeEntry = useCallback((id: string) => mutate((s) => deleteEntry(s, id)), [mutate]);

  const logComp = useCallback(
    (fields: Omit<CompEntry, "id" | "createdAt">) => mutate((s) => addComp(s, createComp(fields))),
    [mutate],
  );

  const removeComp = useCallback((id: string) => mutate((s) => deleteComp(s, id)), [mutate]);

  const importData = useCallback((data: unknown) => mutate((s) => applyImport(s, data)), [mutate]);

  return { state, logEntry, editEntry, removeEntry, logComp, removeComp, importData };
}
