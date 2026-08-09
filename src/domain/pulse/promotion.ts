/**
 * Auto-promotion: breakout hooks → the HOOKLAB ledger.
 *
 * Ported from pulse/app.js (`computeAutoWinners`, ~lines 383-568). This is the
 * one place in the stack where one app writes into another's ledger without a
 * human in the loop, and TOP CLIPS later reads those entries back as the
 * creator's own proof. A false promotion therefore doesn't just add a row — it
 * teaches every downstream ranking a lie. The gates are reproduced exactly and
 * every one of them is tested in isolation.
 *
 * The judgement is always relative: a hook earns its entry by beating YOUR OWN
 * posts on the SAME platform, never a hardcoded view count, because 50k is a
 * breakout for one account and a flop for another.
 */

import type { PulsePost } from "../../data/schemas/pulse";

/**
 * Tuning lives here and nowhere else.
 *
 * - `MIN_SAMPLE` — a platform below this has no trustworthy median, so it
 *   neither promotes a post nor argues against one. Stops a brand-new account
 *   promoting on noise.
 * - `TOP_PCT` — the post must be in this top fraction of its platform.
 * - `OUTLIER_MULT` — and clear this multiple of the platform MEDIAN. Median,
 *   not mean, because the outlier being detected would drag a mean up and hide
 *   itself. This is the gate that keeps a flat account quiet: everything
 *   landing 1-3k still has a top 10%, but nothing is 3x the middle.
 * - `CROSS_MULT` — the geometric mean of the clip's per-platform multiples.
 *   A small platform makes a small number look big: 346 views on a new X
 *   account is top 10% and past 3x its median, while the same clip did an
 *   ordinary 3,519 on Snapchat. Geometric so magnitude carries but a single
 *   reading can't dominate.
 * - `MIN_VIEWS` — a floor under all of it. The relative gates ask "is this a
 *   breakout FOR YOU", but on a platform you just started, being your own best
 *   is still nothing. The floor never promotes on its own.
 */
export const AUTO_PROMOTE = {
  MIN_SAMPLE: 8,
  TOP_PCT: 0.1,
  OUTLIER_MULT: 3,
  CROSS_MULT: 2,
  MIN_VIEWS: 10000,
} as const;

export const AUTO_PREFIX = "pulseauto_";

/**
 * Same hook, different wording: the clip is cut in RECALL, then the caption
 * comes from the FULL transcription in BLAST, so the same hook can arrive
 * longer or shorter. Token overlap catches that; exact text wouldn't.
 */
export const AUTO_HOOK_SIM = 0.55;

const TEXT_PLATFORMS = new Set(["X", "Threads", "LinkedIn", "Pinterest"]);

export function mediumFor(name: string): "text" | "video" {
  return TEXT_PLATFORMS.has(name) ? "text" : "video";
}

export interface TokenSet {
  set: Record<string, 1>;
  size: number;
}

/** Follows the matching helpers in recall/topclips.js. */
export function tokens(s: unknown): TokenSet {
  const out: Record<string, 1> = Object.create(null);
  let n = 0;
  String(s)
    .toLowerCase()
    .split(/\W+/)
    .forEach((w) => {
      if (w && !out[w]) {
        n++;
        out[w] = 1;
      }
    });
  return { set: out, size: n };
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

/** First non-empty value of `field` across posts, in the order given. */
function firstWith(list: PulsePost[], field: keyof PulsePost): string {
  for (const p of list) {
    const v = p?.[field];
    if (v) return String(v);
  }
  return "";
}

export function autoHook(post: PulsePost): string {
  let h = String(post.hook || "").trim();
  if (!h) h = String(post.caption || "").split("\n")[0]!.trim();
  return h.slice(0, 300);
}

function latestSnap(post: PulsePost) {
  return post.snapshots.length ? post.snapshots[post.snapshots.length - 1]! : null;
}

/**
 * 0 views means "not measured yet" in this workflow, not "measured as zero" —
 * either way there's nothing to rank, so those posts sit out entirely.
 */
export function autoViews(post: PulsePost): number {
  const s = latestSnap(post);
  const v = s ? Number(s.views) : 0;
  return v > 0 ? v : 0;
}

export function medianOf(nums: number[]): number {
  const a = nums.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : Math.round((a[m - 1]! + a[m]!) / 2);
}

function commas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A ledger entry auto-promotion wants to exist, and the posts that justify it. */
export interface AutoWinner {
  postIds: string[];
  entry: {
    id: string;
    hook: string;
    patternId: string;
    family: string;
    outcome: "winner";
    platform: string;
    medium: "text" | "video";
    niche: string;
    retention: string;
    views: string;
    notes: string;
    source: "pulse-auto";
  };
}

interface PlatformStat {
  med: number;
  n: number;
  cutoff: number;
}

/** Pure: posts in, the ledger entries they justify out. No storage, no DOM. */
export function computeAutoWinners(list: PulsePost[]): AutoWinner[] {
  const byPlatform: Record<string, PulsePost[]> = {};
  list.forEach((p) => {
    if (!p || !autoViews(p)) return;
    (byPlatform[p.platform] ??= []).push(p);
  });

  // Per-platform baselines. A platform below MIN_SAMPLE has no trustworthy
  // median, so it neither promotes a post nor argues against one.
  const stats: Record<string, PlatformStat> = {};
  Object.keys(byPlatform).forEach((name) => {
    const pool = byPlatform[name]!;
    if (pool.length < AUTO_PROMOTE.MIN_SAMPLE) return;
    const med = medianOf(pool.map(autoViews));
    if (med <= 0) return;
    const ranked = pool.slice().sort((a, b) => {
      const d = autoViews(b) - autoViews(a);
      return d !== 0 ? d : a.postedAt - b.postedAt;
    });
    const slots = Math.ceil(pool.length * AUTO_PROMOTE.TOP_PCT);
    // Everyone tied with the last qualifying post is in — an arbitrary
    // tiebreak at the cutoff would make the set flap between saves.
    stats[name] = {
      med,
      n: pool.length,
      cutoff: autoViews(ranked[Math.min(slots, ranked.length) - 1]!),
    };
  });

  function qualifies(p: PulsePost): boolean {
    const st = stats[p.platform];
    if (!st) return false;
    const v = autoViews(p);
    if (v < AUTO_PROMOTE.MIN_VIEWS) return false; // below this, percentiles are noise
    return v >= st.cutoff && v >= st.med * AUTO_PROMOTE.OUTLIER_MULT;
  }

  // One entry per HOOK, not per post: the same clip posted to five platforms,
  // or re-cut with different wording, is one hook that worked. Grouping runs
  // over EVERY measured post of the clip, not just the ones that qualify —
  // the posts that DIDN'T break out are exactly the evidence the
  // cross-platform gate needs.
  const groups: { items: PulsePost[]; toks: TokenSet }[] = [];
  const byKey: Record<string, { items: PulsePost[]; toks: TokenSet }> = {};
  list.forEach((p) => {
    if (!p || !autoViews(p) || !autoHook(p)) return;
    const ck = String(p.clipKey || "").trim();
    const k = p.clipId
      ? "g:" + p.clipId
      : ck
        ? "c:" + ck.toLowerCase()
        : "h:" + autoHook(p).toLowerCase();
    let g = byKey[k];
    if (!g) {
      g = byKey[k] = { items: [], toks: tokens(autoHook(p)) };
      groups.push(g);
    }
    g.items.push(p);
  });

  const merged: { items: PulsePost[]; toks: TokenSet }[] = [];
  groups.forEach((g) => {
    for (const m of merged) {
      if (jaccardSets(m.toks, g.toks) >= AUTO_HOOK_SIM) {
        m.items = m.items.concat(g.items);
        return;
      }
    }
    merged.push(g);
  });

  const pct = Math.round(AUTO_PROMOTE.TOP_PCT * 100);
  const out: AutoWinner[] = [];
  merged.forEach((g) => {
    // Candidates: posts that broke out on their own platform and carry no
    // manual verdict (the user's own call outranks the math, either way).
    const cands = g.items.filter((p) => !p.outcome && qualifies(p));
    if (!cands.length) return;

    // The clip's best showing on each platform that has a reliable median —
    // one multiple per platform, however many times the clip ran there.
    const bestBy: Record<string, { views: number; med: number; n: number }> = {};
    g.items.forEach((p) => {
      const st = stats[p.platform];
      if (!st) return;
      const v = autoViews(p);
      if (!bestBy[p.platform] || v > bestBy[p.platform]!.views) {
        bestBy[p.platform] = { views: v, med: st.med, n: st.n };
      }
    });
    const names = Object.keys(bestBy);
    if (!names.length) return;
    let logSum = 0;
    names.forEach((n) => {
      logSum += Math.log(bestBy[n]!.views / bestBy[n]!.med);
    });
    const crossMult = Math.exp(logSum / names.length);
    // The balance gate: one small platform can no longer carry a hook the
    // rest of the clip's record calls ordinary.
    if (crossMult < AUTO_PROMOTE.CROSS_MULT) return;

    cands.sort((a, b) => autoViews(b) - autoViews(a) || a.postedAt - b.postedAt);
    const top = cands[0]!;
    const st = stats[top.platform]!;
    const also: string[] = [];
    cands.forEach((p) => {
      if (p.platform !== top.platform && !also.includes(p.platform)) also.push(p.platform);
    });
    const notes =
      "auto: top " +
      pct +
      "% on " +
      top.platform +
      " — " +
      commas(autoViews(top)) +
      " views vs " +
      commas(st.med) +
      " median (n=" +
      st.n +
      ")" +
      (also.length ? "; also qualified: " + also.join(", ") : "") +
      (names.length > 1
        ? "; cross-platform " +
          Math.round(crossMult * 10) / 10 +
          "x your medians (" +
          names.length +
          " platforms)"
        : "") +
      (top.url ? " · " + top.url : "");

    // The pattern RECALL matched this hook to, taken from the best-performing
    // post that carries one. Hand-added posts and quick clips that never went
    // through RECALL have none, and stay honestly "unknown" rather than being
    // guessed at — but a group where any post knows its pattern can name it.
    const ranked = [top].concat(cands);
    out.push({
      postIds: cands.map((p) => p.id),
      entry: {
        id: AUTO_PREFIX + top.id,
        hook: autoHook(top),
        patternId: firstWith(ranked, "patternId"),
        family: firstWith(ranked, "patternFamily") || "unknown",
        outcome: "winner",
        platform: top.platform,
        medium: mediumFor(top.platform),
        niche: "general",
        retention: "",
        views: String(autoViews(top)),
        notes,
        source: "pulse-auto",
      },
    });
  });
  return out;
}
