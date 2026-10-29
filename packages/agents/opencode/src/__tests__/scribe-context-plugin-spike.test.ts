import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OpenCodeClient } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent.js";
import { PrivateV2ServerError } from "../private-v2-server.js";
import {
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_MAX_STEPS,
  RESTRICTED_REVIEW_PROMPT,
} from "../restricted-review-overlay.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const ENABLED = process.env.OPENCODE_CHAT_RUN_V2_CONTEXT_SPIKE === "1";
const EXECUTABLE_INPUT = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const EXPECTED_EXECUTABLE = "/opt/homebrew/Cellar/opencode-v2/2.2.0/bin/opencode";
const EXPECTED_EXECUTABLE_SHA256 = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const EXPECTED_VERSION = "2.2.0";
const EXPECTED_CLIENT = "@opencode/client@2.1.0";
const EXPECTED_CLIENT_VERSION = "2.1.0";
const CONTEXT_PLUGIN_ID = "fixture.scribe-context-plugin-spike";
const THROWING_PLUGIN_ID = "fixture.scribe-context-plugin-spike.throwing-hook";
const RPC_ID = "scribe_context_spike";
const NATIVE_THROW_RPC_ID = "scribe_native_throw_spike";
const EVIDENCE_DIRECTORY = "tmp/scribe-v2-migration/context-spike";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/result.json`;
const OVERALL_TIMEOUT_MS = 90_000;
const MAX_PRIVATE_REQUESTS = 256;
const MAX_PROVIDER_REQUESTS = 32;
const MAX_PROVIDER_BODY_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_BRIEF_BYTES = 256;
const MAX_ACTIVE_BRIEFS = 16;
const PROMPT_TIMEOUT_MS = 10_000;
const MAX_KEY_BYTES = 128;
// OpenCode 2.1.4 disables JSON Schema pattern validation; the plugin handler enforces the key regex.
const RPC_DEFINITION = {
  id: RPC_ID,
  events: {},
  methods: {
    put: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: 128 },
          turnID: { type: "string", minLength: 1, maxLength: 128 },
          brief: { type: "string", minLength: 1, maxLength: MAX_BRIEF_BYTES },
        },
        required: ["sessionID", "turnID", "brief"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { accepted: { type: "boolean" } },
        required: ["accepted"],
        additionalProperties: false,
      },
    },
    clear: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: 128 },
          turnID: { type: "string", minLength: 1, maxLength: 128 },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { cleared: { type: "integer", minimum: 0 } },
        required: ["cleared"],
        additionalProperties: false,
      },
    },
    inspect: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string", minLength: 1, maxLength: 128 } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          storedEntries: { type: "integer", minimum: 0, maximum: MAX_ACTIVE_BRIEFS },
          sessionEntries: { type: "integer", minimum: 0, maximum: MAX_ACTIVE_BRIEFS },
          hasActiveTurn: { type: "boolean" },
          promptBindings: { type: "integer", minimum: 0 },
          idleClears: { type: "integer", minimum: 0 },
          hookCalls: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          hookInternalExceptions: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          calls: {
            type: "array",
            maxItems: 32,
            items: {
              type: "object",
              properties: {
                agent: { type: ["string", "null"] },
                turnBound: { type: "boolean" },
                briefApplied: { type: "boolean" },
                hookThrew: { type: "boolean" },
              },
              required: ["agent", "turnBound", "briefApplied", "hookThrew"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "storedEntries",
          "sessionEntries",
          "hasActiveTurn",
          "promptBindings",
          "idleClears",
          "hookCalls",
          "hookInternalExceptions",
          "calls",
        ],
        additionalProperties: false,
      },
    },
    armThrow: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { armed: { type: "boolean" } },
        required: ["armed"],
        additionalProperties: false,
      },
    },
  },
} as const;
const NATIVE_THROW_RPC_DEFINITION = {
  id: NATIVE_THROW_RPC_ID,
  events: {},
  methods: {
    armThrow: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { armed: { type: "boolean" } },
        required: ["armed"],
        additionalProperties: false,
      },
    },
  },
} as const;

const FIXTURE_MARKERS = {
  scout: "SYNTHETIC_CONTEXT_SCOUT",
  write: "SYNTHETIC_CONTEXT_WRITE",
  hidden: "SYNTHETIC_CONTEXT_HIDDEN",
  next: "SYNTHETIC_CONTEXT_NEXT",
  failureHook: "SYNTHETIC_CONTEXT_THROW_HOOK",
  defensiveFailure: "SYNTHETIC_CONTEXT_DEFENSIVE_FAILURE_TURN",
  defensiveFollowup: "SYNTHETIC_CONTEXT_DEFENSIVE_FOLLOWUP_TURN",
  crossSession: "SYNTHETIC_CONTEXT_SESSION_B",
  stale: "SYNTHETIC_CONTEXT_STALE_TURN",
  stop: "SYNTHETIC_CONTEXT_STOP_ABORT",
  afterFailure: "SYNTHETIC_CONTEXT_AFTER_HOOK_FAILURE",
  reconnect: "SYNTHETIC_CONTEXT_RECONNECT_BRIEF_TURN",
  reconnectNoBrief: "SYNTHETIC_CONTEXT_RECONNECT_NO_BRIEF_TURN",
  reconnectNewSession: "SYNTHETIC_CONTEXT_RECONNECT_NEW_SESSION_TURN",
  skillDeniedProbe: "SYNTHETIC_CONTEXT_SKILL_DENIED_PROBE",
  generate: ["SYNTHETIC_CLASSIFIER_GENERATE_A", "SYNTHETIC_CLASSIFIER_GENERATE_B", "SYNTHETIC_CLASSIFIER_GENERATE_C"],
  scoutGenerate: ["SYNTHETIC_SCOUT_GENERATE_A", "SYNTHETIC_SCOUT_GENERATE_B", "SYNTHETIC_SCOUT_GENERATE_C"],
  hiddenClassify: ["SYNTHETIC_CLASSIFIER_HIDDEN_A", "SYNTHETIC_CLASSIFIER_HIDDEN_B", "SYNTHETIC_CLASSIFIER_HIDDEN_C"],
} as const;
const BRIEF_MARKERS = {
  scout: "SYNTHETIC_BRIEF_SCOUT",
  stale: "SYNTHETIC_BRIEF_STALE",
  stop: "SYNTHETIC_BRIEF_STOP",
  reconnect: "SYNTHETIC_BRIEF_RECONNECT",
  defensive: "SYNTHETIC_BRIEF_DEFENSIVE_FAILURE",
} as const;

type Verdict = "PASS" | "FAIL" | "UNPROVEN";
type CriterionName = "a" | "b" | "c" | "d" | "e" | "f";
type PluginStatus = "active" | "failed" | "absent" | "other";
type TurnTerminal = "idle" | "error" | "timeout" | "unobserved";
type FixedErrorClass =
  | "Error"
  | "TypeError"
  | "AbortError"
  | "TimeoutError"
  | "APIError"
  | "FetchError"
  | "InvalidRequestError"
  | "ProviderAuthError"
  | "ProviderModelNotFoundError"
  | "SessionBusyError"
  | "SessionNotFoundError"
  | "UnknownError";
type RequestGroup =
  | "scout"
  | "write"
  | "hidden"
  | "failureHook"
  | "defensiveFailure"
  | "defensiveFollowup"
  | "next"
  | "crossSession"
  | "stale"
  | "stop"
  | "afterFailure"
  | "reconnect"
  | "reconnectNoBrief"
  | "reconnectNewSession"
  | "skillDeniedProbe"
  | "generate"
  | "scoutGenerate"
  | "hiddenClassify"
  | "other";
const REQUEST_GROUPS = [
  "failureHook",
  "defensiveFailure",
  "defensiveFollowup",
  "afterFailure",
  "hiddenClassify",
  "scoutGenerate",
  "reconnect",
  "reconnectNoBrief",
  "reconnectNewSession",
  "skillDeniedProbe",
  "next",
  "crossSession",
  "stop",
  "scout",
  "write",
  "hidden",
  "stale",
  "generate",
  "other",
] as const satisfies readonly RequestGroup[];
type RequestObservation = {
  group: RequestGroup;
  bodyBytes: number;
  toolDefinitionCount: number;
  noToolDefinitions: boolean;
  toolDefinitionNames: string[] | null;
  toolDefinitionsValid: boolean;
  briefScout: boolean;
  briefStale: boolean;
  briefStop: boolean;
  briefReconnect: boolean;
  briefDefensive: boolean;
};
type ContextCall = {
  agent: string | null;
  turnBound: boolean;
  briefApplied: boolean;
  hookThrew: boolean;
};
type PluginInspection = {
  storedEntries: number;
  sessionEntries: number;
  hasActiveTurn: boolean;
  promptBindings: number;
  idleClears: number;
  hookCalls: number;
  hookInternalExceptions: number;
  calls: ContextCall[];
};
type MessageSummary = {
  messageCount: number;
  roleCounts: { assistant: number; user: number; system: number; synthetic: number; other: number };
  assistantMessageExists: boolean;
  assistantErrorClass: FixedErrorClass | null;
};
type MessageReadResult = {
  summary: MessageSummary | null;
  errorClass: FixedErrorClass | null;
};
type TurnOutcome = {
  completed: boolean;
  terminal: TurnTerminal;
  errorClass: FixedErrorClass | null;
};
type ReconnectProbe = {
  completed: boolean;
  terminal: TurnTerminal;
  messages: MessageSummary | null;
  messageReadErrorClass: FixedErrorClass | null;
  pluginEntryClearedBeforePrompt: boolean;
  briefWasEverPut: boolean;
  providerRequestOccurred: boolean;
  briefObservedByProvider: boolean | null;
  providerConfigMatchesMockOrigin: boolean;
  mockProviderListening: boolean;
  hookCallsBefore: number | null;
  hookCallsAfter: number | null;
  hookInternalExceptionsBefore: number | null;
  hookInternalExceptionsAfter: number | null;
};
type ReconnectHealth = {
  privateServerReady: boolean;
  providerConfigMatchesMockOrigin: boolean;
  mockProviderListening: boolean;
  contextPluginActive: boolean;
  throwingPluginActive: boolean;
};
type Manifest = {
  schemaVersion: 2;
  runId: string;
  status: "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
  expectedVersion: string;
  observedVersion: string | null;
  expectedExecutableSha256: string;
  observedExecutableSha256: string | null;
  executablePathMatchesPin: boolean;
  expectedClient: string;
  observedClient: string | null;
  evidencePath: string;
  fixtureRoot: string;
  pluginSourceLoadedFromPrivateOverlay: boolean | null;
  bundledFixtureDirectoryLoaded: boolean | null;
  privateOriginAuthenticated: boolean | null;
  selectedClassificationPath: "session.generate" | "hidden-session" | null;
  launch: { backend: "sdk"; sandboxMode: "off"; loopbackOnly: true; privateChildReady: boolean | null };
  criteria: Record<CriterionName, Verdict>;
  checks: Record<string, boolean | null>;
  failureDiagnostics: {
    nativeUncaughtThrow: {
      contextStateAfterFailure: PluginStatus | null;
      failingHookStateAfterFailure: PluginStatus | null;
      failureTurnCompleted: boolean | null;
      failureTurnTerminal: TurnTerminal;
      failureTurnErrorClass: FixedErrorClass | null;
      failureTurnProviderRequestOccurred: boolean | null;
      postFailureCompleted: boolean | null;
      postFailureTerminal: TurnTerminal;
      postFailureErrorClass: FixedErrorClass | null;
      privateReadyAfterHookFailure: boolean | null;
      messages: MessageSummary | null;
      messageReadErrorClass: FixedErrorClass | null;
    };
    defensiveFailOpen: {
      contextStateAfterFailure: PluginStatus | null;
      hookInternalFailureObserved: boolean | null;
      hookCallsAfterFailure: number | null;
      hookInternalExceptionsAfterFailure: number | null;
      otherPluginStateAfterFailure: PluginStatus | null;
      failureTurnCompleted: boolean | null;
      failureTurnTerminal: TurnTerminal;
      failureTurnErrorClass: FixedErrorClass | null;
      failureTurnProviderRequestOccurred: boolean | null;
      postFailureCompleted: boolean | null;
      postFailureTerminal: TurnTerminal;
      postFailureErrorClass: FixedErrorClass | null;
      postFailureProviderRequestOccurred: boolean | null;
      privateReadyAfterFailure: boolean | null;
    };
  };
  reconnectDiagnostics: {
    briefPendingBeforeReconnect: boolean | null;
    pluginEntryClearedAfterReconnect: boolean | null;
    promptCompleted: boolean | null;
    promptTerminal: TurnTerminal;
    hookCalledAfterReconnect: boolean | null;
    briefAppliedAfterReconnect: boolean | null;
    providerRequestOccurred: boolean | null;
    briefObservedByProvider: boolean | null;
    messages: MessageSummary | null;
    messageReadErrorClass: FixedErrorClass | null;
    providerConfigMatchesMockOrigin: boolean | null;
    mockProviderListening: boolean | null;
    hookCallsBeforePrompt: number | null;
    hookCallsAfterPrompt: number | null;
    hookInternalExceptionsBeforePrompt: number | null;
    hookInternalExceptionsAfterPrompt: number | null;
  };
  reconnectBisection: {
    noBriefExistingSession: ReconnectProbe | null;
    newSession: ReconnectProbe | null;
  };
  failureStage: string | null;
  failureErrorClass: FixedErrorClass | null;
  counts: {
    privateApiRequests: number;
    rpcRequests: number;
    providerRequests: number;
    sessionsCreated: number;
    maxProviderBodyBytes: number;
    requestGroupCounts: Record<RequestGroup, number>;
    toolDefinitionCounts: Record<string, number | null>;
    toolDefinitionCountSamples: Record<string, number[]>;
    toolDefinitionNameSamples: Record<string, Array<string[] | null>>;
    toolDefinitionValiditySamples: Record<string, boolean[]>;
    contextHookSessionGenerateObservationCount: number | null;
    contextHookSessionGenerateAgents: string[];
  };
  latencyMs: {
    sessionGenerate: { samples: number[]; median: number | null; range: number[] | null };
    hiddenSession: { samples: number[]; median: number | null; range: number[] | null };
    scoutSessionGenerate: { samples: number[]; median: number | null; range: number[] | null };
    source: "local-mock-provider-only";
  };
  cleanup: {
    agentStopped: boolean | null;
    fixtureClosed: boolean;
    environmentRestored: boolean;
    fetchRestored: boolean;
    runRootRemoved: boolean | null;
  };
  failureCode?: string;
};

type Snapshot = Map<string, string>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsText(value: unknown, marker: string): boolean {
  if (typeof value === "string") return value.includes(marker);
  if (Array.isArray(value)) return value.some((entry) => containsText(entry, marker));
  if (record(value)) return Object.values(value).some((entry) => containsText(entry, marker));
  return false;
}

function parseInspection(value: unknown): PluginInspection | undefined {
  const unwrapped = record(value) && Object.hasOwn(value, "output") ? value.output : value;
  if (
    !record(unwrapped) ||
    !Number.isInteger(unwrapped.storedEntries) ||
    !Number.isInteger(unwrapped.sessionEntries) ||
    typeof unwrapped.hasActiveTurn !== "boolean" ||
    !Number.isInteger(unwrapped.promptBindings) ||
    !Number.isInteger(unwrapped.idleClears) ||
    !Number.isSafeInteger(unwrapped.hookCalls) ||
    !Number.isSafeInteger(unwrapped.hookInternalExceptions) ||
    !Array.isArray(unwrapped.calls)
  )
    return undefined;
  const calls: ContextCall[] = [];
  for (const call of unwrapped.calls) {
    if (
      !record(call) ||
      !(typeof call.agent === "string" || call.agent === null) ||
      typeof call.turnBound !== "boolean" ||
      typeof call.briefApplied !== "boolean" ||
      typeof call.hookThrew !== "boolean"
    )
      return undefined;
    calls.push({
      agent: call.agent,
      turnBound: call.turnBound,
      briefApplied: call.briefApplied,
      hookThrew: call.hookThrew,
    });
  }
  return {
    storedEntries: Number(unwrapped.storedEntries),
    sessionEntries: Number(unwrapped.sessionEntries),
    hasActiveTurn: unwrapped.hasActiveTurn,
    promptBindings: Number(unwrapped.promptBindings),
    idleClears: Number(unwrapped.idleClears),
    hookCalls: Number(unwrapped.hookCalls),
    hookInternalExceptions: Number(unwrapped.hookInternalExceptions),
    calls,
  };
}

function accepted(value: unknown): boolean {
  const unwrapped = record(value) && Object.hasOwn(value, "output") ? value.output : value;
  return record(unwrapped) && unwrapped.accepted === true;
}

async function putRejectedOrNotAccepted(put: () => Promise<unknown>): Promise<boolean> {
  try {
    return !accepted(await put());
  } catch (error) {
    return record(error) && error.type === "rpc.invalid_input";
  }
}

function clearCount(value: unknown): number | undefined {
  const unwrapped = record(value) && Object.hasOwn(value, "output") ? value.output : value;
  return record(unwrapped) && typeof unwrapped.cleared === "number" && Number.isSafeInteger(unwrapped.cleared)
    ? unwrapped.cleared
    : undefined;
}

function fixedErrorClassName(rawName: unknown): FixedErrorClass {
  switch (rawName) {
    case "Error":
    case "TypeError":
    case "AbortError":
    case "TimeoutError":
    case "APIError":
    case "FetchError":
    case "InvalidRequestError":
    case "ProviderAuthError":
    case "ProviderModelNotFoundError":
    case "SessionBusyError":
    case "SessionNotFoundError":
      return rawName;
    default:
      return "UnknownError";
  }
}

function fixedErrorClass(error: unknown): FixedErrorClass {
  const rawName = record(error)
    ? typeof error.name === "string"
      ? error.name
      : typeof error._tag === "string"
        ? error._tag
        : null
    : error instanceof Error
      ? error.name
      : null;
  return fixedErrorClassName(rawName);
}

function extractMessageArray(value: unknown): unknown[] | null {
  const unwrapped = record(value) && Object.hasOwn(value, "output") ? value.output : value;
  if (Array.isArray(unwrapped)) return unwrapped;
  if (!record(unwrapped) || !Array.isArray(unwrapped.data)) return null;
  return unwrapped.data;
}

function summarizeMessageArray(messages: unknown[]): MessageSummary {
  const boundedMessages = messages.slice(0, 32);
  const roleCounts: MessageSummary["roleCounts"] = { assistant: 0, user: 0, system: 0, synthetic: 0, other: 0 };
  let assistantMessageExists = false;
  let assistantErrorClass: FixedErrorClass | null = null;
  for (const message of boundedMessages) {
    if (!record(message) || typeof message.type !== "string") {
      roleCounts.other += 1;
      continue;
    }
    if (message.type === "assistant") {
      roleCounts.assistant += 1;
      assistantMessageExists = true;
      if (record(message.error) && typeof message.error.type === "string") {
        assistantErrorClass = fixedErrorClassName(message.error.type);
      } else if (message.finish === "error") {
        assistantErrorClass = "UnknownError";
      }
    } else if (message.type === "user") {
      roleCounts.user += 1;
    } else if (message.type === "system") {
      roleCounts.system += 1;
    } else if (message.type === "synthetic") {
      roleCounts.synthetic += 1;
    } else {
      roleCounts.other += 1;
    }
  }
  return {
    messageCount: boundedMessages.length,
    roleCounts,
    assistantMessageExists,
    assistantErrorClass,
  };
}

async function summarizeSessionMessages(client: OpenCodeClient, sessionID: string): Promise<MessageReadResult> {
  let readErrorClass: FixedErrorClass | null = null;
  try {
    const response: unknown = await client.message.list({ sessionID, limit: 32, order: "asc" });
    const messages = extractMessageArray(response);
    if (messages) return { summary: summarizeMessageArray(messages), errorClass: null };
  } catch (error) {
    readErrorClass = fixedErrorClass(error);
  }
  try {
    const response: unknown = await client.session.context({ sessionID });
    const messages = extractMessageArray(response);
    if (messages) return { summary: summarizeMessageArray(messages), errorClass: null };
  } catch (error) {
    readErrorClass = fixedErrorClass(error);
  }
  return { summary: null, errorClass: readErrorClass ?? "UnknownError" };
}

function configUsesMockProvider(value: unknown, providerOrigin: string): boolean {
  if (!record(value) || !record(value.providers) || value.model !== "fixture-provider/fixture-model") return false;
  const provider = value.providers["fixture-provider"];
  return record(provider) && record(provider.settings) && provider.settings.baseURL === `${providerOrigin}/v1`;
}

async function promptAndWait(
  client: OpenCodeClient,
  input: { sessionID: string; id: string; text: string },
): Promise<TurnOutcome> {
  const signal = AbortSignal.timeout(PROMPT_TIMEOUT_MS);
  try {
    await client.session.prompt(input, { signal });
    await client.session.wait({ sessionID: input.sessionID }, { signal });
    return { completed: true, terminal: "idle", errorClass: null };
  } catch (error) {
    const errorClass = fixedErrorClass(error);
    if (signal.aborted || errorClass === "AbortError" || errorClass === "TimeoutError")
      return { completed: false, terminal: "timeout", errorClass: null };
    return { completed: false, terminal: "error", errorClass };
  }
}

async function privateServerReady(client: OpenCodeClient, childReady: boolean | null): Promise<boolean> {
  if (childReady !== true) return false;
  try {
    return (await client.server.info()).version === EXPECTED_VERSION;
  } catch {
    return false;
  }
}

function safeConnectionFailureCode(error: unknown): string {
  if (error instanceof PrivateV2ServerError) return `private_server_${error.code}`;
  if (error instanceof Error) {
    if (error.name === "TypeError") return "agent_connect_type_error";
    if (error.name === "Error") return "agent_connect_error";
    return "agent_connect_other_error";
  }
  return "agent_connect_non_error_throw";
}

function classifyRequest(serialized: string): RequestGroup {
  const groups: readonly (readonly [RequestGroup, string])[] = [
    ["failureHook", FIXTURE_MARKERS.failureHook],
    ["defensiveFollowup", FIXTURE_MARKERS.defensiveFollowup],
    ["defensiveFailure", FIXTURE_MARKERS.defensiveFailure],
    ["afterFailure", FIXTURE_MARKERS.afterFailure],
    ...FIXTURE_MARKERS.hiddenClassify.map((marker) => ["hiddenClassify", marker] as const),
    ...FIXTURE_MARKERS.scoutGenerate.map((marker) => ["scoutGenerate", marker] as const),
    ["reconnect", FIXTURE_MARKERS.reconnect],
    ["reconnectNoBrief", FIXTURE_MARKERS.reconnectNoBrief],
    ["reconnectNewSession", FIXTURE_MARKERS.reconnectNewSession],
    ["skillDeniedProbe", FIXTURE_MARKERS.skillDeniedProbe],
    ["next", FIXTURE_MARKERS.next],
    ["crossSession", FIXTURE_MARKERS.crossSession],
    ["stop", FIXTURE_MARKERS.stop],
    ["scout", FIXTURE_MARKERS.scout],
    ["write", FIXTURE_MARKERS.write],
    ["hidden", FIXTURE_MARKERS.hidden],
    ["stale", FIXTURE_MARKERS.stale],
    ...FIXTURE_MARKERS.generate.map((marker) => ["generate", marker] as const),
  ];
  return groups.find(([, marker]) => serialized.includes(marker))?.[0] ?? "other";
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value * 100) / 100;
}

function range(values: readonly number[]): number[] | null {
  return values.length === 0
    ? null
    : [Math.min(...values), Math.max(...values)].map((value) => Math.round(value * 100) / 100);
}

function messageID(): string {
  return `msg_${randomUUID().replaceAll("-", "")}`;
}

async function snapshotTree(root: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) {
        const [bytes, info] = await Promise.all([readFile(fullPath), stat(fullPath)]);
        snapshot.set(
          relative(root, fullPath),
          `${createHash("sha256").update(bytes).digest("hex")}:${info.mtimeMs}:${info.size}`,
        );
      }
    }
  };
  await walk(root);
  return snapshot;
}

function snapshotsMatch(before: Snapshot, after: Snapshot): boolean {
  return before.size === after.size && [...before].every(([name, fingerprint]) => after.get(name) === fingerprint);
}

function sse(text: string): string {
  const packet = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${packet({ role: "assistant" })}${packet({ content: text })}${packet({}, "stop")}data: [DONE]\n\n`;
}

function toolCallSse(callID: string, name: string, args: Record<string, unknown>): string {
  const packet = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${packet({ role: "assistant", tool_calls: [{ index: 0, id: callID, type: "function", function: { name, arguments: JSON.stringify(args) } }] })}${packet({}, "tool_calls")}data: [DONE]\n\n`;
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

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  return predicate();
}

function historyMarkerAbsent(history: unknown, marker: string): boolean {
  return !containsText(history, marker);
}

type ToolDefinitions = { count: number; names: string[] | null; valid: boolean };

/** Preserve actual definition counts and names; malformed entries can never prove a tool-less request. */
function inspectToolDefinitions(body: unknown): ToolDefinitions | null {
  if (!record(body)) return null;
  if (!Object.hasOwn(body, "tools")) return { count: 0, names: [], valid: true };
  if (!Array.isArray(body.tools)) return { count: -1, names: null, valid: false };
  const names: string[] = [];
  let valid = true;
  for (const tool of body.tools) {
    if (
      !record(tool) ||
      !record(tool.function) ||
      typeof tool.function.name !== "string" ||
      tool.function.name.trim().length === 0
    ) {
      valid = false;
      continue;
    }
    names.push(tool.function.name);
  }
  return { count: body.tools.length, names: valid ? names : null, valid };
}

function strictlyToolless(definitions: ToolDefinitions | null): boolean {
  return definitions?.valid === true && definitions.count === 0 && definitions.names?.length === 0;
}

function toolResultText(messages: unknown[]): string | null {
  const last = messages.at(-1);
  if (!record(last) || last.role !== "tool") return null;
  if (typeof last.content === "string") return last.content;
  if (!Array.isArray(last.content)) return null;
  return last.content.flatMap((part) => (record(part) && typeof part.text === "string" ? [part.text] : [])).join("\n");
}

const SKILL_PROBE_ID = "scribe-context-spike";
const SKILL_PROBE_SENTINEL = "SCRIBE_CONTEXT_SPIKE_SKILL_SENTINEL";

function within(directory: string, candidate: string): boolean {
  return candidate === directory || candidate.startsWith(`${directory}${sep}`);
}

function environmentMatches(snapshot: NodeJS.ProcessEnv): boolean {
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(process.env)]);
  return [...keys].every((key) => snapshot[key] === process.env[key]);
}

function restoreEnvironment(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, snapshot);
}

function loopbackURL(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function requestHasAuthorization(input: string | URL | Request, init?: RequestInit): boolean {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers)
    new Headers(init.headers).forEach((value, name) => {
      headers.set(name, value);
    });
  return headers.has("authorization");
}

function recordPluginState(value: unknown, pluginID: string, sourceDirectory: string): PluginStatus {
  const data = record(value) && Array.isArray(value.data) ? value.data : [];
  const match = data.find((entry) => {
    if (!record(entry) || !record(entry.source) || !record(entry.state)) return false;
    if (entry.id !== pluginID || entry.source.type !== "local" || typeof entry.source.path !== "string") return false;
    return within(sourceDirectory, entry.source.path) || within(join(sourceDirectory, "server.js"), entry.source.path);
  });
  if (!record(match) || !record(match.state)) return "absent";
  return match.state.status === "active" || match.state.status === "failed" ? match.state.status : "other";
}

describe("Scribe ephemeral context-hook mechanism spike tooling", () => {
  it("keeps synthetic evidence markers distinct and bounds the persisted result shape", () => {
    expect(new TextEncoder().encode(BRIEF_MARKERS.scout).byteLength).toBeLessThanOrEqual(MAX_BRIEF_BYTES);
    expect(new TextEncoder().encode("é".repeat(MAX_BRIEF_BYTES / 2 + 1)).byteLength).toBeGreaterThan(MAX_BRIEF_BYTES);
    expect(EVIDENCE_PATH).toBe("tmp/scribe-v2-migration/context-spike/result.json");
    expect(Object.keys(RPC_DEFINITION.methods)).toEqual(["put", "clear", "inspect", "armThrow"]);
  });

  it("requires exact, well-formed zero tool definitions for a tool-less classification path", () => {
    expect(inspectToolDefinitions({})).toEqual({ count: 0, names: [], valid: true });
    expect(strictlyToolless(inspectToolDefinitions({}))).toBe(true);
    expect(strictlyToolless(inspectToolDefinitions({ tools: [] }))).toBe(true);

    const advertisedSkill = inspectToolDefinitions({
      tools: [{ type: "function", function: { name: "skill", parameters: { type: "object" } } }],
    });
    expect(advertisedSkill).toEqual({ count: 1, names: ["skill"], valid: true });
    expect(strictlyToolless(advertisedSkill)).toBe(false);

    const unknownTool = inspectToolDefinitions({
      tools: [{ type: "function", function: { name: "unknown_tool", parameters: { type: "object" } } }],
    });
    expect(unknownTool?.names).toEqual(["unknown_tool"]);
    expect(strictlyToolless(unknownTool)).toBe(false);

    const malformedTool = inspectToolDefinitions({ tools: [{ type: "function", function: { name: 7 } }] });
    expect(malformedTool).toEqual({ count: 1, names: null, valid: false });
    expect(strictlyToolless(malformedTool)).toBe(false);
    expect(strictlyToolless(inspectToolDefinitions({ tools: "skill" }))).toBe(false);
  });
});

it.skipIf(!ENABLED)(
  "qualifies the ephemeral context hook and host RPC against isolated OpenCode 2.2.0",
  async () => {
    const root = await realpath(PROJECT_ROOT);
    const evidenceDirectory = resolve(root, EVIDENCE_DIRECTORY);
    await mkdir(evidenceDirectory, { recursive: true });
    await assertOwnedPath(root, evidenceDirectory);
    const runId = randomUUID();
    const runRoot = join(evidenceDirectory, `run-${runId}`);
    await mkdir(runRoot, { recursive: false });
    await assertOwnedPath(evidenceDirectory, runRoot);
    const ownerToken = randomUUID();
    await writeFile(join(runRoot, ".context-spike-owner"), ownerToken, { flag: "wx", mode: 0o600 });

    const paths = {
      home: join(runRoot, "home"),
      config: join(runRoot, "xdg-config"),
      data: join(runRoot, "xdg-data"),
      cache: join(runRoot, "xdg-cache"),
      state: join(runRoot, "xdg-state"),
      database: join(runRoot, "database.sqlite"),
      serviceState: join(runRoot, "xdg-state", "opencode"),
      tmp: join(runRoot, "tmp"),
      cwd: join(runRoot, "cwd"),
    } satisfies V2TestIsolation["paths"];
    for (const directory of [paths.home, paths.config, paths.data, paths.cache, paths.state, paths.tmp, paths.cwd])
      await mkdir(directory, { recursive: true });
    const configDirectory = join(paths.config, "opencode");
    await mkdir(configDirectory, { recursive: true });
    const environment: NodeJS.ProcessEnv = {
      HOME: paths.home,
      XDG_CONFIG_HOME: paths.config,
      XDG_DATA_HOME: paths.data,
      XDG_CACHE_HOME: paths.cache,
      XDG_STATE_HOME: paths.state,
      OPENCODE_DB: paths.database,
      TMPDIR: paths.tmp,
      OPENCODE_TEST_HOME: paths.home,
      OPENCODE_CONFIG_DIR: configDirectory,
      OPENCODE_CONFIG_PROJECT_DISABLE: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    };
    assertIsolatedEnvironment(environment, paths);
    for (const candidate of Object.values(paths)) await assertOwnedPath(runRoot, candidate);

    const fixtureDirectory = resolve(
      root,
      "packages/agents/opencode/src/__tests__/fixtures/scribe-context-plugin-spike",
    );
    const contextPluginDirectory = fixtureDirectory;
    const throwingPluginDirectory = join(fixtureDirectory, "throwing-hook");
    const configPath = join(configDirectory, "opencode.json");
    const evidencePath = join(root, EVIDENCE_PATH);
    const originalEnvironment = { ...process.env };
    const originalFetch = globalThis.fetch;
    let environmentReplaced = false;
    let fetchReplaced = false;
    let fixtureClosed = false;
    let releaseStopResponse: (() => void) | undefined;
    let resolveStopRequest: (() => void) | undefined;
    const stopRequestSeen = new Promise<void>((resolvePromise) => {
      resolveStopRequest = resolvePromise;
    });
    let stopRequestHeld = false;
    let provider: Server | undefined;
    let providerOrigin: string | undefined;
    let privateOrigin: string | undefined;
    let agent: OpenCodeAgent | undefined;
    let native: OpenCodeClient | undefined;
    let configBefore: Snapshot | undefined;
    let observedVersion: string | null = null;
    let observedHash: string | null = null;
    let observedClient: string | null = null;
    let privateApiRequests = 0;
    let rpcRequests = 0;
    let providerRequests = 0;
    let maxProviderBodyBytes = 0;
    let privateApiAuthorizationSeen = false;
    let externalFetchAttempted = false;
    let unauthenticatedStatus: number | null = null;
    let privateChildReady: boolean | null = null;
    let sessionsCreated = 0;
    let reconnectBriefCleared: boolean | null = null;
    let skillPermissionDenied: boolean | null = null;
    let skillSentinelDelivered = false;
    let operationStage = "preflight";
    const requestObservations: RequestObservation[] = [];
    const manifest: Manifest = {
      schemaVersion: 2,
      runId,
      status: "RUNNING",
      expectedVersion: EXPECTED_VERSION,
      observedVersion: null,
      expectedExecutableSha256: EXPECTED_EXECUTABLE_SHA256,
      observedExecutableSha256: null,
      executablePathMatchesPin: false,
      expectedClient: EXPECTED_CLIENT,
      observedClient: null,
      evidencePath: EVIDENCE_PATH,
      fixtureRoot: EVIDENCE_DIRECTORY,
      pluginSourceLoadedFromPrivateOverlay: null,
      bundledFixtureDirectoryLoaded: null,
      privateOriginAuthenticated: null,
      selectedClassificationPath: null,
      launch: { backend: "sdk", sandboxMode: "off", loopbackOnly: true, privateChildReady: null },
      criteria: { a: "UNPROVEN", b: "UNPROVEN", c: "UNPROVEN", d: "UNPROVEN", e: "UNPROVEN", f: "UNPROVEN" },
      checks: {},
      failureDiagnostics: {
        nativeUncaughtThrow: {
          contextStateAfterFailure: null,
          failingHookStateAfterFailure: null,
          failureTurnCompleted: null,
          failureTurnTerminal: "unobserved",
          failureTurnErrorClass: null,
          failureTurnProviderRequestOccurred: null,
          postFailureCompleted: null,
          postFailureTerminal: "unobserved",
          postFailureErrorClass: null,
          privateReadyAfterHookFailure: null,
          messages: null,
          messageReadErrorClass: null,
        },
        defensiveFailOpen: {
          contextStateAfterFailure: null,
          hookInternalFailureObserved: null,
          hookCallsAfterFailure: null,
          hookInternalExceptionsAfterFailure: null,
          otherPluginStateAfterFailure: null,
          failureTurnCompleted: null,
          failureTurnTerminal: "unobserved",
          failureTurnErrorClass: null,
          failureTurnProviderRequestOccurred: null,
          postFailureCompleted: null,
          postFailureTerminal: "unobserved",
          postFailureErrorClass: null,
          postFailureProviderRequestOccurred: null,
          privateReadyAfterFailure: null,
        },
      },
      reconnectDiagnostics: {
        briefPendingBeforeReconnect: null,
        pluginEntryClearedAfterReconnect: null,
        promptCompleted: null,
        promptTerminal: "unobserved",
        hookCalledAfterReconnect: null,
        briefAppliedAfterReconnect: null,
        providerRequestOccurred: null,
        briefObservedByProvider: null,
        messages: null,
        messageReadErrorClass: null,
        providerConfigMatchesMockOrigin: null,
        mockProviderListening: null,
        hookCallsBeforePrompt: null,
        hookCallsAfterPrompt: null,
        hookInternalExceptionsBeforePrompt: null,
        hookInternalExceptionsAfterPrompt: null,
      },
      reconnectBisection: { noBriefExistingSession: null, newSession: null },
      failureStage: null,
      failureErrorClass: null,
      counts: {
        privateApiRequests: 0,
        rpcRequests: 0,
        providerRequests: 0,
        sessionsCreated: 0,
        maxProviderBodyBytes: 0,
        requestGroupCounts: {
          scout: 0,
          write: 0,
          hidden: 0,
          failureHook: 0,
          defensiveFailure: 0,
          defensiveFollowup: 0,
          next: 0,
          crossSession: 0,
          stale: 0,
          stop: 0,
          afterFailure: 0,
          reconnect: 0,
          reconnectNoBrief: 0,
          reconnectNewSession: 0,
          skillDeniedProbe: 0,
          generate: 0,
          scoutGenerate: 0,
          hiddenClassify: 0,
          other: 0,
        },
        toolDefinitionCounts: {
          sessionGenerate: null,
          scoutSessionGenerate: null,
          hiddenSession: null,
          hiddenReviewer: null,
          scout: null,
          write: null,
          skillProbe: null,
        },
        toolDefinitionCountSamples: {
          sessionGenerate: [],
          scoutSessionGenerate: [],
          hiddenSession: [],
          hiddenReviewer: [],
          skillProbe: [],
        },
        toolDefinitionNameSamples: {
          sessionGenerate: [],
          scoutSessionGenerate: [],
          hiddenSession: [],
          hiddenReviewer: [],
          skillProbe: [],
        },
        toolDefinitionValiditySamples: {
          sessionGenerate: [],
          scoutSessionGenerate: [],
          hiddenSession: [],
          hiddenReviewer: [],
          skillProbe: [],
        },
        contextHookSessionGenerateObservationCount: null,
        contextHookSessionGenerateAgents: [],
      },
      latencyMs: {
        sessionGenerate: { samples: [], median: null, range: null },
        hiddenSession: { samples: [], median: null, range: null },
        scoutSessionGenerate: { samples: [], median: null, range: null },
        source: "local-mock-provider-only",
      },
      cleanup: {
        agentStopped: null,
        fixtureClosed: false,
        environmentRestored: false,
        fetchRestored: false,
        runRootRemoved: null,
      },
    };
    const startedAt = Date.now();
    const overallTimer = setTimeout(() => {
      manifest.failureCode ??= "overall_deadline";
    }, OVERALL_TIMEOUT_MS);
    const persist = async () => {
      manifest.observedVersion = observedVersion;
      manifest.observedExecutableSha256 = observedHash;
      manifest.observedClient = observedClient;
      manifest.launch.privateChildReady = privateChildReady;
      manifest.counts = {
        privateApiRequests,
        rpcRequests,
        providerRequests,
        sessionsCreated,
        maxProviderBodyBytes,
        requestGroupCounts: Object.fromEntries(
          REQUEST_GROUPS.map((group) => [
            group,
            requestObservations.filter((request) => request.group === group).length,
          ]),
        ) as Record<RequestGroup, number>,
        toolDefinitionCounts: manifest.counts.toolDefinitionCounts,
        toolDefinitionCountSamples: manifest.counts.toolDefinitionCountSamples,
        toolDefinitionNameSamples: manifest.counts.toolDefinitionNameSamples,
        toolDefinitionValiditySamples: manifest.counts.toolDefinitionValiditySamples,
        contextHookSessionGenerateObservationCount: manifest.counts.contextHookSessionGenerateObservationCount,
        contextHookSessionGenerateAgents: manifest.counts.contextHookSessionGenerateAgents,
      };
      manifest.cleanup.fixtureClosed = fixtureClosed;
      const body = `${JSON.stringify(manifest, null, 2)}\n`;
      if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) {
        manifest.status = "FAIL";
        manifest.failureCode = "manifest_bound_exceeded";
        throw new Error("manifest_bound_exceeded");
      }
      await writeFile(evidencePath, body, { mode: 0o600 });
    };
    const markCheck = (name: string, value: boolean | null) => {
      manifest.checks[name] = value;
    };
    const expectPass = () => {
      expect(manifest.criteria).toEqual({ a: "PASS", b: "PASS", c: "PASS", d: "PASS", e: "PASS", f: "PASS" });
    };

    try {
      const executable = EXECUTABLE_INPUT && isAbsolute(EXECUTABLE_INPUT) ? resolve(EXECUTABLE_INPUT) : undefined;
      manifest.executablePathMatchesPin = executable === EXPECTED_EXECUTABLE;
      markCheck("explicitExecutableMatchesPinnedPath", manifest.executablePathMatchesPin);
      if (!executable || !manifest.executablePathMatchesPin) {
        manifest.status = "BLOCKED";
        manifest.failureCode = "explicit_executable_missing_or_mismatched";
        throw new Error("blocked_preflight");
      }
      const binary = await readFile(executable);
      observedHash = createHash("sha256").update(binary).digest("hex");
      markCheck("executableHashMatchesPinned2_2_0", observedHash === EXPECTED_EXECUTABLE_SHA256);
      if (observedHash !== EXPECTED_EXECUTABLE_SHA256) {
        manifest.status = "BLOCKED";
        manifest.failureCode = "executable_hash_mismatch";
        throw new Error("blocked_preflight");
      }

      const clientMetadata = JSON.parse(
        await readFile(resolve(root, "packages/agents/opencode/node_modules/@opencode/client/package.json"), "utf8"),
      ) as unknown;
      observedClient =
        record(clientMetadata) &&
        clientMetadata.name === "@opencode/client" &&
        typeof clientMetadata.version === "string"
          ? `${clientMetadata.name}@${clientMetadata.version}`
          : null;
      markCheck("clientPackagePinned2_1_0", observedClient === EXPECTED_CLIENT);
      if (observedClient !== EXPECTED_CLIENT) {
        manifest.status = "BLOCKED";
        manifest.failureCode = "client_package_mismatch";
        throw new Error("blocked_preflight");
      }

      const ambient = await inspectAmbientConfigSources();
      const gate = evaluateStaticPrelaunchGate(environment, paths, ambient);
      markCheck("ambientAndEnvironmentPreflightClear", gate.status === "READY_FOR_DISPOSABLE_SPIKE");
      if (gate.status !== "READY_FOR_DISPOSABLE_SPIKE") {
        manifest.status = "BLOCKED";
        manifest.failureCode = "ambient_preflight_blocked";
        throw new Error("blocked_preflight");
      }

      provider = createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          response.writeHead(404).end();
          return;
        }
        providerRequests += 1;
        if (providerRequests > MAX_PROVIDER_REQUESTS) {
          response.writeHead(429).end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const chunk of request) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.byteLength;
            if (size > MAX_PROVIDER_BODY_BYTES) {
              response.writeHead(413).end();
              return;
            }
            chunks.push(bytes);
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          maxProviderBodyBytes = Math.max(maxProviderBodyBytes, size);
          if (raw.includes(SKILL_PROBE_SENTINEL)) skillSentinelDelivered = true;
          const body: unknown = JSON.parse(raw);
          const group = classifyRequest(raw);
          const definitions = inspectToolDefinitions(body);
          requestObservations.push({
            group,
            bodyBytes: size,
            toolDefinitionCount: definitions?.count ?? -1,
            noToolDefinitions: strictlyToolless(definitions),
            toolDefinitionNames: definitions?.names ?? null,
            toolDefinitionsValid: definitions?.valid ?? false,
            briefScout: raw.includes(BRIEF_MARKERS.scout),
            briefStale: raw.includes(BRIEF_MARKERS.stale),
            briefStop: raw.includes(BRIEF_MARKERS.stop),
            briefReconnect: raw.includes(BRIEF_MARKERS.reconnect),
            briefDefensive: raw.includes(BRIEF_MARKERS.defensive),
          });
          if (group === "stop" && !stopRequestHeld) {
            stopRequestHeld = true;
            resolveStopRequest?.();
            await new Promise<void>((resolveRelease) => {
              releaseStopResponse = resolveRelease;
            });
          }
          if (group === "skillDeniedProbe") {
            const messages = record(body) && Array.isArray(body.messages) ? body.messages : [];
            const result = toolResultText(messages);
            if (result === null) {
              response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
              response.end(toolCallSse("call-context-skill-denial", "skill", { id: SKILL_PROBE_ID }));
              return;
            }
            skillPermissionDenied = /Permission denied: skill\b/iu.test(result);
            response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
            response.end(sse("SYNTHETIC_SPIKE_RESULT"));
            return;
          }
          if (!response.destroyed && !response.headersSent) {
            response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
            response.end(sse("SYNTHETIC_SPIKE_RESULT"));
          }
        } catch {
          if (!response.destroyed && !response.headersSent) response.writeHead(400).end();
        }
      });
      const providerPort = await listen(provider);
      providerOrigin = `http://127.0.0.1:${providerPort}`;

      const ownedConfig = {
        model: "fixture-provider/fixture-model",
        enabledProviders: ["fixture-provider"],
        providers: {
          "fixture-provider": {
            name: "Local context-hook spike provider",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${providerOrigin}/v1` },
            models: { "fixture-model": { name: "Synthetic local model" } },
          },
        },
      };
      await writeFile(configPath, `${JSON.stringify(ownedConfig, null, 2)}\n`, { mode: 0o600 });
      const skillDirectory = join(configDirectory, "skills", SKILL_PROBE_ID);
      await mkdir(skillDirectory, { recursive: true });
      const skillPath = join(skillDirectory, "SKILL.md");
      const skillDocument = [
        "---",
        `name: ${SKILL_PROBE_ID}`,
        "description: Harmless fixture-only permission-denial probe.",
        "---",
        "",
        "This isolated synthetic skill is used only to verify native permission denial.",
        SKILL_PROBE_SENTINEL,
        "",
      ].join("\n");
      await writeFile(skillPath, skillDocument, { mode: 0o600 });
      markCheck("isolatedSkillProbeFixtureWritten", (await readFile(skillPath, "utf8")) === skillDocument);
      const configReadback = JSON.parse(await readFile(configPath, "utf8")) as unknown;
      const noConfiguredPlugins =
        record(configReadback) &&
        !Object.hasOwn(configReadback, "plugins") &&
        !Object.hasOwn(configReadback, "plugin") &&
        !Object.hasOwn(configReadback, "mcp");
      markCheck("ownedConfigUsesOnlyLocalProviderAndNoPluginEntry", noConfiguredPlugins);
      configBefore = await snapshotTree(paths.config);

      const nativeFetch = originalFetch.bind(globalThis);
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = loopbackURL(input);
        if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
          externalFetchAttempted = true;
          throw new Error("fixture_non_loopback_fetch_blocked");
        }
        if (url.origin !== providerOrigin) {
          privateApiRequests += 1;
          if (privateApiRequests > MAX_PRIVATE_REQUESTS) throw new Error("fixture_private_request_limit");
          if (url.pathname === "/api/info") {
            privateOrigin ??= url.origin;
            if (url.origin === privateOrigin && requestHasAuthorization(input, init))
              privateApiAuthorizationSeen = true;
          }
          if (/\/api\/rpc\//u.test(url.pathname)) rpcRequests += 1;
        }
        const response = await nativeFetch(input, init);
        if (url.pathname === "/api/info" && response.ok) {
          const info: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          if (record(info)) observedVersion = typeof info.version === "string" ? info.version : null;
        }
        return response;
      }) as typeof fetch;
      fetchReplaced = true;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, environment);
      environmentReplaced = true;
      assertIsolatedEnvironment(environment, paths);

      const pluginSources = [contextPluginDirectory, throwingPluginDirectory] as const;
      agent = new OpenCodeAgent({
        workspacePath: paths.cwd,
        hostPaths: { config: configDirectory, state: paths.state },
        backend: "sdk",
        sandbox: {
          mode: "off",
          enabled: false,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [paths.cwd], readOnlyPaths: [] },
        },
        executable: { path: executable },
        pluginSources,
        restrictedReview: {
          prompt: RESTRICTED_REVIEW_PROMPT,
          maxSteps: RESTRICTED_REVIEW_MAX_STEPS,
          modelResolution: "native-default",
        },
      });
      try {
        await agent.connect();
      } catch (error) {
        manifest.failureCode = safeConnectionFailureCode(error);
        throw error;
      }
      native = (agent as unknown as { v2Client?: OpenCodeClient }).v2Client;
      if (!native) throw new Error("private_client_unavailable");
      privateChildReady = true;
      markCheck("privateServerExactVersionObserved", observedVersion === EXPECTED_VERSION);
      markCheck("privateServerConnected", privateChildReady);
      if (!privateOrigin || !providerOrigin) throw new Error("private_origin_unobserved");

      const unauthenticatedInfo = await nativeFetch(new URL("/api/info", privateOrigin), { redirect: "manual" });
      unauthenticatedStatus = unauthenticatedInfo.status;
      await unauthenticatedInfo.body?.cancel();
      markCheck("privateServerRejectsUnauthenticatedClient", unauthenticatedStatus === 401);

      const configHasNoPlugins = noConfiguredPlugins && configBefore !== undefined;
      const noProjectConfig = !(await access(join(paths.cwd, "opencode.json")).then(
        () => true,
        () => false,
      ));
      markCheck("projectConfigDiscoveryDisabled", noProjectConfig);
      let rpc = native.rpc(RPC_DEFINITION);
      let nativeThrowRpc = native.rpc(NATIVE_THROW_RPC_DEFINITION);
      const location = { location: { directory: paths.cwd } };
      const reconnectPrivateChild = async (): Promise<ReconnectHealth> => {
        const connectedAgent = agent;
        if (!connectedAgent) throw new Error("spike_agent_unavailable_before_reconnect");
        privateChildReady = false;
        await connectedAgent.reconnect();
        const reconnectedNative = (connectedAgent as unknown as { v2Client?: OpenCodeClient }).v2Client;
        if (!reconnectedNative) throw new Error("private_client_unavailable_after_reconnect");
        native = reconnectedNative;
        rpc = native.rpc(RPC_DEFINITION);
        nativeThrowRpc = native.rpc(NATIVE_THROW_RPC_DEFINITION);
        privateChildReady = true;
        const serverReady = await privateServerReady(native, privateChildReady);
        let providerConfigMatches = false;
        try {
          providerConfigMatches = providerOrigin
            ? configUsesMockProvider(JSON.parse(await readFile(configPath, "utf8")) as unknown, providerOrigin)
            : false;
        } catch {}
        let contextPluginActive = false;
        let throwingPluginActive = false;
        for (let read = 0; read < 8; read += 1) {
          const plugins = await native.plugin.list({ location: { directory: paths.cwd } });
          contextPluginActive = recordPluginState(plugins, CONTEXT_PLUGIN_ID, contextPluginDirectory) === "active";
          throwingPluginActive = recordPluginState(plugins, THROWING_PLUGIN_ID, throwingPluginDirectory) === "active";
          if (contextPluginActive && throwingPluginActive) break;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        }
        return {
          privateServerReady: serverReady,
          providerConfigMatchesMockOrigin: providerConfigMatches,
          mockProviderListening: provider?.listening === true,
          contextPluginActive,
          throwingPluginActive,
        };
      };
      const runReconnectProbe = async (
        sessionID: string,
        turnID: string,
        text: string,
        group: "reconnect" | "reconnectNoBrief" | "reconnectNewSession",
        health: ReconnectHealth,
        briefWasEverPut: boolean,
      ): Promise<ReconnectProbe> => {
        const client = native;
        if (!client) throw new Error("private_client_unavailable_for_reconnect_probe");
        const before = parseInspection(await rpc.inspect({ sessionID }, location));
        const requestStart = requestObservations.length;
        const outcome = await promptAndWait(client, { sessionID, id: turnID, text });
        await waitFor(
          () => requestObservations.slice(requestStart).some((request) => request.group === group),
          PROMPT_TIMEOUT_MS,
        );
        const messageRead = await summarizeSessionMessages(client, sessionID);
        const after = parseInspection(await rpc.inspect({ sessionID }, location));
        const probeRequest = requestObservations.slice(requestStart).find((request) => request.group === group);
        const requestOccurred = probeRequest !== undefined;
        return {
          completed: outcome.completed,
          terminal: outcome.terminal,
          messages: messageRead.summary,
          messageReadErrorClass: messageRead.errorClass,
          pluginEntryClearedBeforePrompt: before?.sessionEntries === 0 && before.hasActiveTurn === false,
          briefWasEverPut,
          providerRequestOccurred: requestOccurred,
          briefObservedByProvider: probeRequest?.briefReconnect ?? null,
          providerConfigMatchesMockOrigin: health.providerConfigMatchesMockOrigin,
          mockProviderListening: health.mockProviderListening,
          hookCallsBefore: before?.hookCalls ?? null,
          hookCallsAfter: after?.hookCalls ?? null,
          hookInternalExceptionsBefore: before?.hookInternalExceptions ?? null,
          hookInternalExceptionsAfter: after?.hookInternalExceptions ?? null,
        };
      };
      let pluginResponse: unknown;
      let contextPluginState: ReturnType<typeof recordPluginState> = "absent";
      let throwingPluginState: ReturnType<typeof recordPluginState> = "absent";
      for (let read = 0; read < 8; read += 1) {
        pluginResponse = await native.plugin.list({ location: { directory: paths.cwd } });
        contextPluginState = recordPluginState(pluginResponse, CONTEXT_PLUGIN_ID, contextPluginDirectory);
        throwingPluginState = recordPluginState(pluginResponse, THROWING_PLUGIN_ID, throwingPluginDirectory);
        if (contextPluginState === "active" && throwingPluginState === "active") break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      }
      // Native plugin activation is asynchronous after connect; allow the registry to settle before freezing states.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
      pluginResponse = await native.plugin.list({ location: { directory: paths.cwd } });
      contextPluginState = recordPluginState(pluginResponse, CONTEXT_PLUGIN_ID, contextPluginDirectory);
      throwingPluginState = recordPluginState(pluginResponse, THROWING_PLUGIN_ID, throwingPluginDirectory);
      const pluginOverlayObserved = contextPluginState === "active" && throwingPluginState === "active";
      manifest.pluginSourceLoadedFromPrivateOverlay = pluginOverlayObserved && configHasNoPlugins && noProjectConfig;
      manifest.bundledFixtureDirectoryLoaded =
        contextPluginState === "active" && throwingPluginState === "active" && isAbsolute(contextPluginDirectory);
      markCheck("contextPluginActiveFromLocalFixtureDirectory", contextPluginState === "active");
      markCheck("throwingPluginActiveBeforeInjectedFailure", throwingPluginState === "active");

      const failureSession = await native.session.create({
        title: "Scribe context spike hook failure isolation",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      operationStage = "native-uncaught-throw-diagnostics";
      const nativeThrowArmResult = await nativeThrowRpc.armThrow({}, location);
      const nativeThrowArmed = record(nativeThrowArmResult) && nativeThrowArmResult.armed === true;
      if (!nativeThrowArmed) throw new Error("native_throw_fixture_not_armed");
      const failureTurnID = messageID();
      const failureTurn = await promptAndWait(native, {
        sessionID: failureSession.id,
        id: failureTurnID,
        text: FIXTURE_MARKERS.failureHook,
      });
      const failureTurnMessageRead = await summarizeSessionMessages(native, failureSession.id);
      const failureTurnProviderRequestOccurred = requestObservations.some((request) => request.group === "failureHook");
      let failurePluginList: unknown;
      let contextStateAfterFailure: PluginStatus = "absent";
      let failingHookStateAfterFailure: PluginStatus = "absent";
      for (let read = 0; read < 8; read += 1) {
        failurePluginList = await native.plugin.list({ location: { directory: paths.cwd } });
        contextStateAfterFailure = recordPluginState(failurePluginList, CONTEXT_PLUGIN_ID, contextPluginDirectory);
        failingHookStateAfterFailure = recordPluginState(
          failurePluginList,
          THROWING_PLUGIN_ID,
          throwingPluginDirectory,
        );
        if (contextStateAfterFailure === "active" && failingHookStateAfterFailure === "failed") break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
      failurePluginList = await native.plugin.list({ location: { directory: paths.cwd } });
      contextStateAfterFailure = recordPluginState(failurePluginList, CONTEXT_PLUGIN_ID, contextPluginDirectory);
      failingHookStateAfterFailure = recordPluginState(failurePluginList, THROWING_PLUGIN_ID, throwingPluginDirectory);
      const nativeHookFailureLeavesPluginsActive =
        contextStateAfterFailure === "active" && failingHookStateAfterFailure === "active";
      markCheck("nativeUncaughtThrowLeavesBothPluginsActive", nativeHookFailureLeavesPluginsActive);
      const privateReadyAfterHookFailure = await privateServerReady(native, privateChildReady);

      const postFailure = await native.session.create({
        title: "Scribe context spike ordinary chat after hook failure",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const postFailureTurn = await promptAndWait(native, {
        sessionID: postFailure.id,
        id: messageID(),
        text: FIXTURE_MARKERS.afterFailure,
      });
      manifest.failureDiagnostics.nativeUncaughtThrow = {
        contextStateAfterFailure,
        failingHookStateAfterFailure,
        failureTurnCompleted: failureTurn.completed,
        failureTurnTerminal: failureTurn.terminal,
        failureTurnErrorClass: failureTurn.errorClass,
        failureTurnProviderRequestOccurred,
        postFailureCompleted: postFailureTurn.completed,
        postFailureTerminal: postFailureTurn.terminal,
        postFailureErrorClass: postFailureTurn.errorClass,
        privateReadyAfterHookFailure,
        messages: failureTurnMessageRead.summary,
        messageReadErrorClass: failureTurnMessageRead.errorClass,
      };
      markCheck("nativeThrowFixtureArmedExplicitly", nativeThrowArmed);
      markCheck("nativeUncaughtThrowTurnMessagesSummarizedWithoutText", failureTurnMessageRead.summary !== null);
      markCheck(
        "nativeUncaughtThrowTerminatesWithIdleAndNoProvider",
        failureTurn.terminal === "idle" && !failureTurnProviderRequestOccurred,
      );
      markCheck("nativeUncaughtThrowLeavesPluginActive", failingHookStateAfterFailure === "active");
      markCheck(
        "nativeUncaughtThrowLeavesOtherPluginAndLaterChatUsable",
        contextStateAfterFailure === "active" && postFailureTurn.completed && privateReadyAfterHookFailure,
      );

      operationStage = "defensive-fail-open-diagnostics";
      const defensiveSession = await native.session.create({
        title: "Scribe context spike defensive fail-open isolation",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const defensiveFailureTurnID = messageID();
      const defensiveBriefAccepted = accepted(
        await rpc.put(
          {
            sessionID: defensiveSession.id,
            turnID: defensiveFailureTurnID,
            brief: BRIEF_MARKERS.defensive,
          },
          location,
        ),
      );
      const defensiveArmedResult = await rpc.armThrow({}, location);
      const defensiveFailureArmed = record(defensiveArmedResult) && defensiveArmedResult.armed === true;
      const defensiveFailureTurn =
        defensiveFailureArmed && defensiveBriefAccepted
          ? await promptAndWait(native, {
              sessionID: defensiveSession.id,
              id: defensiveFailureTurnID,
              text: FIXTURE_MARKERS.defensiveFailure,
            })
          : { completed: false, terminal: "unobserved" as const, errorClass: null };
      const defensiveFailureRequest = requestObservations.find((request) => request.group === "defensiveFailure");
      const defensiveInspection = parseInspection(await rpc.inspect({ sessionID: defensiveSession.id }, location));
      const defensiveFailureCall = defensiveInspection?.calls.find((call) => call.hookThrew && call.agent === "scout");
      const hookInternalFailureObserved =
        defensiveFailureCall?.turnBound === true && defensiveFailureCall.briefApplied === false;
      const hookCallsAfterDefensiveFailure = defensiveInspection?.hookCalls ?? null;
      const hookInternalExceptionsAfterDefensiveFailure = defensiveInspection?.hookInternalExceptions ?? null;
      const defensivePluginList = await native.plugin.list({ location: { directory: paths.cwd } });
      const defensiveContextState = recordPluginState(defensivePluginList, CONTEXT_PLUGIN_ID, contextPluginDirectory);
      const otherPluginStateAfterDefensiveFailure = recordPluginState(
        defensivePluginList,
        THROWING_PLUGIN_ID,
        throwingPluginDirectory,
      );
      const defensiveFollowupTurn = await promptAndWait(native, {
        sessionID: defensiveSession.id,
        id: messageID(),
        text: FIXTURE_MARKERS.defensiveFollowup,
      });
      const defensiveFollowupRequest = requestObservations.find((request) => request.group === "defensiveFollowup");
      const privateReadyAfterDefensiveFailure = await privateServerReady(native, privateChildReady);
      manifest.failureDiagnostics.defensiveFailOpen = {
        contextStateAfterFailure: defensiveContextState,
        hookInternalFailureObserved,
        hookCallsAfterFailure: hookCallsAfterDefensiveFailure,
        hookInternalExceptionsAfterFailure: hookInternalExceptionsAfterDefensiveFailure,
        otherPluginStateAfterFailure: otherPluginStateAfterDefensiveFailure,
        failureTurnCompleted: defensiveFailureTurn.completed,
        failureTurnTerminal: defensiveFailureTurn.terminal,
        failureTurnErrorClass: defensiveFailureTurn.errorClass,
        failureTurnProviderRequestOccurred: defensiveFailureRequest !== undefined,
        postFailureCompleted: defensiveFollowupTurn.completed,
        postFailureTerminal: defensiveFollowupTurn.terminal,
        postFailureErrorClass: defensiveFollowupTurn.errorClass,
        postFailureProviderRequestOccurred: defensiveFollowupRequest !== undefined,
        privateReadyAfterFailure: privateReadyAfterDefensiveFailure,
      };
      const defensiveFailOpenPass =
        defensiveFailureArmed &&
        defensiveBriefAccepted &&
        hookInternalFailureObserved &&
        hookCallsAfterDefensiveFailure !== null &&
        hookCallsAfterDefensiveFailure > 0 &&
        hookInternalExceptionsAfterDefensiveFailure !== null &&
        hookInternalExceptionsAfterDefensiveFailure > 0 &&
        defensiveFailureTurn.completed &&
        defensiveFailureTurn.terminal === "idle" &&
        defensiveFailureRequest !== undefined &&
        !defensiveFailureRequest.briefDefensive &&
        defensiveContextState === "active" &&
        otherPluginStateAfterDefensiveFailure === "active" &&
        defensiveFollowupTurn.completed &&
        defensiveFollowupTurn.terminal === "idle" &&
        defensiveFollowupRequest !== undefined &&
        privateReadyAfterDefensiveFailure;
      markCheck("defensiveFailOpenInternalFailureDoesNotBlockTurn", defensiveFailOpenPass);
      markCheck("defensiveFailOpenPluginAndOtherPluginRemainActive", defensiveFailOpenPass);
      const failureIsolated = defensiveFailOpenPass;
      markCheck("failureLeavesPrivateServerAndOrdinaryChatUsable", failureIsolated);

      const scout = await native.session.create({
        title: "Scribe context spike Scout",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const write = await native.session.create({
        title: "Scribe context spike Write",
        agent: "build",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const hidden = await native.session.create({
        title: "Scribe context spike hidden classifier",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const generate = await native.session.create({
        title: "Scribe context spike restricted-agent generate",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const scoutGenerate = await native.session.create({
        title: "Scribe context spike Scout generate secondary observation",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const skillProbe = await native.session.create({
        title: "Scribe context spike restricted-review skill permission probe",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;

      const scoutTurn = messageID();
      const scoutPut = await rpc.put({ sessionID: scout.id, turnID: scoutTurn, brief: BRIEF_MARKERS.scout }, location);
      const scoutPutAccepted = accepted(scoutPut);
      await native.session.prompt(
        { sessionID: scout.id, id: scoutTurn, text: FIXTURE_MARKERS.scout },
        { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
      );
      await native.session.wait({ sessionID: scout.id }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
      markCheck("throwingPluginStartedActive", throwingPluginState === "active");
      const scoutInspection = parseInspection(await rpc.inspect({ sessionID: scout.id }, location));
      const scoutCalls = scoutInspection?.calls.filter((call) => call.agent === "scout") ?? [];
      const scoutRequest = requestObservations.find((request) => request.group === "scout");
      const scoutHistory = await native.session.context({ sessionID: scout.id });
      const scoutInstructions = await native.session.instructions.entry.list({ sessionID: scout.id });
      const briefAbsentFromPersistentState =
        historyMarkerAbsent(scoutHistory, BRIEF_MARKERS.scout) &&
        historyMarkerAbsent(scoutInstructions, BRIEF_MARKERS.scout) &&
        !(await readFile(configPath, "utf8")).includes(BRIEF_MARKERS.scout);
      markCheck("hostRpcAcceptedBoundScoutBrief", scoutPutAccepted);
      markCheck(
        "contextHookIdentifiesScoutSessionTurnAndAgent",
        Boolean(scoutInspection && scoutCalls.length === 1 && scoutCalls[0]?.turnBound),
      );
      markCheck("contextHookAppliedBriefToScoutContext", scoutCalls[0]?.briefApplied === true);
      markCheck("mockProviderObservedScoutRequest", scoutRequest !== undefined);
      markCheck("scoutOutgoingRequestContainsOnlySyntheticBriefMarker", scoutRequest?.briefScout === true);
      markCheck("briefAbsentFromHistoryInstructionsAndConfig", briefAbsentFromPersistentState);

      const writeTurn = messageID();
      await native.session.prompt(
        { sessionID: write.id, id: writeTurn, text: FIXTURE_MARKERS.write },
        { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
      );
      await native.session.wait({ sessionID: write.id }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
      const writeInspection = parseInspection(await rpc.inspect({ sessionID: write.id }, location));
      const writeCalls = writeInspection?.calls.filter((call) => call.agent === "build") ?? [];
      const writeRequest = requestObservations.find((request) => request.group === "write");
      markCheck(
        "contextHookIdentifiesWriteAsNativeBuild",
        Boolean(writeInspection && writeCalls.length === 1 && writeCalls[0]?.agent === "build"),
      );
      markCheck("mockProviderObservedWriteRequest", writeRequest !== undefined);

      const hiddenTurn = messageID();
      await native.session.prompt(
        { sessionID: hidden.id, id: hiddenTurn, text: FIXTURE_MARKERS.hidden },
        { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
      );
      await native.session.wait({ sessionID: hidden.id }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
      const hiddenInspection = parseInspection(await rpc.inspect({ sessionID: hidden.id }, location));
      const hiddenCalls = hiddenInspection?.calls.filter((call) => call.agent === RESTRICTED_REVIEW_AGENT_NAME) ?? [];
      const hiddenRequest = requestObservations.find((request) => request.group === "hidden");
      markCheck(
        "contextHookIdentifiesHiddenSubagent",
        Boolean(hiddenInspection && hiddenCalls.length === 1 && hiddenCalls[0]?.agent === RESTRICTED_REVIEW_AGENT_NAME),
      );
      markCheck("mockProviderObservedHiddenReviewRequest", hiddenRequest !== undefined);

      operationStage = "advertised-skill-permission-probe";
      const skillProbeOutcome = await promptAndWait(native, {
        sessionID: skillProbe.id,
        id: messageID(),
        text: FIXTURE_MARKERS.skillDeniedProbe,
      });
      const skillProbeRequests = requestObservations.filter((request) => request.group === "skillDeniedProbe");
      const identityProven =
        scoutCalls.length === 1 &&
        scoutCalls[0]?.turnBound === true &&
        writeCalls.length === 1 &&
        writeCalls[0]?.agent === "build" &&
        hiddenCalls.length === 1 &&
        hiddenCalls[0]?.agent === RESTRICTED_REVIEW_AGENT_NAME;
      manifest.criteria.a = identityProven ? "PASS" : "FAIL";

      const turnEndClear = await rpc.clear({ sessionID: scout.id, turnID: scoutTurn }, location);
      const afterTurnEnd = parseInspection(await rpc.inspect({ sessionID: scout.id }, location));
      const turnEndCleared =
        clearCount(turnEndClear) === 1 && afterTurnEnd?.sessionEntries === 0 && afterTurnEnd.hasActiveTurn === false;

      const nextTurn = messageID();
      const staleTurn = randomUUID();
      const stalePut = accepted(
        await rpc.put({ sessionID: scout.id, turnID: staleTurn, brief: BRIEF_MARKERS.stale }, location),
      );
      await native.session.prompt(
        { sessionID: scout.id, id: nextTurn, text: FIXTURE_MARKERS.next },
        { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
      );
      await native.session.wait({ sessionID: scout.id }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
      const nextRequest = requestObservations.find((request) => request.group === "next");
      const staleRequest = requestObservations.find((request) => request.group === "stale");
      const nextPromptClearedStale =
        stalePut &&
        nextRequest !== undefined &&
        !nextRequest.briefStale &&
        staleRequest === undefined &&
        parseInspection(await rpc.inspect({ sessionID: scout.id }, location))?.sessionEntries === 0;

      const crossSessionID = (
        await native.session.create({
          title: "Scribe context spike isolated session",
          agent: "scout",
          location: { directory: paths.cwd },
        })
      ).id;
      sessionsCreated += 1;
      const crossSessionRequestStart = requestObservations.length;
      await native.session.prompt(
        { sessionID: crossSessionID, id: messageID(), text: FIXTURE_MARKERS.crossSession },
        { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
      );
      await native.session.wait({ sessionID: crossSessionID }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
      const crossSessionRequest = requestObservations
        .slice(crossSessionRequestStart)
        .find((request) => request.group === "crossSession");
      const noCrossSessionLeak =
        crossSessionRequest !== undefined && !crossSessionRequest.briefScout && !crossSessionRequest.briefStale;

      operationStage = "reconnect-brief-probe";
      const reconnectSession = await native.session.create({
        title: "Scribe context spike reconnect clearing",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const noBriefExistingSession = await native.session.create({
        title: "Scribe context spike reconnect no-brief existing session",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const reconnectTurn = messageID();
      const reconnectBriefAccepted = accepted(
        await rpc.put(
          { sessionID: reconnectSession.id, turnID: reconnectTurn, brief: BRIEF_MARKERS.reconnect },
          location,
        ),
      );
      if (!reconnectBriefAccepted) throw new Error("reconnect_spike_brief_not_accepted");
      const briefWasPendingBeforeReconnect =
        parseInspection(await rpc.inspect({ sessionID: reconnectSession.id }, location))?.sessionEntries === 1;
      const reconnectHealth = await reconnectPrivateChild();
      const reconnectProbe = await runReconnectProbe(
        reconnectSession.id,
        reconnectTurn,
        FIXTURE_MARKERS.reconnect,
        "reconnect",
        reconnectHealth,
        true,
      );
      const reconnectInspectionAfterPrompt = parseInspection(
        await rpc.inspect({ sessionID: reconnectSession.id }, location),
      );
      const reconnectHookCalls = reconnectInspectionAfterPrompt?.calls ?? [];
      const reconnectHookCalled = reconnectHookCalls.some((call) => call.agent === "scout");
      const reconnectBriefApplied = reconnectHookCalls.some((call) => call.briefApplied);
      const reconnectBriefObservedByProvider = reconnectProbe.briefObservedByProvider;
      const reconnectEntryCleared = reconnectProbe.pluginEntryClearedBeforePrompt;
      const reconnectServerReady = reconnectHealth.privateServerReady;
      manifest.reconnectDiagnostics = {
        briefPendingBeforeReconnect: briefWasPendingBeforeReconnect,
        pluginEntryClearedAfterReconnect: reconnectEntryCleared,
        promptCompleted: reconnectProbe.completed,
        promptTerminal: reconnectProbe.terminal,
        hookCalledAfterReconnect: reconnectHookCalled,
        briefAppliedAfterReconnect: reconnectBriefApplied,
        providerRequestOccurred: reconnectProbe.providerRequestOccurred,
        briefObservedByProvider: reconnectBriefObservedByProvider,
        messages: reconnectProbe.messages,
        messageReadErrorClass: reconnectProbe.messageReadErrorClass,
        providerConfigMatchesMockOrigin: reconnectHealth.providerConfigMatchesMockOrigin,
        mockProviderListening: reconnectHealth.mockProviderListening,
        hookCallsBeforePrompt: reconnectProbe.hookCallsBefore,
        hookCallsAfterPrompt: reconnectProbe.hookCallsAfter,
        hookInternalExceptionsBeforePrompt: reconnectProbe.hookInternalExceptionsBefore,
        hookInternalExceptionsAfterPrompt: reconnectProbe.hookInternalExceptionsAfter,
      };
      reconnectBriefCleared =
        briefWasPendingBeforeReconnect &&
        reconnectServerReady &&
        reconnectEntryCleared &&
        reconnectProbe.completed &&
        reconnectProbe.terminal === "idle" &&
        reconnectHookCalled &&
        !reconnectBriefApplied &&
        reconnectInspectionAfterPrompt?.sessionEntries === 0 &&
        reconnectProbe.providerRequestOccurred &&
        reconnectBriefObservedByProvider === false &&
        reconnectHealth.providerConfigMatchesMockOrigin &&
        reconnectHealth.mockProviderListening;
      markCheck("privateServerReconnectSucceeded", reconnectServerReady);
      markCheck("preReconnectBriefClearedFromPluginState", reconnectEntryCleared);
      markCheck("preReconnectBriefNotAppliedToMatchingPostReconnectPrompt", reconnectBriefCleared);
      markCheck("postReconnectProviderRequestObserved", reconnectProbe.providerRequestOccurred);
      markCheck("restartedChildUsesSameMockProviderOrigin", reconnectHealth.providerConfigMatchesMockOrigin);
      markCheck("mockProviderListenerSurvivesPrivateChildReconnect", reconnectHealth.mockProviderListening);
      markCheck("postReconnectPromptMessageSummaryCaptured", reconnectProbe.messages !== null);

      operationStage = "reconnect-bisection";
      const noBriefHealth = await reconnectPrivateChild();
      const noBriefProbe = await runReconnectProbe(
        noBriefExistingSession.id,
        messageID(),
        FIXTURE_MARKERS.reconnectNoBrief,
        "reconnectNoBrief",
        noBriefHealth,
        false,
      );
      manifest.reconnectBisection.noBriefExistingSession = noBriefProbe;

      const newSessionHealth = await reconnectPrivateChild();
      const postReconnectNewSession = await native.session.create({
        title: "Scribe context spike reconnect new session",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const newSessionProbe = await runReconnectProbe(
        postReconnectNewSession.id,
        messageID(),
        FIXTURE_MARKERS.reconnectNewSession,
        "reconnectNewSession",
        newSessionHealth,
        false,
      );
      manifest.reconnectBisection.newSession = newSessionProbe;
      const reconnectNoBriefExistingSessionPass =
        noBriefProbe.completed &&
        noBriefProbe.terminal === "idle" &&
        noBriefProbe.messages?.assistantMessageExists === true &&
        noBriefProbe.providerRequestOccurred &&
        noBriefProbe.briefObservedByProvider === false &&
        noBriefProbe.providerConfigMatchesMockOrigin &&
        noBriefProbe.mockProviderListening &&
        noBriefProbe.hookCallsBefore !== null &&
        noBriefProbe.hookCallsAfter !== null &&
        noBriefProbe.hookCallsAfter > noBriefProbe.hookCallsBefore &&
        noBriefProbe.hookInternalExceptionsAfter === noBriefProbe.hookInternalExceptionsBefore;
      const reconnectNewSessionPass =
        newSessionProbe.completed &&
        newSessionProbe.terminal === "idle" &&
        newSessionProbe.messages?.assistantMessageExists === true &&
        newSessionProbe.providerRequestOccurred &&
        newSessionProbe.briefObservedByProvider === false &&
        newSessionProbe.providerConfigMatchesMockOrigin &&
        newSessionProbe.mockProviderListening &&
        newSessionProbe.hookCallsBefore !== null &&
        newSessionProbe.hookCallsAfter !== null &&
        newSessionProbe.hookCallsAfter > newSessionProbe.hookCallsBefore &&
        newSessionProbe.hookInternalExceptionsAfter === newSessionProbe.hookInternalExceptionsBefore;
      markCheck("reconnectNoBriefExistingSessionReachesProviderAndCompletes", reconnectNoBriefExistingSessionPass);
      markCheck("reconnectNewSessionReachesProviderAndCompletes", reconnectNewSessionPass);

      operationStage = "bounded-rpc-validation";
      const oversizedBriefRejected = await putRejectedOrNotAccepted(() =>
        rpc.put({ sessionID: scout.id, turnID: randomUUID(), brief: "x".repeat(MAX_BRIEF_BYTES + 1) }, location),
      );
      const unicodeOversizedBriefRejected = await putRejectedOrNotAccepted(() =>
        rpc.put({ sessionID: scout.id, turnID: randomUUID(), brief: "é".repeat(MAX_BRIEF_BYTES / 2 + 1) }, location),
      );
      const invalidSessionKeyRejected = await putRejectedOrNotAccepted(() =>
        rpc.put({ sessionID: "invalid/key", turnID: "valid-turn", brief: "bounded" }, location),
      );
      const invalidTurnKeyRejected = await putRejectedOrNotAccepted(() =>
        rpc.put({ sessionID: "valid-session", turnID: "invalid/key", brief: "bounded" }, location),
      );
      const oversizedSessionKeyRejected = await putRejectedOrNotAccepted(() =>
        rpc.put({ sessionID: "s".repeat(MAX_KEY_BYTES + 1), turnID: "valid-turn", brief: "bounded" }, location),
      );
      const oversizedTurnKeyRejected = await putRejectedOrNotAccepted(() =>
        rpc.put({ sessionID: "valid-session", turnID: "t".repeat(MAX_KEY_BYTES + 1), brief: "bounded" }, location),
      );
      const exactBriefSession = "brief-boundary-session";
      const exactBriefTurn = "brief-boundary-turn";
      const exactBriefAccepted = accepted(
        await rpc.put(
          { sessionID: exactBriefSession, turnID: exactBriefTurn, brief: "b".repeat(MAX_BRIEF_BYTES) },
          location,
        ),
      );
      const exactBriefCleared =
        clearCount(await rpc.clear({ sessionID: exactBriefSession, turnID: exactBriefTurn }, location)) === 1;
      const exactKeySession = "k".repeat(MAX_KEY_BYTES);
      const exactKeyTurn = "t".repeat(MAX_KEY_BYTES);
      const exactKeyAccepted = accepted(
        await rpc.put({ sessionID: exactKeySession, turnID: exactKeyTurn, brief: "bounded" }, location),
      );
      const exactKeyCleared =
        clearCount(await rpc.clear({ sessionID: exactKeySession, turnID: exactKeyTurn }, location)) === 1;
      const capacityAccepted: boolean[] = [];
      for (let index = 0; index < MAX_ACTIVE_BRIEFS; index += 1) {
        capacityAccepted.push(
          accepted(
            await rpc.put(
              { sessionID: `capacity-session-${index}`, turnID: `capacity-turn-${index}`, brief: "bounded" },
              location,
            ),
          ),
        );
      }
      const overCapacityRejected = await putRejectedOrNotAccepted(() =>
        rpc.put(
          { sessionID: "capacity-session-overflow", turnID: "capacity-turn-overflow", brief: "bounded" },
          location,
        ),
      );
      const capacityCleared = await Promise.all(
        Array.from({ length: MAX_ACTIVE_BRIEFS }, (_, index) =>
          rpc.clear({ sessionID: `capacity-session-${index}` }, location),
        ),
      ).then((results) => results.every((result) => clearCount(result) === 1));
      const sizeBoundEnforced =
        oversizedBriefRejected &&
        unicodeOversizedBriefRejected &&
        invalidSessionKeyRejected &&
        invalidTurnKeyRejected &&
        oversizedSessionKeyRejected &&
        oversizedTurnKeyRejected &&
        exactBriefAccepted &&
        exactBriefCleared &&
        exactKeyAccepted &&
        exactKeyCleared &&
        capacityAccepted.every(Boolean) &&
        overCapacityRejected &&
        capacityCleared;

      operationStage = "stop-clearing";
      const stopSession = await native.session.create({
        title: "Scribe context spike Stop isolation",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      sessionsCreated += 1;
      const stopTurn = messageID();
      const stopPutAccepted = accepted(
        await rpc.put({ sessionID: stopSession.id, turnID: stopTurn, brief: BRIEF_MARKERS.stop }, location),
      );
      await native.session.prompt(
        { sessionID: stopSession.id, id: stopTurn, text: FIXTURE_MARKERS.stop },
        { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
      );
      const stopRequestArrived = await Promise.race([
        stopRequestSeen.then(() => true),
        new Promise<boolean>((resolveDelay) => setTimeout(() => resolveDelay(false), PROMPT_TIMEOUT_MS)),
      ]);
      let stopAcknowledged = false;
      if (stopRequestArrived) {
        const interrupted = await native.session.interrupt(
          { sessionID: stopSession.id, resume: false },
          { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
        );
        stopAcknowledged = record(interrupted) && interrupted.interrupted === true;
      }
      releaseStopResponse?.();
      releaseStopResponse = undefined;
      await native.session
        .wait({ sessionID: stopSession.id }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) })
        .catch(() => undefined);
      const stopClear = await rpc.clear({ sessionID: stopSession.id, turnID: stopTurn }, location);
      const stopInspection = parseInspection(await rpc.inspect({ sessionID: stopSession.id }, location));
      const stopRequest = requestObservations.find((request) => request.group === "stop");
      const stopCleared =
        stopPutAccepted &&
        stopRequestArrived &&
        stopAcknowledged &&
        stopRequest?.briefStop === true &&
        stopInspection?.sessionEntries === 0 &&
        stopInspection.hasActiveTurn === false &&
        clearCount(stopClear) === 1;
      markCheck("turnEndClearRemovedBoundBrief", turnEndCleared);
      markCheck("nextPromptInvalidatedStaleBrief", nextPromptClearedStale);
      markCheck("stopClearRemovedBoundBrief", stopCleared);
      const stoppedNextTurn = messageID();
      await native.session.prompt(
        { sessionID: stopSession.id, id: stoppedNextTurn, text: FIXTURE_MARKERS.next },
        { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
      );
      await native.session.wait({ sessionID: stopSession.id }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
      const stopFollowup = requestObservations.filter((request) => request.group === "next").at(-1);
      const stopFollowupClear = stopFollowup !== undefined && !stopFollowup.briefStop;
      markCheck("stoppedBriefAbsentFromFollowupRequest", stopFollowupClear);

      operationStage = "session-generate-measurement";
      const generateBefore = await native.session.context({ sessionID: generate.id });
      const generateSamples: number[] = [];
      for (const prompt of FIXTURE_MARKERS.generate) {
        const started = performance.now();
        const result = await native.session.generate(
          { sessionID: generate.id, prompt },
          { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
        );
        generateSamples.push(performance.now() - started);
        markCheck("sessionGenerateReturnedSyntheticResult", record(result) && result.text === "SYNTHETIC_SPIKE_RESULT");
      }
      const generateAfter = await native.session.context({ sessionID: generate.id });
      const generateRequests = requestObservations.filter((request) => request.group === "generate");
      const generateContextInspection = parseInspection(await rpc.inspect({ sessionID: generate.id }, location));
      const generateContextCalls = generateContextInspection?.calls ?? [];
      manifest.counts.contextHookSessionGenerateObservationCount = generateContextCalls.length;
      manifest.counts.contextHookSessionGenerateAgents = generateContextCalls
        .map((call) => call.agent)
        .filter((agent): agent is string => agent !== null)
        .slice(0, 4);
      markCheck(
        "sessionGenerateInvokesContextHookForRestrictedAgent",
        generateContextCalls.length === FIXTURE_MARKERS.generate.length &&
          generateContextCalls.every((call) => call.agent === RESTRICTED_REVIEW_AGENT_NAME),
      );
      const generateNoTools =
        generateRequests.length === FIXTURE_MARKERS.generate.length &&
        generateRequests.every((request) => request.noToolDefinitions);
      const generateNoHistory = JSON.stringify(generateBefore) === JSON.stringify(generateAfter);

      operationStage = "scout-session-generate-secondary";
      const scoutGenerateSamples: number[] = [];
      for (const prompt of FIXTURE_MARKERS.scoutGenerate) {
        const started = performance.now();
        const result = await native.session.generate(
          { sessionID: scoutGenerate.id, prompt },
          { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
        );
        scoutGenerateSamples.push(performance.now() - started);
        markCheck(
          "scoutSessionGenerateReturnedSyntheticResult",
          record(result) && result.text === "SYNTHETIC_SPIKE_RESULT",
        );
      }
      const scoutGenerateRequests = requestObservations.filter((request) => request.group === "scoutGenerate");
      const scoutGenerateNoTools =
        scoutGenerateRequests.length === FIXTURE_MARKERS.scoutGenerate.length &&
        scoutGenerateRequests.every((request) => request.noToolDefinitions);

      operationStage = "hidden-session-classification-measurement";
      const hiddenSamples: number[] = [];
      for (const prompt of FIXTURE_MARKERS.hiddenClassify) {
        const turnID = messageID();
        const started = performance.now();
        await native.session.prompt(
          { sessionID: hidden.id, id: turnID, text: prompt },
          { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
        );
        await native.session.wait({ sessionID: hidden.id }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
        hiddenSamples.push(performance.now() - started);
      }
      const hiddenClassifyRequests = requestObservations.filter((request) => request.group === "hiddenClassify");
      const hiddenNoTools =
        hiddenClassifyRequests.length === FIXTURE_MARKERS.hiddenClassify.length &&
        hiddenClassifyRequests.every((request) => request.noToolDefinitions);
      const toolCounts = {
        sessionGenerate: generateRequests.length === 0 ? null : (generateRequests[0]?.toolDefinitionCount ?? null),
        scoutSessionGenerate:
          scoutGenerateRequests.length === 0 ? null : (scoutGenerateRequests[0]?.toolDefinitionCount ?? null),
        hiddenSession:
          hiddenClassifyRequests.length === 0 ? null : (hiddenClassifyRequests[0]?.toolDefinitionCount ?? null),
        hiddenReviewer: hiddenRequest?.toolDefinitionCount ?? null,
        scout: scoutRequest?.toolDefinitionCount ?? null,
        write: writeRequest?.toolDefinitionCount ?? null,
        skillProbe: skillProbeRequests.length === 0 ? null : (skillProbeRequests[0]?.toolDefinitionCount ?? null),
      };
      manifest.counts.toolDefinitionCounts = toolCounts;
      manifest.counts.toolDefinitionCountSamples = {
        sessionGenerate: generateRequests.map((request) => request.toolDefinitionCount),
        scoutSessionGenerate: scoutGenerateRequests.map((request) => request.toolDefinitionCount),
        hiddenSession: hiddenClassifyRequests.map((request) => request.toolDefinitionCount),
        hiddenReviewer: hiddenRequest ? [hiddenRequest.toolDefinitionCount] : [],
        skillProbe: skillProbeRequests.map((request) => request.toolDefinitionCount),
      };
      manifest.counts.toolDefinitionNameSamples = {
        sessionGenerate: generateRequests.map((request) => request.toolDefinitionNames),
        scoutSessionGenerate: scoutGenerateRequests.map((request) => request.toolDefinitionNames),
        hiddenSession: hiddenClassifyRequests.map((request) => request.toolDefinitionNames),
        hiddenReviewer: hiddenRequest ? [hiddenRequest.toolDefinitionNames] : [],
        skillProbe: skillProbeRequests.map((request) => request.toolDefinitionNames),
      };
      manifest.counts.toolDefinitionValiditySamples = {
        sessionGenerate: generateRequests.map((request) => request.toolDefinitionsValid),
        scoutSessionGenerate: scoutGenerateRequests.map((request) => request.toolDefinitionsValid),
        hiddenSession: hiddenClassifyRequests.map((request) => request.toolDefinitionsValid),
        hiddenReviewer: hiddenRequest ? [hiddenRequest.toolDefinitionsValid] : [],
        skillProbe: skillProbeRequests.map((request) => request.toolDefinitionsValid),
      };
      manifest.latencyMs = {
        sessionGenerate: {
          samples: generateSamples.map((value) => Math.round(value * 100) / 100),
          median: median(generateSamples),
          range: range(generateSamples),
        },
        hiddenSession: {
          samples: hiddenSamples.map((value) => Math.round(value * 100) / 100),
          median: median(hiddenSamples),
          range: range(hiddenSamples),
        },
        scoutSessionGenerate: {
          samples: scoutGenerateSamples.map((value) => Math.round(value * 100) / 100),
          median: median(scoutGenerateSamples),
          range: range(scoutGenerateSamples),
        },
        source: "local-mock-provider-only",
      };

      const overlayLoaded =
        contextPluginState === "active" &&
        throwingPluginState === "active" &&
        configHasNoPlugins &&
        noProjectConfig &&
        snapshotsMatch(configBefore ?? new Map(), await snapshotTree(paths.config));
      manifest.pluginSourceLoadedFromPrivateOverlay = overlayLoaded;
      manifest.bundledFixtureDirectoryLoaded =
        contextPluginState === "active" && throwingPluginState === "active" && isAbsolute(contextPluginDirectory);
      manifest.privateOriginAuthenticated =
        privateApiAuthorizationSeen && unauthenticatedStatus === 401 && rpcRequests > 0 && privateOrigin !== undefined;

      const bProven =
        scoutPutAccepted &&
        scoutRequest?.briefScout === true &&
        briefAbsentFromPersistentState &&
        turnEndCleared &&
        nextPromptClearedStale &&
        noCrossSessionLeak &&
        requestObservations.every((request) => request.group !== "next" || !request.briefScout);
      const dProven =
        sizeBoundEnforced &&
        manifest.counts.toolDefinitionCounts !== undefined &&
        turnEndCleared &&
        nextPromptClearedStale &&
        noCrossSessionLeak &&
        stopCleared &&
        stopFollowupClear &&
        reconnectBriefCleared &&
        reconnectNoBriefExistingSessionPass &&
        reconnectNewSessionPass;
      const cProven = Boolean(
        manifest.pluginSourceLoadedFromPrivateOverlay &&
          manifest.bundledFixtureDirectoryLoaded &&
          manifest.privateOriginAuthenticated &&
          !externalFetchAttempted,
      );
      const classificationPath = generateNoTools ? "session.generate" : hiddenNoTools ? "hidden-session" : null;
      manifest.selectedClassificationPath = classificationPath;
      const classificationToolSetsMatch =
        generateRequests.length === hiddenClassifyRequests.length &&
        generateRequests.every((request, index) => {
          const hiddenRequest = hiddenClassifyRequests[index];
          return (
            hiddenRequest !== undefined &&
            request.toolDefinitionsValid &&
            hiddenRequest.toolDefinitionsValid &&
            request.toolDefinitionCount === hiddenRequest.toolDefinitionCount &&
            JSON.stringify(request.toolDefinitionNames) === JSON.stringify(hiddenRequest.toolDefinitionNames)
          );
        });
      const comparisonMeasured =
        generateRequests.length === FIXTURE_MARKERS.generate.length &&
        hiddenClassifyRequests.length === FIXTURE_MARKERS.hiddenClassify.length &&
        generateSamples.length === FIXTURE_MARKERS.generate.length &&
        hiddenSamples.length === FIXTURE_MARKERS.hiddenClassify.length &&
        classificationToolSetsMatch &&
        generateRequests.every(
          (request) =>
            request.toolDefinitionsValid && request.toolDefinitionCount >= 0 && request.toolDefinitionNames !== null,
        ) &&
        hiddenClassifyRequests.every(
          (request) =>
            request.toolDefinitionsValid && request.toolDefinitionCount >= 0 && request.toolDefinitionNames !== null,
        ) &&
        manifest.latencyMs.sessionGenerate.median !== null &&
        manifest.latencyMs.hiddenSession.median !== null;
      const scoutGenerateMeasured =
        scoutGenerateRequests.length === FIXTURE_MARKERS.scoutGenerate.length &&
        scoutGenerateSamples.length === FIXTURE_MARKERS.scoutGenerate.length &&
        scoutGenerateRequests.every(
          (request) =>
            request.toolDefinitionsValid && request.toolDefinitionCount >= 0 && request.toolDefinitionNames !== null,
        ) &&
        manifest.latencyMs.scoutSessionGenerate.median !== null;
      const fProven = comparisonMeasured && classificationPath !== null && generateNoHistory;
      manifest.criteria.b = bProven ? "PASS" : "FAIL";
      manifest.criteria.c = cProven ? "PASS" : "FAIL";
      manifest.criteria.d = dProven ? "PASS" : "FAIL";
      manifest.criteria.e = failureIsolated ? "PASS" : "FAIL";
      manifest.criteria.f = fProven ? "PASS" : "FAIL";
      markCheck("outgoingContextMarkerObservedOnlyOnMatchingScoutCall", scoutRequest?.briefScout === true);
      markCheck(
        "briefExcludedFromPersistentSessionAndConfigurationState",
        briefAbsentFromPersistentState && overlayLoaded,
      );
      markCheck("hostToPluginRpcUsesAuthenticatedPrivateOrigin", manifest.privateOriginAuthenticated);
      markCheck("briefAndKeyBoundsEnforced", sizeBoundEnforced);
      markCheck(
        "explicitTurnEndAndStopClearsAndNextPromptInvalidation",
        turnEndCleared && stopCleared && nextPromptClearedStale,
      );
      markCheck("crossSessionBriefIsolation", noCrossSessionLeak);
      markCheck("failureLeavesPrivateServerAndOrdinaryChatUsable", failureIsolated);
      markCheck("sessionGenerateAndHiddenSessionRequestsHaveNoToolDefinitions", generateNoTools && hiddenNoTools);
      markCheck("sessionGenerateDoesNotPersistHistory", generateNoHistory);
      markCheck("noNonLoopbackFetchAttemptObserved", !externalFetchAttempted);
      markCheck("sessionGenerateToolDefinitionCountIsZero", generateNoTools);
      markCheck("hiddenSessionToolDefinitionCountIsZero", hiddenNoTools);
      markCheck("hiddenReviewerRequestHasZeroToolDefinitions", hiddenRequest?.noToolDefinitions === true);
      markCheck(
        "classificationToolDefinitionMetadataCaptured",
        comparisonMeasured &&
          generateRequests.every((request) => request.toolDefinitionNames?.length === request.toolDefinitionCount) &&
          hiddenClassifyRequests.every(
            (request) => request.toolDefinitionNames?.length === request.toolDefinitionCount,
          ),
      );
      markCheck("classificationToolDefinitionSetsMatch", classificationToolSetsMatch);
      markCheck("sessionGenerateAndHiddenSessionComparisonMeasured", comparisonMeasured);
      markCheck("scoutSessionGenerateSecondaryObservationMeasured", scoutGenerateMeasured);
      markCheck("classificationPathUsesZeroToolDefinitions", classificationPath !== null);
      markCheck(
        "advertisedSkillExecutionDeniedSeparately",
        skillProbeRequests.length === 2 &&
          skillProbeRequests.every(
            (request) => request.toolDefinitionsValid && request.toolDefinitionNames?.includes("skill"),
          ) &&
          skillPermissionDenied === true &&
          !skillSentinelDelivered &&
          skillProbeOutcome.completed &&
          skillProbeOutcome.terminal === "idle",
      );
      markCheck("skillSentinelNotDeliveredToMockProvider", !skillSentinelDelivered);
      markCheck("reconnectClearsPreReconnectBrief", reconnectBriefCleared);
      markCheck(
        "reconnectBisectDistinguishesExistingAndNewSessions",
        reconnectNoBriefExistingSessionPass && reconnectNewSessionPass,
      );

      const statusReady =
        observedVersion === EXPECTED_VERSION &&
        observedHash === EXPECTED_EXECUTABLE_SHA256 &&
        observedClient === EXPECTED_CLIENT &&
        privateApiRequests <= MAX_PRIVATE_REQUESTS &&
        providerRequests <= MAX_PROVIDER_REQUESTS &&
        maxProviderBodyBytes <= MAX_PROVIDER_BODY_BYTES &&
        Date.now() - startedAt <= OVERALL_TIMEOUT_MS;
      if (!statusReady) manifest.failureCode = "runtime_identity_or_request_bound_failed";
      if (classificationPath === null) manifest.failureCode = "strict_no_tools_classification_path_unavailable";
      manifest.status =
        Object.values(manifest.criteria).every((verdict) => verdict === "PASS") &&
        statusReady &&
        manifest.checks.advertisedSkillExecutionDeniedSeparately === true &&
        manifest.checks.classificationToolDefinitionMetadataCaptured === true &&
        manifest.checks.hiddenReviewerRequestHasZeroToolDefinitions === true
          ? "PASS"
          : "FAIL";
    } catch (error) {
      if (manifest.status !== "BLOCKED") manifest.status = "FAIL";
      manifest.failureStage = operationStage;
      manifest.failureErrorClass = fixedErrorClass(error);
      if (!manifest.failureCode)
        manifest.failureCode = error instanceof Error ? "fixture_operation_failed" : "unknown_failure";
      if (manifest.criteria.a === "UNPROVEN" && requestObservations.length > 0) manifest.criteria.a = "FAIL";
      if (manifest.criteria.b === "UNPROVEN" && requestObservations.some((request) => request.briefScout))
        manifest.criteria.b = "FAIL";
      void error;
    } finally {
      clearTimeout(overallTimer);
      releaseStopResponse?.();
      releaseStopResponse = undefined;
      if (agent) {
        try {
          await agent.stopForReconnect();
          manifest.cleanup.agentStopped = true;
        } catch {
          manifest.cleanup.agentStopped = false;
          manifest.status = "FAIL";
          manifest.failureCode ??= "agent_cleanup_failed";
        }
      }
      if (provider) {
        await new Promise<void>((resolveClose) => provider!.close(() => resolveClose()));
        fixtureClosed = true;
      }
      if (environmentReplaced) {
        restoreEnvironment(originalEnvironment);
        environmentReplaced = false;
      }
      manifest.cleanup.environmentRestored = environmentMatches(originalEnvironment);
      if (fetchReplaced) {
        globalThis.fetch = originalFetch;
        fetchReplaced = false;
      }
      manifest.cleanup.fetchRestored = globalThis.fetch === originalFetch;
      manifest.cleanup.fixtureClosed = fixtureClosed;
      const configUnchanged = configBefore ? snapshotsMatch(configBefore, await snapshotTree(paths.config)) : null;
      markCheck("noIsolatedConfigWritesAfterBaseline", configUnchanged);
      if (configUnchanged === false) {
        manifest.criteria.b = "FAIL";
        manifest.status = "FAIL";
        manifest.failureCode ??= "config_write_observed";
      }
      try {
        const owner = await readFile(join(runRoot, ".context-spike-owner"), "utf8");
        if (owner === ownerToken && dirname(resolve(runRoot)) === evidenceDirectory) {
          await assertOwnedPath(evidenceDirectory, runRoot);
          await rm(runRoot, { recursive: true, force: false, maxRetries: 0 });
          manifest.cleanup.runRootRemoved = true;
        } else {
          manifest.cleanup.runRootRemoved = false;
        }
      } catch {
        manifest.cleanup.runRootRemoved = false;
      }
      manifest.counts.privateApiRequests = privateApiRequests;
      manifest.counts.rpcRequests = rpcRequests;
      manifest.counts.providerRequests = providerRequests;
      manifest.counts.sessionsCreated = sessionsCreated;
      manifest.counts.maxProviderBodyBytes = maxProviderBodyBytes;
      try {
        await persist();
      } catch {
        manifest.status = "FAIL";
        manifest.failureCode ??= "evidence_persist_failed";
      }
    }

    expectPass();
  },
  OVERALL_TIMEOUT_MS + 30_000,
);
