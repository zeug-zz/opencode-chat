import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenCodeClient } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent";
import {
  createNativeTurnId,
  SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS,
  SCRIBE_REASONING_CONTEXT_GRACE_MS,
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES,
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS,
} from "../reasoning-context-plugin";

// @ts-expect-error The bundled plugin is intentionally plain JavaScript.
import * as rawPluginExports from "../scribe-context-plugin/server.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation";

const pluginDenials = rawPluginExports as unknown as {
  REASONING_SUBAGENT_DENIAL: string;
  SCOUT_DELEGATION_DENIAL: string;
  REASONING_SUBAGENT_TOOL_DENIAL: string;
};
const PLUGIN_DENIAL_MESSAGES = [
  pluginDenials.REASONING_SUBAGENT_DENIAL,
  pluginDenials.SCOUT_DELEGATION_DENIAL,
  pluginDenials.REASONING_SUBAGENT_TOOL_DENIAL,
] as const;

const PROJECT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const RUN_ENABLED = process.env.OPENCODE_CHAT_RUN_V2_CONTEXT_PLUGIN === "1";
const EXECUTABLE_INPUT = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const EXPECTED_EXECUTABLE = "/opt/homebrew/Cellar/opencode-v2/2.2.0/bin/opencode";
const EXPECTED_EXECUTABLE_SHA256 = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const EXPECTED_VERSION = "2.2.0";
const EXPECTED_CLIENT = "@opencode/client@2.1.0";
const EXPECTED_CLIENT_VERSION = "2.1.0";
const EXPECTED_PLUGIN_SHA256 = "f3d0027584a268bdd0e909729e3451e15e4e7d3fb1eb6856c209670edd96bd94";
const PRODUCTION_PLUGIN_ID = "drmrStudio.scribe-reasoning-context";
const PRODUCTION_RPC_ID = "scribe_reasoning_context";
const VSIX_PLUGIN_INPUT = process.env.OPENCODE_CHAT_V2_CONTEXT_PLUGIN_VSIX;
const VSIX_PLUGIN_ENTRIES = {
  packageManifest: "extension/dist/scribe-context-plugin/package.json",
  server: "extension/dist/scribe-context-plugin/server.js",
} as const;
const MAX_VSIX_PLUGIN_FILE_BYTES = 256 * 1024;
const EVIDENCE_DIRECTORY = "tmp/scribe-v2-migration/rebaseline-2.2.0/native-plugin-diagnostics";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/result.json`;
const PROMPT_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 150_000;
const MAX_PRIVATE_API_REQUESTS = 512;
const MAX_PROVIDER_REQUESTS = 64;
const MAX_PROVIDER_BODY_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;

const PROMPT_MARKERS = {
  scout: "SYNTHETIC_NATIVE_PLUGIN_SCOUT_TURN",
  scoutNext: "SYNTHETIC_NATIVE_PLUGIN_SCOUT_NEXT_TURN",
  multiCall: "SYNTHETIC_NATIVE_PLUGIN_MULTI_CALL_TURN",
  pendingBrief: "SYNTHETIC_NATIVE_PLUGIN_PENDING_BRIEF_TURN",
  pendingTimeout: "SYNTHETIC_NATIVE_PLUGIN_PENDING_TIMEOUT_TURN",
  unpended: "SYNTHETIC_NATIVE_PLUGIN_UNPENDED_TURN",
  maximum: "SYNTHETIC_NATIVE_PLUGIN_MAXIMUM_TURN",
  build: "SYNTHETIC_NATIVE_PLUGIN_BUILD_TURN",
  crossSession: "SYNTHETIC_NATIVE_PLUGIN_SESSION_B_TURN",
  crossSessionOwner: "SYNTHETIC_NATIVE_PLUGIN_SESSION_A_TURN",
  stop: "SYNTHETIC_NATIVE_PLUGIN_STOP_TURN",
  stopFollowup: "SYNTHETIC_NATIVE_PLUGIN_STOP_FOLLOWUP",
  reconnect: "SYNTHETIC_NATIVE_PLUGIN_RECONNECT_TURN",
  reasoningOnce: "SYNTHETIC_NATIVE_PLUGIN_REASONING_ONCE_TURN",
  reasoningNext: "SYNTHETIC_NATIVE_PLUGIN_REASONING_NEXT_TURN",
  reasoningArbitrary: "SYNTHETIC_NATIVE_PLUGIN_REASONING_ARBITRARY_TURN",
  reasoningNearMissCase: "SYNTHETIC_NATIVE_PLUGIN_REASONING_NEAR_MISS_CASE_TURN",
  reasoningNearMissSuffix: "SYNTHETIC_NATIVE_PLUGIN_REASONING_NEAR_MISS_SUFFIX_TURN",
  reasoningWorker: "SYNTHETIC_NATIVE_PLUGIN_REASONING_WORKER_TURN",
  buildReasoningCritic: "SYNTHETIC_NATIVE_PLUGIN_BUILD_REASONING_CRITIC_TURN",
  buildReasoningVerifier: "SYNTHETIC_NATIVE_PLUGIN_BUILD_REASONING_VERIFIER_TURN",
  reasoningBackground: "SYNTHETIC_NATIVE_PLUGIN_REASONING_BACKGROUND_TURN",
} as const;

const CHILD_PROMPT_MARKERS = {
  criticOnce: "SYNTHETIC_NATIVE_PLUGIN_REASONING_CRITIC_CHILD",
  verifierOnce: "SYNTHETIC_NATIVE_PLUGIN_REASONING_VERIFIER_CHILD",
  criticNext: "SYNTHETIC_NATIVE_PLUGIN_REASONING_NEXT_CRITIC_CHILD",
  worker: "SYNTHETIC_NATIVE_PLUGIN_REASONING_WORKER_CHILD",
  criticBackground: "SYNTHETIC_NATIVE_PLUGIN_REASONING_BACKGROUND_CRITIC_CHILD",
} as const;

const SUBAGENT_RESULT_TRUNCATION_MARKER = "\n[truncated by OpenCode Scribe]";
const BACKGROUND_RESULT_END_MARKER = "SYNTHETIC_NATIVE_PLUGIN_BACKGROUND_RESULT_END";
const EXPECTED_NATIVE_REASONING_NON_DENY_RULES = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
] as const;

const BRIEF_MARKERS = {
  scout: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_SCOUT",
  multiCall: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_MULTI_CALL",
  pending: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_PENDING",
  maximum: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_MAXIMUM",
  build: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_BUILD",
  crossSession: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_CROSS_SESSION",
  stop: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_STOP",
  reconnect: "SYNTHETIC_NATIVE_PLUGIN_BRIEF_RECONNECT",
} as const;

type Verdict = "PASS" | "FAIL" | "BLOCKED";
type RequestObservation = {
  promptMarker: string | null;
  childMarker: string | null;
  parentCallIndex: number | null;
  briefMarkers: string[];
  bodyBytes: number;
  toolDefinitionCount: number;
  toolDefinitionNames: string[];
  toolDefinitionNamesTruncated: boolean;
  executeToolAvailable: boolean;
  subagentToolAvailable: boolean;
  toolResultPresent: boolean;
  subagentDenialPresent: boolean;
  subagentDenialCategory: string | null;
  subagentDenialAttribution: "parent-scout-session" | "reasoning-child-session" | null;
  toolResultTextLengths: number[];
  truncationMarkerPresent: boolean;
  scribeToolNamePresent: boolean;
};
type FailureObservation = {
  boundary: "private-api" | "provider";
  endpoint: "prompt" | "rpc" | "other";
  rpcMethod: "pending" | "put" | "clear" | null;
  operationStage: string;
  status: number;
  requestIssueFields: string[];
  issueCode: string | null;
  bodyCategory: string | null;
};
type PermissionDiagnosticRule = {
  index: number;
  action: string;
  resource: string;
  effect: string;
};
type Snapshot = Map<string, string>;
type NativeManifest = {
  schemaVersion: 1;
  runId: string;
  status: "RUNNING" | Verdict;
  pluginArtifactMode: "repository-source" | "vsix-extracted";
  expectedVersion: string;
  observedVersion: string | null;
  expectedExecutableSha256: string;
  observedExecutableSha256: string | null;
  executablePathMatchesPin: boolean;
  expectedClient: string;
  observedClient: string | null;
  expectedPluginSha256: string;
  observedPluginSha256: string | null;
  evidencePath: string;
  fixtureRoot: string;
  pluginSourceLoadedFromPrivateOverlay: boolean | null;
  pluginActivationState: "active" | "failed" | "absent" | null;
  pluginFailureCategory: string | null;
  finalPluginActivationState: "active" | "failed" | "absent" | null;
  finalPluginFailureCategory: string | null;
  reasoningProfiles: {
    scoutPresent: boolean | null;
    scoutMode: "all" | "primary" | "subagent" | null;
    scoutPermissionCount: number | null;
    scoutAllowedTargetCount: number | null;
    scoutAllowsWorker: boolean | null;
    scoutAllowsCritic: boolean | null;
    scoutAllowsVerifier: boolean | null;
    scoutAllowsExactTargets: boolean | null;
    scoutAllowsOtherSubagents: boolean | null;
    criticPresent: boolean | null;
    criticMode: "all" | "primary" | "subagent" | null;
    criticPermissionCount: number | null;
    criticHidden: boolean | null;
    criticHasModel: boolean | null;
    criticNonDenyPermissionCount: number | null;
    criticNonDenyRules: PermissionDiagnosticRule[];
    criticIsHiddenDenyOnly: boolean | null;
    criticHasDenyBaselineWithoutAllows: boolean | null;
    verifierPresent: boolean | null;
    verifierMode: "all" | "primary" | "subagent" | null;
    verifierPermissionCount: number | null;
    verifierHidden: boolean | null;
    verifierHasModel: boolean | null;
    verifierNonDenyPermissionCount: number | null;
    verifierNonDenyRules: PermissionDiagnosticRule[];
    verifierIsHiddenDenyOnly: boolean | null;
    verifierHasDenyBaselineWithoutAllows: boolean | null;
  };
  reasoningAttempts: Array<{
    scenario: "once" | "next-turn" | "background";
    parentCallIndex: number;
    denialPresent: boolean;
    denialCategory: string | null;
    denialResultAttribution: "parent-scout-session" | "reasoning-child-session" | null;
    toolResultTextLengths: number[];
  }>;
  reasoningChildToolObservations: Array<{
    scenario: "critic-once" | "verifier-once" | "critic-next-turn" | "critic-background";
    toolDefinitionCount: number;
    toolDefinitionNames: string[];
    toolDefinitionNamesTruncated: boolean;
  }>;
  reasoningChildPermissionDiagnostics: Array<{
    role: "critic" | "verifier";
    agentSkillRule: SkillFilterRuleDiagnostic | null;
    agentHasWildcardSkillDeny: boolean;
    sessionPermissionCount: number | null;
    sessionSkillRule: SkillFilterRuleDiagnostic | null;
    toolSnapshotFiltersSkill: boolean | null;
  }>;
  buildAttempts: Array<{
    target: "chat-reasoning-critic" | "chat-reasoning-verifier";
    denialCategory: string | null;
    denialProvenance: "plugin" | "native" | "unrecognized";
    reasoningChildCount: number;
  }>;
  privateOriginAuthenticated: boolean | null;
  privateServerReady: boolean | null;
  grace: {
    configuredGraceMs: number;
    pluginCeilingMs: number;
    pendingBriefInternalWaitMs: number | null;
    pendingTimeoutInternalWaitMs: number | null;
    pendingTimeoutTurnElapsedMs: number | null;
    unpendedTurnElapsedMs: number | null;
  };
  checks: Record<string, boolean | null>;
  scenarios: {
    scoutBriefObserved: boolean | null;
    multiCallTurnCarriesBrief: boolean | null;
    pendingBriefDeliveredWithinGrace: boolean | null;
    pendingTimeoutProceedsWithoutBrief: boolean | null;
    unpendedTurnDoesNotWait: boolean | null;
    historyAndInstructionsAbsent: boolean | null;
    nextTurnBriefAbsent: boolean | null;
    maximumBriefObserved: boolean | null;
    buildBriefAbsent: boolean | null;
    crossSessionIsolated: boolean | null;
    stopClearEffective: boolean | null;
    reconnectClearEffective: boolean | null;
    pluginHasNoToolContribution: boolean | null;
    configUnchanged: boolean | null;
    criticAndVerifierAllowedOncePerTurn: boolean | null;
    reasoningTargetsResetOnNextTurn: boolean | null;
    arbitraryAndNearMissTargetsDenied: boolean | null;
    workerStillAllowed: boolean | null;
    buildCannotDelegateToReasoningTargets: boolean | null;
    reasoningChildrenReceiveNoTools: boolean | null;
    backgroundCallCountedOnceAndCompleted: boolean | null;
    repeatedDenialAttributedToParentScoutTurn: boolean | null;
    foregroundReasoningResultCapped: boolean | null;
    backgroundResultCapResidualObserved: boolean | null;
  };
  counts: {
    privateApiRequests: number;
    rpcRequests: number;
    providerRequests: number;
    sessionsCreated: number;
    reasoningSubagentChildren: number;
    subagentToolCalls: number;
    reasoningChildProviderRequests: number;
    foregroundReasoningResultCharacters: number | null;
    backgroundSyntheticResultCharacters: number | null;
    maxProviderBodyBytes: number;
  };
  failureObservations: FailureObservation[];
  cleanup: {
    agentStopped: boolean | null;
    providerClosed: boolean;
    environmentRestored: boolean;
    fetchRestored: boolean;
    runRootRemoved: boolean | null;
  };
  failureStage: string | null;
  failureCode?: string;
  durationMs: number | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsText(value: unknown, marker: string, depth = 0): boolean {
  if (depth > 32) return false;
  if (typeof value === "string") return value.includes(marker);
  if (Array.isArray(value)) return value.some((entry) => containsText(entry, marker, depth + 1));
  if (record(value)) return Object.values(value).some((entry) => containsText(entry, marker, depth + 1));
  return false;
}

function stringValues(value: unknown, depth = 0): string[] {
  if (depth > 32) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => stringValues(entry, depth + 1));
  if (record(value)) return Object.values(value).flatMap((entry) => stringValues(entry, depth + 1));
  return [];
}

function requestToolNames(value: unknown): string[] {
  if (!record(value) || !Array.isArray(value.tools)) return [];
  const names: string[] = [];
  for (const entry of value.tools) {
    if (!record(entry)) continue;
    if (record(entry.function) && typeof entry.function.name === "string") names.push(entry.function.name);
    else if (typeof entry.name === "string") names.push(entry.name);
  }
  return names;
}

function toolDefinitionCount(value: unknown): number {
  if (!record(value) || value.tools === undefined) return 0;
  return Array.isArray(value.tools) ? value.tools.length : -1;
}

function boundedToolDefinitionNames(names: string[]): { names: string[]; truncated: boolean } {
  const maxNames = 12;
  return {
    names: names.slice(0, maxNames).map((name) => (/^[A-Za-z0-9_.-]{1,64}$/u.test(name) ? name : "other")),
    truncated: names.length > maxNames,
  };
}

type SkillFilterRuleDiagnostic = {
  action: "skill" | "*";
  effect: "allow" | "ask" | "deny" | "other";
  resource: string;
  resourceKind: "wildcard" | "scoped" | "missing";
};

function lastSkillFilterRule(rules: unknown[]): SkillFilterRuleDiagnostic | null {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (!record(rule) || (rule.action !== "skill" && rule.action !== "*")) continue;
    return {
      action: rule.action,
      effect: rule.effect === "allow" || rule.effect === "ask" || rule.effect === "deny" ? rule.effect : "other",
      resource:
        typeof rule.resource === "string" && /^[A-Za-z0-9_.*?/-]{1,128}$/u.test(rule.resource)
          ? rule.resource
          : "<redacted>",
      resourceKind: typeof rule.resource !== "string" ? "missing" : rule.resource === "*" ? "wildcard" : "scoped",
    };
  }
  return null;
}

function latestUserContent(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.messages)) return undefined;
  for (let index = value.messages.length - 1; index >= 0; index -= 1) {
    const message = value.messages[index];
    if (record(message) && message.role === "user") return message.content;
  }
  return undefined;
}

function classifyPrompt(value: unknown): string | null {
  const content = latestUserContent(value);
  return Object.values(PROMPT_MARKERS).find((marker) => containsText(content, marker)) ?? null;
}

function safeErrorClass(error: unknown): string {
  if (error instanceof Error && ["Error", "TypeError", "AbortError", "TimeoutError"].includes(error.name)) {
    return error.name;
  }
  return "UnknownError";
}

function safeHttpStatus(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/\b(4\d\d|5\d\d)\b/u);
  return match?.[1];
}

function safeNativeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const categories: Array<[RegExp, string]> = [
    [/Native V2 prompt did not return a valid user-admission response/u, "prompt_admission_shape_mismatch"],
    [/fetch failed|network error/u, "network_request_failed"],
    [/unknown model|model .* not found|provider .* not found/u, "provider_model_unavailable"],
    [/unauthorized|forbidden/u, "private_request_unauthorized"],
  ];
  return categories.find(([pattern]) => pattern.test(error.message))?.[1];
}

function digestPluginFiles(packageManifest: Uint8Array, server: Uint8Array): string {
  return createHash("sha256")
    .update("package.json\0")
    .update(packageManifest)
    .update("\0server.js\0")
    .update(server)
    .digest("hex");
}

function readVsixPluginEntry(
  projectRoot: string,
  vsixPath: string,
  entry: string,
  environment: Pick<V2TestIsolation["paths"], "home" | "tmp">,
): Buffer {
  return execFileSync("unzip", ["-p", vsixPath, entry], {
    cwd: projectRoot,
    env: { PATH: "/usr/bin:/bin", HOME: environment.home, TMPDIR: environment.tmp },
    maxBuffer: MAX_VSIX_PLUGIN_FILE_BYTES,
  });
}

function loopbackURL(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function requestHasAuthorization(input: string | URL | Request, init?: RequestInit): boolean {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, name) => {
      headers.set(name, value);
    });
  }
  return headers.has("authorization");
}

function loopbackOnly(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function endpointClass(url: URL): FailureObservation["endpoint"] {
  if (/\/api\/rpc\//u.test(url.pathname)) return "rpc";
  if (/\/(?:api\/)?session\/[^/]+\/prompt(?:\/|$)/u.test(url.pathname)) return "prompt";
  return "other";
}

function rpcMethod(url: URL): FailureObservation["rpcMethod"] {
  const match = url.pathname.match(/\/api\/rpc\/scribe_reasoning_context\/(pending|put|clear)$/u);
  return match?.[1] === "pending" || match?.[1] === "put" || match?.[1] === "clear" ? match[1] : null;
}

function safeResponseIssueMetadata(value: unknown): Pick<FailureObservation, "requestIssueFields" | "issueCode"> {
  const allowedFields = new Set([
    "sessionID",
    "id",
    "text",
    "files",
    "agents",
    "skills",
    "metadata",
    "delivery",
    "resume",
    "messageID",
  ]);
  const requestIssueFields = new Set<string>();
  let issueCode: string | null = null;
  const visit = (entry: unknown, depth = 0): void => {
    if (depth > 8 || !record(entry)) return;
    if (Array.isArray(entry.path)) {
      for (const segment of entry.path) {
        if (typeof segment === "string" && allowedFields.has(segment)) requestIssueFields.add(segment);
      }
    }
    if (typeof entry.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(entry.code) && issueCode === null) {
      issueCode = entry.code;
    }
    for (const nested of Object.values(entry)) {
      if (Array.isArray(nested)) {
        for (const item of nested) visit(item, depth + 1);
      } else if (record(nested)) {
        visit(nested, depth + 1);
      }
    }
  };
  visit(value);
  return { requestIssueFields: [...requestIssueFields].slice(0, 8), issueCode };
}

function safeResponseBodyCategory(value: string): string | null {
  const rpcCategories: Array<[RegExp, string]> = [
    [/rpc\.unavailable|rpc is unavailable/iu, "rpc_unavailable"],
    [/rpc\.method_not_found|unknown rpc method/iu, "rpc_method_not_found"],
    [/rpc\.invalid_input|invalid rpc input/iu, "rpc_invalid_input"],
    [/rpc\.invalid_output|invalid rpc output/iu, "rpc_invalid_output"],
    [/rpc\.internal|rpc call failed/iu, "rpc_internal"],
  ];
  const rpcCategory = rpcCategories.find(([pattern]) => pattern.test(value))?.[1];
  if (rpcCategory) return rpcCategory;
  const categories: Array<[RegExp, string]> = [
    [/unknown agent|agent .* not found/u, "agent_unavailable"],
    [/unknown model|model .* not found|provider .* not found/u, "provider_model_unavailable"],
    [/invalid .*prompt|invalid request|validation/u, "request_validation"],
    [/permission|forbidden|unauthorized/u, "permission_rejected"],
    [/no model|model .* required/u, "model_selection_missing"],
    [/plugin|hook/u, "plugin_or_hook_error"],
    [/bad request/u, "generic_bad_request"],
  ];
  return categories.find(([pattern]) => pattern.test(value))?.[1] ?? (value.length > 0 ? "unclassified" : null);
}

function pluginState(value: unknown): "active" | "failed" | "absent" {
  if (!record(value) || !Array.isArray(value.data)) return "absent";
  const entry = value.data.find((candidate) => record(candidate) && candidate.id === PRODUCTION_PLUGIN_ID);
  if (!record(entry) || !record(entry.state)) return "absent";
  return entry.state.status === "active" ? "active" : entry.state.status === "failed" ? "failed" : "absent";
}

function pluginFailureCategory(value: unknown): string | null {
  if (!record(value) || !Array.isArray(value.data)) return null;
  const entry = value.data.find((candidate) => record(candidate) && candidate.id === PRODUCTION_PLUGIN_ID);
  if (!record(entry) || !record(entry.state)) return null;
  const details = [entry.state.error, entry.state.message, entry.state.reason]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .join(" ")
    .toLowerCase();
  if (!details) return null;
  if (/transform failed|disabled after .*transform/u.test(details)) return "plugin_transform_failed";
  if (/tool.*hook|hook.*tool/u.test(details)) return "tool_hook_registration";
  if (/syntax|unexpected token|parse error/u.test(details)) return "plugin_parse_error";
  if (/timeout|timed out/u.test(details)) return "plugin_load_timeout";
  if (/cannot read propert|undefined.*(?:hook|register)|not a function/u.test(details)) return "plugin_api_unavailable";
  const safeTerms = new Set([
    "failed",
    "could",
    "not",
    "read",
    "property",
    "tool",
    "hook",
    "unavailable",
    "module",
    "import",
    "permission",
    "syntax",
    "unexpected",
    "plugin",
    "error",
    "undefined",
    "timeout",
    "invalid",
    "request",
    "unsupported",
    "effect",
    "service",
    "tag",
    "register",
    "denied",
    "cannot",
    "resolve",
    "missing",
    "loading",
  ]);
  const tokens = details
    .match(/[a-z]+/gu)
    ?.filter((term) => safeTerms.has(term))
    .slice(0, 8);
  return tokens?.length ? `plugin_failure_${tokens.join("_")}` : "unclassified_plugin_failure";
}

function pluginSourceMatches(value: unknown, sourceDirectory: string): boolean {
  if (!record(value) || !Array.isArray(value.data)) return false;
  const entry = value.data.find((candidate) => record(candidate) && candidate.id === PRODUCTION_PLUGIN_ID);
  if (!record(entry) || !record(entry.source) || typeof entry.source.path !== "string") return false;
  const source = resolve(entry.source.path);
  const bundle = resolve(sourceDirectory);
  return source === bundle || source.startsWith(`${bundle}${sep}`);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return predicate();
}

async function waitForAsync<T>(predicate: () => Promise<T | undefined>, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result !== undefined) return result;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return predicate();
}

function sse(text: string): string {
  const packet = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
  return `${packet({ role: "assistant" })}${packet({ content: text })}${packet({}, "stop")}data: [DONE]\n\n`;
}

function executeToolCallSSE(callID: string, code: string): string {
  const packet = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
  return `${packet({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: callID,
        type: "function",
        function: { name: "execute", arguments: JSON.stringify({ code }) },
      },
    ],
  })}${packet({}, "tool_calls")}data: [DONE]\n\n`;
}

function subagentToolCallSSE(callID: string, agent: string, prompt: string, background = false): string {
  const args = { agent, description: "bounded reasoning", prompt, ...(background ? { background: true } : {}) };
  const packet = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
  return `${packet({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: callID,
        type: "function",
        function: { name: "subagent", arguments: JSON.stringify(args) },
      },
    ],
  })}${packet({}, "tool_calls")}data: [DONE]\n\n`;
}

function toolResultTexts(value: unknown): string[] {
  if (!record(value) || !Array.isArray(value.messages)) return [];
  let latestUserIndex = -1;
  for (let index = 0; index < value.messages.length; index += 1) {
    const message = value.messages[index];
    if (record(message) && message.role === "user") latestUserIndex = index;
  }
  if (latestUserIndex < 0) return [];
  const text = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content))
      return content
        .filter((part) => record(part) && part.type === "text" && typeof part.text === "string")
        .map((part) => String(part.text))
        .join("\n");
    return record(content) && typeof content.text === "string" ? content.text : "";
  };
  return value.messages
    .slice(latestUserIndex + 1)
    .filter((message) => record(message) && message.role === "tool")
    .map((message) => text(message.content));
}

function subagentDenialCategory(texts: string[]): string | null {
  if (texts.some((text) => PLUGIN_DENIAL_MESSAGES.some((message) => text.includes(message))))
    return "scribe_reasoning_denied";
  if (texts.some((text) => /subagent denied/iu.test(text))) return "subagent_denied";
  if (texts.some((text) => /permission denied|permission rejected/iu.test(text))) return "permission_rejected";
  if (texts.some((text) => /unknown agent|not available|no tool named/iu.test(text))) return "target_unavailable";
  return null;
}

function subagentDenialAttribution(texts: string[]): RequestObservation["subagentDenialAttribution"] {
  if (texts.some((text) => text.includes(pluginDenials.REASONING_SUBAGENT_TOOL_DENIAL)))
    return "reasoning-child-session";
  if (
    texts.some(
      (text) =>
        text.includes(pluginDenials.REASONING_SUBAGENT_DENIAL) || text.includes(pluginDenials.SCOUT_DELEGATION_DENIAL),
    )
  )
    return "parent-scout-session";
  return null;
}

function reasoningAttemptsFor(observations: RequestObservation[]): NativeManifest["reasoningAttempts"] {
  return observations
    .flatMap((entry) => {
      const scenario: NativeManifest["reasoningAttempts"][number]["scenario"] | null =
        entry.promptMarker === PROMPT_MARKERS.reasoningOnce
          ? "once"
          : entry.promptMarker === PROMPT_MARKERS.reasoningNext
            ? "next-turn"
            : entry.promptMarker === PROMPT_MARKERS.reasoningBackground
              ? "background"
              : null;
      if (scenario === null || entry.parentCallIndex === null) return [];
      return [
        {
          scenario,
          parentCallIndex: entry.parentCallIndex,
          denialPresent: entry.subagentDenialPresent,
          denialCategory: entry.subagentDenialCategory,
          denialResultAttribution: entry.subagentDenialAttribution,
          toolResultTextLengths: entry.toolResultTextLengths.slice(0, 4),
        },
      ];
    })
    .slice(0, 16);
}

function childPromptMarker(value: unknown): string | null {
  const content = latestUserContent(value);
  return Object.values(CHILD_PROMPT_MARKERS).find((marker) => containsText(content, marker)) ?? null;
}

function hasToolResult(value: unknown): boolean {
  return (
    record(value) &&
    Array.isArray(value.messages) &&
    value.messages.some((message) => record(message) && message.role === "tool")
  );
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

async function snapshotTree(root: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) {
        const [bytes, info] = await Promise.all([readFile(fullPath), stat(fullPath)]);
        snapshot.set(relative(root, fullPath), `${createHash("sha256").update(bytes).digest("hex")}:${info.size}`);
      }
    }
  };
  await walk(root);
  return snapshot;
}

function snapshotsMatch(before: Snapshot, after: Snapshot): boolean {
  return before.size === after.size && [...before].every(([name, fingerprint]) => after.get(name) === fingerprint);
}

function environmentMatches(snapshot: NodeJS.ProcessEnv): boolean {
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(process.env)]);
  return [...keys].every((key) => snapshot[key] === process.env[key]);
}

function restoreEnvironment(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, snapshot);
}

function nativeClient(agent: OpenCodeAgent): OpenCodeClient {
  const client = (agent as unknown as { v2Client?: OpenCodeClient }).v2Client;
  if (!client) throw new Error("private_client_unavailable");
  return client;
}

function activePlugin(value: unknown): boolean {
  return pluginState(value) === "active";
}

async function waitForProductionPlugin(client: OpenCodeClient, workspace: string): Promise<unknown> {
  let result: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    result = await client.plugin.list({ location: { directory: workspace } });
    if (activePlugin(result)) return result;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  return result;
}

describe("production Scribe context plugin native integration", () => {
  it.skipIf(!RUN_ENABLED)(
    "delivers and clears ephemeral briefs through OpenCodeAgent and the bundled production plugin",
    async () => {
      const root = await realpath(PROJECT_ROOT);
      const evidenceDirectory = resolve(root, EVIDENCE_DIRECTORY);
      await assertOwnedPath(root, evidenceDirectory);
      await mkdir(evidenceDirectory, { recursive: true });
      await assertOwnedPath(root, evidenceDirectory);
      const runId = randomUUID();
      const runRoot = join(evidenceDirectory, `run-${runId}`);
      await mkdir(runRoot, { recursive: false });
      await assertOwnedPath(evidenceDirectory, runRoot);
      const ownerToken = randomUUID();
      await writeFile(join(runRoot, ".context-plugin-native-owner"), ownerToken, { flag: "wx", mode: 0o600 });

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
      for (const directory of [paths.home, paths.config, paths.data, paths.cache, paths.state, paths.tmp, paths.cwd]) {
        await mkdir(directory, { recursive: true });
      }
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

      const pluginDirectory =
        VSIX_PLUGIN_INPUT === undefined
          ? resolve(root, "packages/agents/opencode/src/scribe-context-plugin")
          : join(runRoot, "extension", "dist", "scribe-context-plugin");
      await assertOwnedPath(root, pluginDirectory);
      const configPath = join(configDirectory, "opencode.json");
      const evidencePath = resolve(root, EVIDENCE_PATH);
      await assertOwnedPath(root, evidencePath);
      const originalEnvironment = { ...process.env };
      const originalFetch = globalThis.fetch;
      const manifest: NativeManifest = {
        schemaVersion: 1,
        runId,
        status: "RUNNING",
        pluginArtifactMode: VSIX_PLUGIN_INPUT === undefined ? "repository-source" : "vsix-extracted",
        expectedVersion: EXPECTED_VERSION,
        observedVersion: null,
        expectedExecutableSha256: EXPECTED_EXECUTABLE_SHA256,
        observedExecutableSha256: null,
        executablePathMatchesPin: false,
        expectedClient: EXPECTED_CLIENT,
        observedClient: null,
        expectedPluginSha256: EXPECTED_PLUGIN_SHA256,
        observedPluginSha256: null,
        evidencePath: EVIDENCE_PATH,
        fixtureRoot: EVIDENCE_DIRECTORY,
        pluginSourceLoadedFromPrivateOverlay: null,
        pluginActivationState: null,
        pluginFailureCategory: null,
        finalPluginActivationState: null,
        finalPluginFailureCategory: null,
        reasoningProfiles: {
          scoutPresent: null,
          scoutMode: null,
          scoutPermissionCount: null,
          scoutAllowedTargetCount: null,
          scoutAllowsWorker: null,
          scoutAllowsCritic: null,
          scoutAllowsVerifier: null,
          scoutAllowsExactTargets: null,
          scoutAllowsOtherSubagents: null,
          criticPresent: null,
          criticMode: null,
          criticPermissionCount: null,
          criticHidden: null,
          criticHasModel: null,
          criticNonDenyPermissionCount: null,
          criticNonDenyRules: [],
          criticIsHiddenDenyOnly: null,
          criticHasDenyBaselineWithoutAllows: null,
          verifierPresent: null,
          verifierMode: null,
          verifierPermissionCount: null,
          verifierHidden: null,
          verifierHasModel: null,
          verifierNonDenyPermissionCount: null,
          verifierNonDenyRules: [],
          verifierIsHiddenDenyOnly: null,
          verifierHasDenyBaselineWithoutAllows: null,
        },
        reasoningAttempts: [],
        reasoningChildToolObservations: [],
        reasoningChildPermissionDiagnostics: [],
        buildAttempts: [],
        privateOriginAuthenticated: null,
        privateServerReady: null,
        grace: {
          configuredGraceMs: SCRIBE_REASONING_CONTEXT_GRACE_MS,
          pluginCeilingMs: SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS,
          pendingBriefInternalWaitMs: null,
          pendingTimeoutInternalWaitMs: null,
          pendingTimeoutTurnElapsedMs: null,
          unpendedTurnElapsedMs: null,
        },
        checks: {},
        scenarios: {
          scoutBriefObserved: null,
          multiCallTurnCarriesBrief: null,
          pendingBriefDeliveredWithinGrace: null,
          pendingTimeoutProceedsWithoutBrief: null,
          unpendedTurnDoesNotWait: null,
          historyAndInstructionsAbsent: null,
          nextTurnBriefAbsent: null,
          maximumBriefObserved: null,
          buildBriefAbsent: null,
          crossSessionIsolated: null,
          stopClearEffective: null,
          reconnectClearEffective: null,
          pluginHasNoToolContribution: null,
          configUnchanged: null,
          criticAndVerifierAllowedOncePerTurn: null,
          reasoningTargetsResetOnNextTurn: null,
          arbitraryAndNearMissTargetsDenied: null,
          workerStillAllowed: null,
          buildCannotDelegateToReasoningTargets: null,
          reasoningChildrenReceiveNoTools: null,
          backgroundCallCountedOnceAndCompleted: null,
          repeatedDenialAttributedToParentScoutTurn: null,
          foregroundReasoningResultCapped: null,
          backgroundResultCapResidualObserved: null,
        },
        counts: {
          privateApiRequests: 0,
          rpcRequests: 0,
          providerRequests: 0,
          sessionsCreated: 0,
          reasoningSubagentChildren: 0,
          subagentToolCalls: 0,
          reasoningChildProviderRequests: 0,
          foregroundReasoningResultCharacters: null,
          backgroundSyntheticResultCharacters: null,
          maxProviderBodyBytes: 0,
        },
        failureObservations: [],
        cleanup: {
          agentStopped: null,
          providerClosed: false,
          environmentRestored: false,
          fetchRestored: false,
          runRootRemoved: null,
        },
        failureStage: null,
        durationMs: null,
      };
      const startedAt = Date.now();
      const observations: RequestObservation[] = [];
      const parentRequestCountByMarker = new Map<string, number>();
      let provider: Server | undefined;
      let providerOrigin: string | undefined;
      let privateOrigin: string | undefined;
      let agent: OpenCodeAgent | undefined;
      let environmentReplaced = false;
      let fetchReplaced = false;
      let configBefore: Snapshot | undefined;
      let providerClosed = false;
      let externalFetchAttempted = false;
      let privateAuthorizationSeen = false;
      let releaseStopResponse: (() => void) | undefined;
      let resolveStopRequest: (() => void) | undefined;
      let stopResponseHeld = false;
      const stopRequestArrived = new Promise<void>((resolvePromise) => {
        resolveStopRequest = resolvePromise;
      });
      let privateApiRequests = 0;
      let rpcRequests = 0;
      let providerRequests = 0;
      let sessionsCreated = 0;
      let reasoningSubagentChildren = 0;
      let subagentToolCalls = 0;
      let reasoningChildProviderRequests = 0;
      let foregroundReasoningResultCharacters: number | null = null;
      let backgroundSyntheticResultCharacters: number | null = null;
      let maxProviderBodyBytes = 0;
      let multiCallRequestCount = 0;
      let backgroundChildSeen = false;
      let releaseBackgroundChildResponse: (() => void) | undefined;
      let operationStage = "preflight";

      const persist = async (): Promise<void> => {
        manifest.counts = {
          privateApiRequests,
          rpcRequests,
          providerRequests,
          sessionsCreated,
          reasoningSubagentChildren,
          subagentToolCalls,
          reasoningChildProviderRequests,
          foregroundReasoningResultCharacters,
          backgroundSyntheticResultCharacters,
          maxProviderBodyBytes,
        };
        manifest.reasoningAttempts = reasoningAttemptsFor(observations);
        manifest.cleanup.providerClosed = providerClosed || provider === undefined;
        manifest.cleanup.environmentRestored = environmentMatches(originalEnvironment);
        manifest.cleanup.fetchRestored = globalThis.fetch === originalFetch;
        manifest.durationMs = Date.now() - startedAt;
        const body = `${JSON.stringify(manifest, null, 2)}\n`;
        if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) {
          manifest.status = "FAIL";
          manifest.failureCode = "manifest_bound_exceeded";
          throw new Error("manifest_bound_exceeded");
        }
        await writeFile(evidencePath, body, { mode: 0o600 });
      };

      try {
        const executable = EXECUTABLE_INPUT && isAbsolute(EXECUTABLE_INPUT) ? resolve(EXECUTABLE_INPUT) : undefined;
        manifest.executablePathMatchesPin = executable === EXPECTED_EXECUTABLE;
        manifest.checks.executablePathMatchesPin = manifest.executablePathMatchesPin;
        if (!executable || !manifest.executablePathMatchesPin) {
          manifest.status = "BLOCKED";
          manifest.failureCode = "executable_path_missing_or_mismatched";
          throw new Error("blocked_preflight");
        }
        const executableBytes = await readFile(executable);
        manifest.observedExecutableSha256 = createHash("sha256").update(executableBytes).digest("hex");
        manifest.checks.executableSha256MatchesPin = manifest.observedExecutableSha256 === EXPECTED_EXECUTABLE_SHA256;
        if (!manifest.checks.executableSha256MatchesPin) {
          manifest.status = "BLOCKED";
          manifest.failureCode = "executable_sha256_mismatch";
          throw new Error("blocked_preflight");
        }

        const clientManifest = JSON.parse(
          await readFile(resolve(root, "packages/agents/opencode/node_modules/@opencode/client/package.json"), "utf8"),
        ) as unknown;
        manifest.observedClient =
          record(clientManifest) &&
          clientManifest.name === "@opencode/client" &&
          typeof clientManifest.version === "string"
            ? `${clientManifest.name}@${clientManifest.version}`
            : null;
        manifest.checks.clientPackageMatchesPin = manifest.observedClient === EXPECTED_CLIENT;
        if (!manifest.checks.clientPackageMatchesPin) {
          manifest.status = "BLOCKED";
          manifest.failureCode = "client_package_mismatch";
          throw new Error("blocked_preflight");
        }

        let pluginPackage: Buffer;
        let pluginServer: Buffer;
        if (VSIX_PLUGIN_INPUT === undefined) {
          [pluginPackage, pluginServer] = await Promise.all([
            readFile(join(pluginDirectory, "package.json")),
            readFile(join(pluginDirectory, "server.js")),
          ]);
        } else {
          if (isAbsolute(VSIX_PLUGIN_INPUT)) {
            throw new Error("vsix_input_must_be_project_relative");
          }
          const vsixPath = resolve(root, VSIX_PLUGIN_INPUT);
          await assertOwnedPath(root, vsixPath);
          if (!(await stat(vsixPath)).isFile()) throw new Error("vsix_input_not_a_file");
          [pluginPackage, pluginServer] = [
            readVsixPluginEntry(root, vsixPath, VSIX_PLUGIN_ENTRIES.packageManifest, paths),
            readVsixPluginEntry(root, vsixPath, VSIX_PLUGIN_ENTRIES.server, paths),
          ];
          if (
            pluginPackage.byteLength > MAX_VSIX_PLUGIN_FILE_BYTES ||
            pluginServer.byteLength > MAX_VSIX_PLUGIN_FILE_BYTES
          ) {
            throw new Error("vsix_plugin_entry_exceeds_bound");
          }
          await mkdir(pluginDirectory, { recursive: true });
          await assertOwnedPath(runRoot, pluginDirectory);
          await Promise.all([
            writeFile(join(pluginDirectory, "package.json"), pluginPackage, { flag: "wx", mode: 0o600 }),
            writeFile(join(pluginDirectory, "server.js"), pluginServer, { flag: "wx", mode: 0o600 }),
          ]);
        }
        manifest.observedPluginSha256 = digestPluginFiles(pluginPackage, pluginServer);
        manifest.checks.productionPluginSha256MatchesPin = manifest.observedPluginSha256 === EXPECTED_PLUGIN_SHA256;
        if (!manifest.checks.productionPluginSha256MatchesPin) {
          manifest.status = "BLOCKED";
          manifest.failureCode = "production_plugin_sha256_mismatch";
          throw new Error("blocked_preflight");
        }

        const ambient = await inspectAmbientConfigSources();
        const gate = evaluateStaticPrelaunchGate(environment, paths, ambient);
        manifest.checks.isolatedEnvironmentAndAmbientConfigClear = gate.status === "READY_FOR_DISPOSABLE_SPIKE";
        if (gate.status !== "READY_FOR_DISPOSABLE_SPIKE") {
          manifest.status = "BLOCKED";
          manifest.failureCode = "ambient_or_environment_preflight_blocked";
          throw new Error("blocked_preflight");
        }

        operationStage = "local-provider-start";
        provider = createServer(async (request, response) => {
          if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
            if (manifest.failureObservations.length < 8) {
              manifest.failureObservations.push({
                boundary: "provider",
                endpoint: "other",
                rpcMethod: null,
                operationStage,
                status: 404,
                requestIssueFields: [],
                issueCode: null,
                bodyCategory: null,
              });
            }
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
            const bodyBytes = Buffer.concat(chunks);
            const bodyText = bodyBytes.toString("utf8");
            const body = JSON.parse(bodyText) as unknown;
            const promptMarker = classifyPrompt(body);
            const childMarker = childPromptMarker(body);
            const parentCallIndex =
              promptMarker === null || childMarker !== null
                ? null
                : (parentRequestCountByMarker.get(promptMarker) ?? 0) + 1;
            if (promptMarker !== null && parentCallIndex !== null)
              parentRequestCountByMarker.set(promptMarker, parentCallIndex);
            const briefMarkers = Object.values(BRIEF_MARKERS).filter((marker) => containsText(body, marker));
            const toolNames = requestToolNames(body);
            const boundedToolNames = boundedToolDefinitionNames(toolNames);
            const toolResultPresent = hasToolResult(body);
            const results = toolResultTexts(body);
            const denialCategory = subagentDenialCategory(results);
            const subagentDenialPresent = denialCategory !== null;
            if (childMarker !== null) {
              if (childMarker !== CHILD_PROMPT_MARKERS.worker) reasoningChildProviderRequests += 1;
            }
            maxProviderBodyBytes = Math.max(maxProviderBodyBytes, size);
            observations.push({
              promptMarker,
              childMarker,
              parentCallIndex,
              briefMarkers,
              bodyBytes: size,
              toolDefinitionCount: toolDefinitionCount(body),
              toolDefinitionNames: boundedToolNames.names,
              toolDefinitionNamesTruncated: boundedToolNames.truncated,
              executeToolAvailable: toolNames.includes("execute"),
              subagentToolAvailable: toolNames.includes("subagent"),
              toolResultPresent,
              subagentDenialPresent,
              subagentDenialCategory: denialCategory,
              subagentDenialAttribution: subagentDenialAttribution(results),
              toolResultTextLengths: results.map((text) => text.length),
              truncationMarkerPresent: results.some((text) => text.includes(SUBAGENT_RESULT_TRUNCATION_MARKER)),
              scribeToolNamePresent: toolNames.some((name) => /scribe[_-]reasoning[_-]context/iu.test(name)),
            });
            if (observations.length > MAX_PROVIDER_REQUESTS) observations.shift();

            if (promptMarker === PROMPT_MARKERS.stop && !stopResponseHeld) {
              stopResponseHeld = true;
              resolveStopRequest?.();
              await new Promise<void>((resolveRelease) => {
                releaseStopResponse = resolveRelease;
              });
            }
            if (!response.destroyed && !response.headersSent) {
              response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
              if (childMarker === CHILD_PROMPT_MARKERS.criticOnce) {
                const oversizedCriticResult = `{"kind":"critique","items":[],"extra":"${"R".repeat(3_000)}"}`;
                response.end(sse(oversizedCriticResult));
              } else if (childMarker === CHILD_PROMPT_MARKERS.verifierOnce) {
                response.end(sse('{"kind":"verification","items":[]}'));
              } else if (childMarker === CHILD_PROMPT_MARKERS.criticNext) {
                response.end(sse('{"kind":"critique","items":[]}'));
              } else if (childMarker === CHILD_PROMPT_MARKERS.worker) {
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_WORKER_COMPLETED"));
              } else if (childMarker === CHILD_PROMPT_MARKERS.criticBackground) {
                backgroundChildSeen = true;
                await new Promise<void>((resolveRelease) => {
                  releaseBackgroundChildResponse = resolveRelease;
                });
                response.end(sse(`${"B".repeat(2_300)}${BACKGROUND_RESULT_END_MARKER}`));
              } else if (promptMarker === PROMPT_MARKERS.reasoningOnce && parentCallIndex === 1) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE(
                    "reasoning-critic-first",
                    "chat-reasoning-critic",
                    CHILD_PROMPT_MARKERS.criticOnce,
                  ),
                );
              } else if (promptMarker === PROMPT_MARKERS.reasoningOnce && parentCallIndex === 2) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE(
                    "reasoning-critic-repeat",
                    "chat-reasoning-critic",
                    "SYNTHETIC_NATIVE_PLUGIN_REASONING_CRITIC_REPEAT_CHILD",
                  ),
                );
              } else if (promptMarker === PROMPT_MARKERS.reasoningOnce && parentCallIndex === 3) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE(
                    "reasoning-verifier-first",
                    "chat-reasoning-verifier",
                    CHILD_PROMPT_MARKERS.verifierOnce,
                  ),
                );
              } else if (promptMarker === PROMPT_MARKERS.reasoningOnce) {
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_REASONING_ONCE_COMPLETE"));
              } else if (promptMarker === PROMPT_MARKERS.reasoningNext && parentCallIndex === 1) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE(
                    "reasoning-critic-next-turn",
                    "chat-reasoning-critic",
                    CHILD_PROMPT_MARKERS.criticNext,
                  ),
                );
              } else if (promptMarker === PROMPT_MARKERS.reasoningNext) {
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_REASONING_NEXT_COMPLETE"));
              } else if (
                (promptMarker === PROMPT_MARKERS.reasoningArbitrary ||
                  promptMarker === PROMPT_MARKERS.reasoningNearMissCase ||
                  promptMarker === PROMPT_MARKERS.reasoningNearMissSuffix) &&
                parentCallIndex === 1
              ) {
                subagentToolCalls += 1;
                const target =
                  promptMarker === PROMPT_MARKERS.reasoningArbitrary
                    ? "build"
                    : promptMarker === PROMPT_MARKERS.reasoningNearMissCase
                      ? "Chat-Reasoning-Critic"
                      : "chat-reasoning-critic-x";
                response.end(subagentToolCallSSE(`deny-${parentCallIndex}`, target, "SYNTHETIC_DENIED_TARGET"));
              } else if (
                promptMarker === PROMPT_MARKERS.reasoningArbitrary ||
                promptMarker === PROMPT_MARKERS.reasoningNearMissCase ||
                promptMarker === PROMPT_MARKERS.reasoningNearMissSuffix
              ) {
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_DENIED_TARGET_COMPLETE"));
              } else if (promptMarker === PROMPT_MARKERS.reasoningWorker && parentCallIndex === 1) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE("reasoning-worker-allowed", "chat-research-worker", CHILD_PROMPT_MARKERS.worker),
                );
              } else if (promptMarker === PROMPT_MARKERS.reasoningWorker) {
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_WORKER_PARENT_COMPLETE"));
              } else if (
                (promptMarker === PROMPT_MARKERS.buildReasoningCritic ||
                  promptMarker === PROMPT_MARKERS.buildReasoningVerifier) &&
                parentCallIndex === 1
              ) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE(
                    `build-denied-${parentCallIndex}`,
                    promptMarker === PROMPT_MARKERS.buildReasoningCritic
                      ? "chat-reasoning-critic"
                      : "chat-reasoning-verifier",
                    "SYNTHETIC_BUILD_REASONING_TARGET_DENIED",
                  ),
                );
              } else if (
                promptMarker === PROMPT_MARKERS.buildReasoningCritic ||
                promptMarker === PROMPT_MARKERS.buildReasoningVerifier
              ) {
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_BUILD_DENIED_COMPLETE"));
              } else if (promptMarker === PROMPT_MARKERS.reasoningBackground && parentCallIndex === 1) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE(
                    "reasoning-background-first",
                    "chat-reasoning-critic",
                    CHILD_PROMPT_MARKERS.criticBackground,
                    true,
                  ),
                );
              } else if (promptMarker === PROMPT_MARKERS.reasoningBackground && parentCallIndex === 2) {
                subagentToolCalls += 1;
                response.end(
                  subagentToolCallSSE(
                    "reasoning-background-repeat",
                    "chat-reasoning-critic",
                    "SYNTHETIC_NATIVE_PLUGIN_REASONING_BACKGROUND_REPEAT",
                  ),
                );
              } else if (promptMarker === PROMPT_MARKERS.reasoningBackground) {
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_REASONING_BACKGROUND_PARENT_COMPLETE"));
              } else if (promptMarker === PROMPT_MARKERS.multiCall && multiCallRequestCount === 0) {
                multiCallRequestCount += 1;
                response.end(executeToolCallSSE("scribe-multi-call-continuation", "return { continued: true };"));
              } else {
                if (promptMarker === PROMPT_MARKERS.multiCall) multiCallRequestCount += 1;
                response.end(sse("SYNTHETIC_NATIVE_PLUGIN_RESULT"));
              }
            }
          } catch {
            if (!response.destroyed && !response.headersSent) response.writeHead(400).end();
          }
        });
        const providerPort = await listen(provider);
        providerOrigin = `http://127.0.0.1:${providerPort}`;

        const providerConfig = {
          model: "fixture-provider/fixture-model",
          enabledProviders: ["fixture-provider"],
          providers: {
            "fixture-provider": {
              name: "Local production context-plugin integration provider",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: `${providerOrigin}/v1` },
              models: { "fixture-model": { name: "Synthetic local integration model" } },
            },
          },
        };
        await writeFile(configPath, `${JSON.stringify(providerConfig, null, 2)}\n`, { mode: 0o600 });
        const configReadback = JSON.parse(await readFile(configPath, "utf8")) as unknown;
        const providerConfigHasNoPluginEntry =
          record(configReadback) &&
          !Object.hasOwn(configReadback, "plugins") &&
          !Object.hasOwn(configReadback, "plugin") &&
          !containsText(configReadback, PRODUCTION_PLUGIN_ID) &&
          !containsText(configReadback, PRODUCTION_RPC_ID);
        manifest.checks.providerConfigContainsNoPluginOrRpcEntry = providerConfigHasNoPluginEntry;
        configBefore = await snapshotTree(paths.config);
        const projectConfigAbsent = await access(join(paths.cwd, "opencode.json")).then(
          () => false,
          () => true,
        );
        manifest.checks.projectConfigAbsent = projectConfigAbsent;

        const nativeFetch = originalFetch.bind(globalThis);
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const url = loopbackURL(input);
          if (!loopbackOnly(url)) {
            externalFetchAttempted = true;
            throw new Error("fixture_non_loopback_fetch_blocked");
          }
          if (url.origin !== providerOrigin) {
            privateApiRequests += 1;
            if (privateApiRequests > MAX_PRIVATE_API_REQUESTS) throw new Error("fixture_private_request_limit");
            if (!privateOrigin) privateOrigin = url.origin;
            if (url.pathname === "/api/info" && requestHasAuthorization(input, init)) privateAuthorizationSeen = true;
            if (/\/api\/rpc\//u.test(url.pathname)) rpcRequests += 1;
          }
          const boundary = url.origin === providerOrigin ? "provider" : "private-api";
          try {
            const response = await nativeFetch(input, init);
            if (!response.ok && manifest.failureObservations.length < 8) {
              const responseText = await response
                .clone()
                .text()
                .catch(() => "");
              let responseBody: unknown;
              try {
                responseBody = JSON.parse(responseText) as unknown;
              } catch {
                responseBody = undefined;
              }
              manifest.failureObservations.push({
                boundary,
                endpoint: endpointClass(url),
                rpcMethod: rpcMethod(url),
                operationStage,
                status: response.status,
                ...safeResponseIssueMetadata(responseBody),
                bodyCategory: safeResponseBodyCategory(responseText),
              });
            }
            return response;
          } catch {
            if (manifest.failureObservations.length < 8) {
              manifest.failureObservations.push({
                boundary,
                endpoint: endpointClass(url),
                rpcMethod: rpcMethod(url),
                operationStage,
                status: 0,
                requestIssueFields: [],
                issueCode: null,
                bodyCategory: null,
              });
            }
            throw new Error("fixture_loopback_request_failed");
          }
        }) as typeof fetch;
        fetchReplaced = true;
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, environment);
        environmentReplaced = true;
        assertIsolatedEnvironment(environment, paths);

        operationStage = "production-agent-connect";
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
          // This is the same package entry the extension adds after verifying
          // the production bundle hash; no spike fixture plugin is loaded.
          pluginSources: [{ package: pluginDirectory }],
        });
        await agent.connect();
        let native = nativeClient(agent);
        const serverInfo = await native.server.info();
        manifest.observedVersion = typeof serverInfo.version === "string" ? serverInfo.version : null;
        manifest.privateServerReady = manifest.observedVersion === EXPECTED_VERSION;
        manifest.checks.privateServerExactVersion = manifest.privateServerReady;
        manifest.privateOriginAuthenticated =
          privateOrigin !== undefined && privateAuthorizationSeen && rpcRequests > 0;
        manifest.checks.privateOriginAuthenticated = manifest.privateOriginAuthenticated;
        if (!providerOrigin || !privateOrigin) throw new Error("private_or_provider_origin_unobserved");

        operationStage = "production-plugin-activation";
        const initialPluginList = await waitForProductionPlugin(native, paths.cwd);
        manifest.pluginActivationState = pluginState(initialPluginList);
        manifest.pluginFailureCategory = pluginFailureCategory(initialPluginList);
        const productionPluginActive = manifest.pluginActivationState === "active";
        const productionPluginSourceMatches = pluginSourceMatches(initialPluginList, pluginDirectory);
        manifest.pluginSourceLoadedFromPrivateOverlay =
          productionPluginActive &&
          productionPluginSourceMatches &&
          providerConfigHasNoPluginEntry &&
          projectConfigAbsent;
        manifest.checks.productionPluginActiveFromPackageOverlay = productionPluginActive;
        manifest.checks.productionPluginSourceMatchesBundledPackage = productionPluginSourceMatches;
        manifest.checks.pluginLoadedWithoutConfigEntry = manifest.pluginSourceLoadedFromPrivateOverlay;
        if (!productionPluginActive || !productionPluginSourceMatches) throw new Error("production_plugin_not_active");

        const nativeAgents = await native.agent.list({ location: { directory: paths.cwd } });
        const agentProfiles = record(nativeAgents) && Array.isArray(nativeAgents.data) ? nativeAgents.data : [];
        const getAgentProfile = (id: string) => agentProfiles.find((entry) => entry.id === id);
        const scoutProfile = getAgentProfile("scout");
        const scoutPermissions =
          scoutProfile && Array.isArray(scoutProfile.permissions) ? scoutProfile.permissions : [];
        const nativeMode = (profile: Record<string, unknown> | undefined): "all" | "primary" | "subagent" | null =>
          profile?.mode === "all" || profile?.mode === "primary" || profile?.mode === "subagent" ? profile.mode : null;
        manifest.reasoningProfiles.scoutPresent = scoutProfile !== undefined;
        manifest.reasoningProfiles.scoutMode = nativeMode(scoutProfile);
        manifest.reasoningProfiles.scoutPermissionCount = scoutProfile ? scoutPermissions.length : null;
        const exactTargets = new Set(["chat-research-worker", "chat-reasoning-critic", "chat-reasoning-verifier"]);
        const scoutAllowedTargets = scoutPermissions
          .filter((rule) => rule.action === "subagent" && rule.effect === "allow")
          .map((rule) => rule.resource);
        manifest.reasoningProfiles.scoutAllowedTargetCount = scoutAllowedTargets.length;
        manifest.reasoningProfiles.scoutAllowsWorker = scoutAllowedTargets.includes("chat-research-worker");
        manifest.reasoningProfiles.scoutAllowsCritic = scoutAllowedTargets.includes("chat-reasoning-critic");
        manifest.reasoningProfiles.scoutAllowsVerifier = scoutAllowedTargets.includes("chat-reasoning-verifier");
        manifest.reasoningProfiles.scoutAllowsExactTargets =
          scoutAllowedTargets.length === exactTargets.size &&
          scoutAllowedTargets.every((target) => exactTargets.has(target));
        manifest.reasoningProfiles.scoutAllowsOtherSubagents = scoutAllowedTargets.some(
          (target) => !exactTargets.has(target),
        );
        const hiddenDenyOnly = (id: string): boolean => {
          const profile = getAgentProfile(id);
          const permissions = profile && Array.isArray(profile.permissions) ? profile.permissions : [];
          return (
            profile?.mode === "subagent" &&
            profile.hidden === true &&
            profile.model === undefined &&
            permissions.length > 0 &&
            permissions.every((rule) => rule.effect === "deny") &&
            permissions.some((rule) => rule.action === "*" && rule.resource === "*") &&
            permissions.some((rule) => rule.action === "execute" && rule.resource === "*")
          );
        };
        const hiddenDenyBaselineWithoutAllows = (id: string): boolean => {
          const profile = getAgentProfile(id);
          const permissions = profile && Array.isArray(profile.permissions) ? profile.permissions : [];
          return (
            profile?.mode === "subagent" &&
            profile.hidden === true &&
            profile.model === undefined &&
            permissions.length > 0 &&
            permissions.every((rule) => rule.effect !== "allow") &&
            permissions.some((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "deny") &&
            permissions.some((rule) => rule.action === "execute" && rule.resource === "*" && rule.effect === "deny")
          );
        };
        const profileDiagnostics = (id: string) => {
          const profile = getAgentProfile(id);
          const permissions = profile && Array.isArray(profile.permissions) ? profile.permissions : [];
          const nonDenyRules = permissions
            .flatMap((rule, index) =>
              !record(rule) || rule.effect === "deny"
                ? []
                : [
                    {
                      index,
                      action: typeof rule.action === "string" ? rule.action.slice(0, 128) : "<invalid>",
                      resource: typeof rule.resource === "string" ? rule.resource.slice(0, 128) : "<invalid>",
                      effect: typeof rule.effect === "string" ? rule.effect.slice(0, 32) : "<invalid>",
                    },
                  ],
            )
            .slice(0, 8);
          return {
            hidden: profile ? profile.hidden === true : null,
            hasModel: profile ? profile.model !== undefined : null,
            nonDenyPermissionCount: profile ? permissions.filter((rule) => rule.effect !== "deny").length : null,
            nonDenyRules,
          };
        };
        const criticProfile = getAgentProfile("chat-reasoning-critic");
        const criticPermissions =
          criticProfile && Array.isArray(criticProfile.permissions) ? criticProfile.permissions : [];
        const verifierProfile = getAgentProfile("chat-reasoning-verifier");
        const verifierPermissions =
          verifierProfile && Array.isArray(verifierProfile.permissions) ? verifierProfile.permissions : [];
        manifest.reasoningProfiles.criticPresent = criticProfile !== undefined;
        manifest.reasoningProfiles.criticMode = nativeMode(criticProfile);
        manifest.reasoningProfiles.criticPermissionCount = criticProfile ? criticPermissions.length : null;
        const criticDiagnostics = profileDiagnostics("chat-reasoning-critic");
        manifest.reasoningProfiles.criticHidden = criticDiagnostics.hidden;
        manifest.reasoningProfiles.criticHasModel = criticDiagnostics.hasModel;
        manifest.reasoningProfiles.criticNonDenyPermissionCount = criticDiagnostics.nonDenyPermissionCount;
        manifest.reasoningProfiles.criticNonDenyRules = criticDiagnostics.nonDenyRules;
        manifest.reasoningProfiles.criticHasDenyBaselineWithoutAllows =
          hiddenDenyBaselineWithoutAllows("chat-reasoning-critic");
        manifest.reasoningProfiles.verifierPresent = verifierProfile !== undefined;
        manifest.reasoningProfiles.verifierMode = nativeMode(verifierProfile);
        manifest.reasoningProfiles.verifierPermissionCount = verifierProfile ? verifierPermissions.length : null;
        const verifierDiagnostics = profileDiagnostics("chat-reasoning-verifier");
        manifest.reasoningProfiles.verifierHidden = verifierDiagnostics.hidden;
        manifest.reasoningProfiles.verifierHasModel = verifierDiagnostics.hasModel;
        manifest.reasoningProfiles.verifierNonDenyPermissionCount = verifierDiagnostics.nonDenyPermissionCount;
        manifest.reasoningProfiles.verifierNonDenyRules = verifierDiagnostics.nonDenyRules;
        manifest.reasoningProfiles.verifierHasDenyBaselineWithoutAllows =
          hiddenDenyBaselineWithoutAllows("chat-reasoning-verifier");
        manifest.reasoningProfiles.criticIsHiddenDenyOnly = hiddenDenyOnly("chat-reasoning-critic");
        manifest.reasoningProfiles.verifierIsHiddenDenyOnly = hiddenDenyOnly("chat-reasoning-verifier");
        manifest.checks.scoutAllowsOnlyExactReasoningAndWorkerTargets =
          manifest.reasoningProfiles.scoutAllowsExactTargets && !manifest.reasoningProfiles.scoutAllowsOtherSubagents;
        const hasHiddenExplicitDenyBaseline = (id: string): boolean => {
          const profile = getAgentProfile(id);
          const permissions = profile && Array.isArray(profile.permissions) ? profile.permissions : [];
          return (
            profile?.mode === "subagent" &&
            profile.hidden === true &&
            profile.model === undefined &&
            permissions.some((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "deny") &&
            permissions.some((rule) => rule.action === "execute" && rule.resource === "*" && rule.effect === "deny")
          );
        };
        manifest.checks.reasoningProfilesAreHiddenAndExplicitlyDenyExecute =
          hasHiddenExplicitDenyBaseline("chat-reasoning-critic") &&
          hasHiddenExplicitDenyBaseline("chat-reasoning-verifier");
        const nonDenyRulesRecordedWithinBound =
          manifest.reasoningProfiles.criticNonDenyPermissionCount ===
            manifest.reasoningProfiles.criticNonDenyRules.length &&
          manifest.reasoningProfiles.verifierNonDenyPermissionCount ===
            manifest.reasoningProfiles.verifierNonDenyRules.length &&
          manifest.reasoningProfiles.criticNonDenyRules.length <= 8 &&
          manifest.reasoningProfiles.verifierNonDenyRules.length <= 8;
        const expectedNativeDefaults = JSON.stringify(EXPECTED_NATIVE_REASONING_NON_DENY_RULES);
        const permissionRuleShape = (rules: PermissionDiagnosticRule[]) =>
          JSON.stringify(rules.map(({ action, resource, effect }) => ({ action, resource, effect })));
        const permissionRuleIndexes = (rules: PermissionDiagnosticRule[]) =>
          JSON.stringify(rules.map(({ index }) => index));
        manifest.checks.reasoningProfileNonDenyRulesMatchPinnedNativeBaseline =
          nonDenyRulesRecordedWithinBound &&
          permissionRuleShape(manifest.reasoningProfiles.criticNonDenyRules) === expectedNativeDefaults &&
          permissionRuleShape(manifest.reasoningProfiles.verifierNonDenyRules) === expectedNativeDefaults &&
          permissionRuleIndexes(manifest.reasoningProfiles.criticNonDenyRules) === "[0,1,2,3]" &&
          permissionRuleIndexes(manifest.reasoningProfiles.verifierNonDenyRules) === "[0,1,2,3]";
        const denyBaselineFollowsNativeDefaults = (id: string): boolean => {
          const profile = getAgentProfile(id);
          const permissions = profile && Array.isArray(profile.permissions) ? profile.permissions : [];
          const laterRules = permissions.slice(4);
          return (
            // Native 2.2.0 adds a scoped browser deny; preserve the minimum deny baseline checks.
            permissions.length >= 30 &&
            laterRules.length >= 26 &&
            laterRules.every((rule) => rule.effect === "deny") &&
            laterRules.some((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "deny") &&
            laterRules.some((rule) => rule.action === "execute" && rule.resource === "*" && rule.effect === "deny")
          );
        };
        // Native 2.2.0 uses the last matching configured rule, so the native default
        // non-deny prefix is harmless only while the trailing full deny baseline stays intact.
        manifest.checks.reasoningProfileNonDenyRulesAreShadowedByLaterDenyBaseline =
          denyBaselineFollowsNativeDefaults("chat-reasoning-critic") &&
          denyBaselineFollowsNativeDefaults("chat-reasoning-verifier");

        const clientForPrompt = (): OpenCodeClient => nativeClient(agent as OpenCodeAgent);
        const createdSessionIDs: string[] = [];
        const createSession = async (title: string, sessionAgent: "scout" | "build" = "scout"): Promise<string> => {
          const session = await clientForPrompt().session.create({
            title,
            agent: sessionAgent,
            location: { directory: paths.cwd },
          });
          sessionsCreated += 1;
          createdSessionIDs.push(session.id);
          return session.id;
        };
        const sendAndWait = async (
          sessionID: string,
          turnID: string,
          prompt: string,
          primaryAgent?: "scout" | "build",
        ): Promise<void> => {
          try {
            await agent?.sendMessage(sessionID, prompt, {
              turnID,
              ...(primaryAgent === undefined ? {} : { primaryAgent }),
            });
          } catch (error) {
            if (operationStage === "scout-brief-lifecycle" && prompt === PROMPT_MARKERS.scout) {
              try {
                const diagnosticTurnID = createNativeTurnId();
                await clientForPrompt().session.prompt(
                  { sessionID, id: diagnosticTurnID, text: prompt },
                  { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
                );
                await clientForPrompt().session.wait({ sessionID }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
                manifest.failureCode = "agent_send_message_rejected_but_direct_native_prompt_passed";
              } catch (diagnosticError) {
                manifest.failureCode = safeHttpStatus(diagnosticError)
                  ? `direct_native_prompt_http_${safeHttpStatus(diagnosticError)}`
                  : "direct_native_prompt_diagnostic_failed";
              }
            }
            throw error;
          }
          await clientForPrompt().session.wait({ sessionID }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) });
        };
        const waitForPromptRequest = async (
          promptMarker: string,
          startIndex: number,
        ): Promise<RequestObservation | undefined> => {
          await waitFor(
            () => observations.slice(startIndex).some((entry) => entry.promptMarker === promptMarker),
            PROMPT_TIMEOUT_MS,
          );
          return observations.slice(startIndex).find((entry) => entry.promptMarker === promptMarker);
        };
        const childSessions = async (parentSessionID: string): Promise<Array<{ id: string; agent: string }>> => {
          const result = await clientForPrompt().session.list({ parentID: parentSessionID, directory: paths.cwd });
          if (!record(result) || !Array.isArray(result.data)) return [];
          return result.data.flatMap((child) =>
            record(child) && typeof child.id === "string" && typeof child.agent === "string"
              ? [{ id: child.id, agent: child.agent }]
              : [],
          );
        };

        operationStage = "scout-brief-lifecycle";
        const scoutSessionID = await createSession("Synthetic production context plugin Scout");
        const scoutTurnID = createNativeTurnId();
        const scoutBriefAccepted = await agent.setReasoningAssistBrief(
          scoutSessionID,
          scoutTurnID,
          BRIEF_MARKERS.scout,
        );
        const scoutStart = observations.length;
        await sendAndWait(scoutSessionID, scoutTurnID, PROMPT_MARKERS.scout, "scout");
        const scoutRequest = await waitForPromptRequest(PROMPT_MARKERS.scout, scoutStart);
        const scoutNative = clientForPrompt();
        const scoutHistory = await scoutNative.session.context({ sessionID: scoutSessionID });
        const scoutInstructions = await scoutNative.session.instructions.entry.list({ sessionID: scoutSessionID });
        manifest.scenarios.scoutBriefObserved =
          scoutBriefAccepted && scoutRequest?.briefMarkers.includes(BRIEF_MARKERS.scout) === true;
        manifest.scenarios.historyAndInstructionsAbsent =
          !containsText(scoutHistory, BRIEF_MARKERS.scout) && !containsText(scoutInstructions, BRIEF_MARKERS.scout);
        manifest.checks.scoutPromptUsedNormalAgentAndExactTurnID = scoutRequest?.promptMarker === PROMPT_MARKERS.scout;
        manifest.checks.scoutProviderRequestContainsMatchingBrief = manifest.scenarios.scoutBriefObserved;
        manifest.checks.briefAbsentFromSessionHistoryAndInstructions = manifest.scenarios.historyAndInstructionsAbsent;
        const scoutClearAccepted = (await agent.clearReasoningAssistBrief(scoutSessionID, scoutTurnID)).cleared;

        operationStage = "turn-scoped-multi-call-delivery";
        const multiCallTurnID = createNativeTurnId();
        const multiCallBriefAccepted = await agent.setReasoningAssistBrief(
          scoutSessionID,
          multiCallTurnID,
          BRIEF_MARKERS.multiCall,
        );
        const multiCallStart = observations.length;
        await sendAndWait(scoutSessionID, multiCallTurnID, PROMPT_MARKERS.multiCall, "scout");
        await waitFor(
          () =>
            observations.slice(multiCallStart).filter((entry) => entry.promptMarker === PROMPT_MARKERS.multiCall)
              .length >= 2,
          PROMPT_TIMEOUT_MS,
        );
        const multiCallRequests = observations
          .slice(multiCallStart)
          .filter((entry) => entry.promptMarker === PROMPT_MARKERS.multiCall);
        manifest.scenarios.multiCallTurnCarriesBrief =
          multiCallBriefAccepted &&
          multiCallRequests.length >= 2 &&
          multiCallRequests.every((entry) => entry.briefMarkers.includes(BRIEF_MARKERS.multiCall)) &&
          multiCallRequests[0]?.executeToolAvailable === true &&
          multiCallRequests[1]?.toolResultPresent === true;
        manifest.checks.everyMultiCallOfActiveTurnReceivesBrief = manifest.scenarios.multiCallTurnCarriesBrief;
        manifest.checks.multiCallScenarioUsedToolContinuation =
          multiCallRequests.length >= 2 &&
          multiCallRequests[0]?.executeToolAvailable === true &&
          multiCallRequests[1]?.toolResultPresent === true;

        const nextTurnID = createNativeTurnId();
        const nextStart = observations.length;
        await sendAndWait(scoutSessionID, nextTurnID, PROMPT_MARKERS.scoutNext);
        const nextRequest = await waitForPromptRequest(PROMPT_MARKERS.scoutNext, nextStart);
        manifest.scenarios.nextTurnBriefAbsent =
          nextRequest !== undefined &&
          !nextRequest.briefMarkers.includes(BRIEF_MARKERS.scout) &&
          !nextRequest.briefMarkers.includes(BRIEF_MARKERS.multiCall);
        manifest.checks.nextTurnRequestHasNoPriorBrief = manifest.scenarios.nextTurnBriefAbsent;

        operationStage = "pending-brief-grace";
        const pendingSessionID = await createSession("Synthetic production context plugin pending grace");
        const pendingTurnID = createNativeTurnId();
        const pendingRegistered = await agent.pendingReasoningAssistTurn(
          pendingSessionID,
          pendingTurnID,
          SCRIBE_REASONING_CONTEXT_GRACE_MS,
        );
        const pendingBriefStart = observations.length;
        const pendingPrompt = sendAndWait(pendingSessionID, pendingTurnID, PROMPT_MARKERS.pendingBrief, "scout");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
        const pendingBriefPut = await agent.setReasoningAssistBrief(
          pendingSessionID,
          pendingTurnID,
          BRIEF_MARKERS.pending,
        );
        await pendingPrompt;
        const pendingBriefRequest = await waitForPromptRequest(PROMPT_MARKERS.pendingBrief, pendingBriefStart);
        manifest.grace.pendingBriefInternalWaitMs = pendingBriefPut.internalGraceWaitMs;
        manifest.scenarios.pendingBriefDeliveredWithinGrace =
          pendingRegistered &&
          pendingBriefPut.accepted &&
          pendingBriefPut.internalGraceWaitMs > 0 &&
          pendingBriefPut.internalGraceWaitMs <= SCRIBE_REASONING_CONTEXT_GRACE_MS &&
          pendingBriefRequest?.briefMarkers.includes(BRIEF_MARKERS.pending) === true;
        manifest.checks.firstRequestReceivesPendingBriefWithinGrace =
          manifest.scenarios.pendingBriefDeliveredWithinGrace;
        manifest.checks.pendingBriefGraceMeasurementIsBounded =
          pendingBriefPut.internalGraceWaitMs > 0 &&
          pendingBriefPut.internalGraceWaitMs <= SCRIBE_REASONING_CONTEXT_GRACE_MS;

        operationStage = "pending-timeout-without-brief";
        const timeoutSessionID = await createSession("Synthetic production context plugin pending timeout");
        const timeoutTurnID = createNativeTurnId();
        const timeoutGraceMs = 250;
        const timeoutRegistered = await agent.pendingReasoningAssistTurn(
          timeoutSessionID,
          timeoutTurnID,
          timeoutGraceMs,
        );
        const timeoutStart = observations.length;
        const timeoutStartedAt = Date.now();
        await sendAndWait(timeoutSessionID, timeoutTurnID, PROMPT_MARKERS.pendingTimeout, "scout");
        const timeoutElapsedMs = Date.now() - timeoutStartedAt;
        const timeoutRequest = await waitForPromptRequest(PROMPT_MARKERS.pendingTimeout, timeoutStart);
        const timeoutClear = await agent.clearReasoningAssistBrief(timeoutSessionID, timeoutTurnID);
        manifest.grace.pendingTimeoutInternalWaitMs = timeoutClear.internalGraceWaitMs;
        manifest.grace.pendingTimeoutTurnElapsedMs = timeoutElapsedMs;
        manifest.scenarios.pendingTimeoutProceedsWithoutBrief =
          timeoutRegistered &&
          timeoutRequest !== undefined &&
          !timeoutRequest.briefMarkers.includes(BRIEF_MARKERS.pending) &&
          timeoutElapsedMs <= SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS &&
          timeoutClear.internalGraceWaitMs > 0 &&
          timeoutClear.internalGraceWaitMs <= timeoutGraceMs;
        manifest.checks.expiredPendingTurnProceedsWithoutBriefWithinCeiling =
          manifest.scenarios.pendingTimeoutProceedsWithoutBrief;

        operationStage = "unpended-no-wait";
        const unpendedSessionID = await createSession("Synthetic production context plugin unpended turn");
        const unpendedTurnID = createNativeTurnId();
        const unpendedStart = observations.length;
        const unpendedStartedAt = Date.now();
        await sendAndWait(unpendedSessionID, unpendedTurnID, PROMPT_MARKERS.unpended, "scout");
        const unpendedElapsedMs = Date.now() - unpendedStartedAt;
        const unpendedRequest = await waitForPromptRequest(PROMPT_MARKERS.unpended, unpendedStart);
        manifest.grace.unpendedTurnElapsedMs = unpendedElapsedMs;
        manifest.scenarios.unpendedTurnDoesNotWait =
          unpendedRequest !== undefined &&
          unpendedRequest.briefMarkers.length === 0 &&
          unpendedElapsedMs <= SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS;
        manifest.checks.unpendedScoutTurnProceedsWithoutBriefOrGraceWait = manifest.scenarios.unpendedTurnDoesNotWait;

        manifest.checks.turnEndClearApiSucceeded = scoutClearAccepted;

        operationStage = "maximum-brief-boundary";
        const maximumBrief =
          BRIEF_MARKERS.maximum + "é".repeat(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS - BRIEF_MARKERS.maximum.length);
        const maximumTurnID = createNativeTurnId();
        const maximumBriefAccepted = await agent.setReasoningAssistBrief(scoutSessionID, maximumTurnID, maximumBrief);
        const maximumBriefStart = observations.length;
        await sendAndWait(scoutSessionID, maximumTurnID, PROMPT_MARKERS.maximum);
        const maximumRequest = await waitForPromptRequest(PROMPT_MARKERS.maximum, maximumBriefStart);
        manifest.scenarios.maximumBriefObserved =
          maximumBriefAccepted && maximumRequest?.briefMarkers.includes(BRIEF_MARKERS.maximum) === true;
        manifest.checks.maximumCharacterBriefIsExactAndMultibyte =
          maximumBrief.length === SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS &&
          Buffer.byteLength(maximumBrief, "utf8") <= SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES;
        manifest.checks.maximumBriefReachedProviderRequest = manifest.scenarios.maximumBriefObserved;
        manifest.checks.maximumBriefClearApiSucceeded = (
          await agent.clearReasoningAssistBrief(scoutSessionID, maximumTurnID)
        ).cleared;

        operationStage = "build-agent-exclusion";
        const buildSessionID = await createSession("Synthetic production context plugin Write", "build");
        const buildTurnID = createNativeTurnId();
        const buildBriefAccepted = await agent.setReasoningAssistBrief(
          buildSessionID,
          buildTurnID,
          BRIEF_MARKERS.build,
        );
        const buildStart = observations.length;
        await sendAndWait(buildSessionID, buildTurnID, PROMPT_MARKERS.build, "build");
        const buildRequest = await waitForPromptRequest(PROMPT_MARKERS.build, buildStart);
        manifest.scenarios.buildBriefAbsent =
          buildBriefAccepted && buildRequest !== undefined && !buildRequest.briefMarkers.includes(BRIEF_MARKERS.build);
        manifest.checks.buildRequestDidNotReceiveScoutBrief = manifest.scenarios.buildBriefAbsent;
        manifest.checks.buildClearApiSucceeded = (
          await agent.clearReasoningAssistBrief(buildSessionID, buildTurnID)
        ).cleared;

        operationStage = "cross-session-isolation";
        const otherSessionID = await createSession("Synthetic production context plugin session B");
        const crossTurnID = createNativeTurnId();
        const crossBriefAccepted = await agent.setReasoningAssistBrief(
          scoutSessionID,
          crossTurnID,
          BRIEF_MARKERS.crossSession,
        );
        const foreignSessionTurnID = createNativeTurnId();
        const otherSessionStart = observations.length;
        await sendAndWait(otherSessionID, foreignSessionTurnID, PROMPT_MARKERS.crossSession);
        const otherSessionRequest = await waitForPromptRequest(PROMPT_MARKERS.crossSession, otherSessionStart);
        const ownerSessionStart = observations.length;
        await sendAndWait(scoutSessionID, crossTurnID, PROMPT_MARKERS.crossSessionOwner);
        const ownerSessionRequest = await waitForPromptRequest(PROMPT_MARKERS.crossSessionOwner, ownerSessionStart);
        manifest.scenarios.crossSessionIsolated =
          crossBriefAccepted &&
          otherSessionRequest !== undefined &&
          !otherSessionRequest.briefMarkers.includes(BRIEF_MARKERS.crossSession) &&
          ownerSessionRequest?.briefMarkers.includes(BRIEF_MARKERS.crossSession) === true;
        manifest.checks.briefDidNotCrossSessionBoundary = manifest.scenarios.crossSessionIsolated;
        manifest.checks.crossSessionClearApiSucceeded = (
          await agent.clearReasoningAssistBrief(scoutSessionID, crossTurnID)
        ).cleared;

        operationStage = "stop-abort-clear";
        const stopSessionID = await createSession("Synthetic production context plugin Stop session");
        const stopTurnID = createNativeTurnId();
        const stopBriefAccepted = await agent.setReasoningAssistBrief(stopSessionID, stopTurnID, BRIEF_MARKERS.stop);
        const stopStart = observations.length;
        await agent.sendMessage(stopSessionID, PROMPT_MARKERS.stop, { turnID: stopTurnID });
        const stopRequestObserved = await Promise.race([
          stopRequestArrived.then(() => true),
          new Promise<boolean>((resolveDelay) => setTimeout(() => resolveDelay(false), PROMPT_TIMEOUT_MS)),
        ]);
        const stopRequest = observations.slice(stopStart).find((entry) => entry.promptMarker === PROMPT_MARKERS.stop);
        let stopAcknowledged = false;
        if (stopRequestObserved) {
          await agent.abortSession(stopSessionID);
          stopAcknowledged = (await agent.clearReasoningAssistBrief(stopSessionID)).cleared;
        }
        releaseStopResponse?.();
        releaseStopResponse = undefined;
        await clientForPrompt()
          .session.wait({ sessionID: stopSessionID }, { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) })
          .catch(() => undefined);
        const stopFollowupID = createNativeTurnId();
        const stopFollowupStart = observations.length;
        await sendAndWait(stopSessionID, stopFollowupID, PROMPT_MARKERS.stopFollowup);
        const stopFollowupRequest = await waitForPromptRequest(PROMPT_MARKERS.stopFollowup, stopFollowupStart);
        manifest.scenarios.stopClearEffective =
          stopBriefAccepted &&
          stopRequest?.briefMarkers.includes(BRIEF_MARKERS.stop) === true &&
          stopAcknowledged &&
          stopFollowupRequest !== undefined &&
          !stopFollowupRequest.briefMarkers.includes(BRIEF_MARKERS.stop);
        manifest.checks.stopAbortAcknowledgedAndClearApiSucceeded = stopAcknowledged;
        manifest.checks.stoppedTurnFollowupHasNoBrief = manifest.scenarios.stopClearEffective;

        operationStage = "reconnect-clear";
        const reconnectSessionID = await createSession("Synthetic production context plugin reconnect session");
        const reconnectTurnID = createNativeTurnId();
        const reconnectBriefAccepted = await agent.setReasoningAssistBrief(
          reconnectSessionID,
          reconnectTurnID,
          BRIEF_MARKERS.reconnect,
        );
        await agent.reconnect();
        native = nativeClient(agent);
        const reconnectPluginList = await waitForProductionPlugin(native, paths.cwd);
        const reconnectPluginActive = pluginState(reconnectPluginList) === "active";
        const reconnectClearAccepted = (await agent.clearReasoningAssistBrief(reconnectSessionID)).cleared;
        const reconnectStart = observations.length;
        await sendAndWait(reconnectSessionID, reconnectTurnID, PROMPT_MARKERS.reconnect);
        const reconnectRequest = await waitForPromptRequest(PROMPT_MARKERS.reconnect, reconnectStart);
        manifest.scenarios.reconnectClearEffective =
          reconnectBriefAccepted &&
          reconnectPluginActive &&
          reconnectClearAccepted &&
          reconnectRequest !== undefined &&
          !reconnectRequest.briefMarkers.includes(BRIEF_MARKERS.reconnect);
        manifest.checks.productionPluginReloadedAfterReconnect = reconnectPluginActive;
        manifest.checks.reconnectClearApiSucceeded = reconnectClearAccepted;
        manifest.checks.preReconnectBriefAbsentAfterReconnect = manifest.scenarios.reconnectClearEffective;

        operationStage = "reasoning-target-native-qualification";
        const reasoningSessionID = await createSession("Synthetic exact reasoning-target qualification");
        operationStage = "reasoning-once-parent-turn";
        await sendAndWait(reasoningSessionID, createNativeTurnId(), PROMPT_MARKERS.reasoningOnce, "scout");
        operationStage = "reasoning-once-child-attribution";
        const reasoningChildren = await childSessions(reasoningSessionID);
        const criticChildrenAfterFirstTurn = reasoningChildren.filter(
          (child) => child.agent === "chat-reasoning-critic",
        );
        const verifierChildrenAfterFirstTurn = reasoningChildren.filter(
          (child) => child.agent === "chat-reasoning-verifier",
        );
        const repeatedCriticContinuation = observations.find(
          (entry) => entry.promptMarker === PROMPT_MARKERS.reasoningOnce && entry.parentCallIndex === 3,
        );
        const foregroundCapObservation = observations.find(
          (entry) => entry.promptMarker === PROMPT_MARKERS.reasoningOnce && entry.parentCallIndex === 2,
        );
        const foregroundCappedResultLength = foregroundCapObservation?.toolResultTextLengths.find(
          (length) => length === 2_048,
        );
        foregroundReasoningResultCharacters = foregroundCappedResultLength ?? null;
        manifest.scenarios.criticAndVerifierAllowedOncePerTurn =
          criticChildrenAfterFirstTurn.length === 1 &&
          verifierChildrenAfterFirstTurn.length === 1 &&
          observations.some((entry) => entry.childMarker === CHILD_PROMPT_MARKERS.criticOnce) &&
          observations.some((entry) => entry.childMarker === CHILD_PROMPT_MARKERS.verifierOnce);
        manifest.checks.criticAndVerifierEachRanExactlyOnce = manifest.scenarios.criticAndVerifierAllowedOncePerTurn;
        manifest.scenarios.repeatedDenialAttributedToParentScoutTurn =
          criticChildrenAfterFirstTurn.length === 1 &&
          repeatedCriticContinuation?.subagentDenialPresent === true &&
          repeatedCriticContinuation.subagentDenialCategory === "scribe_reasoning_denied" &&
          repeatedCriticContinuation.subagentDenialAttribution === "parent-scout-session" &&
          repeatedCriticContinuation.parentCallIndex === 3;
        manifest.checks.repeatedCriticDenialResultAttributedToParentScoutSession =
          repeatedCriticContinuation?.subagentDenialPresent === true &&
          repeatedCriticContinuation.subagentDenialCategory === "scribe_reasoning_denied" &&
          repeatedCriticContinuation.subagentDenialAttribution === "parent-scout-session";
        manifest.checks.repeatedCriticDeniedInParentScoutTurnWithoutSecondChild =
          manifest.scenarios.repeatedDenialAttributedToParentScoutTurn;
        manifest.scenarios.foregroundReasoningResultCapped =
          foregroundCapObservation?.truncationMarkerPresent === true && foregroundCappedResultLength === 2_048;
        manifest.checks.foregroundReasoningResultAndContentCappedAt2048 =
          manifest.scenarios.foregroundReasoningResultCapped;

        operationStage = "reasoning-next-parent-turn";
        const nextTurnStart = observations.length;
        await sendAndWait(reasoningSessionID, createNativeTurnId(), PROMPT_MARKERS.reasoningNext, "scout");
        operationStage = "reasoning-next-child-attribution";
        const reasoningChildrenAfterNextTurn = await childSessions(reasoningSessionID);
        const criticChildrenAfterNextTurn = reasoningChildrenAfterNextTurn.filter(
          (child) => child.agent === "chat-reasoning-critic",
        );
        manifest.scenarios.reasoningTargetsResetOnNextTurn =
          criticChildrenAfterNextTurn.length === 2 &&
          observations.slice(nextTurnStart).some((entry) => entry.childMarker === CHILD_PROMPT_MARKERS.criticNext);
        manifest.checks.reasoningTargetMayRunAgainOnNextScoutTurn = manifest.scenarios.reasoningTargetsResetOnNextTurn;
        await Promise.all(
          [reasoningSessionID, ...reasoningChildrenAfterNextTurn.map((child) => child.id)].map((sessionID) =>
            agent?.clearReasoningAssistBrief(sessionID),
          ),
        );

        const deniedTargetCases = [
          PROMPT_MARKERS.reasoningArbitrary,
          PROMPT_MARKERS.reasoningNearMissCase,
          PROMPT_MARKERS.reasoningNearMissSuffix,
        ];
        let allUnlistedTargetsDenied = true;
        for (const [index, promptMarker] of deniedTargetCases.entries()) {
          const sessionID = await createSession(`Synthetic unlisted reasoning target ${index + 1}`);
          operationStage = `reasoning-unlisted-target-${index + 1}`;
          const startIndex = observations.length;
          await sendAndWait(sessionID, createNativeTurnId(), promptMarker, "scout");
          const rejectedContinuation = observations.find(
            (entry) => entry.promptMarker === promptMarker && entry.parentCallIndex === 2,
          );
          const children = await childSessions(sessionID);
          allUnlistedTargetsDenied =
            allUnlistedTargetsDenied &&
            rejectedContinuation?.subagentDenialPresent === true &&
            children.length === 0 &&
            !observations.slice(startIndex).some((entry) => entry.childMarker !== null);
          await agent.clearReasoningAssistBrief(sessionID);
        }
        manifest.scenarios.arbitraryAndNearMissTargetsDenied = allUnlistedTargetsDenied;
        manifest.checks.arbitraryAndCaseOrSuffixNearMissTargetsDeniedWithoutChildren = allUnlistedTargetsDenied;

        const workerSessionID = await createSession("Synthetic exact research-worker delegation");
        operationStage = "reasoning-worker-parent-turn";
        const workerStart = observations.length;
        await sendAndWait(workerSessionID, createNativeTurnId(), PROMPT_MARKERS.reasoningWorker, "scout");
        operationStage = "reasoning-worker-child-attribution";
        const workerChildren = await childSessions(workerSessionID);
        const workerAllowed = workerChildren.some((child) => child.agent === "chat-research-worker");
        manifest.scenarios.workerStillAllowed =
          workerAllowed &&
          observations.slice(workerStart).some((entry) => entry.childMarker === CHILD_PROMPT_MARKERS.worker);
        manifest.checks.exactResearchWorkerDelegationStillAllowed = manifest.scenarios.workerStillAllowed;
        await Promise.all(
          [workerSessionID, ...workerChildren.map((child) => child.id)].map((sessionID) =>
            agent?.clearReasoningAssistBrief(sessionID),
          ),
        );

        const buildReasoningSessionID = await createSession("Synthetic Build reasoning-target denial", "build");
        let buildDelegationDenied = true;
        const buildAttempts: NativeManifest["buildAttempts"] = [];
        for (const promptMarker of [PROMPT_MARKERS.buildReasoningCritic, PROMPT_MARKERS.buildReasoningVerifier]) {
          operationStage = "reasoning-build-denial";
          const startIndex = observations.length;
          await sendAndWait(buildReasoningSessionID, createNativeTurnId(), promptMarker, "build");
          const rejectedContinuation = observations.find(
            (entry) => entry.promptMarker === promptMarker && entry.parentCallIndex === 2,
          );
          const children = await childSessions(buildReasoningSessionID);
          const reasoningChildCount = children.filter(
            (child) => child.agent === "chat-reasoning-critic" || child.agent === "chat-reasoning-verifier",
          ).length;
          const denialCategory = rejectedContinuation?.subagentDenialCategory ?? null;
          const denialProvenance =
            denialCategory === "scribe_reasoning_denied"
              ? "plugin"
              : denialCategory !== null
                ? "native"
                : "unrecognized";
          buildAttempts.push({
            target:
              promptMarker === PROMPT_MARKERS.buildReasoningCritic
                ? "chat-reasoning-critic"
                : "chat-reasoning-verifier",
            denialCategory,
            denialProvenance,
            reasoningChildCount,
          });
          buildDelegationDenied =
            buildDelegationDenied &&
            denialCategory !== null &&
            !observations.slice(startIndex).some((entry) => entry.childMarker !== null) &&
            reasoningChildCount === 0;
        }
        manifest.buildAttempts = buildAttempts.slice(0, 2);
        manifest.scenarios.buildCannotDelegateToReasoningTargets = buildDelegationDenied;
        manifest.checks.buildCannotCreateEitherReasoningChild = buildDelegationDenied;
        await agent.clearReasoningAssistBrief(buildReasoningSessionID);

        const backgroundSessionID = await createSession("Synthetic background reasoning-target qualification");
        operationStage = "reasoning-background-parent-turn";
        const backgroundStart = observations.length;
        await sendAndWait(backgroundSessionID, createNativeTurnId(), PROMPT_MARKERS.reasoningBackground, "scout");
        operationStage = "reasoning-background-child-admission";
        const backgroundChildRequestObserved = await waitFor(() => backgroundChildSeen, PROMPT_TIMEOUT_MS);
        operationStage = "reasoning-background-child-attribution";
        const backgroundChildrenBeforeCompletion = await childSessions(backgroundSessionID);
        const backgroundCriticChildren = backgroundChildrenBeforeCompletion.filter(
          (child) => child.agent === "chat-reasoning-critic",
        );
        const backgroundRepeatDenied = observations
          .slice(backgroundStart)
          .some(
            (entry) =>
              entry.promptMarker === PROMPT_MARKERS.reasoningBackground &&
              entry.parentCallIndex === 3 &&
              entry.subagentDenialPresent &&
              entry.subagentDenialCategory === "scribe_reasoning_denied" &&
              entry.subagentDenialAttribution === "parent-scout-session",
          );
        releaseBackgroundChildResponse?.();
        releaseBackgroundChildResponse = undefined;
        if (backgroundCriticChildren[0]) {
          operationStage = "reasoning-background-child-wait";
          await clientForPrompt().session.wait(
            { sessionID: backgroundCriticChildren[0].id },
            { signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) },
          );
        }
        operationStage = "reasoning-background-synthetic-observation";
        const backgroundCompletion = await waitForAsync(async () => {
          const context = await clientForPrompt().session.context({ sessionID: backgroundSessionID });
          const text = stringValues(context).find((value) => value.includes(BACKGROUND_RESULT_END_MARKER));
          return text === undefined ? undefined : { text };
        }, PROMPT_TIMEOUT_MS);
        backgroundSyntheticResultCharacters = backgroundCompletion?.text.length ?? null;
        const backgroundResultNotCapped =
          backgroundCompletion !== undefined &&
          backgroundCompletion.text.length > 2_048 &&
          !backgroundCompletion.text.includes(SUBAGENT_RESULT_TRUNCATION_MARKER);
        manifest.scenarios.backgroundCallCountedOnceAndCompleted =
          backgroundChildRequestObserved &&
          backgroundCriticChildren.length === 1 &&
          backgroundRepeatDenied &&
          backgroundResultNotCapped;
        manifest.checks.backgroundCriticRepeatDeniedAndSingleChildCompleted =
          manifest.scenarios.backgroundCallCountedOnceAndCompleted;
        manifest.checks.backgroundRepeatDenialResultAttributedToParentScoutSession = observations.some(
          (entry) =>
            entry.promptMarker === PROMPT_MARKERS.reasoningBackground &&
            entry.parentCallIndex === 3 &&
            entry.subagentDenialPresent &&
            entry.subagentDenialCategory === "scribe_reasoning_denied" &&
            entry.subagentDenialAttribution === "parent-scout-session",
        );
        manifest.scenarios.backgroundResultCapResidualObserved = backgroundResultNotCapped;
        manifest.checks.backgroundSyntheticCompletionBypassesExecuteAfterCap = backgroundResultNotCapped;
        await Promise.all(
          [backgroundSessionID, ...backgroundChildrenBeforeCompletion.map((child) => child.id)].map((sessionID) =>
            agent?.clearReasoningAssistBrief(sessionID),
          ),
        );

        const reasoningChildMarkers = [
          CHILD_PROMPT_MARKERS.criticOnce,
          CHILD_PROMPT_MARKERS.verifierOnce,
          CHILD_PROMPT_MARKERS.criticNext,
          CHILD_PROMPT_MARKERS.criticBackground,
        ];
        const reasoningChildObservations = observations.filter(
          (entry) => entry.childMarker !== null && reasoningChildMarkers.includes(entry.childMarker as never),
        );
        manifest.reasoningChildToolObservations = reasoningChildObservations.slice(0, 4).map((entry) => ({
          scenario:
            entry.childMarker === CHILD_PROMPT_MARKERS.verifierOnce
              ? "verifier-once"
              : entry.childMarker === CHILD_PROMPT_MARKERS.criticNext
                ? "critic-next-turn"
                : entry.childMarker === CHILD_PROMPT_MARKERS.criticBackground
                  ? "critic-background"
                  : "critic-once",
          toolDefinitionCount: entry.toolDefinitionCount,
          toolDefinitionNames: entry.toolDefinitionNames,
          toolDefinitionNamesTruncated: entry.toolDefinitionNamesTruncated,
        }));
        const childPermissionDiagnostics: NativeManifest["reasoningChildPermissionDiagnostics"] = [];
        for (const parentSessionID of createdSessionIDs) {
          for (const child of await childSessions(parentSessionID)) {
            if (child.agent !== "chat-reasoning-critic" && child.agent !== "chat-reasoning-verifier") continue;
            const childInfo = await clientForPrompt().session.get({ sessionID: child.id });
            const sessionPermissions =
              record(childInfo) && Array.isArray(childInfo.permissions) ? childInfo.permissions : undefined;
            const agentProfile = getAgentProfile(child.agent);
            const agentPermissions =
              agentProfile && Array.isArray(agentProfile.permissions) ? agentProfile.permissions : [];
            const agentSkillRule = lastSkillFilterRule(agentPermissions);
            const sessionSkillRule = sessionPermissions === undefined ? null : lastSkillFilterRule(sessionPermissions);
            const winningRule = sessionSkillRule ?? agentSkillRule;
            childPermissionDiagnostics.push({
              role: child.agent === "chat-reasoning-critic" ? "critic" : "verifier",
              agentSkillRule,
              agentHasWildcardSkillDeny: agentPermissions.some(
                (rule) => record(rule) && rule.action === "skill" && rule.resource === "*" && rule.effect === "deny",
              ),
              sessionPermissionCount: sessionPermissions?.length ?? null,
              sessionSkillRule,
              toolSnapshotFiltersSkill:
                winningRule === null ? null : winningRule.effect === "deny" && winningRule.resourceKind === "wildcard",
            });
          }
        }
        manifest.reasoningChildPermissionDiagnostics = childPermissionDiagnostics.slice(0, 4);
        manifest.scenarios.reasoningChildrenReceiveNoTools =
          reasoningChildObservations.length === reasoningChildMarkers.length &&
          reasoningChildObservations.every(
            (entry) => entry.toolDefinitionCount === 0 && !entry.executeToolAvailable && !entry.subagentToolAvailable,
          );
        manifest.checks.criticAndVerifierProviderRequestsContainNoToolDefinitions =
          manifest.scenarios.reasoningChildrenReceiveNoTools;

        for (const sessionID of createdSessionIDs) {
          const children = await childSessions(sessionID);
          reasoningSubagentChildren += children.filter(
            (child) => child.agent === "chat-reasoning-critic" || child.agent === "chat-reasoning-verifier",
          ).length;
        }

        operationStage = "plugin-tool-and-config-audit";
        const finalPluginList = await native.plugin.list({ location: { directory: paths.cwd } });
        manifest.finalPluginActivationState = pluginState(finalPluginList);
        manifest.finalPluginFailureCategory = pluginFailureCategory(finalPluginList);
        const finalPluginActive = manifest.finalPluginActivationState === "active";
        const pluginServerText = pluginServer.toString("utf8");
        const pluginSourceHasNoToolRegistration = !/\bctx\.tool\.(?:transform|add)\s*\(|\btools?\s*:\s*\{/u.test(
          pluginServerText,
        );
        const noPluginToolNamesObserved = observations.every((observation) => !observation.scribeToolNamePresent);
        manifest.scenarios.pluginHasNoToolContribution =
          finalPluginActive && pluginSourceHasNoToolRegistration && noPluginToolNamesObserved;
        manifest.checks.pluginActiveAndProductionSourceDeclaresNoTools =
          finalPluginActive && pluginSourceHasNoToolRegistration;
        manifest.checks.providerToolDefinitionsContainNoScribePluginTool = noPluginToolNamesObserved;
        manifest.checks.privateOverlayDidNotWritePluginConfig = providerConfigHasNoPluginEntry;
        manifest.checks.projectConfigWasNotCreated = projectConfigAbsent;
        manifest.privateOriginAuthenticated =
          privateOrigin !== undefined && privateAuthorizationSeen && rpcRequests > 0;
        manifest.checks.privateApiAndPluginRpcUsedAuthenticatedLoopback = manifest.privateOriginAuthenticated;
        manifest.checks.onlyLoopbackFetchesObserved = !externalFetchAttempted;
        manifest.checks.privateServerExactVersion = manifest.privateServerReady;
        manifest.checks.privateOriginAuthenticated = manifest.privateOriginAuthenticated;

        const allChecksPass = Object.values(manifest.checks).every((value) => value === true);
        manifest.status = allChecksPass ? "PASS" : "FAIL";
        if (!allChecksPass) manifest.failureCode = "required_check_failed";
      } catch (error) {
        if (manifest.status !== "BLOCKED") manifest.status = "FAIL";
        manifest.failureStage = operationStage;
        const failedRequest = manifest.failureObservations[0];
        manifest.failureCode ??= failedRequest
          ? `integration_${failedRequest.boundary}_${failedRequest.endpoint}_http_${failedRequest.status}`
          : `integration_${safeErrorClass(error).toLowerCase()}${
              safeNativeErrorCode(error)
                ? `_${safeNativeErrorCode(error)}`
                : safeHttpStatus(error)
                  ? `_http_${safeHttpStatus(error)}`
                  : ""
            }`;
        void error;
      } finally {
        releaseStopResponse?.();
        releaseStopResponse = undefined;
        if (agent && manifest.finalPluginActivationState === null) {
          operationStage = "final-plugin-state-recheck";
          try {
            const finalPluginList = await nativeClient(agent).plugin.list({ location: { directory: paths.cwd } });
            manifest.finalPluginActivationState = pluginState(finalPluginList);
            manifest.finalPluginFailureCategory = pluginFailureCategory(finalPluginList);
          } catch {
            manifest.finalPluginActivationState = "absent";
          }
        }
        if (agent) {
          try {
            await agent.stopForReconnect();
            manifest.cleanup.agentStopped = true;
          } catch {
            manifest.cleanup.agentStopped = false;
            manifest.status = "FAIL";
            manifest.failureCode ??= "agent_cleanup_failed";
          }
        } else {
          manifest.cleanup.agentStopped = true;
        }
        if (provider) {
          try {
            await new Promise<void>((resolveClose, rejectClose) => {
              provider?.close((error) => (error ? rejectClose(error) : resolveClose()));
            });
            providerClosed = true;
          } catch {
            providerClosed = false;
            manifest.status = "FAIL";
            manifest.failureCode ??= "provider_cleanup_failed";
          }
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
        manifest.cleanup.providerClosed = providerClosed || provider === undefined;

        if (configBefore) {
          try {
            const configUnchanged = snapshotsMatch(configBefore, await snapshotTree(paths.config));
            manifest.scenarios.configUnchanged = configUnchanged;
            manifest.checks.isolatedConfigTreeUnchanged = configUnchanged;
            if (!configUnchanged) {
              manifest.status = "FAIL";
              manifest.failureCode ??= "isolated_config_mutation_observed";
            }
          } catch {
            manifest.scenarios.configUnchanged = false;
            manifest.checks.isolatedConfigTreeUnchanged = false;
            manifest.status = "FAIL";
            manifest.failureCode ??= "isolated_config_snapshot_failed";
          }
        }
        if (runRoot) {
          try {
            const owner = await readFile(join(runRoot, ".context-plugin-native-owner"), "utf8");
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
          if (manifest.cleanup.runRootRemoved !== true) {
            manifest.status = "FAIL";
            manifest.failureCode ??= "isolation_root_cleanup_failed";
          }
        }
        manifest.privateOriginAuthenticated =
          privateOrigin !== undefined && privateAuthorizationSeen && rpcRequests > 0;
        manifest.checks.privateOriginAuthenticated = manifest.privateOriginAuthenticated;
        try {
          await persist();
        } catch {
          manifest.status = "FAIL";
          manifest.failureCode ??= "manifest_persist_failed";
        }
      }

      expect(manifest.status).toBe("PASS");
      expect(manifest.cleanup).toEqual({
        agentStopped: true,
        providerClosed: true,
        environmentRestored: true,
        fetchRestored: true,
        runRootRemoved: true,
      });
    },
    OVERALL_TIMEOUT_MS + 30_000,
  );
});
