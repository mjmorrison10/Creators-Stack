/**
 * The two boot healers, ported from pulse/app.js (`migrateClipIds` ~line 88,
 * `healImportTwins` ~line 130).
 *
 * Both run once at boot, in this order, BEFORE the first paint — so the first
 * thing a creator sees is already healed. They repair damage two earlier
 * versions of the importer did, and they have to keep running because the
 * damaged rows are still in people's browsers and still arrive over sync.
 *
 * Ported as pure functions returning new arrays rather than mutating in place
 * as the legacy does (the repo's immutability rule). The observable results are
 * identical, which the differential test proves against the original.
 */

import type { PulsePost } from "../../data/schemas/pulse";
import type { Snapshot } from "../../data/schemas/pulse";

const PATTERN_FIELDS = ["patternId", "patternName", "patternFamily"] as const;

/**
 * Heal split clips.
 *
 * A re-import used to mint a NEW clipId per call, so a clip imported in two
 * waves (some platforms posted later) got two ids → two cards, even though
 * every post shared the same clipKey. Unify: same non-empty clipKey means one
 * canonical clipId — the one whose earliest post is oldest. Replaced ids are
 * stashed in `clipIdPrev`, so the rewrite stays reversible.
 *
 * Idempotent: a second run finds every bucket already unified and changes
 * nothing.
 */
export function migrateClipIds(posts: PulsePost[]): { posts: PulsePost[]; changed: number } {
  // Bucket by normalized clipKey. A post with no clipKey is NEVER touched —
  // the clipKey render tier already groups those.
  const buckets = new Map<string, PulsePost[]>();
  for (const p of posts) {
    const k = String(p.clipKey || "").trim().toLowerCase();
    if (!k) continue;
    const list = buckets.get(k);
    if (list) list.push(p);
    else buckets.set(k, [p]);
  }

  /** postId → the clipId it should end up with. */
  const rewrite = new Map<string, string>();
  let changed = 0;

  for (const list of buckets.values()) {
    // Earliest post per clipId, over posts that HAVE one.
    const earliest = new Map<string, number>();
    for (const p of list) {
      if (!p.clipId) continue;
      const cur = earliest.get(p.clipId);
      if (cur === undefined || p.postedAt < cur) earliest.set(p.clipId, p.postedAt);
    }
    const ids = [...earliest.keys()];
    if (!ids.length) continue; // no clipIds here at all

    // Strict `<`, so a tie keeps the first-encountered id — insertion order,
    // exactly as the legacy's Object.keys seed behaves.
    let canonical = ids[0]!;
    for (const id of ids) {
      if (earliest.get(id)! < earliest.get(canonical)!) canonical = id;
    }

    for (const p of list) {
      if (p.clipId === canonical) continue;
      rewrite.set(p.id, canonical);
      changed++;
    }
  }

  if (!changed) return { posts, changed: 0 };

  return {
    posts: posts.map((p) => {
      const next = rewrite.get(p.id);
      if (next === undefined) return p;
      // A post in the bucket with NO clipId also lands here — it adopts the
      // canonical id, and gets no `clipIdPrev` because there was nothing to
      // stash. Bucket membership alone is enough to adopt.
      return p.clipId ? { ...p, clipIdPrev: p.clipId, clipId: next } : { ...p, clipId: next };
    }),
    changed,
  };
}

/**
 * Rank a twin group richest-first: a manual verdict, then a live link, then the
 * most readings, then the earliest post. Extracted so the differential and the
 * mutation tests can aim at it directly.
 */
function rankTwins(list: PulsePost[]): PulsePost[] {
  return list.slice().sort((a, b) => {
    const ao = a.outcome ? 1 : 0;
    const bo = b.outcome ? 1 : 0;
    if (ao !== bo) return bo - ao;
    const au = (a.url || "").trim() ? 1 : 0;
    const bu = (b.url || "").trim() ? 1 : 0;
    if (au !== bu) return bu - au;
    const an = (a.snapshots || []).length;
    const bn = (b.snapshots || []).length;
    if (an !== bn) return bn - an;
    return a.postedAt - b.postedAt;
  });
}

/**
 * Union a group's snapshots, newest reading winning each checkpoint.
 *
 * Iteration runs in ORIGINAL posts order, not ranked order, so an equal `at`
 * keeps the first encountered — that ordering is observable and is preserved.
 */
function unionSnapshots(list: PulsePost[]): Snapshot[] {
  const byMin = new Map<number, Snapshot>();
  for (const p of list) {
    for (const sn of p.snapshots || []) {
      if (!sn) continue;
      const ex = byMin.get(sn.elapsedMin);
      if (!ex || (sn.at || 0) > (ex.at || 0)) byMin.set(sn.elapsedMin, sn);
    }
  }
  return [...byMin.values()].sort((x, y) => x.elapsedMin - y.elapsedMin);
}

export interface HealResult {
  posts: PulsePost[];
  /** Number of posts DROPPED, not groups merged. */
  merged: number;
  /** Ids the caller must tombstone, or a sync brings the twins back. */
  dropped: string[];
}

/**
 * Heal duplicate imports.
 *
 * One clip goes to one platform once, so `clipId + platform` identifies a
 * tracked post. The importer used BLAST's posted-at timestamp as its identity
 * instead, and that timestamp is re-stamped whenever a platform's Posted mark
 * is toggled off and back on — so re-marking and re-importing minted a TWIN.
 * Platforms whose live URL is rarely pasted (Pinterest) had no fallback match
 * to save them, and the twins carried re-mark times rather than real posting
 * times, which is what scrambled the by-platform ordering.
 *
 * Merge each twin group into the richest post: union the snapshots (newest
 * reading wins a checkpoint), keep the EARLIEST postedAt (the real posting
 * moment, which restores ordering), and never lose a url, hook, outcome or
 * ledger stamp that only a dropped twin had.
 *
 * Posts without a clipId are hand-added and are never touched.
 */
export function healImportTwins(posts: PulsePost[]): HealResult {
  const groups = new Map<string, PulsePost[]>();
  for (const p of posts) {
    if (!p || !p.clipId) continue;
    const k = p.clipId + "|" + p.platform;
    const list = groups.get(k);
    if (list) list.push(p);
    else groups.set(k, [p]);
  }

  const drop = new Set<string>();
  const replacement = new Map<string, PulsePost>();
  let merged = 0;

  for (const list of groups.values()) {
    if (list.length < 2) continue;

    const ranked = rankTwins(list);
    const keep = { ...ranked[0]! };
    const rest = ranked.slice(1);

    keep.snapshots = unionSnapshots(list);
    for (const p of list) {
      if (p.postedAt < keep.postedAt) keep.postedAt = p.postedAt;
    }

    // Inheritance, in ranked order. Every rule is "only when keep's is empty",
    // so the richest post's own values always win.
    for (const p of rest) {
      if (!(keep.url || "").trim() && (p.url || "").trim()) keep.url = p.url;
      if (!(keep.hook || "").trim() && (p.hook || "").trim()) keep.hook = p.hook;
      if (!(keep.caption || "").trim() && (p.caption || "").trim()) keep.caption = p.caption;
      if (!keep.outcome && p.outcome) {
        keep.outcome = p.outcome;
        // The ledger stamp rides along WITH the verdict and only with it.
        keep.ledgerLoggedAt = p.ledgerLoggedAt || keep.ledgerLoggedAt;
      }
      if (!keep.clipKey && p.clipKey) keep.clipKey = p.clipKey;
      for (const f of PATTERN_FIELDS) {
        if (!keep[f] && p[f]) keep[f] = p[f];
      }
      drop.add(p.id);
      merged++;
    }
    replacement.set(keep.id, keep);
  }

  if (!merged) return { posts, merged: 0, dropped: [] };

  return {
    posts: posts.filter((p) => !drop.has(p.id)).map((p) => replacement.get(p.id) ?? p),
    merged,
    dropped: [...drop],
  };
}
