import { describe, expect, it, vi } from "vitest";

const providerModule = await import(new URL("./v2-spike-provider.mjs", import.meta.url).href);

describe("test-owned V2 spike provider fixture", () => {
  it("uses only loopback, forwards cancellation, bounds the request, and emits a no-tools V3 stream", async () => {
    let request: { input: unknown; init?: RequestInit } | undefined;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      request = { input, init };
      return new Response("mock-ok");
    });
    const provider = providerModule.createSpikeProvider({ baseURL: "http://127.0.0.1:43210/v1", fetch: fetcher });
    const model = provider.languageModel("mock-model");
    const abort = new AbortController();
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
      abortSignal: abort.signal,
    });
    const chunks: Array<{ type: string; delta?: string; tools?: unknown[] }> = [];
    for await (const chunk of result.stream) chunks.push(chunk);

    expect(String(request?.input)).toBe("http://127.0.0.1:43210/v1/chat/completions");
    expect(request?.init?.signal).toBe(abort.signal);
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({ model: "mock-model", tools: [] });
    expect(chunks).toMatchObject([
      { type: "text-start" },
      { type: "text-delta", delta: "spike complete" },
      { type: "text-end" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: { outputTokens: { total: 1, text: 1, reasoning: 0 } },
      },
    ]);
    await expect(model.doGenerate({ prompt: [] })).rejects.toThrow(/streaming only/);
  });

  it("rejects non-literal-loopback endpoint configuration", () => {
    expect(() => providerModule.createSpikeProvider({ baseURL: "http://localhost:43210/v1" })).toThrow(
      /literal loopback/,
    );
    expect(() => providerModule.createSpikeProvider({ baseURL: "https://127.0.0.1/v1" })).toThrow(/literal loopback/);
  });

  it("aborts an in-flight mock fetch when the AI SDK doStream signal is cancelled", async () => {
    let observedSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      observedSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const provider = providerModule.createSpikeProvider({ baseURL: "http://127.0.0.1:43210/v1", fetch: fetcher });
    const abort = new AbortController();
    const pending = provider.languageModel("mock-model").doStream({ prompt: [], abortSignal: abort.signal });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    abort.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(observedSignal).toBe(abort.signal);
  });

  it("rejects oversized mock responses without reading them unboundedly", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(2_049)));
    const provider = providerModule.createSpikeProvider({ baseURL: "http://127.0.0.1:43210/v1", fetch: fetcher });
    await expect(
      provider.languageModel("mock-model").doStream({ prompt: [], abortSignal: new AbortController().signal }),
    ).rejects.toThrow(/response exceeded its byte limit/);
  });

  it("rejects an oversized request before invoking fetch", async () => {
    const fetcher = vi.fn(async () => new Response("mock-ok"));
    const provider = providerModule.createSpikeProvider({ baseURL: "http://127.0.0.1:43210/v1", fetch: fetcher });
    await expect(
      provider.languageModel("mock-model").doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "x".repeat(17_000) }] }],
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow(/request exceeded its byte limit/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
