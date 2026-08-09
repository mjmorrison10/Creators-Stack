import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  arenaScore,
  groupModels,
  isFresh,
  isNonChat,
  mapModel,
  modelLabel,
  money,
  readModelCache,
  setRankingForTest,
  shortName,
  writeModelCache,
  ARENA_FALLBACK,
  type ModelRecord,
} from "../../src/services/models";
import { ytId, fetchYouTubeStats } from "../../src/services/youtube";
import { KEYS } from "../../src/data/keys";

beforeEach(() => {
  localStorage.clear();
  setRankingForTest(ARENA_FALLBACK);
});
afterEach(() => vi.restoreAllMocks());

function model(over: Partial<ModelRecord> = {}): ModelRecord {
  return {
    id: "vendor/model",
    name: "Model",
    inPerM: 1,
    outPerM: 2,
    free: false,
    media: false,
    textOut: true,
    score: 0,
    ...over,
  };
}

describe("model catalogue", () => {
  it("scores by the first matching pattern, most specific first", () => {
    // Ordering matters: "claude-opus-4.6" must not be caught by a looser
    // pattern that happens to appear earlier.
    expect(arenaScore("anthropic/claude-opus-4.6")).toBe(1504);
    expect(arenaScore("ANTHROPIC/CLAUDE-FABLE")).toBe(1509);
    expect(arenaScore("some/unknown-model")).toBe(0);
  });

  it("shortens vendor-prefixed names but leaves long prefixes alone", () => {
    expect(shortName("Anthropic: Claude Opus 4.8")).toBe("Claude Opus 4.8");
    expect(shortName("Mistral Small 3 (free)")).toBe("Mistral Small 3");
    // A colon far into the string is part of the name, not a vendor prefix.
    expect(shortName("A very long vendor name indeed: X")).toBe(
      "A very long vendor name indeed: X",
    );
  });

  it("maps raw API records, converting per-token pricing to per-million", () => {
    const m = mapModel({
      id: "v/m",
      name: "V: M",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "0.000001", completion: "0.000002" },
    });
    expect(m.inPerM).toBeCloseTo(1);
    expect(m.outPerM).toBeCloseTo(2);
    expect(m.free).toBe(false);
    expect(m.media).toBe(true);
    expect(m.textOut).toBe(true);
  });

  it("treats zero-priced models as free", () => {
    const m = mapModel({ id: "v/m", pricing: { prompt: "0", completion: "0" } });
    expect(m.free).toBe(true);
  });

  it("excludes image, audio and video generators from the chat picker", () => {
    for (const id of ["google/veo-3", "openai/dall-e-3", "x/whisper-1", "g/lyria-2", "o/sora"]) {
      expect(isNonChat(id), id).toBe(true);
    }
    expect(isNonChat("anthropic/claude-opus-4.6")).toBe(false);
  });

  it("never makes the free router look like the fast pick", () => {
    // It queues behind everyone else's free usage and regularly takes minutes.
    const label = modelLabel(model({ id: "openrouter/free", free: true, name: "Auto" }));
    expect(label).toMatch(/slow/i);
    expect(label).not.toContain("⚡");
  });

  it("formats prices with more precision for sub-cent rates", () => {
    expect(money(0)).toBe("$0");
    expect(money(0.05)).toBe("$0.050");
    expect(money(3.5)).toBe("$3.50");
  });

  it("groups ranked, then free, then the rest", () => {
    const models = [
      model({ id: "a/ranked", name: "Ranked", score: 1500 }),
      model({ id: "b/free", name: "Freebie", free: true, score: 0 }),
      model({ id: "c/other", name: "Other", score: 0 }),
      model({ id: "d/veo-image", name: "Image gen", score: 0 }),
    ];
    const groups = groupModels(models);
    expect(groups.map((g) => g.label)).toEqual([
      "Top ranked (arena.ai)",
      "Free models",
      "All other models",
    ]);
    // The non-chat model is filtered out of every group.
    expect(groups.flatMap((g) => g.models.map((m) => m.id))).not.toContain("d/veo-image");
  });

  it("surfaces a saved model that has vanished from the catalogue", () => {
    // Otherwise the picker silently drops the user's choice and looks like it
    // reset itself.
    const groups = groupModels([model({ id: "a/ranked", score: 1500 })], "retired/model");
    expect(groups[0]?.label).toBe("Current");
    expect(groups[0]?.models[0]?.id).toBe("retired/model");
  });

  it("does not duplicate a current model that is still listed", () => {
    const groups = groupModels([model({ id: "a/ranked", score: 1500 })], "a/ranked");
    expect(groups.some((g) => g.label === "Current")).toBe(false);
  });
});

describe("model cache", () => {
  it("round-trips through the legacy cache key", () => {
    writeModelCache([model()]);
    expect(localStorage.getItem(KEYS.stackModelsCache)).toContain("vendor/model");
    expect(readModelCache()?.models).toHaveLength(1);
  });

  it("treats an empty or corrupt cache as absent", () => {
    expect(readModelCache()).toBeNull();
    writeModelCache([]);
    expect(readModelCache()).toBeNull();
    localStorage.setItem(KEYS.stackModelsCache, "{oops");
    expect(readModelCache()).toBeNull();
  });

  it("expires after 24 hours, and rejects a future timestamp", () => {
    const at = new Date("2026-08-06T00:00:00Z");
    const cache = { at: at.toISOString(), models: [model()] };
    const hours = (n: number) => () => at.getTime() + n * 3600_000;

    expect(isFresh(cache, hours(23))).toBe(true);
    expect(isFresh(cache, hours(25))).toBe(false);
    // A clock that jumped backwards shouldn't make a cache look eternally fresh.
    expect(isFresh(cache, hours(-1))).toBe(false);
    expect(isFresh(null)).toBe(false);
  });
});

describe("YouTube", () => {
  it("extracts ids from every URL shape the apps produce", () => {
    expect(ytId("https://youtube.com/shorts/abc123XYZ")).toBe("abc123XYZ");
    expect(ytId("https://youtu.be/abc123XYZ")).toBe("abc123XYZ");
    expect(ytId("https://www.youtube.com/watch?v=abc123XYZ&t=3")).toBe("abc123XYZ");
    expect(ytId("https://youtube.com/live/abc123XYZ")).toBe("abc123XYZ");
    expect(ytId("https://example.com/nope")).toBeNull();
  });

  it("reads stats, keeping hidden counts null rather than zero", () => {
    // A creator can hide likes; "hidden" and "none" are different facts.
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [{ statistics: { viewCount: "1234" } }] }),
      } as unknown as Response),
    );
    return fetchYouTubeStats("id", "key").then((s) => {
      expect(s.views).toBe(1234);
      expect(s.likes).toBeNull();
      expect(s.comments).toBeNull();
    });
  });

  it("names the likely cause of a 403 instead of the status code", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: false, status: 403 } as unknown as Response),
    );
    await expect(fetchYouTubeStats("id", "key")).rejects.toThrow(/key rejected or quota/i);
  });

  it("distinguishes a missing video from an API failure", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      } as unknown as Response),
    );
    await expect(fetchYouTubeStats("id", "key")).rejects.toThrow(/private, deleted, or wrong link/i);
  });
});

describe("offline slot fill regressions", () => {
  it("copies $-sequences in the topic literally", async () => {
    // String replacements interpret $$, $& and $' — "earn $$$" came out mangled
    // and "$&" re-inserted the placeholder itself.
    const { offlineFill } = await import("../../src/domain/hooklab/offline");
    expect(offlineFill("Nobody talks about {topic}.", "earn $$$ in 30 days")).toBe(
      "Nobody talks about earn $$$ in 30 days.",
    );
    expect(offlineFill("Try {topic}.", "$& tricks")).toBe("Try $& tricks.");
  });

  it("fills the spoken slot from the topic, as the legacy chain did", async () => {
    const { offlineFill, TOPIC_SLOTS } = await import("../../src/domain/hooklab/offline");
    expect(TOPIC_SLOTS).toContain("spoken");
    expect(offlineFill('Say this out loud: "{spoken}"', "my hook")).toContain("my hook");
  });
});
