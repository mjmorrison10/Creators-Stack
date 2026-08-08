import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as port from "../../src/domain/recall/topclips";
import { PATTERNS } from "../../src/domain/hooklab/patterns";
import type { RecallLibrary, RecallSource, TopClipCandidate } from "../../src/data/schemas/recall";
import type { LedgerEntry } from "../../src/data/schemas/hooklab";

const TOPCLIPS_JS = resolve(import.meta.dirname, "../../../recall/topclips.js");

/**
 * The scoring helpers decide what TOP CLIPS calls proof, which is the one thing
 * the product promises never to fake. They are pure, so the originals are
 * sliced out of the IIFE and diffed against the port.
 */
function loadLegacyScoring(): {
  tokens: (s: string) => { set: Record<string, 1>; size: number };
  jaccardSets: (a: unknown, b: unknown) => number;
  containment: (a: unknown, b: unknown) => number;
  specificityScore: (t: string) => number;
  skeletonize: (s: string) => { set: Record<string, 1>; size: number };
  wordCount: (t: string) => number;
  lastWords: (t: string, n: number) => string;
  firstWords: (t: string, n: number) => string;
  noiseScore: (t: string) => number;
} {
  const src = readFileSync(TOPCLIPS_JS, "utf8");
  const start = src.indexOf("function tokens(s)");
  const end = src.indexOf("// --- data loading ---");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("could not locate the scoring block in recall/topclips.js");
  }
  return new Function(
    `${src.slice(start, end)}
     return {tokens, jaccardSets, containment, specificityScore, skeletonize,
             wordCount, lastWords, firstWords, noiseScore};`,
  )() as ReturnType<typeof loadLegacyScoring>;
}

const legacy = loadLegacyScoring();

const TEXTS = [
  "Discipline is just remembering what you want.",
  "I cut 3 minutes off my edit and nobody noticed.",
  "This amazing game-changer will unlock growth",
  "Nobody talks about this",
  "The system enslaves. relaxing. And then the next real sentence begins.",
  "broLilly said HeGülme and the caption was garbled",
  "Why does this keep happening?",
  "",
  "   ",
  "one",
  "Punctuation-free run of words with no terminal marker at all",
];

describe("scoring parity with the original topclips.js", () => {
  it("tokenizes identically", () => {
    for (const t of TEXTS) {
      const a = port.tokens(t);
      const b = legacy.tokens(t);
      expect(a.size, t).toBe(b.size);
      expect({ ...a.set }, t).toEqual({ ...b.set });
    }
  });

  it("scores specificity identically", () => {
    for (const t of TEXTS) expect(port.specificityScore(t), t).toBe(legacy.specificityScore(t));
  });

  it("scores ASR noise identically", () => {
    for (const t of TEXTS) expect(port.noiseScore(t), t).toBe(legacy.noiseScore(t));
  });

  it("counts words identically", () => {
    for (const t of TEXTS) expect(port.wordCount(t), t).toBe(legacy.wordCount(t));
  });

  it("takes leading and trailing context identically", () => {
    for (const t of TEXTS) {
      for (const n of [0, 1, 12, 100]) {
        expect(port.lastWords(t, n), `${t}/${n}`).toBe(legacy.lastWords(t, n));
        expect(port.firstWords(t, n), `${t}/${n}`).toBe(legacy.firstWords(t, n));
      }
    }
  });

  it("computes similarity and containment identically", () => {
    for (const a of TEXTS) {
      for (const b of TEXTS) {
        expect(port.jaccardSets(port.tokens(a), port.tokens(b)), `${a}|${b}`).toBe(
          legacy.jaccardSets(legacy.tokens(a), legacy.tokens(b)),
        );
        expect(port.containment(port.tokens(a), port.tokens(b)), `${a}|${b}`).toBe(
          legacy.containment(legacy.tokens(a), legacy.tokens(b)),
        );
      }
    }
  });

  it("skeletonizes every real scaffold identically", () => {
    // Run against the whole live bank rather than a sample: the skeleton is
    // what a line is matched against, so a single scaffold handled differently
    // changes what gets called proof.
    for (const p of PATTERNS) {
      const a = port.skeletonize(p.scaffold);
      const b = legacy.skeletonize(p.scaffold);
      expect(a.size, p.id).toBe(b.size);
      expect({ ...a.set }, p.id).toEqual({ ...b.set });
    }
  });
});

describe("the pattern bank the scan matches against", () => {
  const bank = port.buildBank();

  it("drops scaffolds with too few fixed words to be evidence", () => {
    // "{topic} is {thing}" would match nearly any sentence; a match that loose
    // is not proof of anything.
    for (const p of bank.patterns) expect(p.skeleton.size, p.id).toBeGreaterThanOrEqual(3);
    expect(bank.patterns.length).toBeLessThan(PATTERNS.length);
    expect(bank.patterns.length).toBeGreaterThan(0);
  });

  it("indexes by id", () => {
    expect(bank.byId.size).toBe(bank.patterns.length);
  });
});

describe("reading the creator's own winners", () => {
  const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
    id: "id_1",
    hook: "a hook",
    outcome: "winner",
    family: "curiosity",
    medium: "video",
    platform: "tiktok",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  });

  it("distinguishes never-opened from empty from no-winners", () => {
    // Each needs a different nudge, so collapsing them into "no data" would
    // send the user to the wrong place.
    expect(port.loadWinners(null).reason).toBe("absent");
    expect(port.loadWinners([]).reason).toBe("empty");
    expect(port.loadWinners([entry({ outcome: "dead" })]).reason).toBe("no-winners");
    expect(port.loadWinners([entry({})]).reason).toBe("ok");
  });

  it("ignores a winner with no hook text", () => {
    expect(port.loadWinners([entry({ hook: "" })]).winners).toHaveLength(0);
  });

  it("bounds the sample", () => {
    const many = Array.from({ length: 80 }, (_, i) => entry({ id: `id_${i}` }));
    expect(port.loadWinners(many).winners).toHaveLength(port.MAX_WINNERS);
  });

  it("collects only the pattern ids a winner actually names", () => {
    const { winners } = port.loadWinners([
      entry({ patternId: "p1" }),
      entry({ patternId: "" }),
      entry({}),
    ]);
    expect([...port.winnerPatternSet(winners)]).toEqual(["p1"]);
  });
});

describe("the scan", () => {
  const proven = PATTERNS.find(
    (p) => p.strength >= 0.8 && p.evidence !== "hypothesis" && port.skeletonize(p.scaffold).size >= 4,
  )!;
  /** The scaffold's fixed words, which is what a line has to contain. */
  const skeletonText = proven.scaffold.replace(/\{[^}]*\}/g, "something");

  function lib(segments: string[], over: Partial<RecallSource> = {}): RecallLibrary {
    const source: RecallSource = {
      id: "s1",
      title: "A source",
      segments: segments.map((text, i) => ({ t: "0:00:05", sec: i * 10, text })),
      ...over,
    };
    return { sources: [source], enabled: ["s1"], bin: [] };
  }

  it("skips moments outside the scannable word range", () => {
    const short = "one two three";
    const long = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    const ok = "this line has comfortably more than four words in it";
    const out = port.scanLibrary(lib([short, long, ok]), port.buildBank(), []);
    expect(out.map((c) => c.text)).toEqual([ok]);
  });

  it("only scans sources that are switched on", () => {
    const l = { ...lib(["this line has more than four words"]), enabled: [] };
    expect(port.scanLibrary(l, port.buildBank(), [])).toHaveLength(0);
  });

  it("scouts a single source even when it is switched off", () => {
    const l = { ...lib(["this line has more than four words"]), enabled: [] };
    expect(port.scanLibrary(l, port.buildBank(), [], { onlySrcId: "s1" })).toHaveLength(1);
  });

  it("labels a near-verbatim reuse of a ledger winner as personal proof", () => {
    const hook = "Confidence comes after the work never before it";
    const { winners } = port.loadWinners([
      {
        id: "id_1",
        hook,
        outcome: "winner",
        family: "identity",
        medium: "video",
        platform: "tiktok",
        createdAt: "2026-07-01T00:00:00.000Z",
        patternId: "p_x",
      },
    ]);
    const out = port.scanLibrary(lib([hook]), port.buildBank(), winners);
    expect(out[0]).toMatchObject({ label: "proof", proofType: "ledger", personalProof: true });
    expect(out[0]!.match).toMatchObject({ kind: "ledger", hook });
    expect(out[0]!.sim).toBeGreaterThanOrEqual(port.LEDGER_SIM);
  });

  it("refuses to call a partial reuse proof, just below the threshold", () => {
    // 11 shared tokens over a 21-token union is 0.524 — a real echo of a
    // winning hook, but not the near-verbatim reuse the badge claims. This is
    // the boundary the whole "never a fake proof" promise sits on.
    const shared = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo";
    const winnerHook = `${shared} lima mike november oscar papa`;
    const line = `${shared} quebec romeo sierra tango uniform`;
    const { winners } = port.loadWinners([
      {
        id: "id_1",
        hook: winnerHook,
        outcome: "winner",
        family: "x",
        medium: "video",
        platform: "tiktok",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    const sim = port.jaccardSets(port.tokens(line), port.tokens(winnerHook));
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(port.LEDGER_SIM);

    const out = port.scanLibrary(lib([line]), port.buildBank(), winners);
    expect(out[0]!.proofType).not.toBe("ledger");
    // The signal is still recorded, so ranking can use it.
    expect(out[0]!.sim).toBeCloseTo(sim);
  });

  it("has no reachable case for the short-skeleton exactness rule", () => {
    // The legacy code requires 100% containment when a skeleton has 3 words and
    // 75% above that. Since scaffolds under 3 words are filtered out entirely,
    // the only sizes that reach the check are >= 3 — and at exactly 3 the only
    // reachable containments are 0, 1/3, 2/3 and 1, all of which fall the same
    // side of 0.75 as they do of 1.0. The branch is dead in both copies.
    // Recorded rather than removed, so the port stays a faithful one.
    const reachable = [0, 1 / 3, 2 / 3, 1];
    for (const c of reachable) {
      expect(c >= port.SKEL_CONTAIN, String(c)).toBe(c >= 1.0);
    }
    for (const p of port.buildBank().patterns) {
      expect(p.skeleton.size, p.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("labels a line carrying a proven scaffold as pattern proof, not personal", () => {
    const out = port.scanLibrary(lib([skeletonText]), port.buildBank(), []);
    const hit = out.find((c) => c.proofType === "pattern");
    expect(hit, `no pattern match for "${skeletonText}"`).toBeTruthy();
    expect(hit!.personalProof).toBe(false);
    expect(hit!.match).toMatchObject({ kind: "pattern" });
  });

  it("upgrades a pattern the creator has already won with to personal proof", () => {
    const { winners } = port.loadWinners([
      {
        id: "id_1",
        hook: "some unrelated winning hook of mine",
        outcome: "winner",
        family: "x",
        medium: "video",
        platform: "tiktok",
        createdAt: "2026-07-01T00:00:00.000Z",
        patternId: proven.id,
      },
    ]);
    const out = port.scanLibrary(lib([skeletonText]), port.buildBank(), winners);
    const hit = out.find((c) => c.proofType === "pattern")!;
    expect(hit.personalProof).toBe(true);
  });

  it("leaves an unmatched line unlabeled rather than inventing a claim", () => {
    const out = port.scanLibrary(
      lib(["the quick brown fox jumped over something entirely unremarkable"]),
      port.buildBank(),
      [],
    );
    expect(out[0]!.label).toBeNull();
    expect(out[0]!.match).toBeUndefined();
    expect(port.groundingFor(out[0]!)).toMatch(/specificity alone/);
  });

  it("puts personal proof above general proof, and both above the rest", () => {
    const winnerHook = "Confidence comes after the work never before it";
    const { winners } = port.loadWinners([
      {
        id: "id_1",
        hook: winnerHook,
        outcome: "winner",
        family: "identity",
        medium: "video",
        platform: "tiktok",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    const out = port.scanLibrary(
      lib(["the quick brown fox jumped over something", skeletonText, winnerHook]),
      port.buildBank(),
      winners,
    );
    const labels = out.map((c) => (c.personalProof ? "mine" : c.label === "proof" ? "proof" : "rest"));
    // Once "rest" appears, no proof may follow it.
    expect(labels.indexOf("rest")).toBe(labels.length - 1);
    expect(labels[0]).toBe("mine");
  });

  it("down-ranks a garbled line without hiding it", () => {
    // The words may still be the right words; the transcript is what's broken.
    const clean = "I cut three minutes off my edit and nobody noticed at all";
    const noisy = "I cut three minutes off my broLilly edit and nobody noticed";
    const out = port.scanLibrary(lib([clean, noisy]), port.buildBank(), []);
    expect(out).toHaveLength(2);
    const c = out.find((x) => x.text === clean)!;
    const n = out.find((x) => x.text === noisy)!;
    expect(n.noise).toBeGreaterThan(0);
    expect(n.rank!).toBeLessThan(c.rank!);
  });

  it("carries surrounding context, and none past the ends", () => {
    const out = port.scanLibrary(
      lib([
        "the first line here has plenty of words",
        "the middle line here has plenty of words",
        "the last line here has plenty of words",
      ]),
      port.buildBank(),
      [],
    );
    const byIdx = new Map(out.map((c) => [c.idx, c]));
    expect(byIdx.get(0)!.ctxPrev).toBe("");
    expect(byIdx.get(2)!.ctxNext).toBe("");
    expect(byIdx.get(1)!.ctxPrev).toContain("first");
    expect(byIdx.get(1)!.ctxNext).toContain("last");
  });

  it("keys candidates the way the bin does, so collecting one lines up", () => {
    const out = port.scanLibrary(lib(["this line has more than four words"]), port.buildBank(), []);
    expect(out[0]!.key).toBe("s1@0@0");
  });

  it("gives a niche match a small lift without reordering the evidence ladder", () => {
    const bank = port.buildBank();
    const plain = port.scanLibrary(lib([skeletonText]), bank, []);
    const niched = port.scanLibrary(lib([skeletonText]), bank, [], {
      niche: proven.niches[0]!,
    });
    const a = plain.find((c) => c.proofType === "pattern")!;
    const b = niched.find((c) => c.proofType === "pattern")!;
    expect(b.rank!).toBeGreaterThan(a.rank!);
    expect(b.rank! - a.rank!).toBeCloseTo(0.1);
  });
});

describe("what actually gets displayed", () => {
  const cand = (label: "proof" | "ai" | null, i: number, personalProof = false) =>
    ({ key: `k${i}`, label, text: `t${i}`, personalProof }) as never;

  it("caps at the display limit with no AI cards", () => {
    const all = Array.from({ length: 40 }, (_, i) => cand("proof", i));
    expect(port.displaySet(all)).toHaveLength(port.DISPLAY_CAP);
  });

  it("shows only labeled candidates", () => {
    // The unlabeled remainder exists so ranking can order it and so scout mode
    // has something to backfill with. Showing it by default fills the view with
    // cards whose own text says they matched nothing.
    const all = [cand("proof", 0), ...Array.from({ length: 30 }, (_, i) => cand(null, i + 1))];
    const shown = port.displaySet(all);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.label).toBe("proof");
  });

  it("returns nothing when nothing was labeled, so the honest empty state can fire", () => {
    // "Nothing scored high enough to recommend" is the product promise. If
    // unlabeled candidates always padded the list, it could never be shown.
    expect(port.displaySet(Array.from({ length: 30 }, (_, i) => cand(null, i)))).toEqual([]);
  });

  it("stops proofs filling every slot once AI cards exist", () => {
    // Otherwise the AI pass runs, costs money, and none of its output is seen.
    const all = [
      ...Array.from({ length: 30 }, (_, i) => cand("proof", i)),
      ...Array.from({ length: 10 }, (_, i) => cand("ai", 100 + i)),
    ];
    const shown = port.displaySet(all, { hasAiCards: true });
    expect(shown.filter((c) => c.label === "proof")).toHaveLength(port.PROOF_DISPLAY_MAX);
    expect(shown.some((c) => c.label === "ai")).toBe(true);
  });

  it("puts personally-proven cards first even when AI cards outrank them", () => {
    const all = [
      ...Array.from({ length: 5 }, (_, i) => cand("ai", i)),
      cand("proof", 99, true),
    ];
    expect(port.displaySet(all, { hasAiCards: true })[0]!.personalProof).toBe(true);
  });

  it("backfills a thin scout result with unlabeled lines, tagged as a scan", () => {
    // A scouted source may have no proven matches at all. An editor still gets
    // a usable shot list — but those cards are never dressed as evidence.
    const all = [cand("proof", 0), ...Array.from({ length: 30 }, (_, i) => cand(null, i + 1))];
    const shown = port.displaySet(all, { scout: true });
    expect(shown).toHaveLength(port.SCOUT_FLOOR);
    expect(shown.filter((c) => c.label === "scan")).toHaveLength(port.SCOUT_FLOOR - 1);
  });

  it("does not backfill when the scout result is already full", () => {
    const all = Array.from({ length: 30 }, (_, i) => cand("proof", i));
    const shown = port.displaySet(all, { scout: true });
    expect(shown).toHaveLength(port.DISPLAY_CAP);
    expect(shown.some((c) => c.label === "scan")).toBe(false);
  });
});

describe("the provenance a collected clip carries onward", () => {
  const bank = port.buildBank();
  const pattern = bank.patterns[0]!;

  const cand = (over: Partial<TopClipCandidate>): TopClipCandidate =>
    ({
      srcId: "s1",
      srcTitle: "A source",
      idx: 0,
      t: "0:00:05",
      sec: 5,
      text: "the line as spoken",
      key: "s1@5@0",
      ctxPrev: "",
      ctxNext: "",
      label: null,
      ...over,
    }) as TopClipCandidate;

  it("carries the pattern FAMILY, not just the id", () => {
    // RECALL is the only app that computes the family. PULSE stamps it on an
    // auto-promoted ledger entry; without it those entries land in "unknown"
    // and TOP CLIPS can't read them back as personal proof. The loop that
    // makes "proven for you" mean anything stops closing, silently.
    const extra = port.handoffExtra(
      cand({
        label: "proof",
        match: {
          kind: "pattern",
          patternId: pattern.id,
          patternName: pattern.name,
          scaffold: pattern.scaffold,
        },
      }),
      bank,
    );
    expect(extra.patternId).toBe(pattern.id);
    expect(extra.patternName).toBe(pattern.name);
    expect(extra.patternFamily).toBe(pattern.family);
    expect(extra.patternFamily).toBeTruthy();
  });

  it("keeps label in the legacy vocabulary", () => {
    // The field crosses into blast_queue_v1. Widening a shared field's domain
    // for a cosmetic distinction is not worth it.
    for (const label of ["proof", "ai", "ai_proof", "scan"] as const) {
      expect(port.handoffExtra(cand({ label }), bank).label).toBe(label);
    }
  });

  it("carries provenance for a ledger match too, not only a pattern match", () => {
    const extra = port.handoffExtra(
      cand({
        label: "proof",
        match: { kind: "ledger", hook: "a winning hook", patternId: pattern.id },
      }),
      bank,
    );
    expect(extra.patternId).toBe(pattern.id);
    expect(extra.patternFamily).toBe(pattern.family);
  });

  it("omits fields it cannot fill rather than writing blanks", () => {
    // A present-but-empty patternId reads downstream as "this clip has a
    // pattern", which is exactly the bug the family carries the fix for.
    const extra = port.handoffExtra(cand({}), bank);
    expect(extra).not.toHaveProperty("patternId");
    expect(extra).not.toHaveProperty("patternFamily");
    expect(extra).not.toHaveProperty("label");
    expect(extra.hookText).toBe("the line as spoken");
  });

  it("survives a match naming a pattern that is no longer in the bank", () => {
    const extra = port.handoffExtra(
      cand({
        label: "proof",
        match: { kind: "pattern", patternId: "p_retired", patternName: "Retired", scaffold: "x" },
      }),
      bank,
    );
    expect(extra.patternId).toBe("p_retired");
    expect(extra.patternName).toBe("Retired");
    expect(extra).not.toHaveProperty("patternFamily");
  });
});
