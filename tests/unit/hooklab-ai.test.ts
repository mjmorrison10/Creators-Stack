import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as port from "../../src/domain/hooklab/ai";
import { selectPatterns, type ScoredPattern } from "../../src/domain/hooklab/underwrite";
import { mediumForPlatform } from "../../src/domain/hooklab/patterns";
import { shouldRetryAsJson } from "../../src/services/llm/provider";
import type { CompEntry, LedgerEntry } from "../../src/data/schemas/hooklab";
import * as legacyPatterns from "../../../Hooklabs/patterns.js";

const APP_JS = resolve(import.meta.dirname, "../../../Hooklabs/app.js");

/**
 * HOOKLAB's AI path — the one place a model's output is dressed in the
 * creator's own evidence.
 *
 * Everything the port does here is either a prompt the model must follow or a
 * rule about what provenance a returned hook is allowed to claim, so it is
 * diffed against the original rather than trusted.
 *
 * `underwriteWithAI` is async and calls the provider, so it can't be sliced
 * whole. Instead the whole helper region is sliced and `generateText` is
 * replaced with a stub that CAPTURES the prompt and returns a canned reply —
 * which exercises the prompt builder and the attach block in one pass.
 */
function loadLegacy(): {
  run: (
    args: [string, string, string, string, string, string[]],
    reply: string,
    seed: { ledger: unknown[]; comps: unknown[]; brandVoice?: string },
  ) => { prompt: string; result: { hooks: unknown[]; angles: unknown[]; ctas: unknown[] } };
} {
  const src = readFileSync(APP_JS, "utf8");
  const start = src.indexOf("  function entryMedium(e) {");
  const stop = src.indexOf("  // ---------- render ----------");
  if (start === -1 || stop === -1 || stop <= start) {
    throw new Error("could not locate the underwriting region in Hooklabs/app.js");
  }

  let block = src.slice(start, stop);
  // Ids are injected so the diff is about content, not randomness.
  block = block.replace(/uid\(\)/g, "__uid()");
  // The provider call becomes a capture point.
  block = block.replace(/await generateText\(/, "await __capture(");

  const prelude = `
    var __seq = 0;
    function __uid() { return "id_test" + (++__seq); }
    var __prompt = "";
    async function __capture(_cfg, opts) { __prompt = opts.prompt; return __reply; }
    var __reply = "{}";
    var state = { ledger: [], comps: [] };
    var settings = { brandVoice: "", provider: "gemini" };
    function getThinkingPref() { return "off"; }
  `;

  const factory = new Function(
    "PATTERNS",
    "ANGLES",
    "CTA_PATTERNS",
    "OUTCOMES",
    "MECHANISMS",
    "HISTORICAL_INSTANCES",
    "MEDIUMS",
    "mediumForPlatform",
    `${prelude}${block}
     return {
       run: async function (args, reply, seed) {
         __seq = 0;
         __reply = reply;
         state.ledger = seed.ledger;
         state.comps = seed.comps;
         settings.brandVoice = seed.brandVoice || "";
         var result = await underwriteWithAI(args[0], args[1], args[2], args[3], args[4], args[5]);
         return { prompt: __prompt, result: result };
       },
     };`,
  );

  const lp = legacyPatterns as Record<string, unknown>;
  return factory(
    lp.PATTERNS,
    lp.ANGLES,
    lp.CTA_PATTERNS,
    lp.OUTCOMES,
    lp.MECHANISMS,
    lp.HISTORICAL_INSTANCES,
    lp.MEDIUMS,
    lp.mediumForPlatform,
  ) as ReturnType<typeof loadLegacy>;
}

const legacy = loadLegacy();

const LEDGER: LedgerEntry[] = [
  {
    id: "id_1",
    hook: "the hardest rep is the one nobody sees",
    patternId: "p1",
    family: "identity",
    outcome: "winner",
    platform: "tiktok",
    medium: "video",
    niche: "fitness",
    retention: "",
    views: "40000",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  } as LedgerEntry,
  {
    id: "id_2",
    hook: "nobody tells you this about discipline",
    patternId: "p2",
    family: "curiosity",
    outcome: "meh",
    platform: "tiktok",
    medium: "video",
    niche: "fitness",
    retention: "",
    views: "900",
    notes: "",
    createdAt: "2026-01-02T00:00:00.000Z",
  } as LedgerEntry,
];

const COMPS: CompEntry[] = [
  {
    id: "c_1",
    hook: "the hardest rep is the one nobody sees you do",
    niche: "fitness",
    notes: "a market comp",
    createdAt: "2026-01-01T00:00:00.000Z",
  } as CompEntry,
];

describe("the legacy slice", () => {
  it("really evaluated the original underwriter", async () => {
    const r = await (legacy.run as unknown as (
      a: unknown,
      b: string,
      c: unknown,
    ) => Promise<{ prompt: string }>)(
      ["a topic", "", "fitness", "tiktok", "views", []],
      "{}",
      { ledger: [], comps: [] },
    );
    expect(r.prompt).toContain("You are HOOKLAB");
  });
});

/** Run both engines over the same brief and reply. */
async function runBoth(
  brief: port.Brief,
  angleIds: string[],
  reply: string,
  ledger: LedgerEntry[],
  comps: CompEntry[],
) {
  const theirs = await (legacy.run as unknown as (
    a: unknown,
    b: string,
    c: unknown,
  ) => Promise<{ prompt: string; result: { hooks: unknown[]; ctas: unknown[]; angles: unknown[] } }>)(
    [
      brief.topic,
      brief.sourceMaterial ?? "",
      brief.niche,
      brief.platform,
      brief.goal ?? "",
      angleIds,
    ],
    reply,
    { ledger, comps, brandVoice: brief.brandVoice },
  );

  const selected = selectPatterns(ledger, brief.niche, brief.platform, angleIds).slice(
    0,
    port.AI_LIMITS.patterns,
  );
  const medium = mediumForPlatform(brief.platform);
  const myPrompt = port.buildAIPrompt(brief, selected, ledger, comps);
  let seq = 0;
  const parsed = port.parseAIReply(reply);
  const myHooks = port.attachHooks(
    parsed,
    selected,
    brief.topic,
    medium,
    comps,
    brief.sourceMaterial ?? "",
    () => `id_test${++seq}`,
  );

  return { theirs, myPrompt, myHooks, selected };
}

describe("the prompt, against the original", () => {
  const cases: { name: string; brief: port.Brief; angles: string[] }[] = [
    {
      name: "a video platform",
      brief: { topic: "discipline", niche: "fitness", platform: "tiktok", goal: "views" },
      angles: [],
    },
    {
      name: "a text platform, which changes rule 6",
      brief: { topic: "discipline", niche: "fitness", platform: "x", goal: "comments" },
      angles: [],
    },
    {
      name: "source material and a brand voice",
      brief: {
        topic: "discipline",
        sourceMaterial: "a long transcript ".repeat(300),
        niche: "fitness",
        platform: "tiktok",
        goal: "saves",
        brandVoice: "plain, no hype",
      },
      angles: [],
    },
    {
      name: "an angle filter",
      brief: { topic: "discipline", niche: "fitness", platform: "youtube", goal: "views" },
      angles: ["myth-bust"],
    },
  ];

  for (const c of cases) {
    it(`matches on: ${c.name}`, async () => {
      const r = await runBoth(c.brief, c.angles, "{}", LEDGER, COMPS);
      expect(r.myPrompt).toBe(r.theirs.prompt);
    });
  }

  it("caps the source material rather than sending a whole transcript", async () => {
    const r = await runBoth(
      { topic: "t", sourceMaterial: "x".repeat(9000), niche: "fitness", platform: "tiktok" },
      [],
      "{}",
      LEDGER,
      COMPS,
    );
    expect(r.myPrompt).toContain("x".repeat(port.AI_LIMITS.sourceMaterial));
    expect(r.myPrompt).not.toContain("x".repeat(port.AI_LIMITS.sourceMaterial + 1));
  });

  it("tells the model it may not invent proof", async () => {
    const r = await runBoth(
      { topic: "t", niche: "fitness", platform: "tiktok" },
      [],
      "{}",
      LEDGER,
      COMPS,
    );
    expect(r.myPrompt).toContain("Never invent fake statistics");
    expect(r.myPrompt).toContain("You do NOT invent freeform viral hooks");
  });
});

describe("attaching hooks, against the original", () => {
  /** Build a reply that names real pattern ids from the current selection. */
  function replyFor(selected: ScoredPattern[], extra: object[] = []): string {
    return JSON.stringify({
      hooks: [
        ...selected.slice(0, 3).map((s, i) => ({
          patternId: s.pattern.id,
          text: `a drafted hook ${i}`,
          grounding: "the transcript",
          angle: "proof",
        })),
        ...extra,
      ],
      ctas: [],
    });
  }

  const brief: port.Brief = {
    topic: "discipline",
    niche: "fitness",
    platform: "tiktok",
    goal: "views",
  };

  it("matches on a clean reply", async () => {
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const r = await runBoth(brief, [], replyFor(seed.selected), LEDGER, COMPS);
    expect(r.myHooks).toEqual(r.theirs.result.hooks);
  });

  it("DROPS a hook whose patternId resolves to nothing", async () => {
    // The rule the whole file exists for: a hook attached to an arbitrary
    // pattern would display a win rate and a badge it never earned.
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const reply = replyFor(seed.selected, [
      { patternId: "p_does_not_exist", text: "an orphan hook", grounding: "nothing" },
    ]);
    const r = await runBoth(brief, [], reply, LEDGER, COMPS);

    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    expect(r.myHooks.some((h) => h.text === "an orphan hook")).toBe(false);
  });

  it("resolves a hook the model named rather than id'd", async () => {
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const named = seed.selected[0]!.pattern.name;
    const reply = JSON.stringify({
      hooks: [{ patternId: named, text: "matched by name", grounding: "g" }],
      ctas: [],
    });
    const r = await runBoth(brief, [], reply, LEDGER, COMPS);
    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    expect(r.myHooks.some((h) => h.text === "matched by name")).toBe(true);
  });

  it("backfills every pattern the model skipped, labelled as a scaffold fill", async () => {
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const r = await runBoth(brief, [], replyFor(seed.selected), LEDGER, COMPS);

    const fills = r.myHooks.filter((h) => h.mode === "offline-fallback");
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) expect(f.grounding).toBe("scaffold fill (AI missed this pattern)");
    expect(r.myHooks).toEqual(r.theirs.result.hooks);
  });

  it("falls back to a scaffold fill when the model returned empty text", async () => {
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const reply = JSON.stringify({
      hooks: [{ patternId: seed.selected[0]!.pattern.id, text: "   ", grounding: "g" }],
      ctas: [],
    });
    const r = await runBoth(brief, [], reply, LEDGER, COMPS);
    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    expect(r.myHooks[0]!.text.trim()).not.toBe("");
  });

  it("matches when a comp echoes the drafted hook", async () => {
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const reply = JSON.stringify({
      hooks: [
        {
          patternId: seed.selected[0]!.pattern.id,
          text: "the hardest rep is the one nobody sees you do",
          grounding: "g",
        },
      ],
      ctas: [],
    });
    const r = await runBoth(brief, [], reply, LEDGER, COMPS);
    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    expect(r.myHooks[0]!.compMatch).toBeTruthy();
  });

  it("reads a comp echo as MARKET even on a pattern under the strength bar", async () => {
    // Found by review, and the reason the AI path can't just reuse `statusFor`.
    //
    // The legacy AI ladder has a comp rung that the offline ladder does not:
    // a drafted line that closely echoes a stored market comp is `market` even
    // when the pattern behind it sits under 0.8 strength. Every pattern in the
    // DEFAULT top-14 is at or above 0.84, so that rung short-circuits and both
    // ladders agree — which is exactly why this went unnoticed. The `tactical`
    // angle pulls in question-bait (0.79), where they diverge.
    //
    // Without it the card contradicts itself: the evidence line says "Similar
    // to market comp: …" underneath a HYPOTHESIS badge.
    const angles = ["tactical"];
    const seed = await runBoth(brief, angles, "{}", [], COMPS);
    const weak = seed.selected.find((s) => s.pattern.strength < 0.8);
    expect(weak, "the tactical angle should select a sub-0.8 pattern").toBeTruthy();

    const reply = JSON.stringify({
      hooks: [
        {
          patternId: weak!.pattern.id,
          text: "the hardest rep is the one nobody sees you do",
          grounding: "g",
        },
      ],
      ctas: [],
    });
    const r = await runBoth(brief, angles, reply, [], COMPS);

    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    const drafted = r.myHooks.find((h) => h.mode === "ai")!;
    expect(drafted.compMatch).toBeTruthy();
    expect(drafted.status).toBe("market");
  });

  it("stays HYPOTHESIS on the same pattern when nothing echoes it", async () => {
    // The other side of the rung — proof it is the comp doing the work and not
    // the pattern, so the previous test can actually fail.
    const angles = ["tactical"];
    const seed = await runBoth(brief, angles, "{}", [], COMPS);
    const weak = seed.selected.find((s) => s.pattern.strength < 0.8)!;

    const reply = JSON.stringify({
      hooks: [{ patternId: weak.pattern.id, text: "an entirely unrelated line", grounding: "g" }],
      ctas: [],
    });
    const r = await runBoth(brief, angles, reply, [], COMPS);

    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    const drafted = r.myHooks.find((h) => h.mode === "ai")!;
    expect(drafted.compMatch).toBeNull();
    expect(drafted.status).toBe("hypo");
  });

  it("does NOT promote a mixed personal record the way the offline ladder does", async () => {
    // `statusFor` has a "mixed personal signal" rung (winRate != null &&
    // personal >= 0.45) that the AI ladder omits. A drafted hook must not
    // inherit it — that would claim market proof off a record the creator's
    // own numbers call ambiguous.
    // Reaching that band takes some care, and the care IS the point — a first
    // attempt without it left the mutation alive. One winner plus one dead in
    // the engagement family puts personal at 0.525 with a win rate of 0.5,
    // landing inside the band. But two same-family entries also score 0.55
    // fatigue, which drags question-bait (0.79) out of the top 14 entirely, so
    // ten unrelated entries go in FIRST — HOOKLAB unshifts, so fatigue's
    // 10-entry window no longer sees the pair while familyStats still counts
    // them.
    const angles = ["tactical"];
    const pad = (n: number, fam: string, outcome: string): LedgerEntry[] =>
      Array.from(
        { length: n },
        (_, i) =>
          ({
            ...LEDGER[1]!,
            id: `${fam}_${outcome}_${i}`,
            family: fam,
            outcome,
          }) as LedgerEntry,
      );
    const mixed: LedgerEntry[] = [
      ...pad(10, "unrelated", "meh"),
      ...pad(1, "engagement", "winner"),
      ...pad(1, "engagement", "dead"),
    ];

    const seed = await runBoth(brief, angles, "{}", mixed, []);
    const weak = seed.selected.find((s) => s.pattern.family === "engagement")!;
    expect(weak.pattern.strength).toBeLessThan(0.8);
    expect(weak.winRate).not.toBeNull();
    expect(weak.personal).toBeGreaterThanOrEqual(0.45);
    expect(weak.personal).toBeLessThan(0.6);
    expect(weak.fatigue).toBeLessThan(1);

    const reply = JSON.stringify({
      hooks: [{ patternId: weak.pattern.id, text: "a drafted line", grounding: "g" }],
      ctas: [],
    });
    const r = await runBoth(brief, angles, reply, mixed, []);
    expect(r.myHooks).toEqual(r.theirs.result.hooks);

    const drafted = r.myHooks.find((h) => h.mode === "ai")!;
    expect(drafted.status).toBe("hypo");
  });

  it("matches on an empty reply — every slot filled offline", async () => {
    const r = await runBoth(brief, [], JSON.stringify({ hooks: [], ctas: [] }), LEDGER, COMPS);
    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    expect(r.myHooks.every((h) => h.mode === "offline-fallback")).toBe(true);
  });

  it("caps the result set when the model ignores one-hook-per-pattern", async () => {
    // Found by mutation testing: with 14 selected patterns and one hook each,
    // the total can never reach the cap, so removing it changed nothing. The
    // cap only earns its place when a model disregards rule 1 and returns
    // many hooks for the SAME pattern id — which is exactly the case that
    // would otherwise flood the results.
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const id = seed.selected[0]!.pattern.id;
    const flood = JSON.stringify({
      hooks: Array.from({ length: 40 }, (_, i) => ({
        patternId: id,
        text: `duplicate draft ${i}`,
        grounding: "g",
      })),
      ctas: [],
    });
    const r = await runBoth(brief, [], flood, LEDGER, COMPS);
    expect(r.myHooks).toEqual(r.theirs.result.hooks);
    expect(r.myHooks).toHaveLength(port.AI_LIMITS.results);
  });

  it("never emits a hook without a real pattern behind it", async () => {
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const r = await runBoth(brief, [], replyFor(seed.selected), LEDGER, COMPS);
    for (const h of r.myHooks) {
      expect(h.pattern?.id, JSON.stringify(h)).toBeTruthy();
      expect(seed.selected.some((s) => s.pattern.id === h.pattern.id)).toBe(true);
    }
  });
});

describe("reading a reply that isn't clean JSON", () => {
  it("extracts JSON wrapped in prose", () => {
    const r = port.parseAIReply('Sure! Here you go:\n```json\n{"hooks":[]}\n```');
    expect(r.hooks).toEqual([]);
  });

  it("throws something a human can act on when there is no JSON at all", () => {
    expect(() => port.parseAIReply("I cannot help with that.")).toThrow(/non-JSON/);
  });

  it("TAGS that failure so the one nudge retry actually fires", () => {
    // Found by audit: `shouldRetryAsJson` keys on a `nonJson` property, and a
    // plain Error carries none — so wrapping the call in `withJsonRetry` was
    // inert for the exact case it exists to handle.
    let thrown: unknown;
    try {
      port.parseAIReply("I cannot help with that.");
    } catch (e) {
      thrown = e;
    }
    expect(shouldRetryAsJson(thrown)).toBe(true);
  });

  it("keeps the hooks that arrived when the reply was cut off mid-array", async () => {
    // HOOKLAB asks for 14 hooks plus 3 CTAs against its own token cap, so a
    // long reply gets truncated. attachHooks backfills whatever is missing,
    // which makes discarding the whole reply strictly worse than keeping the
    // complete objects — this is what `partialOnTruncate` is set FOR.
    const seed = await runBoth(
      { topic: "discipline", niche: "fitness", platform: "tiktok", goal: "views" },
      [],
      "{}",
      LEDGER,
      COMPS,
    );
    const ids = seed.selected.slice(0, 3).map((s) => s.pattern.id);
    const full = JSON.stringify({
      hooks: ids.map((id, i) => ({ patternId: id, text: `hook ${i}`, grounding: "g" })),
      ctas: [],
    });
    // Cut it mid-way through the third hook object.
    const truncated = full.slice(0, full.indexOf(`"hook 2"`) + 4);

    const r = port.parseAIReply(truncated);
    expect(r.hooks).toHaveLength(2);
    expect(r.hooks!.map((h) => h.patternId)).toEqual(ids.slice(0, 2));
    // The half-written one is dropped, not guessed at — a partial object has
    // no trustworthy patternId, and that is the whole provenance contract.
    expect(r.hooks!.some((h) => h.text === "hook 2")).toBe(false);
  });

  it("does not mistake a brace inside a hook for structure", () => {
    const reply =
      '{"hooks":[{"patternId":"p1","text":"use {topic} literally } here","grounding":"g"},{"patternId":"p2"';
    const r = port.parseAIReply(reply);
    expect(r.hooks).toHaveLength(1);
    expect(r.hooks![0]!.text).toBe("use {topic} literally } here");
  });

  it("still fails loudly when the truncation left nothing complete", () => {
    expect(() => port.parseAIReply('{"hooks":[{"patternId":"p1","tex')).toThrow(/non-JSON/);
  });
});

describe("CTAs", () => {
  it("maps the model's picks onto real CTA patterns", () => {
    const list = port.ctasForMedium("video");
    const out = port.attachCtas(
      { ctas: [{ id: list[0]!.id, text: "my cta" }] },
      "discipline",
      "views",
      "video",
    );
    expect(out[0]).toMatchObject({ id: list[0]!.id, text: "my cta", name: list[0]!.name });
  });

  it("falls back to a real pattern when the model invents a CTA id", () => {
    // Unlike a hook, a CTA carries no personal provenance, so mapping it onto
    // the first real pattern claims nothing untrue.
    const out = port.attachCtas(
      { ctas: [{ id: "not-a-real-cta", text: "still useful" }] },
      "discipline",
      "views",
      "video",
    );
    expect(out[0]!.text).toBe("still useful");
    expect(port.ctasForMedium("video").some((c) => c.id === out[0]!.id)).toBe(true);
  });

  it("builds them offline when the model returned none", () => {
    const out = port.attachCtas({ ctas: [] }, "discipline", "comments", "video");
    expect(out).toHaveLength(port.AI_LIMITS.ctas);
    expect(out.every((c) => c.text.length > 0)).toBe(true);
  });

  it("only offers CTAs that fit the medium", () => {
    for (const medium of ["video", "text"] as const) {
      for (const c of port.ctasForMedium(medium)) {
        expect(c.mediums.includes(medium), `${c.id} on ${medium}`).toBe(true);
      }
    }
  });

  it("nudges toward the stated goal", () => {
    const comments = port.buildCtas("t", "comments", "video");
    const saves = port.buildCtas("t", "saves", "video");
    expect(comments.map((c) => c.id)).not.toEqual(saves.map((c) => c.id));
  });
});

describe("angle summaries", () => {
  it("reports how many candidates cover each angle, best first", async () => {
    const brief: port.Brief = { topic: "t", niche: "fitness", platform: "tiktok" };
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    const angles = port.buildAngles(seed.myHooks);
    expect(angles.length).toBeGreaterThan(0);
    expect(angles.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i - 1]!.score).toBeGreaterThanOrEqual(angles[i]!.score);
    }
  });

  it("shows a sample only for angles something actually covers", async () => {
    const brief: port.Brief = { topic: "t", niche: "fitness", platform: "tiktok" };
    const seed = await runBoth(brief, [], "{}", LEDGER, COMPS);
    for (const a of port.buildAngles(seed.myHooks)) {
      if (a.count === 0) expect(a.sample).toBeNull();
      else expect(a.sample).toBeTruthy();
    }
  });
});
