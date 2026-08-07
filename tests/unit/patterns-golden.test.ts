import { describe, it, expect } from "vitest";
// The ORIGINAL module, imported straight from the legacy repo. patterns.js has
// no DOM or storage dependencies, so it loads as-is — which means the port can
// be proven identical rather than reviewed by eye.
import * as legacy from "../../../Hooklabs/patterns.js";
import * as port from "../../src/domain/hooklab/patterns";

/**
 * The pattern bank decides what HOOKLAB recommends. A silently altered scaffold
 * or strength would change every future ranking without failing anything, so
 * the port is diffed against the original entry by entry.
 */
describe("pattern bank parity with the original patterns.js", () => {
  it("carries every mechanism unchanged", () => {
    expect(port.MECHANISMS).toEqual(legacy.MECHANISMS);
    expect(port.MECHANISMS).toHaveLength(13);
  });

  it("carries every pattern unchanged, defaults applied identically", () => {
    // P() fills defaults (tier, mediums, strength…) — deep equality proves the
    // helper behaves the same, not just that the literals match.
    expect(port.PATTERNS).toEqual(legacy.PATTERNS);
  });

  it("carries the historical instances unchanged", () => {
    expect(port.HISTORICAL_INSTANCES).toEqual(legacy.HISTORICAL_INSTANCES);
    expect(port.HISTORICAL_INSTANCES).toHaveLength(12);
  });

  it("carries angles, CTAs, niches and platforms unchanged", () => {
    expect(port.ANGLES).toEqual(legacy.ANGLES);
    expect(port.CTA_PATTERNS).toEqual(legacy.CTA_PATTERNS);
    expect(port.NICHES).toEqual(legacy.NICHES);
    expect(port.PLATFORMS).toEqual(legacy.PLATFORMS);
    expect(port.MEDIUMS).toEqual(legacy.MEDIUMS);
  });

  it("carries the outcome weights unchanged", () => {
    // These weight the personal score; changing one re-ranks every pattern.
    expect(port.OUTCOMES).toEqual(legacy.OUTCOMES);
  });

  it("carries the label maps unchanged", () => {
    expect(port.EVIDENCE_LABELS).toEqual(legacy.EVIDENCE_LABELS);
    expect(port.TIER_LABELS).toEqual(legacy.TIER_LABELS);
  });

  it("computes tier membership and counts identically", () => {
    for (const tier of ["core", "extended", "historical"] as const) {
      expect(port.patternsByTier(tier)).toEqual(legacy.patternsByTier(tier));
    }
    expect(port.countByTier()).toEqual(legacy.countByTier());
  });

  it("has no pattern on the 'text-native' tier, in either copy", () => {
    // The source comments describe a text-native GROUP, but it was never a
    // tier value — those patterns are core/extended with text-only mediums.
    // A UI chip filtering on tier === "text-native" silently matched nothing.
    expect(legacy.patternsByTier("text-native")).toEqual([]);
    expect(port.PATTERNS.some((p) => (p.tier as string) === "text-native")).toBe(false);
    // The group itself is real, and reachable by medium.
    expect(port.PATTERNS.filter((p) => !p.mediums.includes("video")).length).toBeGreaterThan(0);
  });

  it("maps platforms to mediums identically", () => {
    for (const p of legacy.PLATFORMS as { id: string }[]) {
      expect(port.mediumForPlatform(p.id)).toBe(legacy.mediumForPlatform(p.id));
    }
    // Unknown platform must degrade the same way, not throw.
    expect(port.mediumForPlatform("nonexistent")).toBe(legacy.mediumForPlatform("nonexistent"));
  });
});

describe("pattern bank invariants", () => {
  it("has no duplicate pattern ids", () => {
    // The AI path resolves returned ids against this map; a duplicate would
    // make resolution depend on ordering.
    const ids = port.PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("indexes every pattern by id", () => {
    expect(port.PATTERNS_BY_ID.size).toBe(port.PATTERNS.length);
  });

  it("gives every pattern a scaffold and a mechanism", () => {
    for (const p of port.PATTERNS) {
      expect(p.scaffold, `${p.id} needs a scaffold`).toBeTruthy();
      expect(p.mechanism, `${p.id} needs a mechanism`).toBeTruthy();
      expect(p.strength, `${p.id} strength in range`).toBeGreaterThan(0);
      expect(p.strength).toBeLessThanOrEqual(1);
    }
  });

  it("points every historical instance at patterns that exist", () => {
    // An instance citing a removed pattern would render evidence for nothing.
    for (const h of port.HISTORICAL_INSTANCES) {
      for (const pid of h.patternIds) {
        expect(port.PATTERNS_BY_ID.has(pid), `${h.id} cites unknown pattern ${pid}`).toBe(true);
      }
    }
  });

  it("names a mechanism that exists for every pattern", () => {
    const known = new Set(port.MECHANISMS.map((m) => m.id));
    for (const p of port.PATTERNS) {
      expect(known.has(p.mechanism), `${p.id} has unknown mechanism ${p.mechanism}`).toBe(true);
    }
  });
});
