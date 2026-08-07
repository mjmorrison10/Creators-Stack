import { describe, it, expect } from "vitest";
import {
  evidenceLine,
  familyStats,
  fatigueScore,
  insightRows,
  jaccard,
  selectPatterns,
  specificityScore,
  statusFor,
  tierBoost,
  MIN_INSIGHT_SAMPLE,
  SELECTION,
  WEIGHTS,
  type ScoredPattern,
} from "../../src/domain/hooklab/underwrite";
import { PATTERNS } from "../../src/domain/hooklab/patterns";
import type { LedgerEntry, Outcome } from "../../src/data/schemas/hooklab";

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: `id_${Math.random().toString(36).slice(2)}`,
    hook: "a hook",
    outcome: "winner" as Outcome,
    family: "curiosity",
    medium: "video",
    platform: "tiktok",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("personal evidence from the ledger", () => {
  it("scores outcomes by their documented weights", () => {
    const stats = familyStats([
      entry({ outcome: "winner" }),
      entry({ outcome: "meh" }),
      entry({ outcome: "dead" }),
    ]);
    const c = stats.curiosity!;
    expect(c.total).toBe(3);
    expect(c.wins).toBe(1);
    // winner 1.0 + meh 0.45 + dead 0.05
    expect(c.scoreSum).toBeCloseTo(1.5);
  });

  it("splits by medium, because a video open is not a text post", () => {
    const ledger = [
      entry({ medium: "video", family: "curiosity" }),
      entry({ medium: "text", family: "curiosity" }),
    ];
    expect(familyStats(ledger, "video").curiosity?.total).toBe(1);
    expect(familyStats(ledger, "text").curiosity?.total).toBe(1);
    expect(familyStats(ledger).curiosity?.total).toBe(2);
  });

  it("treats an unrecognized outcome as neutral rather than zero", () => {
    const stats = familyStats([entry({ outcome: "bogus" as Outcome })]);
    expect(stats.curiosity?.scoreSum).toBeCloseTo(0.45);
  });

  it("caps stored recent hooks so the sample stays bounded", () => {
    const ledger = Array.from({ length: 20 }, (_, i) => entry({ hook: `hook ${i}` }));
    expect(familyStats(ledger).curiosity?.recentHooks).toHaveLength(8);
  });
});

describe("fatigue", () => {
  it("steps down in the documented tiers", () => {
    const mk = (n: number) => Array.from({ length: n }, () => entry({ family: "curiosity" }));
    expect(fatigueScore(mk(0), "p", "curiosity")).toBe(0);
    expect(fatigueScore(mk(1), "p", "curiosity")).toBe(0.25);
    expect(fatigueScore(mk(2), "p", "curiosity")).toBe(0.55);
    expect(fatigueScore(mk(3), "p", "curiosity")).toBe(1);
    expect(fatigueScore(mk(9), "p", "curiosity")).toBe(1);
  });

  it("only looks at the last 10 entries", () => {
    // Repetition matters when it's recent; lifetime totals don't fatigue anyone.
    const old = Array.from({ length: 10 }, () => entry({ family: "other" }));
    const ledger = [...old, ...Array.from({ length: 5 }, () => entry({ family: "curiosity" }))];
    expect(fatigueScore(ledger, "p", "curiosity")).toBe(0);
  });

  it("counts a repeated pattern id even under a different family", () => {
    const ledger = Array.from({ length: 3 }, () => entry({ patternId: "p1", family: "other" }));
    expect(fatigueScore(ledger, "p1", "curiosity")).toBe(1);
  });
});

describe("specificity", () => {
  it("rewards concrete, first-person, short claims", () => {
    expect(specificityScore("I cut 3 minutes off my edit")).toBeGreaterThan(0.7);
  });

  it("penalizes marketing filler", () => {
    const hype = specificityScore("This amazing game-changer will unlock growth");
    const plain = specificityScore("This will help growth");
    expect(hype).toBeLessThan(plain);
  });

  it("never exceeds 1", () => {
    expect(specificityScore("I built 3 things in 2 days — worth it?")).toBeLessThanOrEqual(1);
  });
});

describe("token similarity", () => {
  it("is 1 for identical text and 0 with no overlap", () => {
    expect(jaccard("hook about growth", "hook about growth")).toBe(1);
    expect(jaccard("alpha beta", "gamma delta")).toBe(0);
  });

  it("is 0 when either side is empty, rather than NaN", () => {
    expect(jaccard("", "something")).toBe(0);
    expect(jaccard("something", "")).toBe(0);
  });
});

describe("scoring weights", () => {
  it("weights personal ledger evidence above raw market strength", () => {
    // The product hierarchy, expressed numerically: your ledger outranks the
    // generic prior. If this inverts, the app is guessing rather than underwriting.
    expect(WEIGHTS.personal).toBeGreaterThan(WEIGHTS.strength);
  });

  it("pins the tier boosts", () => {
    expect(tierBoost("core")).toBe(0.12);
    expect(tierBoost("historical")).toBe(0.06);
    expect(tierBoost("extended")).toBe(0);
    expect(tierBoost("unknown")).toBe(0);
  });
});

describe("pattern selection", () => {
  it("hard-filters by medium rather than merely down-ranking", () => {
    const picked = selectPatterns([], "general", "x"); // x is a text platform
    for (const p of picked) {
      expect(p.pattern.mediums, `${p.pattern.id} must support text`).toContain("text");
    }
  });

  it("respects the pool limit and per-family cap", () => {
    const picked = selectPatterns([], "general", "tiktok");
    expect(picked.length).toBeLessThanOrEqual(SELECTION.poolLimit);

    const perFamily: Record<string, number> = {};
    for (const p of picked) {
      perFamily[p.pattern.family] = (perFamily[p.pattern.family] ?? 0) + 1;
    }
    for (const [fam, n] of Object.entries(perFamily)) {
      expect(n, `family ${fam} over cap`).toBeLessThanOrEqual(SELECTION.maxPerFamilyFallback);
    }
  });

  it("returns results ranked by score", () => {
    const picked = selectPatterns([], "general", "tiktok");
    const scores = picked.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("restricts to the families an angle allows", () => {
    const picked = selectPatterns([], "general", "tiktok", ["myth-bust"]);
    // Angle-mismatched patterns score 0.15 on that term, so the top result
    // should belong to a family the angle actually names.
    expect(["contrarian", "curiosity"]).toContain(picked[0]?.pattern.family);
  });

  it("demotes a family the user has just leaned on", () => {
    const fresh = selectPatterns([], "general", "tiktok");
    const topFamily = fresh[0]!.pattern.family;
    const fatigued = selectPatterns(
      Array.from({ length: 3 }, () => entry({ family: topFamily })),
      "general",
      "tiktok",
    );
    const before = fresh.find((p) => p.pattern.family === topFamily)!.score;
    const after = fatigued.find((p) => p.pattern.family === topFamily)?.score ?? -Infinity;
    expect(after).toBeLessThan(before);
  });

  it("gives every pattern a neutral personal score with an empty ledger", () => {
    // No history must not read as bad history.
    for (const p of selectPatterns([], "general", "tiktok")) {
      expect(p.winRate).toBeNull();
      expect(p.personal).toBe(0.5);
    }
  });
});

describe("the badge ladder", () => {
  const base = (over: Partial<ScoredPattern>): ScoredPattern => ({
    pattern: PATTERNS[0]!,
    score: 1,
    winRate: null,
    fatigue: 0,
    personal: 0.5,
    ...over,
  });

  it("says proven only when the user's OWN ledger backs it", () => {
    expect(statusFor(base({ winRate: 0.6, personal: 0.7 }))).toBe("proven");
    // Strong market structure alone is never "proven for you".
    expect(statusFor(base({ winRate: null, personal: 0.9 }))).not.toBe("proven");
  });

  it("falls back to market on mixed personal signal", () => {
    expect(statusFor(base({ winRate: 0.3, personal: 0.5 }))).toBe("market");
  });

  it("calls an unbacked weak pattern a hypothesis, not a recommendation", () => {
    const weak = PATTERNS.find((p) => p.strength < 0.8)!;
    expect(statusFor(base({ pattern: weak }))).toBe("hypo");
  });

  it("lets fatigue override even a proven record", () => {
    // Order matters: a proven family you've overused is still a bad next move.
    expect(statusFor(base({ fatigue: 1, winRate: 0.9, personal: 0.9 }))).toBe("fatigued");
  });
});

describe("evidence line", () => {
  const item = (over: Partial<ScoredPattern>): ScoredPattern => ({
    pattern: PATTERNS[0]!,
    score: 1,
    winRate: null,
    fatigue: 0,
    personal: 0.5,
    ...over,
  });

  it("states a measured win rate", () => {
    expect(evidenceLine(item({ winRate: 0.5 }))).toContain("50%");
  });

  it("says there is no history rather than showing 0%", () => {
    // Rendering "0%" would read as "this fails", not "this is untested".
    const line = evidenceLine(item({ winRate: null }));
    expect(line).toContain("No personal history yet");
    expect(line).not.toMatch(/\d+%/);
  });

  it("warns when the family is fatigued", () => {
    expect(evidenceLine(item({ fatigue: 1 }))).toMatch(/fatigue risk/i);
  });
});

describe("insights", () => {
  it("hides any group with fewer than three entries", () => {
    // "100% win rate" off one post is the fake percentage the product refuses
    // to show.
    const ledger = [
      entry({ platform: "tiktok", outcome: "winner" }),
      entry({ platform: "tiktok", outcome: "winner" }),
      entry({ platform: "x", outcome: "winner" }),
    ];
    const rows = insightRows(ledger, (e) => e.platform);
    expect(rows.map((r) => r.key)).toEqual([]);
    expect(MIN_INSIGHT_SAMPLE).toBe(3);
  });

  it("reports a group at the threshold, and always carries n", () => {
    const ledger = [
      entry({ platform: "tiktok", outcome: "winner" }),
      entry({ platform: "tiktok", outcome: "winner" }),
      entry({ platform: "tiktok", outcome: "dead" }),
    ];
    const rows = insightRows(ledger, (e) => e.platform);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "tiktok", wins: 2, total: 3 });
    expect(rows[0]!.winRate).toBeCloseTo(2 / 3);
  });

  it("ranks by win rate, breaking ties on sample size", () => {
    const mk = (platform: string, wins: number, total: number) =>
      Array.from({ length: total }, (_, i) =>
        entry({ platform, outcome: i < wins ? "winner" : "dead" }),
      );
    const rows = insightRows([...mk("a", 2, 4), ...mk("b", 3, 6), ...mk("c", 4, 4)], (e) => e.platform);
    expect(rows[0]?.key).toBe("c"); // 100%
    expect(rows[1]?.total).toBe(6); // both 50%, larger sample first
  });
});
