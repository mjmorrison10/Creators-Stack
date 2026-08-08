import { describe, it, expect, beforeEach } from "vitest";
import {
  assertTranscribable,
  deriveTitle,
  fileExt,
  fileKind,
  fmtBytes,
  mediaKindOf,
  MAX_BYTES,
  TRANSCRIBE_PROMPT,
  UnsupportedFileError,
} from "../../src/domain/recall/transcribe";
import { hasProviderKey, providerLabel, resolveProviderConfig } from "../../src/services/llm/config";
import { KEYS } from "../../src/data/keys";

const f = (name: string, type = "") => ({ name, type });

describe("the file-kind gate", () => {
  it("recognizes media by MIME first", () => {
    expect(fileKind(f("whatever", "audio/mpeg"))).toBe("media");
    expect(fileKind(f("whatever", "video/mp4"))).toBe("media");
  });

  it("falls back to the extension when the MIME is missing", () => {
    // Browsers disagree about MIME for the same file, and drag-and-drop often
    // supplies nothing at all.
    for (const ext of ["mp3", "m4a", "wav", "ogg", "flac", "aac", "mp4", "mov", "webm", "mpeg"]) {
      expect(fileKind(f(`clip.${ext}`)), ext).toBe("media");
    }
    for (const ext of ["txt", "srt", "vtt", "md"]) {
      expect(fileKind(f(`notes.${ext}`)), ext).toBe("text");
    }
  });

  it("classifies anything else as other", () => {
    expect(fileKind(f("archive.zip"))).toBe("other");
    expect(fileKind(f("noextension"))).toBe("other");
  });

  it("never treats a text file as media", () => {
    // This is the whole reason the gate exists: a .txt sent to Gemini as fake
    // audio burned quota and died on MAX_TOKENS.
    for (const name of ["transcript.txt", "subs.srt", "subs.vtt", "notes.md"]) {
      expect(mediaKindOf(f(name)), name).toBeNull();
    }
    expect(mediaKindOf(f("transcript.txt", "text/plain"))).toBeNull();
  });

  it("refuses an unknown type rather than guessing audio", () => {
    expect(mediaKindOf(f("mystery.bin"))).toBeNull();
    expect(() => assertTranscribable(f("mystery.bin"))).toThrow(UnsupportedFileError);
    // The message has to name the alternative — pasting works fine for these.
    expect(() => assertTranscribable(f("subs.srt"))).toThrow(/paste it instead/i);
  });

  it("separates video from audio, since video is Gemini-only", () => {
    expect(mediaKindOf(f("clip.mp4"))).toBe("video");
    expect(mediaKindOf(f("clip.mov"))).toBe("video");
    expect(mediaKindOf(f("clip.webm"))).toBe("video");
    expect(mediaKindOf(f("clip.mp3"))).toBe("audio");
    // MIME wins over the extension when both are present and disagree.
    expect(mediaKindOf(f("clip.mp4", "audio/mpeg"))).toBe("audio");
  });

  it("treats an unrecognized media extension as audio, not video", () => {
    // Audio is the safe default *within* media: it works on both providers.
    expect(mediaKindOf(f("clip.flac"))).toBe("audio");
  });
});

describe("the transcription prompt", () => {
  it("demands the timestamp format the parser reads", () => {
    // The prompt and the parser are one contract: ask for a shape the parser
    // can't read and every transcription lands as one enormous moment.
    expect(TRANSCRIBE_PROMPT).toContain("[HH:MM:SS]");
    expect(TRANSCRIBE_PROMPT).toMatch(/Always include hours/);
    expect(TRANSCRIBE_PROMPT).toMatch(/VERBATIM/);
    expect(TRANSCRIBE_PROMPT).toMatch(/Do NOT include any preamble/);
  });
});

describe("presentation helpers", () => {
  it("formats sizes at each boundary", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fmtBytes(MAX_BYTES)).toBe("2048.0 MB");
  });

  it("derives a readable title from a filename", () => {
    expect(deriveTitle("my_podcast-ep41.mp3")).toBe("my podcast ep41");
    expect(deriveTitle("plain")).toBe("plain");
    expect(deriveTitle("")).toBe("");
  });

  it("extracts extensions case-insensitively", () => {
    expect(fileExt("CLIP.MP3")).toBe("mp3");
    expect(fileExt("a.b.c.WAV")).toBe("wav");
  });
});

describe("provider resolution", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to Gemini with nothing configured", () => {
    expect(resolveProviderConfig().provider).toBe("gemini");
    expect(hasProviderKey()).toBe(false);
  });

  it("honors an existing per-app choice from the legacy blobs", () => {
    localStorage.setItem(KEYS.recallSettings, JSON.stringify({ provider: "openrouter" }));
    localStorage.setItem(KEYS.stackSettings, JSON.stringify({ openrouterKey: "or-key" }));
    expect(resolveProviderConfig().provider).toBe("openrouter");
    expect(providerLabel()).toBe("OpenRouter");
  });

  it("falls back to whichever provider actually has a key", () => {
    // Someone who pasted an OpenRouter key and never touched a provider radio
    // should get a working app, not "No Gemini API key".
    localStorage.setItem(KEYS.stackSettings, JSON.stringify({ openrouterKey: "or-key" }));
    expect(resolveProviderConfig().provider).toBe("openrouter");

    localStorage.clear();
    localStorage.setItem(KEYS.recallSettings, JSON.stringify({ provider: "openrouter" }));
    localStorage.setItem(KEYS.stackSettings, JSON.stringify({ geminiKey: "g-key" }));
    expect(resolveProviderConfig().provider).toBe("gemini");
  });

  it("keeps the stored choice when both providers have keys", () => {
    localStorage.setItem(KEYS.hooklabSettings, JSON.stringify({ provider: "openrouter" }));
    localStorage.setItem(
      KEYS.stackSettings,
      JSON.stringify({ geminiKey: "g", openrouterKey: "o" }),
    );
    expect(resolveProviderConfig().provider).toBe("openrouter");
  });

  it("reads keys from the shared store, not a per-app blob", () => {
    localStorage.setItem(KEYS.stackSettings, JSON.stringify({ geminiKey: "shared-key" }));
    expect(resolveProviderConfig().geminiKey).toBe("shared-key");
    expect(hasProviderKey()).toBe(true);
  });
});
