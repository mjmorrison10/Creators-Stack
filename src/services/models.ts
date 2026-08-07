/**
 * OpenRouter model catalogue — ported from stackmodels.js.
 *
 * Turns a free-text model box into a ranked, priced list:
 *   1. Live list from OpenRouter's public models API (no key), cached 24h.
 *   2. Pricing per 1M tokens, or FREE.
 *   3. Ranking from arena.ai's text leaderboard.
 *
 * The DOM `<select>` building of the original becomes plain data here; the
 * React ModelPicker renders it.
 */

import { KEYS } from "../data/keys";
import { readJSON, writeJSON } from "../data/storage";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const RANKED_LIMIT = 30;

export const CUSTOM_MODEL = "__custom__";

export interface RankEntry {
  pat: string;
  score: number;
}

/**
 * arena.ai text-leaderboard snapshot, mapped to OpenRouter id substrings.
 * Most-specific patterns first; a model takes the score of the first pattern
 * its id contains. This is only the fallback — arena-ranking.json, regenerated
 * weekly by the repo's GitHub Action, replaces it once loaded.
 */
export const ARENA_FALLBACK: RankEntry[] = [
  { pat: "claude-fable", score: 1509 },
  { pat: "claude-opus-4.6", score: 1504 },
  { pat: "claude-opus-4.7", score: 1502 },
  { pat: "gemini-3.1-pro", score: 1486 },
  { pat: "gemini-3-pro", score: 1486 },
  { pat: "claude-opus-4.8", score: 1484 },
  { pat: "gpt-5.5", score: 1481 },
  { pat: "gemini-3.5-flash", score: 1479 },
  { pat: "gpt-5.4", score: 1478 },
  { pat: "gpt-5.2", score: 1476 },
  { pat: "qwen3.7", score: 1475 },
  { pat: "grok-4.20", score: 1475 },
  { pat: "gemini-3-flash", score: 1473 },
  { pat: "glm-5.1", score: 1472 },
  { pat: "claude-sonnet-4.6", score: 1472 },
  { pat: "glm-5.2", score: 1469 },
  { pat: "mimo-v2.5", score: 1466 },
  { pat: "grok-4.1", score: 1466 },
];

let ranking: RankEntry[] = ARENA_FALLBACK;
let rankingPromise: Promise<RankEntry[]> | null = null;

/**
 * Load the refreshed ranking. Same-origin (served from the app's base path),
 * so no CORS limit — unlike arena.ai itself, which is why the GitHub Action
 * regenerates this file server-side.
 */
export function loadRanking(force = false): Promise<RankEntry[]> {
  if (rankingPromise && !force) return rankingPromise;
  const base = import.meta.env.BASE_URL ?? "/";
  const url = `${base}arena-ranking.json${force ? `?t=${Date.now()}` : ""}`;
  rankingPromise = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { models?: RankEntry[] } | null) => {
      if (j?.models?.length) ranking = j.models;
      return ranking;
    })
    .catch(() => ranking);
  return rankingPromise;
}

export function arenaScore(id: string): number {
  const low = String(id).toLowerCase();
  for (const entry of ranking) {
    if (low.includes(entry.pat)) return entry.score;
  }
  return 0;
}

/** Test seam — lets a test pin the ranking without a fetch. */
export function setRankingForTest(next: RankEntry[]): void {
  ranking = next;
  rankingPromise = null;
}

/** Model ids that produce images, music or speech rather than a chat reply. */
export function isNonChat(id: string): boolean {
  return /(-image|lyria|whisper|tts|sora|veo|-music|dall-e)/i.test(id);
}

export interface ModelRecord {
  id: string;
  name: string;
  inPerM: number;
  outPerM: number;
  free: boolean;
  media: boolean;
  textOut: boolean;
  score: number;
}

interface RawModel {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
}

/** "Anthropic: Claude Opus 4.8" → "Claude Opus 4.8"; drops a trailing "(free)". */
export function shortName(name: string): string {
  const n = String(name).replace(/\s*\(free\)\s*$/i, "");
  const idx = n.indexOf(": ");
  return idx > 0 && idx < 20 ? n.slice(idx + 2) : n;
}

export function mapModel(m: RawModel): ModelRecord {
  const arch = m.architecture ?? {};
  const inMods = arch.input_modalities ?? [];
  const outMods = arch.output_modalities ?? [];
  const inP = parseFloat(m.pricing?.prompt ?? "") || 0;
  const outP = parseFloat(m.pricing?.completion ?? "") || 0;
  return {
    id: m.id,
    name: shortName(m.name || m.id),
    inPerM: inP * 1e6,
    outPerM: outP * 1e6,
    free: inP === 0 && outP === 0,
    media: inMods.includes("image") || inMods.includes("audio") || inMods.includes("video"),
    textOut: outMods.includes("text"),
    score: arenaScore(m.id),
  };
}

export function money(perM: number): string {
  if (perM <= 0) return "$0";
  if (perM < 0.1) return `$${perM.toFixed(3)}`;
  return `$${perM.toFixed(2)}`;
}

/**
 * The free router queues behind everyone else's free usage and regularly takes
 * minutes or times out. It gets no lightning bolt and says so plainly — it must
 * not look like the fast pick.
 */
const FREE_ROUTER_ID = "openrouter/free";
const FREE_ROUTER_LABEL = "Auto: best free model (slow — can queue for minutes)";

export function modelLabel(m: ModelRecord): string {
  if (m.id === FREE_ROUTER_ID) return FREE_ROUTER_LABEL;
  const price = m.free
    ? "FREE (rate-limited)"
    : `${money(m.inPerM)} in / ${money(m.outPerM)} out per 1M`;
  return `${m.media ? "🎬 " : ""}${m.name} — ${price}`;
}

// ---- cache ----

interface ModelCache {
  at: string;
  models: ModelRecord[];
}

export function readModelCache(): ModelCache | null {
  const raw = readJSON<ModelCache | null>(KEYS.stackModelsCache, null);
  return raw?.models?.length ? raw : null;
}

export function writeModelCache(models: ModelRecord[]): void {
  writeJSON(KEYS.stackModelsCache, { at: new Date().toISOString(), models });
}

export function isFresh(cache: ModelCache | null, now: () => number = Date.now): boolean {
  if (!cache) return false;
  const age = now() - new Date(cache.at).getTime();
  return age >= 0 && age < TTL_MS;
}

export async function fetchModels(): Promise<ModelRecord[]> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const r = await fetch(MODELS_URL, ctrl ? { signal: ctrl.signal } : undefined);
    if (!r.ok) throw new Error(`models ${r.status}`);
    const j = (await r.json()) as { data?: RawModel[] };
    const list = (j.data ?? []).map(mapModel).filter((m) => m.textOut);
    if (!list.length) throw new Error("empty models list");
    writeModelCache(list);
    return list;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cache-first, falling back to a stale cache if the network fails. */
export async function getModels(force = false): Promise<ModelRecord[]> {
  const cache = readModelCache();
  if (!force && isFresh(cache)) return cache!.models;
  try {
    return await fetchModels();
  } catch (err) {
    // A stale list beats an empty picker.
    if (cache) return cache.models;
    throw err;
  }
}

export interface ModelGroup {
  label: string;
  models: ModelRecord[];
}

/**
 * Group models for display: arena-ranked first, then free, then everything
 * else. A saved model that is no longer in the catalogue is surfaced at the
 * top rather than silently vanishing from the picker.
 */
export function groupModels(models: ModelRecord[], current?: string): ModelGroup[] {
  const chat = models.filter((m) => !isNonChat(m.id));
  const byScoreThenName = (a: ModelRecord, b: ModelRecord): number =>
    b.score - a.score || a.name.localeCompare(b.name);

  const ranked = chat.filter((m) => m.score > 0).sort(byScoreThenName).slice(0, RANKED_LIMIT);
  const rankedIds = new Set(ranked.map((m) => m.id));

  const free = chat.filter((m) => m.free && !rankedIds.has(m.id)).sort(byScoreThenName);
  const freeIds = new Set(free.map((m) => m.id));

  const others = chat
    .filter((m) => !rankedIds.has(m.id) && !freeIds.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const groups: ModelGroup[] = [];
  const trimmed = (current ?? "").trim();
  if (trimmed && !models.some((m) => m.id === trimmed)) {
    groups.push({
      label: "Current",
      models: [
        {
          id: trimmed,
          name: `Current: ${trimmed}`,
          inPerM: 0,
          outPerM: 0,
          free: false,
          media: false,
          textOut: true,
          score: 0,
        },
      ],
    });
  }
  if (ranked.length) groups.push({ label: "Top ranked (arena.ai)", models: ranked });
  if (free.length) groups.push({ label: "Free models", models: free });
  if (others.length) groups.push({ label: "All other models", models: others });
  return groups;
}
