/**
 * Request deadlines and retry — ported from blast/llm.js lines 24-115.
 *
 * A hung request used to freeze the calling button forever: its catch and
 * finally never ran, so the UI had no way to recover. Aborting turns a hang
 * into an ordinary catchable Error.
 *
 * The deadline MUST span the body read, not just the headers. OpenRouter's
 * non-streaming endpoint answers with 200 headers almost immediately and then
 * holds the connection open for the whole generation, so a headers-only timeout
 * never fires — the await on res.json() just sits there, no error, no console
 * output, ticker climbing past 300s. Reading the body inside the same abort
 * window is what actually bounds the wait. This is why callers get `bodyText`
 * back and parse it themselves instead of awaiting res.json().
 */

export const GEN_TIMEOUT_MS = 180_000; // generateContent / chat POST (thinking has long tails)
export const UPLOAD_START_TIMEOUT_MS = 30_000; // Files API resumable "start"
export const UPLOAD_TIMEOUT_MS = 900_000; // the bytes — 2GB legitimately takes minutes
export const POLL_TIMEOUT_MS = 15_000; // each files.get poll

/**
 * Whole-operation ceiling across retries. Three attempts at GEN_TIMEOUT_MS plus
 * backoff could otherwise legally reach ~9 minutes before surfacing anything.
 */
export const OP_BUDGET_MS = 240_000;

export const MAX_ATTEMPTS = 3; // 1 original + 2 retries
export const RETRY_BACKOFF_MS = [4000, 12000]; // waits before attempts 2 and 3
export const RETRY_DELAY_CAP_MS = 20_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchBodyResult {
  res: Response;
  bodyText: string;
}

/**
 * Fetch and fully read the body under ONE deadline. Both the response and its
 * text come back so the caller never has to await a second, unbounded read.
 */
export async function fetchBodyWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
  what?: string,
): Promise<FetchBodyResult> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  const opts: RequestInit = { ...(init || {}) };
  if (ctrl) opts.signal = ctrl.signal;

  try {
    const res = await fetch(url, opts);
    const bodyText = await res.text(); // still inside the abort window
    return { res, bodyText };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `${what || "Request"} timed out after ${Math.round(ms / 1000)}s — ` +
          "check your connection, or pick a faster model in Settings",
      );
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseJsonBody<T = unknown>(bodyText: string): T | null {
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return null;
  }
}

/**
 * Transient conditions worth retrying: rate limits (429) and server overload
 * (500/503 — Gemini's "high demand" spikes), which usually clear in seconds.
 */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}

/** Honor Google's own RetryInfo delay when the error body carries one. */
export function parseRetryDelayMs(bodyText: string): number | null {
  try {
    const j = JSON.parse(bodyText) as {
      error?: { details?: { "@type"?: string; retryDelay?: string }[] };
    };
    for (const d of j?.error?.details ?? []) {
      if (d && /RetryInfo/.test(d["@type"] ?? "") && d.retryDelay) {
        const m = String(d.retryDelay).match(/([\d.]+)s/);
        if (m?.[1]) return Math.ceil(parseFloat(m[1]) * 1000);
      }
    }
  } catch {
    /* not a Google error body */
  }
  return null;
}

export type RetryReporter = (attempt: number, maxAttempts: number, waitMs: number) => void;

/**
 * Retry a request maker on retryable statuses, then hand back the final result
 * (ok or not) for the caller's own error handling. Stops once OP_BUDGET_MS
 * would be exceeded, so the worst case is a bounded wait rather than
 * attempts × timeout + backoff.
 */
export async function fetchWithRetry(
  makeRequest: () => Promise<FetchBodyResult>,
  onRetry?: RetryReporter | null,
  now: () => number = Date.now,
): Promise<FetchBodyResult> {
  const started = now();
  for (let attempt = 1; ; attempt++) {
    const out = await makeRequest();
    if (!isRetryable(out.res.status) || attempt >= MAX_ATTEMPTS) return out;

    const serverDelay = parseRetryDelayMs(out.bodyText);
    let wait = serverDelay ?? RETRY_BACKOFF_MS[attempt - 1] ?? 12000;
    wait = Math.min(wait, RETRY_DELAY_CAP_MS);

    // Out of budget — surface the error now rather than waiting again.
    if (now() - started + wait > OP_BUDGET_MS) return out;

    if (onRetry) {
      try {
        onRetry(attempt, MAX_ATTEMPTS, wait);
      } catch {
        /* reporting is best-effort */
      }
    }
    await sleep(wait);
  }
}
