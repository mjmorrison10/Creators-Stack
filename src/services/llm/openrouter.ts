/**
 * OpenRouter provider — ported from blast/llm.js lines 307-430.
 *
 * Text-only. The subtleties here were all paid for once already; the comments
 * explaining them are kept deliberately.
 */

import {
  GEN_TIMEOUT_MS,
  fetchBodyWithTimeout,
  fetchWithRetry,
  parseJsonBody,
  type FetchBodyResult,
  type RetryReporter,
} from "./timeouts";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_INLINE_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Reasoning-style models think before answering, and that thinking is billed
 * and capped as OUTPUT tokens. A caption-sized max_tokens cuts them off
 * mid-thought: the response is pure chain-of-thought prose and no JSON ever
 * arrives. Detect them by id so they get room and are asked to keep the
 * monologue to themselves.
 *
 * Router ids (openrouter/free, openrouter/auto) are included because they can
 * hand the request to a reasoning model, so they need the same headroom.
 */
export const OR_REASONING_RE =
  /opus|o1|o3(?!-mini)|deepseek-r1|\br1\b|qwq|qwen-?3|glm-4\.[5-9]|kimi|minimax|magistral|sonar-reasoning|grok-[3-9]|reason|think|openrouter\/(free|auto)/i;

/** Thinking easily costs more than the answer itself. */
export const REASONING_HEADROOM = 3;
const REASONING_MAX_TOKENS = 16000;

export function isReasoningModel(model: string | null | undefined): boolean {
  return OR_REASONING_RE.test(String(model ?? ""));
}

/**
 * Open reasoning models often leak their monologue into `content` as
 * <think>…</think> rather than the separate reasoning field. Strip it before
 * anything tries to parse the result.
 */
export function stripThinkTags(s: unknown): string {
  return String(s ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

export const SPENT_THINKING_MSG =
  "The model spent the whole response thinking and never wrote the answer — " +
  "pick a faster model in Settings (flash/mini/haiku), or just run it again.";

export interface OpenrouterOptions {
  jsonMode?: boolean;
  maxTokens?: number;
  /** false → ask for minimal effort. Reasoning is always excluded from output. */
  thinking?: boolean;
  temperature?: number;
  partialOnTruncate?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: unknown;
}

interface OpenrouterBody {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: { type: "json_object" };
  max_tokens?: number;
  reasoning?: { effort?: "minimal"; exclude: true };
}

/**
 * X-Title is a hardcoded ASCII string rather than document.title: HTTP header
 * values must be ISO-8859-1, and this app's title contains an em dash — using
 * it directly throws at fetch() time and breaks every OpenRouter call.
 */
export function openrouterHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": typeof location !== "undefined" ? location.origin : "",
    "X-Title": "THE STACK",
  };
}

export function openrouterBody(
  model: string,
  messages: ChatMessage[],
  opts: OpenrouterOptions,
  temperature?: number,
): OpenrouterBody {
  const body: OpenrouterBody = { model, messages, temperature };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  if (opts.maxTokens) {
    body.max_tokens = isReasoningModel(model)
      ? Math.min(REASONING_MAX_TOKENS, opts.maxTokens * REASONING_HEADROOM)
      : opts.maxTokens;
  }
  // exclude:true always — we want the answer, never the model's monologue.
  if (opts.jsonMode) {
    body.reasoning =
      opts.thinking === false ? { effort: "minimal", exclude: true } : { exclude: true };
  }
  return body;
}

/**
 * Some models mark reasoning mandatory, or don't accept the field at all, and
 * answer 400. Retry once without it rather than failing the run.
 */
export async function openrouterPost(
  apiKey: string,
  body: OpenrouterBody,
  what: string,
  onRetry?: RetryReporter | null,
): Promise<FetchBodyResult> {
  const post = (b: OpenrouterBody): Promise<FetchBodyResult> =>
    fetchBodyWithTimeout(
      OPENROUTER_ENDPOINT,
      { method: "POST", headers: openrouterHeaders(apiKey), body: JSON.stringify(b) },
      GEN_TIMEOUT_MS,
      what,
    );

  let out = await fetchWithRetry(() => post(body), onRetry);

  if (out.res.status === 400 && body.reasoning && /reasoning/i.test(out.bodyText || "")) {
    const { reasoning: _dropped, ...retry } = body;
    void _dropped;
    out = await fetchWithRetry(() => post(retry as OpenrouterBody), onRetry);
  }
  return out;
}

interface OrChoice {
  finish_reason?: string;
  message?: { content?: unknown; reasoning?: unknown; reasoning_details?: unknown[] };
}

export class SpentThinkingError extends Error {
  readonly spentThinking = true;
  constructor() {
    super(SPENT_THINKING_MSG);
    this.name = "SpentThinkingError";
  }
}

export function extractOpenrouterText(
  res: Response,
  bodyText: string,
  partialOnTruncate?: boolean,
): string {
  if (!res.ok) {
    const body = bodyText || "";
    if (res.status === 401) throw new Error("OpenRouter API key rejected — open Settings");
    if (res.status === 429) throw new Error("Rate limited — try again in a minute");
    if (res.status === 404 || /no endpoints found/i.test(body)) {
      throw new Error("This model is no longer available on OpenRouter — pick another in Settings.");
    }
    throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 150)}`);
  }

  const json = parseJsonBody<{ choices?: OrChoice[] }>(bodyText);
  const choice = json?.choices?.[0];
  const msg = choice?.message ?? {};
  const raw = msg.content;
  const truncated = choice?.finish_reason === "length";
  const reasoned = Boolean(msg.reasoning || (msg.reasoning_details?.length ?? 0));
  const text = stripThinkTags(raw);

  // A reasoning model that burned its whole budget thinking leaves either
  // nothing or pure monologue with no answer in it. Say exactly that, rather
  // than "empty response" or quoting its train of thought back at the user.
  const rawStr = String(raw ?? "");
  const openThink = /<think(?:ing)?>/i.test(rawStr) && !/<\/think(?:ing)?>/i.test(rawStr);

  if (!text) {
    if (reasoned || openThink || truncated) throw new SpentThinkingError();
    throw new Error("Empty response from OpenRouter");
  }
  // Non-empty but with no JSON in it, cut short or still mid-thought: this is
  // monologue that never reached an answer, not a merely truncated answer.
  // Without this the user gets "hit the token limit" and shortens their input,
  // which does not help — the fix is a different model.
  if (!text.includes("{") && (truncated || openThink)) throw new SpentThinkingError();

  if (truncated && !partialOnTruncate) {
    throw new Error("Response hit the token limit and was truncated. Try shorter input.");
  }
  return text;
}
