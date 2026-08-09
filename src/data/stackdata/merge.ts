/**
 * The merge engine — ported from stackdata.js lines 209-439.
 *
 * Two exports in, one export plus a report out. Every rule is a union with a
 * deterministic tiebreak, and every collection is sorted before serialization,
 * which together make the merge IDEMPOTENT:
 *
 *     merge(merge(a, b), b) === merge(a, b)
 *
 * That property is load-bearing. Without it two devices ping-pong edits at each
 * other forever, and the symptom shows up days after the change that caused it.
 * The sorts are not cosmetic — they make the output a function of the DATA
 * rather than of which side happened to be newer. Do not remove one.
 *
 * Ported near-verbatim on purpose; tests/unit/merge-golden.test.ts asserts this
 * emits byte-identical JSON to the original engine.
 */

import { KEYS, isStackKey } from "../keys";
import { SYNC_EXCLUDE, ALWAYS_EXCLUDE } from "./constants";
import { mergeTomb } from "./tombstones";
import { workspaceConflict } from "./workspace";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type MergeReport,
  type StackBackup,
  type Tombstones,
} from "../schemas/stack";
import type { RecallLibrary, RecallSource, RecallBinItem } from "../schemas/recall";
import type { PulsePost, Snapshot } from "../schemas/pulse";
import type { LedgerEntry, CompEntry, HooklabState } from "../schemas/hooklab";
import type { BlastQueue, BlastClip } from "../schemas/blast";

/** Parse-or-fallback, matching the legacy `pj` helper. */
function pj<T>(s: string | undefined | null, fb: T): T {
  if (s == null) return fb;
  try {
    const v = JSON.parse(s) as T;
    return v == null ? fb : v;
  } catch {
    return fb;
  }
}

/** Most recent snapshot time, falling back to postedAt. */
function snapAt(p: PulsePost): number {
  let m = 0;
  for (const s of p.snapshots || []) {
    if ((s.at || 0) > m) m = s.at;
  }
  return m || p.postedAt || 0;
}

/**
 * Fold two PULSE posts describing the same logical clip into one. `keep`
 * supplies the surviving id.
 */
export function mergePost(keep: PulsePost, other: PulsePost): PulsePost {
  const byMin = new Map<number, Snapshot>();
  for (const sn of [...(keep.snapshots || []), ...(other.snapshots || [])]) {
    if (!sn) continue;
    const ex = byMin.get(sn.elapsedMin);
    if (!ex || (sn.at || 0) > (ex.at || 0)) byMin.set(sn.elapsedMin, sn);
  }
  const snaps = [...byMin.values()].sort((x, y) => x.elapsedMin - y.elapsedMin);

  const base = snapAt(keep) >= snapAt(other) ? keep : other;
  const alt = base === keep ? other : keep;

  const out = { ...alt, ...base } as PulsePost;
  out.snapshots = snaps;

  const pa = keep.postedAt == null ? Infinity : keep.postedAt;
  const pb = other.postedAt == null ? Infinity : other.postedAt;
  out.postedAt = Math.min(pa, pb);
  if (!isFinite(out.postedAt)) out.postedAt = base.postedAt;

  out.outcome = base.outcome != null ? base.outcome : alt.outcome;
  out.ledgerLoggedAt =
    base.ledgerLoggedAt != null ? base.ledgerLoggedAt : alt.ledgerLoggedAt;
  out.id = keep.id;
  return out;
}

interface Identified {
  id: string;
  createdAt?: string;
}

/**
 * Union two id'd arrays. The newer export's items are added first so ties go to
 * it. Per-item conflicts resolve by `timeOf` (max wins). An item is dropped when
 * its tombstone is newer than the item itself — note this is STRICTER than the
 * plain key-presence test the RECALL/PULSE/BLAST paths use. The asymmetry is
 * deliberate and load-bearing; normalizing it changes what a delete resurrects.
 */
function mergeById<T extends Identified>(
  arrA: T[],
  arrB: T[],
  aNew: boolean,
  kind: string,
  tomb: Tombstones,
  timeOf: (x: T) => number,
): T[] {
  const map = new Map<string, T>();
  const order: string[] = [];

  const suppressed = (it: T): boolean => {
    const key = `${kind}:${it.id}`;
    if (!Object.prototype.hasOwnProperty.call(tomb, key)) return false;
    return tomb[key]! > (timeOf(it) || 0);
  };

  const add = (arr: T[]): void => {
    for (const it of arr || []) {
      if (!it || it.id == null) continue;
      if (suppressed(it)) continue;
      const cur = map.get(it.id);
      if (!cur) {
        map.set(it.id, it);
        order.push(it.id);
      } else if (timeOf(it) >= timeOf(cur)) {
        map.set(it.id, it);
      }
    }
  };

  add(aNew ? arrB : arrA);
  add(aNew ? arrA : arrB);

  const res = order.map((id) => map.get(id)).filter((x): x is T => Boolean(x));
  // Newest first, matching HOOKLAB's unshift ordering — the fatigue and
  // recency logic reads index 0 as the most recent entry.
  res.sort((x, y) => (Date.parse(y.createdAt ?? "") || 0) - (Date.parse(x.createdAt ?? "") || 0));
  return res;
}

/**
 * When PULSE duplicates collapse (id B folded into kept id A), fold their
 * `pulse_<id>` HOOKLAB ledger entries together too, or the ledger keeps an
 * entry pointing at a post that no longer exists.
 */
function applyLedgerCollapses(
  ledger: LedgerEntry[],
  collapses: Record<string, string>,
): LedgerEntry[] {
  if (!collapses || Object.keys(collapses).length === 0) return ledger;

  const byId = new Map<string, LedgerEntry>();
  for (const e of ledger) byId.set(e.id, e);

  for (const dropId of Object.keys(collapses)) {
    const keepLid = `pulse_${collapses[dropId]}`;
    const dropLid = `pulse_${dropId}`;
    const de = byId.get(dropLid);
    const ke = byId.get(keepLid);
    if (de && ke) {
      if ((Date.parse(de.createdAt ?? "") || 0) > (Date.parse(ke.createdAt ?? "") || 0)) {
        ke.hook = de.hook;
        ke.outcome = de.outcome;
        ke.createdAt = de.createdAt;
      }
      byId.delete(dropLid);
    } else if (de && !ke) {
      de.id = keepLid;
      byId.set(keepLid, de);
      byId.delete(dropLid);
    }
  }

  return [...byId.values()].sort(
    (x, y) => (Date.parse(y.createdAt ?? "") || 0) - (Date.parse(x.createdAt ?? "") || 0),
  );
}

export interface MergeResult {
  data: StackBackup;
  report: MergeReport;
}

export class WorkspaceMismatchError extends Error {
  readonly code = "WORKSPACE_MISMATCH" as const;
  constructor(
    readonly localName: string,
    readonly remoteName: string,
  ) {
    super(`Workspace mismatch: "${localName}" vs "${remoteName}"`);
    this.name = "WorkspaceMismatchError";
  }
}

/** Merge two exports into one v2 export plus a report. */
export function mergeStates(
  a: Partial<StackBackup> | null | undefined,
  b: Partial<StackBackup> | null | undefined,
  now: () => string = () => new Date().toISOString(),
): MergeResult {
  const A = a ?? {};
  const B = b ?? {};
  const aLS: Record<string, string> = A.localStorage ?? {};
  const bLS: Record<string, string> = B.localStorage ?? {};

  // 1. Guard first — merging two unrelated stacks is unrecoverable.
  const conflict = workspaceConflict(A, B);
  if (conflict) throw new WorkspaceMismatchError(conflict.localName, conflict.remoteName);

  // 2. Tie goes to local (a), deterministically.
  const ta = Date.parse(A.exportedAt ?? "") || 0;
  const tb = Date.parse(B.exportedAt ?? "") || 0;
  const aNew = ta >= tb;

  const report: MergeReport = {
    added: { sources: 0, posts: 0, ledger: 0, comps: 0 },
    tombstoned: 0,
    conflicts: 0,
    unknownKeys: [],
  };
  const out: Record<string, string> = {};

  // 3. Tombstones. tombHard is plain key presence — see mergeById for the
  //    stricter variant used on id'd collections.
  const tomb = mergeTomb(
    pj<Tombstones>(aLS[KEYS.stackTombstones], {}),
    pj<Tombstones>(bLS[KEYS.stackTombstones], {}),
  );
  const tombHard = (kind: string, id: string): boolean =>
    Object.prototype.hasOwnProperty.call(tomb, `${kind}:${id}`);

  // 4. RECALL library.
  const libA = A.recallLibrary;
  const libB = B.recallLibrary;
  let mergedLib: RecallLibrary | null = null;
  let srcIds = new Map<string, RecallSource>();

  if (libA || libB) {
    const lA = libA ?? ({} as Partial<RecallLibrary>);
    const lB = libB ?? ({} as Partial<RecallLibrary>);
    const older = aNew ? lB : lA;
    const newer = aNew ? lA : lB;

    const smap = new Map<string, RecallSource>();
    const sorder: string[] = [];
    for (const s of older.sources ?? []) {
      if (!s || !s.id || tombHard("recallSource", s.id)) continue;
      if (!smap.has(s.id)) {
        smap.set(s.id, s);
        sorder.push(s.id);
      }
    }
    for (const s of newer.sources ?? []) {
      if (!s || !s.id || tombHard("recallSource", s.id)) continue;
      const cur = smap.get(s.id);
      if (!cur) {
        smap.set(s.id, s);
        sorder.push(s.id);
      } else if ((s.segments ?? []).length >= (cur.segments ?? []).length) {
        // More segments wins: a truncated copy must never beat a full one.
        smap.set(s.id, s);
      }
    }
    srcIds = smap;

    const enSet = new Set<string>();
    for (const id of [...(lA.enabled ?? []), ...(lB.enabled ?? [])]) {
      if (smap.has(id)) enSet.add(id);
    }

    const bmap = new Map<string, RecallBinItem>();
    const border: string[] = [];
    const addBin = (arr: RecallBinItem[] | undefined): void => {
      for (const bn of arr ?? []) {
        if (!bn || bn.key == null || !smap.has(bn.srcId)) continue;
        if (!bmap.has(bn.key)) border.push(bn.key);
        bmap.set(bn.key, bn);
      }
    };
    addBin(older.bin);
    addBin(newer.bin);

    sorder.sort();
    border.sort();
    mergedLib = {
      sources: sorder.map((id) => smap.get(id)!),
      enabled: [...enSet].sort(),
      bin: border.map((k) => bmap.get(k)!),
    };
  }

  // 5. recall_topclips_v1 — per-source scan cache, greater savedAt wins.
  type TcMap = Record<string, { savedAt?: number } & Record<string, unknown>>;
  const tcA = pj<TcMap>(aLS[KEYS.recallTopclips], {});
  const tcB = pj<TcMap>(bLS[KEYS.recallTopclips], {});
  const tcOut: TcMap = {};
  const allTc = new Set([...Object.keys(tcA), ...Object.keys(tcB)]);
  for (const id of allTc) {
    if (mergedLib && !srcIds.has(id)) continue; // scans for dead sources
    const ea = tcA[id];
    const eb = tcB[id];
    const pick = ea && eb ? ((ea.savedAt ?? 0) >= (eb.savedAt ?? 0) ? ea : eb) : (ea ?? eb);
    if (pick) tcOut[id] = pick;
  }
  // Emit whenever EITHER side had the key, even when the result is empty, so a
  // tombstone that clears the last entry propagates on an overlay apply instead
  // of leaving a stale local value behind.
  if (aLS[KEYS.recallTopclips] != null || bLS[KEYS.recallTopclips] != null) {
    const sorted: TcMap = {};
    for (const k of Object.keys(tcOut).sort()) sorted[k] = tcOut[k]!;
    out[KEYS.recallTopclips] = JSON.stringify(sorted);
  }

  // 6. PULSE posts — union by id, then dupe-collapse.
  let paA = pj<PulsePost[]>(aLS[KEYS.pulsePosts], []);
  let paB = pj<PulsePost[]>(bLS[KEYS.pulsePosts], []);
  if (!Array.isArray(paA)) paA = [];
  if (!Array.isArray(paB)) paB = [];

  const pmap = new Map<string, PulsePost | null>();
  const porder: string[] = [];
  const addPost = (p: PulsePost): void => {
    if (!p || p.id == null || tombHard("pulsePost", p.id)) return;
    const cur = pmap.get(p.id);
    if (!cur) {
      pmap.set(p.id, p);
      porder.push(p.id);
    } else {
      pmap.set(p.id, mergePost(cur, p));
    }
  };
  for (const p of aNew ? paB : paA) addPost(p);
  for (const p of aNew ? paA : paB) addPost(p);

  const byDupe = new Map<string, string>();
  const collapses: Record<string, string> = {};
  for (const id of porder) {
    const p = pmap.get(id);
    if (!p) continue;
    const dkeys: string[] = [];
    if (p.blastKey) dkeys.push(`bk:${p.blastKey}`);
    if (p.url) dkeys.push(`pu:${p.platform}|${p.url}`);

    let hit: string | null = null;
    for (const dk of dkeys) {
      const found = byDupe.get(dk);
      if (found != null) {
        hit = found;
        break;
      }
    }
    if (hit != null && hit !== id) {
      // Lower id kept, so the choice does not depend on iteration order.
      const keep = hit < id ? hit : id;
      const drop = hit < id ? id : hit;
      pmap.set(keep, mergePost(pmap.get(keep)!, pmap.get(drop)!));
      pmap.set(drop, null);
      collapses[drop] = keep;
      for (const dk of dkeys) byDupe.set(dk, keep);
    } else {
      for (const dk of dkeys) if (byDupe.get(dk) == null) byDupe.set(dk, id);
    }
  }

  const finalPosts = porder
    .map((id) => pmap.get(id))
    .filter((p): p is PulsePost => Boolean(p))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  if (aLS[KEYS.pulsePosts] != null || bLS[KEYS.pulsePosts] != null) {
    out[KEYS.pulsePosts] = JSON.stringify(finalPosts);
  }

  // 7. HOOKLAB ledger + comps.
  const hA = pj<Partial<HooklabState> & Record<string, unknown>>(aLS[KEYS.hooklabState], {});
  const hB = pj<Partial<HooklabState> & Record<string, unknown>>(bLS[KEYS.hooklabState], {});
  let ledgerOut = mergeById<LedgerEntry>(
    hA.ledger ?? [],
    hB.ledger ?? [],
    aNew,
    "hooklabLedger",
    tomb,
    (x) => Date.parse(x.editedAt || x.createdAt || "") || 0,
  );
  ledgerOut = applyLedgerCollapses(ledgerOut, collapses);
  const compsOut = mergeById<CompEntry>(
    hA.comps ?? [],
    hB.comps ?? [],
    aNew,
    "hooklabComp",
    tomb,
    (x) => Date.parse(x.createdAt ?? "") || 0,
  );
  if (aLS[KEYS.hooklabState] != null || bLS[KEYS.hooklabState] != null) {
    const hNewer = aNew ? hA : hB;
    const hOlder = aNew ? hB : hA;
    const hMerged: Record<string, unknown> = { ...hOlder, ...hNewer };
    hMerged.ledger = ledgerOut;
    hMerged.comps = compsOut;
    out[KEYS.hooklabState] = JSON.stringify(hMerged);
  }

  // 8. BLAST queue — union by clip key, not whole-blob newest-wins. Marking
  //    clips posted on the phone must not delete a clip only the laptop has.
  const qA = pj<BlastQueue | null>(aLS[KEYS.blastQueue], null);
  const qB = pj<BlastQueue | null>(bLS[KEYS.blastQueue], null);
  if (qA || qB) {
    const qNewer = aNew ? (qA ?? qB) : (qB ?? qA);
    const qOlder = aNew ? (qB ?? qA) : (qA ?? qB);
    const clipAt = (c: BlastClip): number => (c && (c.updatedAt || c.createdAt)) || 0;

    const cmap = new Map<string, BlastClip>();
    const corder: string[] = [];
    const addClips = (arr: BlastClip[] | undefined): void => {
      for (const c of arr ?? []) {
        if (!c || c.key == null) continue;
        const tk = `blastClip:${c.key}`;
        if (Object.prototype.hasOwnProperty.call(tomb, tk) && tomb[tk]! > clipAt(c)) continue;
        const cur = cmap.get(c.key);
        if (!cur) {
          cmap.set(c.key, c);
          corder.push(c.key);
        } else if (clipAt(c) >= clipAt(cur)) {
          cmap.set(c.key, c);
        }
      }
    };
    // Newer side first so ties resolve to it, matching mergeById.
    addClips(qNewer?.clips);
    addClips(qOlder?.clips);

    const clipsOut = corder.map((k) => cmap.get(k)!).filter(Boolean);
    // Quick clip first, then oldest-created — the order clips were queued.
    clipsOut.sort((x, y) => {
      if ((x.key === "quick") !== (y.key === "quick")) return x.key === "quick" ? -1 : 1;
      return (x.createdAt || 0) - (y.createdAt || 0);
    });

    out[KEYS.blastQueue] = JSON.stringify({
      v: 1,
      updatedAt: Math.max(qA?.updatedAt ?? 0, qB?.updatedAt ?? 0),
      defaultPlatforms: qNewer?.defaultPlatforms ?? qOlder?.defaultPlatforms ?? null,
      batchCount: qNewer?.batchCount || qOlder?.batchCount || 1,
      clips: clipsOut,
    });
  }

  // 9. BLAST presets — per-platform-key union.
  const prA = pj<Record<string, string>>(aLS[KEYS.blastPresets], {});
  const prB = pj<Record<string, string>>(bLS[KEYS.blastPresets], {});
  const prNewer = aNew ? prA : prB;
  const prOlder = aNew ? prB : prA;
  const prTmp: Record<string, string> = { ...prOlder, ...prNewer };
  const prOut: Record<string, string> = {};
  for (const k of Object.keys(prTmp).sort()) prOut[k] = prTmp[k]!;
  if (aLS[KEYS.blastPresets] != null || bLS[KEYS.blastPresets] != null) {
    out[KEYS.blastPresets] = JSON.stringify(prOut);
  }

  // 10. Workspace + tombstones.
  const ws =
    pj<unknown>(aLS[KEYS.stackWorkspace], null) ?? pj<unknown>(bLS[KEYS.stackWorkspace], null);
  if (ws) out[KEYS.stackWorkspace] = JSON.stringify(ws);
  if (Object.keys(tomb).length) {
    const tombSorted: Tombstones = {};
    for (const k of Object.keys(tomb).sort()) tombSorted[k] = tomb[k]!;
    out[KEYS.stackTombstones] = JSON.stringify(tombSorted);
  }

  // 11. Unknown / future stack-prefixed keys — forward compatible, so a newer
  //     build's data survives a round trip through this one.
  const HANDLED = new Set<string>([
    KEYS.recallTopclips,
    KEYS.pulsePosts,
    KEYS.hooklabState,
    KEYS.blastQueue,
    KEYS.blastPresets,
    KEYS.stackWorkspace,
    KEYS.stackTombstones,
  ]);
  const excl = new Set<string>([...SYNC_EXCLUDE, ...ALWAYS_EXCLUDE]);
  const allKeys = new Set([...Object.keys(aLS), ...Object.keys(bLS)]);
  for (const uk of [...allKeys].sort()) {
    if (HANDLED.has(uk) || excl.has(uk) || !isStackKey(uk)) continue;
    const va = aLS[uk];
    const vb = bLS[uk];
    if (va != null && vb != null) {
      if (va !== vb) {
        out[uk] = aNew ? va : vb;
        report.unknownKeys.push(uk);
      } else {
        out[uk] = va;
      }
    } else {
      out[uk] = va != null ? va : vb!;
    }
  }

  // 12. Report.
  report.added.sources = mergedLib ? mergedLib.sources.length : 0;
  report.added.posts = finalPosts.length;
  report.added.ledger = ledgerOut.length;
  report.added.comps = compsOut.length;
  report.tombstoned = Object.keys(tomb).length;

  return {
    data: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now(),
      localStorage: out,
      recallLibrary: mergedLib,
    },
    report,
  };
}
