/**
 * Turning an uploaded media file into a transcript. Ported from recall/app.js.
 *
 * The file-kind gate is the load-bearing part. A `.txt` that reached the
 * transcribe call was once sent to Gemini as fake "audio", which burned quota
 * and died on MAX_TOKENS. The `accept` attribute is only a picker hint —
 * drag-and-drop bypasses it entirely and "All files" defeats it in the dialog —
 * so the check has to live here, at the one chokepoint both paths go through.
 */

export const TRANSCRIBE_PROMPT = [
  "Transcribe the following audio VERBATIM — no summarizing, no paraphrasing, no commentary.",
  "",
  "For every spoken line, output exactly one line in this format:",
  "  [HH:MM:SS]  text spoken at that timestamp",
  "",
  "Rules:",
  "- HH = hours, MM = minutes, SS = seconds. Always include hours, so [00:01:23], not [1:23].",
  "- One line per natural utterance — speaker change, sentence boundary, or short pause.",
  "- If multiple speakers are present, prefix each line with 'Speaker A:' or 'Speaker B:', or a name if a speaker introduces themselves.",
  "- Include filler words like 'um', 'uh', 'you know' — they're part of the verbatim transcript.",
  "- Do NOT include any preamble, summary, or commentary before the first timestamped line.",
  "- Do NOT include timestamps in any format other than [HH:MM:SS].",
  "- Output ONLY the timestamped transcript lines.",
].join("\n");

export const TRANSCRIBE_MAX_TOKENS = 16000;

/**
 * The picker's ceiling, which is Gemini's Files API cap — the largest either
 * provider could ever accept. OpenRouter's much smaller inline-only limit is
 * enforced in the provider and surfaces at transcribe time, not here, because
 * it depends on which provider is selected at that moment.
 */
export const MAX_BYTES = 2 * 1024 * 1024 * 1024;

const MEDIA_EXTS = new Set(["mp3", "m4a", "wav", "ogg", "flac", "aac", "mp4", "mov", "webm", "mpeg"]);
const TEXT_EXTS = new Set(["txt", "srt", "vtt", "md"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm"]);

export type FileKind = "media" | "text" | "other";
export type MediaKind = "audio" | "video";

export function fileExt(name: string): string {
  return (String(name || "").split(".").pop() || "").toLowerCase();
}

/** MIME first, extension as the fallback — browsers disagree on both. */
export function fileKind(file: { name: string; type?: string }): FileKind {
  const mime = file.type || "";
  if (mime.indexOf("audio/") === 0 || mime.indexOf("video/") === 0) return "media";
  if (mime.indexOf("text/") === 0) return "text";
  const ext = fileExt(file.name);
  if (MEDIA_EXTS.has(ext)) return "media";
  if (TEXT_EXTS.has(ext)) return "text";
  return "other";
}

/**
 * Which content part the provider should use, and whether OpenRouter is even
 * eligible (video is Gemini-only there).
 *
 * Returns null for anything that is not real media. Callers must not send those
 * to a provider: defaulting an unknown to "audio" is exactly how a text file
 * once reached Gemini.
 */
export function mediaKindOf(file: { name: string; type?: string }): MediaKind | null {
  if (fileKind(file) !== "media") return null;
  const mime = file.type || "";
  if (mime.indexOf("video/") === 0) return "video";
  if (mime.indexOf("audio/") === 0) return "audio";
  return VIDEO_EXTS.has(fileExt(file.name)) ? "video" : "audio";
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A source title derived from the filename, for the common case. */
export function deriveTitle(name: string): string {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

export class UnsupportedFileError extends Error {}

/**
 * Throws rather than guessing when the file isn't media. The message names the
 * alternative, because a user who dragged in a .srt has a perfectly good path
 * available — paste it — and should be told so instead of being sent to a
 * provider that will fail.
 */
export function assertTranscribable(file: { name: string; type?: string }): MediaKind {
  const kind = mediaKindOf(file);
  if (!kind) {
    throw new UnsupportedFileError(
      "That file type can't be transcribed — audio and video only. For a text transcript, paste it instead.",
    );
  }
  return kind;
}
