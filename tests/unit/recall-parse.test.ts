import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as port from "../../src/domain/recall/parse";
import type { RecallSegment } from "../../src/data/schemas/recall";

/** The still-deployed parser the port must match. */
const APP_JS = resolve(import.meta.dirname, "../../../recall/app.js");

/**
 * The parser lives inside recall/app.js's IIFE, so it can't be imported the way
 * patterns.js could. It is pure, though — no DOM, no storage — so the original
 * source is sliced out and evaluated here. That gives the same guarantee the
 * pattern bank got: the port is proven identical rather than reviewed by eye.
 *
 * Slicing by marker rather than line number, so an edit elsewhere in app.js
 * can't silently shift the window and leave the test comparing the port
 * against the wrong code.
 */
function loadLegacyParser(): {
  parse: (raw: string) => RecallSegment[];
  toSec: (t: string) => number;
  norm: (t: string) => string;
  detectFormat: (raw: string) => string;
  cleanLine: (t: string) => string;
  sentenceChunks: (t: string) => string[];
  wordCountOf: (t: string) => number;
  splitLongSegments: (s: RecallSegment[]) => RecallSegment[];
  mergeToSentences: (s: RecallSegment[]) => RecallSegment[];
} {
  const src = readFileSync(APP_JS, "utf8");
  const start = src.indexOf("function toSec(t)");
  const end = src.indexOf("function uid()");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("could not locate the parser block in recall/app.js");
  }
  const block = src.slice(start, end);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    `${block}
     return {parse, toSec, norm, detectFormat, cleanLine, sentenceChunks,
             wordCountOf, splitLongSegments, mergeToSentences};`,
  )() as ReturnType<typeof loadLegacyParser>;
}

const legacy = loadLegacyParser();

/** The two seed transcripts app.js ships, read from the same file. */
function seed(name: "SEED_APOGEE" | "SEED_SAMPLE"): string {
  const src = readFileSync(APP_JS, "utf8");
  const m = src.match(new RegExp(`${name}\\s*=\\s*\`([\\s\\S]*?)\``));
  if (!m) throw new Error(`could not find ${name}`);
  return m[1]!;
}

const SAMPLES: Record<string, string> = {
  "bracketed timecodes": seed("SEED_SAMPLE"),
  "the shipped interview transcript": seed("SEED_APOGEE"),

  "bare timecodes without brackets": [
    "1:23 The first moment lands here.",
    "12:04 And a second one after it.",
  ].join("\n"),

  "continuation lines folded into the moment above": [
    "[00:00:05] A sentence begins here",
    "and continues on the next line without its own stamp.",
    "[00:00:20] A new moment.",
  ].join("\n"),

  "a leading line with no timecode at all": [
    "This orphan text precedes any stamp and has nowhere to attach.",
    "[00:00:05] The first real moment.",
  ].join("\n"),

  "speaker labels and bold markers": [
    "[00:00:05] **Rome:** The label and the asterisks both come off.",
  ].join("\n"),

  "TurboScribe range headers": [
    "(0:04 - 0:23)",
    "A paragraph that follows its range header on the next line.",
    "(0:23 - 0:41) Another, this time inline with the header.",
  ].join("\n"),

  "range headers with an em dash and brackets": [
    "[1:00 — 1:30] Em dash inside brackets still parses.",
    "[1:30 – 2:00] And an en dash.",
  ].join("\n"),

  "the TurboScribe attribution line": [
    "(Transcribed by TurboScribe.ai. Go Unlimited to remove this message.)",
    "[00:00:05] The noise line is stripped before parsing.",
  ].join("\n"),

  "a moment far over the word cap": [
    "[00:00:05] " +
      "One sentence that is quite long indeed and carries on well past the point of comfort. " +
      "A second sentence follows it and is also long enough to matter here. " +
      "A third sentence arrives to push the whole block over forty words in total. " +
      "A fourth closes it out.",
  ].join("\n"),

  "a single unpunctuated run over the cap": [
    "[00:00:05] " + Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "),
  ].join("\n"),

  srt: [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "Discipline is just remembering",
    "",
    "2",
    "00:00:03,000 --> 00:00:05,500",
    "what you want. Confidence comes after",
    "",
    "3",
    "00:00:05,500 --> 00:00:08,000",
    "the work, never before it. Most men wait to feel ready.",
    "",
  ].join("\n"),

  "webvtt with a NOTE block and markup": [
    "WEBVTT",
    "",
    "NOTE this comment block is skipped entirely",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "<v Speaker>The markup is stripped</v> and the text survives.",
    "",
    "00:00:03.000 --> 00:00:06.000",
    "A second cue continues the thought here.",
    "",
  ].join("\n"),

  "srt whose cues split sentences mid-word": [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "The system enslaves. This crap happens every single day to good people.",
    "",
    "2",
    "00:00:03,000 --> 00:00:04,000",
    "relaxing.",
    "",
    "3",
    "00:00:04,000 --> 00:00:07,000",
    "And then the next real sentence begins properly right here.",
    "",
  ].join("\n"),

  // A sentence too long for one segment is hard-cut, and whatever finishes it
  // in the next cue is an orphan: short enough, it glues back onto the cut
  // piece rather than leading a segment of its own.
  "srt whose sentence is hard-cut with a short tail after it": [
    "1",
    "00:00:01,000 --> 00:00:06,000",
    Array.from({ length: 45 }, (_, i) => `word${i}`).join(" "),
    "",
    "2",
    "00:00:06,000 --> 00:00:08,000",
    "and that is why.",
    "",
    "3",
    "00:00:08,000 --> 00:00:11,000",
    "A clean sentence follows to close the transcript out.",
    "",
  ].join("\n"),

  // Same hard cut, but the remainder is too long to glue — it has to stand as
  // its own segment instead.
  "srt whose hard-cut tail is too long to glue back": [
    "1",
    "00:00:01,000 --> 00:00:06,000",
    Array.from({ length: 45 }, (_, i) => `word${i}`).join(" "),
    "",
    "2",
    "00:00:06,000 --> 00:00:10,000",
    "and that is precisely why the whole argument falls apart the moment anyone checks it.",
    "",
  ].join("\n"),

  "srt with a byte-order mark and CRLF": "\ufeff1\r\n00:00:01,000 --> 00:00:03,000\r\nCRLF and a BOM both survive parsing.\r\n\r\n",

  inline: [
    "(0:00) Discipline is just remembering what you want.",
    "(0:04) Confidence comes after the work, never before it.",
    "(0:09) Most men wait to feel ready. You will never feel ready.",
    "(0:15) You move first, and the confidence follows.",
  ].join(" "),

  "inline with only two stamps falls through to legacy": [
    "(0:00) Only two stamps here.",
    "(0:04) So this is not detected as inline.",
  ].join(" "),

  "empty input": "",
  "whitespace only": "   \n\n  \n",
};

describe("transcript parsing parity with the original app.js", () => {
  for (const [name, raw] of Object.entries(SAMPLES)) {
    it(`parses ${name} identically`, () => {
      expect(port.parse(raw)).toEqual(legacy.parse(raw));
    });
  }

  it("routes every sample to the same format", () => {
    for (const [name, raw] of Object.entries(SAMPLES)) {
      expect(port.detectFormat(raw), name).toBe(legacy.detectFormat(raw));
    }
  });
});

describe("timecode handling parity", () => {
  const STAMPS = ["0:05", "1:23", "12:04", "00:00:05", "01:02:03", "1:2:3", "99:59:59", "7"];

  it("converts to seconds identically", () => {
    for (const s of STAMPS) expect(port.toSec(s), s).toBe(legacy.toSec(s));
  });

  it("normalizes to the display form identically", () => {
    for (const s of STAMPS) expect(port.norm(s), s).toBe(legacy.norm(s));
  });
});

describe("text helper parity", () => {
  const LINES = [
    "**Rome:** bold and a speaker label",
    "no label here",
    "Speaker: plain label",
    "   padded   ",
    "",
    "http://example.com/a — a colon that is not a label",
  ];

  it("cleans lines identically", () => {
    for (const l of LINES) expect(port.cleanLine(l), l).toBe(legacy.cleanLine(l));
  });

  it("tokenizes sentences identically", () => {
    const TEXTS = [
      "One. Two! Three? Four",
      'He said "stop." Then left.',
      "no terminal punctuation at all",
      "Ellipsis... then more.",
      "",
    ];
    for (const t of TEXTS) expect(port.sentenceChunks(t), t).toEqual(legacy.sentenceChunks(t));
  });

  it("counts words identically", () => {
    for (const l of LINES) expect(port.wordCountOf(l), l).toBe(legacy.wordCountOf(l));
  });
});

describe("segment invariants the rest of the app depends on", () => {
  const all = Object.values(SAMPLES).flatMap((raw) => port.parse(raw));

  it("only exceeds the scan cap on a single unbroken sentence", () => {
    // TOP CLIPS skips anything over the cap, so an over-long segment is
    // invisible rather than merely untidy. The splitters pack whole sentences
    // and never cut inside one, so the only way to land over the cap is a
    // single sentence that is itself too long — which is exactly what a
    // punctuation-free stretch of speech-to-text looks like.
    for (const s of all) {
      if (port.wordCountOf(s.text) <= port.SEG_MAX_WORDS) continue;
      expect(port.sentenceChunks(s.text).length, s.text).toBe(1);
    }
  });

  it("leaves a long punctuation-free run whole, where TOP CLIPS cannot see it", () => {
    // Documented rather than fixed: changing it would re-cut every existing
    // user's library and move clip boundaries under them. Worth knowing about
    // when the scan comes back empty on a transcript with no punctuation.
    const segs = port.parse(SAMPLES["a single unpunctuated run over the cap"]!);
    expect(segs).toHaveLength(1);
    expect(port.wordCountOf(segs[0]!.text)).toBeGreaterThan(port.SEG_MAX_WORDS);
  });

  it("never emits an empty segment", () => {
    for (const s of all) expect(s.text.trim()).not.toBe("");
  });

  it("gives every segment a normalized timecode matching its seconds", () => {
    for (const s of all) {
      expect(s.t, s.text).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
      expect(port.toSec(s.t)).toBe(s.sec);
    }
  });

  it("keeps segments in non-decreasing time order", () => {
    for (const raw of Object.values(SAMPLES)) {
      const segs = port.parse(raw);
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i]!.sec).toBeGreaterThanOrEqual(segs[i - 1]!.sec);
      }
    }
  });

  it("never starts a merged segment with a lowercase sentence fragment", () => {
    // The whole point of mergeToSentences: a cue that opens with the tail of
    // the previous sentence must glue backward, not lead a new clip.
    const segs = port.parse(SAMPLES["srt whose cues split sentences mid-word"]!);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.some((s) => /^relaxing\./.test(s.text))).toBe(false);
    expect(segs.map((s) => s.text).join(" ")).toContain("relaxing.");
  });
});
