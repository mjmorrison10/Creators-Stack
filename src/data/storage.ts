/**
 * The persistence boundary.
 *
 * Storage is the source of truth and React state is a cache of it — not the
 * other way round. That is what lets the still-deployed legacy apps share this
 * origin: they read and write the same keys, and a write from another tab
 * reaches this app through the `storage` event.
 *
 * Values are serialized with plain JSON.stringify, exactly as the legacy apps
 * do, so a value written here is byte-indistinguishable from one written there.
 */

const listeners = new Map<string, Set<() => void>>();

/** Notify same-tab subscribers; cross-tab arrives via the `storage` event. */
function emit(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) fn();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    // e.key is null when storage is cleared wholesale — wake everyone.
    if (e.key === null) {
      for (const key of listeners.keys()) emit(key);
    } else {
      emit(e.key);
    }
  });
}

export function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Raw string read — what the backup engine needs, since it stores raw values. */
export function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Parsed read. A corrupt value falls back rather than throwing: these keys are
 * shared with other apps and a half-written value must not brick a section.
 */
export function readJSON<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export class QuotaError extends Error {
  constructor(public readonly key: string) {
    super(`localStorage quota exceeded writing "${key}"`);
    this.name = "QuotaError";
  }
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22)
  );
}

/**
 * Write a raw string. Throws QuotaError on a full store so callers can shed
 * load (BLAST drops unpicked suggestions) rather than losing the write silently.
 */
export function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    if (isQuotaError(err)) throw new QuotaError(key);
    throw err;
  }
  emit(key);
}

export function writeJSON<T>(key: string, value: T): void {
  writeRaw(key, JSON.stringify(value));
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* a failed remove is not worth breaking a render over */
  }
  emit(key);
}

/** Every localStorage key currently present, in insertion order. */
export function allKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k !== null) out.push(k);
    }
  } catch {
    /* storage unavailable (private mode) — treat as empty */
  }
  return out;
}

// ---- sessionStorage (per-tab view state) ----

export function readSessionJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeSessionJSON<T>(key: string, value: T): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* view state is disposable */
  }
  emit(key);
}
