import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AgentEvent, ChatMessageWithParts } from "@opencode-chat/core";
import { afterEach, expect, it } from "vitest";
import { OpenCodeAgent, OpenCodeOperationUnavailableError } from "../opencode-agent.js";
import {
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_PROMPT,
} from "../restricted-review-overlay.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const runEnabled = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const expectedExecutableSha256 = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const expectedClientVersion = "2.1.0";
const timeoutMs = 60_000;
const apiLimit = 85;
const modelLimit = 7;
const maxFixtureBodyBytes = 512 * 1024;
const cleanupAllowanceMs = 5_000;
const processReapMs = 3_000;
const knownFailureCodes = new Set([
  "dedicated_fork_required",
  "executable_required",
  "executable_unavailable",
  "ambient_gate_blocked",
  "spawn_gate_blocked",
  "model_body_too_large",
  "api_request_limit",
  "overall_deadline",
  "write_schema_missing",
  "write_tool_result_missing",
  "todo_schema_missing",
  "todo_tool_result_missing",
  "restricted_review_not_ready",
  "restricted_review_creation_failed",
  "restricted_review_stage_failed",
  "restricted_review_cancel_failed",
  "model_request_count_mismatch",
  "write_schema_missing",
  "fixture_operation_failed",
  "client_metadata_mismatch",
  "executable_hash_mismatch",
]);
const execFileAsync = promisify(execFile);
const owners = new Set<V2TestIsolation>();
const ownerPIDs = new Map<V2TestIsolation, number | null | undefined>();

const requiredCheckNames = [
  "dedicatedVitestForkWithIPC",
  "ambientConfigGateClear",
  "fixtureIsOwnedEmptyGitRepository",
  "firstRequestAdvertisesDirectWriteSchema",
  "restrictedReviewRequestHasNoTools",
  "restrictedReviewRequestUsesHostModel",
  "restrictedReviewSystemHasFixedPromptAndArchitectInstruction",
  "restrictedReviewPacketIsUserTextWithoutStageInstruction",
  "restrictedReviewRequestOmitsOwnedSentinel",
  "secondRequestContainsWriteToolResult",
  "nativeVersionIsPinned",
  "freshSpawnGateClear",
  "privateWorkspaceBound",
  "configReadIsDirectOrderedNativeEntries",
  "ownedConfigDocumentMatchesFixture",
  "pathlessProcessOverlayFollowsOwnedConfig",
  "configResultDoesNotAliasNativeSource",
  "configUpdateFailsClosedWithoutApiOrFileWrite",
  "todoRequestAdvertisesOnlyTodowrite3",
  "todoRequestAdvertisesOnlyTodowrite5",
  "todoSchemaAdvertised3",
  "todoSchemaAdvertised5",
  "todoToolResultBeforeAnswer4",
  "todoToolResultBeforeAnswer6",
  "singleOwnedBuildSession",
  "emptyDiffBeforePrompt",
  "persistedOwnedFileMatchesAfter",
  "writeToolWasCalled",
  "sessionSawBusyThenIdle",
  "oneCompletedWriteToolCall",
  "finalAssistantAnswerPresent",
  "modelSawToolResultBeforeAnswer",
  "nativeDiffHasOneExactChange",
  "settledWriteHistoryAndFirstUserMessageCaptured",
  "productionRevertReturnsKnownRecordAndExactBoundary",
  "authoritativeSessionHasExactStagedBoundary",
  "stagedRevertRestoresExactOwnedBeforeBytes",
  "stagedRevertKeepsHistoryIdentityAndText",
  "exactlyOneStageAndNoModelRequest",
  "productionUnrevertReturnsRecordWithoutBoundary",
  "authoritativeSessionHasNoRevertBoundary",
  "unrevertRestoresExactOwnedAfterBytes",
  "unrevertKeepsHistoryIdentityAndText",
  "exactlyOneClearAndNoModelRequest",
  "noRevertCommit",
  "strictRevertRoundTripEvidence",
  "nativeTodoUpdateEventMatchesExactRows",
  "completedNativeTodoToolMetadataPresent",
  "nativeTodoHistoryMatchesExactRows",
  "nativeTodoClearEventObserved",
  "nativeTodoHistoryCleared",
  "exactlyOneCompletedTodoCallPerPromptAndNoExtras",
  "restrictedReviewProviderCreated",
  "restrictedReviewNativeReadiness",
  "restrictedReviewSessionCreated",
  "restrictedReviewGenerateIsExactAndNotPersisted",
  "restrictedReviewOverlayIsToolFree",
  "restrictedReviewInstructionStoredInNativeContext",
  "restrictedReviewPacketAbsentFromInstructionObservation",
  "reviewerSessionRemovedAndBuildSessionPreserved",
  "requestBounds",
  "clientMetadataIsPinned",
  "executableHashIsPinned",
] as const;

const requiredReviewerRequestChecks = [
  "restrictedReviewRequestHasNoTools",
  "restrictedReviewRequestUsesHostModel",
  "restrictedReviewSystemHasFixedPromptAndArchitectInstruction",
  "restrictedReviewPacketIsUserTextWithoutStageInstruction",
  "restrictedReviewRequestOmitsOwnedSentinel",
] as const;
const requiredCleanupNames = [
  "agentCleanup",
  "processGroupGone",
  "fixtureClosed",
  "isolationRemoved",
  "environmentRestored",
  "fetchRestored",
  "stateAbsent",
  "databaseAbsent",
  "reviewerSessionRemoved",
] as const;

const expectedBounds = {
  overallMs: timeoutMs,
  maxApiRequests: apiLimit,
  maxModelRequests: modelLimit,
  maxSessions: 2,
  maxOwnedWrites: 1,
  maxLogicalTodoUpdates: 2,
  maxLogicalRestrictedReviewStages: 1,
  expectedGenerateCalls: 1,
  maxFixtureBodyBytes,
};
function runtimeManifestBounds(): typeof expectedBounds {
  return { ...expectedBounds };
}

function strictEvidenceCountsWithinBounds(counts: Manifest["counts"]): boolean {
  return (
    counts.apiRequests <= apiLimit &&
    counts.modelRequests === modelLimit &&
    counts.sessions === 2 &&
    counts.ownedWrites <= 1 &&
    counts.logicalWriteOperations === 1 &&
    counts.logicalTodoUpdates === 2 &&
    counts.logicalRestrictedReviewStages === 1 &&
    counts.generateCalls === 1
  );
}

function strictEvidenceValid(value: unknown): boolean {
  if (!isRecord(value) || value.status !== "PASS" || value.expectedVersion !== "2.2.0") return false;
  if (
    value.observedVersion !== "2.2.0" ||
    value.sourceCommit !== sourceCommit ||
    value.clientPackage !== "@opencode/client@2.1.0"
  )
    return false;
  if (value.executableSha256 !== expectedExecutableSha256 || !isRecord(value.bounds) || !isRecord(value.counts))
    return false;
  if (JSON.stringify(value.bounds) !== JSON.stringify(expectedBounds)) return false;
  if (!isRecord(value.checks)) return false;
  const checks = value.checks;
  if (requiredCheckNames.some((name) => checks[name] !== true)) return false;
  if (!isRecord(value.cleanup)) return false;
  const cleanup = value.cleanup;
  if (
    requiredCleanupNames.some((name) => cleanup[name] !== true) ||
    Object.keys(cleanup).length !== requiredCleanupNames.length
  )
    return false;
  const counts = value.counts;
  if (
    ![
      counts.apiRequests,
      counts.modelRequests,
      counts.sessions,
      counts.ownedWrites,
      counts.logicalWriteOperations,
      counts.logicalTodoUpdates,
      counts.logicalRestrictedReviewStages,
      counts.generateCalls,
    ].every((count) => typeof count === "number" && Number.isFinite(count))
  )
    return false;
  if (!strictEvidenceCountsWithinBounds(counts as unknown as Manifest["counts"])) return false;
  if (!isRecord(value.preTeardown) || value.preTeardown.status !== "PASS" || !isRecord(value.preTeardown.checks))
    return false;
  const preTeardown = value.preTeardown;
  if (
    preTeardown.expectedVersion !== "2.2.0" ||
    preTeardown.observedVersion !== "2.2.0" ||
    preTeardown.sourceCommit !== sourceCommit ||
    preTeardown.executableSha256 !== expectedExecutableSha256 ||
    preTeardown.clientPackage !== "@opencode/client@2.1.0" ||
    JSON.stringify(preTeardown.bounds) !== JSON.stringify(expectedBounds)
  )
    return false;
  if (!isRecord(preTeardown.checks)) return false;
  const preChecks = preTeardown.checks;
  if (requiredCheckNames.some((name) => preChecks[name] !== true)) return false;
  if (!isRecord(preTeardown.counts) || JSON.stringify(preTeardown.counts) !== JSON.stringify(counts)) return false;
  return true;
}

type Manifest = {
  schemaVersion: 1;
  runId: string;
  status: "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
  expectedVersion: "2.2.0";
  observedVersion: string | null;
  ownedPID: number | null;
  sourceCommit: string;
  executablePath: string | null;
  executableSha256: string | null;
  evidencePath: string;
  fixtureRoot: string | null;
  statePath: string | null;
  databasePath: string | null;
  qualification: "PRODUCTION_ADAPTER_PRIVATE_SERVER_NATIVE_DIFF_WRITE_CONDITIONAL_FIXTURE_AGENT_TODO_CONFIG_SOURCE_READS_NATIVE_REVERT_UNREVERT_AND_RESTRICTED_REVIEW_STAGE";
  sourceCommitMeaning: "inspected-release-tag";
  clientPackage: "@opencode/client@2.1.0";
  bounds: {
    overallMs: number;
    maxApiRequests: number;
    maxModelRequests: number;
    maxSessions: number;
    maxOwnedWrites: number;
    maxLogicalTodoUpdates: number;
    maxLogicalRestrictedReviewStages: number;
    maxFixtureBodyBytes: number;
  };
  counts: {
    apiRequests: number;
    modelRequests: number;
    sessions: number;
    ownedWrites: number;
    logicalWriteOperations: number;
    logicalTodoUpdates: number;
    logicalRestrictedReviewStages: number;
    generateCalls: number;
  };
  apiOperations: Record<string, number>;
  checks: Record<string, boolean>;
  cleanup: {
    agentCleanup: boolean;
    processGroupGone: boolean | null;
    fixtureClosed: boolean;
    isolationRemoved: boolean | null;
    environmentRestored: boolean;
    fetchRestored: boolean;
    stateAbsent: boolean | null;
    databaseAbsent: boolean | null;
    reviewerSessionRemoved: boolean | null;
  };
  preTeardown?: {
    status: "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
    stage: string;
    expectedVersion: "2.2.0";
    observedVersion: string | null;
    sourceCommit: string;
    executableSha256: string | null;
    clientPackage: "@opencode/client@2.1.0";
    bounds: Manifest["bounds"];
    checks: Record<string, boolean>;
    counts: Manifest["counts"];
    failureCode?: string;
  };
  failureCode?: string;
  stage: string;
};

function safeCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (
    code === "dedicated_fork_required" ||
    code === "executable_required" ||
    code === "executable_unavailable" ||
    code === "ambient_gate_blocked" ||
    code === "spawn_gate_blocked"
  )
    return code;
  if (code === "model_body_too_large") return code;
  if (code === "api_request_limit") return code;
  if (code === "overall_deadline") return code;
  if (typeof code === "string" && knownFailureCodes.has(code)) return code;
  return "fixture_operation_failed";
}

type NativeInstructionEntryRoute =
  | { kind: "list"; sessionID: string }
  | { kind: "put"; sessionID: string; key: string };

function nativeInstructionEntryRoute(method: string, pathname: string): NativeInstructionEntryRoute | undefined {
  const list =
    method === "GET" ? pathname.match(/^\/api\/experimental\/session\/([^/]+)\/instructions\/entries$/u) : null;
  const put =
    method === "PUT"
      ? pathname.match(/^\/api\/experimental\/session\/([^/]+)\/instructions\/entries\/([^/]+)$/u)
      : null;
  try {
    if (list?.[1]) return { kind: "list", sessionID: decodeURIComponent(list[1]) };
    if (put?.[1] && put[2])
      return { kind: "put", sessionID: decodeURIComponent(put[1]), key: decodeURIComponent(put[2]) };
  } catch {
    return undefined;
  }
  return undefined;
}

function safeOperation(method: string, pathname: string): string {
  const route = pathname.replace(/^\/api\//u, "").split("/");
  if (route[0] === "session") {
    const suffix = route[2] === "revert" ? `/${route.slice(2).join("/")}` : route[2] ? `/${route[2]}` : "";
    return `${method} /api/session/:sessionID${suffix}`;
  }
  return `${method} /api/${route[0] ?? "unknown"}`;
}

function revertRoundTripChecks(input: {
  stageObserved: boolean;
  clearObserved: boolean;
  fileRestoredBefore: boolean;
  fileRestoredAfter: boolean;
  boundaryPresentWhileStaged: boolean;
  boundaryAbsentAfterClear: boolean;
  noRevertCommit: boolean;
}): boolean {
  return Object.values(input).every(Boolean);
}

function environmentMatches(expected: NodeJS.ProcessEnv, actual: NodeJS.ProcessEnv): boolean {
  return Object.keys({ ...expected, ...actual }).every((key) => expected[key] === actual[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactRestrictedReviewDenyPermissions(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const expectedActions = new Set<string>(["*", ...RESTRICTED_REVIEW_AUTHORITIES]);
  if (value.length !== expectedActions.size) return false;

  const actualActions = new Set<string>();
  for (const permission of value) {
    if (
      !isRecord(permission) ||
      typeof permission.action !== "string" ||
      permission.resource !== "*" ||
      permission.effect !== "deny" ||
      !expectedActions.has(permission.action)
    ) {
      return false;
    }
    actualActions.add(permission.action);
  }

  return (
    actualActions.size === expectedActions.size && [...expectedActions].every((action) => actualActions.has(action))
  );
}

function buildOwnedFixtureConfig(port: number): Record<string, unknown> {
  return {
    model: "fixture-provider/fixture-model",
    providers: {
      "fixture-provider": {
        name: "Local fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { "fixture-model": { name: "Fixture model" } },
      },
    },
    plugins: [],
    mcp: {},
    experimental: { todo: true },
    agents: {
      "fixture-todo": {
        mode: "primary",
        hidden: true,
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          { action: "todowrite", resource: "*", effect: "allow" },
        ],
      },
    },
  };
}

function hasExactNativeTodoFixtureAgent(value: unknown): boolean {
  if (!isRecord(value) || Object.hasOwn(value, "agent") || !isRecord(value.agents)) return false;
  const agent = value.agents["fixture-todo"];
  if (!isRecord(agent) || agent.mode !== "primary" || agent.hidden !== true || !Array.isArray(agent.permissions))
    return false;
  return (
    agent.permissions.length === 2 &&
    isRecord(agent.permissions[0]) &&
    agent.permissions[0].action === "*" &&
    agent.permissions[0].resource === "*" &&
    agent.permissions[0].effect === "deny" &&
    isRecord(agent.permissions[1]) &&
    agent.permissions[1].action === "todowrite" &&
    agent.permissions[1].resource === "*" &&
    agent.permissions[1].effect === "allow"
  );
}

function environmentRestored(
  restoreSucceeded: boolean,
  expected: NodeJS.ProcessEnv,
  actual: NodeJS.ProcessEnv,
): boolean {
  return restoreSucceeded && environmentMatches(expected, actual);
}

async function bounded<T>(operation: Promise<T>, limitMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded_cleanup_timeout")), limitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("fixture bind failed"));
      else resolvePort(address.port);
    });
  });
}

function call(name: string, args: Record<string, unknown>, id: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] })}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
}

function answer(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant" })}${chunk({ content: text })}${chunk({}, "stop")}data: [DONE]\n\n`;
}

function groupGone(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function absent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

afterEach(async () => {
  for (const owner of owners) {
    const pid = ownerPIDs.get(owner);
    if (pid === null || (pid !== undefined && !groupGone(pid))) continue;
    await owner.dispose();
    owners.delete(owner);
    ownerPIDs.delete(owner);
  }
});

it("recognizes restored and changed worker environments", () => {
  expect(environmentRestored(true, { HOME: "owned" }, { HOME: "owned" })).toBe(true);
  expect(environmentRestored(true, { HOME: "owned" }, { HOME: "ambient" })).toBe(false);
  expect(environmentRestored(false, { HOME: "owned" }, { HOME: "owned" })).toBe(false);
});

it("builds the owned fixture agent with exact native permissions and no legacy singular agent", () => {
  expect(hasExactNativeTodoFixtureAgent(buildOwnedFixtureConfig(1234))).toBe(true);
  expect(buildOwnedFixtureConfig(1234)).toMatchObject({
    model: "fixture-provider/fixture-model",
    experimental: { todo: true },
    mcp: {},
    plugins: [],
  });
  expect(
    hasExactNativeTodoFixtureAgent({
      agents: {
        "fixture-todo": {
          mode: "primary",
          hidden: true,
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "todowrite", resource: "*", effect: "allow" },
          ],
        },
      },
      agent: { "fixture-todo": { permissions: [] } },
    }),
  ).toBe(false);
});

it("requires the complete unique restricted-review deny set including execute", () => {
  expect(RESTRICTED_REVIEW_AUTHORITIES).toContain("execute");
  const exact = [...new Set(["*", ...RESTRICTED_REVIEW_AUTHORITIES])].map((action) => ({
    action,
    resource: "*",
    effect: "deny",
  }));

  expect(hasExactRestrictedReviewDenyPermissions(exact)).toBe(true);
  expect(hasExactRestrictedReviewDenyPermissions(exact.filter(({ action }) => action !== "execute"))).toBe(false);
  expect(hasExactRestrictedReviewDenyPermissions([...exact, exact[0]])).toBe(false);
  expect(
    hasExactRestrictedReviewDenyPermissions(
      exact.map((permission) => (permission.action === "execute" ? { ...permission, effect: "allow" } : permission)),
    ),
  ).toBe(false);
  expect(
    hasExactRestrictedReviewDenyPermissions([...exact, { action: "unexpected", resource: "*", effect: "deny" }]),
  ).toBe(false);
});

it("matches only exact native experimental instruction-entry routes", () => {
  expect(
    nativeInstructionEntryRoute(
      "PUT",
      "/api/experimental/session/ses_owned/instructions/entries/scribe.restricted-review-role",
    ),
  ).toEqual({ kind: "put", sessionID: "ses_owned", key: "scribe.restricted-review-role" });
  expect(nativeInstructionEntryRoute("GET", "/api/experimental/session/ses_owned/instructions/entries")).toEqual({
    kind: "list",
    sessionID: "ses_owned",
  });
  expect(
    nativeInstructionEntryRoute(
      "PUT",
      "/api/experimental/session/ses_owned/instructions/entries/scribe.restricted-review-role%2Fextra",
    ),
  ).toEqual({ kind: "put", sessionID: "ses_owned", key: "scribe.restricted-review-role/extra" });
  expect(nativeInstructionEntryRoute("PUT", "/api/session/ses_owned/instructions/entries/key")).toBeUndefined();
  expect(
    nativeInstructionEntryRoute("PUT", "/api/experimental/session/ses_owned/instructions/entries/"),
  ).toBeUndefined();
  expect(nativeInstructionEntryRoute("GET", "/api/experimental/session/ses_owned/instructions/entry")).toBeUndefined();
});

it("retains only known bounded failure codes in fixture evidence", () => {
  expect(safeCode(Object.assign(new Error("private details"), { code: "restricted_review_stage_failed" }))).toBe(
    "restricted_review_stage_failed",
  );
  expect(safeCode(Object.assign(new Error("private details"), { code: "private_details" }))).toBe(
    "fixture_operation_failed",
  );
});

it("requires all named lifecycle evidence, pins, bounds, pre-teardown checks, and cleanup", () => {
  expect(JSON.stringify(runtimeManifestBounds())).toBe(JSON.stringify(expectedBounds));
  const valid = {
    status: "PASS",
    expectedVersion: "2.2.0",
    observedVersion: "2.2.0",
    sourceCommit,
    clientPackage: "@opencode/client@2.1.0",
    executableSha256: expectedExecutableSha256,
    bounds: expectedBounds,
    counts: {
      apiRequests: apiLimit,
      modelRequests: modelLimit,
      sessions: 2,
      ownedWrites: 1,
      logicalWriteOperations: 1,
      logicalTodoUpdates: 2,
      logicalRestrictedReviewStages: 1,
      generateCalls: 1,
    },
    checks: Object.fromEntries(requiredCheckNames.map((name) => [name, true])),
    cleanup: {
      agentCleanup: true,
      processGroupGone: true,
      fixtureClosed: true,
      isolationRemoved: true,
      environmentRestored: true,
      fetchRestored: true,
      stateAbsent: true,
      databaseAbsent: true,
      reviewerSessionRemoved: true,
    },
    preTeardown: {
      status: "PASS",
      expectedVersion: "2.2.0",
      observedVersion: "2.2.0",
      sourceCommit,
      executableSha256: expectedExecutableSha256,
      clientPackage: "@opencode/client@2.1.0",
      bounds: expectedBounds,
      checks: Object.fromEntries(requiredCheckNames.map((name) => [name, true])),
      counts: {
        apiRequests: apiLimit,
        modelRequests: modelLimit,
        sessions: 2,
        ownedWrites: 1,
        logicalWriteOperations: 1,
        logicalTodoUpdates: 2,
        logicalRestrictedReviewStages: 1,
        generateCalls: 1,
      },
    },
  };
  expect(strictEvidenceValid(valid)).toBe(true);
  for (const name of requiredCheckNames) {
    const checks = { ...valid.checks };
    delete checks[name];
    expect(strictEvidenceValid({ ...valid, checks })).toBe(false);
    const preChecks = { ...valid.preTeardown.checks };
    delete preChecks[name];
    expect(strictEvidenceValid({ ...valid, preTeardown: { ...valid.preTeardown, checks: preChecks } })).toBe(false);
  }
  for (const name of requiredCleanupNames)
    expect(strictEvidenceValid({ ...valid, cleanup: { ...valid.cleanup, [name]: false } })).toBe(false);
  for (const name of requiredCleanupNames) {
    const cleanup = { ...valid.cleanup };
    delete cleanup[name];
    expect(strictEvidenceValid({ ...valid, cleanup })).toBe(false);
  }
  expect(strictEvidenceValid({ ...valid, executableSha256: "0".repeat(64) })).toBe(false);
  expect(strictEvidenceValid({ ...valid, clientPackage: "@opencode/client@2.1.1" })).toBe(false);
  expect(strictEvidenceValid({ ...valid, counts: { ...valid.counts, apiRequests: apiLimit + 1 } })).toBe(false);
  expect(strictEvidenceValid({ ...valid, counts: { ...valid.counts, modelRequests: modelLimit + 1 } })).toBe(false);
  expect(strictEvidenceValid({ ...valid, counts: { ...valid.counts, sessions: 3 } })).toBe(false);
  expect(strictEvidenceValid({ ...valid, counts: { ...valid.counts, logicalTodoUpdates: 3 } })).toBe(false);
  expect(strictEvidenceValid({ ...valid, counts: { ...valid.counts, generateCalls: 0 } })).toBe(false);
  expect(strictEvidenceValid({ ...valid, counts: { ...valid.counts, generateCalls: 2 } })).toBe(false);
  expect(strictEvidenceValid({ ...valid, bounds: { ...valid.bounds, maxApiRequests: apiLimit + 1 } })).toBe(false);
});

it("rejects incomplete revert round-trip evidence", () => {
  const complete = {
    stageObserved: true,
    clearObserved: true,
    fileRestoredBefore: true,
    fileRestoredAfter: true,
    boundaryPresentWhileStaged: true,
    boundaryAbsentAfterClear: true,
    noRevertCommit: true,
  };
  expect(revertRoundTripChecks(complete)).toBe(true);
  for (const key of Object.keys(complete) as (keyof typeof complete)[])
    expect(revertRoundTripChecks({ ...complete, [key]: false })).toBe(false);
});

it.skipIf(!runEnabled)(
  "observes native config, diff, conditional todo, and restricted reviewer outcomes",
  async () => {
    const overall = new AbortController();
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const deadlineTimer = setTimeout(() => overall.abort(new Error("overall_deadline")), timeoutMs);
    const fork = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof fork.send === "function" && fork.connected === true;
    const root = await realpath(projectRoot);
    const evidenceBase = resolve(root, "tmp/scribe-v2-migration/domain-mapping");
    await mkdir(evidenceBase, { recursive: true });
    await assertOwnedPath(root, evidenceBase);
    const runId = randomUUID();
    const runRoot = join(evidenceBase, runId);
    await mkdir(runRoot, { recursive: false });
    const evidencePath = join(runRoot, "result.json");
    const manifest: Manifest = {
      schemaVersion: 1,
      runId,
      status: "RUNNING",
      expectedVersion: "2.2.0",
      observedVersion: null,
      ownedPID: null,
      sourceCommit,
      executablePath: executable && isAbsolute(executable) ? resolve(executable) : null,
      executableSha256: null,
      evidencePath: relative(root, evidencePath),
      fixtureRoot: null,
      statePath: null,
      databasePath: null,
      qualification:
        "PRODUCTION_ADAPTER_PRIVATE_SERVER_NATIVE_DIFF_WRITE_CONDITIONAL_FIXTURE_AGENT_TODO_CONFIG_SOURCE_READS_NATIVE_REVERT_UNREVERT_AND_RESTRICTED_REVIEW_STAGE",
      sourceCommitMeaning: "inspected-release-tag",
      clientPackage: "@opencode/client@2.1.0",
      bounds: runtimeManifestBounds(),
      counts: {
        apiRequests: 0,
        modelRequests: 0,
        sessions: 0,
        ownedWrites: 0,
        logicalWriteOperations: 0,
        logicalTodoUpdates: 0,
        logicalRestrictedReviewStages: 0,
        generateCalls: 0,
      },
      apiOperations: {},
      checks: Object.fromEntries(requiredCheckNames.map((name) => [name, false])),
      cleanup: {
        agentCleanup: false,
        processGroupGone: null,
        fixtureClosed: false,
        isolationRemoved: null,
        environmentRestored: false,
        fetchRestored: false,
        stateAbsent: null,
        databaseAbsent: null,
        reviewerSessionRemoved: null,
      },
      stage: "preflight",
    };
    const persist = () => writeFile(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const originalFetch = globalThis.fetch;
    const originalEnvironment = { ...process.env };
    let isolation: V2TestIsolation | undefined;
    let agent: OpenCodeAgent | undefined;
    let fixture: Server | undefined;
    let fixtureClosed = false;
    let envReplaced = false;
    let pid: number | undefined;
    let ownedSessionID: string | undefined;
    let reviewerSessionID: string | undefined;
    let restrictedReviewProvider: ReturnType<OpenCodeAgent["createRestrictedReviewProvider"]>;
    let reviewToken: number | undefined;
    const apiOperations: string[] = [];
    const nativeConfigResponses: unknown[] = [];
    let toolResultSeen = false;
    let sessionIdle = false;
    let sessionBusy = false;
    let writeResultObserved = false;
    let instructionEntryReadback: unknown;
    const events: AgentEvent[] = [];
    try {
      await assertOwnedPath(evidenceBase, runRoot);
      await persist();
      manifest.checks.dedicatedVitestForkWithIPC = dedicatedFork;
      if (!dedicatedFork) throw Object.assign(new Error("blocked"), { code: "dedicated_fork_required" });
      if (!executable || !isAbsolute(executable))
        throw Object.assign(new Error("blocked"), { code: "executable_required" });
      try {
        await access(executable);
      } catch {
        throw Object.assign(new Error("blocked"), { code: "executable_unavailable" });
      }
      manifest.executableSha256 = createHash("sha256")
        .update(await readFile(executable))
        .digest("hex");
      const clientMetadata = JSON.parse(
        await readFile(
          resolve(
            root,
            "node_modules/.pnpm/@opencode+client@2.1.0_effect@4.0.1/node_modules/@opencode/client/package.json",
          ),
          "utf8",
        ),
      ) as { name?: unknown; version?: unknown };
      manifest.checks.clientMetadataIsPinned =
        clientMetadata.name === "@opencode/client" && clientMetadata.version === expectedClientVersion;
      manifest.checks.executableHashIsPinned = manifest.executableSha256 === expectedExecutableSha256;
      if (!manifest.checks.clientMetadataIsPinned)
        throw Object.assign(new Error("blocked"), { code: "client_metadata_mismatch" });
      if (!manifest.checks.executableHashIsPinned)
        throw Object.assign(new Error("blocked"), { code: "executable_hash_mismatch" });
      isolation = await createV2TestIsolation(runRoot);
      owners.add(isolation);
      ownerPIDs.set(isolation, agent ? null : undefined);
      manifest.fixtureRoot = relative(root, isolation.root);
      manifest.statePath = relative(root, isolation.paths.state);
      manifest.databasePath = relative(root, isolation.paths.database);
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      const gate = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      manifest.checks.ambientConfigGateClear = gate.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!manifest.checks.ambientConfigGateClear)
        throw Object.assign(new Error("blocked"), { code: "ambient_gate_blocked" });
      const before = "first\nshared\nold";
      const after = "first\nshared\nnew";
      const filename = "diff fixture.txt";
      const ownedFile = join(isolation.paths.cwd, filename);
      await writeFile(ownedFile, before, { flag: "wx", mode: 0o600 });
      await mkdir(join(isolation.root, "empty-git-template"), { recursive: true });
      await execFileAsync("git", ["init", "--quiet", "--initial-branch=fixture"], {
        cwd: isolation.paths.cwd,
        env: {
          ...isolation.environment,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TEMPLATE_DIR: join(isolation.root, "empty-git-template"),
        },
        shell: false,
        timeout: 5_000,
      });
      const gitDirectory = await realpath(join(isolation.paths.cwd, ".git"));
      manifest.checks.fixtureIsOwnedEmptyGitRepository =
        gitDirectory === join(isolation.paths.cwd, ".git") && gitDirectory !== join(root, ".git");
      if (!manifest.checks.fixtureIsOwnedEmptyGitRepository) throw new Error("git fixture ownership check failed");

      let modelRequestCount = 0;
      fixture = createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") return response.writeHead(404).end();
        manifest.counts.modelRequests += 1;
        modelRequestCount += 1;
        if (modelRequestCount > modelLimit) return response.writeHead(429).end();
        let raw = "";
        let bytes = 0;
        for await (const chunk of request) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxFixtureBodyBytes) {
            manifest.failureCode ??= "model_body_too_large";
            request.destroy();
            return;
          }
          raw += chunk;
        }
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return response.writeHead(400).end();
        }
        const messages =
          typeof body === "object" && body !== null && "messages" in body && Array.isArray(body.messages)
            ? body.messages
            : [];
        if (modelRequestCount === 1) {
          const tools =
            typeof body === "object" && body !== null && "tools" in body && Array.isArray(body.tools) ? body.tools : [];
          const writeTool = tools.find(
            (entry) =>
              typeof entry === "object" &&
              entry !== null &&
              "function" in entry &&
              (entry as { function?: { name?: string } }).function?.name === "write",
          ) as { function?: { parameters?: unknown } } | undefined;
          const schema = writeTool?.function?.parameters as
            | { properties?: Record<string, unknown>; required?: string[] }
            | undefined;
          manifest.checks.firstRequestAdvertisesDirectWriteSchema =
            !!schema &&
            !!schema.properties?.path &&
            !!schema.properties?.content &&
            schema.required?.includes("path") === true &&
            schema.required.includes("content");
          if (!manifest.checks.firstRequestAdvertisesDirectWriteSchema) {
            manifest.failureCode ??= "write_schema_missing";
            return response.writeHead(409).end();
          }
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
          return response.end(call("write", { path: filename, content: after }, "fixture-write"));
        }
        if (modelRequestCount === 7) {
          const toolsValid =
            isRecord(body) && (!Object.hasOwn(body, "tools") || (Array.isArray(body.tools) && body.tools.length === 0));
          const reqModel = isRecord(body) && typeof body.model === "string" ? body.model : "";
          const messageText = (entry: unknown): string | undefined => {
            if (!isRecord(entry)) return undefined;
            if (typeof entry.content === "string") return entry.content;
            if (
              Array.isArray(entry.content) &&
              entry.content.every((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
            )
              return entry.content.map((part) => (part as { text: string }).text).join("");
            return undefined;
          };
          const systemTexts = messages.filter((entry) => isRecord(entry) && entry.role === "system").map(messageText);
          const userEntries = messages.filter((entry) => isRecord(entry) && entry.role === "user");
          const userTexts = userEntries.map(messageText);
          const systemText = systemTexts.every((text) => text !== undefined) ? systemTexts.join("\n") : undefined;
          const packet = '{"kind":"ordinary"}';
          manifest.checks.restrictedReviewRequestHasNoTools = toolsValid;
          manifest.checks.restrictedReviewRequestUsesHostModel = reqModel === "fixture-model";
          manifest.checks.restrictedReviewSystemHasFixedPromptAndArchitectInstruction =
            typeof systemText === "string" &&
            systemText.includes(RESTRICTED_REVIEW_PROMPT) &&
            systemText.includes(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION);
          manifest.checks.restrictedReviewPacketIsUserTextWithoutStageInstruction =
            userEntries.length === 1 &&
            userTexts.length === 1 &&
            userTexts[0] === packet &&
            !userTexts[0].includes(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION);
          manifest.checks.restrictedReviewRequestOmitsOwnedSentinel = !JSON.stringify(messages).includes(
            JSON.stringify(after).slice(1, -1),
          );
          if (!requiredReviewerRequestChecks.every((name) => manifest.checks[name] === true)) {
            manifest.failureCode ??= "restricted_review_stage_failed";
            return response.writeHead(409).end();
          }
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
          return response.end(answer('{"kind":"ordinary"}'));
        }
        const last = messages.at(-1);
        toolResultSeen =
          typeof last === "object" &&
          last !== null &&
          "role" in last &&
          last.role === "tool" &&
          "tool_call_id" in last &&
          last.tool_call_id === "fixture-write" &&
          "content" in last &&
          typeof last.content === "string" &&
          last.content.includes("Wrote file successfully");
        if (modelRequestCount === 2) {
          writeResultObserved = toolResultSeen;
          manifest.checks.secondRequestContainsWriteToolResult = toolResultSeen;
          if (!toolResultSeen) {
            manifest.failureCode ??= "write_tool_result_missing";
            return response.writeHead(409).end();
          }
        }
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        if (modelRequestCount === 2) return response.end(answer("fixture write completed"));
        if (modelRequestCount === 3 || modelRequestCount === 5) {
          const tools =
            typeof body === "object" && body !== null && "tools" in body && Array.isArray(body.tools) ? body.tools : [];
          // Native 2.2.0 additionally advertises `skill` (its browser plugin appends a scoped
          // `skill:browser` deny after config); execution still requires its own permission.
          const toolNames = tools.flatMap((tool) =>
            isRecord(tool) && isRecord(tool.function) && typeof tool.function.name === "string"
              ? [tool.function.name]
              : [],
          );
          manifest.checks[`todoRequestAdvertisesOnlyTodowrite${modelRequestCount}`] =
            toolNames.includes("todowrite") && toolNames.every((name) => name === "todowrite" || name === "skill");
          if (!manifest.checks[`todoRequestAdvertisesOnlyTodowrite${modelRequestCount}`]) {
            manifest.failureCode ??= "todo_schema_missing";
            return response.writeHead(409).end();
          }
          const todoTool = tools.find(
            (entry) =>
              typeof entry === "object" &&
              entry !== null &&
              "function" in entry &&
              (entry as { function?: { name?: string } }).function?.name === "todowrite",
          ) as { function?: { parameters?: unknown } } | undefined;
          const schema = todoTool?.function?.parameters as
            | {
                properties?: Record<string, unknown>;
                required?: string[];
              }
            | undefined;
          const todoListSchema = schema?.properties?.todos as
            | {
                type?: string;
                items?: {
                  type?: string;
                  properties?: Record<string, { type?: string; enum?: string[] }>;
                  required?: string[];
                };
              }
            | undefined;
          const itemSchema = todoListSchema?.items;
          manifest.checks[`todoSchemaAdvertised${modelRequestCount}`] =
            schema?.required?.includes("todos") === true &&
            todoListSchema?.type === "array" &&
            itemSchema?.type === "object" &&
            itemSchema.properties?.content?.type === "string" &&
            itemSchema.properties?.status?.enum?.join(",") === "pending,in_progress,completed,cancelled" &&
            itemSchema.required?.includes("content") === true &&
            itemSchema.required.includes("status");
          if (!manifest.checks[`todoSchemaAdvertised${modelRequestCount}`]) {
            manifest.failureCode ??= "todo_schema_missing";
            return response.writeHead(409).end();
          }
          const todos = [
            { content: "Review café ☕", status: "in_progress" },
            { content: "Publish résumé 📚", status: "pending" },
          ];
          return response.end(
            call("todowrite", { todos: modelRequestCount === 3 ? todos : [] }, `fixture-todo-${modelRequestCount}`),
          );
        }
        const expectedToolCallID = `fixture-todo-${modelRequestCount - 1}`;
        const expectedSummary =
          modelRequestCount === 4
            ? 'Todos updated: 0/2 completed, 1 in progress, 1 pending. In progress: "Review café ☕"'
            : "Todos cleared";
        const todoResultSeen =
          typeof last === "object" &&
          last !== null &&
          "role" in last &&
          last.role === "tool" &&
          "tool_call_id" in last &&
          last.tool_call_id === expectedToolCallID &&
          "content" in last &&
          typeof last.content === "string" &&
          last.content === expectedSummary;
        manifest.checks[`todoToolResultBeforeAnswer${modelRequestCount}`] = todoResultSeen;
        if (!todoResultSeen) {
          manifest.failureCode ??= "todo_tool_result_missing";
          return response.writeHead(409).end();
        }
        response.end(answer("fixture todos completed"));
      });
      const port = await listen(fixture);
      const ownedConfigPath = join(isolation.paths.config, "opencode", "opencode.json");
      const ownedFixtureConfig = buildOwnedFixtureConfig(port);
      const ownedConfigText = JSON.stringify(ownedFixtureConfig);
      await writeFile(ownedConfigPath, ownedConfigText, { mode: 0o600 });
      const ownedConfigBytes = await readFile(ownedConfigPath);
      const nativeFetch = originalFetch.bind(globalThis);
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (new URL(url).pathname.startsWith("/api/")) {
          manifest.counts.apiRequests += 1;
          const operation = safeOperation(method, new URL(url).pathname);
          apiOperations.push(operation);
          manifest.apiOperations[operation] = (manifest.apiOperations[operation] ?? 0) + 1;
          if (manifest.counts.apiRequests > apiLimit) {
            overall.abort(new Error("api_request_limit"));
            throw new Error("api_request_limit");
          }
        }
        const remaining = Math.max(1, deadline - Date.now());
        const inputSignal = input instanceof Request ? input.signal : undefined;
        const signals = [
          overall.signal,
          AbortSignal.timeout(remaining),
          ...(inputSignal ? [inputSignal] : []),
          ...(init?.signal ? [init.signal] : []),
        ];
        const response = await nativeFetch(input, { ...init, signal: AbortSignal.any(signals) });
        const pathname = new URL(url).pathname;
        if (response.ok && method === "POST" && /^\/api\/session\/[^/]+\/generate$/u.test(pathname)) {
          manifest.counts.generateCalls += 1;
        }
        const instructionRoute = nativeInstructionEntryRoute(method, pathname);
        if (
          response.ok &&
          instructionRoute?.kind === "put" &&
          instructionRoute.key === "scribe.restricted-review-role"
        ) {
          const readbackURL = new URL(
            `/api/experimental/session/${encodeURIComponent(instructionRoute.sessionID)}/instructions/entries`,
            url,
          );
          await globalThis
            .fetch(readbackURL, {
              headers: init?.headers ?? (input instanceof Request ? input.headers : undefined),
              signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
            })
            .catch(() => undefined);
        }
        if (response.ok && instructionRoute?.kind === "list") {
          instructionEntryReadback = await response
            .clone()
            .json()
            .catch(() => undefined);
        }
        if (method === "GET" && new URL(url).pathname === "/api/config" && response.ok) {
          nativeConfigResponses.push(
            await response
              .clone()
              .json()
              .catch(() => undefined),
          );
        }
        if (new URL(url).pathname === "/api/info" && response.ok) {
          const info: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          if (typeof info === "object" && info !== null && "pid" in info && typeof info.pid === "number") {
            pid = info.pid;
            if (isolation) ownerPIDs.set(isolation, info.pid);
            manifest.ownedPID = info.pid;
          }
          if (typeof info === "object" && info !== null && "version" in info && typeof info.version === "string") {
            manifest.observedVersion = info.version;
            manifest.checks.nativeVersionIsPinned = info.version === "2.2.0";
          }
        }
        return response;
      }) as typeof fetch;
      envReplaced = true;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, isolation.environment);
      const spawnGate = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      manifest.checks.freshSpawnGateClear = spawnGate.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!manifest.checks.freshSpawnGateClear)
        throw Object.assign(new Error("blocked"), { code: "spawn_gate_blocked" });
      agent = new OpenCodeAgent({
        workspacePath: isolation.paths.cwd,
        hostPaths: { config: join(isolation.paths.config, "opencode"), state: isolation.paths.state },
        backend: "sdk",
        sandbox: {
          mode: "off",
          enabled: false,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [isolation.paths.cwd], readOnlyPaths: [] },
        },
        executable: { path: resolve(executable) },
        restrictedReview: {
          model: "fixture-provider/fixture-model",
          prompt: RESTRICTED_REVIEW_PROMPT,
          maxSteps: 4,
        },
      });
      ownerPIDs.set(isolation, null);
      agent.onEvent((event) => {
        events.push(event);
        if (
          event.type === "session.status" &&
          event.properties.sessionID === ownedSessionID &&
          event.properties.status.type === "busy"
        )
          sessionBusy = true;
        if (
          event.type === "session.status" &&
          event.properties.sessionID === ownedSessionID &&
          event.properties.status.type === "idle" &&
          sessionBusy
        )
          sessionIdle = true;
      });
      await agent.connect();
      const info = await agent.getPath();
      manifest.checks.privateWorkspaceBound = info.directory === isolation.paths.cwd;
      const config = await agent.getConfig();
      const firstWireConfig = nativeConfigResponses[0];
      const firstWireEntries = Array.isArray(firstWireConfig) ? firstWireConfig : undefined;
      const sourceDocument = firstWireEntries?.find(
        (entry) => isRecord(entry) && entry.type === "document" && entry.path === ownedConfigPath,
      );
      const sourceInfo = isRecord(sourceDocument) && isRecord(sourceDocument.info) ? sourceDocument.info : undefined;
      const sourceProvider =
        sourceInfo && isRecord(sourceInfo.providers) ? sourceInfo.providers["fixture-provider"] : undefined;
      const sourceProviderRecord = isRecord(sourceProvider) ? sourceProvider : undefined;
      const sourceExperimental = sourceInfo && isRecord(sourceInfo.experimental) ? sourceInfo.experimental : undefined;
      manifest.checks.configReadIsDirectOrderedNativeEntries =
        Array.isArray(config.entries) &&
        Object.keys(config).length === 1 &&
        Object.keys(config)[0] === "entries" &&
        firstWireEntries !== undefined &&
        JSON.stringify(config.entries) === JSON.stringify(firstWireEntries);
      manifest.checks.ownedConfigDocumentMatchesFixture =
        sourceDocument !== undefined &&
        sourceProviderRecord?.package === "@opencode/ai/providers/openai-compatible" &&
        sourceExperimental?.todo === true &&
        isRecord(sourceInfo) &&
        hasExactNativeTodoFixtureAgent(sourceInfo);
      const overlayDocument = firstWireEntries?.find(
        (entry) => isRecord(entry) && entry.type === "document" && !("path" in entry),
      );
      const overlayInfo =
        isRecord(overlayDocument) && isRecord(overlayDocument.info) ? overlayDocument.info : undefined;
      const overlayAgents = overlayInfo && isRecord(overlayInfo.agents) ? overlayInfo.agents : undefined;
      const scout = overlayAgents?.scout;
      const build = overlayAgents?.build;
      const worker = overlayAgents?.["chat-research-worker"];
      const hasPermission = (value: unknown, action: string, effect: string, resource = "*") =>
        isRecord(value) &&
        Array.isArray(value.permissions) &&
        value.permissions.some(
          (permission) =>
            isRecord(permission) &&
            permission.action === action &&
            permission.effect === effect &&
            permission.resource === resource,
        );
      manifest.checks.pathlessProcessOverlayFollowsOwnedConfig =
        firstWireEntries !== undefined &&
        overlayDocument !== undefined &&
        firstWireEntries.indexOf(sourceDocument) < firstWireEntries.indexOf(overlayDocument) &&
        overlayInfo?.default_agent === "scout" &&
        isRecord(scout) &&
        scout.mode === "all" &&
        isRecord(build) &&
        build.mode === "all" &&
        isRecord(worker) &&
        worker.mode === "subagent" &&
        hasPermission(scout, "*", "deny") &&
        hasPermission(scout, "execute", "allow") &&
        hasPermission(scout, "subagent", "allow", "chat-research-worker") &&
        hasPermission(build, "*", "deny") &&
        hasPermission(build, "edit", "allow") &&
        hasPermission(worker, "*", "deny") &&
        hasPermission(worker, "execute", "allow");
      const returnedEntries: unknown[] | undefined = Array.isArray(config.entries) ? config.entries : undefined;
      const returnedDocument = returnedEntries?.find(
        (entry) => isRecord(entry) && entry.type === "document" && entry.path === ownedConfigPath,
      );
      const returnedInfo =
        isRecord(returnedDocument) && isRecord(returnedDocument.info) ? returnedDocument.info : undefined;
      const returnedProviders = returnedInfo && isRecord(returnedInfo.providers) ? returnedInfo.providers : undefined;
      const returnedProvider = returnedProviders?.["fixture-provider"];
      const returnedProviderRecord = isRecord(returnedProvider) ? returnedProvider : undefined;
      const beforeMutation = JSON.stringify(returnedEntries);
      const mutableProviderName = returnedProviderRecord && typeof returnedProviderRecord.name === "string";
      if (mutableProviderName && returnedProviderRecord) returnedProviderRecord.name = "mutated-in-memory-only";
      const secondConfig = await agent.getConfig();
      manifest.checks.configResultDoesNotAliasNativeSource =
        mutableProviderName === true &&
        JSON.stringify(returnedEntries) !== beforeMutation &&
        nativeConfigResponses.length === 2 &&
        JSON.stringify(secondConfig.entries) === JSON.stringify(nativeConfigResponses[1]) &&
        JSON.stringify(secondConfig.entries) !== JSON.stringify(returnedEntries);
      const requestsBeforeUnavailableUpdate = manifest.counts.apiRequests;
      let updateRejected = false;
      try {
        await agent.updateConfig({ shell: "fixture-never-persisted" });
      } catch (error) {
        updateRejected = error instanceof OpenCodeOperationUnavailableError;
      }
      manifest.checks.configUpdateFailsClosedWithoutApiOrFileWrite =
        updateRejected &&
        manifest.counts.apiRequests === requestsBeforeUnavailableUpdate &&
        !apiOperations.some((operation) => operation.endsWith("/api/config") && !operation.startsWith("GET ")) &&
        (await readFile(ownedConfigPath)).equals(ownedConfigBytes);
      const session = await agent.createSession("disposable native diff qualification");
      ownedSessionID = session.id;
      manifest.counts.sessions = 1;
      manifest.checks.singleOwnedBuildSession = session.id.length > 0;
      manifest.checks.emptyDiffBeforePrompt = (await agent.getSessionDiff(session.id)).length === 0;
      await agent.sendMessage(session.id, "Write the fixture file as requested.", { primaryAgent: "build" });
      const waitUntil = async (predicate: () => boolean | Promise<boolean>) => {
        while (Date.now() < deadline && !overall.signal.aborted && !(await predicate()))
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        return predicate();
      };
      manifest.stage = "waiting_for_write_and_terminal_idle";
      await waitUntil(() => sessionIdle);
      const textOnDisk = await readFile(ownedFile, "utf8");
      manifest.counts.ownedWrites = textOnDisk === after ? 1 : 0;
      manifest.checks.persistedOwnedFileMatchesAfter = textOnDisk === after;
      manifest.checks.writeToolWasCalled =
        manifest.checks.firstRequestAdvertisesDirectWriteSchema === true &&
        manifest.checks.persistedOwnedFileMatchesAfter;
      manifest.checks.sessionSawBusyThenIdle = sessionBusy && sessionIdle;
      const messages: ChatMessageWithParts[] = await agent.getMessages(session.id);
      const writeCalls = messages.flatMap((message) =>
        message.parts.filter(
          (part) => part.type === "tool" && part.callID === "fixture-write" && part.state.status === "completed",
        ),
      );
      const finalAnswerPresent = messages.some(
        (message) =>
          message.info.role === "assistant" &&
          message.parts.some((part) => part.type === "text" && part.text === "fixture write completed"),
      );
      manifest.counts.logicalWriteOperations = writeCalls.length;
      manifest.checks.oneCompletedWriteToolCall = writeCalls.length === 1;
      manifest.checks.finalAssistantAnswerPresent = finalAnswerPresent;
      manifest.checks.modelSawToolResultBeforeAnswer =
        writeResultObserved && modelRequestCount === 2 && finalAnswerPresent;
      const diffs = await agent.getSessionDiff(session.id);
      manifest.checks.nativeDiffHasOneExactChange =
        diffs.length === 1 &&
        diffs[0]?.file === filename &&
        diffs[0]?.before === before &&
        diffs[0]?.after === after &&
        diffs[0]?.additions === 1 &&
        diffs[0]?.deletions === 1;
      // OpenCode 2.1.2 stages a file snapshot and only commits the staged
      // boundary on a subsequent prompt; clear restores the captured original.
      // Keep history signatures in memory only and compare across both calls.
      const settledWriteHistory = await agent.getMessages(session.id);
      const historySignature = (history: ChatMessageWithParts[]) =>
        JSON.stringify(
          history.map((message) => ({
            id: message.info.id,
            role: message.info.role,
            parts: message.parts.map((part) =>
              part.type === "text" ? { type: part.type, text: part.text } : { type: part.type },
            ),
          })),
        );
      const settledHistorySignature = historySignature(settledWriteHistory);
      const firstUserMessage = settledWriteHistory.find((message) => message.info.role === "user");
      const firstUserMessageID = firstUserMessage?.info.id;
      manifest.checks.settledWriteHistoryAndFirstUserMessageCaptured =
        settledHistorySignature.length > 0 && typeof firstUserMessageID === "string" && firstUserMessageID.length > 0;
      const stageOperationCount = apiOperations.filter(
        (operation) => operation === "POST /api/session/:sessionID/revert/stage",
      ).length;
      const clearOperationCount = apiOperations.filter(
        (operation) => operation === "DELETE /api/session/:sessionID/revert",
      ).length;
      const modelRequestsBeforeRevert = modelRequestCount;
      if (!firstUserMessageID) throw new Error("fixture_operation_failed");
      manifest.stage = "revert_stage_and_authoritative_read";
      const stagedRevert = await agent.revertSession(session.id, firstUserMessageID);
      manifest.stage = "revert_staged_file_history_checks";
      const stagedAuthoritative = await agent.getSession(session.id);
      const stagedFile = await readFile(ownedFile, "utf8");
      const stagedHistory = await agent.getMessages(session.id);
      manifest.checks.productionRevertReturnsKnownRecordAndExactBoundary =
        isRecord(stagedRevert.revert) && stagedRevert.revert.messageID === firstUserMessageID;
      manifest.checks.authoritativeSessionHasExactStagedBoundary =
        isRecord(stagedAuthoritative.revert) && stagedAuthoritative.revert.messageID === firstUserMessageID;
      manifest.checks.stagedRevertRestoresExactOwnedBeforeBytes = stagedFile === before;
      manifest.checks.stagedRevertKeepsHistoryIdentityAndText =
        historySignature(stagedHistory) === settledHistorySignature;
      manifest.checks.exactlyOneStageAndNoModelRequest =
        apiOperations.filter((operation) => operation === "POST /api/session/:sessionID/revert/stage").length ===
          stageOperationCount + 1 && modelRequestCount === modelRequestsBeforeRevert;
      manifest.stage = "unrevert_clear_and_authoritative_read";
      const clearedRevert = await agent.unrevertSession(session.id);
      manifest.stage = "unrevert_cleared_file_history_checks";
      const clearedAuthoritative = await agent.getSession(session.id);
      const clearedFile = await readFile(ownedFile, "utf8");
      const clearedHistory = await agent.getMessages(session.id);
      manifest.checks.productionUnrevertReturnsRecordWithoutBoundary =
        isRecord(clearedRevert) && !Object.hasOwn(clearedRevert, "revert");
      manifest.checks.authoritativeSessionHasNoRevertBoundary =
        isRecord(clearedAuthoritative) && !Object.hasOwn(clearedAuthoritative, "revert");
      manifest.checks.unrevertRestoresExactOwnedAfterBytes = clearedFile === after;
      manifest.checks.unrevertKeepsHistoryIdentityAndText =
        historySignature(clearedHistory) === settledHistorySignature;
      manifest.checks.exactlyOneClearAndNoModelRequest =
        apiOperations.filter((operation) => operation === "DELETE /api/session/:sessionID/revert").length ===
          clearOperationCount + 1 && modelRequestCount === modelRequestsBeforeRevert;
      manifest.checks.noRevertCommit = !apiOperations.includes("POST /api/session/:sessionID/revert/commit");
      manifest.checks.strictRevertRoundTripEvidence = revertRoundTripChecks({
        stageObserved: manifest.checks.exactlyOneStageAndNoModelRequest,
        clearObserved: manifest.checks.exactlyOneClearAndNoModelRequest,
        fileRestoredBefore: manifest.checks.stagedRevertRestoresExactOwnedBeforeBytes,
        fileRestoredAfter: manifest.checks.unrevertRestoresExactOwnedAfterBytes,
        boundaryPresentWhileStaged: manifest.checks.authoritativeSessionHasExactStagedBoundary,
        boundaryAbsentAfterClear: manifest.checks.authoritativeSessionHasNoRevertBoundary,
        noRevertCommit: manifest.checks.noRevertCommit,
      });
      const expectedTodos = [
        { id: "fixture-todo-3:0", content: "Review café ☕", status: "in_progress", priority: "" },
        { id: "fixture-todo-3:1", content: "Publish résumé 📚", status: "pending", priority: "" },
      ];
      const listEventStart = events.length;
      sessionIdle = false;
      sessionBusy = false;
      await agent.sendMessage(session.id, "Update the fixture todo list with the requested two items.", {
        primaryAgent: "fixture-todo",
      });
      manifest.stage = "waiting_for_native_todo_update";
      await waitUntil(() => sessionIdle);
      const listTodoEvents = events
        .slice(listEventStart)
        .flatMap((event) =>
          event.type === "todo.updated" && event.properties.sessionID === session.id ? [event] : [],
        );
      manifest.checks.nativeTodoUpdateEventMatchesExactRows =
        listTodoEvents.length === 1 &&
        JSON.stringify(listTodoEvents[0]?.properties.todos) === JSON.stringify(expectedTodos);
      const todoMessages: ChatMessageWithParts[] = await agent.getMessages(session.id);
      manifest.checks.completedNativeTodoToolMetadataPresent = todoMessages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "tool" &&
            part.callID === "fixture-todo-3" &&
            part.state.status === "completed" &&
            isRecord(part.state.metadata) &&
            Array.isArray(part.state.metadata.todos) &&
            JSON.stringify(part.state.metadata.todos) ===
              JSON.stringify(expectedTodos.map(({ id: _id, priority: _priority, ...todo }) => todo)),
        ),
      );
      manifest.checks.nativeTodoHistoryMatchesExactRows =
        JSON.stringify(await agent.getSessionTodos(session.id)) === JSON.stringify(expectedTodos);
      const clearEventStart = events.length;
      sessionIdle = false;
      sessionBusy = false;
      await agent.sendMessage(session.id, "Clear the fixture todo list.", { primaryAgent: "fixture-todo" });
      manifest.stage = "waiting_for_native_todo_clear";
      await waitUntil(() => sessionIdle && modelRequestCount === 6);
      const clearTodoEvents = events
        .slice(clearEventStart)
        .flatMap((event) =>
          event.type === "todo.updated" && event.properties.sessionID === session.id ? [event] : [],
        );
      manifest.checks.nativeTodoClearEventObserved =
        clearTodoEvents.length === 1 && clearTodoEvents[0]?.properties.todos.length === 0;
      const refreshedTodoMessages: ChatMessageWithParts[] = await agent.getMessages(session.id);
      manifest.checks.nativeTodoHistoryCleared = (await agent.getSessionTodos(session.id)).length === 0;
      const completedTodoCalls = refreshedTodoMessages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "tool" && part.tool === "todowrite" && part.state.status === "completed" ? [part] : [],
        ),
      );
      const listTodoCallCount = completedTodoCalls.filter((part) => part.callID === "fixture-todo-3").length;
      const clearTodoCallCount = completedTodoCalls.filter((part) => part.callID === "fixture-todo-5").length;
      manifest.counts.logicalTodoUpdates = completedTodoCalls.length;
      manifest.checks.exactlyOneCompletedTodoCallPerPromptAndNoExtras =
        completedTodoCalls.length === 2 && listTodoCallCount === 1 && clearTodoCallCount === 1;

      // Exercise the production restricted-review provider only after the existing
      // config/diff/todo assertions; its role and permissions come from the overlay.
      restrictedReviewProvider = agent.createRestrictedReviewProvider({
        providerID: "fixture-provider",
        modelID: "fixture-model",
      });
      manifest.checks.restrictedReviewProviderCreated = restrictedReviewProvider !== undefined;
      if (!restrictedReviewProvider)
        throw Object.assign(new Error("review unavailable"), { code: "restricted_review_not_ready" });
      manifest.checks.restrictedReviewNativeReadiness = await restrictedReviewProvider.checkReadiness();
      if (!manifest.checks.restrictedReviewNativeReadiness)
        throw Object.assign(new Error("review unavailable"), { code: "restricted_review_not_ready" });
      reviewToken = await restrictedReviewProvider.beginReview();
      const reviewer = await restrictedReviewProvider.createSession("disposable reviewer");
      manifest.checks.restrictedReviewSessionCreated = reviewer.ok;
      if (!reviewer.ok)
        throw Object.assign(new Error("review unavailable"), { code: "restricted_review_creation_failed" });
      reviewerSessionID = reviewer.sessionId;
      manifest.counts.sessions = 2;
      const reviewPacket = '{"kind":"ordinary"}';
      const stage = await restrictedReviewProvider.runStage(reviewerSessionID, reviewPacket, 5_000, "architect");
      if (!(stage.ok && stage.text === '{"kind":"ordinary"}'))
        throw Object.assign(new Error("review stage failed"), { code: "restricted_review_stage_failed" });
      const reviewerMessages: ChatMessageWithParts[] = await agent.getMessages(reviewerSessionID);
      manifest.checks.restrictedReviewGenerateIsExactAndNotPersisted =
        modelRequestCount === 7 &&
        stage.ok &&
        stage.text === '{"kind":"ordinary"}' &&
        manifest.checks.restrictedReviewRequestHasNoTools === true &&
        manifest.checks.restrictedReviewRequestUsesHostModel === true &&
        !reviewerMessages.some(
          (message) =>
            message.info.role === "user" ||
            (message.info.role === "assistant" && message.parts.some((part) => part.type === "text")),
        ) &&
        !reviewerMessages.some((message) => message.parts.some((part) => part.type === "tool"));
      const nativeOverlay = firstWireEntries?.find(
        (entry) => isRecord(entry) && entry.type === "document" && !("path" in entry),
      );
      const nativeOverlayInfo =
        isRecord(nativeOverlay) && isRecord(nativeOverlay.info) ? nativeOverlay.info : undefined;
      const nativeReviewAgent =
        nativeOverlayInfo && isRecord(nativeOverlayInfo.agents)
          ? nativeOverlayInfo.agents[RESTRICTED_REVIEW_AGENT_NAME]
          : undefined;
      manifest.checks.restrictedReviewOverlayIsToolFree =
        isRecord(nativeReviewAgent) &&
        nativeReviewAgent.hidden === true &&
        nativeReviewAgent.mode === "subagent" &&
        nativeReviewAgent.system === RESTRICTED_REVIEW_PROMPT &&
        nativeReviewAgent.steps === 4 &&
        hasExactRestrictedReviewDenyPermissions(nativeReviewAgent.permissions);
      const instructionEntries =
        isRecord(instructionEntryReadback) && Array.isArray(instructionEntryReadback.data)
          ? instructionEntryReadback.data
          : [];
      manifest.checks.restrictedReviewInstructionStoredInNativeContext = instructionEntries.some(
        (entry) =>
          isRecord(entry) &&
          entry.key === "scribe.restricted-review-role" &&
          entry.value === RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
      );
      manifest.checks.restrictedReviewPacketAbsentFromInstructionObservation =
        manifest.checks.restrictedReviewInstructionStoredInNativeContext &&
        !JSON.stringify(instructionEntryReadback).includes(reviewPacket);
      manifest.counts.logicalRestrictedReviewStages = manifest.checks.restrictedReviewGenerateIsExactAndNotPersisted
        ? 1
        : 0;
      manifest.stage = "cancelling_and_verifying_reviewer_session";
      const cancelledReview = await bounded(restrictedReviewProvider.cancelReview(reviewToken), cleanupAllowanceMs);
      const sessionsAfterReview = await bounded(agent.listSessions(), cleanupAllowanceMs);
      manifest.cleanup.reviewerSessionRemoved =
        cancelledReview.ok &&
        !sessionsAfterReview.some((item) => item.id === reviewerSessionID) &&
        sessionsAfterReview.some((item) => item.id === ownedSessionID);
      manifest.checks.reviewerSessionRemovedAndBuildSessionPreserved = manifest.cleanup.reviewerSessionRemoved;
      if (!manifest.cleanup.reviewerSessionRemoved)
        throw Object.assign(new Error("review cleanup failed"), { code: "restricted_review_cancel_failed" });
      manifest.counts.modelRequests = modelRequestCount;
      manifest.checks.requestBounds =
        manifest.counts.apiRequests <= apiLimit &&
        manifest.counts.modelRequests === 7 &&
        manifest.counts.generateCalls === 1 &&
        manifest.counts.sessions === 2 &&
        manifest.counts.ownedWrites <= 1 &&
        manifest.counts.logicalWriteOperations === 1 &&
        manifest.counts.logicalTodoUpdates === 2 &&
        manifest.counts.logicalRestrictedReviewStages === 1;
      manifest.status = Object.values(manifest.checks).every(Boolean) ? "RUNNING" : "FAIL";
    } catch (error) {
      const abortReason = overall.signal.reason;
      const deadlineCode =
        abortReason instanceof Error && knownFailureCodes.has(abortReason.message)
          ? abortReason.message
          : "overall_deadline";
      const code = manifest.failureCode ?? (overall.signal.aborted ? deadlineCode : safeCode(error));
      manifest.failureCode = knownFailureCodes.has(code) ? code : "fixture_operation_failed";
      manifest.status = [
        "dedicated_fork_required",
        "executable_required",
        "executable_unavailable",
        "ambient_gate_blocked",
        "spawn_gate_blocked",
      ].includes(manifest.failureCode)
        ? "BLOCKED"
        : "FAIL";
    } finally {
      clearTimeout(deadlineTimer);
      // Retry required reviewer cleanup before aborting the composed request signal.
      // This is cleanup only; a prior fixture failure remains a failure.
      if (
        manifest.cleanup.reviewerSessionRemoved !== true &&
        restrictedReviewProvider &&
        reviewToken !== undefined &&
        reviewerSessionID &&
        agent
      ) {
        try {
          const cancelled = await bounded(restrictedReviewProvider.cancelReview(reviewToken), cleanupAllowanceMs);
          const sessionsAfterReview = await bounded(agent.listSessions(), cleanupAllowanceMs);
          manifest.cleanup.reviewerSessionRemoved =
            cancelled.ok &&
            !sessionsAfterReview.some((item) => item.id === reviewerSessionID) &&
            sessionsAfterReview.some((item) => item.id === ownedSessionID);
        } catch {
          manifest.cleanup.reviewerSessionRemoved = false;
        }
      } else if (manifest.cleanup.reviewerSessionRemoved !== true && reviewToken !== undefined) {
        manifest.cleanup.reviewerSessionRemoved = false;
      }
      if (manifest.cleanup.reviewerSessionRemoved === false) {
        manifest.status = "FAIL";
        manifest.failureCode ??= "restricted_review_cancel_failed";
      }
      overall.abort(new Error("cleanup_started"));
      manifest.stage = "pre_teardown_evidence";
      if (manifest.status === "RUNNING")
        manifest.status = Object.values(manifest.checks).every(Boolean) ? "RUNNING" : "FAIL";
      const preTeardownPassed = requiredCheckNames.every((name) => manifest.checks[name] === true);
      if (!preTeardownPassed) manifest.status = "FAIL";
      manifest.preTeardown = {
        status: preTeardownPassed ? "PASS" : "FAIL",
        stage: manifest.stage,
        expectedVersion: manifest.expectedVersion,
        observedVersion: manifest.observedVersion,
        sourceCommit: manifest.sourceCommit,
        executableSha256: manifest.executableSha256,
        clientPackage: manifest.clientPackage,
        bounds: { ...manifest.bounds },
        checks: { ...manifest.checks },
        counts: { ...manifest.counts },
        ...(manifest.failureCode ? { failureCode: manifest.failureCode } : {}),
      };
      try {
        await persist();
      } catch {
        manifest.status = "FAIL";
        manifest.failureCode ??= "fixture_operation_failed";
      }
      manifest.stage = "cleanup_agent_and_process";
      if (agent) {
        try {
          agent.disconnect();
          const cleanup = (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise;
          if (cleanup) {
            await bounded(cleanup, cleanupAllowanceMs);
            manifest.cleanup.agentCleanup = true;
          }
        } catch {
          manifest.cleanup.agentCleanup = false;
          manifest.status = "FAIL";
        }
      }
      if (pid !== undefined) {
        try {
          const reapDeadline = Date.now() + processReapMs;
          while (!groupGone(pid) && Date.now() < reapDeadline)
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
          manifest.cleanup.processGroupGone = groupGone(pid);
        } catch {
          manifest.cleanup.processGroupGone = false;
          manifest.status = "FAIL";
        }
      }
      manifest.stage = "cleanup_fixture";
      if (fixture) {
        try {
          await bounded(new Promise<void>((close) => fixture?.close(() => close())), 1_000);
          fixtureClosed = true;
        } catch {
          fixture.closeAllConnections();
          try {
            await bounded(new Promise<void>((close) => fixture?.close(() => close())), 1_000);
            fixtureClosed = true;
          } catch {
            fixtureClosed = fixture.listening === false;
          }
        }
      }
      manifest.cleanup.fixtureClosed = fixtureClosed;
      if (!fixtureClosed) manifest.status = "FAIL";
      manifest.stage = "cleanup_isolation";
      if (isolation && (agent === undefined || manifest.cleanup.processGroupGone === true)) {
        try {
          await bounded(isolation.dispose(), cleanupAllowanceMs);
          manifest.cleanup.isolationRemoved = await absent(isolation.root);
        } catch {
          manifest.cleanup.isolationRemoved = false;
          manifest.status = "FAIL";
        }
        try {
          manifest.cleanup.stateAbsent = await absent(isolation.paths.state);
          manifest.cleanup.databaseAbsent = await absent(isolation.paths.database);
        } catch {
          manifest.cleanup.stateAbsent = false;
          manifest.cleanup.databaseAbsent = false;
          manifest.status = "FAIL";
        }
        if (manifest.cleanup.isolationRemoved === true) owners.delete(isolation);
        if (manifest.cleanup.isolationRemoved === true) ownerPIDs.delete(isolation);
      } else if (isolation) {
        manifest.cleanup.isolationRemoved = false;
        manifest.cleanup.stateAbsent = false;
        manifest.cleanup.databaseAbsent = false;
        manifest.status = "FAIL";
      }
      let restoreSucceeded = true;
      try {
        if (envReplaced) {
          for (const key of Object.keys(process.env)) delete process.env[key];
          Object.assign(process.env, originalEnvironment);
        }
      } catch {
        restoreSucceeded = false;
      }
      manifest.cleanup.environmentRestored = environmentRestored(restoreSucceeded, originalEnvironment, process.env);
      try {
        globalThis.fetch = originalFetch;
        manifest.cleanup.fetchRestored = globalThis.fetch === originalFetch;
      } catch {
        manifest.cleanup.fetchRestored = false;
        manifest.status = "FAIL";
      }
      if (manifest.status === "RUNNING")
        manifest.status =
          requiredCheckNames.every((name) => manifest.checks[name] === true) &&
          strictEvidenceCountsWithinBounds(manifest.counts) &&
          manifest.cleanup.agentCleanup &&
          manifest.cleanup.processGroupGone === true &&
          manifest.cleanup.fixtureClosed &&
          manifest.cleanup.isolationRemoved &&
          manifest.cleanup.stateAbsent &&
          manifest.cleanup.databaseAbsent &&
          manifest.cleanup.environmentRestored &&
          manifest.cleanup.fetchRestored &&
          manifest.cleanup.reviewerSessionRemoved === true
            ? "PASS"
            : "FAIL";
      try {
        manifest.stage = "final_cleanup_evidence";
        await bounded(persist(), 2_000);
      } catch {
        manifest.status = "FAIL";
      }
    }
    const persisted = JSON.parse(await readFile(evidencePath, "utf8")) as Manifest;
    expect(strictEvidenceValid(persisted)).toBe(true);
  },
  timeoutMs + cleanupAllowanceMs + processReapMs + 2_000,
);
