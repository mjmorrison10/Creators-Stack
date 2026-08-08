import { useCallback, useState } from "react";
import { useRecallLibrary } from "../../data/hooks";
import { tombstone } from "../../data/stackdata/tombstones";
import {
  addSource,
  applyLibraryImport,
  clearBin,
  removeBinItem,
  removeSource,
  renameSource,
  toggleBin,
  toggleSource,
  type BinExtra,
  type ImportMode,
  type ImportResult,
} from "../../domain/recall/library";
import { parse, uid } from "../../domain/recall/parse";
import { dropScan, readScans, renameScan, writeScans } from "../../domain/recall/scans";
import type { RecallLibrary, RecallLibraryExport, RecallSource } from "../../data/schemas/recall";

/**
 * RECALL's library plus the operations the views need.
 *
 * Every mutation is applied to the library the hook currently holds and then
 * written straight back to IndexedDB — the store is the source of truth and
 * React state is a cache of it, the same rule the localStorage sections follow.
 */
const SAVE_FAILED =
  "Couldn't save — storage is full. Export your library, then remove a source and retry.";

export function useRecall() {
  const { library, loading, save, reload, error } = useRecallLibrary();
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Every mutation goes through here so a failed write is reported exactly
   * once, in one place. An optimistic UI that shows the change while nothing
   * reached disk is how a session's work disappears on the next reload.
   */
  const persist = useCallback(
    async (next: RecallLibrary): Promise<boolean> => {
      const ok = await save(next);
      setSaveError(ok ? null : SAVE_FAILED);
      return ok;
    },
    [save],
  );

  const addFromTranscript = useCallback(
    async (title: string, raw: string): Promise<RecallSource | null> => {
      const segments = parse(raw);
      if (!segments.length) return null;
      const source: RecallSource = { id: uid(), title: title.trim() || "Untitled source", segments };
      await persist(addSource(library, source));
      return source;
    },
    [library, persist],
  );

  /**
   * Deleting writes a tombstone first. Without one the next Drive sync sees a
   * source present on the other device and missing here, and helpfully puts it
   * back — the delete undoes itself a day later.
   */
  const deleteSource = useCallback(
    async (id: string) => {
      // The library write goes FIRST. A tombstone written before a failed
      // save marks a source the merge engine will hard-drop on the next sync
      // — the source would vanish days later with no user action.
      const ok = await persist(removeSource(library, id));
      if (!ok) return;
      tombstone("recallSource", id);
      // The saved scan goes too, or TOP CLIPS keeps recommending clips from a
      // source that is no longer in the library.
      try {
        writeScans(dropScan(readScans(), id));
      } catch {
        // A full localStorage must not undo the delete that already succeeded;
        // a stale scan is recoverable, a half-deleted source is not.
      }
    },
    [library, persist],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      // The title is denormalized onto bin items and saved scans alike.
      const trimmed = name.trim();
      if (trimmed) {
        try {
          writeScans(renameScan(readScans(), id, trimmed));
        } catch {
          // Same reasoning as delete: a stale scan title is not worth losing
          // the rename over.
        }
      }
      return persist(renameSource(library, id, name));
    },
    [library, persist],
  );

  const toggle = useCallback((id: string) => persist(toggleSource(library, id)), [library, persist]);

  const toggleClip = useCallback(
    (srcId: string, idx: number, extra?: BinExtra) =>
      persist(toggleBin(library, srcId, idx, extra)),
    [library, persist],
  );

  const removeClip = useCallback(
    (key: string) => persist(removeBinItem(library, key)),
    [library, persist],
  );

  const emptyBin = useCallback(() => persist(clearBin(library)), [library, persist]);

  const importLibrary = useCallback(
    async (data: RecallLibraryExport, mode: ImportMode): Promise<ImportResult> => {
      const result = applyLibraryImport(library, data, mode);
      await persist(result.library);
      return result;
    },
    [library, persist],
  );

  return {
    library,
    loading,
    reload,
    /** Set when the library could not be opened, or a write did not land. */
    error: error ?? saveError,
    addFromTranscript,
    deleteSource,
    rename,
    toggle,
    toggleClip,
    removeClip,
    emptyBin,
    importLibrary,
  };
}
