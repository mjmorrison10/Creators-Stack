import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  fetchBodyWithTimeout,
  fetchWithRetry,
  isRetryable,
  parseRetryDelayMs,
} from "../../src/services/llm/timeouts";
import {
  isReasoningModel,
  stripThinkTags,
  openrouterBody,
  openrouterHeaders,
  extractOpenrouterText,
  SpentThinkingError,
} from "../../src/services/llm/openrouter";
import {
  readSharedKeys,
  writeSharedKeys,
  clearSharedKey,
  resolveKeys,
} from "../../src/data/stackdata/shared";
import { KEYS } from "../../src/data/keys";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("request deadlines", () => {
  it("aborts a hung BODY read, not just the headers", async () => {
    // The bug this exists to prevent: OpenRouter returns 200 headers instantly
    // then holds the connection for the whole generation. A headers-only
    // timeout never fires — the await on the body just sits there forever.
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return Promise.resolve({
        ok: true,
        status: 200,
        // Body never resolves on its own; only the abort signal ends it.
        text: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      } as unknown as Response);
    });

    await expect(
      fetchBodyWithTimeout("https://example.test", {}, 50, "Generation"),
    ).rejects.toThrow(/Generation timed out after 0s|timed out/);
  });

  it("returns the response and its fully-read body together", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"a":1}') } as unknown as Response),
    );
    const out = await fetchBodyWithTimeout("https://example.test", {}, 1000);
    expect(out.res.status).toBe(200);
    expect(out.bodyText).toBe('{"a":1}');
  });

  it("treats rate limits and overload as retryable, client errors as fatal", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(200)).toBe(false);
  });

  it("honors Google's own RetryInfo delay", () => {
    const body = JSON.stringify({
      error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7.5s" }] },
    });
    expect(parseRetryDelayMs(body)).toBe(7500);
    expect(parseRetryDelayMs("not json")).toBeNull();
    expect(parseRetryDelayMs("{}")).toBeNull();
  });

  it("retries a 429 then returns the successful result", async () => {
    let calls = 0;
    // A server-supplied RetryInfo of 0s both exercises the honor-the-server
    // path and keeps the suite from actually sleeping the 4s default backoff.
    const retryInfo = JSON.stringify({
      error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0s" }] },
    });
    const make = () => {
      calls++;
      const status = calls === 1 ? 429 : 200;
      return Promise.resolve({
        res: { status, ok: status === 200 } as Response,
        bodyText: status === 429 ? retryInfo : "{}",
      });
    };
    const out = await fetchWithRetry(make);
    expect(calls).toBe(2);
    expect(out.res.status).toBe(200);
  });

  it("stops retrying rather than blowing the whole-operation budget", async () => {
    let calls = 0;
    const make = () => {
      calls++;
      return Promise.resolve({ res: { status: 429, ok: false } as Response, bodyText: "{}" });
    };
    // Clock jumps past OP_BUDGET_MS immediately, so the wait is unaffordable.
    let t = 0;
    const out = await fetchWithRetry(make, null, () => (t += 500_000));
    expect(calls).toBe(1); // gave up instead of sleeping
    expect(out.res.status).toBe(429);
  });
});

describe("OpenRouter reasoning handling", () => {
  it("recognizes reasoning models, including the routers", () => {
    // Routers can hand off to a reasoning model, so they need the same headroom.
    for (const m of [
      "anthropic/claude-opus-4",
      "openai/o1-preview",
      "deepseek/deepseek-r1",
      "qwen/qwq-32b",
      "z-ai/glm-4.6",
      "moonshot/kimi-k2",
      "x-ai/grok-4",
      "openrouter/free",
      "openrouter/auto",
    ]) {
      expect(isReasoningModel(m), `${m} should be reasoning`).toBe(true);
    }
    for (const m of ["openai/gpt-4o-mini", "google/gemini-flash-1.5", "anthropic/claude-haiku-3.5", "o3-mini"]) {
      expect(isReasoningModel(m), `${m} should NOT be reasoning`).toBe(false);
    }
  });

  it("gives reasoning models token headroom, capped", () => {
    const reasoning = openrouterBody("deepseek/deepseek-r1", [], { jsonMode: true, maxTokens: 1000 });
    expect(reasoning.max_tokens).toBe(3000); // ×3 headroom

    const plain = openrouterBody("openai/gpt-4o-mini", [], { jsonMode: true, maxTokens: 1000 });
    expect(plain.max_tokens).toBe(1000);

    const capped = openrouterBody("deepseek/deepseek-r1", [], { jsonMode: true, maxTokens: 9000 });
    expect(capped.max_tokens).toBe(16000); // not 27000
  });

  it("always excludes the monologue, and asks for minimal effort when thinking is off", () => {
    expect(openrouterBody("m", [], { jsonMode: true }).reasoning).toEqual({ exclude: true });
    expect(openrouterBody("m", [], { jsonMode: true, thinking: false }).reasoning).toEqual({
      effort: "minimal",
      exclude: true,
    });
  });

  it("keeps the X-Title header ASCII", () => {
    // A non-ISO-8859-1 header value throws at fetch() time and breaks every call.
    const title = openrouterHeaders("k")["X-Title"]!;
    expect(title).toBe("THE STACK");
    expect(/^[\x20-\x7E]+$/.test(title)).toBe(true);
  });

  it("strips leaked think tags", () => {
    expect(stripThinkTags("<think>hmm, let me consider</think>Real answer")).toBe("Real answer");
    expect(stripThinkTags("<thinking>a</thinking>  B  ")).toBe("B");
    expect(stripThinkTags(null)).toBe("");
  });

  it("reports a burned thinking budget as its own error, not 'empty response'", () => {
    const res = { ok: true, status: 200 } as Response;
    const body = JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: "<think>endless monologue" } }],
    });
    expect(() => extractOpenrouterText(res, body)).toThrow(SpentThinkingError);
  });

  it("maps a dead model to actionable advice", () => {
    const res = { ok: false, status: 404 } as Response;
    expect(() => extractOpenrouterText(res, "no endpoints found")).toThrow(/no longer available/i);
  });
});

describe("shared API keys", () => {
  it("lets the shared store win over a local value", () => {
    writeSharedKeys({ geminiKey: "shared-key" });
    const out = resolveKeys({ geminiKey: "local-key" }, ["geminiKey"]);
    expect(out.geminiKey).toBe("shared-key");
  });

  it("promotes a local-only key into the shared store", () => {
    // This is how one key entered in any section becomes available everywhere.
    const out = resolveKeys({ openrouterKey: "only-local" }, ["openrouterKey"]);
    expect(out.openrouterKey).toBe("only-local");
    expect(readSharedKeys().openrouterKey).toBe("only-local");
  });

  it("ignores empty values on write but clears explicitly", () => {
    writeSharedKeys({ ytKey: "abc" });
    writeSharedKeys({ ytKey: "" }); // must not wipe by accident
    expect(readSharedKeys().ytKey).toBe("abc");

    clearSharedKey("ytKey");
    expect(readSharedKeys().ytKey).toBe("");
  });

  it("stamps updatedAt and stores under the legacy key name", () => {
    writeSharedKeys({ geminiKey: "k" });
    expect(readSharedKeys().updatedAt).toBeTruthy();
    expect(localStorage.getItem(KEYS.stackSettings)).toContain("geminiKey");
  });

  it("survives a corrupt settings blob rather than throwing", () => {
    localStorage.setItem(KEYS.stackSettings, "{not json");
    expect(readSharedKeys()).toEqual({});
  });
});
