import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, ChatMessageWithParts } from "@opencode-chat/core";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent.js";
import { RESEARCH_NAMESPACES, startFixture } from "./fixtures/v2-code-mode-mcp.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const RUN_ENABLED = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const EXECUTABLE_INPUT = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const EXPECTED_VERSION = "2.2.0";
const SOURCE_COMMIT = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const TIMEOUT_MS = 90_000;
const MAX_API_REQUESTS = 60;
const MAX_MODEL_REQUESTS = 6;
const MAX_MCP_REQUESTS = 20;
const OWNER_RUNS = new Set<V2TestIsolation>();

type Status = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
type Stage = "preflight" | "connect" | "catalog" | "research" | "history" | "stop" | "cleanup";
type FailureCode =
  | "dedicated_vitest_fork_unproven"
  | "explicit_executable_missing_or_relative"
  | "explicit_executable_unavailable"
  | "ambient_preflight_blocked"
  | "spawn_ambient_preflight_blocked"
  | "model_body_limit_exceeded"
  | "api_request_bound_exceeded"
  | "model_request_bound_exceeded"
  | "overall_deadline_exceeded"
  | "native_catalog_contract_not_observed"
  | "mcp_setup_barrier_failed"
  | "search_results_not_consumed"
  | "compact_result_or_failure_missing"
  | "stop_waits_not_started"
  | "stop_abort_failed"
  | "stop_waits_not_cancelled"
  | "stop_wait_completed_after_release"
  | "stop_terminal_history_missing"
  | "adapter_cleanup_promise_unavailable"
  | "adapter_disconnect_failed"
  | "owned_process_group_not_reaped"
  | "fixture_close_failed"
  | "owned_isolation_cleanup_failed"
  | "unexpected";
type Manifest = {
  schemaVersion: 1;
  runId: string;
  status: Status;
  qualification: "PRODUCTION_ADAPTER_NATIVE_CODE_MODE_LOCAL_CM4_SUBSET";
  expectedVersion: string;
  observedVersion?: string;
  observedPrivateChildPid?: number;
  sourceCommit: string;
  sourceCommitMeaning: "inspected-release-tag";
  clientPackage: "@opencode/client@2.1.0";
  executablePath: string | null;
  executableSha256: string | null;
  fixtureRoot: string | null;
  statePath: string | null;
  evidencePath: string;
  bounds: {
    overallMs: number;
    maxApiRequests: number;
    maxModelRequests: number;
    maxMcpRequests: number;
    maxSessions: 2;
    maxChildren: 2;
    maxSimultaneousChildren: 1;
  };
  checks: Record<string, boolean>;
  observations: {
    catalog: {
      roleMarkers: Record<string, boolean>;
      characterCounts: Record<string, number>;
    };
    nativeSizeMeasurement?: {
      unit: "UTF-8 bytes and JavaScript string characters";
      toolDefinitionCount: number;
      toolDefinitions: { utf8Bytes: number; characters: number };
      systemDeveloperInstructions: { utf8Bytes: number; characters: number };
      totalUtf8Bytes: number;
      totalCharacters: number;
    };
    directSizeMeasurement?: {
      unit: "UTF-8 bytes and JavaScript string characters";
      toolDefinitionCount: number;
      toolDefinitions: { utf8Bytes: number; characters: number };
      systemDeveloperInstructions: { utf8Bytes: number; characters: number };
      totalUtf8Bytes: number;
      totalCharacters: number;
    };
    compactSizeMeasurement?: {
      intermediateCharacterCount: number;
      compactCharacterCount: number;
    };
    requestShape?: ReturnType<typeof inspectRequestShape>;
    mcpSetupBarrier?: {
      reads: number;
      connectedReads: number;
      bothConnected: boolean;
      settled: boolean;
      exceptionCategory?: "OpenCodeOperationUnavailableError" | "ClientError" | "TypeError" | "Error" | "other";
      clientErrorReason?: "Transport" | "UnexpectedStatus" | "MalformedResponse" | "UnsupportedContentType" | "other";
      statuses: Record<
        string,
        "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration" | "unknown"
      >;
    };
    directMcpSetupBarrier?: {
      reads: number;
      connectedReads: number;
      bothConnected: boolean;
      settled: boolean;
      statuses: Record<
        string,
        "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration" | "unknown"
      >;
    };
    mcpListResponse?: {
      observed: boolean;
      httpStatus?: number;
      dataIsArray?: boolean;
      locationIsObject?: boolean;
      directoryMatchesOwnedFixture?: boolean;
    };
    nativeFetchFixture: { requestCount: number; requestMatches: boolean };
    denialProbe: {
      resultCount: number;
      rejectedCount: number;
      unknownToolCount: number;
      permissionDeniedCount: number;
      otherErrorCount: number;
      unexpectedSuccessCount: number;
      nativeShellPostCount: number;
      shellToolHistoryCount: number;
      shellToolEventCount: number;
    };
    nativeStopOutcome: "interrupted" | "succeeded" | "failed" | null;
    nativeStopObservationCounts: {
      pathMatched: number;
      dataRecord: number;
      dataIDMatched: number;
      validOutcome: number;
    };
    stopToolStatus: "error" | "completed" | "other" | null;
    stopToolIDMatchesSyntheticCall: boolean;
    stopToolEventBeforeAndAfterAbort: boolean;
  };
  counts: { apiRequests: number; modelRequests: number; mcpRequests: number; sessions: number };
  terminalReads: number;
  fixtureEvents: Array<{ method: string; namespace?: string; tool?: string; event?: string }>;
  cleanup: {
    agentDisconnected: boolean;
    cleanupPromiseResolved: boolean;
    processGroupGone: boolean | null;
    nativeAgentDisconnected: boolean;
    nativeCleanupPromiseResolved: boolean;
    nativeProcessGroupGone: boolean | null;
    fixtureClosed: boolean;
    ownedStateAbsent: boolean | null;
    environmentRestored: boolean;
    fetchRestored: boolean;
  };
  stage: Stage;
  failureCode?: FailureCode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializedSize(value: unknown) {
  const serialized = JSON.stringify(value) ?? "";
  return { utf8Bytes: Buffer.byteLength(serialized, "utf8"), characters: serialized.length };
}

function measureFirstRequest(body: Record<string, unknown>) {
  const toolDefinitions = body.tools ?? [];
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const instructionContents = messages
    .filter((message): message is Record<string, unknown> => isRecord(message))
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.content);
  return {
    toolDefinitionCount: Array.isArray(toolDefinitions) ? toolDefinitions.length : 0,
    toolDefinitions: serializedSize(toolDefinitions),
    systemDeveloperInstructions: serializedSize(instructionContents),
  };
}

function observeOwnedSessionInfo(response: unknown, expectedSessionID: string) {
  const data = isRecord(response) && isRecord(response.data) ? response.data : undefined;
  const idMatched = data?.id === expectedSessionID;
  const outcome = data?.outcome;
  const validOutcome = outcome === "interrupted" || outcome === "succeeded" || outcome === "failed";
  return {
    dataRecord: data !== undefined,
    idMatched,
    outcome: idMatched && validOutcome ? outcome : undefined,
  } as const;
}

describe("native session outcome observer", () => {
  it("accepts only the owned ID and allowlisted outcomes from the data envelope", () => {
    expect(observeOwnedSessionInfo({ data: { id: "owned", outcome: "interrupted" } }, "owned").outcome).toBe(
      "interrupted",
    );
    expect(
      observeOwnedSessionInfo({ data: { id: "foreign", outcome: "interrupted" } }, "owned").outcome,
    ).toBeUndefined();
    expect(observeOwnedSessionInfo({ id: "owned", outcome: "interrupted" }, "owned").dataRecord).toBe(false);
    expect(observeOwnedSessionInfo({ data: { id: "owned", outcome: "running" } }, "owned").outcome).toBeUndefined();
  });
});

describe("serialized size measurement", () => {
  it("uses JSON-string character counts and UTF-8 byte counts for non-ASCII values", () => {
    const serialized = JSON.stringify({ text: "é🧪" });
    const measured = serializedSize({ text: "é🧪" });
    expect(measured).toEqual({ utf8Bytes: Buffer.byteLength(serialized, "utf8"), characters: serialized.length });
    expect(measured.utf8Bytes).toBeGreaterThan(measured.characters);
    expect(
      measureFirstRequest({ tools: [{ name: "execute" }], messages: [{ role: "system", content: "é🧪" }] }),
    ).toEqual({
      toolDefinitionCount: 1,
      toolDefinitions: serializedSize([{ name: "execute" }]),
      systemDeveloperInstructions: serializedSize(["é🧪"]),
    });
  });
});

const MCP_SETUP_READ_LIMIT = 20;
const MCP_SETUP_TIMEOUT_MS = 5_000;
const MCP_CATALOG_SETTLE_MS = 250;

function validateMcpSetupStatus(value: unknown, namespaces: readonly string[]) {
  if (!isRecord(value)) return { ready: false, failed: true, statuses: {} };
  const statuses: Record<
    string,
    "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration" | "unknown"
  > = {};
  let ready = true;
  let failed = false;
  for (const namespace of namespaces) {
    const server = value[namespace];
    if (!isRecord(server) || typeof server.status !== "string" || typeof server.connected !== "boolean") {
      ready = false;
      failed = true;
      continue;
    }
    const lifecycle = [
      "connected",
      "disabled",
      "failed",
      "needs_auth",
      "needs_client_registration",
      "unknown",
    ].includes(server.status)
      ? (server.status as (typeof statuses)[string])
      : "unknown";
    statuses[namespace] = lifecycle;
    if (lifecycle === "failed" || lifecycle === "needs_auth") failed = true;
    if (lifecycle !== "connected" || server.connected !== true) ready = false;
  }
  return { ready, failed, statuses };
}

async function waitForMcpSetup(agent: OpenCodeAgent, namespaces: readonly string[], signal: AbortSignal) {
  const deadline = Date.now() + MCP_SETUP_TIMEOUT_MS;
  let reads = 0;
  let connectedReads = 0;
  let firstConnectedAt: number | undefined;
  let statuses: ReturnType<typeof validateMcpSetupStatus>["statuses"] = {};
  let exceptionCategory:
    | "OpenCodeOperationUnavailableError"
    | "ClientError"
    | "TypeError"
    | "Error"
    | "other"
    | undefined;
  let clientErrorReason:
    | "Transport"
    | "UnexpectedStatus"
    | "MalformedResponse"
    | "UnsupportedContentType"
    | "other"
    | undefined;
  while (reads < MCP_SETUP_READ_LIMIT && Date.now() < deadline && !signal.aborted) {
    reads += 1;
    let status: unknown;
    try {
      status = await agent.getMcpStatus();
    } catch (error) {
      const errorName = error instanceof Error ? error.constructor.name : "other";
      exceptionCategory = ["OpenCodeOperationUnavailableError", "ClientError", "TypeError", "Error"].includes(errorName)
        ? (errorName as typeof exceptionCategory)
        : "other";
      if (exceptionCategory === "ClientError" && isRecord(error)) {
        const reason = error.reason;
        clientErrorReason = ["Transport", "UnexpectedStatus", "MalformedResponse", "UnsupportedContentType"].includes(
          String(reason),
        )
          ? (reason as typeof clientErrorReason)
          : "other";
      }
      return { ready: false, reads, connectedReads, statuses: {}, exceptionCategory, clientErrorReason };
    }
    const result = validateMcpSetupStatus(status, namespaces);
    statuses = result.statuses;
    if (result.failed) return { ready: false, reads, connectedReads, statuses };
    if (result.ready) {
      connectedReads += 1;
      firstConnectedAt ??= Date.now();
      if (Date.now() - firstConnectedAt >= MCP_CATALOG_SETTLE_MS)
        return { ready: true, reads, connectedReads, statuses, exceptionCategory, clientErrorReason };
    } else {
      connectedReads = 0;
      firstConnectedAt = undefined;
    }
    const delay = Math.min(MCP_CATALOG_SETTLE_MS, Math.max(0, deadline - Date.now()));
    if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
  }
  return { ready: false, reads, connectedReads, statuses, exceptionCategory, clientErrorReason };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("fixture_bind_failed"));
      else resolvePort(address.port);
    });
  });
}

function absent(path: string): Promise<boolean> {
  return access(path).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
}

function processGroupGone(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function hasExactlyOneFixtureLookup(
  events: readonly {
    method: string;
    namespace?: string;
    tool?: string;
    event?: string;
  }[],
  startIndex: number,
): boolean {
  const directLookupEvents = events
    .slice(startIndex)
    .filter(
      (event) => event.method === "tools/call" && event.namespace === "firecrawl_fixture" && event.tool === "lookup",
    );
  return (
    directLookupEvents.filter((event) => event.event === "started").length === 1 &&
    directLookupEvents.filter((event) => event.event === "completed").length === 1 &&
    directLookupEvents.length === 2
  );
}

describe("direct fixture lookup observation", () => {
  it("counts the mutated started observation and its completion only after the direct boundary", () => {
    const events = [
      { method: "tools/call", namespace: "firecrawl_fixture", tool: "lookup", event: "started" },
      { method: "tools/call", namespace: "firecrawl_fixture", tool: "lookup", event: "completed" },
      { method: "tools/call", namespace: "firecrawl_fixture", tool: "lookup", event: "started" },
      { method: "tools/call", namespace: "firecrawl_fixture", tool: "lookup", event: "completed" },
    ];
    expect(hasExactlyOneFixtureLookup(events, 2)).toBe(true);
    expect(hasExactlyOneFixtureLookup(events, 0)).toBe(false);
    expect(hasExactlyOneFixtureLookup(events, 3)).toBe(false);
  });
});

function assistantHasText(messages: ChatMessageWithParts[], expected: string): boolean {
  return messages.some(
    ({ info, parts }) =>
      info.role === "assistant" && parts.some((part) => part.type === "text" && part.text === expected),
  );
}

function latestToolResult(messages: unknown): unknown {
  if (!Array.isArray(messages)) return undefined;
  const message = [...messages].reverse().find((item) => isRecord(item) && item.role === "tool");
  return isRecord(message) ? message.content : undefined;
}

function extractSearchItems(value: unknown, found: Array<{ path: string; signature: string }>): void {
  if (Array.isArray(value)) {
    for (const item of value) extractSearchItems(item, found);
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string") {
      try {
        extractSearchItems(JSON.parse(value) as unknown, found);
      } catch {
        // Tool results may contain non-JSON text; only parsed native search records count.
      }
    }
    return;
  }
  if (typeof value.path === "string" && typeof value.signature === "string")
    found.push({ path: value.path, signature: value.signature });
  for (const child of Object.values(value)) extractSearchItems(child, found);
}

function extractStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    try {
      extractStrings(JSON.parse(value) as unknown, output);
    } catch {
      // Preserve only strings already present in the in-memory model request.
    }
  } else if (Array.isArray(value)) {
    for (const child of value) extractStrings(child, output);
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) extractStrings(child, output);
  }
}

function functionNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((definition) => {
    if (!isRecord(definition) || !isRecord(definition.function) || typeof definition.function.name !== "string")
      return [];
    return [definition.function.name];
  });
}

const NATIVE_TOOL_NAMES = new Set([
  "firecrawl_fixture.lookup",
  "firecrawl_fixture.unavailable",
  "firecrawl_fixture.wait",
  "context-mode_fixture.lookup",
  "context-mode_fixture.unavailable",
  "context-mode_fixture.wait",
]);
const NATIVE_WAIT_TOOL_NAMES = new Set(["firecrawl_fixture.wait", "context-mode_fixture.wait"]);

function nativeToolCallProgress(part: unknown) {
  if (!isRecord(part) || !isRecord(part.state) || !isRecord(part.state.metadata)) return [];
  const calls = part.state.metadata.toolCalls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call) =>
    isRecord(call) &&
    typeof call.tool === "string" &&
    NATIVE_TOOL_NAMES.has(call.tool) &&
    (call.status === "running" || call.status === "completed" || call.status === "error")
      ? [{ tool: call.tool, status: call.status }]
      : [],
  );
}

function inspectNativeCatalogInstructions(messages: unknown[]) {
  const roles = ["system", "developer", "user"] as const;
  const textByRole = Object.fromEntries(
    roles.map((role) => {
      const text: string[] = [];
      for (const message of messages) {
        if (isRecord(message) && message.role === role) extractStrings(message.content, text);
      }
      return [role, text.join("\n")];
    }),
  ) as Record<(typeof roles)[number], string>;
  const checks = Object.fromEntries(
    roles.flatMap((role) => {
      const text = textByRole[role];
      return [
        [`firstRequestCatalog${role}Header`, text.includes("# Code Mode")],
        [`firstRequestCatalog${role}Intro`, text.includes("Use the `execute` tool to call the tools listed below")],
        [`firstRequestCatalog${role}FirecrawlNamespace`, text.includes("firecrawl_fixture")],
        [`firstRequestCatalog${role}ContextModeNamespace`, text.includes("context-mode_fixture")],
      ];
    }),
  );
  const qualifyingRole = roles.find((role) =>
    [
      "# Code Mode",
      "Use the `execute` tool to call the tools listed below",
      "firecrawl_fixture",
      "context-mode_fixture",
    ].every((fragment) => textByRole[role].includes(fragment)),
  );
  const catalogMarkers = ["# Code Mode", "The Code Mode tool catalog has changed."];
  return {
    checks,
    qualifyingRole,
    roleMarkers: checks,
    characterCounts: Object.fromEntries(
      roles.map((role) => {
        const text = textByRole[role];
        const markerPositions = catalogMarkers
          .map((marker) => text.indexOf(marker))
          .filter((position) => position >= 0);
        return [role, markerPositions.length === 0 ? 0 : text.length - Math.min(...markerPositions)];
      }),
    ),
  };
}

const CATALOG_MARKERS = [
  "# Code Mode",
  "Use the `execute` tool to call the tools listed below",
  "No Code Mode tools are currently available",
  ...RESEARCH_NAMESPACES,
] as const;

function inspectRequestShape(body: Record<string, unknown>) {
  const roles = ["system", "user", "developer", "assistant", "tool"] as const;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const contentKinds = Object.fromEntries(
    roles.map((role) => [role, { string: 0, array: 0, object: 0, other: 0, contentCharacters: 0 }]),
  ) as Record<
    (typeof roles)[number],
    { string: number; array: number; object: number; other: number; contentCharacters: number }
  >;
  const allStrings: string[] = [];
  const messageStrings: string[] = [];
  extractStrings(body, allStrings);
  let unknownRoleParts = 0;
  let systemParts = 0;
  let userParts = 0;
  let developerParts = 0;
  let assistantParts = 0;
  let toolParts = 0;
  const roleCounts = { system: 0, user: 0, developer: 0, assistant: 0, tool: 0 };
  for (const item of messages) {
    if (!isRecord(item)) {
      unknownRoleParts += 1;
      continue;
    }
    extractStrings(item, messageStrings);
    if (typeof item.role !== "string" || !Object.hasOwn(roleCounts, item.role)) {
      unknownRoleParts += 1;
      continue;
    }
    const role = item.role as keyof typeof roleCounts;
    roleCounts[role] += 1;
    const content = item.content;
    const kind =
      typeof content === "string"
        ? "string"
        : Array.isArray(content)
          ? "array"
          : isRecord(content)
            ? "object"
            : "other";
    contentKinds[role][kind] += 1;
    const strings: string[] = [];
    extractStrings(content, strings);
    contentKinds[role].contentCharacters += strings.reduce((total, text) => total + text.length, 0);
    const parts = Array.isArray(content) ? content.length : content === undefined || content === null ? 0 : 1;
    if (role === "system") systemParts += parts;
    if (role === "user") userParts += parts;
    if (role === "developer") developerParts += parts;
    if (role === "assistant") assistantParts += parts;
    if (role === "tool") toolParts += parts;
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolNames = functionNames(body.tools);
  return {
    requestShape: {
      messagesIsArray: Array.isArray(body.messages),
      inputIsArray: Array.isArray(body.input),
      systemString: typeof body.system === "string",
      systemArray: Array.isArray(body.system),
      messageCount: messages.length,
      systemParts,
      userParts,
      developerParts,
      assistantParts,
      toolParts,
      unknownRoleParts,
      roleCounts,
      contentKinds,
      fieldsPresent: Object.fromEntries(
        ["model", "messages", "tools", "input", "system", "instructions", "stream"].map((field) => [
          field,
          Object.hasOwn(body, field),
        ]),
      ),
      toolDefinitionCount: tools.length,
      executeCount: toolNames.filter((name) => name === "execute").length,
      directFixtureToolCount: toolNames.filter((name) => /^(firecrawl_fixture|context-mode_fixture)_/u.test(name))
        .length,
    },
    markerFlags: Object.fromEntries(
      CATALOG_MARKERS.map((marker) => [marker, allStrings.some((text) => text.includes(marker))]),
    ),
    messageMarkerFlags: Object.fromEntries(
      CATALOG_MARKERS.map((marker) => [marker, messageStrings.some((text) => text.includes(marker))]),
    ),
  };
}

describe("native Code Mode catalog observation", () => {
  const catalog = [
    "# Code Mode",
    "Use the `execute` tool to call the tools listed below. They cannot be called directly.",
    "tools.firecrawl_fixture.lookup",
    'tools["context-mode_fixture"].lookup',
  ].join("\n");

  it("recognizes the initial catalog when OpenAI chat lowers system instructions into user content", () => {
    const result = inspectNativeCatalogInstructions([{ role: "user", content: catalog }]);
    expect(result.qualifyingRole).toBe("user");
    expect(result.checks.firstRequestCataloguserHeader).toBe(true);
    expect(result.checks.firstRequestCataloguserIntro).toBe(true);
    expect(result.checks.firstRequestCataloguserFirecrawlNamespace).toBe(true);
    expect(result.checks.firstRequestCataloguserContextModeNamespace).toBe(true);
    expect(result.checks.firstRequestCatalogsystemHeader).toBe(false);
    expect(result.checks.firstRequestCatalogdeveloperIntro).toBe(false);
    expect(result.characterCounts.user).toBe(catalog.length);
  });

  it("recognizes the native changed-catalog notice and accompanying catalog text across user messages", () => {
    const result = inspectNativeCatalogInstructions([
      {
        role: "user",
        content: "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
      },
      { role: "user", content: catalog },
    ]);
    expect(result.qualifyingRole).toBe("user");
    expect(result.characterCounts.user).toBeGreaterThan(catalog.length);
  });

  it("records OpenAI messages-envelope shape as diagnostics alongside the unchanged catalog check", () => {
    const result = inspectRequestShape({
      model: "fixture",
      messages: [{ role: "user", content: catalog }],
      tools: [{ type: "function", function: { name: "execute" } }],
      stream: true,
    });
    const normative = inspectNativeCatalogInstructions([{ role: "user", content: catalog }]);
    expect(result.requestShape.messagesIsArray).toBe(true);
    expect(result.requestShape.userParts).toBe(1);
    expect(result.requestShape.contentKinds.user.string).toBe(1);
    expect(result.requestShape.contentKinds.user.contentCharacters).toBe(catalog.length);
    expect(result.requestShape.executeCount).toBe(1);
    expect(result.markerFlags["# Code Mode"]).toBe(true);
    expect(result.messageMarkerFlags["context-mode_fixture"]).toBe(true);
    expect(normative.qualifyingRole).toBe("user");
  });

  it("records missing messages without accepting catalog text outside the messages envelope", () => {
    const result = inspectRequestShape({ system: catalog, tools: [{ function: { name: "execute" } }] });
    const normative = inspectNativeCatalogInstructions([]);
    expect(result.requestShape.messagesIsArray).toBe(false);
    expect(result.requestShape.fieldsPresent.messages).toBe(false);
    expect(result.markerFlags["# Code Mode"]).toBe(true);
    expect(result.messageMarkerFlags["# Code Mode"]).toBe(false);
    expect(normative.qualifyingRole).toBeUndefined();
  });
});

describe("native denial result classification", () => {
  it("preserves denial categories extracted from nested tool JSON strings", () => {
    const compactResults: Array<{ sources: unknown[]; failures: unknown[]; fetched?: unknown; denials?: unknown }> = [];
    extractCompactResults(
      JSON.stringify({
        sources: [],
        failures: [],
        fetched: { fixture: "native-fetch-ok" },
        denials: [
          { status: "rejected", classification: "unknown-tool" },
          { status: "rejected", classification: "permission-denied" },
        ],
      }),
      compactResults,
    );
    expect(denialClassifications(compactResults[0]?.denials)).toEqual(["unknown-tool", "permission-denied"]);
  });

  it("distinguishes unknown-tool, permission rejection, other errors, and success", () => {
    expect(
      denialClassifications([
        { status: "rejected", reason: { _tag: "ToolRuntimeError", kind: "UnknownTool" } },
        { status: "rejected", reason: { _tag: "PermissionRejected" } },
        { status: "rejected", reason: { message: "interpreter failure" } },
        { status: "fulfilled", value: "unexpected" },
      ]),
    ).toEqual(["unknown-tool", "permission-denied", "other-error", "unexpected-success"]);
  });
});

describe("native MCP setup barrier validation", () => {
  it("requires both fixture namespaces to report connected", () => {
    expect(
      validateMcpSetupStatus(
        {
          firecrawl_fixture: { status: "connected", connected: true },
          "context-mode_fixture": { status: "connected", connected: true },
        },
        RESEARCH_NAMESPACES,
      ).ready,
    ).toBe(true);
    expect(
      validateMcpSetupStatus(
        {
          firecrawl_fixture: { status: "connected", connected: true },
          "context-mode_fixture": { status: "unknown", connected: false },
        },
        RESEARCH_NAMESPACES,
      ).ready,
    ).toBe(false);
  });

  it("fails closed for failed or needs-auth status without exposing diagnostic payloads", () => {
    const result = validateMcpSetupStatus(
      {
        firecrawl_fixture: { status: "needs_auth", connected: false, error: "opaque detail" },
        "context-mode_fixture": { status: "connected", connected: true },
      },
      RESEARCH_NAMESPACES,
    );
    expect(result.failed).toBe(true);
    expect(result.statuses.firecrawl_fixture).toBe("needs_auth");
    expect(JSON.stringify(result)).not.toContain("opaque detail");
  });
});

function boundedServerClose(server: Server, graceMs = 1_000): Promise<boolean> {
  return new Promise((resolveClose) => {
    if (!server.listening) return resolveClose(true);
    let finished = false;
    const finish = (closed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(forceClose);
      clearTimeout(deadline);
      resolveClose(closed);
    };
    const forceClose = setTimeout(() => server.closeAllConnections(), graceMs);
    const deadline = setTimeout(() => finish(!server.listening), graceMs * 2);
    server.close(() => finish(true));
  });
}

async function waitForProcessGroupGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!processGroupGone(pid) && Date.now() < deadline)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  return processGroupGone(pid);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded_wait_expired")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractCompactResults(
  value: unknown,
  output: Array<{
    sources: unknown[];
    failures: unknown[];
    fetched?: unknown;
    denials?: unknown;
    intermediateCharacterCount?: unknown;
  }>,
): void {
  if (typeof value === "string") {
    try {
      extractCompactResults(JSON.parse(value) as unknown, output);
    } catch {
      // Only structured tool results are evidence for the compact payload.
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) extractCompactResults(child, output);
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.sources) && Array.isArray(value.failures))
    output.push({
      sources: value.sources,
      failures: value.failures,
      fetched: value.fetched,
      denials: value.denials,
      intermediateCharacterCount: value.intermediateCharacterCount,
    });
  for (const child of Object.values(value)) extractCompactResults(child, output);
}

function denialClassifications(
  value: unknown,
): Array<"unknown-tool" | "permission-denied" | "other-error" | "unexpected-success"> {
  const results: unknown[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) {
      if (typeof item === "string") {
        try {
          visit(JSON.parse(item) as unknown);
        } catch {
          // Only structured Promise.allSettled results are classified.
        }
      }
      return;
    }
    if (item.status === "rejected" || item.status === "fulfilled") results.push(item);
    else for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return results.map((item) => {
    if (!isRecord(item)) return "other-error";
    if (
      item.classification === "unknown-tool" ||
      item.classification === "permission-denied" ||
      item.classification === "other-error" ||
      item.classification === "unexpected-success"
    ) {
      return item.classification;
    }
    if (item.status !== "rejected") return "unexpected-success";
    const diagnostic = JSON.stringify(item.reason ?? "");
    if (/UnknownTool|unknown tool/iu.test(diagnostic)) return "unknown-tool";
    if (/PermissionRejected|permission denied|permissiondenied/iu.test(diagnostic)) return "permission-denied";
    return "other-error";
  });
}

function toolCallResponse(callId: string, code: string): string {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  return `${chunk({ role: "assistant", tool_calls: [{ index: 0, id: callId, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } }] })}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
}

function directFunctionCallResponse(callId: string, name: string, args: Record<string, unknown>): string {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  return `${chunk({ role: "assistant", tool_calls: [{ index: 0, id: callId, type: "function", function: { name, arguments: JSON.stringify(args) } }] })}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
}

function textResponse(text: string): string {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  return `${chunk({ role: "assistant" })}${chunk({ content: text })}${chunk({}, "stop")}data: [DONE]\n\n`;
}

afterEach(async () => {
  for (const isolation of OWNER_RUNS) await isolation.dispose();
  OWNER_RUNS.clear();
});

it.skipIf(!RUN_ENABLED)(
  "runs one native Code Mode research workflow through the production adapter and private child",
  async () => {
    const overall = new AbortController();
    const overallTimer = setTimeout(() => overall.abort(), TIMEOUT_MS);
    overallTimer.unref();
    const fork = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const projectRoot = await realpath(PROJECT_ROOT);
    const evidenceBase = resolve(projectRoot, "tmp/scribe-v2-migration/code-mode");
    await mkdir(evidenceBase, { recursive: true });
    await assertOwnedPath(projectRoot, evidenceBase);
    const runId = randomUUID();
    const runRoot = join(evidenceBase, runId);
    await mkdir(runRoot, { recursive: false });
    await assertOwnedPath(evidenceBase, runRoot);
    const evidencePath = join(runRoot, "result.json");
    const checks: Record<string, boolean> = {
      dedicatedVitestForkWithIpc: typeof fork.send === "function" && fork.connected === true,
    };
    const manifest: Manifest = {
      schemaVersion: 1,
      runId,
      status: "RUNNING",
      qualification: "PRODUCTION_ADAPTER_NATIVE_CODE_MODE_LOCAL_CM4_SUBSET",
      expectedVersion: EXPECTED_VERSION,
      sourceCommit: SOURCE_COMMIT,
      sourceCommitMeaning: "inspected-release-tag",
      clientPackage: "@opencode/client@2.1.0",
      executablePath: EXECUTABLE_INPUT && isAbsolute(EXECUTABLE_INPUT) ? resolve(EXECUTABLE_INPUT) : null,
      executableSha256: null,
      fixtureRoot: null,
      statePath: null,
      evidencePath: relative(projectRoot, evidencePath),
      bounds: {
        overallMs: TIMEOUT_MS,
        maxApiRequests: MAX_API_REQUESTS,
        maxModelRequests: MAX_MODEL_REQUESTS,
        maxMcpRequests: MAX_MCP_REQUESTS,
        maxSessions: 2,
        maxChildren: 2,
        maxSimultaneousChildren: 1,
      },
      checks,
      observations: {
        catalog: {
          roleMarkers: {},
          characterCounts: { system: 0, developer: 0, user: 0 },
        },
        compactSizeMeasurement: { intermediateCharacterCount: 0, compactCharacterCount: 0 },
        mcpSetupBarrier: { reads: 0, connectedReads: 0, bothConnected: false, settled: false, statuses: {} },
        mcpListResponse: { observed: false },
        nativeFetchFixture: { requestCount: 0, requestMatches: false },
        denialProbe: {
          resultCount: 0,
          rejectedCount: 0,
          unknownToolCount: 0,
          permissionDeniedCount: 0,
          otherErrorCount: 0,
          unexpectedSuccessCount: 0,
          nativeShellPostCount: 0,
          shellToolHistoryCount: 0,
          shellToolEventCount: 0,
        },
        nativeStopOutcome: null,
        nativeStopObservationCounts: { pathMatched: 0, dataRecord: 0, dataIDMatched: 0, validOutcome: 0 },
        stopToolStatus: null,
        stopToolIDMatchesSyntheticCall: false,
        stopToolEventBeforeAndAfterAbort: false,
      },
      counts: { apiRequests: 0, modelRequests: 0, mcpRequests: 0, sessions: 0 },
      terminalReads: 0,
      fixtureEvents: [],
      cleanup: {
        agentDisconnected: false,
        cleanupPromiseResolved: false,
        processGroupGone: null,
        nativeAgentDisconnected: false,
        nativeCleanupPromiseResolved: false,
        nativeProcessGroupGone: null,
        fixtureClosed: false,
        ownedStateAbsent: null,
        environmentRestored: false,
        fetchRestored: false,
      },
      stage: "preflight",
    };
    const persist = () => writeFile(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    let status: Status = "RUNNING";
    let isolation: V2TestIsolation | undefined;
    let agent: OpenCodeAgent | undefined;
    let mcpFixture: Awaited<ReturnType<typeof startFixture>> | undefined;
    let provider: Server | undefined;
    let providerClosed = false;
    let mcpFixtureClosed = false;
    let observedVersion: string | undefined;
    let privatePID: number | undefined;
    let nativePID: number | undefined;
    let nativeFetchURL = "";
    let observedWaitPaths: [string, string] | undefined;
    let apiRequests = 0;
    let ownedSessionID: string | undefined;
    let stopAbortObserved = false;
    let modelRequests = 0;
    let requestFailureCode: FailureCode | undefined;
    const events: AgentEvent[] = [];
    const originalFetch = globalThis.fetch;
    const originalEnvironment = { ...process.env };
    const writeModelResponse = (response: ServerResponse, content: string) => {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.end(content);
    };
    try {
      await persist();
      if (!checks.dedicatedVitestForkWithIpc) {
        requestFailureCode ??= "dedicated_vitest_fork_unproven";
        throw new Error("blocked_input");
      }
      if (!EXECUTABLE_INPUT || !isAbsolute(EXECUTABLE_INPUT)) {
        status = "BLOCKED";
        requestFailureCode ??= "explicit_executable_missing_or_relative";
        throw new Error("blocked_input");
      }
      try {
        manifest.executableSha256 = createHash("sha256")
          .update(await readFile(EXECUTABLE_INPUT))
          .digest("hex");
      } catch {
        status = "BLOCKED";
        requestFailureCode ??= "explicit_executable_unavailable";
        throw new Error("blocked_input");
      }
      isolation = await createV2TestIsolation(runRoot);
      OWNER_RUNS.add(isolation);
      manifest.fixtureRoot = relative(projectRoot, isolation.root);
      manifest.statePath = relative(projectRoot, isolation.paths.state);
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      checks.isolatedFreshOwnedFixture = true;
      const preflight = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      checks.ambientConfigGateClear = preflight.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.ambientConfigGateClear) {
        status = "BLOCKED";
        requestFailureCode ??= "ambient_preflight_blocked";
        throw new Error("blocked_preflight");
      }
      mcpFixture = await startFixture(MAX_MCP_REQUESTS);
      provider = createServer(async (request, response) => {
        if (request.method === "POST" && request.url === "/native-fetch-fixture") {
          let body = "";
          for await (const chunk of request) body += chunk;
          manifest.observations.nativeFetchFixture.requestCount += 1;
          manifest.observations.nativeFetchFixture.requestMatches =
            manifest.observations.nativeFetchFixture.requestMatches ||
            (request.headers["x-fixture"] === "native-fetch" && body === "synthetic fixture body");
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ fixture: "native-fetch-ok" }));
          return;
        }
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          response.writeHead(404).end();
          return;
        }
        if (modelRequests >= MAX_MODEL_REQUESTS) {
          requestFailureCode ??= "model_request_bound_exceeded";
          return response.writeHead(429).end();
        }
        modelRequests += 1;
        let raw = "";
        let size = 0;
        request.setEncoding("utf8");
        request.setTimeout(TIMEOUT_MS, () => request.destroy());
        request.on("data", (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size <= 512 * 1024) raw += chunk;
          else requestFailureCode ??= "model_body_limit_exceeded";
        });
        request.on("end", () => {
          if (size > 512 * 1024) return response.writeHead(413).end();
          let body: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(raw);
            if (!isRecord(parsed)) throw new Error();
            body = parsed;
          } catch {
            return response.writeHead(400).end();
          }
          if (modelRequests === 1) {
            const sizeMeasurement = measureFirstRequest(body);
            manifest.observations.nativeSizeMeasurement = {
              unit: "UTF-8 bytes and JavaScript string characters",
              ...sizeMeasurement,
              totalUtf8Bytes:
                sizeMeasurement.toolDefinitions.utf8Bytes + sizeMeasurement.systemDeveloperInstructions.utf8Bytes,
              totalCharacters:
                sizeMeasurement.toolDefinitions.characters + sizeMeasurement.systemDeveloperInstructions.characters,
            };
            manifest.observations.requestShape = inspectRequestShape(body);
            const names = functionNames(body.tools);
            const messages = Array.isArray(body.messages) ? body.messages : [];
            const catalog = inspectNativeCatalogInstructions(messages);
            manifest.observations.catalog.roleMarkers = catalog.roleMarkers;
            manifest.observations.catalog.characterCounts = catalog.characterCounts;
            checks.firstRequestHasNativeExecute = names.includes("execute");
            checks.firstRequestHasNoDirectMcpSchemas = !names.some((name) =>
              /^(firecrawl_fixture|context-mode_fixture)_(lookup|unavailable|wait)$/u.test(name),
            );
            checks.firstRequestDoesNotAdvertiseDeniedCalls = !names.some((name) =>
              /(^|\.)(shell|fixture_unknown_tool)$/u.test(name),
            );
            checks.firstRequestHasNativeCatalogInstructions = catalog.qualifyingRole !== undefined;
            if (
              !(
                checks.firstRequestHasNativeExecute &&
                checks.firstRequestHasNoDirectMcpSchemas &&
                checks.firstRequestDoesNotAdvertiseDeniedCalls &&
                checks.firstRequestHasNativeCatalogInstructions
              )
            ) {
              requestFailureCode ??= "native_catalog_contract_not_observed";
              return writeModelResponse(
                response,
                textResponse("The fixture did not observe the expected native catalog."),
              );
            }
            return writeModelResponse(
              response,
              toolCallResponse(
                "search-catalog",
                'return { firecrawl: search({namespace:"firecrawl_fixture",limit:20}), contextMode: search({namespace:"context-mode_fixture",limit:20}) };',
              ),
            );
          }
          if (modelRequests === 2) {
            const paths: Array<{ path: string; signature: string }> = [];
            extractSearchItems(latestToolResult(body.messages), paths);
            const expectedPaths = [
              "tools.firecrawl_fixture.lookup",
              "tools.firecrawl_fixture.unavailable",
              "tools.firecrawl_fixture.wait",
              'tools["context-mode_fixture"].lookup',
              'tools["context-mode_fixture"].unavailable',
              'tools["context-mode_fixture"].wait',
            ];
            const observedPaths = [...new Set(paths.map((item) => item.path))].sort();
            const exactCatalog =
              observedPaths.length === expectedPaths.length &&
              expectedPaths.every((path) => observedPaths.includes(path)) &&
              paths.length === expectedPaths.length &&
              paths.every(
                (item) => item.signature.startsWith(`${item.path}(`) && item.signature.includes("Promise<"),
              ) &&
              ["lookup", "unavailable", "wait"].every((tool) => {
                const firecrawl = paths.find((item) => item.path === `tools.firecrawl_fixture.${tool}`)?.signature;
                const contextMode = paths.find(
                  (item) => item.path === `tools["context-mode_fixture"].${tool}`,
                )?.signature;
                return (
                  firecrawl?.replace("tools.firecrawl_fixture", "tools.NAMESPACE") ===
                  contextMode?.replace('tools["context-mode_fixture"]', "tools.NAMESPACE")
                );
              });
            checks.sixFixturePathsAndExactSignaturesObserved = exactCatalog;
            const waitPaths = [
              paths.find(({ path }) => path === "tools.firecrawl_fixture.wait")?.path,
              paths.find(({ path }) => path === 'tools["context-mode_fixture"].wait')?.path,
            ];
            if (exactCatalog && waitPaths.every((path): path is string => typeof path === "string"))
              observedWaitPaths = [waitPaths[0]!, waitPaths[1]!];
            const lookupPaths = [expectedPaths[0]!, expectedPaths[3]!];
            const unavailablePath = expectedPaths[1]!;
            checks.secondRequestUsesObservedSearchResults =
              exactCatalog && paths.some(({ path }) => path === unavailablePath);
            if (!checks.secondRequestUsesObservedSearchResults) {
              requestFailureCode ??= "search_results_not_consumed";
              return writeModelResponse(
                response,
                textResponse("The fixture did not receive usable native search results."),
              );
            }
            const code = `const results = await Promise.allSettled([${lookupPaths[0]}({query:"synthetic research"}),${lookupPaths[1]}({query:"synthetic research"}),${unavailablePath}({}),(async () => await tools.shell({command:"printf forbidden-fixture"}))(),(async () => await tools.fixture_unknown_tool({}))()]); const fetched = await (await fetch(${JSON.stringify(nativeFetchURL)}, {method:"POST",headers:{"x-fixture":"native-fetch"},body:"synthetic fixture body"})).json(); const urls = new Map(); const failures = []; for (const result of results.slice(0,3)) { if (result.status === "rejected") { failures.push(String(result.reason)); continue; } const value = result.value; const items = Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : value; for (const item of Array.isArray(items) ? items : []) if (item && typeof item.url === "string" && !urls.has(item.url)) urls.set(item.url, {url:item.url,title:item.title}); } const denials = results.slice(3).map(result => { if (result.status === "fulfilled") return {status:result.status,classification:"unexpected-success"}; const error = String(result.reason); const classification = /UnknownTool|unknown tool/i.test(error) ? "unknown-tool" : /PermissionRejected|permission denied|permissiondenied/i.test(error) ? "permission-denied" : "other-error"; return {status:result.status,classification}; }); const intermediateCharacterCount = results.reduce((total,result) => total + (result.status === "fulfilled" ? JSON.stringify(result.value).length : String(result.reason).length),0) + JSON.stringify(fetched).length; return {sources:[...urls.values()],failures,fetched,denials,intermediateCharacterCount};`;
            return writeModelResponse(response, toolCallResponse("parallel-research", code));
          }
          if (modelRequests === 4) {
            if (!observedWaitPaths) {
              requestFailureCode ??= "search_results_not_consumed";
              return writeModelResponse(response, textResponse("Observed wait tools were unavailable."));
            }
            const code = `return await Promise.allSettled([${observedWaitPaths[0]}({}),${observedWaitPaths[1]}({})]);`;
            return writeModelResponse(response, toolCallResponse("stop-transport", code));
          }
          if (modelRequests === 5) {
            const directName = "firecrawl_fixture_lookup";
            const directDefinition = Array.isArray(body.tools)
              ? body.tools.find(
                  (tool) => isRecord(tool) && isRecord(tool.function) && tool.function.name === directName,
                )
              : undefined;
            const parameters =
              isRecord(directDefinition) && isRecord(directDefinition.function)
                ? directDefinition.function.parameters
                : undefined;
            const properties =
              isRecord(parameters) && isRecord(parameters.properties) ? parameters.properties : undefined;
            const required = isRecord(parameters) && Array.isArray(parameters.required) ? parameters.required : [];
            const expectedNames = RESEARCH_NAMESPACES.flatMap((namespace) => [
              `${namespace}_lookup`,
              `${namespace}_unavailable`,
              `${namespace}_wait`,
            ]);
            const observedNames = functionNames(body.tools);
            const directSize = measureFirstRequest(body);
            manifest.observations.directSizeMeasurement = {
              unit: "UTF-8 bytes and JavaScript string characters",
              ...directSize,
              totalUtf8Bytes: directSize.toolDefinitions.utf8Bytes + directSize.systemDeveloperInstructions.utf8Bytes,
              totalCharacters:
                directSize.toolDefinitions.characters + directSize.systemDeveloperInstructions.characters,
            };
            checks.directRequestAdvertisesAllSixExactFixtureTools =
              expectedNames.length === 6 &&
              expectedNames.every((name) => observedNames.includes(name)) &&
              observedNames.filter((name) => expectedNames.includes(name)).length === 6;
            checks.directLookupSchemaHasRequiredQuery =
              Array.isArray(required) &&
              required.includes("query") &&
              isRecord(properties?.query) &&
              properties.query.type === "string";
            checks.directRequestSizeExceedsNative =
              typeof manifest.observations.nativeSizeMeasurement?.totalUtf8Bytes === "number" &&
              manifest.observations.nativeSizeMeasurement.totalUtf8Bytes <
                manifest.observations.directSizeMeasurement.totalUtf8Bytes &&
              manifest.observations.nativeSizeMeasurement.totalCharacters <
                manifest.observations.directSizeMeasurement.totalCharacters;
            if (
              !(
                checks.directRequestAdvertisesAllSixExactFixtureTools &&
                checks.directLookupSchemaHasRequiredQuery &&
                checks.directRequestSizeExceedsNative
              )
            ) {
              requestFailureCode ??= "unexpected";
              return writeModelResponse(response, textResponse("Direct fixture schema or size comparison failed."));
            }
            return writeModelResponse(
              response,
              directFunctionCallResponse("direct-fixture-lookup", directName, { query: "synthetic research" }),
            );
          }
          if (modelRequests === 6) {
            const strings: string[] = [];
            extractStrings(latestToolResult(body.messages), strings);
            const result = strings.join("\n");
            checks.directToolResultContainsTwoFixtureSources =
              result.includes("https://fixture.invalid/source/shared") &&
              result.includes("https://fixture.invalid/source/firecrawl");
            if (!checks.directToolResultContainsTwoFixtureSources) {
              requestFailureCode ??= "compact_result_or_failure_missing";
              return writeModelResponse(response, textResponse("Direct fixture lookup result was missing."));
            }
            return writeModelResponse(response, textResponse("direct fixture result received"));
          }
          const compactResults: Array<{
            sources: unknown[];
            failures: unknown[];
            fetched?: unknown;
            denials?: unknown;
            intermediateCharacterCount?: unknown;
          }> = [];
          extractCompactResults(latestToolResult(body.messages), compactResults);
          const compactResult = compactResults[0];
          const intermediateCharacterCount = compactResult?.intermediateCharacterCount;
          const compactCharacterCount = compactResult ? JSON.stringify(compactResult).length : 0;
          if (typeof intermediateCharacterCount === "number") {
            manifest.observations.compactSizeMeasurement = {
              intermediateCharacterCount,
              compactCharacterCount,
            };
          }
          checks.compactResultSmallerThanIntermediates =
            typeof intermediateCharacterCount === "number" && compactCharacterCount < intermediateCharacterCount;
          const sourceURLs =
            compactResult?.sources.flatMap((source) =>
              isRecord(source) && typeof source.url === "string" ? [source.url] : [],
            ) ?? [];
          const citedURLs = [...new Set(sourceURLs)];
          checks.thirdRequestReceivedThreeUniqueSources =
            Boolean(compactResult) &&
            sourceURLs.length === 3 &&
            citedURLs.length === 3 &&
            compactResult!.sources.every(
              (source) => isRecord(source) && Object.keys(source).every((key) => key === "url" || key === "title"),
            );
          checks.thirdRequestReceivedExplicitFailure =
            compactResult?.failures.some((failure) => String(failure).includes("Fixture source unavailable")) ?? false;
          checks.thirdRequestReceivedNativeFetchResult =
            isRecord(compactResult?.fetched) && compactResult.fetched.fixture === "native-fetch-ok";
          const classifications = denialClassifications(compactResult?.denials);
          manifest.observations.denialProbe.resultCount = classifications.length;
          manifest.observations.denialProbe.rejectedCount = classifications.filter(
            (item) => item !== "unexpected-success",
          ).length;
          manifest.observations.denialProbe.unknownToolCount = classifications.filter(
            (item) => item === "unknown-tool",
          ).length;
          manifest.observations.denialProbe.permissionDeniedCount = classifications.filter(
            (item) => item === "permission-denied",
          ).length;
          manifest.observations.denialProbe.otherErrorCount = classifications.filter(
            (item) => item === "other-error",
          ).length;
          manifest.observations.denialProbe.unexpectedSuccessCount = classifications.filter(
            (item) => item === "unexpected-success",
          ).length;
          checks.thirdRequestReceivedTwoNativeRejections =
            classifications.length === 2 && manifest.observations.denialProbe.rejectedCount === 2;
          checks.thirdRequestObservedOnlyKnownDenialCategories =
            classifications.length === 2 &&
            classifications.every((item) => item === "unknown-tool" || item === "permission-denied");
          checks.nativeFetchFixtureObservedExactRequest =
            manifest.observations.nativeFetchFixture.requestCount === 1 &&
            manifest.observations.nativeFetchFixture.requestMatches;
          if (
            !(
              checks.thirdRequestReceivedThreeUniqueSources &&
              checks.thirdRequestReceivedExplicitFailure &&
              checks.thirdRequestReceivedNativeFetchResult &&
              checks.nativeFetchFixtureObservedExactRequest &&
              checks.thirdRequestReceivedTwoNativeRejections &&
              checks.thirdRequestObservedOnlyKnownDenialCategories &&
              checks.compactResultSmallerThanIntermediates
            )
          ) {
            requestFailureCode ??= "compact_result_or_failure_missing";
            return writeModelResponse(
              response,
              textResponse("The fixture did not receive the expected compact research and native fetch results."),
            );
          }
          const answer = `Research returned ${citedURLs.length} unique sources: ${citedURLs.join(", ")}. One source was explicitly unavailable: Fixture source unavailable.`;
          return writeModelResponse(response, textResponse(answer));
        });
      });
      const port = await listen(provider);
      nativeFetchURL = `http://127.0.0.1:${port}/native-fetch-fixture`;
      const configPath = join(isolation.paths.config, "opencode", "opencode.json");
      await writeFile(
        configPath,
        JSON.stringify({
          model: "fixture-provider/fixture-model",
          providers: {
            "fixture-provider": {
              name: "Local fixture",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: `http://127.0.0.1:${port}/v1` },
              models: { "fixture-model": { name: "Fixture model" } },
            },
          },
          plugin: [],
          mcp: {},
        }),
        { mode: 0o600 },
      );

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (new URL(url).pathname.startsWith("/api/")) {
          if (apiRequests >= MAX_API_REQUESTS) {
            requestFailureCode ??= "api_request_bound_exceeded";
            throw new Error("fixture_api_request_bound_exceeded");
          }
          apiRequests += 1;
        }
        const signals = [
          overall.signal,
          ...(init?.signal ? [init.signal] : []),
          ...(input instanceof Request ? [input.signal] : []),
        ];
        const response = await originalFetch(input, { ...init, signal: AbortSignal.any(signals) });
        const method = input instanceof Request ? input.method : (init?.method ?? "GET");
        if (
          method.toUpperCase() === "POST" &&
          ownedSessionID &&
          new URL(url).pathname === `/api/session/${encodeURIComponent(ownedSessionID)}/shell`
        ) {
          manifest.observations.denialProbe.nativeShellPostCount += 1;
        }
        if (method.toUpperCase() === "GET" && new URL(url).pathname === "/api/mcp") {
          const observation: NonNullable<Manifest["observations"]["mcpListResponse"]> = {
            observed: true,
            httpStatus: response.status,
          };
          const body: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          if (isRecord(body)) {
            observation.dataIsArray = Array.isArray(body.data);
            observation.locationIsObject = isRecord(body.location);
            observation.directoryMatchesOwnedFixture =
              isRecord(body.location) && body.location.directory === isolation!.paths.cwd;
          }
          manifest.observations.mcpListResponse = observation;
        }
        if (
          method.toUpperCase() === "GET" &&
          ownedSessionID &&
          new URL(url).pathname === `/api/session/${encodeURIComponent(ownedSessionID)}`
        ) {
          const counts = manifest.observations.nativeStopObservationCounts;
          counts.pathMatched += 1;
          const info: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          const observed = observeOwnedSessionInfo(info, ownedSessionID);
          if (observed.dataRecord) counts.dataRecord += 1;
          if (observed.idMatched) counts.dataIDMatched += 1;
          if (observed.outcome) {
            counts.validOutcome += 1;
            manifest.observations.nativeStopOutcome = observed.outcome;
          }
        }
        if (new URL(url).pathname === "/api/info" && response.ok) {
          const info: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          if (isRecord(info)) {
            if (typeof info.version === "string") observedVersion = info.version;
            if (typeof info.pid === "number") privatePID = info.pid;
          }
        }
        return response;
      }) as typeof fetch;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, isolation.environment);
      const spawnGate = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      checks.ambientGateImmediatelyBeforeSpawn = spawnGate.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.ambientGateImmediatelyBeforeSpawn) {
        status = "BLOCKED";
        requestFailureCode ??= "spawn_ambient_preflight_blocked";
        throw new Error("blocked_preflight");
      }
      for (const path of Object.values(isolation.paths)) await assertOwnedPath(isolation.root, path);
      if (overall.signal.aborted) {
        requestFailureCode ??= "overall_deadline_exceeded";
        throw new Error("overall_deadline_exceeded");
      }
      const createAgent = (directTools: boolean) =>
        new OpenCodeAgent({
          workspacePath: isolation!.paths.cwd,
          hostPaths: { config: join(isolation!.paths.config, "opencode"), state: isolation!.paths.state },
          backend: "sdk",
          sandbox: {
            mode: "off",
            enabled: false,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [isolation!.paths.cwd], readOnlyPaths: [] },
          },
          executable: { path: resolve(EXECUTABLE_INPUT!) },
          pluginSources: [],
          mcpOverlay: {
            mcp: {
              servers: Object.fromEntries(
                RESEARCH_NAMESPACES.map((namespace) => [
                  namespace,
                  {
                    type: "remote",
                    url: mcpFixture!.endpoints[namespace],
                    disabled: false,
                    ...(directTools ? { codemode: false } : {}),
                  },
                ]),
              ),
            },
          },
          mcpTransport: Object.fromEntries(RESEARCH_NAMESPACES.map((namespace) => [namespace, "http"])),
        });
      agent = createAgent(false);
      manifest.stage = "connect";
      agent.onEvent((event) => events.push(event));
      await agent.connect();
      checks.productionAdapterConnected = true;
      checks.exactPrivateChildVersionObserved = observedVersion === EXPECTED_VERSION;
      checks.privateChildPIDObserved = typeof privatePID === "number";
      manifest.stage = "catalog";
      const session = await agent.createSession("CM4 synthetic research");
      ownedSessionID = session.id;
      manifest.counts.sessions = 1;
      checks.oneSessionCreated = Boolean(session.id);
      const mcpSetup = await waitForMcpSetup(agent, RESEARCH_NAMESPACES, overall.signal);
      manifest.observations.mcpSetupBarrier = {
        reads: mcpSetup.reads,
        connectedReads: mcpSetup.connectedReads,
        bothConnected:
          Object.keys(mcpSetup.statuses).length === RESEARCH_NAMESPACES.length &&
          RESEARCH_NAMESPACES.every((namespace) => mcpSetup.statuses[namespace] === "connected"),
        settled: mcpSetup.ready,
        ...(mcpSetup.exceptionCategory ? { exceptionCategory: mcpSetup.exceptionCategory } : {}),
        ...(mcpSetup.clientErrorReason ? { clientErrorReason: mcpSetup.clientErrorReason } : {}),
        statuses: mcpSetup.statuses,
      };
      if (!mcpSetup.ready) {
        requestFailureCode ??= "mcp_setup_barrier_failed";
        throw new Error("mcp_setup_barrier_failed");
      }
      mcpFixture!.armLookupPair(RESEARCH_NAMESPACES);
      const freshEventStart = events.length;
      await agent.sendMessage(session.id, "Scout research synthetic catalog", { primaryAgent: "scout" });
      manifest.stage = "research";
      const deadline = Date.now() + TIMEOUT_MS;
      while (
        Date.now() < deadline &&
        !overall.signal.aborted &&
        (() => {
          const fresh = events.slice(freshEventStart);
          const busyIndex = fresh.findIndex(
            (event) =>
              event.type === "session.status" &&
              event.properties.sessionID === session.id &&
              event.properties.status.type === "busy",
          );
          const idleIndex = fresh.findIndex(
            (event, index) =>
              index > busyIndex &&
              event.type === "session.status" &&
              event.properties.sessionID === session.id &&
              event.properties.status.type === "idle",
          );
          const terminalFreshIdle = busyIndex >= 0 && idleIndex > busyIndex;
          if (requestFailureCode && terminalFreshIdle) return false;
          return modelRequests !== 3 || !terminalFreshIdle;
        })()
      )
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      if (overall.signal.aborted) requestFailureCode ??= "overall_deadline_exceeded";
      const messages = await agent.getMessages(session.id);
      manifest.observations.denialProbe.shellToolHistoryCount = messages.reduce(
        (count, message) =>
          count + message.parts.filter((part) => part.type === "tool" && part.tool === "shell").length,
        0,
      );
      manifest.observations.denialProbe.shellToolEventCount = events.filter(
        (event) =>
          event.type === "message.part.updated" &&
          event.properties.part.type === "tool" &&
          event.properties.part.tool === "shell",
      ).length;
      checks.noShellToolPartInHistoryOrEvents =
        manifest.observations.denialProbe.shellToolHistoryCount === 0 &&
        manifest.observations.denialProbe.shellToolEventCount === 0;
      const final = messages
        .flatMap(({ info, parts }) =>
          info.role === "assistant" ? parts.filter((part) => part.type === "text").map((part) => part.text) : [],
        )
        .at(-1);
      checks.modelMadeThreeRequests = modelRequests === 3;
      checks.finalAnswerDerivedFromObservedCompactResult =
        typeof final === "string" && final.includes("3 unique sources") && final.includes("Fixture source unavailable");
      checks.nativeHistoryContainsCitedAnswer =
        typeof final === "string" &&
        assistantHasText(messages, final) &&
        final.includes("Fixture source unavailable") &&
        [...new Set(final.match(/https:\/\/fixture\.invalid\/source\/[a-z-]+/gu) ?? [])].length === 3 &&
        [...(final.match(/https:\/\/fixture\.invalid\/source\/[a-z-]+/gu) ?? [])].length === 3;
      checks.nativeHistoryContainsCompletedResearchResult = messages.some(({ parts }) =>
        parts.some(
          (part) =>
            part.type === "tool" &&
            part.tool === "execute" &&
            part.state.status === "completed" &&
            JSON.stringify(part.state.output).includes("fixture.invalid/source/") &&
            JSON.stringify(part.state.output).includes("Fixture source unavailable"),
        ),
      );
      checks.adapterEmittedCompletedDomainToolPart = events.some(
        (event) =>
          event.type === "message.part.updated" &&
          event.properties.part.type === "tool" &&
          event.properties.part.tool === "execute" &&
          event.properties.part.state.status === "completed",
      );
      const researchExecuteParts = events.flatMap((event) =>
        event.type === "message.part.updated" &&
        event.properties.part.type === "tool" &&
        event.properties.part.tool === "execute"
          ? [event.properties.part]
          : [],
      );
      checks.nativeResearchProgressReceived = researchExecuteParts.some(
        (part) => nativeToolCallProgress(part).length > 0,
      );
      checks.adapterEmittedFinalText = events.some(
        (event) =>
          event.type === "message.part.updated" &&
          event.properties.part.type === "text" &&
          event.properties.part.text.includes("3 unique sources"),
      );
      const fixture = mcpFixture!;
      const lookupStarted = fixture.observations.filter(
        (event) => event.tool === "lookup" && event.event === "started",
      );
      checks.twoNamespaceLookupsStartedBeforeCompletion =
        lookupStarted.length === 2 && fixture.lookupStarted.length === 2;
      checks.fixtureLookupEventOrder =
        fixture.observations
          .filter((event) => event.tool === "lookup")
          .map((event) => event.event)
          .join(",") === "started,started,completed,completed";
      checks.fixtureObservedBothNamespaces = RESEARCH_NAMESPACES.every((namespace) =>
        fixture.observations.some((event) => event.namespace === namespace && event.method === "tools/call"),
      );
      if (checks.modelMadeThreeRequests && observedWaitPaths) {
        manifest.stage = "stop";
        const researchAssistantIDs = new Set(
          messages.filter(({ info }) => info.role === "assistant").map(({ info }) => info.id),
        );
        const stopProgressEventStart = events.length;
        await agent.sendMessage(session.id, "Stop the synthetic research operation.", { primaryAgent: "scout" });
        const waitStartDeadline = Date.now() + 5_000;
        while (
          Date.now() < waitStartDeadline &&
          !overall.signal.aborted &&
          (fixture.observations.filter((event) => event.tool === "wait" && event.event === "started").length < 2 ||
            new Set(
              events.slice(stopProgressEventStart).flatMap((event) =>
                event.type === "message.part.updated" &&
                event.properties.part.type === "tool" &&
                event.properties.part.tool === "execute"
                  ? nativeToolCallProgress(event.properties.part)
                      .filter((call) => call.status === "running" && NATIVE_WAIT_TOOL_NAMES.has(call.tool))
                      .map((call) => call.tool)
                  : [],
              ),
            ).size < NATIVE_WAIT_TOOL_NAMES.size)
        ) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        }
        const startedWaits = fixture.observations.filter((event) => event.tool === "wait" && event.event === "started");
        checks.stopBothNamespaceWaitsStarted =
          startedWaits.length === 2 &&
          RESEARCH_NAMESPACES.every((namespace) => startedWaits.some((event) => event.namespace === namespace));
        const runningWaitProgress = events
          .slice(stopProgressEventStart)
          .flatMap((event) =>
            event.type === "message.part.updated" &&
            event.properties.part.type === "tool" &&
            event.properties.part.tool === "execute"
              ? nativeToolCallProgress(event.properties.part).filter(
                  (call) => call.status === "running" && NATIVE_WAIT_TOOL_NAMES.has(call.tool),
                )
              : [],
          );
        checks.nativeProgressShowsBothWaitsRunningBeforeAbort =
          NATIVE_WAIT_TOOL_NAMES.size === 2 &&
          new Set(runningWaitProgress.map((call) => call.tool)).size === NATIVE_WAIT_TOOL_NAMES.size;
        if (!checks.nativeProgressShowsBothWaitsRunningBeforeAbort) {
          requestFailureCode ??= "stop_waits_not_started";
          throw new Error("native_progress_wait_evidence_missing");
        }
        if (!checks.stopBothNamespaceWaitsStarted) {
          requestFailureCode ??= "stop_waits_not_started";
          throw new Error("stop_waits_not_started");
        }
        const stopEventStart = events.length;
        checks.stopToolEventBeforeAndAfterAbort = false;
        checks.stopToolEventBeforeAbort = events.some(
          (event) =>
            event.type === "message.part.updated" &&
            event.properties.part.type === "tool" &&
            event.properties.part.callID === "stop-transport" &&
            event.properties.part.state.status === "running",
        );
        try {
          await agent.abortSession(session.id);
          stopAbortObserved = true;
        } catch {
          requestFailureCode ??= "stop_abort_failed";
          throw new Error("stop_abort_failed");
        }
        const eventsAtAbort = events.length;
        const cancellationDeadline = Date.now() + 3_000;
        while (
          Date.now() < cancellationDeadline &&
          !overall.signal.aborted &&
          fixture.observations.filter((event) => event.tool === "wait" && event.event === "cancelled").length < 2
        ) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        }
        const cancelledWaits = fixture.observations.filter(
          (event) => event.tool === "wait" && event.event === "cancelled",
        );
        checks.stopBothWaitsCancelledBeforeTeardown =
          cancelledWaits.length === 2 &&
          RESEARCH_NAMESPACES.every((namespace) => cancelledWaits.some((event) => event.namespace === namespace));
        if (!checks.stopBothWaitsCancelledBeforeTeardown) {
          requestFailureCode ??= "stop_waits_not_cancelled";
          throw new Error("stop_waits_not_cancelled");
        }
        const terminalDeadline = Date.now() + 3_000;
        let terminalReads = 0;
        while (
          terminalReads < 10 &&
          Date.now() < terminalDeadline &&
          apiRequests < MAX_API_REQUESTS &&
          manifest.observations.nativeStopOutcome !== "interrupted"
        ) {
          terminalReads += 1;
          manifest.observations.nativeStopOutcome = null;
          await agent.getSession(session.id);
          manifest.observations.nativeStopOutcome ??= null;
          if (manifest.observations.nativeStopOutcome === null && Date.now() < terminalDeadline) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(100, terminalDeadline - Date.now())));
          }
        }
        manifest.terminalReads = terminalReads;
        const stopParts = (await agent.getMessages(session.id)).flatMap(({ parts }) =>
          parts.filter((part) => part.type === "tool" && part.callID === "stop-transport"),
        );
        const stopPart = stopParts.at(-1);
        manifest.observations.stopToolStatus =
          stopPart?.type === "tool"
            ? stopPart.state.status === "error"
              ? "error"
              : stopPart.state.status === "completed"
                ? "completed"
                : "other"
            : null;
        manifest.observations.stopToolIDMatchesSyntheticCall =
          stopPart?.type === "tool" && stopPart.callID === "stop-transport";
        checks.stopToolEventBeforeAndAfterAbort =
          Boolean(checks.stopToolEventBeforeAbort) &&
          stopAbortObserved &&
          events
            .slice(stopEventStart)
            .some(
              (event) =>
                event.type === "message.part.updated" &&
                event.properties.part.type === "tool" &&
                event.properties.part.callID === "stop-transport" &&
                event.properties.part.state.status === "error",
            );
        manifest.observations.stopToolEventBeforeAndAfterAbort = checks.stopToolEventBeforeAndAfterAbort;
        checks.nativeSessionOutcomeInterrupted = manifest.observations.nativeStopOutcome === "interrupted";
        checks.nativeStopToolIsError =
          manifest.observations.stopToolStatus === "error" && manifest.observations.stopToolIDMatchesSyntheticCall;
        const terminalMessages = await agent.getMessages(session.id);
        const newAssistantMessages = terminalMessages.filter(
          ({ info }) => info.role === "assistant" && !researchAssistantIDs.has(info.id),
        );
        checks.noNewAssistantTextAfterAbort = newAssistantMessages.every(
          ({ parts }) => !parts.some((part) => part.type === "text" && part.text.trim().length > 0),
        );
        const stopToolMessage = terminalMessages.find(({ parts }) =>
          parts.some((part) => part.type === "tool" && part.callID === "stop-transport"),
        );
        checks.stopToolMessageHasNoFinalText =
          Boolean(stopToolMessage) &&
          !stopToolMessage!.parts.some((part) => part.type === "text" && part.text.trim().length > 0);
        if (
          !(
            checks.nativeSessionOutcomeInterrupted &&
            checks.nativeStopToolIsError &&
            checks.stopToolEventBeforeAndAfterAbort &&
            checks.noNewAssistantTextAfterAbort &&
            checks.stopToolMessageHasNoFinalText
          )
        ) {
          requestFailureCode ??= "stop_terminal_history_missing";
          throw new Error("stop_terminal_history_missing");
        }
        fixture.releaseWaits();
        await new Promise<void>((resolveBarrier) => setImmediate(resolveBarrier));
        checks.noWaitCompletedAfterRelease =
          fixture.observations.filter((event) => event.tool === "wait" && event.event === "completed").length === 0;
        const afterStopMessages = await agent.getMessages(session.id);
        const afterStopNewAssistantMessages = afterStopMessages.filter(
          ({ info }) => info.role === "assistant" && !researchAssistantIDs.has(info.id),
        );
        const afterReleaseStopToolParts = afterStopMessages.flatMap(({ parts }) =>
          parts.filter((part) => part.type === "tool" && part.callID === "stop-transport"),
        );
        checks.stopToolRemainsErrorAfterRelease = afterReleaseStopToolParts.some(
          (part) => part.type === "tool" && part.state.status === "error",
        );
        checks.noCompletedStopToolInNativeHistoryAfterRelease = !afterReleaseStopToolParts.some(
          (part) => part.type === "tool" && part.state.status === "completed",
        );
        const afterStopEvents = events.slice(eventsAtAbort);
        checks.noStaleStopTextOrSuccess =
          afterStopNewAssistantMessages.every(
            ({ parts }) => !parts.some((part) => part.type === "text" && part.text.trim().length > 0),
          ) &&
          !afterStopEvents.some(
            (event) =>
              (event.type === "message.part.delta" && event.properties.delta.length > 0) ||
              (event.type === "message.part.updated" &&
                ((event.properties.part.type === "tool" &&
                  event.properties.part.callID === "stop-transport" &&
                  event.properties.part.state.status === "completed") ||
                  (event.properties.part.type === "text" && event.properties.part.text.trim().length > 0))),
          );
        checks.stopModelRequestCountExactlyFour = modelRequests === 4;
        if (!checks.noWaitCompletedAfterRelease) {
          requestFailureCode ??= "stop_wait_completed_after_release";
          throw new Error("stop_wait_completed_after_release");
        }
      } else {
        checks.stopBothNamespaceWaitsStarted = false;
        checks.stopBothWaitsCancelledBeforeTeardown = false;
        checks.noWaitCompletedAfterRelease = false;
        checks.stopModelRequestCountExactlyFour = false;
      }
      checks.requestBounds =
        apiRequests <= MAX_API_REQUESTS &&
        modelRequests <= MAX_MODEL_REQUESTS &&
        (mcpFixture?.requestCount ?? 0) <= MAX_MCP_REQUESTS;
      checks.noNativeSessionShellPost = manifest.observations.denialProbe.nativeShellPostCount === 0;
      checks.privateServerVersionObserved = observedVersion === EXPECTED_VERSION && typeof privatePID === "number";
      if (Object.values(checks).every(Boolean) && modelRequests === 4 && manifest.counts.sessions === 1) {
        manifest.stage = "connect";
        nativePID = privatePID;
        try {
          agent.disconnect();
          manifest.cleanup.nativeAgentDisconnected = true;
          const cleanupPromise = (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise;
          if (cleanupPromise) {
            await withTimeout(cleanupPromise, 5_000);
            manifest.cleanup.nativeCleanupPromiseResolved = true;
          } else requestFailureCode ??= "adapter_cleanup_promise_unavailable";
        } catch {
          requestFailureCode ??= "adapter_disconnect_failed";
        }
        manifest.cleanup.nativeProcessGroupGone =
          nativePID === undefined ? null : await waitForProcessGroupGone(nativePID, 3_000);
        if (
          !manifest.cleanup.nativeAgentDisconnected ||
          !manifest.cleanup.nativeCleanupPromiseResolved ||
          manifest.cleanup.nativeProcessGroupGone !== true
        ) {
          requestFailureCode ??= "owned_process_group_not_reaped";
          throw new Error("native_child_not_reaped_before_direct_child");
        }
        privatePID = undefined;
        agent = undefined;
        mcpFixture!.releaseLookupPair();
        const directFixtureEventStart = mcpFixture!.observations.length;
        observedVersion = undefined;
        privatePID = undefined;
        agent = createAgent(true);
        agent.onEvent((event) => events.push(event));
        await agent.connect();
        checks.directPrivateChildVersionObserved = observedVersion === EXPECTED_VERSION;
        checks.directPrivateChildPIDObserved = typeof privatePID === "number" && privatePID !== nativePID;
        const directSession = await agent.createSession("CM4 synthetic direct-tool comparison");
        manifest.counts.sessions += 1;
        const directMcpSetup = await waitForMcpSetup(agent, RESEARCH_NAMESPACES, overall.signal);
        manifest.observations.directMcpSetupBarrier = {
          reads: directMcpSetup.reads,
          connectedReads: directMcpSetup.connectedReads,
          bothConnected:
            Object.keys(directMcpSetup.statuses).length === RESEARCH_NAMESPACES.length &&
            RESEARCH_NAMESPACES.every((namespace) => directMcpSetup.statuses[namespace] === "connected"),
          settled: directMcpSetup.ready,
          statuses: directMcpSetup.statuses,
        };
        checks.directMcpSetupReady = directMcpSetup.ready;
        if (!directMcpSetup.ready) {
          requestFailureCode ??= "mcp_setup_barrier_failed";
          throw new Error("direct_mcp_setup_barrier_failed");
        }
        const directEventStart = events.length;
        await agent.sendMessage(directSession.id, "Scout research synthetic catalog", { primaryAgent: "scout" });
        const directDeadline = Date.now() + TIMEOUT_MS;
        while (Date.now() < directDeadline && !overall.signal.aborted) {
          const fresh = events.slice(directEventStart);
          const busyIndex = fresh.findIndex(
            (event) =>
              event.type === "session.status" &&
              event.properties.sessionID === directSession.id &&
              event.properties.status.type === "busy",
          );
          const idleIndex = fresh.findIndex(
            (event, index) =>
              index > busyIndex &&
              event.type === "session.status" &&
              event.properties.sessionID === directSession.id &&
              event.properties.status.type === "idle",
          );
          const terminalFreshIdle = busyIndex >= 0 && idleIndex > busyIndex;
          if (requestFailureCode && terminalFreshIdle) break;
          if (Number(modelRequests) === 6 && busyIndex >= 0 && idleIndex > busyIndex) break;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
        const directMessages = await agent.getMessages(directSession.id);
        checks.directModelMadeExactlyTwoRequests = Number(modelRequests) === 6;
        checks.directHistoryContainsCompletedLookup = directMessages.some(({ parts }) =>
          parts.some(
            (part) =>
              part.type === "tool" && part.tool === "firecrawl_fixture_lookup" && part.state.status === "completed",
          ),
        );
        checks.directHistoryContainsConfirmationText = assistantHasText(
          directMessages,
          "direct fixture result received",
        );
        checks.directAdapterEmittedConfirmationText = events
          .slice(directEventStart)
          .some(
            (event) =>
              event.type === "message.part.updated" &&
              event.properties.part.type === "text" &&
              event.properties.part.text === "direct fixture result received",
          );
        checks.directFixtureLookupObservedExactlyOnce = hasExactlyOneFixtureLookup(
          mcpFixture!.observations,
          directFixtureEventStart,
        );
      }
      checks.twoSequentialSessionsCreated = manifest.counts.sessions === 2;
      checks.expectedCombinedMcpRequestCount = mcpFixture?.requestCount === MAX_MCP_REQUESTS;
      checks.modelRequestBoundAndExactTotal = modelRequests === 6 && modelRequests <= MAX_MODEL_REQUESTS;
      checks.requestBounds =
        apiRequests <= MAX_API_REQUESTS &&
        modelRequests <= MAX_MODEL_REQUESTS &&
        (mcpFixture?.requestCount ?? 0) <= MAX_MCP_REQUESTS;
      checks.privateServerVersionObserved = observedVersion === EXPECTED_VERSION && typeof privatePID === "number";
      manifest.stage = "history";
      status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
    } catch (error) {
      if (status !== "BLOCKED") status = "FAIL";
      requestFailureCode ??= "unexpected";
    } finally {
      manifest.counts = {
        apiRequests,
        modelRequests,
        mcpRequests: mcpFixture?.requestCount ?? 0,
        sessions: manifest.counts.sessions,
      };
      manifest.fixtureEvents = (mcpFixture?.observations ?? []).map(({ method, namespace, tool, event }) => ({
        method,
        ...(namespace ? { namespace } : {}),
        ...(tool ? { tool } : {}),
        ...(event ? { event } : {}),
      }));
      manifest.status = status;
      if (requestFailureCode) manifest.failureCode = requestFailureCode;
      try {
        await persist();
      } catch {
        status = "FAIL";
        requestFailureCode ??= "unexpected";
      }
      if (agent) {
        try {
          agent.disconnect();
          const cleanupPromise = (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise;
          if (cleanupPromise) {
            await withTimeout(cleanupPromise, 5_000);
            manifest.cleanup.cleanupPromiseResolved = true;
            manifest.cleanup.agentDisconnected = true;
          } else requestFailureCode ??= "adapter_cleanup_promise_unavailable";
        } catch {
          requestFailureCode ??= "adapter_disconnect_failed";
        }
      }
      manifest.cleanup.processGroupGone =
        privatePID === undefined ? null : await waitForProcessGroupGone(privatePID, 3_000);
      if (manifest.cleanup.processGroupGone === false) requestFailureCode ??= "owned_process_group_not_reaped";
      if (provider) {
        try {
          providerClosed = await boundedServerClose(provider);
        } catch {
          requestFailureCode ??= "fixture_close_failed";
        }
      }
      if (mcpFixture) {
        try {
          await mcpFixture.close();
          mcpFixtureClosed = true;
        } catch {
          requestFailureCode ??= "fixture_close_failed";
        }
      }
      if (isolation) {
        try {
          await isolation.dispose();
          manifest.cleanup.ownedStateAbsent = (await absent(isolation.paths.state)) && (await absent(isolation.root));
          OWNER_RUNS.delete(isolation);
        } catch {
          manifest.cleanup.ownedStateAbsent = false;
          requestFailureCode ??= "owned_isolation_cleanup_failed";
        }
      }
      try {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, originalEnvironment);
        manifest.cleanup.environmentRestored = Object.keys({ ...originalEnvironment, ...process.env }).every(
          (key) => originalEnvironment[key] === process.env[key],
        );
      } catch {
        requestFailureCode ??= "unexpected";
      } finally {
        globalThis.fetch = originalFetch;
        manifest.cleanup.fetchRestored = globalThis.fetch === originalFetch;
        clearTimeout(overallTimer);
      }
      manifest.observedVersion = observedVersion;
      manifest.observedPrivateChildPid = privatePID;
      manifest.cleanup.fixtureClosed = providerClosed && mcpFixtureClosed;
      manifest.status = status;
      if (manifest.status === "PASS" && !Object.values(manifest.cleanup).every((value) => value === true)) {
        manifest.status = "FAIL";
        requestFailureCode ??= "unexpected";
      }
      if (requestFailureCode) manifest.failureCode = requestFailureCode;
      await persist();
    }

    const result = JSON.parse(await readFile(evidencePath, "utf8")) as Manifest;
    expect(result.status).toBe("PASS");
    expect(result.sourceCommit).toBe(SOURCE_COMMIT);
    expect(result.clientPackage).toBe("@opencode/client@2.1.0");
    expect(result.executableSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.counts.apiRequests).toBeLessThanOrEqual(MAX_API_REQUESTS);
    expect(result.counts.modelRequests).toBeLessThanOrEqual(MAX_MODEL_REQUESTS);
    expect(result.observations.stopToolEventBeforeAndAfterAbort).toBe(result.checks.stopToolEventBeforeAndAfterAbort);
    expect(await realpath(dirname(evidencePath))).toBe(dirname(evidencePath));
  },
  TIMEOUT_MS + 12_000,
);
