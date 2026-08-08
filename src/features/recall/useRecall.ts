import { useCallback } from "react";
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
import type { RecallLibraryExport, RecallSource } from "../../data/schemas/recall";

/**
 * RECALL's library plus the operations the views need.
 *
 * Every mutation is applied to the library the hook currently holds and then
 * written straight back to IndexedDB — the store is the source of truth and
 * React state is a cache of it, the same rule the localStorage sections follow.
 */
export function useRecall() {
  const { library, loading, save, reload } = useRecallLibrary();

  const addFromTranscript = useCallback(
    async (title: string, raw: string): Promise<RecallSource | null> => {
      const segments = parse(raw);
      if (!segments.length) return null;
      const source: RecallSource = { id: uid(), title: title.trim() || "Untitled source", segments };
      await save(addSource(library, source));
      return source;
    },
    [library, save],
  );

  /**
   * Deleting writes a tombstone first. Without one the next Drive sync sees a
   * source present on the other device and missing here, and helpfully puts it
   * back — the delete undoes itself a day later.
   */
  const deleteSource = useCallback(
    async (id: string) => {
      tombstone("recallSource", id);
      // The saved scan goes too, or TOP CLIPS keeps recommending clips from a
      // source that is no longer in the library.
      writeScans(dropScan(readScans(), id));
      await save(removeSource(library, id));
    },
    [library, save],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      // The title is denormalized onto bin items and saved scans alike.
      const trimmed = name.trim();
      if (trimmed) writeScans(renameScan(readScans(), id, trimmed));
      return save(renameSource(library, id, name));
    },
    [library, save],
  );

  const toggle = useCallback((id: string) => save(toggleSource(library, id)), [library, save]);

  const toggleClip = useCallback(
    (srcId: string, idx: number, extra?: BinExtra) => save(toggleBin(library, srcId, idx, extra)),
    [library, save],
  );

  const removeClip = useCallback(
    (key: string) => save(removeBinItem(library, key)),
    [library, save],
  );

  const emptyBin = useCallback(() => save(clearBin(library)), [library, save]);

  const importLibrary = useCallback(
    async (data: RecallLibraryExport, mode: ImportMode): Promise<ImportResult> => {
      const result = applyLibraryImport(library, data, mode);
      await save(result.library);
      return result;
    },
    [library, save],
  );

  return {
    library,
    loading,
    reload,
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
