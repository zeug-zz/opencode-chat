import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, ChatMessageWithParts } from "@opencode-chat/core";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const enabled = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const expectedVersion = "2.2.0";
const expectedExecutableSha256 = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const overallTimeoutMs = 90_000;
const maxApiRequests = 60;
const maxModelRequests = 6;
const maxSessions = 1;
const maxToolCalls = 4;
const questionCallID = "fixture-question-call";
const rejectedQuestionCallID = "fixture-question-rejected";
const owners = new Set<V2TestIsolation>();
const questionPrompts = [
  {
    header: "Single",
    question: "Pick one",
    options: [
      { label: "option-a", description: "A" },
      { label: "option-b", description: "B" },
    ],
  },
  {
    header: "Multi",
    question: "Pick any",
    multiple: true,
    options: [
      { label: "option-a", description: "A" },
      { label: "option-b", description: "B" },
    ],
  },
  { header: "Custom", question: "Enter your answer", options: [{ label: "option-a", description: "A" }] },
  { header: "Unanswered", question: "Skip this", options: [{ label: "option-a", description: "A" }] },
];
const expectedModelContent = `User has answered your questions: ${questionPrompts.map((question, index) => `"${question.question}"="${["option-a", "option-a, option-b", "my custom answer", "Unanswered"][index]}"`).join(", ")}. You can now continue with the user's answers in mind.`;

type Status = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
type TerminalSessionObservation = {
  ownedIDMatched: boolean;
  locationMatched: boolean;
  outcomeFieldPresent: boolean;
  outcome: "succeeded" | "failed" | "interrupted" | "unknown";
  rawSessionStatus: "idle" | "retry" | "busy" | "unknown" | "missing";
};
type Manifest = {
  schemaVersion: 2;
  runId: string;
  qualification: "SCENARIOS1_2_ONLY";
  status: Status;
  stage: string;
  failureCode?: string;
  expectedVersion: string;
  observedVersion: string | null;
  sourceCommit: string;
  sourceCommitMeaning: "inspected-release-tag";
  executablePath: string | null;
  executableSha256: string | null;
  clientPackage: string | null;
  ownedPID: number | null;
  fixtureRoot: string | null;
  statePath: string | null;
  databasePath: string | null;
  evidencePath: string;
  bounds: {
    overallMs: number;
    maxApiRequests: number;
    maxModelRequests: number;
    maxSessions: number;
    maxToolCalls: number;
    maxQuestionFields: 4;
    maxOwnedChildren: 1;
    maxModelBodyBytes: 65_536;
  };
  counts: { apiRequests: number; modelRequests: number; sessions: number; toolCalls: number };
  apiOperations: Record<string, number>;
  terminalSessionGetRequests: number;
  terminalSessionObservations: TerminalSessionObservation[];
  checks: Record<string, boolean>;
  cleanup: {
    agentDisconnected: boolean;
    processGroupReaped: boolean | null;
    fixtureClosed: boolean;
    isolationRemoved: boolean | null;
    stateAbsent: boolean | null;
    databaseAbsent: boolean | null;
    environmentRestored: boolean;
    fetchRestored: boolean;
  };
  preTeardown?: {
    status: Status;
    stage: string;
    checks: Record<string, boolean>;
    counts: Manifest["counts"];
    failureCode?: string;
  };
};

const requiredChecks = [
  "dedicatedVitestForkWithIPC",
  "clientPackageMetadataIsPinned",
  "executableHashPinned",
  "isolationPathsProjectLocal",
  "ambientConfigGateClear",
  "questionToolAdvertised",
  "noForbiddenToolsAdvertised",
  "modelReceivedEncodedAnswersBeforeFinal",
  "spawnGateClear",
  "privateChildVersionMatches",
  "oneOwnedSession",
  "permissionAskedAndQuestionFormCreated",
  "permissionSessionMatches",
  "permissionSourceHasQuestionCallIdentity",
  "questionSessionMatches",
  "questionToolIdentityMatches",
  "questionFieldsMatch",
  "adapterRepliesCompleted",
  "repliesSucceededWithoutRuntimeError",
  "exactlyOneQuestionPermissionAskAndOnceReply",
  "exactlyOneQuestionFormAndReply",
  "noUnexpectedInteractions",
  "nativeSessionReachedBusyThenIdleAfterModelAnswer",
  "nativeHistoryContainsFinalAssistantAnswer",
  "nativeHistoryContainsQuestionToolCall",
  "nativeEventOrderIsPermissionThenFormReplyThenIdle",
  "requestBounds",
  "runtimeWithinDeadline",
  "scenario1ChecksFrozen",
  "secondPromptSameSessionAndAgent",
  "secondPermissionAskMatchesRejectedCall",
  "secondPermissionReplyRejected",
  "secondQuestionFormNotCreated",
  "modelRequest3RejectedQuestionCall",
  "freshSecondBusyThenIdle",
  "nativeHistoryContainsRejectedToolError",
  "nativeHistoryContainsRejectedQuestionAssistantError",
  "nativeSessionInfoReadAfterTerminal",
  "ownedSessionOutcomeMatchesPriorSuccess",
  "noModelContinuationAfterTerminalBarrier",
  "nativeHistoryPreservesFirstCompletedCallAndAnswers",
  "exactTwoPermissionAsksAndReplies",
  "exactlyOneQuestionFormAndReplyAcrossScenarios",
  "exactlyThreeModelRequestsAndTwoQuestionCalls",
  "scenario2EventOrderUsesDistinctIDs",
  "scenarios1And2Only",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sseToolCall(id: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: "question", arguments: JSON.stringify({ questions: questionPrompts }) } }] })}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
}

function observeOwnedSessionInfo(response: unknown, expectedSessionID: string, expectedDirectory: string) {
  const data = isRecord(response) && isRecord(response.data) ? response.data : undefined;
  const ownedIDMatched = data?.id === expectedSessionID;
  const locationMatched = isRecord(data?.location) && data.location.directory === expectedDirectory;
  const outcomeFieldPresent = data !== undefined && Object.hasOwn(data, "outcome");
  const outcome = data?.outcome;
  const classifiedOutcome =
    outcome === "interrupted" || outcome === "succeeded" || outcome === "failed" ? outcome : "unknown";
  const status = isRecord(data?.status) ? data.status.type : undefined;
  const rawSessionStatus =
    status === "idle" || status === "retry" || status === "busy"
      ? status
      : data !== undefined && Object.hasOwn(data, "status")
        ? "unknown"
        : "missing";
  return {
    dataRecord: data !== undefined,
    ownedIDMatched,
    locationMatched,
    outcomeFieldPresent,
    outcome: ownedIDMatched && locationMatched ? classifiedOutcome : "unknown",
    rawSessionStatus,
  } as const;
}

function hasOwnedSessionOutcomeObservation(
  observations: readonly TerminalSessionObservation[],
  expectedOutcome: "succeeded" | "interrupted",
): boolean {
  const latest = observations.at(-1);
  return Boolean(
    latest?.ownedIDMatched &&
      latest.locationMatched &&
      latest.outcomeFieldPresent &&
      latest.outcome === expectedOutcome,
  );
}

function shouldContinueTerminalPoll(observation: TerminalSessionObservation | undefined): boolean {
  return Boolean(observation?.ownedIDMatched && observation.locationMatched && observation.outcome !== "succeeded");
}

function verifyScenario12Manifest(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.counts) || !isRecord(value.checks) || !isRecord(value.cleanup)) return false;
  const counts = value.counts;
  const checks = value.checks;
  const cleanup = value.cleanup;
  const observations = value.terminalSessionObservations;
  return (
    value.schemaVersion === 2 &&
    value.qualification === "SCENARIOS1_2_ONLY" &&
    value.status === "PASS" &&
    value.stage === "completed" &&
    typeof value.ownedPID === "number" &&
    value.ownedPID > 0 &&
    counts.modelRequests === 3 &&
    counts.toolCalls === 2 &&
    counts.sessions === 1 &&
    typeof counts.apiRequests === "number" &&
    counts.apiRequests <= maxApiRequests &&
    typeof value.terminalSessionGetRequests === "number" &&
    value.terminalSessionGetRequests > 0 &&
    value.terminalSessionGetRequests <= 10 &&
    Array.isArray(observations) &&
    observations.length > 0 &&
    observations.length <= 10 &&
    observations.every(
      (observation) =>
        isRecord(observation) &&
        observation.ownedIDMatched === true &&
        observation.locationMatched === true &&
        observation.outcomeFieldPresent === true &&
        observation.outcome === "succeeded",
    ) &&
    hasOwnedSessionOutcomeObservation(observations as TerminalSessionObservation[], "succeeded") &&
    requiredChecks.every((name) => checks[name] === true) &&
    cleanup.agentDisconnected === true &&
    cleanup.processGroupReaped === true &&
    cleanup.fixtureClosed === true &&
    cleanup.isolationRemoved === true &&
    cleanup.stateAbsent === true &&
    cleanup.databaseAbsent === true &&
    cleanup.environmentRestored === true &&
    cleanup.fetchRestored === true
  );
}

function sseAnswer(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant" })}${chunk({ content: text })}${chunk({}, "stop")}data: [DONE]\n\n`;
}

function buildFixtureConfig(port: number) {
  return {
    model: "fixture-provider/fixture-model",
    providers: {
      "fixture-provider": {
        name: "Disposable local question fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { "fixture-model": { name: "Fixture model" } },
      },
    },
    plugin: [],
    mcp: {},
    agents: {
      "fixture-question": {
        mode: "primary",
        hidden: true,
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          { action: "question", resource: "*", effect: "ask" },
        ],
      },
    },
  };
}

function eventsInOrder(events: readonly string[], expected: readonly string[]): boolean {
  let cursor = -1;
  for (const event of expected) {
    cursor = events.indexOf(event, cursor + 1);
    if (cursor < 0) return false;
  }
  return true;
}

function questionToolContentMatches(body: unknown): boolean {
  if (!isRecord(body) || !Array.isArray(body.messages)) return false;
  const results = body.messages.filter(
    (message) => isRecord(message) && message.role === "tool" && message.tool_call_id === questionCallID,
  );
  if (results.length !== 1) return false;
  const result = results[0];
  return isRecord(result) && result.content === expectedModelContent;
}

function advertisedToolNames(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) =>
    isRecord(tool) && isRecord(tool.function) && typeof tool.function.name === "string" ? [tool.function.name] : [],
  );
}

function modelFixtureStep(request: number): "question-once" | "answer-once" | "question-reject" | undefined {
  return (
    {
      1: "question-once",
      2: "answer-once",
      3: "question-reject",
    } as const
  )[request as 1 | 2 | 3];
}

function safeOperation(method: string, pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1] === "session")
    return `${method} /api/session/:sessionID${parts[3] ? `/${parts[3]}` : ""}`;
  if (parts[0] === "api" && parts[1] === "permission") return `${method} /api/permission/:requestID`;
  if (parts[0] === "api" && parts[1] === "form") return `${method} /api/form/:formID`;
  if (parts[0] === "api" && ["info", "location", "event"].includes(parts[1] ?? "")) return `${method} /api/${parts[1]}`;
  return `${method} /api/other`;
}

async function absent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
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

async function waitFor(predicate: () => boolean | Promise<boolean>, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return predicate();
}

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded_cleanup_timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function processGroupGone(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

afterEach(async () => {
  for (const owner of owners) {
    await owner.dispose();
    owners.delete(owner);
  }
});

it("maps first-scenario permission/question round-trip through the native private adapter", {
  skip: !enabled,
  timeout: 105_000,
}, async () => {
  const fork = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
  const dedicatedFork = typeof fork.send === "function" && fork.connected === true;
  const root = await realpath(projectRoot);
  const evidenceBase = resolve(root, "tmp/scribe-v2-migration/interactions");
  await mkdir(evidenceBase, { recursive: true });
  await assertOwnedPath(root, evidenceBase);
  const runId = randomUUID();
  const runRoot = join(evidenceBase, runId);
  await mkdir(runRoot, { recursive: false });
  await assertOwnedPath(evidenceBase, runRoot);
  const evidencePath = join(runRoot, "result.json");
  const originalFetch = globalThis.fetch;
  const originalEnvironment = { ...process.env };
  let environmentReplaced = false;
  let isolation: V2TestIsolation | undefined;
  let agent: OpenCodeAgent | undefined;
  let fixture: Server | undefined;
  let fixtureClosed = false;
  let fixtureStateRemoved: boolean | null = null;
  let ownedPID: number | undefined;
  let modelRequests = 0;
  let modelFinalResponseSent = false;
  let permissionAskedCount = 0;
  let permissionRepliedOnceCount = 0;
  let questionAskedCount = 0;
  let questionRepliedCount = 0;
  let permissionRequestID: string | undefined;
  let questionFormID: string | undefined;
  let permissionReplyEventID: string | undefined;
  let questionReplyEventID: string | undefined;
  let permissionReplyCompleted = false;
  let questionReplyCompleted = false;
  let sawBusy = false;
  let sawIdleAfterBusy = false;
  let runtimeFailureCode: string | undefined;
  let scenario = 1;
  let scenario1Checks: Record<string, boolean> | undefined;
  let secondPermissionRequestID: string | undefined;
  let secondPermissionReplyEventID: string | undefined;
  let secondPermissionReplyCompleted = false;
  let secondPermissionRepliedCount = 0;
  let secondQuestionCallSeen = false;
  let secondTerminalBarrierReached = false;
  let terminalPollingEnabled = false;
  let terminalSessionGetRequests = 0;
  let terminalPollDeadline: number | undefined;
  let firstHistory: ChatMessageWithParts[] = [];
  let secondPromptSent = false;
  let sessionID: string | undefined;
  let promptSent = false;
  let permissionReply: Promise<void> | undefined;
  let questionReply: Promise<void> | undefined;
  const overall = new AbortController();
  const events: AgentEvent[] = [];
  const eventOrder: string[] = [];
  const checks: Record<string, boolean> = Object.fromEntries(requiredChecks.map((name) => [name, false]));
  const operations: Record<string, number> = {};
  const manifest: Manifest = {
    schemaVersion: 2,
    runId,
    qualification: "SCENARIOS1_2_ONLY",
    status: "RUNNING",
    stage: "preflight",
    expectedVersion,
    observedVersion: null,
    sourceCommit,
    sourceCommitMeaning: "inspected-release-tag",
    executablePath: executable && isAbsolute(executable) ? resolve(executable) : null,
    executableSha256: null,
    clientPackage: null,
    ownedPID: null,
    fixtureRoot: null,
    statePath: null,
    databasePath: null,
    evidencePath: relative(root, evidencePath),
    bounds: {
      overallMs: overallTimeoutMs,
      maxApiRequests,
      maxModelRequests,
      maxSessions,
      maxToolCalls,
      maxQuestionFields: 4,
      maxOwnedChildren: 1,
      maxModelBodyBytes: 65_536,
    },
    counts: { apiRequests: 0, modelRequests: 0, sessions: 0, toolCalls: 0 },
    apiOperations: operations,
    terminalSessionGetRequests: 0,
    terminalSessionObservations: [],
    checks,
    cleanup: {
      agentDisconnected: false,
      processGroupReaped: null,
      fixtureClosed: false,
      isolationRemoved: null,
      stateAbsent: null,
      databaseAbsent: null,
      environmentRestored: false,
      fetchRestored: false,
    },
  };
  const persist = () => writeFile(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const startedAt = Date.now();
  const deadline = startedAt + overallTimeoutMs;
  const timer = setTimeout(() => {
    runtimeFailureCode ??= "overall_deadline";
    overall.abort(new Error("overall_deadline"));
  }, overallTimeoutMs);
  try {
    await persist();
    checks.dedicatedVitestForkWithIPC = dedicatedFork;
    if (!dedicatedFork) throw Object.assign(new Error("blocked"), { code: "dedicated_fork_required" });
    if (!executable || !isAbsolute(executable))
      throw Object.assign(new Error("blocked"), { code: "executable_required" });
    const clientMetadata: unknown = JSON.parse(
      await readFile(resolve(root, "packages/agents/opencode/node_modules/@opencode/client/package.json"), "utf8"),
    );
    checks.clientPackageMetadataIsPinned =
      isRecord(clientMetadata) && clientMetadata.name === "@opencode/client" && clientMetadata.version === "2.1.0";
    if (
      isRecord(clientMetadata) &&
      typeof clientMetadata.name === "string" &&
      typeof clientMetadata.version === "string"
    )
      manifest.clientPackage = `${clientMetadata.name}@${clientMetadata.version}`;
    if (!checks.clientPackageMetadataIsPinned)
      throw Object.assign(new Error("blocked"), { code: "client_metadata_mismatch" });
    const executableBytes = await readFile(executable).catch(() => undefined);
    if (!executableBytes) throw Object.assign(new Error("blocked"), { code: "executable_unavailable" });
    manifest.executableSha256 = createHash("sha256").update(executableBytes).digest("hex");
    checks.executableHashPinned = manifest.executableSha256 === expectedExecutableSha256;
    if (!checks.executableHashPinned) throw Object.assign(new Error("blocked"), { code: "executable_hash_mismatch" });

    isolation = await createV2TestIsolation(runRoot);
    owners.add(isolation);
    manifest.fixtureRoot = relative(root, isolation.root);
    manifest.statePath = relative(root, isolation.paths.state);
    manifest.databasePath = relative(root, isolation.paths.database);
    checks.isolationPathsProjectLocal =
      manifest.fixtureRoot.startsWith("tmp/") && manifest.statePath.startsWith("tmp/");
    await assertIsolatedEnvironment(isolation.environment, isolation.paths);
    const gate = evaluateStaticPrelaunchGate(
      isolation.environment,
      isolation.paths,
      await inspectAmbientConfigSources(),
    );
    checks.ambientConfigGateClear = gate.status === "READY_FOR_DISPOSABLE_SPIKE";
    if (!checks.ambientConfigGateClear) throw Object.assign(new Error("blocked"), { code: "ambient_gate_blocked" });

    fixture = createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      modelRequests += 1;
      manifest.counts.modelRequests = modelRequests;
      if (modelRequests > maxModelRequests) {
        checks.modelRequestBoundRespected = false;
        runtimeFailureCode ??= "model_request_limit";
        overall.abort(new Error(runtimeFailureCode));
        response.writeHead(429).end();
        return;
      }
      if (modelRequests > 3) {
        runtimeFailureCode ??= "unexpected_model_continuation_after_question_rejection";
        overall.abort(new Error(runtimeFailureCode));
        response.writeHead(409).end();
        return;
      }
      let bodyText = "";
      let bytes = 0;
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > manifest.bounds.maxModelBodyBytes) {
          checks.modelBodyBoundRespected = false;
          runtimeFailureCode ??= "model_body_too_large";
          overall.abort(new Error(runtimeFailureCode));
          response.writeHead(413).end();
          return;
        }
        bodyText += chunk;
      }
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (modelFixtureStep(modelRequests) === "question-once") {
        const toolNames = advertisedToolNames(body);
        if (!toolNames.includes("question")) {
          checks.questionToolAdvertised = false;
          runtimeFailureCode ??= "question_tool_not_advertised";
          overall.abort(new Error(runtimeFailureCode));
          response.writeHead(409).end();
          return;
        }
        checks.questionToolAdvertised = true;
        // Native 2.2.0 advertises `skill` (browser plugin scoped deny); execution remains denied.
        checks.noForbiddenToolsAdvertised =
          toolNames.includes("question") && toolNames.every((name) => name === "question" || name === "skill");
        if (!checks.noForbiddenToolsAdvertised) {
          runtimeFailureCode ??= "unexpected_tool_advertised";
          overall.abort(new Error(runtimeFailureCode));
          response.writeHead(409).end();
          return;
        }
        manifest.counts.toolCalls += 1;
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.end(sseToolCall(questionCallID));
        return;
      }
      if (modelFixtureStep(modelRequests) === "answer-once") {
        checks.modelReceivedEncodedAnswersBeforeFinal = questionToolContentMatches(body);
        if (!checks.modelReceivedEncodedAnswersBeforeFinal) {
          runtimeFailureCode ??= "question_answer_content_mismatch";
          overall.abort(new Error(runtimeFailureCode));
          response.writeHead(409).end();
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        modelFinalResponseSent = true;
        response.end(sseAnswer("fixture question interaction complete"));
        return;
      }
      if (modelFixtureStep(modelRequests) === "question-reject") {
        const toolNames = advertisedToolNames(body);
        checks.modelRequest3RejectedQuestionCall =
          toolNames.includes("question") && toolNames.every((name) => name === "question" || name === "skill");
        if (!checks.modelRequest3RejectedQuestionCall) {
          runtimeFailureCode ??= "scenario2_question_tool_not_exclusive";
          overall.abort(new Error(runtimeFailureCode));
          response.writeHead(409).end();
          return;
        }
        manifest.counts.toolCalls += 1;
        secondQuestionCallSeen = true;
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.end(sseToolCall(rejectedQuestionCallID));
        return;
      }
      runtimeFailureCode ??= `unexpected_model_fixture_step_${modelRequests}`;
      overall.abort(new Error(runtimeFailureCode));
      response.writeHead(409).end();
    });
    const port = await listen(fixture);
    await writeFile(
      join(isolation.paths.config, "opencode", "opencode.json"),
      JSON.stringify(buildFixtureConfig(port)),
      {
        mode: 0o600,
      },
    );

    const nativeFetch = originalFetch.bind(globalThis);
    const ownedFixtureDirectory = isolation.paths.cwd;
    let apiRequests = 0;
    let ownedOrigin: string | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/api/")) {
        apiRequests += 1;
        manifest.counts.apiRequests = apiRequests;
        const operation = safeOperation(
          (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
          parsed.pathname,
        );
        operations[operation] = (operations[operation] ?? 0) + 1;
        if (apiRequests > maxApiRequests) {
          runtimeFailureCode ??= "api_request_limit";
          overall.abort(new Error("api_request_limit"));
          throw Object.assign(new Error("bounded"), { code: "api_request_limit" });
        }
        if (ownedOrigin && parsed.origin !== ownedOrigin) {
          runtimeFailureCode ??= "foreign_api_origin";
          overall.abort(new Error("foreign_api_origin"));
          throw Object.assign(new Error("bounded"), { code: "foreign_api_origin" });
        }
      }
      if (
        scenario === 2 &&
        terminalPollingEnabled &&
        sessionID &&
        (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() === "GET" &&
        parsed.pathname === `/api/session/${encodeURIComponent(sessionID)}`
      ) {
        if (terminalSessionGetRequests >= 10) {
          runtimeFailureCode ??= "terminal_session_get_limit";
          overall.abort(new Error(runtimeFailureCode));
          throw Object.assign(new Error("bounded"), { code: "terminal_session_get_limit" });
        }
        terminalSessionGetRequests += 1;
        manifest.terminalSessionGetRequests = terminalSessionGetRequests;
      }
      const inputSignal = input instanceof Request ? input.signal : undefined;
      const remaining = Math.max(1, deadline - Date.now());
      const signals = [
        overall.signal,
        AbortSignal.timeout(remaining),
        ...(terminalPollingEnabled && terminalPollDeadline !== undefined
          ? [AbortSignal.timeout(Math.max(1, terminalPollDeadline - Date.now()))]
          : []),
        ...(inputSignal ? [inputSignal] : []),
        ...(init?.signal ? [init.signal] : []),
      ];
      const result = await nativeFetch(input, { ...init, signal: AbortSignal.any(signals) });
      if (
        scenario === 2 &&
        terminalPollingEnabled &&
        sessionID &&
        (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() === "GET" &&
        parsed.pathname === `/api/session/${encodeURIComponent(sessionID)}` &&
        result.ok
      ) {
        const sessionInfo: unknown = await result
          .clone()
          .json()
          .catch(() => undefined);
        const observed = observeOwnedSessionInfo(sessionInfo, sessionID, ownedFixtureDirectory);
        manifest.terminalSessionObservations.push({
          ownedIDMatched: observed.ownedIDMatched,
          locationMatched: observed.locationMatched,
          outcomeFieldPresent: observed.outcomeFieldPresent,
          outcome: observed.outcome,
          rawSessionStatus: observed.rawSessionStatus,
        });
      }
      if (parsed.pathname === "/api/info" && result.ok) {
        const info: unknown = await result
          .clone()
          .json()
          .catch(() => undefined);
        if (isRecord(info)) {
          if (typeof info.version === "string") manifest.observedVersion = info.version;
          if (typeof info.pid === "number") ownedPID = info.pid;
          if (typeof info.pid === "number") manifest.ownedPID = info.pid;
          if (manifest.observedVersion === expectedVersion && ownedPID !== undefined) ownedOrigin = parsed.origin;
        }
      }
      return result;
    }) as typeof fetch;
    environmentReplaced = true;
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, isolation.environment);
    checks.spawnGateClear =
      evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, await inspectAmbientConfigSources())
        .status === "READY_FOR_DISPOSABLE_SPIKE";
    if (!checks.spawnGateClear) throw Object.assign(new Error("blocked"), { code: "spawn_gate_blocked" });

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
    });
    const recordReply = (
      operation: Promise<void>,
      failureCode: "permission_reply_failed" | "question_reply_failed",
      onSuccess: () => void,
    ) =>
      operation.then(onSuccess, () => {
        runtimeFailureCode ??= failureCode;
        overall.abort(new Error(failureCode));
      });
    const onEvent = (event: AgentEvent) => {
      events.push(event);
      if (event.type === "permission.asked" && event.properties.permission === "question") {
        permissionAskedCount += 1;
        eventOrder.push(`permission.asked:${event.properties.id}:${event.properties.tool?.callID ?? "missing"}`);
        if (scenario === 1) {
          permissionRequestID = event.properties.id;
          checks.permissionSessionMatches = event.properties.sessionID === sessionID;
          checks.permissionSourceHasQuestionCallIdentity = event.properties.tool?.callID === questionCallID;
          if (agent)
            permissionReply = recordReply(
              agent.replyPermission(event.properties.sessionID, event.properties.id, "once"),
              "permission_reply_failed",
              () => {
                permissionReplyCompleted = true;
              },
            );
        } else {
          secondPermissionRequestID = event.properties.id;
          checks.secondPermissionAskMatchesRejectedCall =
            event.properties.sessionID === sessionID &&
            event.properties.permission === "question" &&
            event.properties.tool?.callID === rejectedQuestionCallID;
          if (!checks.secondPermissionAskMatchesRejectedCall) {
            runtimeFailureCode ??= "scenario2_permission_identity_mismatch";
            overall.abort(new Error(runtimeFailureCode));
            return;
          }
          if (agent)
            permissionReply = recordReply(
              agent.replyPermission(event.properties.sessionID, event.properties.id, "reject"),
              "permission_reply_failed",
              () => {
                secondPermissionReplyCompleted = true;
              },
            );
        }
      }
      if (event.type === "permission.replied") {
        eventOrder.push(`permission.replied:${event.properties.requestID}:${event.properties.reply}`);
        if (scenario === 1 && event.properties.reply === "once" && event.properties.requestID === permissionRequestID) {
          permissionRepliedOnceCount += 1;
          permissionReplyEventID = event.properties.requestID;
        }
        if (
          scenario === 2 &&
          event.properties.reply === "reject" &&
          event.properties.requestID === secondPermissionRequestID
        ) {
          secondPermissionRepliedCount += 1;
          secondPermissionReplyEventID = event.properties.requestID;
        }
      }
      if (event.type === "question.asked") {
        questionAskedCount += 1;
        if (scenario === 2) {
          checks.secondQuestionFormNotCreated = false;
          runtimeFailureCode ??= "scenario2_unexpected_question_form";
          overall.abort(new Error(runtimeFailureCode));
          return;
        }
        questionFormID = event.properties.id;
        eventOrder.push(`question.asked:${event.properties.id}`);
        checks.questionSessionMatches = event.properties.sessionID === sessionID;
        checks.questionToolIdentityMatches = event.properties.tool?.callID === questionCallID;
        checks.questionFieldsMatch =
          event.properties.questions.length === 4 &&
          event.properties.questions[0]?.multiple !== true &&
          event.properties.questions[1]?.multiple === true &&
          event.properties.questions[2]?.custom === true &&
          event.properties.questions[3]?.question === "Skip this" &&
          event.properties.questions.every((question) => question.custom === true);
        if (agent)
          questionReply = recordReply(
            agent.replyQuestion(event.properties.id, [
              ["option-a"],
              ["option-a", "option-b"],
              ["my custom answer"],
              [],
            ]),
            "question_reply_failed",
            () => {
              questionReplyCompleted = true;
            },
          );
      }
      if (event.type === "question.replied") {
        if (event.properties.requestID === questionFormID) {
          questionRepliedCount += 1;
          questionReplyEventID = event.properties.requestID;
        }
        eventOrder.push(`question.reply-event:${event.properties.requestID}`);
      }
      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "busy"
      ) {
        sawBusy = true;
        eventOrder.push("session.busy");
      }
      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle" &&
        sawBusy
      ) {
        sawIdleAfterBusy = true;
        eventOrder.push("session.idle");
      }
    };
    agent.onEvent(onEvent);
    await agent.connect();
    checks.privateChildVersionMatches = manifest.observedVersion === expectedVersion;
    const session = await agent.createSession("disposable question interaction fixture");
    sessionID = session.id;
    manifest.counts.sessions = 1;
    checks.oneOwnedSession = session.id.length > 0 && session.directory === isolation.paths.cwd;
    await agent.sendMessage(session.id, "Answer the four fixture questions.", { primaryAgent: "fixture-question" });
    promptSent = true;
    await waitFor(() => (modelFinalResponseSent && sawIdleAfterBusy) || runtimeFailureCode !== undefined, deadline);
    if (modelFinalResponseSent && sawIdleAfterBusy && questionReplyCompleted && permissionAskedCount === 0)
      runtimeFailureCode ??= "native_question_permission_missing";
    if (permissionReply) await permissionReply;
    if (questionReply) await questionReply;
    checks.permissionAskedAndQuestionFormCreated = permissionAskedCount === 1 && questionAskedCount === 1;
    checks.adapterRepliesCompleted = permissionReplyCompleted && questionReplyCompleted;
    checks.repliesSucceededWithoutRuntimeError =
      runtimeFailureCode === undefined && permissionReplyCompleted && questionReplyCompleted;
    const drained = await waitFor(
      () =>
        (permissionReplyEventID !== undefined &&
          questionReplyEventID !== undefined &&
          sawIdleAfterBusy &&
          modelRequests === 2) ||
        runtimeFailureCode !== undefined,
      deadline,
    );
    checks.exactlyOneQuestionPermissionAskAndOnceReply = permissionAskedCount === 1 && permissionRepliedOnceCount === 1;
    checks.exactlyOneQuestionFormAndReply = questionAskedCount === 1 && questionRepliedCount === 1;
    checks.noUnexpectedInteractions =
      events.filter((event) => event.type === "permission.asked").length === 1 &&
      events.filter((event) => event.type === "question.asked").length === 1;
    checks.nativeSessionReachedBusyThenIdleAfterModelAnswer =
      drained && sawBusy && sawIdleAfterBusy && modelRequests === 2;
    const history: ChatMessageWithParts[] = await agent.getMessages(session.id);
    checks.nativeHistoryContainsFinalAssistantAnswer = history.some(
      (message) =>
        message.info.role === "assistant" &&
        message.info.finish === "stop" &&
        message.info.error === undefined &&
        message.parts.some((part) => part.type === "text" && part.text === "fixture question interaction complete"),
    );
    checks.nativeHistoryContainsQuestionToolCall = history.some((message) =>
      message.parts.some(
        (part) => part.type === "tool" && part.callID === questionCallID && part.state.status === "completed",
      ),
    );
    checks.nativeEventOrderIsPermissionThenFormReplyThenIdle = Boolean(
      permissionRequestID &&
        permissionReplyEventID === permissionRequestID &&
        questionFormID &&
        questionReplyEventID === questionFormID &&
        eventsInOrder(eventOrder, [
          `permission.asked:${permissionRequestID}:${questionCallID}`,
          `permission.replied:${permissionRequestID}:once`,
          `question.asked:${questionFormID}`,
          `question.reply-event:${questionFormID}`,
          "session.idle",
        ]) &&
        eventOrder.indexOf("session.busy") >= 0 &&
        eventOrder.indexOf("session.busy") < eventOrder.indexOf("session.idle"),
    );
    firstHistory = history;
    scenario1Checks = { ...checks };
    checks.scenario1ChecksFrozen = true;

    scenario = 2;
    sawBusy = false;
    sawIdleAfterBusy = false;
    modelFinalResponseSent = false;
    eventOrder.push("scenario2.begin");
    await agent.sendMessage(session.id, "Ask the question again; this request will be declined.", {
      primaryAgent: "fixture-question",
    });
    secondPromptSent = true;
    checks.secondPromptSameSessionAndAgent = manifest.counts.sessions === 1 && sessionID === session.id;
    const permissionAskSeen = await waitFor(
      () => secondPermissionRequestID !== undefined || runtimeFailureCode !== undefined || sawIdleAfterBusy,
      Math.min(deadline, Date.now() + 10_000),
    );
    if (runtimeFailureCode === undefined && (!permissionAskSeen || secondPermissionRequestID === undefined)) {
      runtimeFailureCode = "scenario2_permission_ask_missing";
      overall.abort(new Error(runtimeFailureCode));
    }
    const scenario2Drained = await waitFor(
      () => (sawIdleAfterBusy && secondPermissionReplyEventID !== undefined) || runtimeFailureCode !== undefined,
      Math.min(deadline, Date.now() + 15_000),
    );
    if (!scenario2Drained && runtimeFailureCode === undefined) {
      runtimeFailureCode = "scenario2_native_terminal_barrier_missing";
      overall.abort(new Error(runtimeFailureCode));
    }
    if (permissionReply) await permissionReply;
    checks.secondPermissionReplyRejected =
      secondPermissionReplyCompleted && secondPermissionReplyEventID === secondPermissionRequestID;
    checks.secondQuestionFormNotCreated = questionAskedCount === 1;
    checks.freshSecondBusyThenIdle = scenario2Drained && sawBusy && sawIdleAfterBusy;
    const secondHistory = await agent.getMessages(session.id);
    const pollDeadline = Math.min(deadline, Date.now() + 3_000);
    terminalPollDeadline = pollDeadline;
    terminalPollingEnabled = true;
    try {
      while (terminalSessionGetRequests < 10 && Date.now() < pollDeadline) {
        const readsBefore = manifest.terminalSessionObservations.length;
        await agent.getSession(session.id);
        if (manifest.terminalSessionObservations.length === readsBefore) break;
        const latest = manifest.terminalSessionObservations.at(-1);
        if (!shouldContinueTerminalPoll(latest)) break;
        if (manifest.terminalSessionObservations.length < 10 && Date.now() < pollDeadline)
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }
    } finally {
      terminalPollingEnabled = false;
      terminalPollDeadline = undefined;
    }
    eventOrder.push("scenario2.terminal-history-barrier");
    secondTerminalBarrierReached = true;
    const latestTerminalObservation = manifest.terminalSessionObservations.at(-1);
    checks.nativeSessionInfoReadAfterTerminal = Boolean(
      latestTerminalObservation?.ownedIDMatched && latestTerminalObservation.locationMatched,
    );
    // The rejected call leaves the previous successful idle outcome projected on the session.
    // The error/history and no-continuation checks below establish that this is not a new success.
    checks.ownedSessionOutcomeMatchesPriorSuccess =
      checks.nativeHistoryContainsFinalAssistantAnswer &&
      hasOwnedSessionOutcomeObservation(manifest.terminalSessionObservations, "succeeded");
    checks.nativeHistoryContainsRejectedToolError = secondHistory.some((message) =>
      message.parts.some(
        (part) => part.type === "tool" && part.callID === rejectedQuestionCallID && part.state.status === "error",
      ),
    );
    const firstAssistantIDs = new Set(
      firstHistory.filter((message) => message.info.role === "assistant").map((message) => message.info.id),
    );
    checks.nativeHistoryContainsRejectedQuestionAssistantError = secondHistory.some(
      (message) =>
        message.info.role === "assistant" &&
        !firstAssistantIDs.has(message.info.id) &&
        message.info.error !== undefined &&
        message.info.finish !== "stop" &&
        !message.parts.some((part) => part.type === "text" && part.text === "fixture permission denied"),
    );
    checks.noModelContinuationAfterTerminalBarrier = secondTerminalBarrierReached && modelRequests === 3;
    const firstCallParts = (messages: ChatMessageWithParts[]) =>
      messages.flatMap((message) =>
        message.parts.filter((part) => part.type === "tool" && part.callID === questionCallID),
      );
    checks.nativeHistoryPreservesFirstCompletedCallAndAnswers =
      firstHistory.some((message) =>
        message.parts.some(
          (part) => part.type === "tool" && part.callID === questionCallID && part.state.status === "completed",
        ),
      ) &&
      JSON.stringify(firstCallParts(firstHistory)) === JSON.stringify(firstCallParts(secondHistory)) &&
      checks.modelReceivedEncodedAnswersBeforeFinal;
    checks.exactTwoPermissionAsksAndReplies =
      permissionAskedCount === 2 &&
      permissionRepliedOnceCount === 1 &&
      secondPermissionRepliedCount === 1 &&
      events.filter((event) => event.type === "permission.asked").length === 2 &&
      events.filter((event) => event.type === "permission.replied").length === 2 &&
      secondPermissionReplyCompleted &&
      secondPermissionReplyEventID === secondPermissionRequestID;
    checks.exactlyOneQuestionFormAndReplyAcrossScenarios =
      questionAskedCount === 1 &&
      questionRepliedCount === 1 &&
      events.filter((event) => event.type === "question.asked").length === 1 &&
      events.filter((event) => event.type === "question.replied").length === 1;
    checks.exactlyThreeModelRequestsAndTwoQuestionCalls =
      modelRequests === 3 && manifest.counts.toolCalls === 2 && secondQuestionCallSeen;
    const scenario2StartIndex = eventOrder.indexOf("scenario2.begin");
    const scenario2BusyIndex = eventOrder.indexOf("session.busy", scenario2StartIndex + 1);
    const scenario2IdleIndex = eventOrder.indexOf("session.idle", scenario2BusyIndex + 1);
    const scenario2BarrierIndex = eventOrder.indexOf("scenario2.terminal-history-barrier");
    checks.scenario2EventOrderUsesDistinctIDs = Boolean(
      secondPermissionRequestID &&
        secondPermissionRequestID !== permissionRequestID &&
        secondPermissionReplyEventID === secondPermissionRequestID &&
        eventsInOrder(eventOrder, [
          `permission.asked:${secondPermissionRequestID}:${rejectedQuestionCallID}`,
          `permission.replied:${secondPermissionRequestID}:reject`,
          "session.idle",
          "scenario2.terminal-history-barrier",
        ]) &&
        scenario2BusyIndex > scenario2StartIndex &&
        scenario2IdleIndex > scenario2BusyIndex &&
        scenario2BarrierIndex > scenario2IdleIndex &&
        scenario2StartIndex <
          eventOrder.indexOf(`permission.asked:${secondPermissionRequestID}:${rejectedQuestionCallID}`),
    );
    checks.requestBounds =
      apiRequests <= maxApiRequests &&
      modelRequests === 3 &&
      manifest.counts.sessions === 1 &&
      manifest.counts.toolCalls === 2;
    checks.noUnexpectedInteractions =
      permissionAskedCount === 2 &&
      questionAskedCount === 1 &&
      events.filter((event) => event.type === "permission.asked").length === 2 &&
      events.filter((event) => event.type === "permission.replied").length === 2 &&
      events.filter((event) => event.type === "question.asked").length === 1 &&
      events.filter((event) => event.type === "question.replied").length === 1;
    checks.scenarios1And2Only = secondPromptSent;
    checks.scenario1ChecksFrozen =
      Boolean(scenario1Checks) &&
      [
        "permissionAskedAndQuestionFormCreated",
        "permissionSessionMatches",
        "permissionSourceHasQuestionCallIdentity",
        "questionSessionMatches",
        "questionToolIdentityMatches",
        "questionFieldsMatch",
        "adapterRepliesCompleted",
        "repliesSucceededWithoutRuntimeError",
        "exactlyOneQuestionPermissionAskAndOnceReply",
        "exactlyOneQuestionFormAndReply",
        "nativeSessionReachedBusyThenIdleAfterModelAnswer",
        "nativeHistoryContainsFinalAssistantAnswer",
        "nativeHistoryContainsQuestionToolCall",
        "nativeEventOrderIsPermissionThenFormReplyThenIdle",
        "modelReceivedEncodedAnswersBeforeFinal",
      ].every((name) => checks[name] === scenario1Checks?.[name]);
    checks.runtimeWithinDeadline = Date.now() - startedAt <= overallTimeoutMs;
    manifest.status = Object.values(checks).every(Boolean) ? "RUNNING" : "FAIL";
    manifest.stage = "pre_teardown_evidence";
    await persist();
    await agent.deleteSession(session.id);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    manifest.failureCode =
      runtimeFailureCode ??
      ([
        "dedicated_fork_required",
        "executable_required",
        "executable_unavailable",
        "executable_hash_mismatch",
        "client_metadata_mismatch",
        "ambient_gate_blocked",
        "spawn_gate_blocked",
        "api_request_limit",
        "foreign_api_origin",
      ].includes(String(code))
        ? String(code)
        : "fixture_operation_failed");
    manifest.status = [
      "dedicated_fork_required",
      "executable_required",
      "executable_unavailable",
      "executable_hash_mismatch",
      "client_metadata_mismatch",
      "ambient_gate_blocked",
      "spawn_gate_blocked",
    ].includes(manifest.failureCode)
      ? "BLOCKED"
      : "FAIL";
  } finally {
    clearTimeout(timer);
    manifest.stage = "pre_teardown_evidence";
    manifest.preTeardown = {
      status: manifest.status,
      stage: manifest.stage,
      checks: { ...checks },
      counts: { ...manifest.counts, modelRequests, sessions: sessionID ? 1 : 0 },
      ...(manifest.failureCode ? { failureCode: manifest.failureCode } : {}),
    };
    try {
      await persist();
    } catch {
      manifest.status = "FAIL";
      manifest.failureCode ??= "evidence_persist_failed";
    }
    manifest.stage = "cleanup";
    if (agent) {
      try {
        agent.disconnect();
        const cleanup = (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise;
        if (cleanup) {
          await bounded(cleanup, 5_000);
          manifest.cleanup.agentDisconnected = true;
        }
      } catch {
        manifest.cleanup.agentDisconnected = false;
      }
    }
    if (ownedPID !== undefined) {
      const reapDeadline = Date.now() + 3_000;
      await waitFor(() => processGroupGone(ownedPID as number), reapDeadline);
      manifest.cleanup.processGroupReaped = processGroupGone(ownedPID);
    }
    if (fixture) {
      try {
        await bounded(new Promise<void>((close) => fixture?.close(() => close())), 3_000);
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
    if (isolation) {
      try {
        await bounded(isolation.dispose(), 5_000);
        manifest.cleanup.isolationRemoved = await absent(isolation.root);
        manifest.cleanup.stateAbsent = await absent(isolation.paths.state);
        manifest.cleanup.databaseAbsent = await absent(isolation.paths.database);
        fixtureStateRemoved =
          manifest.cleanup.isolationRemoved && manifest.cleanup.stateAbsent && manifest.cleanup.databaseAbsent;
      } catch {
        manifest.cleanup.isolationRemoved = false;
        manifest.cleanup.stateAbsent = false;
        manifest.cleanup.databaseAbsent = false;
        fixtureStateRemoved = false;
      }
      owners.delete(isolation);
    }
    try {
      if (environmentReplaced) {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, originalEnvironment);
      }
      manifest.cleanup.environmentRestored = Object.keys({ ...originalEnvironment, ...process.env }).every(
        (key) => originalEnvironment[key] === process.env[key],
      );
    } catch {
      manifest.cleanup.environmentRestored = false;
    }
    globalThis.fetch = originalFetch;
    manifest.cleanup.fetchRestored = globalThis.fetch === originalFetch;
    if (manifest.status === "RUNNING") {
      manifest.status = "FAIL";
      manifest.counts = {
        apiRequests: manifest.counts.apiRequests,
        modelRequests,
        sessions: sessionID ? 1 : 0,
        toolCalls: manifest.counts.toolCalls,
      };
      manifest.stage = "completed";
      if (
        fixtureStateRemoved === true &&
        verifyScenario12Manifest({
          ...manifest,
          status: "PASS",
          cleanup: { ...manifest.cleanup, isolationRemoved: true, stateAbsent: true, databaseAbsent: true },
        })
      )
        manifest.status = "PASS";
    }
    if (manifest.status !== "PASS" && !manifest.failureCode)
      manifest.failureCode = runtimeFailureCode ?? "required_check_failed";
    manifest.counts = {
      apiRequests: manifest.counts.apiRequests,
      modelRequests,
      sessions: sessionID ? 1 : 0,
      toolCalls: manifest.counts.toolCalls,
    };
    manifest.apiOperations = operations;
    manifest.stage = "completed";
    try {
      await persist();
    } catch {
      manifest.status = "FAIL";
    }
  }
  const persisted = JSON.parse(await readFile(evidencePath, "utf8")) as Manifest;
  expect(verifyScenario12Manifest(persisted)).toBe(true);
  expect(persisted.qualification).toBe("SCENARIOS1_2_ONLY");
  expect(persisted.counts.modelRequests).toBe(3);
  expect(persisted.counts.toolCalls).toBe(2);
  expect(promptSent && secondPromptSent).toBe(true);
});

describe("interaction fixture pure contracts", () => {
  it("binds the two-scenario provider response sequence to distinct question call identities", () => {
    expect([1, 2, 3, 4].map(modelFixtureStep)).toEqual(["question-once", "answer-once", "question-reject", undefined]);
    expect(questionCallID).not.toBe(rejectedQuestionCallID);
  });

  it("records bounded terminal observations and distinguishes the prior success from interruption", () => {
    const interrupted = observeOwnedSessionInfo(
      { data: { id: "owned", location: { directory: "fixture" }, outcome: "interrupted" } },
      "owned",
      "fixture",
    );
    expect(interrupted).toEqual({
      dataRecord: true,
      ownedIDMatched: true,
      locationMatched: true,
      outcomeFieldPresent: true,
      outcome: "interrupted",
      rawSessionStatus: "missing",
    });
    expect(hasOwnedSessionOutcomeObservation([interrupted], "interrupted")).toBe(true);
    expect(hasOwnedSessionOutcomeObservation([interrupted], "succeeded")).toBe(false);
    const succeeded = observeOwnedSessionInfo(
      { data: { id: "owned", location: { directory: "fixture" }, outcome: "succeeded" } },
      "owned",
      "fixture",
    );
    expect(hasOwnedSessionOutcomeObservation([succeeded], "succeeded")).toBe(true);
    expect(hasOwnedSessionOutcomeObservation([succeeded], "interrupted")).toBe(false);
    const nullable = observeOwnedSessionInfo(
      { data: { id: "owned", location: { directory: "fixture" }, outcome: null } },
      "owned",
      "fixture",
    );
    expect(nullable.outcomeFieldPresent).toBe(true);
    expect(nullable.outcome).toBe("unknown");
    expect(
      observeOwnedSessionInfo({ data: { id: "owned", location: { directory: "fixture" } } }, "owned", "fixture")
        .outcomeFieldPresent,
    ).toBe(false);
    expect(
      observeOwnedSessionInfo(
        { data: { id: "foreign", location: { directory: "fixture" }, outcome: "interrupted" } },
        "owned",
        "fixture",
      ).outcome,
    ).toBe("unknown");
    expect(
      observeOwnedSessionInfo(
        { data: { id: "owned", location: { directory: "foreign" }, outcome: "interrupted" } },
        "owned",
        "fixture",
      ).locationMatched,
    ).toBe(false);
    expect(
      observeOwnedSessionInfo(
        { data: { id: "owned", location: { directory: "fixture" }, outcome: "running", status: { type: "busy" } } },
        "owned",
        "fixture",
      ),
    ).toMatchObject({ outcome: "unknown", rawSessionStatus: "busy" });
    expect(hasOwnedSessionOutcomeObservation([{ ...interrupted, outcome: "succeeded" }], "succeeded")).toBe(true);
    expect(
      hasOwnedSessionOutcomeObservation([{ ...interrupted, outcome: "succeeded", ownedIDMatched: false }], "succeeded"),
    ).toBe(false);
    expect(hasOwnedSessionOutcomeObservation([nullable], "succeeded")).toBe(false);
    expect(hasOwnedSessionOutcomeObservation([], "succeeded")).toBe(false);
  });

  it("continues terminal polling until the prior success is observed or owned identity is lost", () => {
    const observation = (
      outcome: TerminalSessionObservation["outcome"],
      overrides: Partial<TerminalSessionObservation> = {},
    ): TerminalSessionObservation => ({
      ownedIDMatched: true,
      locationMatched: true,
      outcomeFieldPresent: outcome !== "unknown",
      outcome,
      rawSessionStatus: "idle",
      ...overrides,
    });

    expect(shouldContinueTerminalPoll(observation("succeeded"))).toBe(false);
    expect(shouldContinueTerminalPoll(observation("failed"))).toBe(true);
    expect(shouldContinueTerminalPoll(observation("unknown"))).toBe(true);
    expect(shouldContinueTerminalPoll(observation("interrupted"))).toBe(true);
    expect(shouldContinueTerminalPoll(observation("unknown", { ownedIDMatched: false }))).toBe(false);
    expect(shouldContinueTerminalPoll(observation("unknown", { locationMatched: false }))).toBe(false);
    expect(shouldContinueTerminalPoll(undefined)).toBe(false);
  });

  it("rejects stale first-scenario manifests and requires all scenario 1–2 checks and cleanup", () => {
    const checks = Object.fromEntries(requiredChecks.map((name) => [name, true]));
    const cleanup = {
      agentDisconnected: true,
      processGroupReaped: true,
      fixtureClosed: true,
      isolationRemoved: true,
      stateAbsent: true,
      databaseAbsent: true,
      environmentRestored: true,
      fetchRestored: true,
    };
    const current = {
      schemaVersion: 2,
      qualification: "SCENARIOS1_2_ONLY",
      status: "PASS",
      stage: "completed",
      ownedPID: 1234,
      counts: { apiRequests: 25, modelRequests: 3, toolCalls: 2, sessions: 1 },
      terminalSessionGetRequests: 1,
      terminalSessionObservations: [
        {
          ownedIDMatched: true,
          locationMatched: true,
          outcomeFieldPresent: true,
          outcome: "succeeded",
          rawSessionStatus: "missing",
        },
      ],
      checks,
      cleanup,
    };
    expect(verifyScenario12Manifest(current)).toBe(true);
    expect(verifyScenario12Manifest({ ...current, schemaVersion: 1 })).toBe(false);
    expect(
      verifyScenario12Manifest({
        ...current,
        qualification: "FIRST_QUESTION_ONCE_PERMISSION_FOUR_FIELD_PRODUCTION_ADAPTER_PRIVATE_SERVER_FIXTURE_ONLY",
        counts: { ...current.counts, modelRequests: 2, toolCalls: 1 },
      }),
    ).toBe(false);
    expect(verifyScenario12Manifest({ ...current, counts: { ...current.counts, modelRequests: 4 } })).toBe(false);
    expect(verifyScenario12Manifest({ ...current, terminalSessionGetRequests: 11 })).toBe(false);
    expect(
      verifyScenario12Manifest({
        ...current,
        terminalSessionObservations: [{ ...current.terminalSessionObservations[0], outcome: "unknown" }],
      }),
    ).toBe(false);
    expect(
      verifyScenario12Manifest({
        ...current,
        terminalSessionObservations: [{ ...current.terminalSessionObservations[0], outcome: "interrupted" }],
      }),
    ).toBe(false);
    expect(
      verifyScenario12Manifest({
        ...current,
        terminalSessionObservations: [
          { ...current.terminalSessionObservations[0], outcomeFieldPresent: false, outcome: "unknown" },
        ],
      }),
    ).toBe(false);
    expect(
      verifyScenario12Manifest({
        ...current,
        terminalSessionObservations: [{ ...current.terminalSessionObservations[0], ownedIDMatched: false }],
      }),
    ).toBe(false);
    expect(
      verifyScenario12Manifest({
        ...current,
        terminalSessionObservations: [{ ...current.terminalSessionObservations[0], locationMatched: false }],
      }),
    ).toBe(false);
    expect(verifyScenario12Manifest({ ...current, terminalSessionObservations: [] })).toBe(false);
    expect(
      verifyScenario12Manifest({ ...current, checks: { ...checks, ownedSessionOutcomeMatchesPriorSuccess: false } }),
    ).toBe(false);
    expect(
      verifyScenario12Manifest({
        ...current,
        checks: { ...checks, nativeHistoryContainsRejectedQuestionAssistantError: false },
      }),
    ).toBe(false);
    expect(
      verifyScenario12Manifest({ ...current, checks: { ...checks, noModelContinuationAfterTerminalBarrier: false } }),
    ).toBe(false);
    expect(verifyScenario12Manifest({ ...current, cleanup: { ...cleanup, databaseAbsent: false } })).toBe(false);
  });

  it("builds the fixture agent as native V2 config and preserves its deny/ask rules", () => {
    const config = buildFixtureConfig(1234);
    expect(config.agents["fixture-question"].permissions).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "question", resource: "*", effect: "ask" },
    ]);
    expect("agent" in config).toBe(false);
    expect(config.plugin).toEqual([]);
    expect(config.mcp).toEqual({});
  });

  it("advertises only the question tool, not denied/unknown tools", () => {
    expect(advertisedToolNames({ tools: [{ function: { name: "question" } }] })).toEqual(["question"]);
    expect(
      advertisedToolNames({ tools: [{ function: { name: "question" } }, { function: { name: "shell" } }] }),
    ).toEqual(["question", "shell"]);
    expect(advertisedToolNames({ tools: [{ function: { name: "write" } }] })).not.toContain("question");
    expect(advertisedToolNames({ tools: [{ function: { name: "unknown-tool" } }] })).not.toEqual(["question"]);
  });

  it("emits deterministic native-provider SSE frames", () => {
    expect(sseToolCall(questionCallID)).toContain('"name":"question"');
    expect(sseToolCall(questionCallID)).toContain('"id":"fixture-question-call"');
    expect(sseToolCall(rejectedQuestionCallID)).toContain('"id":"fixture-question-rejected"');
    expect(sseAnswer("fixture")).toContain('"content":"fixture"');
  });

  it("checks event ordering rather than accepting reordered native interactions", () => {
    expect(
      eventsInOrder(
        ["permission.asked", "permission.replied", "question.asked", "question.replied", "session.idle"],
        ["permission.asked", "permission.replied", "question.asked", "question.replied", "session.idle"],
      ),
    ).toBe(true);
    expect(eventsInOrder(["question.asked", "permission.asked"], ["permission.asked", "question.asked"])).toBe(false);
  });

  it("requires the exact native question result, call identity, answer order, and multiselect text", () => {
    const body = (content: unknown, callID = questionCallID) => ({
      messages: [{ role: "tool", tool_call_id: callID, content }],
    });
    expect(questionToolContentMatches(body(expectedModelContent))).toBe(true);
    expect(questionToolContentMatches(body(expectedModelContent, "other-call"))).toBe(false);
    expect(questionToolContentMatches(body(expectedModelContent.replace('"Skip this"="Unanswered"', "")))).toBe(false);
    expect(
      questionToolContentMatches(
        body(
          expectedModelContent.replace(
            '"Pick one"="option-a", "Pick any"="option-a, option-b"',
            '"Pick any"="option-a, option-b", "Pick one"="option-a"',
          ),
        ),
      ),
    ).toBe(false);
    expect(
      questionToolContentMatches(
        body(expectedModelContent.replace('"Pick any"="option-a, option-b"', '"Pick any"="option-a"')),
      ),
    ).toBe(false);
    expect(
      questionToolContentMatches(
        body(expectedModelContent.replace('"Pick any"="option-a, option-b"', '"Pick any"="option-b, option-a"')),
      ),
    ).toBe(false);
    expect(questionToolContentMatches(body(`${expectedModelContent} option-a`))).toBe(false);
    expect(questionToolContentMatches({ messages: [] })).toBe(false);
    expect(
      questionToolContentMatches(body(expectedModelContent).messages.concat(body(expectedModelContent).messages)),
    ).toBe(false);
  });
});
