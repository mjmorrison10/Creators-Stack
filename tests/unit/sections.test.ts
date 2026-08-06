import { describe, it, expect } from "vitest";
import { SECTIONS } from "../../src/sections";
import { router } from "../../src/router";

describe("section registry", () => {
  it("covers all four legacy apps", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      "recall",
      "hooklab",
      "blast",
      "pulse",
    ]);
  });

  it("gives every section a route the router actually serves", () => {
    // Guards against a section being added to the nav without a route, which
    // would render a dead link rather than a 404 anyone would notice.
    const served = new Set(
      (router.routes[0]?.children ?? []).map((c) => c.path),
    );
    for (const s of SECTIONS) {
      expect(served).toContain(s.path.replace(/^\//, ""));
    }
  });

  it("gives every section a distinct accent class", () => {
    const accents = SECTIONS.map((s) => s.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });
});
