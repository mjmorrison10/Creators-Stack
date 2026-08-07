/**
 * RECALL library operations — search, the clip bin, source management, and the
 * export/import envelopes. Ported from recall/app.js.
 *
 * Deliberate deviation from the original: the legacy code mutates `state` in
 * place and calls `save()`. These return new objects instead, per the repo's
 * immutability rule. The *resulting data* is identical, which is what the
 * still-deployed apps and the sync engine care about; the tests assert on the
 * data, not on how it got there.
 */

import type {
  RecallBinItem,
  RecallLibrary,
  RecallLibraryExport,
  RecallSegment,
  RecallSource,
} from "../../data/schemas/recall";
import { RECALL_LIBRARY_SCHEMA } from "../../data/schemas/recall";

/** How long the last clip in a source runs when nothing follows it. */
const TRAILING_CLIP_SECONDS = 30;

/** The bin's merge identity. Must stay exactly this shape — sync keys on it. */
export function binKey(srcId: string, sec: number, idx: number): string {
  return `${srcId}@${sec}@${idx}`;
}

export function terms(str: string): string[] {
  return str
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length);
}

export interface SearchHit {
  source: RecallSource;
  segment: RecallSegment;
  idx: number;
  key: string;
  /** The moment before this one, shown as context. */
  prev?: RecallSegment;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Distinct sources represented in the hits. */
  matchedSources: number;
  /** Sources currently switched on. */
  enabledSources: number;
  /** Total moments across enabled sources, for the idle count line. */
  totalMoments: number;
}

/**
 * Every term must appear somewhere in the moment — an AND over case-insensitive
 * substrings, not a phrase match. Only enabled sources are scanned.
 */
export function search(lib: RecallLibrary, query: string): SearchResult {
  const ws = terms(query.trim());
  const enabled = lib.sources.filter((s) => lib.enabled.indexOf(s.id) >= 0);
  const totalMoments = enabled.reduce((a, s) => a + s.segments.length, 0);

  if (!ws.length) {
    return { hits: [], matchedSources: 0, enabledSources: enabled.length, totalMoments };
  }

  const hits: SearchHit[] = [];
  for (const s of enabled) {
    s.segments.forEach((seg, idx) => {
      const low = seg.text.toLowerCase();
      if (ws.every((w) => low.indexOf(w) >= 0)) {
        const prev = s.segments[idx - 1];
        hits.push({
          source: s,
          segment: seg,
          idx,
          key: binKey(s.id, seg.sec, idx),
          ...(prev ? { prev } : {}),
        });
      }
    });
  }

  const srcSet = new Set(hits.map((h) => h.source.id));
  return {
    hits,
    matchedSources: srcSet.size,
    enabledSources: enabled.length,
    totalMoments,
  };
}

/** Splits a query into terms for highlighting, escaped for use in a regex. */
export function highlightRanges(text: string, ws: string[]): [number, number][] {
  if (!ws.length) return [];
  const re = new RegExp(
    "(" + ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")",
    "gi",
  );
  const out: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push([m.index, m.index + m[0].length]);
    // A zero-length match would spin forever; the alternation can produce one
    // if a term is empty.
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

export function binHas(lib: RecallLibrary, key: string): boolean {
  return lib.bin.some((b) => b.key === key);
}

/** Pattern provenance carried from HOOKLAB through to PULSE. */
export type BinExtra = Partial<
  Pick<RecallBinItem, "hookText" | "label" | "patternId" | "patternName" | "patternFamily">
>;

const EXTRA_FIELDS = ["hookText", "label", "patternId", "patternName", "patternFamily"] as const;

/**
 * Add the moment to the bin, or remove it if it's already there. A missing
 * source or index is a no-op, matching the legacy guard.
 */
export function toggleBin(
  lib: RecallLibrary,
  srcId: string,
  idx: number,
  extra?: BinExtra,
): RecallLibrary {
  const s = lib.sources.find((x) => x.id === srcId);
  if (!s) return lib;
  const seg = s.segments[idx];
  if (!seg) return lib;

  const key = binKey(srcId, seg.sec, idx);
  const at = lib.bin.findIndex((b) => b.key === key);
  if (at >= 0) {
    return { ...lib, bin: lib.bin.filter((_, i) => i !== at) };
  }

  const item: RecallBinItem = {
    key,
    srcId,
    srcTitle: s.title,
    t: seg.t,
    sec: seg.sec,
    text: seg.text,
  };
  // Only truthy extras ride along, as in the original — an empty string must
  // not create a field that later reads as "this clip has a pattern".
  if (extra) {
    for (const f of EXTRA_FIELDS) {
      const v = extra[f];
      if (v) item[f] = v;
    }
  }
  return { ...lib, bin: [...lib.bin, item] };
}

export function clearBin(lib: RecallLibrary): RecallLibrary {
  return { ...lib, bin: [] };
}

export function toggleSource(lib: RecallLibrary, id: string): RecallLibrary {
  const at = lib.enabled.indexOf(id);
  return {
    ...lib,
    enabled: at >= 0 ? lib.enabled.filter((v) => v !== id) : [...lib.enabled, id],
  };
}

export function addSource(lib: RecallLibrary, source: RecallSource): RecallLibrary {
  return {
    ...lib,
    sources: [...lib.sources, source],
    enabled: lib.enabled.indexOf(source.id) >= 0 ? lib.enabled : [...lib.enabled, source.id],
  };
}

/**
 * Removing a source takes its bin items with it — a bin entry pointing at a
 * source that no longer exists renders with no timecode context and exports a
 * clip nobody can find.
 */
export function removeSource(lib: RecallLibrary, id: string): RecallLibrary {
  return {
    sources: lib.sources.filter((v) => v.id !== id),
    enabled: lib.enabled.filter((v) => v !== id),
    bin: lib.bin.filter((b) => b.srcId !== id),
  };
}

/** The title is denormalized onto every bin item, so both have to move. */
export function renameSource(lib: RecallLibrary, id: string, rawName: string): RecallLibrary {
  const name = rawName.trim();
  if (!name) return lib;
  return {
    ...lib,
    sources: lib.sources.map((s) => (s.id === id ? { ...s, title: name } : s)),
    bin: lib.bin.map((b) => (b.srcId === id ? { ...b, srcTitle: name } : b)),
  };
}

// ── SRT export ──────────────────────────────────────────────────────────
// A SubRip file the bin can be dropped straight into Premiere, CapCut or
// DaVinci — which is what turns RECALL from a search tool into a clip tool.

export function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}

/**
 * A clip runs until the next moment in its source starts.
 *
 * Matched on `sec` rather than the bin key's index, exactly as the original
 * does. Two segments sharing a start time (every TurboScribe range split
 * produces a run of them) therefore resolve to the first one, so such a clip
 * gets a zero-length or very short range. Preserved rather than fixed: the
 * exported ranges are what users have already cut against.
 */
export function binItemRange(
  lib: RecallLibrary,
  b: RecallBinItem,
): { start: number; end: number } {
  const s = lib.sources.find((x) => x.id === b.srcId);
  if (!s) return { start: b.sec, end: b.sec + TRAILING_CLIP_SECONDS };
  for (let i = 0; i < s.segments.length; i++) {
    if (s.segments[i]!.sec === b.sec) {
      const next = s.segments[i + 1];
      return { start: b.sec, end: next ? next.sec : b.sec + TRAILING_CLIP_SECONDS };
    }
  }
  return { start: b.sec, end: b.sec + TRAILING_CLIP_SECONDS };
}

export function buildBinSRT(lib: RecallLibrary): string {
  const lines: string[] = [];
  lib.bin.forEach((b, i) => {
    const r = binItemRange(lib, b);
    lines.push(String(i + 1));
    lines.push(srtTime(r.start) + " --> " + srtTime(r.end));
    lines.push(b.text);
    lines.push("");
  });
  // Trailing newline for SRT spec compliance.
  return lines.join("\n") + "\n";
}

/** A plain-text shot list — the other thing editors ask for. */
export function buildShotList(lib: RecallLibrary): string {
  return (
    lib.bin
      .map((b, i) => `${i + 1}. [${b.t}] ${b.srcTitle}\n   ${b.text}`)
      .join("\n\n") + "\n"
  );
}

// ── Library export / import ─────────────────────────────────────────────

export function todayStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function srtFilename(now?: Date): string {
  return `recall-clips-${todayStamp(now)}.srt`;
}

export function shotListFilename(now?: Date): string {
  return `recall-shotlist-${todayStamp(now)}.txt`;
}

export function libraryFilename(now?: Date): string {
  return `recall-library-${todayStamp(now)}.json`;
}

export function buildLibraryExport(lib: RecallLibrary, now: Date = new Date()): RecallLibraryExport {
  return {
    schema: RECALL_LIBRARY_SCHEMA,
    version: 1,
    exportedAt: now.toISOString(),
    app: "RECALL",
    library: { sources: lib.sources, enabled: lib.enabled, bin: lib.bin },
  };
}

export class LibraryImportError extends Error {}

/**
 * Validates an import file. The schema check is strict on purpose: a
 * whole-stack backup dropped here should be told to use the restore flow
 * rather than silently importing nothing.
 */
export function parseLibraryFile(data: unknown): RecallLibraryExport {
  const d = data as Partial<RecallLibraryExport> | null;
  if (!d || d.schema !== RECALL_LIBRARY_SCHEMA) {
    throw new LibraryImportError("Not a RECALL library file (schema mismatch)");
  }
  if (!d.library || !Array.isArray(d.library.sources)) {
    throw new LibraryImportError("Library data missing or malformed");
  }
  return d as RecallLibraryExport;
}

export interface ImportSummary {
  sources: number;
  moments: number;
  bin: number;
  exportedAt?: string;
}

export function summarizeImport(data: RecallLibraryExport): ImportSummary {
  const sources = data.library.sources;
  return {
    sources: sources.length,
    moments: sources.reduce((n, s) => n + (s.segments || []).length, 0),
    bin: (data.library.bin || []).length,
    ...(data.exportedAt ? { exportedAt: data.exportedAt.slice(0, 10) } : {}),
  };
}

export type ImportMode = "replace" | "merge";

export interface ImportResult {
  library: RecallLibrary;
  added: number;
  skipped: number;
  mode: ImportMode;
}

/**
 * Replace swaps the whole library. Merge only adds sources whose id is new —
 * it never touches an existing source and never imports bin items, so a merge
 * can't overwrite work or resurrect clips the user cleared.
 */
export function applyLibraryImport(
  lib: RecallLibrary,
  data: RecallLibraryExport,
  mode: ImportMode,
): ImportResult {
  if (mode === "replace") {
    const library: RecallLibrary = {
      sources: data.library.sources,
      enabled: Array.isArray(data.library.enabled) ? data.library.enabled : [],
      bin: Array.isArray(data.library.bin) ? data.library.bin : [],
    };
    return { library, added: library.sources.length, skipped: 0, mode };
  }

  const haveIds = new Set(lib.sources.map((s) => s.id));
  const sources = [...lib.sources];
  const enabled = [...lib.enabled];
  let added = 0;
  let skipped = 0;

  for (const src of data.library.sources) {
    if (haveIds.has(src.id)) {
      skipped++;
      continue;
    }
    sources.push(src);
    haveIds.add(src.id);
    if (Array.isArray(data.library.enabled) && data.library.enabled.indexOf(src.id) >= 0) {
      if (enabled.indexOf(src.id) < 0) enabled.push(src.id);
    }
    added++;
  }

  return { library: { ...lib, sources, enabled }, added, skipped, mode };
}
