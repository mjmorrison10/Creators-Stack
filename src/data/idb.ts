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

/** Shape guard — the value crosses app and version boundaries. */
export function isRecallLibrary(v: unknown): v is RecallLibrary {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Partial<RecallLibrary>;
  return (
    Array.isArray(l.sources) && Array.isArray(l.enabled) && Array.isArray(l.bin)
  );
}
