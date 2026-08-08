/**
 * BLAST's post queue — `blast_queue_v1` — and the `blast_session_v1`
 * projection derived from it. Ported from blast/app.js.
 *
 * The queue is the source of truth. `blast_session_v1` is a ONE-WAY projection
 * of the Quick post, and PULSE reads that shape, so it has to keep working
 * exactly as before. It is rewritten from the clip rather than trusted —
 * including right after a Drive sync — because a stale session arriving from
 * another device was once absorbed back into the Quick card and replaced
 * current work. Once a queue exists on this device, the queue wins and the
 * session is only its shadow.
 */

import { KEYS } from "../../data/keys";
import { readJSON, writeJSON } from "../../data/storage";
import { PLATFORMS } from "./platforms";
import type { PostStatus } from "./platforms";

/** Maps keyed by platform display name. */
export type ByPlatform<T> = Record<string, T>;

export interface BlastPost {
  key: string;
  srcId: string;
  srcTitle: string;
  t: string;
  sec: number;
  text: string;
  hookText: string;
  label: string;
  /** null means "use the queue default". */
  platforms: string[] | null;
  /** RECALL stamps these when it knows the matched pattern. BLAST only carries
   *  them; PULSE reads them so an auto-promoted ledger entry can name its
   *  pattern family instead of landing in "unknown". */
  patternId: string;
  patternName: string;
  patternFamily: string;
  captions: ByPlatform<string>;
  titles: ByPlatform<string>;
  suggestions: ByPlatform<string[]>;
  picked: ByPlatform<number>;
  status: ByPlatform<PostStatus>;
  postUrl: ByPlatform<string>;
  postedAt: ByPlatform<number>;
  postedCaption: ByPlatform<string>;
  genState: "pending" | "running" | "done" | "error";
  genError: string;
  source: string;
  /** ms epoch — BLAST uses numbers where HOOKLAB uses ISO strings. */
  createdAt: number;
  updatedAt: number;
}

export interface BlastQueue {
  v: 1;
  updatedAt: number;
  defaultPlatforms: string[] | null;
  batchCount: number;
  clips: BlastPost[];
}

export const QUICK_KEY = "quick";

export function blankPost(key: string, extra: Partial<BlastPost> = {}, now = Date.now()): BlastPost {
  return {
    key,
    srcId: "",
    srcTitle: "",
    t: "",
    sec: 0,
    text: "",
    hookText: "",
    label: "",
    platforms: null,
    patternId: "",
    patternName: "",
    patternFamily: "",
    captions: {},
    titles: {},
    suggestions: {},
    picked: {},
    status: {},
    postUrl: {},
    postedAt: {},
    postedCaption: {},
    genState: "pending",
    genError: "",
    source: key === QUICK_KEY ? "quick" : "recall",
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/**
 * Read the queue, guaranteeing the Quick post exists and sorts first. The
 * legacy invariant: Quick is permanent and always index 0.
 */
export function loadQueue(): BlastQueue {
  const raw = readJSON<Partial<BlastQueue> | null>(KEYS.blastQueue, null);
  const ok = raw && raw.v === 1 && Array.isArray(raw.clips);
  let clips = ok ? (raw.clips as BlastPost[]) : [];

  const quick = clips.find((p) => p.key === QUICK_KEY);
  if (!quick) clips = [blankPost(QUICK_KEY), ...clips];
  else if (clips[0] !== quick) clips = [quick, ...clips.filter((p) => p !== quick)];

  return {
    v: 1,
    updatedAt: (ok && raw.updatedAt) || Date.now(),
    defaultPlatforms: (ok && raw.defaultPlatforms) || null,
    batchCount: normalizeBatchCount(ok ? raw.batchCount : undefined),
    clips,
  };
}

/** Only 1, 2 and 3 are offered; anything else is a corrupt or future value. */
export function normalizeBatchCount(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return n === 2 || n === 3 ? n : 1;
}

export function saveQueue(q: BlastQueue, now = Date.now()): void {
  writeJSON(KEYS.blastQueue, { ...q, v: 1, updatedAt: now });
}

export function findPost(q: BlastQueue, key: string): BlastPost | undefined {
  return q.clips.find((p) => p.key === key);
}

export function quickPost(q: BlastQueue): BlastPost {
  return findPost(q, QUICK_KEY) ?? blankPost(QUICK_KEY);
}

/**
 * Which platforms this post is for. A per-clip choice keeps the AI — and the
 * card — from covering places this particular clip was never going to.
 * An empty or absent selection means all of them.
 */
export function selectedNames(q: BlastQueue, post: BlastPost | null | undefined): string[] {
  const sel = post?.platforms || q.defaultPlatforms;
  if (!sel || !sel.length) return PLATFORMS.map((p) => p.name);
  // Filtered through PLATFORMS so the result keeps display order and drops any
  // name that no longer exists.
  return PLATFORMS.filter((p) => sel.indexOf(p.name) >= 0).map((p) => p.name);
}

/**
 * Apply a change to one post and stamp `updatedAt`.
 *
 * The stamp is not cosmetic: marking a platform posted or skipped used to leave
 * it untouched, and without the bump a merge can't tell that an afternoon of
 * posting is newer than a stale clip on another device.
 */
export function updatePost(
  q: BlastQueue,
  key: string,
  fn: (p: BlastPost) => BlastPost,
  now = Date.now(),
): BlastQueue {
  return {
    ...q,
    clips: q.clips.map((p) => (p.key === key ? { ...fn(p), updatedAt: now } : p)),
  };
}

export function addPosts(q: BlastQueue, posts: BlastPost[]): BlastQueue {
  return { ...q, clips: [...q.clips, ...posts] };
}

/** The Quick post is permanent — removing it would break the projection. */
export function removePost(q: BlastQueue, key: string): BlastQueue {
  if (key === QUICK_KEY) return q;
  return { ...q, clips: q.clips.filter((p) => p.key !== key) };
}

// ── the blast_session_v1 projection ─────────────────────────────────────

/** Exactly the twelve fields PULSE and the rest of the stack read. */
export interface BlastSession {
  base: string;
  videoHook: string;
  transcript: string;
  captions: ByPlatform<string>;
  titles: ByPlatform<string>;
  suggestions: ByPlatform<string[]>;
  picked: ByPlatform<number>;
  status: ByPlatform<PostStatus>;
  postUrl: ByPlatform<string>;
  postedAt: ByPlatform<number>;
  postedCaption: ByPlatform<string>;
  updatedAt: number;
}

export const SESSION_FIELDS: readonly (keyof BlastSession)[] = [
  "base",
  "videoHook",
  "transcript",
  "captions",
  "titles",
  "suggestions",
  "picked",
  "status",
  "postUrl",
  "postedAt",
  "postedCaption",
  "updatedAt",
] as const;

/**
 * Build the projection from the Quick post.
 *
 * `transcript` is the one field the queue does not hold, so it is carried
 * forward from whatever is already in the session rather than dropped.
 */
export function buildSessionProjection(
  quick: BlastPost,
  transcript: string | null = null,
  now = Date.now(),
): BlastSession {
  const carried =
    transcript ?? readJSON<Partial<BlastSession>>(KEYS.blastSession, {}).transcript ?? "";
  return {
    base: quick.text || "",
    videoHook: quick.hookText || "",
    transcript: carried,
    captions: quick.captions || {},
    titles: quick.titles || {},
    suggestions: quick.suggestions || {},
    picked: quick.picked || {},
    status: quick.status || {},
    postUrl: quick.postUrl || {},
    postedAt: quick.postedAt || {},
    postedCaption: quick.postedCaption || {},
    updatedAt: now,
  };
}

/**
 * THE single writer for `blast_session_v1`.
 *
 * Every mutation of the Quick post goes through here. Nothing else in the app
 * may write this key: it is derived state, and a second writer is how it drifts
 * out of step with the queue that PULSE will later be told is the truth.
 */
export function writeSessionProjection(
  q: BlastQueue,
  transcript: string | null = null,
  now = Date.now(),
): void {
  writeJSON(KEYS.blastSession, buildSessionProjection(quickPost(q), transcript, now));
}

/**
 * One-way legacy upgrade: an in-flight single-clip session becomes the Quick
 * post, so upgrading mid-session loses nothing.
 *
 * Runs ONLY when no queue exists on this device. It used to run on every load,
 * which turned the session key into a back door — a stale session arriving from
 * another device got absorbed into the Quick card and replaced current work.
 */
export function migrateSessionIntoQuick(q: BlastQueue): BlastQueue {
  const hasQueue = readJSON<unknown>(KEYS.blastQueue, null) != null;
  if (hasQueue) return q;

  const s = readJSON<Partial<BlastSession> | null>(KEYS.blastSession, null);
  if (!s) return q;

  const quick = quickPost(q);
  const untouched =
    !quick.text &&
    !Object.keys(quick.captions || {}).length &&
    !Object.keys(quick.status || {}).length;
  if (!untouched) return q;

  return updatePost(
    q,
    QUICK_KEY,
    (p) => ({
      ...p,
      text: typeof s.base === "string" ? s.base : "",
      hookText: typeof s.videoHook === "string" ? s.videoHook : "",
      captions: s.captions || {},
      titles: s.titles || {},
      suggestions: s.suggestions || {},
      picked: s.picked || {},
      status: s.status || {},
      postUrl: s.postUrl || {},
      postedAt: s.postedAt || {},
      postedCaption: s.postedCaption || {},
    }),
    quick.updatedAt,
  );
}

/**
 * Reset the Quick post only. A queued batch is the user's work, not session
 * scratch, and is cleared per-clip from its own card.
 *
 * Presets deliberately survive — they are a durable per-creator habit, not part
 * of a single posting session.
 */
export function resetQuick(q: BlastQueue, now = Date.now()): BlastQueue {
  return updatePost(
    q,
    QUICK_KEY,
    (p) => ({
      ...p,
      text: "",
      hookText: "",
      captions: {},
      titles: {},
      suggestions: {},
      picked: {},
      status: {},
      postUrl: {},
      postedAt: {},
      postedCaption: {},
    }),
    now,
  );
}
