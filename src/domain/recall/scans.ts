/**
 * Saved TOP CLIPS scans — `recall_topclips_v1`, one entry per source.
 *
 * Candidates are pure JSON, so a saved entry cold-renders without re-scanning.
 * The stack backup sweeps `recall_*` keys, so saved scans ride along with a
 * backup automatically, and the merge engine already knows how to union them
 * (greater `savedAt` wins, per source).
 *
 * Ported from recall/topclips.js.
 */

import { KEYS } from "../../data/keys";
import { readJSON, writeJSON } from "../../data/storage";
import type {
  TopClipCandidate,
  TopClipsScan,
  TopClipsState,
} from "../../data/schemas/recall";

export function readScans(): TopClipsState {
  const v = readJSON<TopClipsState>(KEYS.recallTopclips, {});
  return v && typeof v === "object" ? v : {};
}

export function writeScans(state: TopClipsState): void {
  writeJSON(KEYS.recallTopclips, state);
}

/**
 * Persist one source's run. The meta is a cleaned copy: the transient AI note
 * is stripped, and it is normalized to the scout shape so every saved view
 * renders the same way regardless of how the scan was started.
 */
export function persistRun(
  state: TopClipsState,
  srcId: string,
  srcTitle: string,
  candidates: TopClipCandidate[],
  meta: TopClipsScan["meta"] = {},
  now: number = Date.now(),
): TopClipsState {
  if (!srcId) return state;
  return {
    ...state,
    [srcId]: {
      savedAt: now,
      meta: {
        ...meta,
        aiNote: "",
        scout: true,
        scoutTitle: srcTitle || (meta.scoutTitle as string) || "",
        scoutSrcId: srcId,
      },
      candidates,
    },
  };
}

export function dropScan(state: TopClipsState, srcId: string): TopClipsState {
  if (!(srcId in state)) return state;
  const next = { ...state };
  delete next[srcId];
  return next;
}

export function renameScan(state: TopClipsState, srcId: string, title: string): TopClipsState {
  const scan = state[srcId];
  if (!scan) return state;
  return { ...state, [srcId]: { ...scan, meta: { ...scan.meta, scoutTitle: title } } };
}

export function hasScan(state: TopClipsState, srcId: string): boolean {
  return Boolean(state[srcId]);
}

/** "3m ago" / "2h ago" / "5d ago" — how stale a saved scan is. */
export function relTime(ts: number, now: number = Date.now()): string {
  const m = Math.round((now - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
