/**
 * Transcript parsing — a near-verbatim port of recall/app.js lines 59–258.
 *
 * This decides what a "moment" is, and every downstream feature (search, the
 * bin, SRT export, TOP CLIPS scoring) is defined in terms of the segments it
 * produces. Changing a boundary here silently changes what the app finds, so
 * the structure, the constants and the ordering of the rules are kept as they
 * were rather than tidied. `tests/unit/recall-parse.test.ts` extracts the
 * original functions out of app.js and diffs them against this file.
 *
 * Three input formats are recognized:
 *   • SRT / WebVTT cue blocks (detected by the "-->" timing arrow)
 *   • TurboScribe inline "(0:00) text (0:04) text" web copy
 *   • the original line-per-moment paragraph format, including TurboScribe
 *     range headers
 */

import type { RecallSegment } from "../../data/schemas/recall";

/** Top Clips only scans moments of 4–40 words, so nothing longer may survive. */
export const SEG_MAX_WORDS = 40;
/** At a sentence end, flush only once the segment carries this much context. */
export const SEG_MIN_WORDS = 8;
/** A hard-cut sentence's short remainder glues backward instead of leading. */
export const TAIL_GLUE_MAX = 12;

/** "1:23" / "01:02:03" → whole seconds. */
export function toSec(t: string): number {
  const p = t.split(":").map(Number);
  if (p.length === 3) return p[0]! * 3600 + p[1]! * 60 + p[2]!;
  if (p.length === 2) return p[0]! * 60 + p[1]!;
  return p[0] || 0;
}

/** Any accepted timecode → the canonical "H:MM:SS" the UI renders. */
export function norm(t: string): string {
  const p = t.split(":").map((n) => n.replace(/\D/g, ""));
  if (p.length === 2) return "0:" + p[0]!.padStart(2, "0") + ":" + p[1]!.padStart(2, "0");
  return p.map((x, i) => (i === 0 ? x : x.padStart(2, "0"))).join(":");
}

// Two accepted line shapes:
//  • single timecode leading the moment:  [00:01:23] text  /  1:23 text
//  • a range header (TurboScribe style):   (0:04 - 0:23)  with the paragraph
//    on the following line(s); start time wins. Brackets or parens, en/em dash ok.
const RANGE_RE =
  /^[[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?\s*[\])]?\s*(.*)$/;
const STAMP_RE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.+)$/;

/** Drops bold markers and a leading "Speaker:" label. */
export function cleanLine(t: string): string {
  return String(t)
    .replace(/\*\*/g, "")
    .replace(/^\w+:\s*/, "")
    .trim();
}

export function wordCountOf(t: string): number {
  return (String(t).trim().match(/\S+/g) || []).length;
}

/**
 * Sentence tokenizer shared by splitLongSegments and mergeToSentences:
 * sentence + terminal punctuation + any closing quotes/brackets, or a
 * trailing unterminated run.
 */
export function sentenceChunks(text: string): string[] {
  return String(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [];
}

/**
 * Parse one transcript line into `out`, either starting a new moment or
 * appending a continuation to the moment above it.
 */
export function pushLine(out: RecallSegment[], ln: string): void {
  const mr = ln.match(RANGE_RE);
  if (mr) {
    out.push({ t: norm(mr[1]!), sec: toSec(mr[1]!), text: cleanLine(mr[2] || "") });
    return;
  }
  const m = ln.match(STAMP_RE);
  if (m) {
    out.push({ t: norm(m[1]!), sec: toSec(m[1]!), text: cleanLine(m[2]!) });
    return;
  }
  if (out.length) {
    const seg = out[out.length - 1]!;
    const add = cleanLine(ln);
    if (add) seg.text = seg.text ? seg.text + " " + add : add;
  }
}

/**
 * Split any >40-word moment into sentence-packed pieces that inherit its start
 * time, so a hook buried mid- or end-block still surfaces as its own clip.
 * Without this a fat paragraph block (a TurboScribe range, say) is skipped
 * whole by TOP CLIPS.
 */
export function splitLongSegments(segs: RecallSegment[]): RecallSegment[] {
  const out: RecallSegment[] = [];
  for (const s of segs) {
    if (wordCountOf(s.text) <= SEG_MAX_WORDS) {
      out.push(s);
      continue;
    }
    let sentences = sentenceChunks(s.text);
    if (!sentences.length) sentences = [s.text];
    let buf = "";
    let bufw = 0;
    for (const raw of sentences) {
      const sent = raw.trim();
      if (!sent) continue;
      const sw = wordCountOf(sent);
      if (bufw && bufw + sw > SEG_MAX_WORDS) {
        out.push({ t: s.t, sec: s.sec, text: buf });
        buf = "";
        bufw = 0;
      }
      buf = buf ? buf + " " + sent : sent;
      bufw += sw;
      if (bufw >= SEG_MAX_WORDS) {
        out.push({ t: s.t, sec: s.sec, text: buf });
        buf = "";
        bufw = 0;
      }
    }
    if (buf) out.push({ t: s.t, sec: s.sec, text: buf });
  }
  return out;
}

export function stripNoise(raw: string): string {
  return String(raw).replace(/\(Transcribed by TurboScribe[^)]*\)/gi, "");
}

/** "(0:00)" immediately followed by text. */
const INLINE_STAMP_RE = /\(\d{1,2}:\d{2}(?::\d{2})?\)\s*(?=\S)/g;

export type TranscriptFormat = "srt" | "inline" | "legacy";

/**
 * TurboScribe (and most tools) can export richer timing than the paragraph
 * format: SRT/VTT cues (~2s each, but text fragmented mid-sentence) and an
 * inline web-copy format (~4s, sentences intact). Anything else falls through
 * to the original line-by-line engine.
 */
export function detectFormat(raw: string): TranscriptFormat {
  if (raw.indexOf("-->") !== -1) return "srt";
  const m = raw.match(INLINE_STAMP_RE);
  if (m && m.length >= 3) return "inline";
  return "legacy";
}

/**
 * Merge ordered fragments into sentence-aligned segments of
 * ~SEG_MIN_WORDS..SEG_MAX_WORDS words, each anchored to the cue where its
 * first sentence STARTED.
 *
 * Invariant: a segment never begins mid-sentence. TurboScribe cues constantly
 * open with the tail of the previous sentence ("enslaves. This crap happens…")
 * — that tail must attach backward, never lead a segment. Only exception: a
 * single sentence longer than SEG_MAX_WORDS (or a punctuation-free stream) is
 * hard-cut.
 */
export function mergeToSentences(frags: RecallSegment[]): RecallSegment[] {
  const out: RecallSegment[] = [];
  // completed sentences
  let seg = "";
  let segw = 0;
  let segSec = 0;
  let segT = "";
  // sentence in progress
  let part = "";
  let partw = 0;
  let partSec = 0;
  let partT = "";
  // last emit was a hard mid-sentence cut
  let brokenTail = false;

  const emit = (text: string, sec: number, t: string): void => {
    const txt = cleanLine(text);
    if (txt) out.push({ t, sec, text: txt });
  };
  const flushSeg = (): void => {
    if (seg) {
      emit(seg, segSec, segT);
      seg = "";
      segw = 0;
    }
  };

  for (const frag of frags) {
    const raw = String(frag.text || "").trim();
    if (!raw) continue;
    for (const chunk of sentenceChunks(raw)) {
      const ch = chunk.trim();
      if (!ch) continue;
      if (!part) {
        partSec = frag.sec;
        partT = frag.t;
      }
      part = part ? part + " " + ch : ch;
      partw += wordCountOf(ch);

      if (/[.!?]["')\]]*$/.test(ch)) {
        // sentence complete
        if (brokenTail) {
          brokenTail = false;
          if (partw <= TAIL_GLUE_MAX && out.length) {
            // orphan tail of a hard-cut sentence — belongs to the previous
            // segment, must never lead a new one
            const glued = cleanLine(part);
            if (glued) out[out.length - 1]!.text += " " + glued;
            part = "";
            partw = 0;
            continue;
          }
        } else if (!seg && part === ch && partw <= 2 && /^[a-z]/.test(ch) && out.length) {
          // Mangled-cue orphan: real transcripts contain lone 1-2 word
          // lowercase tails in their OWN cue ("relaxing.", "atility." — even
          // mid-word splits) right after a completed sentence. Nothing is in
          // the buffer to complete, but it must still never lead a segment —
          // attach it backward.
          const stray = cleanLine(part);
          if (stray) out[out.length - 1]!.text += " " + stray;
          part = "";
          partw = 0;
          continue;
        }
        if (segw && segw + partw > SEG_MAX_WORDS) flushSeg();
        if (!seg) {
          segSec = partSec;
          segT = partT;
        }
        seg = seg ? seg + " " + part : part;
        segw += partw;
        part = "";
        partw = 0;
        if (segw >= SEG_MIN_WORDS) flushSeg();
      } else if (segw + partw >= SEG_MAX_WORDS) {
        if (segw) {
          // emit completed sentences; partial carries on
          flushSeg();
        } else {
          // one sentence busts the cap — hard cut
          emit(part, partSec, partT);
          part = "";
          partw = 0;
          brokenTail = true;
        }
      }
    }
  }

  // stream end: remaining text goes out; a short broken tail still glues back
  if (part) {
    if (brokenTail && partw <= TAIL_GLUE_MAX && out.length && !seg) {
      const tail = cleanLine(part);
      if (tail) out[out.length - 1]!.text += " " + tail;
    } else {
      if (!seg) {
        segSec = partSec;
        segT = partT;
      }
      seg = seg ? seg + " " + part : part;
    }
  }
  flushSeg();
  return out;
}

/** SRT / WebVTT cue blocks → fragments → sentence-merge → long-split. */
export function parseSRT(raw: string): RecallSegment[] {
  const text = stripNoise(raw).replace(/^﻿/, "").replace(/\r/g, "");
  const blocks = text.split(/\n\s*\n/);
  const frags: RecallSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    let start: string | null = null;
    let textLines: string[] = [];
    for (const rawLine of lines) {
      const ln = rawLine.trim();
      if (!ln) continue;
      if (/^WEBVTT/i.test(ln) || /^NOTE\b/i.test(ln)) {
        start = null;
        textLines = [];
        break;
      }
      if (start === null && ln.indexOf("-->") !== -1) {
        const mm = ln.match(/(\d{1,2}:\d{2}(?::\d{2})?)[.,]?\d*\s*-->/);
        if (mm) {
          start = mm[1]!;
          continue;
        }
      }
      // cue sequence number
      if (start === null && /^\d+$/.test(ln)) continue;
      if (start !== null) textLines.push(ln);
    }
    if (start !== null && textLines.length) {
      const t = textLines.join(" ").replace(/<[^>]+>/g, "").trim();
      if (t) frags.push({ sec: toSec(start), t: norm(start), text: t });
    }
  }
  return splitLongSegments(mergeToSentences(frags));
}

/** TurboScribe inline "(0:00) text (0:04) text" → fragments → sentence-merge. */
export function parseInline(raw: string): RecallSegment[] {
  const text = stripNoise(raw).replace(/\s+/g, " ");
  const frags: RecallSegment[] = [];
  const re = /\((\d{1,2}:\d{2}(?::\d{2})?)\)/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  let lastIdx = 0;
  while ((m = re.exec(text))) {
    if (last !== null) {
      const chunk = text.slice(lastIdx, m.index).trim();
      if (chunk) frags.push({ sec: toSec(last), t: norm(last), text: chunk });
    }
    last = m[1]!;
    lastIdx = re.lastIndex;
  }
  if (last !== null) {
    const tail = text.slice(lastIdx).trim();
    if (tail) frags.push({ sec: toSec(last), t: norm(last), text: tail });
  }
  return splitLongSegments(mergeToSentences(frags));
}

/** The entry point: detect the format, route, and normalize segment length. */
export function parse(raw: string): RecallSegment[] {
  const fmt = detectFormat(raw);
  if (fmt === "srt") return parseSRT(raw);
  if (fmt === "inline") return parseInline(raw);
  const out: RecallSegment[] = [];
  for (const rawLine of stripNoise(raw).split("\n")) {
    const ln = rawLine.trim();
    if (!ln) continue;
    pushLine(out, ln);
  }
  return splitLongSegments(out);
}

/** Legacy id minting — kept so ids look the same across apps. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}
