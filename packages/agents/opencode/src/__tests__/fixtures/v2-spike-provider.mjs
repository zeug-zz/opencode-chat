const REQUEST_LIMIT = 16_384;
const RESPONSE_LIMIT = 2_048;
const ANSWER = "spike complete";
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function loopbackEndpoint(settings) {
  const baseURL = settings?.baseURL;
  if (typeof baseURL !== "string") throw new Error("Spike provider requires its local mock endpoint");
  const url = new URL(baseURL);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !/^\/v1\/?$/u.test(url.pathname)) {
    throw new Error("Spike provider only permits the literal loopback mock endpoint");
  }
  return new URL("/v1/chat/completions", url);
}

async function readBounded(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) throw new Error("Spike provider mock response exceeded its byte limit");
    }
  } finally {
    reader.releaseLock();
  }
}

export function createSpikeProvider(settings) {
  const endpoint = loopbackEndpoint(settings);
  const send = typeof settings.fetch === "function" ? settings.fetch : globalThis.fetch;

  return {
    languageModel(modelId) {
      return {
        specificationVersion: "v3",
        provider: "opencode-chat-spike",
        modelId,
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error("The disposable spike provider supports streaming only");
        },
        doStream: async (options) => {
          const body = JSON.stringify({ model: modelId, prompt: options.prompt, tools: [] });
          if (Buffer.byteLength(body) > REQUEST_LIMIT)
            throw new Error("Spike provider request exceeded its byte limit");
          const response = await send(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal: options.abortSignal,
          });
          await readBounded(response);
          if (!response.ok) throw new Error("Spike provider mock rejected the request");

          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-start", id: "spike-text" });
              controller.enqueue({ type: "text-delta", id: "spike-text", delta: ANSWER });
              controller.enqueue({ type: "text-end", id: "spike-text" });
              controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
              controller.close();
            },
          });
          return { stream };
        },
      };
    },
  };
}
