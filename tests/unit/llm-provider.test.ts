import { describe, it, expect, vi } from "vitest";
import {
  isProviderFailure,
  withGeminiFallback,
  withJsonRetry,
  shouldRetryAsJson,
  providerSupportsVideo,
  generateFromMedia,
  JSON_ONLY_NUDGE,
  type ProviderConfig,
} from "../../src/services/llm/provider";
import {
  geminiFileResourceUrl,
  guessMime,
  extractGeminiText,
} from "../../src/services/llm/gemini";

const OR: ProviderConfig = {
  provider: "openrouter",
  openrouterKey: "or-key",
  openrouterModel: "some/model",
  geminiKey: "gem-key",
};

describe("Gemini file resource URLs", () => {
  it("does not double-prefix an already-qualified name", () => {
    // The bug: appending "files/abc" to a base already ending in "/files" and
    // percent-encoding the slash produced /v1beta/files/files%2Fabc, which
    // Gemini rejects with 400 — breaking every upload over 14MB.
    const url = geminiFileResourceUrl("files/abc-123", "k");
    expect(url).toContain("/v1beta/files/abc-123");
    expect(url).not.toContain("files%2F");
    expect(url).not.toContain("files/files");
  });

  it("qualifies a bare name", () => {
    expect(geminiFileResourceUrl("abc-123", "k")).toContain("/v1beta/files/abc-123");
  });

  it("percent-encodes the key rather than the path", () => {
    expect(geminiFileResourceUrl("files/a", "k/with+chars")).toContain("key=k%2Fwith%2Bchars");
  });
});

describe("mime guessing", () => {
  it("maps the media types the apps actually accept", () => {
    expect(guessMime("clip.mp4")).toBe("video/mp4");
    expect(guessMime("voice.m4a")).toBe("audio/mp4");
    expect(guessMime("take.MOV")).toBe("video/quicktime");
    expect(guessMime("mystery.xyz")).toBe("application/octet-stream");
    expect(guessMime("noext")).toBe("application/octet-stream");
  });
});

describe("Gemini response handling", () => {
  const ok = { ok: true, status: 200 } as Response;

  it("returns the text of the first candidate", () => {
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello" }] } }] });
    expect(extractGeminiText(ok, body)).toBe("hello");
  });

  it("surfaces a truncated response unless the caller opts to salvage it", () => {
    const body = JSON.stringify({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial" }] } }],
    });
    expect(() => extractGeminiText(ok, body)).toThrow(/token limit/i);
    expect(extractGeminiText(ok, body, true)).toBe("partial");
  });

  it("maps overload to advice about switching provider", () => {
    const res = { ok: false, status: 503 } as Response;
    expect(() => extractGeminiText(res, "")).toThrow(/overloaded/i);
  });

  it("maps a rejected key to Settings", () => {
    expect(() => extractGeminiText({ ok: false, status: 403 } as Response, "")).toThrow(
      /key rejected/i,
    );
  });
});

describe("provider capability", () => {
  it("allows video only on Gemini", () => {
    expect(providerSupportsVideo({ provider: "gemini" })).toBe(true);
    expect(providerSupportsVideo(OR)).toBe(false);
  });

  it("refuses video on OpenRouter with actionable wording", async () => {
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await expect(
      generateFromMedia(OR, { prompt: "p", file, mediaKind: "video" }),
    ).rejects.toThrow(/needs Gemini/i);
  });
});

describe("cross-provider fallback", () => {
  it("treats transport and burned-budget failures as worth retrying elsewhere", () => {
    expect(isProviderFailure(new Error("AI request timed out after 180s"))).toBe(true);
    expect(isProviderFailure(new Error("Rate limited — try again in a minute"))).toBe(true);
    expect(isProviderFailure(new Error("Gemini is overloaded right now"))).toBe(true);
    expect(isProviderFailure(Object.assign(new Error("x"), { spentThinking: true }))).toBe(true);
    expect(isProviderFailure(new Error("This model is no longer available on OpenRouter"))).toBe(true);
  });

  it("does NOT retry a rejected key or a bad request", () => {
    // These fail identically on the other provider, so a second call just
    // spends the user's quota to show the same error.
    expect(isProviderFailure(new Error("OpenRouter API key rejected — open Settings"))).toBe(false);
    expect(isProviderFailure(new Error("Gemini rejected the request — check key + file type"))).toBe(false);
    expect(isProviderFailure(null)).toBe(false);
  });

  it("falls back to Gemini and tells the user which key answered", async () => {
    const onFellBack = vi.fn();
    const run = vi
      .fn<(c: ProviderConfig) => Promise<string>>()
      .mockRejectedValueOnce(new Error("AI request timed out after 180s"))
      .mockResolvedValueOnce("from gemini");

    const out = await withGeminiFallback(OR, run, { onFellBack });

    expect(out).toBe("from gemini");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]?.provider).toBe("gemini");
    // Silent substitution would be a lie about provenance.
    expect(onFellBack).toHaveBeenCalledWith(expect.stringMatching(/Gemini key/));
  });

  it("does not fall back without a Gemini key to fall back to", async () => {
    const run = vi.fn().mockRejectedValue(new Error("timed out after 180s"));
    await expect(
      withGeminiFallback({ ...OR, geminiKey: "" }, run),
    ).rejects.toThrow(/timed out/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when Gemini was already the provider", async () => {
    const run = vi.fn().mockRejectedValue(new Error("overloaded"));
    await expect(
      withGeminiFallback({ provider: "gemini", geminiKey: "g" }, run),
    ).rejects.toThrow(/overloaded/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("JSON nudge retry", () => {
  it("retries only for non-JSON or burned-budget failures", () => {
    expect(shouldRetryAsJson(Object.assign(new Error("x"), { nonJson: true }))).toBe(true);
    expect(shouldRetryAsJson(Object.assign(new Error("x"), { spentThinking: true }))).toBe(true);
    expect(shouldRetryAsJson(new Error("key rejected"))).toBe(false);
  });

  it("re-asks the same prompt with a blunt instruction", async () => {
    const run = vi
      .fn<(nudge: string) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("prose"), { nonJson: true }))
      .mockResolvedValueOnce("{}");

    expect(await withJsonRetry(run)).toBe("{}");
    expect(run.mock.calls[0]?.[0]).toBe("");
    expect(run.mock.calls[1]?.[0]).toBe(JSON_ONLY_NUDGE);
  });

  it("passes other failures straight through without a second call", async () => {
    const run = vi.fn().mockRejectedValue(new Error("key rejected"));
    await expect(withJsonRetry(run)).rejects.toThrow(/key rejected/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
