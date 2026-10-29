import { afterEach, describe, expect, it } from "vitest";
import { RESEARCH_NAMESPACES, SHARED_SOURCE_URL, startFixture } from "./v2-code-mode-mcp.js";

const fixtures: Array<Awaited<ReturnType<typeof startFixture>>> = [];

async function start() {
  const fixture = await startFixture();
  fixtures.push(fixture);
  return fixture;
}

async function rpc(endpoint: string, message: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(message),
    signal,
  });
  return {
    status: response.status,
    body: response.status === 202 ? undefined : ((await response.json()) as Record<string, unknown>),
  };
}

async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Fixture request exceeded test timeout")), 4_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function until(predicate: () => boolean) {
  await bounded(
    (async () => {
      while (!predicate()) await new Promise<void>((resolve) => setImmediate(resolve));
    })(),
  );
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("local native MCP Code Mode fixture", () => {
  it("serves the reviewed namespaces, negotiated initialize, catalog, and overlapping stable source payloads", async () => {
    const fixture = await start();
    for (const namespace of RESEARCH_NAMESPACES) {
      const initialized = await rpc(fixture.endpoints[namespace], {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      });
      expect(initialized.body?.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} } });
      expect(await rpc(fixture.endpoints[namespace], { jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({
        status: 202,
        body: undefined,
      });
      const catalog = await rpc(fixture.endpoints[namespace], { jsonrpc: "2.0", id: 2, method: "tools/list" });
      if (!catalog.body) throw new Error("tools/list returned no response body");
      expect(
        (catalog.body.result as { tools: Array<{ name: string; description: string }> }).tools.map((tool) => tool.name),
      ).toEqual(["lookup", "unavailable", "wait"]);
      expect(
        (catalog.body.result as { tools: Array<{ name: string; description: string }> }).tools[0]?.description,
      ).toContain("publishedAfter");
      const result = await rpc(fixture.endpoints[namespace], {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "lookup", arguments: { query: "alpha", fields: ["findings"] } },
      });
      if (!result.body) throw new Error("tools/call returned no response body");
      const payload = JSON.parse(
        (result.body.result as { content: Array<{ text: string }> }).content[0]!.text,
      ) as Array<{ url: string; source: string }>;
      expect(payload[0]?.url).toBe(SHARED_SOURCE_URL);
      expect(payload[0]?.source).toBe(namespace === RESEARCH_NAMESPACES[0] ? "firecrawl" : "context-mode");
      expect(payload[1]?.url).toContain("https://fixture.invalid/source/");
    }
  });

  it("keeps the armed pair pending until both independent namespace lookups have started", async () => {
    const fixture = await start();
    fixture.armLookupPair(RESEARCH_NAMESPACES);
    const requests = RESEARCH_NAMESPACES.map((namespace, index) =>
      rpc(fixture.endpoints[namespace], {
        jsonrpc: "2.0",
        id: index + 10,
        method: "tools/call",
        params: { name: "lookup", arguments: { query: "paired" } },
      }),
    );
    await Promise.all(requests);
    expect(fixture.lookupStarted).toEqual(expect.arrayContaining([...RESEARCH_NAMESPACES]));
    expect(
      fixture.observations.filter((observation) => observation.tool === "lookup" && observation.event === "started"),
    ).toHaveLength(2);
  });

  it("preserves explicit tool failures and rejects unknown methods and tools", async () => {
    const fixture = await start();
    const endpoint = fixture.endpoints.firecrawl_fixture;
    const failure = await rpc(endpoint, {
      jsonrpc: "2.0",
      id: "fail",
      method: "tools/call",
      params: { name: "unavailable", arguments: {} },
    });
    expect(failure.body?.result).toMatchObject({ isError: true });
    expect((await rpc(endpoint, { jsonrpc: "2.0", id: "method", method: "tools/not-real" })).body?.error).toMatchObject(
      { code: -32601 },
    );
    expect(
      (
        await rpc(endpoint, {
          jsonrpc: "2.0",
          id: "tool",
          method: "tools/call",
          params: { name: "unknown", arguments: {} },
        })
      ).body?.error,
    ).toMatchObject({ code: -32602 });
    expect((await fetch(`${endpoint}/other`)).status).toBe(404);
    expect((await fetch(endpoint)).status).toBe(405);
  });

  it("cancels pending work from an MCP cancellation notification and a disconnected caller", async () => {
    const fixture = await start();
    const endpoint = fixture.endpoints.firecrawl_fixture;
    const controller = new AbortController();
    const notifiedCall = rpc(
      endpoint,
      { jsonrpc: "2.0", id: "notify", method: "tools/call", params: { name: "wait", arguments: {} } },
      controller.signal,
    );
    await until(() => fixture.observations.some((observation) => observation.requestId === "notify"));
    expect(
      await rpc(endpoint, {
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: "notify", reason: "test stop" },
      }),
    ).toEqual({ status: 202, body: undefined });
    expect((await notifiedCall).body?.error).toMatchObject({ code: -32800 });

    const disconnected = new AbortController();
    const disconnectedCall = rpc(
      endpoint,
      { jsonrpc: "2.0", id: "disconnect", method: "tools/call", params: { name: "wait", arguments: {} } },
      disconnected.signal,
    );
    await until(() => fixture.observations.some((observation) => observation.requestId === "disconnect"));
    disconnected.abort();
    await expect(disconnectedCall).rejects.toThrow();
    await until(() => fixture.cancellations.some(({ requestId }) => requestId === "disconnect"));
    expect(fixture.cancellations.map(({ requestId }) => requestId)).toEqual(
      expect.arrayContaining(["notify", "disconnect"]),
    );
  });

  it("stops held responders during explicit release and close cleanup", async () => {
    const fixture = await start();
    const endpoint = fixture.endpoints["context-mode_fixture"];
    const call = rpc(endpoint, {
      jsonrpc: "2.0",
      id: "cleanup",
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    });
    await until(() => fixture.observations.some((observation) => observation.requestId === "cleanup"));
    fixture.releaseWaits();
    expect((await call).body?.result).toBeDefined();
    const closeFixture = await start();
    const closing = rpc(closeFixture.endpoints["context-mode_fixture"], {
      jsonrpc: "2.0",
      id: "close",
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    });
    await until(() => closeFixture.observations.some((observation) => observation.requestId === "close"));
    await Promise.all([closeFixture.close(), closeFixture.close()]);
    fixtures.splice(fixtures.indexOf(closeFixture), 1);
    expect((await closing).body?.error).toMatchObject({ code: -32800 });
  });

  it("keys held requests by namespace and typed JSON-RPC id", async () => {
    const fixture = await start();
    const [firecrawl, contextMode] = RESEARCH_NAMESPACES;
    const firecrawlCall = rpc(fixture.endpoints[firecrawl], {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    });
    const contextCall = rpc(fixture.endpoints[contextMode], {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    });
    await until(
      () => fixture.observations.filter((item) => item.tool === "wait" && item.event === "started").length === 2,
    );

    await rpc(fixture.endpoints[firecrawl], {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 },
    });
    expect((await bounded(firecrawlCall)).body?.error).toMatchObject({ code: -32800 });
    expect(
      fixture.observations.some(
        (item) => item.namespace === contextMode && item.tool === "wait" && item.event === "completed",
      ),
    ).toBe(false);
    fixture.releaseWaits();
    expect((await bounded(contextCall)).body?.result).toBeDefined();

    const typedFixture = await start();
    const numeric = rpc(typedFixture.endpoints[firecrawl], {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    });
    const string = rpc(typedFixture.endpoints[firecrawl], {
      jsonrpc: "2.0",
      id: "1",
      method: "tools/call",
      params: { name: "wait", arguments: {} },
    });
    await until(
      () => typedFixture.observations.filter((item) => item.tool === "wait" && item.event === "started").length === 2,
    );
    await rpc(typedFixture.endpoints[firecrawl], {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 },
    });
    expect((await bounded(numeric)).body?.error).toMatchObject({ code: -32800 });
    expect(typedFixture.observations.some((item) => item.requestId === "1" && item.event === "completed")).toBe(false);
    typedFixture.releaseWaits();
    expect((await bounded(string)).body?.result).toBeDefined();
  });

  it("records overlapping lookups as started and completed, and closes armed waiters without success", async () => {
    const fixture = await start();
    fixture.armLookupPair(RESEARCH_NAMESPACES);
    const lookups = RESEARCH_NAMESPACES.map((namespace) =>
      rpc(fixture.endpoints[namespace], {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "lookup", arguments: { query: "overlap" } },
      }),
    );
    await until(() => fixture.lookupStarted.length === 2);
    await bounded(Promise.all(lookups));
    expect(fixture.observations.filter((item) => item.tool === "lookup").map((item) => item.event)).toEqual([
      "started",
      "started",
      "completed",
      "completed",
    ]);

    const closing = await start();
    closing.armLookupPair(RESEARCH_NAMESPACES, false);
    const blockedLookups = RESEARCH_NAMESPACES.map((namespace) =>
      rpc(closing.endpoints[namespace], {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "lookup", arguments: { query: "close" } },
      }),
    );
    await until(() => closing.lookupStarted.length === 2);
    await Promise.all([closing.close(), closing.close()]);
    fixtures.splice(fixtures.indexOf(closing), 1);
    const responses = await bounded(Promise.all(blockedLookups));
    expect(responses.map((response) => response.body)).toEqual([
      { jsonrpc: "2.0", id: 2, error: { code: -32800, message: "Fixture closed" } },
      { jsonrpc: "2.0", id: 2, error: { code: -32800, message: "Fixture closed" } },
    ]);
    expect(closing.observations.filter((item) => item.tool === "lookup" && item.event === "cancelled")).toHaveLength(2);
  });
});
