/**
 * Gemini provider — ported from blast/llm.js lines 118-305.
 *
 * Gemini handles large media (resumable Files API, up to 2GB) and native
 * video/audio understanding. Text ops work on either provider; media beyond a
 * small inlined file needs Gemini, and video is Gemini-only.
 */

import {
  GEN_TIMEOUT_MS,
  POLL_TIMEOUT_MS,
  UPLOAD_START_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  fetchBodyWithTimeout,
  fetchWithRetry,
  parseJsonBody,
  sleep,
  type RetryReporter,
} from "./timeouts";

/**
 * Rolling alias — always points at the current Flash model. A pinned version
 * being retired (gemini-2.0-flash, then gemini-2.5-flash, both 404'd with "no
 * longer available to new users") has broken this app twice. Do not pin.
 */
export const GEMINI_TEXT_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
export const GEMINI_FILES_UPLOAD =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";
export const GEMINI_FILES_BASE = "https://generativelanguage.googleapis.com/v1beta/files";

export const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;
export const GEMINI_MAX_BYTES = 2 * 1024 * 1024 * 1024;

const FILE_ACTIVE_DEADLINE_MS = 120_000;
const FILE_POLL_INTERVAL_MS = 2000;

/** Let the UI paint between long phases. */
function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function guessMime(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mpeg: "audio/mpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

interface GeminiFile {
  name: string;
  uri?: string;
  state?: string;
}

/** Resumable upload, for files over GEMINI_INLINE_MAX_BYTES. */
export async function uploadToGeminiFilesAPI(
  file: File,
  mime: string,
  apiKey: string,
  onRetry?: RetryReporter | null,
): Promise<GeminiFile> {
  const startOut = await fetchWithRetry(
    () =>
      fetchBodyWithTimeout(
        `${GEMINI_FILES_UPLOAD}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(file.size),
            "X-Goog-Upload-Header-Content-Type": mime,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ file: { display_name: file.name } }),
        },
        UPLOAD_START_TIMEOUT_MS,
        "Upload",
      ),
    onRetry,
  );

  const startRes = startOut.res;
  if (!startRes.ok) {
    if (startRes.status === 401 || startRes.status === 403) {
      throw new Error("Gemini API key rejected — open Settings");
    }
    if (startRes.status === 429) throw new Error("Rate limited — try again in a minute");
    if (startRes.status === 413) throw new Error("File too large for Gemini");
    throw new Error(`Upload start failed (HTTP ${startRes.status})`);
  }

  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("No upload URL returned by Gemini");

  const uploadOut = await fetchBodyWithTimeout(
    uploadUrl,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
        "Content-Length": String(file.size),
      },
      body: file,
    },
    UPLOAD_TIMEOUT_MS,
    "Upload",
  );
  if (!uploadOut.res.ok) throw new Error(`File upload failed (HTTP ${uploadOut.res.status})`);

  const data = parseJsonBody<{ file?: GeminiFile } & GeminiFile>(uploadOut.bodyText);
  if (!data) throw new Error("Gemini returned an unreadable upload response");
  return data.file ?? data;
}

/**
 * The Files API returns a resource name that already looks like "files/abc-123",
 * and the REST path for files.get / files.delete is /v1beta/{name}. Appending
 * that name to GEMINI_FILES_BASE (which already ends in "/files") and
 * percent-encoding its slash produced /v1beta/files/files%2Fabc-123, which
 * Gemini rejects with HTTP 400 — the "File status check failed" bug that broke
 * every upload over 14MB.
 */
export function geminiFileResourceUrl(fileName: string, apiKey: string): string {
  const name = /^files\//.test(fileName) ? fileName : `files/${fileName}`;
  return `${GEMINI_FILES_BASE.replace(/files$/, "")}${name}?key=${encodeURIComponent(apiKey)}`;
}

export async function waitForGeminiFileActive(
  fileName: string,
  apiKey: string,
  now: () => number = Date.now,
): Promise<GeminiFile> {
  const deadline = now() + FILE_ACTIVE_DEADLINE_MS;
  const url = geminiFileResourceUrl(fileName, apiKey);
  while (now() < deadline) {
    const r = await fetchBodyWithTimeout(url, {}, POLL_TIMEOUT_MS, "File status check");
    if (!r.res.ok) throw new Error(`File status check failed (HTTP ${r.res.status})`);
    const f = parseJsonBody<GeminiFile>(r.bodyText) ?? ({} as GeminiFile);
    if (f.state === "ACTIVE") return f;
    if (f.state === "FAILED") throw new Error("Gemini could not process this file");
    await sleep(FILE_POLL_INTERVAL_MS);
  }
  throw new Error("File processing timed out (2 min)");
}

/** Best-effort cleanup — uploaded files auto-expire after 48h anyway. */
export async function deleteGeminiFile(fileName: string, apiKey: string): Promise<void> {
  try {
    await fetchBodyWithTimeout(
      geminiFileResourceUrl(fileName, apiKey),
      { method: "DELETE" },
      POLL_TIMEOUT_MS,
      "Cleanup",
    );
  } catch {
    /* silent — the file expires on its own */
  }
}

interface GeminiCandidate {
  finishReason?: string;
  content?: { parts?: { text?: string }[] };
}

export function extractGeminiText(
  res: Response,
  bodyText: string,
  partialOnTruncate?: boolean,
): string {
  if (!res.ok) {
    const body = bodyText || "";
    if (res.status === 400) throw new Error("Gemini rejected the request — check key + file type");
    if (res.status === 401 || res.status === 403) {
      throw new Error("Gemini API key rejected — open Settings");
    }
    if (res.status === 413 || /too large/i.test(body)) throw new Error("File too large for Gemini");
    if (res.status === 429) throw new Error("Rate limited — try again in a minute");
    if (res.status === 503 || res.status === 500) {
      throw new Error(
        "Gemini is overloaded right now (still busy after a few retries) — " +
          "try again in a moment, or switch to OpenRouter in Settings.",
      );
    }
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 150)}`);
  }

  const json = parseJsonBody<{ candidates?: GeminiCandidate[] }>(bodyText);
  const candidate = json?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");

  // With partialOnTruncate the caller salvages the complete items out of the
  // cut-off text rather than losing an otherwise good response.
  if (candidate?.finishReason === "MAX_TOKENS" && !partialOnTruncate) {
    throw new Error("Response hit the token limit and was truncated. Try shorter input.");
  }
  return text;
}

export interface GeminiOptions {
  prompt: string;
  temperature?: number;
  /** Thinking is off by default (fast); callers opt in per operation. */
  thinking?: boolean;
  thinkingBudget?: number;
  jsonMode?: boolean;
  maxTokens?: number;
  partialOnTruncate?: boolean;
  onPhase?: (phase: string) => void;
  file?: File;
  mediaKind?: "video" | "audio";
}

interface GenerationConfig {
  temperature: number;
  thinkingConfig?: { thinkingBudget: number };
  responseMimeType?: string;
  maxOutputTokens?: number;
}

function generationConfigFor(opts: GeminiOptions, defaultTemp: number): GenerationConfig {
  const cfg: GenerationConfig = { temperature: opts.temperature ?? defaultTemp };
  if (typeof opts.thinkingBudget === "number") {
    cfg.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
  } else if (!opts.thinking) {
    cfg.thinkingConfig = { thinkingBudget: 0 };
  }
  if (opts.jsonMode) cfg.responseMimeType = "application/json";
  if (opts.maxTokens) cfg.maxOutputTokens = opts.maxTokens;
  return cfg;
}

function postGemini(
  apiKey: string,
  body: unknown,
  onRetry?: RetryReporter | null,
): Promise<{ res: Response; bodyText: string }> {
  return fetchWithRetry(
    () =>
      fetchBodyWithTimeout(
        `${GEMINI_TEXT_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        GEN_TIMEOUT_MS,
        "AI request",
      ),
    onRetry,
  );
}

export async function geminiGenerateText(
  apiKey: string,
  opts: GeminiOptions,
  onRetry?: RetryReporter | null,
): Promise<string> {
  const out = await postGemini(
    apiKey,
    {
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: generationConfigFor(opts, 0.4),
    },
    onRetry,
  );
  return extractGeminiText(out.res, out.bodyText, opts.partialOnTruncate);
}

export async function geminiGenerateFromMedia(
  apiKey: string,
  opts: GeminiOptions & { file: File },
  onRetry?: RetryReporter | null,
): Promise<string> {
  const file = opts.file;
  const onPhase = opts.onPhase ?? (() => {});
  const mime = file.type || guessMime(file.name);
  const useFilesAPI = file.size > GEMINI_INLINE_MAX_BYTES;

  let mediaPart: unknown;
  let uploadedFileName: string | null = null;

  if (useFilesAPI) {
    onPhase("Uploading to Gemini");
    await yieldToUi();
    const uploaded = await uploadToGeminiFilesAPI(file, mime, apiKey, onRetry);
    uploadedFileName = uploaded.name;
    if (!uploaded.uri) throw new Error("File upload didn't return a URI");
    onPhase("Processing");
    await yieldToUi();
    await waitForGeminiFileActive(uploadedFileName, apiKey);
    mediaPart = { file_data: { file_uri: uploaded.uri, mime_type: mime } };
  } else {
    onPhase("Reading");
    await yieldToUi();
    const b64 = await fileToBase64(file);
    onPhase("Uploading to Gemini");
    await yieldToUi();
    mediaPart = { inline_data: { mime_type: mime, data: b64 } };
  }

  onPhase("Analyzing");
  await yieldToUi();
  try {
    const out = await postGemini(
      apiKey,
      {
        contents: [{ parts: [{ text: opts.prompt }, mediaPart] }],
        generationConfig: generationConfigFor(opts, 0.1),
      },
      onRetry,
    );
    return extractGeminiText(out.res, out.bodyText, opts.partialOnTruncate);
  } finally {
    if (uploadedFileName) await deleteGeminiFile(uploadedFileName, apiKey);
  }
}
