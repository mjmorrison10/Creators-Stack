/**
 * The unified LLM provider.
 *
 * Replaces three near-identical copies of llm.js that lived in recall, blast
 * and Hooklabs. They differed only in wrapper style, comment wording and the
 * X-Title value — no semantic drift — so this is blast's ES-module copy with
 * one shared attribution string.
 *
 * `withGeminiFallback` used to live in blast/app.js rather than llm.js, so only
 * BLAST got the fallback. It belongs here, where every section inherits it.
 */

import {
  geminiGenerateFromMedia,
  geminiGenerateText,
  GEMINI_INLINE_MAX_BYTES,
  GEMINI_MAX_BYTES,
  type GeminiOptions,
} from "./gemini";
import {
  extractOpenrouterText,
  openrouterBody,
  openrouterPost,
  OPENROUTER_INLINE_MAX_BYTES,
  type OpenrouterOptions,
} from "./openrouter";
import type { RetryReporter } from "./timeouts";

export { GEMINI_INLINE_MAX_BYTES, GEMINI_MAX_BYTES, OPENROUTER_INLINE_MAX_BYTES };
export { isReasoningModel, stripThinkTags, SpentThinkingError } from "./openrouter";

export type ProviderName = "gemini" | "openrouter";

export interface ProviderConfig {
  provider: ProviderName;
  geminiKey?: string;
  openrouterKey?: string;
  openrouterModel?: string;
}

export type GenerateOptions = GeminiOptions & OpenrouterOptions;

/** Video input is Gemini-only — OpenRouter models don't reliably support it. */
export function providerSupportsVideo(cfg: ProviderConfig): boolean {
  return cfg.provider === "gemini";
}

function requireKey(cfg: ProviderConfig): string {
  if (cfg.provider === "gemini") {
    if (!cfg.geminiKey) throw new Error("No Gemini API key — open Settings");
    return cfg.geminiKey;
  }
  if (!cfg.openrouterKey) throw new Error("No OpenRouter API key — open Settings");
  return cfg.openrouterKey;
}

export async function generateText(
  cfg: ProviderConfig,
  opts: GenerateOptions,
  onRetry?: RetryReporter | null,
): Promise<string> {
  const key = requireKey(cfg);
  if (cfg.provider === "gemini") return geminiGenerateText(key, opts, onRetry);

  const model = cfg.openrouterModel || "";
  if (!model) throw new Error("No OpenRouter model selected — open Settings");
  const body = openrouterBody(model, [{ role: "user", content: opts.prompt }], opts, opts.temperature ?? 0.4);
  const out = await openrouterPost(key, body, "AI request", onRetry);
  return extractOpenrouterText(out.res, out.bodyText, opts.partialOnTruncate);
}

export async function generateFromMedia(
  cfg: ProviderConfig,
  opts: GenerateOptions & { file: File },
  onRetry?: RetryReporter | null,
): Promise<string> {
  const key = requireKey(cfg);
  if (cfg.provider === "gemini") return geminiGenerateFromMedia(key, opts, onRetry);

  if (opts.mediaKind === "video") {
    throw new Error(
      "Video analysis needs Gemini — OpenRouter models don't reliably support " +
        "video input. Switch provider in Settings.",
    );
  }
  if (opts.file.size > OPENROUTER_INLINE_MAX_BYTES) {
    throw new Error("File too large for OpenRouter — switch to Gemini in Settings.");
  }
  throw new Error("Media analysis on OpenRouter is not supported — switch to Gemini in Settings.");
}

/**
 * Failures worth retrying on the other provider: the request never really
 * happened, or the model burned its budget without answering. A rejected key or
 * a malformed prompt would fail identically on Gemini, so those pass straight
 * through.
 */
export function isProviderFailure(err: unknown): boolean {
  const e = err as { spentThinking?: boolean; nonJson?: boolean; message?: string } | null;
  const msg = e?.message ?? "";
  return Boolean(
    e &&
      (e.spentThinking ||
        e.nonJson ||
        /timed out after/i.test(msg) ||
        /rate limited/i.test(msg) ||
        /overloaded/i.test(msg) ||
        /no longer available on OpenRouter/i.test(msg)),
  );
}

export interface FallbackNotices {
  onPhase?: (phase: string) => void;
  /** Told after the fact, so the user knows which key produced the result. */
  onFellBack?: (message: string) => void;
}

const FELL_BACK_MSG = "OpenRouter didn't answer — this came from your Gemini key";

/**
 * Run an operation on the configured provider, silently retrying on Gemini when
 * OpenRouter fails in a way that suggests the model, not the request, was the
 * problem. Only fires when OpenRouter is selected AND a Gemini key exists.
 */
export async function withGeminiFallback<T>(
  cfg: ProviderConfig,
  run: (cfg: ProviderConfig) => Promise<T>,
  notices: FallbackNotices = {},
): Promise<T> {
  try {
    return await run(cfg);
  } catch (err) {
    if (cfg.provider !== "openrouter" || !cfg.geminiKey || !isProviderFailure(err)) throw err;
    notices.onPhase?.("OpenRouter didn't answer — trying Gemini");
    const out = await run({ ...cfg, provider: "gemini" });
    notices.onFellBack?.(FELL_BACK_MSG);
    return out;
  }
}

/**
 * A model that replied with prose, or spent its budget reasoning, usually
 * complies when told bluntly. Retry the SAME prompt once with a hard
 * instruction before surfacing the failure — cheaper than making the user read
 * an error and click again.
 */
export const JSON_ONLY_NUDGE =
  "\n\nIMPORTANT: Respond with ONLY the JSON object described above. " +
  "Your reply must start with '{' and contain no reasoning, explanation, or markdown.";

export function shouldRetryAsJson(err: unknown): boolean {
  const e = err as { nonJson?: boolean; spentThinking?: boolean } | null;
  return Boolean(e && (e.nonJson || e.spentThinking));
}

export async function withJsonRetry<T>(
  run: (nudge: string) => Promise<T>,
  notices: FallbackNotices = {},
): Promise<T> {
  try {
    return await run("");
  } catch (err) {
    if (!shouldRetryAsJson(err)) throw err;
    notices.onPhase?.("Model didn't return JSON — asking again");
    return run(JSON_ONLY_NUDGE);
  }
}
