/**
 * Loads the ORIGINAL stackdata.js and exposes its window.StackData.
 *
 * This is the reference implementation. Rather than hand-checking the port
 * against 844 lines of prose, the tests run both engines over the same inputs
 * and diff the JSON. If the port drifts, the diff says exactly where.
 *
 * The legacy file is a classic IIFE that grabs `window`, `localStorage` and
 * `indexedDB` at call time, so it runs as-is under jsdom.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LegacyStackData {
  mergeStates: (
    a: unknown,
    b: unknown,
  ) => { data: Record<string, unknown>; report: Record<string, unknown> };
  exportAll: (opts?: { forSync?: boolean }) => Promise<Record<string, unknown>>;
  importAll: (data: unknown, opts?: { replace?: boolean }) => Promise<boolean>;
  isStackBackup: (data: unknown) => boolean;
  summary: (data: unknown) => string;
  mergeTomb?: unknown;
}

/** Path to the still-deployed engine the unified app must match. */
export const LEGACY_PATH = resolve(
  import.meta.dirname,
  "../../../recall/stackdata.js",
);

let cached: string | undefined;

export function legacySource(): string {
  cached ??= readFileSync(LEGACY_PATH, "utf8");
  return cached;
}

/**
 * Evaluate the legacy engine against the current jsdom globals and hand back
 * its public API. Call once per test after localStorage is seeded.
 */
export function loadLegacy(): LegacyStackData {
  const src = legacySource();
  const w = globalThis as unknown as { StackData?: LegacyStackData };
  delete w.StackData;
  // Indirect eval so the IIFE sees the real globals rather than a module scope.
  (0, eval)(src);
  if (!w.StackData) throw new Error("legacy stackdata.js did not define StackData");
  return w.StackData;
}

/**
 * `exportedAt` is stamped from the clock, so it can never match between two
 * runs. Normalize it before comparing; everything else must be identical.
 */
export function normalizeExport<T extends Record<string, unknown>>(o: T): T {
  const copy = { ...o } as Record<string, unknown>;
  if ("exportedAt" in copy) copy.exportedAt = "<stamped>";
  return copy as T;
}
