/**
 * BLAST → PULSE, and PULSE's own backup restore.
 *
 * Ported from pulse/app.js (`importClipRecord` ~line 678, `importFromBlast`
 * ~line 766, `importJSON` ~line 1249). Both are pure here: they take the
 * current posts and return the new ones plus a count of what happened, so the
 * dedup rules can be tested without storage.
 */

import type { PulsePost } from "../../data/schemas/pulse";
import type { BlastPost, BlastQueue } from "../blast/queue";

export const HOOK_MAX = 300;

const PATTERN_FIELDS = ["patternId", "patternName", "patternFamily"] as const;
type PatternField = (typeof PATTERN_FIELDS)[number];

export function captionHook(caption: unknown): string {
  return String(caption || "").split("\n")[0]!.trim().slice(0, HOOK_MAX);
}

export function uid(rand = Math.random(), now = Date.now()): string {
  return "p_" + rand.toString(36).slice(2, 9) + now.toString(36);
}

/** The BLAST-session shape the importer consumes. A queue clip also matches it. */
export interface ClipRecord {
  status?: Record<string, string>;
  postUrl?: Record<string, string>;
  postedAt?: Record<string, number>;
  postedCaption?: Record<string, string>;
  captions?: Record<string, string>;
  base?: string;
  videoHook?: string;
  patternId?: string;
  patternName?: string;
  patternFamily?: string;
}

export interface ImportCounters {
  added: number;
  skipped: number;
  /** Posts with no live link yet — counted, and KEPT. */
  nolink: number;
  /** Already tracked, but regrouped onto this clip's id. */
  healed: number;
  /** Already tracked, but gained a hook or pattern they were missing. */
  enriched: number;
}

export function emptyCounters(): ImportCounters {
  return { added: 0, skipped: 0, nolink: 0, healed: 0, enriched: 0 };
}

function makePost(
  platform: string,
  url: string,
  caption: string,
  postedAt: number,
  hook: string,
  blastKey: string,
  clipKey: string,
  newId: () => string,
): PulsePost {
  // hook is its own field; when absent (legacy callers, old backups) fall back
  // to the caption's first line so nothing regresses.
  const h = hook != null && String(hook).trim() ? String(hook).trim() : captionHook(caption);
  const p: PulsePost = {
    id: newId(),
    platform,
    url: url || "",
    caption: caption || "",
    hook: h.slice(0, HOOK_MAX),
    postedAt: postedAt || Date.now(),
    snapshots: [],
    outcome: null,
    ledgerLoggedAt: null,
  };
  if (blastKey) p.blastKey = blastKey;
  // clipKey groups a clip's per-platform posts even when captions (and thus the
  // caption-derived hook) differ per platform.
  if (clipKey) p.clipKey = String(clipKey).slice(0, 300);
  return p;
}

/**
 * A re-import heals a post tracked before BLAST knew its hook or RECALL's
 * matched pattern. Two cases are worth overwriting a stored hook: there isn't
 * one, or the one there is is verbatim the caption's first line — the fallback
 * that put captions where hooks belong in the HOOKLAB ledger. Anything else the
 * user may have edited by hand, so it stands.
 */
export function enrichPost(p: PulsePost, hook: string, pat: Record<PatternField, string>): number {
  let changed = 0;
  if (hook) {
    const cur = String(p.hook || "").trim();
    if (!cur || cur === captionHook(p.caption)) {
      if (cur !== hook.slice(0, HOOK_MAX)) {
        p.hook = hook.slice(0, HOOK_MAX);
        changed++;
      }
    }
  }
  PATTERN_FIELDS.forEach((f) => {
    if (pat[f] && !p[f]) {
      p[f] = pat[f];
      changed++;
    }
  });
  return changed;
}

/**
 * Import one clip's worth of BLAST records into `posts` (mutated in place, as
 * the legacy does — the caller owns the array).
 *
 * `clipKeyOverride` lets a queued clip group by its RECALL identity instead of
 * by hook text, so a batch of 24 clips can never collapse into one.
 */
export function importClipRecord(
  posts: PulsePost[],
  s: ClipRecord,
  clipKeyOverride: string | null,
  counters: ImportCounters,
  now = Date.now(),
  newId: () => string = () => uid(),
): void {
  // A one-clip session could identify a post by platform + posted time. A batch
  // cannot: two clips marked posted to the same platform in the same
  // millisecond would collide and silently dedupe each other away. Queued clips
  // therefore scope the key by their RECALL identity. Legacy session imports
  // keep the original format so posts tracked before this still dedupe.
  const keyScope = clipKeyOverride ? clipKeyOverride + "|" : "";
  const status = s.status || {};
  const postUrl = s.postUrl || {};
  const postedAt = s.postedAt || {};
  const postedCaption = s.postedCaption || {};
  const captions = s.captions || {};
  const hook = (s.videoHook || "").trim();

  // RECALL worked out which proven pattern this clip's hook matches. It rides
  // the whole way here so an auto-promoted ledger entry can name its family
  // instead of every PULSE entry landing in "unknown".
  const pat = {} as Record<PatternField, string>;
  PATTERN_FIELDS.forEach((f) => {
    pat[f] = s[f] || "";
  });

  // Clip-level key shared by every platform of this clip: the hook if set, else
  // the base caption (written once, before per-platform tailoring). Per-platform
  // captions differ, so we must NOT group on those.
  const clipKey = clipKeyOverride || hook || String(s.base || "").trim();

  // Reuse the clipId already carried by any tracked post of this same clip
  // (dupe match or same clipKey; oldest post wins) — minting a fresh id per
  // call is what used to split a clip imported in two waves.
  let clipId = "";
  let clipIdAt = Infinity;
  const ckNorm = clipKey.toLowerCase();
  posts.forEach((p) => {
    if (!p.clipId || p.postedAt >= clipIdAt) return;
    let match = !!ckNorm && String(p.clipKey || "").trim().toLowerCase() === ckNorm;
    if (!match) {
      // same dupe predicate as the import loop below
      match = Object.keys(status).some((name) => {
        if (status[name] !== "posted") return false;
        const u = (postUrl[name] || "").trim();
        return (
          p.blastKey === keyScope + name + "|" + postedAt[name] ||
          (!!u && p.platform === name && p.url === u)
        );
      });
    }
    if (match) {
      clipId = p.clipId!;
      clipIdAt = p.postedAt;
    }
  });
  if (!clipId) clipId = newId();

  const c = counters;
  Object.keys(status).forEach((name) => {
    if (status[name] !== "posted") return;
    const url = (postUrl[name] || "").trim();
    const at = postedAt[name] || now;
    const blastKey = keyScope + name + "|" + at;

    // Identity, strongest first:
    //   1. clip + platform — one clip goes to one platform once, so this is
    //      what a tracked post actually IS. Checked first because the BLAST key
    //      below is NOT stable: toggling a platform's Posted mark off and on
    //      re-stamps postedAt, which minted a duplicate on the next import.
    //   2. the BLAST session key — still matches posts tracked before the clip
    //      had an id.
    //   3. (platform, url) — the original fallback, for the oldest posts.
    let dupe: PulsePost | null = null;
    for (const dp of posts) {
      if (
        (clipId && dp.clipId === clipId && dp.platform === name) ||
        dp.blastKey === blastKey ||
        (url && dp.platform === name && dp.url === url)
      ) {
        dupe = dp;
        break;
      }
    }

    if (dupe) {
      // Re-import heals grouping: unify this clip's shared clipId onto posts
      // tracked before clipId existed OR stamped with a divergent id by an
      // earlier import wave. The old id is kept in clipIdPrev (reversible).
      if (dupe.clipId !== clipId) {
        if (dupe.clipId) dupe.clipIdPrev = dupe.clipId;
        dupe.clipId = clipId;
        c.healed++;
      }
      if (enrichPost(dupe, hook, pat)) c.enriched++;
      c.skipped++;
      return;
    }

    const cap = postedCaption[name] || captions[name] || s.base || "";
    const np = makePost(name, url, cap, at, hook, blastKey, clipKey, newId);
    np.clipId = clipId;
    PATTERN_FIELDS.forEach((f) => {
      if (pat[f]) np[f] = pat[f];
    });
    posts.unshift(np);
    // A post with no link yet is counted so the UI can nudge for one — and
    // KEPT, because it is still a real post that went out.
    if (!url) c.nolink++;
    c.added++;
  });
}

export interface BlastImportResult {
  posts: PulsePost[];
  counters: ImportCounters;
  /** How many clips were read — drives "across N clips" in the summary. */
  clipsSeen: number;
  /** No queue and no session: there is nothing in this browser to import. */
  empty: boolean;
}

/**
 * Import everything BLAST has marked Posted.
 *
 * The queue is BLAST's source of truth; `blast_session_v1` is only its
 * projection of the quick clip. Importing the session when a queue exists meant
 * a stale projection (one left behind by an older build, or written before the
 * last sync) could win over the real, newer clip — which is how "only part of
 * my platforms transferred" happened. Queue present => import the queue,
 * including its quick clip. Session only for legacy devices.
 */
export function importFromBlast(
  current: PulsePost[],
  queue: BlastQueue | null,
  session: ClipRecord | null,
  now = Date.now(),
  newId: () => string = () => uid(),
): BlastImportResult {
  const qclips: BlastPost[] =
    queue && queue.v === 1 && Array.isArray(queue.clips) ? queue.clips : [];
  if (!session && !qclips.length) {
    return { posts: current, counters: emptyCounters(), clipsSeen: 0, empty: true };
  }

  const posts = current.map((p) => ({ ...p }));
  const counters = emptyCounters();
  let clipsSeen = 0;

  if (session && !qclips.length) {
    importClipRecord(posts, session, null, counters, now, newId);
    clipsSeen++;
  }

  qclips.forEach((clip) => {
    if (!clip.status || !Object.keys(clip.status).length) return;
    importClipRecord(
      posts,
      {
        status: clip.status,
        postUrl: clip.postUrl,
        postedAt: clip.postedAt,
        postedCaption: clip.postedCaption,
        captions: clip.captions,
        base: clip.text,
        videoHook: clip.hookText,
        patternId: clip.patternId,
        patternName: clip.patternName,
        patternFamily: clip.patternFamily,
      },
      // The quick clip keeps the LEGACY unscoped key format: it is the same
      // clip the session path used to import, and posts already tracked from it
      // carry unscoped blastKeys. Scoping it now would re-import every
      // link-less post as a duplicate. Batch clips still scope by their RECALL
      // identity, which is what keeps 24 clips from colliding.
      clip.key === "quick" ? null : clip.key,
      counters,
      now,
      newId,
    );
    clipsSeen++;
  });

  return { posts, counters, clipsSeen, empty: false };
}

/** A human summary of what an import actually did. */
export function importSummary(r: BlastImportResult): string {
  const c = r.counters;
  if (c.added) {
    let msg = `Imported ${c.added} post${c.added > 1 ? "s" : ""} from BLAST`;
    if (r.clipsSeen > 1) msg += ` across ${r.clipsSeen} clips`;
    if (c.nolink) {
      msg += ` — ${c.nolink} without links yet (add each link on its card for stats)`;
    } else if (c.skipped) {
      msg += ` (${c.skipped} already tracked)`;
    }
    if (c.healed) msg += `, regrouped ${c.healed} already-tracked`;
    if (c.enriched) msg += `, filled in the hook/pattern on ${c.enriched}`;
    return msg;
  }
  if (c.healed) {
    return `Regrouped ${c.healed} already-tracked post${c.healed > 1 ? "s" : ""} into this clip`;
  }
  if (c.enriched) {
    return `Filled in the hook and pattern on ${c.enriched} already-tracked post${
      c.enriched > 1 ? "s" : ""
    }`;
  }
  if (c.skipped) return "Those BLAST posts are already tracked";
  return "Nothing marked Posted in BLAST yet";
}

/**
 * Restore posts from a PULSE backup file.
 *
 * FIXES A LEGACY DATA-LOSS BUG. pulse/app.js:1264 opened with
 * `if (!p || !p.url) return;`, which silently discarded every post with no live
 * link — and import-from-blast routinely creates those (that is exactly what
 * `nolink` counts). Its dedup key was `platform|url`, so all of a platform's
 * link-less posts collapsed onto one key anyway.
 *
 * Here identity is the post `id`, which every post has and which survives a
 * round trip; `platform|url` remains as the fallback for older backups whose
 * posts predate ids, and is only consulted when a url actually exists.
 */
/**
 * Coerce a post from a backup file or a foreign device into the shape the rest
 * of the app can render.
 *
 * This is a system boundary: the JSON is arbitrary. Legacy got away without it
 * because every field went through `esc()` on the way to innerHTML, which
 * coerces null to "". React does no such thing — a post with no `caption`
 * throws during render, and because the bad post is already persisted, that
 * repeats on every load with the DELETE button unreachable behind the error.
 */
function normalizeImported(raw: Partial<PulsePost>, newId: () => string): PulsePost {
  return {
    ...raw,
    id: raw.id ? String(raw.id) : newId(),
    platform: String(raw.platform ?? ""),
    url: String(raw.url ?? ""),
    caption: String(raw.caption ?? ""),
    hook: String(raw.hook ?? ""),
    postedAt: Number(raw.postedAt) || Date.now(),
    snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
    outcome: raw.outcome ?? null,
    ledgerLoggedAt: raw.ledgerLoggedAt ?? null,
  };
}

export function importBackupPosts(
  current: PulsePost[],
  data: unknown,
  newId: () => string = () => uid(),
): { posts: PulsePost[]; added: number } {
  const incoming: unknown[] = Array.isArray(data)
    ? data
    : (((data as { posts?: unknown[] } | null)?.posts as unknown[]) ?? []);

  const posts = current.map((p) => ({ ...p }));
  const byId = new Set(posts.map((p) => p.id).filter(Boolean));
  const byUrl = new Set(
    posts.filter((p) => p.url).map((p) => `${p.platform}|${p.url}`),
  );

  let added = 0;
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const p = normalizeImported(raw as Partial<PulsePost>, newId);
    if (byId.has(p.id)) continue;
    if (p.url && byUrl.has(`${p.platform}|${p.url}`)) continue;
    byId.add(p.id);
    if (p.url) byUrl.add(`${p.platform}|${p.url}`);
    posts.unshift(p);
    added++;
  }
  return { posts, added };
}
