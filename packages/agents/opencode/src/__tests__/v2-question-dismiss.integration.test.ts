import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenCodeClient } from "@opencode/client";
import type { AgentEvent, ChatMessageWithParts } from "@opencode-chat/core";
import { describe, expect, it } from "vitest";
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
const rootPath = fileURLToPath(new URL("../../../../../", import.meta.url));
const version = "2.2.0";
const executableHash = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const bounds = {
  overallMs: 90_000,
  apiRequests: 60,
  modelRequests: 2,
  sessions: 1,
  children: 1,
  questionCalls: 2,
  prompts: 2,
  modelBodyBytes: 65_536,
} as const;
const questionCallID = "fixture-dismiss-question-call";
const stopCallID = "fixture-stop-question-call";
const questions = [{ header: "Continue?", question: "Choose", options: [{ label: "yes", description: "Yes" }] }];
const requiredChecks = [
  "dedicatedFork",
  "clientMetadataPinned",
  "executableHashPinned",
  "projectLocalIsolation",
  "ambientGateClear",
  "spawnGateClear",
  "privateChildVersionAndPID",
  "oneOwnedSession",
  "questionOnlyAdvertised",
  "permissionAskIdentity",
  "permissionAlwaysReplyIdentity",
  "permissionGetIdentity",
  "permissionGetSaveAbsent",
  "questionFormIdentity",
  "dismissAcknowledged",
  "nativeFormCancelled",
  "questionRejectedIdentity",
  "freshBusyThenIdle",
  "historyToolError",
  "assistantErrorWithoutSuccessText",
  "dismissalOutcomeNotPublished",
  "stopOutcomeInterrupted",
  "noStaleSuccessOrModelContinuation",
  "lateQuestionReplyRejectedWithoutAPI",
  "requestBounds",
  "cleanupStrict",
  "eventOrderExact",
  "nativeHistoryReadyAfterTerminal",
  "exactPermissionQuestionCounts",
  "sessionLocationBinding",
  "nativeConfigIsSafe",
];
const requiredCleanup = [
  "agentDisconnected",
  "processGroupReaped",
  "fixtureClosed",
  "isolationRemoved",
  "stateAbsent",
  "databaseAbsent",
  "environmentRestored",
  "fetchRestored",
];
const dismissScenarioChecks = requiredChecks.filter(
  (key) => key !== "cleanupStrict" && key !== "stopOutcomeInterrupted",
);
const stopScenarioChecks = [
  "questionOnlyAdvertised",
  "permissionAskIdentity",
  "permissionGetIdentity",
  "permissionGetSaveAbsent",
  "questionFormIdentity",
  "permissionReplyOnce",
  "distinctAskFormCallIDs",
  "formCancelled",
  "questionRejectedIdentity",
  "freshBusyThenIdle",
  "stopAcknowledged",
  "noFormMutation",
  "historyErrorAndNoText",
  "nativeHistoryReadyAfterTerminal",
  "firstHistoryUnchanged",
  "stopOutcomeInterrupted",
  "sessionLocationBinding",
  "eventOrderExact",
  "lateReplyRejectedWithoutAPI",
  "noModelContinuation",
  "exactEventCounts",
];

type Status = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
type StopEventMarker = {
  type:
    | "question.asked"
    | "dismiss.requested"
    | "dismiss.acknowledged"
    | "stop.requested"
    | "stop.acknowledged"
    | "question.rejected"
    | "idle";
  sessionID: string;
  callID: string;
  formID: string;
};
type Manifest = {
  schemaVersion: 2;
  runId: string;
  scope: "SCENARIOS3_4_NO_SAVE_DISMISS_AND_STOP";
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
  bounds: typeof bounds;
  counts: {
    apiRequests: number;
    modelRequests: number;
    sessions: number;
    children: number;
    questionCalls: number;
    promptAttempts: number;
  };
  checks: Record<string, boolean>;
  formState: "cancelled" | "pending" | "unknown";
  scenarios: Record<
    "dismiss" | "stop",
    {
      status: "PASS" | "FAIL" | "NOT_RUN";
      checks: Record<string, boolean>;
      formState: "cancelled" | "pending" | "unknown";
      terminalObservations: Manifest["terminalObservations"];
      counts: Manifest["counts"];
    }
  >;
  terminalObservations: Array<{
    ownedIDMatched: boolean;
    locationMatched: boolean;
    outcomePresent: boolean;
    outcome: "interrupted" | "succeeded" | "failed" | "unknown";
  }>;
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
  preTeardown?: { status: Status; checks: Record<string, boolean>; counts: Manifest["counts"]; failureCode?: string };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFormState(value: unknown, sessionID: string, formID: string): "cancelled" | "pending" | "unknown" {
  if (!record(value) || !record(value.state)) return "unknown";
  if (value.id !== formID || value.sessionID !== sessionID) return "unknown";
  const state = value.state.status;
  return state === "cancelled" || state === "pending" ? state : "unknown";
}

function classifyObservedFormRequest(
  method: string,
  pathname: string,
  search: string,
  sessionID: string,
  formID: string,
  phase: string,
  deleteCount: number,
): "read" | "dismiss" | "reject" {
  const ownedSessionPrefix = `/api/session/${encodeURIComponent(sessionID)}/form`;
  if (
    method === "GET" &&
    search === "" &&
    (pathname === ownedSessionPrefix || pathname === `${ownedSessionPrefix}/${encodeURIComponent(formID)}`)
  )
    return "read";
  if (
    method === "DELETE" &&
    pathname === `${ownedSessionPrefix}/${encodeURIComponent(formID)}` &&
    search === "" &&
    phase === "dismiss-requested" &&
    deleteCount === 0
  )
    return "dismiss";
  return "reject";
}

function parsePermissionRequest(
  value: unknown,
  sessionID: string,
  requestID: string,
  callID: string,
  messageID: string,
) {
  if (!record(value)) return { identity: false, saveAbsent: false };
  const source = record(value.source) ? value.source : undefined;
  const saveAbsent = value.save === undefined || (Array.isArray(value.save) && value.save.length === 0);
  return {
    identity:
      value.id === requestID &&
      value.sessionID === sessionID &&
      value.action === "question" &&
      source?.type === "tool" &&
      source.id === callID &&
      source.messageID === messageID,
    saveAbsent,
  };
}

function parseSessionOutcome(
  value: unknown,
  sessionID: string,
  directory: string,
): Manifest["terminalObservations"][number] {
  const data = record(value) && record(value.data) ? value.data : undefined;
  const ownedIDMatched = data?.id === sessionID;
  const locationMatched = record(data?.location) && data.location.directory === directory;
  const raw = data?.outcome;
  return {
    ownedIDMatched,
    locationMatched,
    outcomePresent: data !== undefined && Object.hasOwn(data, "outcome"),
    outcome:
      ownedIDMatched && locationMatched && (raw === "interrupted" || raw === "succeeded" || raw === "failed")
        ? raw
        : "unknown",
  };
}

function dismissalOutcomeWasNotPublished(observations: unknown): boolean {
  return (
    Array.isArray(observations) &&
    observations.length > 0 &&
    observations.every(
      (observation) =>
        record(observation) &&
        observation.ownedIDMatched === true &&
        observation.locationMatched === true &&
        observation.outcomePresent === false &&
        observation.outcome === "unknown",
    )
  );
}

function hasOwnedSessionOutcome(observations: unknown, expectedOutcome: "interrupted" | "succeeded"): boolean {
  if (!Array.isArray(observations)) return false;
  const latest = observations.at(-1);
  return Boolean(
    record(latest) &&
      latest.ownedIDMatched === true &&
      latest.locationMatched === true &&
      latest.outcomePresent === true &&
      latest.outcome === expectedOutcome,
  );
}

function isStrictPass(value: unknown): boolean {
  if (!record(value) || !record(value.checks) || !record(value.cleanup) || !record(value.counts)) return false;
  const checks = value.checks;
  const cleanup = value.cleanup;
  const counts = value.counts;
  const boundsValue = value.bounds;
  const scenarios = record(value.scenarios) ? value.scenarios : undefined;
  const first = scenarios && record(scenarios.dismiss) ? scenarios.dismiss : undefined;
  const second = scenarios && record(scenarios.stop) ? scenarios.stop : undefined;
  const firstChecks = first && record(first.checks) ? first.checks : undefined;
  const secondChecks = second && record(second.checks) ? second.checks : undefined;
  const firstCounts = first && record(first.counts) ? first.counts : undefined;
  const secondCounts = second && record(second.counts) ? second.counts : undefined;
  const statePaths = [value.fixtureRoot, value.statePath, value.databasePath];
  const preTeardown = record(value.preTeardown) ? value.preTeardown : undefined;
  const preTeardownChecks = preTeardown && record(preTeardown.checks) ? preTeardown.checks : undefined;
  const preTeardownCounts = preTeardown && record(preTeardown.counts) ? preTeardown.counts : undefined;
  return (
    value.schemaVersion === 2 &&
    value.scope === "SCENARIOS3_4_NO_SAVE_DISMISS_AND_STOP" &&
    value.status === "PASS" &&
    value.failureCode === undefined &&
    value.sourceCommit === sourceCommit &&
    value.sourceCommitMeaning === "inspected-release-tag" &&
    value.expectedVersion === version &&
    value.observedVersion === version &&
    value.clientPackage === "@opencode/client@2.1.0" &&
    typeof value.executablePath === "string" &&
    value.executablePath.length > 0 &&
    value.executableSha256 === executableHash &&
    typeof value.ownedPID === "number" &&
    value.ownedPID > 0 &&
    record(boundsValue) &&
    boundsValue.overallMs === bounds.overallMs &&
    boundsValue.apiRequests === bounds.apiRequests &&
    boundsValue.modelRequests === bounds.modelRequests &&
    boundsValue.sessions === bounds.sessions &&
    boundsValue.children === bounds.children &&
    boundsValue.questionCalls === bounds.questionCalls &&
    boundsValue.prompts === bounds.prompts &&
    boundsValue.modelBodyBytes === bounds.modelBodyBytes &&
    statePaths.every((path) => typeof path === "string" && path.startsWith("tmp/scribe-v2-migration/")) &&
    typeof value.evidencePath === "string" &&
    value.evidencePath.startsWith("tmp/scribe-v2-migration/question-dismiss/") &&
    requiredChecks.every((key) => checks[key] === true) &&
    first !== undefined &&
    second !== undefined &&
    first.status === "PASS" &&
    second.status === "PASS" &&
    firstChecks !== undefined &&
    dismissScenarioChecks.every((key) => firstChecks[key] === true) &&
    Object.values(firstChecks).every((item) => item === true) &&
    secondChecks !== undefined &&
    stopScenarioChecks.every((key) => secondChecks[key] === true) &&
    Object.values(secondChecks).every((item) => item === true) &&
    first.formState === "cancelled" &&
    second.formState === "cancelled" &&
    Array.isArray(first.terminalObservations) &&
    first.terminalObservations.length > 0 &&
    first.terminalObservations.length <= 10 &&
    // The pinned native source skips the idle outcome write for this dismissal's shutdown
    // interruption; the owned observations must therefore show absence, not claim interruption.
    dismissalOutcomeWasNotPublished(first.terminalObservations) &&
    Array.isArray(second.terminalObservations) &&
    second.terminalObservations.length > 0 &&
    second.terminalObservations.length <= 10 &&
    second.terminalObservations.every(
      (item) =>
        item.ownedIDMatched === true &&
        item.locationMatched === true &&
        item.outcomePresent === true &&
        item.outcome !== "succeeded",
    ) &&
    hasOwnedSessionOutcome(second.terminalObservations, "interrupted") &&
    preTeardown?.status === "RUNNING" &&
    preTeardownChecks !== undefined &&
    requiredChecks.every((key) =>
      key === "cleanupStrict" ? preTeardownChecks[key] === false : preTeardownChecks[key] === true,
    ) &&
    preTeardownChecks.cleanupStrict === false &&
    preTeardownCounts !== undefined &&
    preTeardownCounts.apiRequests === counts.apiRequests &&
    preTeardownCounts.modelRequests === counts.modelRequests &&
    preTeardownCounts.sessions === counts.sessions &&
    preTeardownCounts.children === counts.children &&
    preTeardownCounts.questionCalls === counts.questionCalls &&
    preTeardownCounts.promptAttempts === counts.promptAttempts &&
    requiredCleanup.every((key) => cleanup[key] === true) &&
    Object.values(cleanup).every((item) => item === true) &&
    typeof counts.apiRequests === "number" &&
    Number.isInteger(counts.apiRequests) &&
    counts.apiRequests >= 0 &&
    counts.apiRequests <= bounds.apiRequests &&
    counts.modelRequests === 2 &&
    counts.sessions === 1 &&
    counts.children === 1 &&
    counts.questionCalls === 2 &&
    counts.promptAttempts === 2 &&
    firstCounts !== undefined &&
    typeof firstCounts.apiRequests === "number" &&
    firstCounts.apiRequests > 0 &&
    firstCounts.apiRequests <= bounds.apiRequests &&
    firstCounts.modelRequests === 1 &&
    firstCounts.sessions === 1 &&
    firstCounts.children === 1 &&
    firstCounts.questionCalls === 1 &&
    firstCounts.promptAttempts === 1 &&
    secondCounts !== undefined &&
    typeof secondCounts.apiRequests === "number" &&
    secondCounts.apiRequests > 0 &&
    secondCounts.apiRequests <= bounds.apiRequests &&
    secondCounts.modelRequests === 1 &&
    secondCounts.sessions === 1 &&
    secondCounts.children === 1 &&
    secondCounts.questionCalls === 1 &&
    secondCounts.promptAttempts === 1 &&
    firstCounts.apiRequests + secondCounts.apiRequests === counts.apiRequests
  );
}

function aggregateScenarioStatus(cancelStatus: string, stopStatus: string): "PASS" | "FAIL" {
  return cancelStatus === "PASS" && stopStatus === "PASS" ? "PASS" : "FAIL";
}

function areDistinctIDs(first: string, second: string): boolean {
  return first.length > 0 && second.length > 0 && first !== second;
}

function modelResponseAllowed(modelRequests: number, scenarioIndex: number, promptAttempts: number): boolean {
  return modelRequests === scenarioIndex && promptAttempts === modelRequests;
}

function lateReplyWasLocalRejection(rejected: boolean, apiBefore: number, apiAfter: number): boolean {
  return rejected && apiBefore === apiAfter;
}

function toolCallSSE(callID: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant", tool_calls: [{ index: 0, id: callID, type: "function", function: { name: "question", arguments: JSON.stringify({ questions }) } }] })}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
}

function config(port: number) {
  return {
    model: "fixture-provider/fixture-model",
    enabledProviders: ["fixture-provider"],
    providers: {
      "fixture-provider": {
        name: "Local question cancellation fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { "fixture-model": { name: "Fixture model" } },
      },
    },
    plugins: [],
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

function nativeFixtureConfigIsSafe(value: unknown, port: number): boolean {
  if (!record(value) || !record(value.agents) || Object.hasOwn(value, "agent") || value.plugin !== undefined)
    return false;
  if (
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["agents", "enabledProviders", "mcp", "model", "plugins", "providers"].sort()) ||
    JSON.stringify(value.enabledProviders) !== JSON.stringify(["fixture-provider"]) ||
    JSON.stringify(value.plugins) !== "[]" ||
    JSON.stringify(value.mcp) !== "{}" ||
    !record(value.providers) ||
    Object.keys(value.providers).length !== 1 ||
    Object.keys(value.agents).length !== 1 ||
    value.model !== "fixture-provider/fixture-model"
  )
    return false;
  const provider = value.providers["fixture-provider"];
  const agent = value.agents["fixture-question"];
  if (
    !record(provider) ||
    !record(provider.settings) ||
    provider.package !== "@opencode/ai/providers/openai-compatible" ||
    provider.settings.baseURL !== `http://127.0.0.1:${port}/v1` ||
    !record(provider.models) ||
    Object.keys(provider.models).length !== 1 ||
    !record(provider.models["fixture-model"])
  )
    return false;
  if (!record(agent) || agent.mode !== "primary" || agent.hidden !== true || !Array.isArray(agent.permissions))
    return false;
  return (
    JSON.stringify(agent.permissions) ===
    JSON.stringify([
      { action: "*", resource: "*", effect: "deny" },
      { action: "question", resource: "*", effect: "ask" },
    ])
  );
}

function dismissEventOrderIsValid(
  markers: StopEventMarker[],
  sessionID: string,
  callID: string,
  formID: string,
): boolean {
  if (
    markers.length !== 5 ||
    markers.some((marker) => marker.sessionID !== sessionID || marker.callID !== callID || marker.formID !== formID)
  )
    return false;
  const types = markers.map((marker) => marker.type);
  const once = (type: StopEventMarker["type"]) => types.filter((item) => item === type).length === 1;
  const question = types.indexOf("question.asked");
  const requested = types.indexOf("dismiss.requested");
  const ack = types.indexOf("dismiss.acknowledged");
  const rejected = types.indexOf("question.rejected");
  const idle = types.indexOf("idle");
  return (
    once("question.asked") &&
    once("dismiss.requested") &&
    once("question.rejected") &&
    once("idle") &&
    question < requested &&
    requested < rejected &&
    ack > requested &&
    rejected < idle
  );
}

function stopEventOrderIsValid(markers: StopEventMarker[], sessionID: string, callID: string, formID: string): boolean {
  if (
    markers.length !== 5 ||
    markers.some((m) => m.sessionID !== sessionID || m.callID !== callID || m.formID !== formID)
  )
    return false;
  const types = markers.map((m) => m.type);
  const at = (type: StopEventMarker["type"]) => types.indexOf(type);
  return (
    types.filter((t) => t === "question.asked").length === 1 &&
    types.filter((t) => t === "stop.requested").length === 1 &&
    types.filter((t) => t === "stop.acknowledged").length === 1 &&
    types.filter((t) => t === "question.rejected").length === 1 &&
    types.filter((t) => t === "idle").length === 1 &&
    at("question.asked") < at("stop.requested") &&
    at("stop.requested") < at("question.rejected") &&
    at("question.rejected") < at("idle") &&
    at("stop.requested") < at("idle") &&
    at("stop.acknowledged") > at("stop.requested")
  );
}

function assistantStopHistoryIsValid(
  before: ChatMessageWithParts[],
  after: ChatMessageWithParts[],
  sessionID: string,
  callID: string,
): boolean {
  const beforeIDs = new Set(
    before.filter((message) => message.info.role === "assistant").map((message) => message.info.id),
  );
  const relatedToolParts = after.flatMap((message) =>
    message.parts.filter((part) => part.type === "tool" && part.callID === callID),
  );
  const relatedTool =
    relatedToolParts.length === 1 &&
    relatedToolParts[0]?.type === "tool" &&
    relatedToolParts[0].state.status === "error";
  const assistant = after.filter((message) => message.info.role === "assistant" && !beforeIDs.has(message.info.id));
  return (
    relatedTool &&
    assistant.length > 0 &&
    assistant.every(
      (message) =>
        message.info.sessionID === sessionID &&
        message.info.error !== undefined &&
        !message.parts.some((part) => part.type === "text" && part.text.trim().length > 0) &&
        !message.parts.some((part) => part.type === "tool" && part.callID === callID && part.state.status !== "error"),
    )
  );
}

function historySnapshotMatches(left: ChatMessageWithParts[], right: ChatMessageWithParts[]): boolean {
  const signature = (messages: ChatMessageWithParts[]) =>
    messages.map((message) => ({
      id: message.info.id,
      sessionID: message.info.sessionID,
      role: message.info.role,
      error: message.info.error,
      parts: message.parts.map((part) =>
        part.type === "tool"
          ? { type: part.type, callID: part.callID, status: part.state.status }
          : part.type === "text"
            ? { type: part.type, text: part.text }
            : { type: part.type },
      ),
    }));
  return JSON.stringify(signature(left)) === JSON.stringify(signature(right));
}

function historyProjectionIsStable(before: ChatMessageWithParts[], after: ChatMessageWithParts[]): boolean {
  return before.every((message) => {
    const current = after.find((candidate) => candidate.info.id === message.info.id);
    return current !== undefined && historySnapshotMatches([message], [current]);
  });
}

function waitFor(predicate: () => boolean, deadline: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolveWait) => {
    const poll = () => {
      if (signal.aborted) return resolveWait(false);
      if (predicate()) return resolveWait(true);
      if (Date.now() >= deadline) return resolveWait(false);
      setTimeout(poll, Math.min(25, Math.max(1, deadline - Date.now())));
    };
    poll();
  });
}

async function absent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded_cleanup_timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForProcessGroupExit(pid: number, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
  }
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
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

describe("v2 question dismissal fixture contract", () => {
  it("parses the generated form result and rejects wrong identities and incomplete manifests", () => {
    expect(parseFormState({ id: "f1", sessionID: "s1", state: { status: "cancelled" } }, "s1", "f1")).toBe("cancelled");
    expect(parseFormState({ id: "f1", sessionID: "s1", state: { status: "pending" } }, "s1", "f1")).toBe("pending");
    expect(parseFormState({ id: "f2", sessionID: "s1", state: { status: "cancelled" } }, "s1", "f1")).toBe("unknown");
    expect(parseFormState({ id: "f1", sessionID: "foreign", state: { status: "cancelled" } }, "s1", "f1")).toBe(
      "unknown",
    );
    expect(parseFormState({ data: { id: "f1", sessionID: "s1", state: { status: "cancelled" } } }, "s1", "f1")).toBe(
      "unknown",
    );
    expect(
      parseSessionOutcome(
        { data: { id: "s1", location: { directory: "owned" }, outcome: "interrupted" } },
        "s1",
        "owned",
      ),
    ).toMatchObject({ ownedIDMatched: true, locationMatched: true, outcome: "interrupted" });
    const interruptedObservation = parseSessionOutcome(
      { data: { id: "s1", location: { directory: "owned" }, outcome: "interrupted" } },
      "s1",
      "owned",
    );
    expect(hasOwnedSessionOutcome([interruptedObservation], "interrupted")).toBe(true);
    expect(hasOwnedSessionOutcome([interruptedObservation], "succeeded")).toBe(false);
    const absentDismissalOutcome = parseSessionOutcome(
      { data: { id: "s1", location: { directory: "owned" } } },
      "s1",
      "owned",
    );
    expect(dismissalOutcomeWasNotPublished([absentDismissalOutcome])).toBe(true);
    expect(dismissalOutcomeWasNotPublished([])).toBe(false);
    expect(dismissalOutcomeWasNotPublished([{ ...absentDismissalOutcome, ownedIDMatched: false }])).toBe(false);
    expect(hasOwnedSessionOutcome([absentDismissalOutcome], "interrupted")).toBe(false);
    expect(
      parseSessionOutcome(
        { data: { id: "foreign", location: { directory: "owned" }, outcome: "interrupted" } },
        "s1",
        "owned",
      ).outcome,
    ).toBe("unknown");
    expect(
      parseSessionOutcome(
        { data: { id: "s1", location: { directory: "foreign" }, outcome: "interrupted" } },
        "s1",
        "owned",
      ).outcome,
    ).toBe("unknown");
    expect(
      parseSessionOutcome({ id: "s1", location: { directory: "owned" }, outcome: "interrupted" }, "s1", "owned")
        .outcome,
    ).toBe("unknown");
    expect(nativeFixtureConfigIsSafe(config(1234), 1234)).toBe(true);
    expect(nativeFixtureConfigIsSafe({ ...config(1234), enabledProviders: ["other-provider"] }, 1234)).toBe(false);
    expect(nativeFixtureConfigIsSafe({ ...config(1234), plugin: [] }, 1234)).toBe(false);
    expect(
      nativeFixtureConfigIsSafe(
        {
          ...config(1234),
          agents: {
            "fixture-question": { mode: "primary", permissions: config(1234).agents["fixture-question"].permissions },
          },
        },
        1234,
      ),
    ).toBe(false);
    const dismissMarkers = (types: StopEventMarker["type"][], callID = "call-1") =>
      types.map((type) => ({ type, sessionID: "s1", callID, formID: "f1" }));
    expect(
      dismissEventOrderIsValid(
        dismissMarkers(["question.asked", "dismiss.requested", "question.rejected", "idle", "dismiss.acknowledged"]),
        "s1",
        "call-1",
        "f1",
      ),
    ).toBe(true);
    expect(
      dismissEventOrderIsValid(
        dismissMarkers(["question.asked", "dismiss.requested", "dismiss.acknowledged", "question.rejected", "idle"]),
        "s1",
        "call-1",
        "f1",
      ),
    ).toBe(true);
    expect(
      dismissEventOrderIsValid(
        dismissMarkers(["question.asked", "dismiss.requested", "question.rejected", "dismiss.acknowledged", "idle"]),
        "s1",
        "call-1",
        "f1",
      ),
    ).toBe(true);
    expect(
      dismissEventOrderIsValid(
        dismissMarkers(["question.asked", "question.rejected", "dismiss.requested", "dismiss.acknowledged", "idle"]),
        "s1",
        "call-1",
        "f1",
      ),
    ).toBe(false);
    expect(
      dismissEventOrderIsValid(
        dismissMarkers(
          ["question.asked", "dismiss.requested", "dismiss.acknowledged", "question.rejected", "idle"],
          "foreign-call",
        ),
        "s1",
        "call-1",
        "f1",
      ),
    ).toBe(false);
    expect(
      dismissEventOrderIsValid(
        dismissMarkers([
          "question.asked",
          "dismiss.requested",
          "dismiss.acknowledged",
          "question.rejected",
          "idle",
          "idle",
        ]),
        "s1",
        "call-1",
        "f1",
      ),
    ).toBe(false);
    expect(
      parsePermissionRequest(
        {
          id: "p1",
          sessionID: "s1",
          action: "question",
          source: { type: "tool", id: "call-1", messageID: "m1" },
        },
        "s1",
        "p1",
        "call-1",
        "m1",
      ).saveAbsent,
    ).toBe(true);
    expect(
      parsePermissionRequest(
        {
          id: "p1",
          sessionID: "s1",
          action: "question",
          save: [],
          source: { type: "tool", id: "call-1", messageID: "m1" },
        },
        "s1",
        "p1",
        "call-1",
        "m1",
      ).saveAbsent,
    ).toBe(true);
    expect(
      parsePermissionRequest(
        {
          id: "p1",
          sessionID: "s1",
          action: "question",
          save: "",
          source: { type: "tool", id: "call-1", messageID: "m1" },
        },
        "s1",
        "p1",
        "call-1",
        "m1",
      ).saveAbsent,
    ).toBe(false);
    expect(
      parsePermissionRequest(
        {
          id: "p1",
          sessionID: "s1",
          action: "question",
          source: { type: "tool", id: "other-call", messageID: "m1" },
        },
        "s1",
        "p1",
        "call-1",
        "m1",
      ).identity,
    ).toBe(false);
    expect(
      parsePermissionRequest(
        {
          id: "p1",
          sessionID: "s1",
          action: "question",
          save: ["*"],
          source: { type: "tool", id: "call-1", messageID: "m1" },
        },
        "s1",
        "p1",
        "call-1",
        "m1",
      ).saveAbsent,
    ).toBe(false);
    expect(
      parsePermissionRequest(
        { id: "p2", sessionID: "s1", action: "question", source: { type: "tool", id: "call-1", messageID: "m1" } },
        "s1",
        "p1",
        "call-1",
        "m1",
      ).identity,
    ).toBe(false);
    const completeChecks = Object.fromEntries(requiredChecks.map((key) => [key, true]));
    const preTeardownChecks = { ...completeChecks, cleanupStrict: false };
    const completeCleanup = Object.fromEntries(requiredCleanup.map((key) => [key, true]));
    const passingFixture = {
      schemaVersion: 2,
      scope: "SCENARIOS3_4_NO_SAVE_DISMISS_AND_STOP",
      status: "PASS",
      sourceCommit,
      sourceCommitMeaning: "inspected-release-tag",
      expectedVersion: version,
      observedVersion: version,
      clientPackage: "@opencode/client@2.1.0",
      executablePath: "/fixture/opencode",
      executableSha256: executableHash,
      ownedPID: 42,
      evidencePath: "tmp/scribe-v2-migration/question-dismiss/id/result.json",
      fixtureRoot: "tmp/scribe-v2-migration/question-dismiss/id",
      statePath: "tmp/scribe-v2-migration/question-dismiss/id/state",
      databasePath: "tmp/scribe-v2-migration/question-dismiss/id/db",
      bounds,
      counts: { apiRequests: 10, modelRequests: 2, sessions: 1, children: 1, questionCalls: 2, promptAttempts: 2 },
      checks: completeChecks,
      cleanup: completeCleanup,
      formState: "cancelled",
      terminalObservations: [],
      scenarios: {
        dismiss: {
          status: "PASS",
          checks: Object.fromEntries(dismissScenarioChecks.map((key) => [key, true])),
          formState: "cancelled",
          terminalObservations: [
            { ownedIDMatched: true, locationMatched: true, outcomePresent: false, outcome: "unknown" },
          ],
          counts: { apiRequests: 5, modelRequests: 1, sessions: 1, children: 1, questionCalls: 1, promptAttempts: 1 },
        },
        stop: {
          status: "PASS",
          checks: Object.fromEntries(stopScenarioChecks.map((key) => [key, true])),
          formState: "cancelled",
          terminalObservations: [
            { ownedIDMatched: true, locationMatched: true, outcomePresent: true, outcome: "interrupted" },
          ],
          counts: { apiRequests: 5, modelRequests: 1, sessions: 1, children: 1, questionCalls: 1, promptAttempts: 1 },
        },
      },
      preTeardown: {
        status: "RUNNING",
        checks: preTeardownChecks,
        counts: { apiRequests: 10, modelRequests: 2, sessions: 1, children: 1, questionCalls: 2, promptAttempts: 2 },
      },
    };
    expect(isStrictPass(passingFixture)).toBe(true);
    expect(isStrictPass({ ...passingFixture, cleanup: { ...completeCleanup, fetchRestored: undefined } })).toBe(false);
    expect(isStrictPass({ ...passingFixture, counts: { ...passingFixture.counts, apiRequests: 61 } })).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        preTeardown: { ...passingFixture.preTeardown, checks: { ...preTeardownChecks, nativeFormCancelled: false } },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: {
          ...passingFixture.scenarios,
          dismiss: {
            ...passingFixture.scenarios.dismiss,
            terminalObservations: [
              { ownedIDMatched: true, locationMatched: true, outcomePresent: true, outcome: "succeeded" },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        checks: { ...completeChecks, stopOutcomeInterrupted: false },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: {
          ...passingFixture.scenarios,
          dismiss: { ...passingFixture.scenarios.dismiss, terminalObservations: [] },
        },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: {
          ...passingFixture.scenarios,
          dismiss: {
            ...passingFixture.scenarios.dismiss,
            terminalObservations: [
              { ownedIDMatched: false, locationMatched: true, outcomePresent: false, outcome: "unknown" },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: {
          ...passingFixture.scenarios,
          stop: {
            ...passingFixture.scenarios.stop,
            terminalObservations: [
              { ownedIDMatched: true, locationMatched: true, outcomePresent: false, outcome: "unknown" },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: {
          ...passingFixture.scenarios,
          stop: {
            ...passingFixture.scenarios.stop,
            terminalObservations: [
              { ownedIDMatched: true, locationMatched: true, outcomePresent: true, outcome: "succeeded" },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        checks: { ...completeChecks, noStaleSuccessOrModelContinuation: false },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: {
          ...passingFixture.scenarios,
          stop: {
            ...passingFixture.scenarios.stop,
            checks: { ...passingFixture.scenarios.stop.checks, firstHistoryUnchanged: false },
          },
        },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: {
          ...passingFixture.scenarios,
          dismiss: {
            ...passingFixture.scenarios.dismiss,
            status: "FAIL",
            terminalObservations: [
              { ownedIDMatched: true, locationMatched: true, outcomePresent: true, outcome: "succeeded" },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        scenarios: { ...passingFixture.scenarios, dismiss: { ...passingFixture.scenarios.dismiss, status: "FAIL" } },
      }),
    ).toBe(false);
    expect(
      isStrictPass({
        scope: "SCENARIOS3_4_NO_SAVE_DISMISS_AND_STOP",
        status: "PASS",
        checks: completeChecks,
        cleanup: completeCleanup,
        counts: { modelRequests: 1, sessions: 1, children: 1, questionCalls: 1, promptAttempts: 1 },
      }),
    ).toBe(false);
    expect(aggregateScenarioStatus("FAIL", "PASS")).toBe("FAIL");
    expect(aggregateScenarioStatus("PASS", "NOT_RUN")).toBe("FAIL");
    expect(areDistinctIDs("permission-a", "permission-b")).toBe(true);
    expect(areDistinctIDs("form-a", "form-a")).toBe(false);
    expect(areDistinctIDs("", "form-b")).toBe(false);
    expect(areDistinctIDs("permission-a", "")).toBe(false);
    expect(modelResponseAllowed(1, 1, 1)).toBe(true);
    expect(modelResponseAllowed(2, 1, 1)).toBe(false);
    expect(modelResponseAllowed(2, 2, 1)).toBe(false);
    expect(modelResponseAllowed(2, 2, 2)).toBe(true);
    expect(lateReplyWasLocalRejection(true, 12, 12)).toBe(true);
    expect(lateReplyWasLocalRejection(true, 12, 13)).toBe(false);
    expect(lateReplyWasLocalRejection(false, 12, 12)).toBe(false);
    expect(
      isStrictPass({
        ...passingFixture,
        checks: Object.fromEntries(requiredChecks.slice(1).map((key) => [key, true])),
      }),
    ).toBe(false);
  });

  it("allows only owned form reads and one unmessaged DELETE after dismissal is requested", () => {
    const formPath = "/api/session/s1/form/f1";
    expect(classifyObservedFormRequest("GET", formPath, "", "s1", "f1", "form", 0)).toBe("read");
    expect(classifyObservedFormRequest("GET", "/api/session/s1/form", "", "s1", "f1", "form", 0)).toBe("read");
    expect(classifyObservedFormRequest("DELETE", formPath, "", "s1", "f1", "dismiss-requested", 0)).toBe("dismiss");
    expect(classifyObservedFormRequest("DELETE", formPath, "", "s1", "f1", "stop-requested", 1)).toBe("reject");
    expect(classifyObservedFormRequest("DELETE", formPath, "", "s1", "f1", "cancelled", 0)).toBe("reject");
    expect(classifyObservedFormRequest("DELETE", formPath, "", "s1", "f1", "dismiss-requested", 1)).toBe("reject");
    expect(
      classifyObservedFormRequest("DELETE", "/api/session/s1/form/foreign", "", "s1", "f1", "dismiss-requested", 0),
    ).toBe("reject");
    expect(classifyObservedFormRequest("POST", `${formPath}/reply`, "", "s1", "f1", "dismiss-requested", 0)).toBe(
      "reject",
    );
    expect(
      classifyObservedFormRequest("DELETE", formPath, "?message=cancelled", "s1", "f1", "dismiss-requested", 0),
    ).toBe("reject");
  });

  it("accepts Stop acknowledgement on either side of native cancellation and idle", () => {
    const markers = (types: StopEventMarker["type"][]) =>
      types.map((type) => ({ type, sessionID: "s1", callID: "call2", formID: "f2" }));
    expect(
      stopEventOrderIsValid(
        markers(["question.asked", "stop.requested", "stop.acknowledged", "question.rejected", "idle"]),
        "s1",
        "call2",
        "f2",
      ),
    ).toBe(true);
    expect(
      stopEventOrderIsValid(
        markers(["question.asked", "stop.requested", "question.rejected", "stop.acknowledged", "idle"]),
        "s1",
        "call2",
        "f2",
      ),
    ).toBe(true);
    expect(
      stopEventOrderIsValid(
        markers(["question.asked", "stop.requested", "question.rejected", "idle", "stop.acknowledged"]),
        "s1",
        "call2",
        "f2",
      ),
    ).toBe(true);
    expect(
      stopEventOrderIsValid(
        markers(["question.asked", "question.rejected", "stop.requested", "stop.acknowledged", "idle"]),
        "s1",
        "call2",
        "f2",
      ),
    ).toBe(false);
  });

  it("accepts only new assistant errors with no text and a stable post-terminal history", () => {
    const before = [] as ChatMessageWithParts[];
    const after = [
      {
        info: {
          id: "tool-msg",
          sessionID: "s1",
          role: "assistant",
          error: { type: "aborted", message: "Step interrupted" },
        },
        parts: [{ type: "tool", callID: "call-1", state: { status: "error" } }],
      },
    ] as unknown as ChatMessageWithParts[];
    expect(assistantStopHistoryIsValid(before, after, "s1", "call-1")).toBe(true);
    expect(assistantStopHistoryIsValid(before, after, "foreign", "call-1")).toBe(false);
    expect(
      assistantStopHistoryIsValid(
        before,
        [
          ...after,
          {
            ...after[0],
            info: { ...after[0].info, id: "assistant-text" },
            parts: [{ type: "text", text: "unexpected success" }],
          } as unknown as ChatMessageWithParts,
        ],
        "s1",
        "call-1",
      ),
    ).toBe(false);
    expect(
      assistantStopHistoryIsValid(
        before,
        [{ ...after[0], info: { ...after[0].info, error: undefined } }],
        "s1",
        "call-1",
      ),
    ).toBe(false);
    expect(
      assistantStopHistoryIsValid(
        before,
        [
          {
            ...after[0],
            parts: [{ type: "tool", callID: "other-call", state: { status: "error" } }],
          } as unknown as ChatMessageWithParts,
        ],
        "s1",
        "call-1",
      ),
    ).toBe(false);
    expect(historySnapshotMatches(after, structuredClone(after))).toBe(true);
    expect(historySnapshotMatches(after, [])).toBe(false);
  });

  it("dismisses a native no-save question through adapter rejectQuestion", {
    skip: !enabled,
    timeout: 95_000,
  }, async () => {
    const fork = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof fork.send === "function" && fork.connected === true;
    const root = await realpath(rootPath);
    const base = resolve(root, "tmp/scribe-v2-migration/question-dismiss");
    await mkdir(base, { recursive: true });
    await assertOwnedPath(root, base);
    const runId = randomUUID();
    const runRoot = join(base, runId);
    await mkdir(runRoot, { recursive: false });
    await assertOwnedPath(base, runRoot);
    const evidencePath = join(runRoot, "result.json");
    const originalFetch = globalThis.fetch;
    const originalEnvironment = { ...process.env };
    let environmentReplaced = false;
    let isolation: V2TestIsolation | undefined;
    let agent: OpenCodeAgent | undefined;
    let fixture: Server | undefined;
    let fixtureClosed = false;
    let ownedPID: number | undefined;
    let sessionID: string | undefined;
    let formID: string | undefined;
    let secondFormID: string | undefined;
    let permissionID: string | undefined;
    let secondPermissionID: string | undefined;
    let permissionReplyID: string | undefined;
    let secondPermissionReplyID: string | undefined;
    let questionRejectedID: string | undefined;
    let modelRequests = 0;
    let apiRequests = 0;
    let promptAttempts = 0;
    let toolCalls = 0;
    let runtimeFailureCode: string | undefined;
    let ownedOrigin: string | undefined;
    let fixtureOrigin: string | undefined;
    let firstApiSeen = false;
    let terminalPollingEnabled = false;
    let busy = false;
    let idleAfterBusy = false;
    let idleCount = 0;
    let dismissAcknowledged = false;
    let phase:
      | "permission"
      | "permission-replied"
      | "form"
      | "dismiss-requested"
      | "dismiss-ack"
      | "cancelled"
      | "stop-requested" = "permission";
    let messageID: string | undefined;
    let secondMessageID: string | undefined;
    let scenarioIndex = 1;
    let permissionAskCount = 0;
    let permissionReplyCount = 0;
    let questionAskCount = 0;
    let questionRejectCount = 0;
    let formCancelApiCount = 0;
    let formReplyApiCount = 0;
    let formOtherMutationApiCount = 0;
    let dismissPromise: Promise<void> | undefined;
    let stopPromise: Promise<void> | undefined;
    let permissionPromise: Promise<void> | undefined;
    let lateReplyRejected = false;
    let apiCountBeforeLateReply = 0;
    const formState: { value: Manifest["formState"] } = { value: "unknown" };
    const eventOrder: StopEventMarker[] = [];
    const stopEventOrder: StopEventMarker[] = [];
    const checks = Object.fromEntries(requiredChecks.map((key) => [key, false])) as Record<string, boolean>;
    const observations: Manifest["terminalObservations"] = [];
    const scenarioChecks: Record<"dismiss" | "stop", Record<string, boolean>> = {
      dismiss: Object.fromEntries(dismissScenarioChecks.map((key) => [key, false])),
      stop: Object.fromEntries(stopScenarioChecks.map((key) => [key, false])),
    };
    const scenarioObservations: Record<"dismiss" | "stop", Manifest["terminalObservations"]> = {
      dismiss: [],
      stop: [],
    };
    const operations: Record<string, number> = {};
    const manifest: Manifest = {
      schemaVersion: 2,
      runId,
      scope: "SCENARIOS3_4_NO_SAVE_DISMISS_AND_STOP",
      status: "RUNNING",
      stage: "preflight",
      expectedVersion: version,
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
      bounds,
      counts: { apiRequests: 0, modelRequests: 0, sessions: 0, children: 0, questionCalls: 0, promptAttempts: 0 },
      checks,
      formState: formState.value,
      terminalObservations: observations,
      scenarios: {
        dismiss: {
          status: "NOT_RUN",
          checks: { ...scenarioChecks.dismiss },
          formState: "unknown",
          terminalObservations: scenarioObservations.dismiss,
          counts: { apiRequests: 0, modelRequests: 0, sessions: 0, children: 0, questionCalls: 0, promptAttempts: 0 },
        },
        stop: {
          status: "NOT_RUN",
          checks: { ...scenarioChecks.stop },
          formState: "unknown",
          terminalObservations: scenarioObservations.stop,
          counts: { apiRequests: 0, modelRequests: 0, sessions: 0, children: 0, questionCalls: 0, promptAttempts: 0 },
        },
      },
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
    const started = Date.now();
    const deadline = started + bounds.overallMs;
    const overallAbort = new AbortController();
    const failRuntime = (code: string) => {
      runtimeFailureCode ??= code;
      overallAbort.abort(new Error(code));
    };
    const overallTimer = setTimeout(() => {
      failRuntime("overall_deadline");
    }, bounds.overallMs);
    let clientPackage: unknown;
    try {
      await persist();
      checks.dedicatedFork = dedicatedFork;
      if (!dedicatedFork) throw Object.assign(new Error(), { code: "dedicated_fork_required" });
      if (!executable || !isAbsolute(executable)) throw Object.assign(new Error(), { code: "executable_required" });
      clientPackage = JSON.parse(
        await readFile(resolve(root, "packages/agents/opencode/node_modules/@opencode/client/package.json"), "utf8"),
      );
      checks.clientMetadataPinned =
        record(clientPackage) && clientPackage.name === "@opencode/client" && clientPackage.version === "2.1.0";
      if (record(clientPackage) && typeof clientPackage.name === "string" && typeof clientPackage.version === "string")
        manifest.clientPackage = `${clientPackage.name}@${clientPackage.version}`;
      if (!checks.clientMetadataPinned) throw Object.assign(new Error(), { code: "client_metadata_mismatch" });
      const executableBytes = await readFile(executable).catch(() => undefined);
      if (!executableBytes) throw Object.assign(new Error(), { code: "executable_unavailable" });
      manifest.executableSha256 = createHash("sha256").update(executableBytes).digest("hex");
      checks.executableHashPinned = manifest.executableSha256 === executableHash;
      if (!checks.executableHashPinned) throw Object.assign(new Error(), { code: "executable_hash_mismatch" });

      isolation = await createV2TestIsolation(runRoot);
      manifest.fixtureRoot = relative(root, isolation.root);
      manifest.statePath = relative(root, isolation.paths.state);
      manifest.databasePath = relative(root, isolation.paths.database);
      checks.projectLocalIsolation = true;
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      const preflight = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      checks.ambientGateClear = preflight.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.ambientGateClear) throw Object.assign(new Error(), { code: "ambient_gate_blocked" });

      fixture = createServer(async (request, response) => {
        try {
          if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
            runtimeFailureCode ??= "unexpected_mock_provider_route";
            overallAbort.abort(new Error("unexpected_mock_provider_route"));
            response.writeHead(404).end();
            return;
          }
          modelRequests += 1;
          if (modelRequests > bounds.modelRequests) {
            failRuntime("unexpected_model_continuation");
            response.writeHead(409).end();
            return;
          }
          if (!modelResponseAllowed(modelRequests, scenarioIndex, promptAttempts)) {
            failRuntime("model_request_outside_explicit_prompt_phase");
            response.writeHead(409).end();
            return;
          }
          let body = "";
          let bytes = 0;
          for await (const chunk of request) {
            bytes += Buffer.byteLength(chunk);
            if (bytes > bounds.modelBodyBytes) {
              failRuntime("model_body_limit");
              response.writeHead(413).end();
              return;
            }
            body += chunk;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            response.writeHead(400).end();
            return;
          }
          const names =
            record(parsed) && Array.isArray(parsed.tools)
              ? parsed.tools.flatMap((tool) =>
                  record(tool) && record(tool.function) && typeof tool.function.name === "string"
                    ? [tool.function.name]
                    : [],
                )
              : [];
          // Native 2.2.0 advertises `skill` because its built-in browser plugin appends a scoped
          // `skill:browser` deny after config; execution stays denied by the wildcard rule.
          // The question round-trip therefore requires `question` and allows only `skill` besides it.
          const questionOnly =
            names.includes("question") && names.every((name) => name === "question" || name === "skill");
          checks.questionOnlyAdvertised = checks.questionOnlyAdvertised || questionOnly;
          scenarioChecks[modelRequests === 1 ? "dismiss" : "stop"].questionOnlyAdvertised = questionOnly;
          if (!questionOnly) {
            failRuntime("question_tool_inventory_mismatch");
            response.writeHead(409).end();
            return;
          }
          toolCalls += 1;
          const callID = modelRequests === 1 ? questionCallID : stopCallID;
          response
            .writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
            .end(toolCallSSE(callID));
        } catch {
          runtimeFailureCode ??= "mock_provider_handler_failed";
          overallAbort.abort(new Error("mock_provider_handler_failed"));
          if (!response.headersSent) response.writeHead(500).end();
          else response.destroy();
        }
      });
      const port = await listen(fixture);
      fixtureOrigin = `http://127.0.0.1:${port}`;
      const fixtureConfig = config(port);
      checks.nativeConfigIsSafe = nativeFixtureConfigIsSafe(fixtureConfig, port);
      if (!checks.nativeConfigIsSafe) throw Object.assign(new Error(), { code: "fixture_config_invalid" });
      await writeFile(join(isolation.paths.config, "opencode", "opencode.json"), JSON.stringify(fixtureConfig), {
        mode: 0o600,
      });

      const nativeFetch = originalFetch.bind(globalThis);
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (url.pathname.startsWith("/api/")) {
          if (!firstApiSeen) {
            firstApiSeen = true;
            if (url.pathname !== "/api/info" || url.hostname !== "127.0.0.1") {
              runtimeFailureCode ??= "first_api_not_owned_loopback_info";
              overallAbort.abort(new Error("first_api_not_owned_loopback_info"));
              throw new Error("first_api_not_owned_loopback_info");
            }
            ownedOrigin = url.origin;
          }
          apiRequests += 1;
          const pieces = url.pathname.split("/").filter(Boolean);
          const operation = `${method} /api/${pieces[1] === "session" ? `session/:sessionID${pieces[3] ? `/${pieces[3]}` : ""}` : (pieces[1] ?? "other")}`;
          operations[operation] = (operations[operation] ?? 0) + 1;
          if (apiRequests > bounds.apiRequests) {
            failRuntime("api_request_limit");
            throw new Error("api_request_limit");
          }
          if (url.hostname !== "127.0.0.1" || url.origin !== ownedOrigin) {
            failRuntime("foreign_api_origin");
            throw new Error("foreign_api_origin");
          }
          if (/^\/api\/session\/[^/]+\/form(?:\/[^/]+(?:\/reply)?)?$/.test(url.pathname)) {
            const decision = classifyObservedFormRequest(
              method,
              url.pathname,
              url.search,
              sessionID ?? "",
              (scenarioIndex === 1 ? formID : secondFormID) ?? "",
              phase,
              formCancelApiCount,
            );
            if (method === "POST") formReplyApiCount += 1;
            if (decision === "dismiss") formCancelApiCount += 1;
            if (decision === "reject") {
              if (method !== "GET") formOtherMutationApiCount += 1;
              failRuntime("unexpected_native_form_mutation");
              throw new Error("unexpected_native_form_mutation");
            }
          }
        } else if (url.origin !== fixtureOrigin || url.pathname !== "/v1/chat/completions" || method !== "POST") {
          runtimeFailureCode ??= "unexpected_non_api_request";
          overallAbort.abort(new Error("unexpected_non_api_request"));
          throw new Error("unexpected_non_api_request");
        }
        if (method === "POST" && url.pathname === `/api/session/${encodeURIComponent(sessionID ?? "")}/prompt`)
          promptAttempts += 1;
        const requestSignal = input instanceof Request ? input.signal : undefined;
        const remaining = Math.max(1, deadline - Date.now());
        const signals = [overallAbort.signal, AbortSignal.timeout(remaining)];
        if (requestSignal) signals.push(requestSignal);
        if (init?.signal) signals.push(init.signal);
        const response = await nativeFetch(input, { ...init, signal: AbortSignal.any(signals) });
        if (url.pathname === "/api/info" && response.ok) {
          const info: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          if (record(info)) {
            manifest.observedVersion = typeof info.version === "string" ? info.version : null;
            ownedPID = typeof info.pid === "number" ? info.pid : undefined;
            manifest.ownedPID = ownedPID ?? null;
            manifest.counts.children = ownedPID === undefined ? 0 : 1;
            if (manifest.observedVersion !== version || !ownedPID || url.origin !== ownedOrigin) {
              runtimeFailureCode ??= "private_server_info_mismatch";
              overallAbort.abort(new Error("private_server_info_mismatch"));
            }
            checks.privateChildVersionAndPID = manifest.observedVersion === version && ownedPID !== undefined;
          }
        }
        if (
          sessionID &&
          terminalPollingEnabled &&
          url.pathname === `/api/session/${encodeURIComponent(sessionID)}` &&
          response.ok
        ) {
          const payload: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          const observation = parseSessionOutcome(payload, sessionID, isolation?.paths.cwd ?? "");
          observations.push(observation);
        }
        return response;
      }) as typeof fetch;
      environmentReplaced = true;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, isolation.environment);
      checks.spawnGateClear =
        evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, await inspectAmbientConfigSources())
          .status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.spawnGateClear) throw Object.assign(new Error(), { code: "spawn_gate_blocked" });

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
      const recordAsync = (promise: Promise<void>, code: string, success?: () => void) =>
        promise.then(success, () => failRuntime(code));
      agent.onEvent((event: AgentEvent) => {
        if (event.type === "permission.asked") {
          permissionAskCount += 1;
          const expectedCall = scenarioIndex === 1 ? questionCallID : stopCallID;
          const valid =
            permissionAskCount === scenarioIndex &&
            phase === "permission" &&
            event.properties.permission === "question" &&
            event.properties.sessionID === sessionID &&
            event.properties.tool?.callID === expectedCall &&
            typeof event.properties.tool?.messageID === "string";
          if (scenarioIndex === 1) checks.permissionAskIdentity = valid;
          scenarioChecks[scenarioIndex === 1 ? "dismiss" : "stop"].permissionAskIdentity = valid;
          if (!valid) {
            runtimeFailureCode ??= "permission_identity_or_phase_mismatch";
            overallAbort.abort(new Error("permission_identity_or_phase_mismatch"));
            return;
          }
          if (scenarioIndex === 1) {
            permissionID = event.properties.id;
            messageID = event.properties.tool?.messageID;
          } else {
            secondPermissionID = event.properties.id;
            secondMessageID = event.properties.tool?.messageID;
          }
          phase = "permission-replied";
          if (agent)
            permissionPromise = (async () => {
              const nativeClient = (agent as unknown as { v2Client?: OpenCodeClient }).v2Client;
              if (!nativeClient) throw new Error("owned_client_unavailable");
              const request = await nativeClient.permission.get({
                sessionID: event.properties.sessionID,
                requestID: event.properties.id,
              });
              const verified = parsePermissionRequest(
                request,
                event.properties.sessionID,
                event.properties.id,
                event.properties.tool?.callID ?? "",
                event.properties.tool?.messageID ?? "",
              );
              if (scenarioIndex === 1) {
                checks.permissionGetIdentity = verified.identity;
                checks.permissionGetSaveAbsent = verified.saveAbsent;
              }
              const scenarioKey = scenarioIndex === 1 ? "dismiss" : "stop";
              scenarioChecks[scenarioKey].permissionGetIdentity = verified.identity;
              scenarioChecks[scenarioKey].permissionGetSaveAbsent = verified.saveAbsent;
              if (!verified.identity || !verified.saveAbsent)
                throw new Error("native_permission_identity_or_save_mismatch");
              await agent.replyPermission(
                event.properties.sessionID,
                event.properties.id,
                scenarioIndex === 1 ? "always" : "once",
              );
            })().then(
              () => undefined,
              () => failRuntime("permission_get_or_reply_failed"),
            );
        }
        if (event.type === "permission.replied") {
          permissionReplyCount += 1;
          const expectedPermissionID = scenarioIndex === 1 ? permissionID : secondPermissionID;
          const expectedReply = scenarioIndex === 1 ? "always" : "once";
          if (
            permissionReplyCount !== scenarioIndex ||
            event.properties.requestID !== expectedPermissionID ||
            event.properties.reply !== expectedReply ||
            event.properties.sessionID !== sessionID
          ) {
            runtimeFailureCode ??= "permission_reply_event_mismatch";
            overallAbort.abort(new Error("permission_reply_event_mismatch"));
            return;
          }
          if (scenarioIndex === 1) permissionReplyID = event.properties.requestID;
          else secondPermissionReplyID = event.properties.requestID;
          phase = "form";
        }
        if (event.type === "question.asked") {
          questionAskCount += 1;
          const scenarioKey = scenarioIndex === 1 ? "dismiss" : "stop";
          const expectedCall = scenarioIndex === 1 ? questionCallID : stopCallID;
          const expectedPermission = scenarioIndex === 1 ? permissionID : secondPermissionID;
          const expectedMessage = scenarioIndex === 1 ? messageID : secondMessageID;
          const valid =
            questionAskCount === scenarioIndex &&
            phase === "form" &&
            event.properties.sessionID === sessionID &&
            event.properties.tool?.callID === expectedCall &&
            event.properties.tool?.messageID === expectedMessage &&
            (scenarioIndex === 1
              ? permissionReplyID === permissionID
              : secondPermissionReplyID === secondPermissionID) &&
            expectedPermission !== undefined;
          scenarioChecks[scenarioKey].questionFormIdentity = valid;
          if (scenarioIndex === 1) checks.questionFormIdentity = valid;
          if (!valid) {
            runtimeFailureCode ??= "question_form_identity_or_phase_mismatch";
            overallAbort.abort(new Error("question_form_identity_or_phase_mismatch"));
            return;
          }
          if (scenarioIndex === 1) formID = event.properties.id;
          else secondFormID = event.properties.id;
          const currentCallID = expectedCall;
          const currentFormID = event.properties.id;
          if (scenarioIndex === 1) phase = "dismiss-requested";
          else phase = "stop-requested";
          const markers = scenarioIndex === 1 ? eventOrder : stopEventOrder;
          markers.push({
            type: "question.asked",
            sessionID: event.properties.sessionID,
            callID: currentCallID,
            formID: currentFormID,
          });
          if (agent) {
            if (scenarioIndex === 1) {
              markers.push({
                type: "dismiss.requested",
                sessionID: event.properties.sessionID,
                callID: currentCallID,
                formID: currentFormID,
              });
              dismissPromise = recordAsync(
                agent.rejectQuestion(currentFormID).then(() => undefined),
                "question_dismiss_failed",
                () => {
                  dismissAcknowledged = true;
                  if (phase === "dismiss-requested") phase = "dismiss-ack";
                  markers.push({
                    type: "dismiss.acknowledged",
                    sessionID: event.properties.sessionID,
                    callID: currentCallID,
                    formID: currentFormID,
                  });
                },
              );
            } else {
              markers.push({
                type: "stop.requested",
                sessionID: event.properties.sessionID,
                callID: currentCallID,
                formID: currentFormID,
              });
              stopPromise = recordAsync(
                agent.abortSession(event.properties.sessionID).then(() => undefined),
                "session_stop_failed",
                () => {
                  markers.push({
                    type: "stop.acknowledged",
                    sessionID: event.properties.sessionID,
                    callID: currentCallID,
                    formID: currentFormID,
                  });
                },
              );
            }
          }
        }
        if (event.type === "question.rejected") {
          questionRejectCount += 1;
          const expectedForm = scenarioIndex === 1 ? formID : secondFormID;
          const expectedCall = scenarioIndex === 1 ? questionCallID : stopCallID;
          const validPhase =
            scenarioIndex === 1 ? phase === "dismiss-requested" || phase === "dismiss-ack" : phase === "stop-requested";
          if (
            questionRejectCount !== scenarioIndex ||
            !validPhase ||
            event.properties.requestID !== expectedForm ||
            event.properties.sessionID !== sessionID
          ) {
            runtimeFailureCode ??= "question_rejection_identity_or_phase_mismatch";
            overallAbort.abort(new Error("question_rejection_identity_or_phase_mismatch"));
            return;
          }
          questionRejectedID = event.properties.requestID;
          const markers = scenarioIndex === 1 ? eventOrder : stopEventOrder;
          markers.push({
            type: "question.rejected",
            sessionID: event.properties.sessionID,
            callID: expectedCall,
            formID: event.properties.requestID,
          });
        }
        if (
          event.type === "session.status" &&
          event.properties.sessionID === sessionID &&
          event.properties.status.type === "busy"
        ) {
          busy = true;
        }
        if (
          event.type === "session.status" &&
          event.properties.sessionID === sessionID &&
          event.properties.status.type === "idle" &&
          busy
        ) {
          idleCount += 1;
          if (!questionRejectedID || idleCount > 1) {
            failRuntime("idle_before_cancel_or_duplicate_idle");
            return;
          }
          idleAfterBusy = true;
          (scenarioIndex === 1 ? eventOrder : stopEventOrder).push({
            type: "idle",
            sessionID: event.properties.sessionID,
            callID: scenarioIndex === 1 ? questionCallID : stopCallID,
            formID: (scenarioIndex === 1 ? formID : secondFormID) ?? "",
          });
        }
      });
      await agent.connect();
      checks.privateChildVersionAndPID = manifest.observedVersion === version && ownedPID !== undefined;
      const session = await agent.createSession("disposable always/no-save question dismissal fixture");
      sessionID = session.id;
      manifest.counts.sessions = 1;
      checks.oneOwnedSession = session.id.length > 0 && session.directory === isolation.paths.cwd;
      const historyBefore = await agent.getMessages(session.id);
      await agent.sendMessage(session.id, "Ask the fixture question and wait.", { primaryAgent: "fixture-question" });
      const asked = await waitFor(
        () => formID !== undefined || runtimeFailureCode !== undefined,
        Math.min(deadline, Date.now() + 20_000),
        overallAbort.signal,
      );
      if (!asked || !formID) throw Object.assign(new Error(), { code: "question_form_missing" });
      await waitFor(
        () => questionRejectedID !== undefined || runtimeFailureCode !== undefined,
        Math.min(deadline, Date.now() + 20_000),
        overallAbort.signal,
      );
      await dismissPromise;
      await permissionPromise;
      const terminalBarrier = await waitFor(
        () => questionRejectedID !== undefined && idleAfterBusy && dismissAcknowledged,
        Math.min(deadline, Date.now() + 20_000),
        overallAbort.signal,
      );
      if (!terminalBarrier) runtimeFailureCode ??= "native_terminal_barrier_missing";
      if (agent) {
        const nativeClient = (agent as unknown as { v2Client?: OpenCodeClient }).v2Client;
        if (!nativeClient || !formID) throw new Error("first_form_or_client_missing");
        formState.value = parseFormState(
          await nativeClient.session.form.get({ sessionID: session.id, formID }),
          session.id,
          formID,
        );
        const pollOutcome = async () => {
          let reads = 0;
          let info: Awaited<ReturnType<OpenCodeAgent["getSession"]>> | undefined;
          const pollDeadline = Math.min(deadline, Date.now() + 3_000);
          terminalPollingEnabled = true;
          try {
            // Keep polling within the fixture's existing read/deadline bounds; absence never proves Stop.
            while (reads < 10 && Date.now() < pollDeadline) {
              info = await agent?.getSession(session.id);
              reads += 1;
              if (observations.at(-1)?.outcome === "interrupted") break;
              if (reads < 10) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
            }
          } finally {
            terminalPollingEnabled = false;
          }
          return info;
        };
        const firstHistory = await agent.getMessages(session.id);
        let sessionInfo = await pollOutcome();
        scenarioObservations.dismiss.push(...observations);
        checks.permissionAlwaysReplyIdentity = permissionReplyID === permissionID;
        checks.dismissAcknowledged = dismissPromise !== undefined && dismissAcknowledged;
        checks.nativeFormCancelled = formState.value === "cancelled";
        checks.questionRejectedIdentity = questionRejectedID === formID;
        checks.freshBusyThenIdle = busy && idleAfterBusy;
        checks.historyToolError = firstHistory.some((m) =>
          m.parts.some((p) => p.type === "tool" && p.callID === questionCallID && p.state.status === "error"),
        );
        checks.assistantErrorWithoutSuccessText = assistantStopHistoryIsValid(
          historyBefore,
          firstHistory,
          session.id,
          questionCallID,
        );
        // This explicit form dismissal is observed with no session outcome published. It is not
        // the separate user-Stop scenario, whose owned terminal outcome must be interrupted.
        checks.dismissalOutcomeNotPublished = dismissalOutcomeWasNotPublished(scenarioObservations.dismiss);
        checks.sessionLocationBinding =
          sessionInfo?.id === session.id &&
          sessionInfo.directory === isolation.paths.cwd &&
          observations.at(-1)?.ownedIDMatched === true &&
          observations.at(-1)?.locationMatched === true;
        const stableFirstHistory = await agent.getMessages(session.id);
        checks.nativeHistoryReadyAfterTerminal = historySnapshotMatches(firstHistory, stableFirstHistory);
        checks.noStaleSuccessOrModelContinuation =
          modelRequests === 1 &&
          assistantStopHistoryIsValid(historyBefore, stableFirstHistory, session.id, questionCallID) &&
          scenarioObservations.dismiss.every((o) => o.outcome !== "succeeded" || checks.historyToolError);
        checks.exactPermissionQuestionCounts =
          permissionAskCount === 1 &&
          permissionReplyCount === 1 &&
          questionAskCount === 1 &&
          questionRejectCount === 1 &&
          formCancelApiCount === 1 &&
          formReplyApiCount === 0 &&
          formOtherMutationApiCount === 0;
        checks.eventOrderExact = dismissEventOrderIsValid(eventOrder, session.id, questionCallID, formID);
        apiCountBeforeLateReply = apiRequests;
        try {
          await agent.replyQuestion(formID, [["yes"]]);
        } catch {
          lateReplyRejected = true;
        }
        checks.lateQuestionReplyRejectedWithoutAPI = lateReplyWasLocalRejection(
          lateReplyRejected,
          apiCountBeforeLateReply,
          apiRequests,
        );
        checks.requestBounds =
          apiRequests <= bounds.apiRequests &&
          modelRequests === 1 &&
          toolCalls === 1 &&
          promptAttempts === 1 &&
          Date.now() - started <= bounds.overallMs;
        scenarioChecks.dismiss = Object.fromEntries(dismissScenarioChecks.map((key) => [key, checks[key] ?? false]));
        const dismissalStructurePass =
          requiredChecks.every(
            (key) =>
              key === "dismissalOutcomeNotPublished" ||
              key === "stopOutcomeInterrupted" ||
              key === "cleanupStrict" ||
              checks[key],
          ) && !runtimeFailureCode;
        manifest.scenarios.dismiss = {
          status: checks.dismissalOutcomeNotPublished && dismissalStructurePass ? "PASS" : "FAIL",
          checks: { ...scenarioChecks.dismiss },
          formState: formState.value,
          terminalObservations: [...scenarioObservations.dismiss],
          counts: {
            apiRequests,
            modelRequests,
            sessions: sessionID ? 1 : 0,
            children: ownedPID ? 1 : 0,
            questionCalls: toolCalls,
            promptAttempts,
          },
        };
        if (dismissalStructurePass) {
          scenarioIndex = 2;
          manifest.scenarios.stop.status = "FAIL";
          phase = "permission";
          questionRejectedID = undefined;
          permissionPromise = undefined;
          stopPromise = undefined;
          busy = false;
          idleAfterBusy = false;
          idleCount = 0;
          await agent.sendMessage(session.id, "Ask the question again as a new explicit prompt.", {
            primaryAgent: "fixture-question",
          });
          const secondAsked = await waitFor(
            () => secondFormID !== undefined || runtimeFailureCode !== undefined,
            Math.min(deadline, Date.now() + 20_000),
            overallAbort.signal,
          );
          if (!secondAsked || !secondFormID) throw new Error("second_question_form_missing");
          await waitFor(
            () => questionRejectedID !== undefined || runtimeFailureCode !== undefined,
            Math.min(deadline, Date.now() + 20_000),
            overallAbort.signal,
          );
          await stopPromise;
          await permissionPromise;
          const secondBarrier = await waitFor(
            () =>
              questionRejectedID === secondFormID &&
              idleAfterBusy &&
              stopEventOrder.some((m) => m.type === "stop.acknowledged"),
            Math.min(deadline, Date.now() + 20_000),
            overallAbort.signal,
          );
          if (!secondBarrier) runtimeFailureCode ??= "second_terminal_barrier_missing";
          const secondFormState = parseFormState(
            await nativeClient.session.form.get({ sessionID: session.id, formID: secondFormID }),
            session.id,
            secondFormID,
          );
          const secondHistory = await agent.getMessages(session.id);
          const secondObsStart = observations.length;
          sessionInfo = await pollOutcome();
          scenarioObservations.stop.push(...observations.slice(secondObsStart));
          const afterTerminal = await agent.getMessages(session.id);
          const firstProjectionStable = historyProjectionIsStable(stableFirstHistory, afterTerminal);
          const stopChecks = scenarioChecks.stop;
          stopChecks.permissionReplyOnce = secondPermissionReplyID === secondPermissionID && permissionReplyCount === 2;
          stopChecks.distinctAskFormCallIDs =
            areDistinctIDs(permissionID ?? "", secondPermissionID ?? "") &&
            areDistinctIDs(formID, secondFormID) &&
            areDistinctIDs(questionCallID, stopCallID);
          stopChecks.formCancelled = secondFormState === "cancelled";
          stopChecks.questionRejectedIdentity = questionRejectedID === secondFormID;
          stopChecks.freshBusyThenIdle = busy && idleAfterBusy;
          stopChecks.stopAcknowledged =
            stopPromise !== undefined && stopEventOrder.some((m) => m.type === "stop.acknowledged");
          stopChecks.noFormMutation =
            formCancelApiCount === 1 && formReplyApiCount === 0 && formOtherMutationApiCount === 0;
          stopChecks.historyErrorAndNoText = assistantStopHistoryIsValid(
            stableFirstHistory,
            afterTerminal,
            session.id,
            stopCallID,
          );
          stopChecks.nativeHistoryReadyAfterTerminal = historySnapshotMatches(secondHistory, afterTerminal);
          stopChecks.firstHistoryUnchanged = firstProjectionStable;
          stopChecks.stopOutcomeInterrupted = hasOwnedSessionOutcome(scenarioObservations.stop, "interrupted");
          checks.stopOutcomeInterrupted = stopChecks.stopOutcomeInterrupted;
          stopChecks.sessionLocationBinding =
            sessionInfo?.id === session.id &&
            sessionInfo.directory === isolation.paths.cwd &&
            scenarioObservations.stop.at(-1)?.ownedIDMatched === true &&
            scenarioObservations.stop.at(-1)?.locationMatched === true;
          stopChecks.eventOrderExact = stopEventOrderIsValid(stopEventOrder, session.id, stopCallID, secondFormID);
          const lateCount = apiRequests;
          let secondLateRejected = false;
          try {
            await agent.replyQuestion(secondFormID, [["yes"]]);
          } catch {
            secondLateRejected = true;
          }
          stopChecks.lateReplyRejectedWithoutAPI = lateReplyWasLocalRejection(
            secondLateRejected,
            lateCount,
            apiRequests,
          );
          stopChecks.noModelContinuation =
            modelRequests === 2 &&
            toolCalls === 2 &&
            promptAttempts === 2 &&
            scenarioObservations.stop.every((o) => o.outcome !== "succeeded") &&
            assistantStopHistoryIsValid(stableFirstHistory, afterTerminal, session.id, stopCallID);
          stopChecks.exactEventCounts =
            permissionAskCount === 2 &&
            permissionReplyCount === 2 &&
            questionAskCount === 2 &&
            questionRejectCount === 2;
          manifest.scenarios.stop = {
            status: Object.values(stopChecks).length > 0 && Object.values(stopChecks).every(Boolean) ? "PASS" : "FAIL",
            checks: { ...stopChecks },
            formState: secondFormState,
            terminalObservations: [...scenarioObservations.stop],
            counts: {
              apiRequests: Math.max(0, apiRequests - manifest.scenarios.dismiss.counts.apiRequests),
              modelRequests: 1,
              sessions: 1,
              children: 1,
              questionCalls: 1,
              promptAttempts: 1,
            },
          };
          manifest.terminalObservations = [...scenarioObservations.dismiss, ...scenarioObservations.stop];
          checks.permissionAlwaysReplyIdentity = checks.permissionAlwaysReplyIdentity && stopChecks.permissionReplyOnce;
          checks.noStaleSuccessOrModelContinuation =
            checks.noStaleSuccessOrModelContinuation &&
            stopChecks.noModelContinuation &&
            stopChecks.firstHistoryUnchanged;
          checks.exactPermissionQuestionCounts =
            checks.exactPermissionQuestionCounts &&
            permissionAskCount === 2 &&
            permissionReplyCount === 2 &&
            questionAskCount === 2 &&
            questionRejectCount === 2;
        } else {
          manifest.scenarios.stop.status = "NOT_RUN";
        }
      }
      manifest.formState = formState.value;
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions: 1,
        children: ownedPID ? 1 : 0,
        questionCalls: toolCalls,
        promptAttempts,
      };
      checks.requestBounds =
        Date.now() - started <= bounds.overallMs &&
        apiRequests <= bounds.apiRequests &&
        modelRequests === 2 &&
        toolCalls === 2 &&
        promptAttempts === 2;
      checks.cleanupStrict = false;
      manifest.status = Object.entries(checks).every(([name, value]) => name === "cleanupStrict" || value)
        ? "RUNNING"
        : "FAIL";
      manifest.stage = "pre_teardown_evidence";
      if (runtimeFailureCode) manifest.failureCode = runtimeFailureCode;
      await persist();
    } catch (error) {
      const allowedCodes = [
        "dedicated_fork_required",
        "executable_required",
        "executable_unavailable",
        "executable_hash_mismatch",
        "client_metadata_mismatch",
        "ambient_gate_blocked",
        "spawn_gate_blocked",
      ];
      const code = (error as NodeJS.ErrnoException).code;
      manifest.failureCode =
        runtimeFailureCode ?? (allowedCodes.includes(String(code)) ? String(code) : "fixture_operation_failed");
      manifest.status = allowedCodes.includes(manifest.failureCode) ? "BLOCKED" : "FAIL";
    } finally {
      manifest.stage = "pre_teardown_evidence";
      manifest.checks = { ...checks };
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions: sessionID ? 1 : 0,
        children: ownedPID ? 1 : 0,
        questionCalls: toolCalls,
        promptAttempts,
      };
      manifest.formState = formState.value;
      manifest.preTeardown = {
        status: manifest.status,
        checks: { ...checks },
        counts: { ...manifest.counts },
        ...(manifest.failureCode ? { failureCode: manifest.failureCode } : {}),
      };
      await persist().catch(() => {
        manifest.status = "FAIL";
        manifest.failureCode ??= "evidence_persist_failed";
      });
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
      let forcedProcessReap = false;
      if (ownedPID) {
        let gone = await waitForProcessGroupExit(ownedPID, 1_000);
        if (!gone) {
          forcedProcessReap = true;
          try {
            process.kill(-ownedPID, "SIGTERM");
          } catch {}
          gone = await waitForProcessGroupExit(ownedPID, 500);
        }
        if (!gone) {
          try {
            process.kill(-ownedPID, "SIGKILL");
          } catch {}
          gone = await waitForProcessGroupExit(ownedPID, 1_000);
        }
        manifest.cleanup.processGroupReaped = gone;
      }
      if (fixture) {
        try {
          await bounded(
            new Promise<void>((resolveClose, reject) =>
              fixture?.close((error) => (error ? reject(error) : resolveClose())),
            ),
            2_000,
          );
          fixtureClosed = true;
        } catch {
          fixture.closeAllConnections();
          try {
            await bounded(
              new Promise<void>((resolveClose, reject) =>
                fixture?.close((error) => (error ? reject(error) : resolveClose())),
              ),
              1_000,
            );
            fixtureClosed = true;
          } catch {
            fixtureClosed = fixture.listening === false;
          }
        }
      }
      manifest.cleanup.fixtureClosed = fixtureClosed;
      if (isolation) {
        if (
          (!agent && ownedPID === undefined) ||
          manifest.cleanup.processGroupReaped === true ||
          (ownedPID === undefined && manifest.cleanup.agentDisconnected === true)
        ) {
          try {
            await bounded(isolation.dispose(), 5_000);
            manifest.cleanup.isolationRemoved = await absent(isolation.root);
            manifest.cleanup.stateAbsent = await absent(isolation.paths.state);
            manifest.cleanup.databaseAbsent = await absent(isolation.paths.database);
          } catch {
            manifest.cleanup.isolationRemoved = false;
            manifest.cleanup.stateAbsent = false;
            manifest.cleanup.databaseAbsent = false;
          }
        } else {
          manifest.cleanup.isolationRemoved = false;
          manifest.cleanup.stateAbsent = false;
          manifest.cleanup.databaseAbsent = false;
        }
      }
      if (environmentReplaced) {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, originalEnvironment);
      }
      manifest.cleanup.environmentRestored = Object.keys({ ...originalEnvironment, ...process.env }).every(
        (key) => originalEnvironment[key] === process.env[key],
      );
      globalThis.fetch = originalFetch;
      manifest.cleanup.fetchRestored = globalThis.fetch === originalFetch;
      clearTimeout(overallTimer);
      manifest.stage = "completed";
      checks.cleanupStrict =
        !forcedProcessReap &&
        requiredCleanup.every((key) => manifest.cleanup[key as keyof Manifest["cleanup"]] === true);
      manifest.checks = { ...checks };
      if (manifest.status !== "BLOCKED")
        manifest.status =
          checks.cleanupStrict && Object.values(checks).every(Boolean) && !runtimeFailureCode
            ? aggregateScenarioStatus(manifest.scenarios.dismiss.status, manifest.scenarios.stop.status)
            : "FAIL";
      manifest.failureCode = runtimeFailureCode ?? manifest.failureCode;
      await persist();
    }
    const persistedManifest: unknown = JSON.parse(await readFile(evidencePath, "utf8"));
    expect(
      isStrictPass(persistedManifest),
      `${manifest.status}:${manifest.failureCode ?? "required_check_failed"}`,
    ).toBe(true);
  });
});
