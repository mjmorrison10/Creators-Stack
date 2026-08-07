import { useCallback } from "react";
import { KEYS } from "../../data/keys";
import { useStackKey } from "../../data/hooks";
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

/**
 * HOOKLAB state, read through the shared storage layer so a write from PULSE —
 * or from a still-deployed legacy app in another tab — shows up here without a
 * refresh.
 */
export function useHooklab() {
  const [state, setState] = useStackKey<HooklabState>(KEYS.hooklabState, EMPTY_HOOKLAB_STATE);

  // A corrupt or partial blob must not crash the section; other apps write here.
  const safe: HooklabState = {
    ledger: Array.isArray(state?.ledger) ? state.ledger : [],
    comps: Array.isArray(state?.comps) ? state.comps : [],
  };

  const logEntry = useCallback(
    (fields: Partial<LedgerFields> & { hook: string }) => setState(addEntry(safe, createEntry(fields))),
    [safe, setState],
  );

  const editEntry = useCallback(
    (orig: LedgerEntry, fields: Partial<LedgerFields> & { hook: string }) =>
      setState(replaceEntry(safe, updateEntry(orig, fields))),
    [safe, setState],
  );

  const removeEntry = useCallback((id: string) => setState(deleteEntry(safe, id)), [safe, setState]);

  const logComp = useCallback(
    (fields: Omit<CompEntry, "id" | "createdAt">) => setState(addComp(safe, createComp(fields))),
    [safe, setState],
  );

  const removeComp = useCallback((id: string) => setState(deleteComp(safe, id)), [safe, setState]);

  const importData = useCallback(
    (data: unknown) => setState(applyImport(safe, data)),
    [safe, setState],
  );

  return { state: safe, logEntry, editEntry, removeEntry, logComp, removeComp, importData };
}
