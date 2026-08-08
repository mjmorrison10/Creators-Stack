/**
 * Caption suggestions: what we ask for, and how the answer is read back.
 * Ported from blast/app.js.
 *
 * BLAST is the last stop in RECALL → HOOKLAB → BLAST. When the creator has
 * logged winning hooks in HOOKLAB, the suggestions lean on those proven openers
 * — personal ledger over generic advice, the same hierarchy HOOKLAB itself
 * enforces. The evidence block is empty unless there are real winners, so the
 * prompt never claims a history the creator doesn't have.
 */

import { KEYS } from "../../data/keys";
import { readJSON, readRaw, writeRaw } from "../../data/storage";
import {
  DEFAULT_RULES,
  LENGTH_TARGETS,
  PLATFORMS,
  PLATFORM_RULES,
  type LengthPref,
} from "./platforms";
import type { HooklabState } from "../../data/schemas/hooklab";

/** Winning hooks fed into the prompt. */
export const MAX_EVIDENCE_WINNERS = 15;

export type EvidenceReason = "ok" | "absent" | "empty" | "no-winners";

export interface HooklabEvidence {
  winners: string[];
  found: boolean;
  reason: EvidenceReason;
}

/** Same-origin read of the HOOKLAB ledger; absence is fine, not an error. */
export function loadHooklabEvidence(): HooklabEvidence {
  const raw = readRaw(KEYS.hooklabState);
  if (!raw) return { winners: [], found: false, reason: "absent" };
  const st = readJSON<HooklabState>(KEYS.hooklabState, { ledger: [], comps: [] });
  const ledger = Array.isArray(st?.ledger) ? st.ledger : [];
  const winners = ledger
    .filter((e) => e && e.outcome === "winner" && e.hook)
    .slice(0, MAX_EVIDENCE_WINNERS)
    .map((e) => String(e.hook));
  const reason: EvidenceReason = winners.length ? "ok" : ledger.length ? "no-winners" : "empty";
  return { winners, found: true, reason };
}

/** Prompt fragment. Empty unless there are winners — no winners, no claim. */
export function hooklabEvidenceBlock(ev: HooklabEvidence | null | undefined): string {
  if (!ev || !ev.winners.length) return "";
  return (
    "\n\nThe creator's own proven winning hooks, from their HOOKLAB ledger " +
    "(these opened clips that actually performed — prefer captions that echo their structure, angle, " +
    "and voice):\n- " +
    ev.winners.join("\n- ") +
    "\nStill ground every caption in the transcript/clip; never invent claims or numbers it doesn't support."
  );
}

/**
 * Creator-supplied context about the clip's angle and tone. A transcript alone
 * often misses what a clip is really saying; this frames the captions correctly
 * without licensing the model to invent.
 */
export function clipContextBlock(ctx: string | null | undefined): string {
  const c = (ctx || "").trim();
  if (!c) return "";
  return (
    "\n\nContext from the creator about this clip (its real point, angle, and tone — use it to " +
    "frame the captions correctly, but do not state anything as fact that the transcript or clip " +
    "doesn't actually support):\n" +
    c
  );
}

/**
 * The length preference lives in its OWN key on purpose: the Settings save
 * handler rewrites `blast_settings_v1` wholesale (provider and keys only), so a
 * preference stored there would be wiped on every save.
 */
export function readLengthPref(): LengthPref {
  const v = readRaw(KEYS.blastCaptionLen) || "";
  return v === "short" || v === "long" ? v : "medium";
}

export function writeLengthPref(v: LengthPref): void {
  writeRaw(KEYS.blastCaptionLen, v);
}

/** Platforms where a "long" preference means a real story-style caption. */
const STORY_PLATFORMS = new Set(["Instagram Reels", "Facebook Reels", "LinkedIn"]);

export function lengthGuidanceBlock(pref: LengthPref, names: string[]): string {
  const wanted = names.length ? PLATFORMS.filter((p) => names.indexOf(p.name) >= 0) : PLATFORMS;
  const lines = wanted.map((p) => {
    const cap = (PLATFORM_RULES[p.name] ?? DEFAULT_RULES).limit;
    const tgt = LENGTH_TARGETS[p.name]?.[pref] ?? "";
    let line = `- ${p.name}: hard cap ${cap} chars (never exceed); aim for ${tgt} chars.`;
    if (p.name === "Snapchat Spotlight") {
      line += " Always <=80 no matter the preference — it's a short overlay.";
    }
    if (p.name === "YouTube Shorts") {
      line += " This is the Short's visible title, so keep it tight.";
    }
    if (pref === "long" && STORY_PLATFORMS.has(p.name)) {
      line +=
        " Write a genuinely long, story-style caption: a scroll-stopping first line, then several short" +
        " paragraphs of real substance the reader will stop to read while the video plays, a clear call to" +
        " action, and hashtags last.";
    }
    return line;
  });

  return (
    "\n\nCaption length — the creator wants " +
    pref.toUpperCase() +
    " captions. The hard caps below are ABSOLUTE; land each caption inside its target range:\n" +
    lines.join("\n") +
    '\nFor "Pinterest" the value is an object (see below); its title has a hard cap of 100 chars and its' +
    " description follows the Pinterest target above."
  );
}

export function captionSuggestPrompt(
  names: string[],
  count: number,
  pref: LengthPref = readLengthPref(),
): string {
  const plural = count > 1 ? "s" : "";
  return (
    `Propose exactly ${count} distinct caption option${plural} for each of ` +
    "these platforms, tailored to each platform's real conventions (typical length, hashtag style, tone): " +
    names.join(", ") +
    "." +
    lengthGuidanceBlock(pref, names) +
    '\n\nFor "Pinterest" only, each option must be an object with keys "title" (a punchy, searchable Pin ' +
    'title, hard cap 100 chars) and "description" (hard cap 500 chars) instead of a plain string.\n\n' +
    "Respond with ONLY a JSON object whose keys are exactly the platform names above and whose values are " +
    `arrays of exactly ${count} option${plural} each (for Pinterest, an array of ` +
    "those objects), ordered best-first. No markdown, no explanation, no extra keys."
  );
}

// ── reading the answer back ─────────────────────────────────────────────

export type PinterestOption = { title: string; description: string };
export type CaptionOption = string | PinterestOption;
export type CaptionResponse = Record<string, CaptionOption[]>;

export class NonJsonError extends Error {
  readonly nonJson = true;
}

/**
 * Pull whole `"Platform": <value>` pairs out of a reply that was cut off
 * mid-generation. String- and escape-aware, so a brace inside a caption can't
 * confuse it, and each pair is parsed on its own — a garbled pair is dropped
 * rather than guessed at. Returns null when nothing survives.
 */
export function salvageCaptionObject(text: string): CaptionResponse | null {
  const t = String(text ?? "");
  const start = t.indexOf("{");
  if (start < 0) return null;

  const scanString = (j: number): number => {
    if (t[j] !== '"') return -1;
    j++;
    while (j < t.length) {
      const c = t[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === '"') return j + 1;
      j++;
    }
    return -1;
  };

  /** End index of a balanced value starting at i, or -1 if it never closes. */
  const scanValue = (i: number): number => {
    let depth = 0;
    let j = i;
    while (j < t.length) {
      const c = t[j];
      if (c === '"') {
        const end = scanString(j);
        if (end < 0) return -1;
        j = end;
        continue;
      }
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") {
        depth--;
        if (depth === 0) return j + 1;
        if (depth < 0) return -1;
      } else if (depth === 0 && (c === "," || c === "}")) return j;
      j++;
    }
    return -1;
  };

  const out: CaptionResponse = {};
  let i = start + 1;
  while (i < t.length) {
    while (i < t.length && /[\s,]/.test(t[i]!)) i++;
    if (t[i] !== '"') break;
    const keyEnd = scanString(i);
    if (keyEnd < 0) break;
    let key: string;
    try {
      key = JSON.parse(t.slice(i, keyEnd)) as string;
    } catch {
      break;
    }
    let j = keyEnd;
    while (j < t.length && /\s/.test(t[j]!)) j++;
    if (t[j] !== ":") break;
    j++;
    while (j < t.length && /\s/.test(t[j]!)) j++;
    const valEnd = scanValue(j);
    if (valEnd < 0) break;
    try {
      out[key] = JSON.parse(t.slice(j, valEnd)) as CaptionOption[];
    } catch {
      // A garbled pair is dropped, not guessed at.
    }
    i = valEnd;
  }
  return Object.keys(out).length ? out : null;
}

/** Set on a salvaged response so callers can say the result is incomplete. */
export const PARTIAL = Symbol.for("blast.partialCaptions");

export function isPartial(v: CaptionResponse): boolean {
  return Boolean((v as unknown as Record<symbol, unknown>)[PARTIAL]);
}

export function parseCaptionJSON(text: string): CaptionResponse {
  // Reasoning models leak their monologue into the reply; the provider strips
  // the tagged form, this catches anything arriving by another path.
  let t = String(text ?? "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .trim();

  // Rescue the common near-miss: valid JSON wrapped in a markdown fence.
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) t = fenced[1]!;

  try {
    return JSON.parse(t) as CaptionResponse;
  } catch {
    // Truncated mid-generation? Keep the platforms that did arrive rather than
    // discarding a mostly-good response.
    const salvaged = salvageCaptionObject(t);
    if (salvaged) {
      Object.defineProperty(salvaged, PARTIAL, { value: true, enumerable: false });
      return salvaged;
    }

    // Providers under rate pressure often return the limit notice as PROSE with
    // HTTP 200, which sails past every status-code check and lands here. Name
    // the real problem — on a phone this message is the only diagnostics there is.
    if (/rate.?limit|too many requests|\b429\b|quota|resource.?exhausted/i.test(t)) {
      throw new Error(
        "Provider rate limited — wait a minute and retry, or switch provider/key in Settings",
      );
    }

    const snip = t.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!snip) throw new Error("Model returned an empty response");
    throw new NonJsonError(
      `Model didn't return JSON — it said: “${snip}${t.length > 120 ? "…" : ""}”`,
    );
  }
}

/**
 * Normalize one platform's options into the shape `blast_queue_v1` stores.
 *
 * Pinterest keeps its `{title, description}` OBJECTS, because that is what the
 * still-deployed legacy BLAST persists and reads back (blast/app.js:1346-1361)
 * — flattening them to a single string would leave legacy's Pin-title field
 * permanently empty and fuse the title into the description body. Every other
 * platform is a plain string.
 */
export function normalizeOptions(
  name: string,
  options: CaptionOption[] | undefined,
  count: number,
): CaptionOption[] {
  if (!Array.isArray(options)) return [];
  return options
    .slice(0, count)
    .map((o): CaptionOption => {
      if (name === "Pinterest" && o && typeof o === "object") {
        return {
          title: String(o.title || "").slice(0, 100),
          description: String(o.description || ""),
        };
      }
      return typeof o === "string" ? o : String((o as PinterestOption)?.description || "");
    })
    .filter((o) => (typeof o === "string" ? !!o : !!(o.title || o.description)));
}

/** The caption text an option contributes — Pinterest's title lives separately. */
export function captionOf(o: CaptionOption | undefined): string {
  if (o == null) return "";
  return typeof o === "string" ? o : o.description || "";
}

/** The Pin title an option carries, if any. */
export function titleOf(o: CaptionOption | undefined): string {
  return o && typeof o === "object" ? o.title || "" : "";
}
