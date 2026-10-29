import { createServer, type Server, type ServerResponse } from "node:http";

export const RESEARCH_NAMESPACES = ["firecrawl_fixture", "context-mode_fixture"] as const;
export const SHARED_SOURCE_URL = "https://fixture.invalid/source/shared";

type Namespace = (typeof RESEARCH_NAMESPACES)[number];
type Observation = {
  method: string;
  namespace?: Namespace;
  tool?: string;
  requestId?: string | number;
  event?: "started" | "completed" | "cancelled";
};

const tools = [
  {
    name: "lookup",
    description:
      "Search public research sources. Inputs: query, optional sourceTypes, language, publishedAfter, sort, fields, maxResults. Returns cited source URL, title, date, and requested research fields.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sourceTypes: { type: "array", items: { type: "string" } },
        language: { type: "string" },
        publishedAfter: { type: "string" },
        sort: { type: "string" },
        fields: { type: "array", items: { type: "string" } },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "unavailable",
    description: "Fixture tool that deliberately fails.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wait",
    description: "Cancellable fixture operation held until the test releases it.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

function json(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function rpcResult(id: string | number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function startFixture(maxRequests = 20) {
  const observations: Observation[] = [];
  let requestCount = 0;
  const cancellations: Array<{ namespace: Namespace; requestId: string | number }> = [];
  const pending = new Map<
    string,
    { namespace: Namespace; id: string | number; response: ServerResponse; cancel: () => void }
  >();
  const lookups = new Map<string, { namespace: Namespace; id: string | number; response: ServerResponse }>();
  let expectedPair: Set<Namespace> | undefined;
  let autoReleasePair = true;
  let pairStarted = new Set<Namespace>();
  let releasePair = () => {};
  let pairReleased: Promise<void> | undefined;
  let waitsReleased = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let server: Server;

  const requestKey = (namespace: Namespace, id: string | number) => JSON.stringify([namespace, typeof id, id]);

  const finishPending = (key: string, result: unknown, isError = false) => {
    const active = pending.get(key);
    if (!active) return;
    pending.delete(key);
    observations.push({
      method: "tools/call",
      namespace: active.namespace,
      tool: "wait",
      requestId: active.id,
      event: isError ? "cancelled" : "completed",
    });
    json(
      active.response,
      200,
      isError
        ? rpcError(active.id, -32800, String(result))
        : rpcResult(active.id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          }),
    );
  };

  server = createServer(async (request, response) => {
    request.setTimeout(90_000, () => request.destroy());
    const namespace = RESEARCH_NAMESPACES.find((name) => request.url === `/${name}`);
    if (!namespace) return json(response, 404, rpcError(null, -32004, "Unknown fixture path"));
    if (request.method === "GET") return json(response, 405, rpcError(null, -32000, "Method not allowed"));
    if (request.method !== "POST") return json(response, 405, rpcError(null, -32000, "Method not allowed"));
    let body = "";
    for await (const chunk of request) body += chunk;
    let message: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
      message = JSON.parse(body);
    } catch {
      return json(response, 400, rpcError(null, -32700, "Parse error"));
    }
    if (requestCount >= maxRequests)
      return json(response, 429, rpcError(message.id ?? null, -32029, "Fixture request bound reached"));
    requestCount += 1;
    const id = message.id;
    observations.push({ method: message.method ?? "", namespace, ...(id !== undefined ? { requestId: id } : {}) });
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return json(response, 400, rpcError(id ?? null, -32600, "Invalid request"));
    }
    if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
      if (message.method === "notifications/cancelled") {
        const cancelledId = message.params?.requestId;
        const active =
          typeof cancelledId === "string" || typeof cancelledId === "number"
            ? pending.get(requestKey(namespace, cancelledId))
            : undefined;
        if (active) {
          active.cancel();
        }
      }
      return json(response, 202);
    }
    if (id === undefined) return json(response, 400, rpcError(null, -32600, "Request ID required"));
    if (message.method === "initialize") {
      const requested = message.params?.protocolVersion;
      if (typeof requested !== "string") return json(response, 400, rpcError(id, -32602, "protocolVersion required"));
      return json(
        response,
        200,
        rpcResult(id, {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: namespace, version: "fixture" },
        }),
      );
    }
    if (message.method === "tools/list") return json(response, 200, rpcResult(id, { tools: [...tools] }));
    if (message.method !== "tools/call") return json(response, 200, rpcError(id, -32601, "Method not found"));
    const toolName = message.params?.name;
    observations[observations.length - 1]!.tool = typeof toolName === "string" ? toolName : undefined;
    if (typeof toolName !== "string" || !tools.some((tool) => tool.name === toolName)) {
      return json(response, 200, rpcError(id, -32602, "Unknown fixture tool"));
    }
    if (toolName === "unavailable") {
      return json(
        response,
        200,
        rpcResult(id, { isError: true, content: [{ type: "text", text: "Fixture source unavailable" }] }),
      );
    }
    if (toolName === "lookup") {
      const lookupObservation = observations.length - 1;
      observations[lookupObservation]!.event = "started";
      const key = requestKey(namespace, id);
      lookups.set(key, { namespace, id, response });
      const args = message.params?.arguments as { query?: string } | undefined;
      if (expectedPair?.has(namespace)) {
        pairStarted.add(namespace);
        if (autoReleasePair && pairStarted.size === expectedPair.size) releasePair();
        await pairReleased;
      }
      if (closed && !lookups.has(key)) return;
      if (closed || response.destroyed) {
        observations.push({ method: "tools/call", namespace, tool: "lookup", requestId: id, event: "cancelled" });
        if (!response.headersSent && !response.destroyed) json(response, 200, rpcError(id, -32800, "Fixture closed"));
        lookups.delete(key);
        return;
      }
      lookups.delete(key);
      const specific = namespace === RESEARCH_NAMESPACES[0] ? "firecrawl" : "context-mode";
      observations.push({ method: "tools/call", namespace, tool: "lookup", requestId: id, event: "completed" });
      return json(
        response,
        200,
        rpcResult(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify([
                { url: SHARED_SOURCE_URL, title: "Shared synthetic source", source: specific, query: args?.query },
                {
                  url: `https://fixture.invalid/source/${specific}`,
                  title: `${specific} source`,
                  source: specific,
                  query: args?.query,
                },
              ]),
            },
          ],
        }),
      );
    }
    const key = requestKey(namespace, id);
    const waitObservation = observations.length - 1;
    observations[waitObservation]!.event = "started";
    const cancel = () => {
      if (!pending.has(key)) return;
      cancellations.push({ namespace, requestId: id });
      finishPending(key, "Request cancelled", true);
    };
    pending.set(key, { namespace, id, response, cancel });
    response.once("close", () => {
      if (pending.has(key)) {
        pending.delete(key);
        cancellations.push({ namespace, requestId: id });
        observations[waitObservation]!.event = "cancelled";
      }
    });
    if (closed) cancel();
    else if (waitsReleased) finishPending(key, { status: "released" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind loopback TCP");

  return {
    endpoints: Object.fromEntries(
      RESEARCH_NAMESPACES.map((namespace) => [namespace, `http://127.0.0.1:${address.port}/${namespace}`]),
    ) as Record<Namespace, string>,
    observations,
    cancellations,
    get requestCount() {
      return requestCount;
    },
    armLookupPair(pair: readonly [Namespace, Namespace], releaseWhenStarted = true) {
      expectedPair = new Set(pair);
      autoReleasePair = releaseWhenStarted;
      pairStarted = new Set();
      pairReleased = new Promise<void>((resolve) => {
        releasePair = resolve;
      });
    },
    get lookupStarted() {
      return [...pairStarted];
    },
    releaseLookupPair() {
      releasePair();
    },
    releaseWaits() {
      waitsReleased = true;
      for (const key of [...pending.keys()]) finishPending(key, { status: "released" });
    },
    async close() {
      if (closePromise) return closePromise;
      closed = true;
      releasePair();
      for (const active of [...pending.values()]) active.cancel();
      const closingLookups = [...lookups.entries()];
      for (const [key, active] of closingLookups) {
        observations.push({
          method: "tools/call",
          namespace: active.namespace,
          tool: "lookup",
          requestId: active.id,
          event: "cancelled",
        });
        if (!active.response.destroyed && !active.response.headersSent)
          json(active.response, 200, rpcError(active.id, -32800, "Fixture closed"));
        lookups.delete(key);
      }
      closePromise = (async () => {
        const closeServer = new Promise<void>((resolve) => server.close(() => resolve()));
        const closedDuringGrace = await Promise.race([
          closeServer.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
        ]);
        if (closedDuringGrace) return;
        server.closeAllConnections();
        const closedAfterForce = await Promise.race([
          closeServer.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
        ]);
        if (!closedAfterForce) throw new Error("Fixture server close exceeded its bounded grace");
      })();
      return closePromise;
    },
  };
}
