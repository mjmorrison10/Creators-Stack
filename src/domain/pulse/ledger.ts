/**
 * PULSE → HOOKLAB. Ported from pulse/app.js (`logToLedger` ~342,
 * `deleteLedgerEntry` ~370, `syncAutoWinners` ~557, `announceAuto` ~623).
 *
 * Two writers, two id namespaces, and they must never collide:
 *   - `pulse_<postId>`     — the creator pressed winner/meh/dead.
 *   - `pulseauto_<postId>` — the promotion engine decided, with no human.
 *
 * Because they are disjoint, the auto pass can rewrite its whole namespace from
 * scratch on every save without ever touching a manual verdict or a
 * HOOKLAB-native entry.
 */

import { KEYS } from "../../data/keys";
import { readJSON, writeJSON } from "../../data/storage";
import type { PulsePost } from "../../data/schemas/pulse";
import { latestSnap } from "./snapshots";
import { AUTO_PREFIX, computeAutoWinners, mediumFor } from "./promotion";

/** The HOOKLAB blob, as far as PULSE needs to understand it. */
interface HooklabState {
  ledger: Record<string, unknown>[];
  comps: Record<string, unknown>[];
  [k: string]: unknown;
}

function readHooklab(): HooklabState {
  const st = readJSON<Partial<HooklabState> | null>(KEYS.hooklabState, null);
  const base = st && typeof st === "object" ? st : {};
  return {
    ...base,
    ledger: Array.isArray(base.ledger) ? base.ledger : [],
    comps: Array.isArray(base.comps) ? base.comps : [],
  };
}

export function ledgerIdFor(post: PulsePost): string {
  return "pulse_" + post.id;
}

export type Outcome = "winner" | "meh" | "dead";

/**
 * The entry PULSE writes when the creator judges a post.
 *
 * `patternName` is deliberately NOT carried — legacy records only the id and
 * the family, and HOOKLAB resolves the name from its own bank.
 */
export function buildLedgerEntry(
  post: PulsePost,
  outcome: Outcome,
  now = new Date(),
): Record<string, unknown> {
  const latest = latestSnap(post);
  return {
    id: ledgerIdFor(post),
    hook: String(post.hook || post.caption || "").split("\n")[0]!.slice(0, 300) || "(clip)",
    patternId: post.patternId || "",
    family: post.patternFamily || "unknown",
    outcome,
    platform: post.platform,
    medium: mediumFor(post.platform),
    niche: "general",
    retention: "",
    views: latest ? String(latest.views) : "",
    // Trailing space when the post has no link — preserved, because the string
    // is already in people's ledgers and changing it would make a re-log look
    // like a different entry.
    notes: "via PULSE: " + post.url,
    createdAt: now.toISOString(),
    source: "pulse",
  };
}

export interface LogResult {
  ok: boolean;
  /** The post with its verdict stamped — only when the write landed. */
  post: PulsePost;
}

/**
 * Write the creator's verdict into the HOOKLAB ledger.
 *
 * Re-logging REPLACES the prior entry for this post and moves it to the front,
 * so changing your mind updates one row rather than accumulating three. The
 * post is only stamped when the write actually landed: a stamp with no ledger
 * row behind it would tell the creator their verdict was recorded when it
 * wasn't.
 */
export function logToLedger(
  post: PulsePost,
  outcome: Outcome,
  now = Date.now(),
): LogResult {
  const st = readHooklab();
  const entry = buildLedgerEntry(post, outcome, new Date(now));
  const ledger = st.ledger.filter((e) => e && e.id !== entry.id);
  ledger.unshift(entry);

  try {
    writeJSON(KEYS.hooklabState, { ...st, ledger });
  } catch {
    return { ok: false, post };
  }
  return { ok: true, post: { ...post, outcome, ledgerLoggedAt: now } };
}

/**
 * Remove this post's PULSE-written entry.
 *
 * Matches only the deterministic `pulse_<id>`, so it can never touch a
 * HOOKLAB-native entry or an auto-promoted one. Returns false when nothing was
 * actually removed, which is what tells the caller not to tombstone.
 */
export function deleteLedgerEntry(post: PulsePost): boolean {
  const st = readHooklab();
  if (!st.ledger.length) return false;
  const wanted = ledgerIdFor(post);
  const ledger = st.ledger.filter((e) => !(e && e.id === wanted));
  if (ledger.length === st.ledger.length) return false;
  try {
    writeJSON(KEYS.hooklabState, { ...st, ledger });
    return true;
  } catch {
    return false;
  }
}

/** Did a re-promotion change anything a human would notice? */
function autoSame(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return (
    !!a &&
    !!b &&
    a.hook === b.hook &&
    a.platform === b.platform &&
    a.views === b.views &&
    a.notes === b.notes &&
    a.outcome === b.outcome &&
    a.source === b.source &&
    // Included so a re-import that finally supplies the pattern UPDATES the
    // entry instead of being seen as no change.
    a.patternId === b.patternId &&
    a.family === b.family
  );
}

export interface AutoDelta {
  added: number;
  changed: number;
  dropped: number;
  /** Ledger ids the caller must tombstone, or a sync resurrects them. */
  tombstone: string[];
}

export interface AutoSyncResult {
  /** null when nothing changed — no write, no notice. */
  delta: AutoDelta | null;
  /** postId → true for every post whose hook is currently auto-promoted. */
  promoted: Record<string, true>;
}

/**
 * Recompute the whole auto set from scratch and apply only the difference.
 *
 * Auto entries are derived state under their own id namespace, so this can
 * never touch a manual `pulse_*` or HOOKLAB-native entry — and a stale entry
 * resurrected by a sync from another device is cleaned up on the next pass.
 * That is the property that lets it run on every single save.
 *
 * A post that falls out of the top decile has its auto entry RETRACTED, which
 * is why the removals are tombstoned: without that, the next Drive merge would
 * bring back a claim the numbers no longer support.
 */
export function syncAutoWinners(posts: PulsePost[], now = Date.now()): AutoSyncResult {
  const desired = computeAutoWinners(posts);

  const promoted: Record<string, true> = {};
  for (const d of desired) for (const id of d.postIds) promoted[id] = true;

  const st = readHooklab();
  const isAuto = (e: Record<string, unknown>): boolean =>
    !!e && typeof e.id === "string" && e.id.indexOf(AUTO_PREFIX) === 0;

  const current = new Map<string, Record<string, unknown>>();
  for (const e of st.ledger) if (isAuto(e)) current.set(e.id as string, e);

  const keep = new Map<string, Record<string, unknown>>();
  const stamp = new Date(now).toISOString();
  let added = 0;
  let changed = 0;

  for (const d of desired) {
    const prev = current.get(d.entry.id);
    if (!prev) {
      added++;
      keep.set(d.entry.id, { ...d.entry, createdAt: stamp });
    } else if (!autoSame(prev, d.entry as unknown as Record<string, unknown>)) {
      changed++;
      keep.set(d.entry.id, { ...prev, ...d.entry, createdAt: stamp });
    } else {
      keep.set(d.entry.id, prev);
    }
  }

  const dropped: string[] = [];
  for (const id of current.keys()) if (!keep.has(id)) dropped.push(id);

  if (!added && !changed && !dropped.length) return { delta: null, promoted };

  // Autos first in desired order, then everything that isn't ours, untouched.
  const ledger = desired
    .map((d) => keep.get(d.entry.id)!)
    .concat(st.ledger.filter((e) => !isAuto(e)));

  try {
    writeJSON(KEYS.hooklabState, { ...st, ledger });
  } catch {
    return { delta: null, promoted };
  }

  return { delta: { added, changed, dropped: dropped.length, tombstone: dropped }, promoted };
}

/**
 * What to tell the creator about an auto pass. Null when the only change was
 * figures — a refresh of the numbers inside an existing entry isn't news.
 */
export function announceAuto(d: AutoDelta): string | null {
  const bits: string[] = [];
  if (d.added) {
    bits.push(`✦ ${d.added} hook${d.added > 1 ? "s" : ""} auto-promoted to HOOKLAB`);
  }
  if (d.dropped) {
    bits.push(`${d.dropped} auto hook${d.dropped > 1 ? "s" : ""} dropped (outperformed)`);
  }
  return bits.length ? bits.join(" · ") : null;
}
