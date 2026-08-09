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
import { QuotaError, readJSON, readRaw, writeJSON, writeRaw } from "../../data/storage";
import { PLATFORMS } from "./platforms";
import type { PostStatus } from "./platforms";

/** Maps keyed by platform display name. */
export type ByPlatform<T> = Record<string, T>;

/**
 * One generated caption option.
 *
 * Pinterest's are `{title, description}` objects rather than strings — legacy
 * BLAST persists them that way and splits them across `captions` and `titles`
 * (blast/app.js:1346-1361). This key is shared with the still-deployed app, so
 * the shape is not ours to simplify.
 */
export type SuggestionOption = string | { title: string; description: string };

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
  suggestions: ByPlatform<SuggestionOption[]>;
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
 * Fill in anything a stored clip is missing, so the rest of the app can treat
 * every field as present. `blankPost` supplies the defaults; the stored values
 * win wherever they exist.
 */
function normalizeClip(p: Partial<BlastPost>): BlastPost {
  const base = blankPost(String(p?.key || ""), {}, p?.createdAt ?? Date.now());
  return {
    ...base,
    ...p,
    key: String(p?.key || ""),
    text: String(p?.text ?? ""),
    hookText: String(p?.hookText ?? ""),
    captions: p?.captions ?? {},
    titles: p?.titles ?? {},
    suggestions: p?.suggestions ?? {},
    picked: p?.picked ?? {},
    status: p?.status ?? {},
    postUrl: p?.postUrl ?? {},
    postedAt: p?.postedAt ?? {},
    postedCaption: p?.postedCaption ?? {},
  };
}

/**
 * Read the queue, guaranteeing the Quick post exists and sorts first. The
 * legacy invariant: Quick is permanent and always index 0.
 */
export function loadQueue(): BlastQueue {
  const raw = readJSON<Partial<BlastQueue> | null>(KEYS.blastQueue, null);
  const ok = raw && raw.v === 1 && Array.isArray(raw.clips);
  // Normalized on read, as legacy's `bindPost` does (blast/app.js:363-371).
  // Three other deployed apps and a sync merge write this key, so a clip
  // arriving without its maps is a rendering crash rather than a missing field.
  let clips = ok ? (raw.clips as Partial<BlastPost>[]).map(normalizeClip) : [];

  const quick = clips.find((p) => p.key === QUICK_KEY);
  if (!quick) clips = [blankPost(QUICK_KEY), ...clips];
  else if (clips[0] !== quick) clips = [quick, ...clips.filter((p) => p !== quick)];

  return {
    v: 1,
    updatedAt: (ok && raw.updatedAt) || Date.now(),
    defaultPlatforms: (ok && raw.defaultPlatforms) || null,
    // NOT from the queue blob. `blast_batch_count_v1` is the source of truth
    // for the setting; the copy inside the blob exists only so the value rides
    // along to another device on sync. Reading the blob would let a synced
    // queue silently change this device's setting.
    batchCount: readBatchCount(),
    clips,
  };
}

/** Only 1, 2 and 3 are offered; anything else is a corrupt or future value. */
export function normalizeBatchCount(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return n === 2 || n === 3 ? n : 1;
}

export function readBatchCount(): number {
  return normalizeBatchCount(readRaw(KEYS.blastBatchCount));
}

export function writeBatchCount(v: number): void {
  writeRaw(KEYS.blastBatchCount, String(normalizeBatchCount(v)));
}

export interface SaveResult {
  ok: boolean;
  /** The queue as persisted — with any shed suggestions actually removed. */
  queue: BlastQueue;
  /** Clips whose unpicked suggestions were dropped to make room. */
  shed: number;
}

/**
 * Persist the queue, shedding unpicked suggestions if the store is full.
 *
 * Suggestion arrays are by far the biggest thing in here, so a full batch
 * degrades to "captions kept, extra options lost" rather than "nothing saved".
 * The Quick post is never shed — it is the one the user is looking at.
 *
 * Shedding order note: the legacy comment says "oldest clips first" but its
 * loop runs from the end of the array backwards, which sheds the MOST RECENTLY
 * ADDED clip first. The behavior is ported, not the comment — a user's oldest
 * queued clip is the one they are most likely still working through, so
 * dropping the newest first is also the better of the two.
 *
 * Callers must use the returned queue: the shed is real, and continuing with
 * the pre-shed object would put the dropped suggestions back on the next save.
 */
export function saveQueue(q: BlastQueue, now = Date.now()): SaveResult {
  let queue: BlastQueue = { ...q, v: 1, updatedAt: now, batchCount: readBatchCount() };
  let shed = 0;

  for (;;) {
    try {
      writeJSON(KEYS.blastQueue, queue);
      return { ok: true, queue, shed };
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e;
      const at = lastSheddableIndex(queue.clips);
      if (at < 0) return { ok: false, queue, shed };
      queue = {
        ...queue,
        clips: queue.clips.map((p, i) => (i === at ? { ...p, suggestions: {} } : p)),
      };
      shed++;
    }
  }
}

/** Newest-first, skipping Quick and anything with nothing left to drop. */
function lastSheddableIndex(clips: BlastPost[]): number {
  for (let i = clips.length - 1; i >= 0; i--) {
    const p = clips[i]!;
    if (p.key === QUICK_KEY) continue;
    if (Object.keys(p.suggestions || {}).length) return i;
  }
  return -1;
}

/**
 * Clear the posting marks a previous clip left behind.
 *
 * Ported from `startFreshPostingSession` (blast/app.js:1863). New captions mean
 * a new posting session: leaving the old marks made the grid claim platforms
 * were already posted for a clip that had never been posted anywhere, and PULSE
 * then imported the new captions attached to the OLD clip's URLs and
 * timestamps — corrupting the stats it later fetched against those links.
 *
 * `carried` reports whether anything was actually cleared, and `posted` how
 * many were marked posted, so the caller can confirm before discarding marks
 * the user may not have imported into PULSE yet.
 */
export function postingMarks(p: BlastPost): { carried: string[]; posted: string[] } {
  const names = Object.keys(p.status || {});
  return {
    carried: names.filter((n) => p.status[n] && p.status[n] !== "none"),
    posted: names.filter((n) => p.status[n] === "posted"),
  };
}

export function startFreshPosting(p: BlastPost): BlastPost {
  return { ...p, status: {}, postUrl: {}, postedAt: {}, postedCaption: {} };
}

/**
 * A suggestion is a plain string for every platform except Pinterest, whose
 * options are `{title, description}`. These read either shape, so a legacy
 * session with string Pinterest suggestions degrades to description-only
 * rather than breaking (blast/app.js:567-572).
 */
export function suggestLabel(s: SuggestionOption | undefined): string {
  if (s && typeof s === "object") return (s.title ? s.title + " — " : "") + (s.description || "");
  return String(s ?? "");
}

export function suggestDesc(s: SuggestionOption | undefined): string {
  return s && typeof s === "object" ? String(s.description || "") : String(s ?? "");
}

export function suggestTitle(s: SuggestionOption | undefined): string {
  return s && typeof s === "object" ? String(s.title || "") : "";
}

/**
 * Attach freshly generated options to a clip — the SUGGEST-button path
 * (blast/app.js:1822-1837).
 *
 * Captions are deliberately NOT overwritten: the user picks an option from the
 * chips, and silently replacing a caption they hand-wrote would be a
 * destructive answer to "show me some options". The stored pick is CLEARED,
 * because an index into the previous array outlives a regeneration that
 * returned fewer options and would otherwise highlight a chip that no longer
 * exists.
 */
export function attachSuggestions(
  p: BlastPost,
  byPlatform: ByPlatform<SuggestionOption[]>,
): BlastPost {
  const suggestions = { ...p.suggestions };
  const picked = { ...p.picked };
  for (const [name, opts] of Object.entries(byPlatform)) {
    if (!Array.isArray(opts) || !opts.length) continue;
    suggestions[name] = opts;
    delete picked[name];
  }
  return { ...p, suggestions, picked };
}

/**
 * Choose one option for a platform — the chip click (blast/app.js:714-721).
 * Pinterest's title lands in `titles`, separate from the description.
 */
export function pickSuggestion(p: BlastPost, name: string, idx: number): BlastPost {
  const opt = (p.suggestions[name] || [])[idx];
  if (opt === undefined) return p;
  return {
    ...p,
    picked: { ...p.picked, [name]: idx },
    captions: { ...p.captions, [name]: suggestDesc(opt) },
    titles: { ...p.titles, [name]: suggestTitle(opt).slice(0, 100) },
  };
}

/** Typing your own caption clears the pick it no longer matches. */
export function clearPick(p: BlastPost, name: string): BlastPost {
  if (!(name in p.picked)) return p;
  const picked = { ...p.picked };
  delete picked[name];
  return { ...p, picked };
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
  suggestions: ByPlatform<SuggestionOption[]>;
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
  try {
    writeJSON(KEYS.blastSession, buildSessionProjection(quickPost(q), transcript, now));
  } catch {
    // Quota — non-fatal, exactly as legacy treats it (blast/app.js:487). The
    // projection is derived state: the queue is the truth and `saveQueue` has
    // already reported its own failure. Letting this throw would take down the
    // render — it is called from a mutation path and there is no error
    // boundary — at the precise moment the shedding machinery is supposed to
    // be degrading gracefully.
  }
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
