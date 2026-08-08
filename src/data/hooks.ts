/**
 * React bindings over the persistence layer.
 *
 * Storage is the source of truth; these hooks make React a cache of it. A write
 * from anywhere — this app, another tab, or one of the still-deployed legacy
 * apps on the same origin — re-renders every subscriber.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { readJSON, subscribe, writeJSON } from "./storage";
import { loadLibrary, saveLibrary } from "./idb";
import { EMPTY_RECALL_LIBRARY, type RecallLibrary } from "./schemas/recall";

/**
 * Read a JSON-serialized key and re-render when it changes.
 *
 * useSyncExternalStore needs a stable snapshot: returning a fresh parse each
 * call would loop forever, so the parsed value is cached against the raw string
 * and only re-parsed when that string actually changes.
 */
export function useStackKey<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [cache] = useState<{ raw: string | null; value: T }>(() => ({
    raw: null,
    value: fallback,
  }));

  const getSnapshot = useCallback((): T => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw !== cache.raw) {
      cache.raw = raw;
      cache.value = raw === null ? fallback : (safeParse<T>(raw) ?? fallback);
    }
    return cache.value;
  }, [key, fallback, cache]);

  const value = useSyncExternalStore(
    useCallback((cb: () => void) => subscribe(key, cb), [key]),
    getSnapshot,
    () => fallback,
  );

  const setValue = useCallback((next: T) => writeJSON(key, next), [key]);
  return [value, setValue];
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface RecallLibraryState {
  library: RecallLibrary;
  loading: boolean;
  /** Resolves false when nothing reached disk. Callers must surface that. */
  save: (next: RecallLibrary) => Promise<boolean>;
  reload: () => Promise<void>;
  /** Set when the library could not be opened at all. */
  error: string | null;
}

/**
 * The RECALL library, which lives in IndexedDB rather than localStorage — it
 * holds whole transcripts and was moved there to escape the localStorage cap.
 * Async, so consumers get an explicit loading state rather than a flash of
 * "no sources" that looks like data loss.
 */
export function useRecallLibrary(): RecallLibraryState {
  const [library, setLibrary] = useState<RecallLibrary>(EMPTY_RECALL_LIBRARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { library: lib } = await loadLibrary();
      setLibrary(lib);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the library.");
    } finally {
      setLoading(false);
    }
  }, []);

  // loadLibrary, not readLibrary: the first read is also where a pre-IndexedDB
  // `recall_state_v2` blob gets migrated across.
  useEffect(() => {
    let alive = true;
    // The catch is load-bearing: without it a rejected open leaves `loading`
    // true forever and the section renders "Opening your library…" for good.
    void loadLibrary()
      .then(({ library: lib }) => {
        if (!alive) return;
        setLibrary(lib);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Could not open the library.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: RecallLibrary): Promise<boolean> => {
    setLibrary(next); // optimistic: the UI shouldn't wait on a disk write
    return saveLibrary(next);
  }, []);

  return { library, loading, save, reload, error };
}

/** Read a key once without subscribing — for one-shot reads in event handlers. */
export function readKeyOnce<T>(key: string, fallback: T): T {
  return readJSON<T>(key, fallback);
}
