/**
 * TOP CLIPS — scores every moment in the library against the user's own proven
 * hooks and the HOOKLAB pattern bank, and ranks what is worth cutting.
 *
 * Ported from recall/topclips.js. The evidence ladder is the product:
 *   PROOF (yours)  — the line closely reuses a hook your ledger marks a winner,
 *                    or matches a pattern you have already won with
 *   PROOF          — the line carries a high-evidence scaffold from the bank
 *   (unlabeled)    — surfaced on specificity alone, with no claim attached
 *
 * One deliberate simplification: the legacy file carries a 2,567-line vendored
 * snapshot of the pattern bank and dynamically imports the live one when it can
 * reach it, falling back to the snapshot on a standalone deploy. The unified
 * app has the live bank as an ordinary import, which is the path the shared
 * origin already took, so the snapshot and its fallback are gone.
 *
 * The legacy scan yields to the event loop every 400 segments. That was for the
 * progress bar, not for correctness — the scoring itself is pure and runs here
 * as a plain function.
 */

import { PATTERNS } from "../hooklab/patterns";
import type { Pattern } from "../hooklab/patterns";
import type {
  RecallLibrary,
  RecallSegment,
  TopClipCandidate,
} from "../../data/schemas/recall";
import type { LedgerEntry } from "../../data/schemas/hooklab";

// ── thresholds, verbatim from topclips.js ───────────────────────────────
/** Near-verbatim reuse of a proven hook. */
export const LEDGER_SIM = 0.55;
/** Scaffold skeleton mostly present in the line. */
export const SKEL_CONTAIN = 0.75;
/** Candidates fed to the AI pass; kept modest so the labeled JSON fits. */
export const AI_FEED_CAP = 45;
export const DISPLAY_CAP = 20;
/** With AI cards present, proofs can't fill every slot. */
export const PROOF_DISPLAY_MAX = 12;
/** Only moments in this range are scanned at all. */
export const MIN_WORDS = 4;
export const MAX_WORDS = 40;
/** Ledger winners considered, newest first. */
export const MAX_WINNERS = 50;

export interface TokenSet {
  set: Record<string, 1>;
  size: number;
}

export function tokens(s: string): TokenSet {
  const set: Record<string, 1> = Object.create(null) as Record<string, 1>;
  let n = 0;
  String(s)
    .toLowerCase()
    .split(/\W+/)
    .forEach((w) => {
      if (w) {
        if (!set[w]) n++;
        set[w] = 1;
      }
    });
  return { set, size: n };
}

export function jaccardSets(a: TokenSet, b: TokenSet): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  let union = a.size;
  for (const w in b.set) {
    if (a.set[w]) inter++;
    else union++;
  }
  return inter / union;
}

/** How much of the scaffold's skeleton actually appears in the line. */
export function containment(skel: TokenSet, seg: TokenSet): number {
  if (!skel.size) return 0;
  let hit = 0;
  for (const w in skel.set) {
    if (seg.set[w]) hit++;
  }
  return hit / skel.size;
}

export function specificityScore(text: string): number {
  let s = 0;
  if (/\d/.test(text)) s += 0.35;
  if (/\b(i|my|we)\b/i.test(text)) s += 0.15;
  if (text.split(/\s+/).length <= 16) s += 0.15;
  if (/\?/.test(text)) s += 0.1;
  if (!/\b(amazing|incredible|game.?changer|secret sauce)\b/i.test(text)) s += 0.15;
  return Math.min(1, s);
}

/** A scaffold minus its {slots} — the fixed words that identify the pattern. */
export function skeletonize(scaffold: string): TokenSet {
  return tokens(String(scaffold).replace(/\{[^}]*\}/g, " "));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function lastWords(t: string, n: number): string {
  const w = String(t || "").split(/\s+/).filter(Boolean);
  return w.slice(Math.max(0, w.length - n)).join(" ");
}

export function firstWords(t: string, n: number): string {
  return String(t || "").split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

/**
 * Speech-to-text noise heuristic: mid-word case joins ("broLilly") and isolated
 * one-or-two-word lowercase fragments ("enslaves." dropped mid-line). Cheap and
 * conservative — it down-ranks garbled candidates rather than hiding them, and
 * tells the AI pass that trimming that line is mandatory.
 */
export function noiseScore(text: string): number {
  let n = 0;
  const s = String(text || "");
  for (const tok of s.split(/\s+/)) if (/[a-z][A-Z]/.test(tok)) n++;
  const m = s.match(/(?:^|[.!?]["')\]]*\s+)[a-z][^\s.!?]*(?:\s+[^\s.!?]+)?[.!?]/g);
  if (m) n += m.length;
  return n;
}

// ── the pattern bank, reduced to what scoring needs ─────────────────────

export interface BankPattern {
  id: string;
  name: string;
  family: string;
  scaffold: string;
  slots: string[];
  niches: string[];
  strength: number;
  evidence: string;
  tier: string;
  skeleton: TokenSet;
}

export interface PatternBank {
  patterns: BankPattern[];
  byId: Map<string, BankPattern>;
}

/**
 * A scaffold with fewer than three fixed words is dropped: "{topic} is {thing}"
 * would match nearly any sentence, and a match that loose is not evidence.
 */
export function buildBank(source: readonly Pattern[] = PATTERNS): PatternBank {
  const patterns = source
    .map((p) => ({
      id: p.id,
      name: p.name,
      family: p.family,
      scaffold: p.scaffold,
      slots: p.slots || [],
      niches: p.niches || [],
      strength: p.strength || 0.8,
      evidence: p.evidence || "market-observed",
      tier: p.tier || "core",
      skeleton: skeletonize(p.scaffold),
    }))
    .filter((p) => p.skeleton.size >= 3);
  return { patterns, byId: new Map(patterns.map((p) => [p.id, p])) };
}

// ── the user's own evidence ─────────────────────────────────────────────

export interface Winner {
  hook: string;
  hookTokens: TokenSet;
  patternId: string | null;
  family: string;
}

export type WinnersReason = "ok" | "absent" | "empty" | "no-winners";

export interface WinnersResult {
  winners: Winner[];
  found: boolean;
  /** Distinguishes "never opened HOOKLAB", "opened but empty" and "no winners
   *  yet", so the UI can give the nudge that actually applies. */
  reason: WinnersReason;
}

export function loadWinners(ledger: LedgerEntry[] | null | undefined): WinnersResult {
  if (!ledger) return { winners: [], found: false, reason: "absent" };
  const winners = ledger
    .filter((e) => e.outcome === "winner" && e.hook)
    .slice(0, MAX_WINNERS)
    .map((e) => ({
      hook: e.hook,
      hookTokens: tokens(e.hook),
      patternId: e.patternId || null,
      family: e.family || "",
    }));
  const reason: WinnersReason = winners.length ? "ok" : ledger.length ? "no-winners" : "empty";
  return { winners, found: true, reason };
}

/**
 * Pattern ids that have actually won for this creator. The strongest evidence
 * the app has: not "this scaffold works in general" but "this scaffold worked
 * for you". PULSE stamps patternId on auto-promoted winners, so the set fills
 * itself as breakouts land.
 */
export function winnerPatternSet(winners: Winner[]): Set<string> {
  return new Set(winners.filter((w) => w?.patternId).map((w) => w.patternId!));
}

// ── the scan ────────────────────────────────────────────────────────────

export interface ScanOptions {
  /** Scout mode: scan this one source even when it is switched off. */
  onlySrcId?: string;
  /** From settings; a pattern matching the channel's niche gets a small lift. */
  niche?: string;
}

interface Flat {
  source: { id: string; title: string };
  segments: RecallSegment[];
  seg: RecallSegment;
  idx: number;
}

function flatten(lib: RecallLibrary, onlySrcId?: string): Flat[] {
  const enabled = lib.sources.filter((s) =>
    onlySrcId ? s.id === onlySrcId : lib.enabled.indexOf(s.id) >= 0,
  );
  const flat: Flat[] = [];
  for (const s of enabled) {
    s.segments.forEach((seg, idx) => {
      flat.push({ source: { id: s.id, title: s.title }, segments: s.segments, seg, idx });
    });
  }
  return flat;
}

/**
 * Score and rank every eligible moment.
 *
 * Ordering is not just by rank: personally-proven candidates come first, then
 * general proof, then everything else. The cap is applied after that split and
 * is never allowed to truncate proof of either kind — a clip you have evidence
 * for must not fall off the list because forty specific-sounding lines outrank
 * it on a heuristic.
 */
export function scanLibrary(
  lib: RecallLibrary,
  bank: PatternBank,
  winners: Winner[],
  opts: ScanOptions = {},
): TopClipCandidate[] {
  const flat = flatten(lib, opts.onlySrcId);
  const provenPatterns = bank.patterns.filter(
    (p) => p.strength >= 0.8 && p.evidence !== "hypothesis",
  );
  const wonPatterns = winnerPatternSet(winners);
  const niche = opts.niche || "";
  const out: TopClipCandidate[] = [];

  for (const f of flat) {
    const text = f.seg.text;
    const wc = wordCount(text);
    if (wc < MIN_WORDS || wc > MAX_WORDS) continue;

    const segSet = tokens(text);
    const prev = f.segments[f.idx - 1];
    const next = f.segments[f.idx + 1];
    const cand: TopClipCandidate = {
      srcId: f.source.id,
      srcTitle: f.source.title,
      idx: f.idx,
      t: f.seg.t,
      sec: f.seg.sec,
      text,
      key: `${f.source.id}@${f.seg.sec}@${f.idx}`,
      ctxPrev: prev ? lastWords(prev.text, 12) : "",
      ctxNext: next ? firstWords(next.text, 12) : "",
      label: null,
      personalProof: false,
      grounding: "",
      reason: "",
      sim: 0,
      spec: specificityScore(text),
      noise: noiseScore(text),
      rank: 0,
    };

    // 1) ledger proof — the creator's own winners come first
    let bestLed = 0;
    let bestHook: Winner | null = null;
    for (const w of winners) {
      const js = jaccardSets(segSet, w.hookTokens);
      if (js > bestLed) {
        bestLed = js;
        bestHook = w;
      }
    }

    let matchedPattern: BankPattern | null = null;
    if (bestLed >= LEDGER_SIM && bestHook) {
      cand.label = "proof";
      cand.proofType = "ledger";
      cand.sim = bestLed;
      // Matching a winning hook IS personal proof, whatever pattern it names.
      cand.personalProof = true;
      cand.match = {
        kind: "ledger",
        hook: bestHook.hook,
        patternId: bestHook.patternId || "",
      };
    } else {
      // 2) pattern proof — a high-evidence scaffold is present in the line
      let bestC = 0;
      let bestP: BankPattern | null = null;
      for (const p of provenPatterns) {
        const c = containment(p.skeleton, segSet);
        // A 3-word skeleton has to match completely; below that the signal is
        // too weak to call evidence.
        const thresh = p.skeleton.size >= 4 ? SKEL_CONTAIN : 1.0;
        if (c >= thresh && c > bestC) {
          bestC = c;
          bestP = p;
        }
      }
      if (bestP) {
        matchedPattern = bestP;
        cand.label = "proof";
        cand.proofType = "pattern";
        cand.sim = bestC;
        cand.personalProof = wonPatterns.has(bestP.id);
        cand.match = {
          kind: "pattern",
          patternId: bestP.id,
          patternName: bestP.name,
          scaffold: bestP.scaffold,
        };
      } else {
        // Best sub-threshold signal, so the ranking still orders these sensibly.
        cand.sim = Math.max(bestLed, bestC);
      }
    }

    const evidenceWeight =
      cand.proofType === "ledger" || cand.personalProof
        ? 1.0
        : cand.proofType === "pattern"
          ? (matchedPattern?.strength ?? 0.8)
          : 0.4;

    let nicheBonus = 0;
    if (matchedPattern && niche && matchedPattern.niches.indexOf(niche) >= 0) {
      nicheBonus = 0.1;
    }

    const spec = cand.spec ?? 0;
    cand.rank = evidenceWeight * cand.sim! + 0.25 * spec + nicheBonus;
    // Garbled lines rank below clean ones, but are never hidden — the words may
    // still be the right words.
    if (cand.noise) cand.rank -= Math.min(0.3, 0.15 * cand.noise);

    out.push(cand);
  }

  out.sort((a, b) => b.rank! - a.rank!);
  const mine = out.filter((c) => c.label === "proof" && c.personalProof);
  const proofs = out.filter((c) => c.label === "proof" && !c.personalProof);
  const rest = out.filter((c) => c.label !== "proof");
  const head = [...mine, ...proofs];
  return [...head, ...rest].slice(0, Math.max(AI_FEED_CAP, head.length));
}

/** What the UI shows: the scan, capped, with proofs never crowded out. */
export function displaySet(candidates: TopClipCandidate[], hasAiCards: boolean): TopClipCandidate[] {
  if (!hasAiCards) return candidates.slice(0, DISPLAY_CAP);
  const proofs = candidates.filter((c) => c.label === "proof").slice(0, PROOF_DISPLAY_MAX);
  const others = candidates.filter((c) => c.label !== "proof");
  return [...proofs, ...others].slice(0, DISPLAY_CAP);
}

/** A one-line, honest account of why a candidate surfaced. */
export function groundingFor(c: TopClipCandidate): string {
  if (c.proofType === "ledger" && c.match?.kind === "ledger") {
    return `Close to a hook your ledger marks a winner: “${c.match.hook}”`;
  }
  if (c.proofType === "pattern" && c.match?.kind === "pattern") {
    return c.personalProof
      ? `Uses ${c.match.patternName}, a pattern you have already won with.`
      : `Carries the ${c.match.patternName} structure.`;
  }
  return "No pattern or ledger match — surfaced on specificity alone.";
}
