/**
 * HOOKLAB's AI drafting path, ported from Hooklabs/app.js:593-777.
 *
 * The product rule this whole file exists to protect: HOOKLAB does not invent
 * freeform viral hooks. It fills PROVEN scaffolds with grounded specifics, and
 * every candidate carries provenance — a pattern, a badge, a real win rate or
 * an honest admission that there isn't one. The model's job is wording, not
 * authority.
 *
 * That is why an unresolvable patternId is DROPPED rather than reattached: a
 * hook shown against a pattern it didn't come from would display a win rate,
 * a "proven" badge and evidence it never earned.
 *
 * Split into a pure prompt builder and a pure attach step so both can be
 * diffed against the original.
 */

import {
  ANGLES,
  CTA_PATTERNS,
  mediumForPlatform,
  type CtaPattern,
  type Pattern,
} from "./patterns";
import {
  entryMedium,
  jaccard,
  specificityScore,
  statusFor,
  type BadgeStatus,
  type ScoredPattern,
} from "./underwrite";
import { offlineFill } from "./offline";
import type { CompEntry, LedgerEntry, Medium } from "../../data/schemas/hooklab";
import { KEYS } from "../../data/keys";
import { readJSON, readRaw } from "../../data/storage";
import { readSharedKeys } from "../../data/stackdata/shared";

/**
 * Whether extended thinking is on, shared-store first then the legacy key.
 *
 * Defaults to ON, matching legacy (`getThinkingPref`, Hooklabs/app.js:150):
 * only an explicit "off" disables it. Flipping that default would quietly
 * change the quality of every draft for anyone who never touched the setting.
 */
export function readThinkingPref(): "on" | "off" {
  let v = "";
  try {
    v = readSharedKeys().aiThinking || readRaw(KEYS.hooklabThinking) || "";
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return v === "off" ? "off" : "on";
}

/**
 * The creator's brand-voice note, from HOOKLAB's own settings blob.
 *
 * Prompt rule 3 ("Respect brand voice notes if present") is inert without
 * this. The legacy app read `settings.brandVoice` straight out of
 * `hooklab_settings_v1`, and that blob still carries it for anyone migrating,
 * so it is read rather than reintroduced as a new field.
 */
export function readBrandVoice(): string {
  try {
    return readJSON<{ brandVoice?: string }>(KEYS.hooklabSettings, {}).brandVoice || "";
  } catch {
    return "";
  }
}

/** Caps, all verbatim from the legacy prompt assembly. */
export const AI_LIMITS = {
  patterns: 14,
  ledgerSample: 15,
  comps: 12,
  sourceMaterial: 2500,
  ctas: 3,
  results: 20,
} as const;

export const AI_CALL = {
  temperature: 0.55,
  /**
   * Thinking tokens count against maxOutputTokens on Gemini, so the cap has to
   * move with the toggle or the JSON itself gets truncated.
   */
  thinkingBudget: 2048,
  maxTokensThinking: 8192,
  maxTokens: 4096,
} as const;

export interface Brief {
  topic: string;
  sourceMaterial?: string;
  niche: string;
  platform: string;
  goal?: string;
  brandVoice?: string;
}

export function ctasForMedium(medium: Medium): CtaPattern[] {
  return CTA_PATTERNS.filter((c) => (c.mediums || ["video", "text"]).includes(medium));
}

/**
 * The prompt. Rule 6 is medium-dependent: a hook for X has to survive as
 * written text in 280 characters, where a video hook has to be sayable.
 */
export function buildAIPrompt(
  brief: Brief,
  selected: ScoredPattern[],
  ledger: LedgerEntry[],
  comps: CompEntry[],
): string {
  const medium = mediumForPlatform(brief.platform);
  const ctaList = ctasForMedium(medium);

  const ledgerSummary = ledger
    .filter((e) => entryMedium(e) === medium)
    .slice(0, AI_LIMITS.ledgerSample)
    .map((e) => ({
      hook: e.hook,
      outcome: e.outcome,
      family: e.family,
      platform: e.platform,
      medium: entryMedium(e),
    }));

  const compPayload = comps.slice(0, AI_LIMITS.comps).map((c) => ({
    hook: c.hook,
    niche: c.niche,
    notes: c.notes,
  }));

  const patternPayload = selected.map((s) => ({
    id: s.pattern.id,
    name: s.pattern.name,
    family: s.pattern.family,
    scaffold: s.pattern.scaffold,
    why: s.pattern.why,
    personalWinRate: s.winRate,
    fatigue: s.fatigue,
  }));

  const rule6 =
    medium === "text"
      ? "6. Written to stop the scroll, not to be spoken: strong first line, line breaks allowed, no filler. When platform is x, the hook must fit a single X post (≤280 characters).\n"
      : "6. Keep hooks speakable in under ~3 seconds when possible.\n";

  return (
    "You are HOOKLAB, an evidence-based hook underwriting engine for short-form creators.\n" +
    "You do NOT invent freeform viral hooks. You fill proven scaffolds with grounded specifics.\n" +
    "Rules:\n" +
    "1. Use ONLY the patterns provided. One candidate per pattern id.\n" +
    "2. Ground wording in the topic and source material. Prefer concrete nouns, numbers, stakes.\n" +
    "3. Respect brand voice notes if present.\n" +
    "4. Never invent fake statistics or claim a hook is proven unless ledger data supports it.\n" +
    "5. Avoid clichés: game-changer, unlock, revolutionary, incredible, amazing.\n" +
    rule6 +
    "7. Return strict JSON only.\n\n" +
    "Context:\n" +
    JSON.stringify(
      {
        topic: brief.topic,
        sourceMaterial: (brief.sourceMaterial || "").slice(0, AI_LIMITS.sourceMaterial),
        niche: brief.niche,
        platform: brief.platform,
        medium,
        // `|| ""` rather than the bare value: JSON.stringify drops an
        // undefined key entirely, so an omitted goal would remove the field
        // from the prompt instead of sending the empty string legacy sends.
        goal: brief.goal || "",
        brandVoice: brief.brandVoice || "",
        patterns: patternPayload,
        personalLedgerSample: ledgerSummary,
        marketComps: compPayload,
        note: "Prefer core-tier patterns for daily drivers. Historical patterns are durable mechanisms (e.g. diagnosis/halitosis lineage) — use when they fit. Extended is depth.",
      },
      null,
      2,
    ) +
    "\n\nReturn JSON shape:\n" +
    '{\n  "hooks": [\n    {\n      "patternId": "...",\n      "text": "final hook line",\n      "grounding": "short note on what evidence/source it used",\n      "angle": "myth-bust|teardown|proof|story|tactical"\n    }\n  ],\n  "ctas": [\n    { "id": "' +
    ctaList.map((c) => c.id).join("|") +
    '", "text": "..." }\n  ]\n}\n' +
    "Generate one hook per provided pattern. Generate exactly 3 CTAs."
  );
}

export interface AIHook {
  patternId?: string;
  text?: string;
  grounding?: string;
  angle?: string;
}

export interface AIReply {
  hooks?: AIHook[];
  ctas?: { id?: string; text?: string }[];
}

/** Extract the reply, tolerating a model that wrapped its JSON in prose. */
export function parseAIReply(raw: string): AIReply {
  try {
    return JSON.parse(raw) as AIReply;
  } catch {
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI returned non-JSON. Try again.");
    return JSON.parse(m[0]) as AIReply;
  }
}

export interface Candidate {
  id: string;
  text: string;
  pattern: Pattern;
  medium: Medium;
  score: number;
  winRate: number | null;
  personal: number;
  fatigue: number;
  compMatch: string | null;
  grounding: string;
  status: BadgeStatus;
  mode: "ai" | "offline-fallback";
  angle?: string | null;
}

export interface AngleSummary {
  id: string;
  name: string;
  description: string;
  sample: string | null;
  count: number;
  score: number;
}

export interface CtaSuggestion {
  id: string;
  name: string;
  text: string;
  why: string;
  score: number;
}

/** How much a comp match can move a score. Capped so one echo can't dominate. */
export const COMP_SIM_CAP = 0.4;
/** Below this the match isn't close enough to show as evidence. */
export const COMP_SHOW_MIN = 0.15;

/**
 * The badge ladder for an AI-drafted hook.
 *
 * Deliberately NOT `statusFor` — the legacy AI path writes its own ladder
 * inline (`Hooklabs/app.js:721-724`) and it differs from the offline one in
 * both directions:
 *
 *  - it has NO "mixed personal signal" rung (`winRate != null && personal >=
 *    0.45`), so a pattern with a weak personal record does not get promoted
 *    to `market` here;
 *  - it DOES have a comp rung, so a drafted line that closely echoes a stored
 *    market comp reads as `market` even when the pattern itself is under the
 *    0.8 strength bar.
 *
 * Using `statusFor` instead looked equivalent and wasn't: it produced a card
 * whose evidence line said "Similar to market comp: …" under a HYPOTHESIS
 * badge, and could over-claim `market` off a mixed personal record the legacy
 * would have called a hypothesis.
 *
 * The offline backfill below is a different case and correctly keeps
 * `statusFor` — there is no drafted text there, so there is no similarity to
 * measure.
 */
function aiStatusFor(item: ScoredPattern, bestSim: number): BadgeStatus {
  if (item.fatigue >= 1) return "fatigued";
  if (item.winRate != null && item.winRate >= 0.5 && item.personal >= 0.6) return "proven";
  if (item.pattern.strength >= 0.8 || bestSim > COMP_SHOW_MIN) return "market";
  return "hypo";
}

/**
 * Turn a model reply into ranked candidates.
 *
 * `newId` is injected so the differential can compare ids; the legacy uses a
 * random uid.
 */
export function attachHooks(
  reply: AIReply,
  selected: ScoredPattern[],
  topic: string,
  medium: Medium,
  comps: CompEntry[],
  sourceMaterial: string,
  newId: () => string,
): Candidate[] {
  const byId = new Map<string, ScoredPattern>();
  for (const s of selected) byId.set(s.pattern.id, s);

  const candidates: Candidate[] = [];
  for (const h of reply.hooks || []) {
    let item = h.patternId ? byId.get(h.patternId) : undefined;
    if (!item) {
      // A name is worth trying — models paraphrase ids. But there is no
      // third fallback: attaching this hook to an arbitrary pattern would
      // give it provenance it never earned, so it is dropped and the
      // offline pass below fills that pattern's slot honestly.
      item = selected.find((s) => s.pattern.name === h.patternId);
    }
    if (!item) continue;

    const text = (h.text || "").trim() || offlineFill(item.pattern.scaffold, topic);

    let bestComp: string | null = null;
    let bestSim = 0;
    for (const c of comps) {
      const sim = jaccard(text, c.hook);
      if (sim > bestSim) {
        bestSim = sim;
        bestComp = c.hook;
      }
    }

    const spec = specificityScore(text);
    candidates.push({
      id: newId(),
      text,
      pattern: item.pattern,
      medium,
      score: item.score * 0.7 + spec * 0.25 + Math.min(bestSim, COMP_SIM_CAP) * 0.15,
      winRate: item.winRate,
      personal: item.personal,
      fatigue: item.fatigue,
      compMatch: bestSim > COMP_SHOW_MIN ? bestComp : null,
      grounding: h.grounding || (sourceMaterial ? "source material" : "topic brief"),
      status: aiStatusFor(item, bestSim),
      mode: "ai",
      angle: h.angle || null,
    });
  }

  // Any pattern the model skipped still gets a candidate — labelled as a
  // scaffold fill, so the creator can see which lines the AI actually wrote.
  const have = new Set(candidates.map((c) => c.pattern.id));
  for (const item of selected) {
    if (have.has(item.pattern.id)) continue;
    candidates.push({
      id: newId(),
      text: offlineFill(item.pattern.scaffold, topic),
      pattern: item.pattern,
      medium,
      score: item.score * 0.7,
      winRate: item.winRate,
      personal: item.personal,
      fatigue: item.fatigue,
      compMatch: null,
      grounding: "scaffold fill (AI missed this pattern)",
      status: statusFor(item),
      mode: "offline-fallback",
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, AI_LIMITS.results);
}

/** The angles these candidates actually cover, best-scoring first. */
export function buildAngles(candidates: Candidate[]): AngleSummary[] {
  return ANGLES.map((a) => {
    const related = candidates.filter((c) => a.patternFamilies.includes(c.pattern.family));
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      sample: related[0]?.text ?? null,
      count: related.length,
      score: related.reduce((s, c) => s + c.score, 0) / (related.length || 1),
    };
  })
    .sort((x, y) => y.score - x.score)
    .slice(0, 5);
}

/**
 * Offline CTAs, used when the model returned none. Nudged by the stated goal
 * and by whatever the ledger says about engagement.
 */
export function buildCtas(
  topic: string,
  goal: string | undefined,
  medium: Medium | null,
  engagement?: { total: number; scoreSum: number },
): CtaSuggestion[] {
  const list = CTA_PATTERNS.filter(
    (c) => !medium || (c.mediums || ["video", "text"]).includes(medium),
  ).map((c) => {
    const boost = engagement && engagement.total ? engagement.scoreSum / engagement.total : 0.5;
    return {
      id: c.id,
      name: c.name,
      text: offlineFill(c.scaffold, topic),
      why: c.why,
      score:
        0.5 +
        boost * 0.3 +
        (goal === "comments" && ["question", "disagree", "reply-take"].includes(c.id) ? 0.15 : 0) +
        (goal === "saves" && ["save", "bookmark"].includes(c.id) ? 0.2 : 0) +
        (goal === "series" && c.id === "follow-series" ? 0.2 : 0) +
        // A medium-native CTA edges out a generic one within its own medium.
        (medium && c.mediums && c.mediums.length === 1 && c.mediums[0] === medium ? 0.05 : 0),
    };
  });
  list.sort((a, b) => b.score - a.score);
  return list.slice(0, AI_LIMITS.ctas);
}

/** Map the model's CTA picks onto real CTA patterns; fall back offline. */
export function attachCtas(
  reply: AIReply,
  topic: string,
  goal: string | undefined,
  medium: Medium,
  engagement?: { total: number; scoreSum: number },
): CtaSuggestion[] {
  const ctaList = ctasForMedium(medium);
  if (!reply.ctas || !reply.ctas.length || !ctaList.length) {
    return buildCtas(topic, goal, medium, engagement);
  }
  return reply.ctas.slice(0, AI_LIMITS.ctas).map((c) => {
    const base = ctaList.find((x) => x.id === c.id) || ctaList[0]!;
    return {
      id: base.id,
      name: base.name,
      text: c.text || offlineFill(base.scaffold, topic),
      why: base.why,
      score: 0.7,
    };
  });
}
