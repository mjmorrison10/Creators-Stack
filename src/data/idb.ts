/**
 * RECALL's library store.
 *
 * The library lives in IndexedDB rather than localStorage for a reason worth
 * preserving: transcripts are large and localStorage's few-megabyte cap was
 * being hit. Everything else in the stack is small enough for localStorage.
 *
 * Coordinates match the legacy app exactly, so this reads the library a user
 * already has and the still-deployed RECALL keeps reading what we write.
 */

import { IDB_NAME, IDB_VERSION, IDB_STORE, IDB_KEY } from "./stackdata/constants";
import { EMPTY_RECALL_LIBRARY, type RecallLibrary } from "./schemas/recall";
import { KEYS } from "./keys";

/** The pre-IndexedDB library blob. Read once, then removed. */
const LEGACY_LIBRARY_KEY = KEYS.recallStateLegacy;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readLibrary(): Promise<RecallLibrary | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  try {
    return await new Promise<RecallLibrary | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as RecallLibrary) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    // A read that fails must not take the section down with it — Safari
    // evicting storage, a corrupted store and Firefox private mode all land
    // here. Returning null lets the caller fall through to the migration path,
    // which is what the legacy app does.
    console.warn("recall: IDB read failed", e);
    return null;
  } finally {
    db.close();
  }
}

export async function writeLibrary(lib: RecallLibrary): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(lib, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function clearLibrary(): Promise<void> {
  await writeLibrary({ ...EMPTY_RECALL_LIBRARY });
}

/**
 * Persist the library, falling back to localStorage if IndexedDB refuses.
 *
 * Returns whether anything reached disk. Callers MUST use the answer: an
 * optimistic UI that shows the bin item added while the write silently failed
 * is how a session's work disappears on the next reload with no warning.
 *
 * The fallback mirrors the legacy save(): IndexedDB first, then the old
 * localStorage key, then give up and say so. Writing the fallback under
 * `recall_state_v2` is deliberate — that is exactly where `loadLibrary` looks
 * next, so the data is found again rather than stranded.
 */
export async function saveLibrary(lib: RecallLibrary): Promise<boolean> {
  try {
    await writeLibrary(lib);
    return true;
  } catch (e) {
    console.warn("recall: IDB write failed, falling back to localStorage", e);
    try {
      localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify(lib));
      return true;
    } catch (e2) {
      console.error("recall: save failed", e2);
      return false;
    }
  }
}

/**
 * Load the library the way the legacy app does: IndexedDB first, then a
 * one-time migration of the old `recall_state_v2` localStorage blob.
 *
 * The migration matters even though the legacy app has run it already — a user
 * whose last RECALL visit predates the IndexedDB move would otherwise open the
 * unified app to an empty library sitting next to their real one. It only
 * removes the localStorage copy once the IndexedDB write has succeeded, so a
 * failed write leaves the original data exactly where it was.
 *
 * Deviation from the legacy loadState: no demo transcripts are seeded for a
 * first-time user. The unified app shows an empty state that explains how to
 * add a source instead of writing two fake sources into a real library.
 */
export async function loadLibrary(): Promise<{
  library: RecallLibrary;
  migrated: boolean;
}> {
  const fromIdb = await readLibrary();
  if (fromIdb && Array.isArray(fromIdb.sources)) {
    return { library: fromIdb, migrated: false };
  }

  let legacy: unknown = null;
  try {
    const raw = localStorage.getItem(LEGACY_LIBRARY_KEY);
    if (raw) legacy = JSON.parse(raw);
  } catch {
    // A corrupt or unreadable blob is not worth failing the whole section over.
    legacy = null;
  }

  // Only `sources` is required, matching the legacy check. An old blob written
  // before `bin` existed still has a library worth rescuing.
  const l = legacy as Partial<RecallLibrary> | null;
  if (l && typeof l === "object" && Array.isArray(l.sources)) {
    const library: RecallLibrary = {
      sources: l.sources,
      enabled: Array.isArray(l.enabled) ? l.enabled : [],
      bin: Array.isArray(l.bin) ? l.bin : [],
    };
    try {
      await writeLibrary(library);
      localStorage.removeItem(LEGACY_LIBRARY_KEY);
    } catch {
      // Keep the localStorage copy: it is now the only one.
      return { library, migrated: false };
    }
    return { library, migrated: true };
  }

  return { library: { ...EMPTY_RECALL_LIBRARY }, migrated: false };
}

/** Shape guard — the value crosses app and version boundaries. */
export function isRecallLibrary(v: unknown): v is RecallLibrary {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Partial<RecallLibrary>;
  return (
    Array.isArray(l.sources) && Array.isArray(l.enabled) && Array.isArray(l.bin)
  );
}
