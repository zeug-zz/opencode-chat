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
  apiRequests: 110,
  modelRequests: 4,
  sessions: 4,
  forks: 2,
  prompts: 2,
  compacts: 2,
  modelSwitches: 1,
  children: 1,
  modelBodyBytes: 65_536,
} as const;
const controls = ["fixture fork control A", "fixture fork control B"] as const;
const answers = ["fixture fork answer A", "fixture fork answer B"] as const;
// Native compaction accepts a reply only if a line equals a SUMMARY_TEMPLATE heading; otherwise it sends an extra nudge request.
const summaryAnswers = ["## Objective\nfixture fork summary A", "## Objective\nfixture fork summary B"] as const;
const checkNames = [
  "dedicatedFork",
  "clientMetadataPinned",
  "executableHashPinned",
  "projectLocalIsolation",
  "ambientGateClear",
  "spawnGateClear",
  "privateChildVersionAndPID",
  "nativeConfigIsSafe",
  "parentHistoryCompletedExactly",
  "fullForkContentAndIdentity",
  "anchoredForkPrefixAndIdentity",
  "nativeForkProvenance",
  "nativeHistoryStable",
  "forkRequestShapesExact",
  "parentHistoryUnchanged",
  "realChildInitiallyAbsent",
  "realChildSeedValid",
  "realChildListedExactly",
  "ownedSessionListExact",
  "realChildTombstoned",
  "parentTombstoned",
  "forksRemainAfterParentDelete",
  "defaultSummaryCompacted",
  "explicitSummaryCompacted",
  "deletedLookupsNoApi",
  "forksDeleted",
  "finalOwnedListEmpty",
  "noAdditionalModelRequests",
  "requestBounds",
] as const;
const cleanupNames = [
  "agentDisconnected",
  "processGroupReaped",
  "fixtureClosed",
  "isolationRemoved",
  "stateAbsent",
  "databaseAbsent",
  "environmentRestored",
  "fetchRestored",
] as const;
type Status = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
type BoundaryType = "through" | "before" | "other" | "missing";
type ParentIDState = "absent" | "undefined" | "null" | "string" | "other";
type NativeHistoryType =
  | "user"
  | "assistant"
  | "system"
  | "synthetic"
  | "agent-switched"
  | "model-switched"
  | "location-switched"
  | "compaction"
  | "skill"
  | "shell"
  | "idle"
  | "other";
type NativeMessageSnapshot = { id: string; type: Exclude<NativeHistoryType, "other"> };
type ForkProvenanceDiagnostic = {
  sessionSchemaValid: boolean;
  forkSchemaValid: boolean;
  boundarySchemaValid: boolean;
  responseIDMatch: boolean;
  sourceIDMatch: boolean;
  boundaryType: BoundaryType;
  expectedBoundaryIDMatch: boolean;
  hasParentID: boolean;
  parentIDState: ParentIDState;
};
const stages = [
  "preflight",
  "connect",
  "session_setup",
  "prompt",
  "history",
  "fork",
  "lifecycle",
  "default_summary",
  "explicit_summary",
  "pre_teardown",
  "cleanup",
  "complete",
] as const;
const failureCodes = [
  "dedicated_fork_required",
  "explicit_executable_required",
  "client_metadata_mismatch",
  "executable_unavailable",
  "executable_hash_mismatch",
  "ambient_gate_blocked",
  "spawn_gate_blocked",
  "overall_deadline",
  "unexpected_mock_route",
  "unexpected_model_request_order",
  "unexpected_compaction_request",
  "model_body_limit",
  "invalid_model_body",
  "model_prompt_mismatch",
  "api_request_limit",
  "session_operation_limit",
  "prompt_operation_limit",
  "native_history_contract_mismatch",
  "session_lifecycle_assertion_failed",
  "first_api_not_owned_info",
  "foreign_api_origin",
  "malformed_fork_path",
  "unexpected_nonowned_request",
  "session_location_mismatch",
  "second_prompt_gate_not_satisfied",
  "first_prompt_request_count_mismatch",
  "second_prompt_request_count_mismatch",
  "history_readiness_timeout",
  "second_user_anchor_missing",
  "fork_history_assertion_failed",
  "fixture_operation_failed",
  "cleanup_or_check_failed",
  "pre_teardown_persist_failed",
  "strict_manifest_readback_failed",
  "final_persist_failed",
] as const;
type Stage = (typeof stages)[number];
type FailureCode = (typeof failureCodes)[number];
type MessageSig = { role: string; text: string; sessionID: string; id: string };
type Manifest = {
  schemaVersion: 1;
  runId: string;
  status: Status;
  stage: Stage;
  failureStage?: Stage;
  failureCode?: FailureCode;
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
    forks: number;
    prompts: number;
    sessionAttempts: number;
    forkAttempts: number;
    promptAttempts: number;
    compactAttempts: number;
    modelSwitchAttempts: number;
    children: number;
  };
  checks: Record<(typeof checkNames)[number], boolean>;
  forkProvenance: { full: ForkProvenanceDiagnostic | null; anchored: ForkProvenanceDiagnostic | null };
  nativeHistory: {
    beforeComplete: boolean;
    beforeIDsValid: boolean;
    beforeTypesValid: boolean;
    beforeCount: number;
    beforeLastType: NativeHistoryType | null;
    afterComplete: boolean;
    afterIDsValid: boolean;
    afterTypesValid: boolean;
    afterCount: number;
    afterLastType: NativeHistoryType | null;
    orderedSnapshotUnchanged: boolean;
  };
  lifecycle: {
    initialChildren: number;
    listedChildren: number;
    listedSessionsBeforeDelete: number;
    listedForksAfterParentDelete: number;
    finalSessions: number;
    deletedLookupApiDelta: number;
    seededChildLocationValid: boolean;
    childParentRelationValid: boolean;
    childExcludedForks: boolean;
    forksSurvivedParentDelete: boolean;
    defaultSummaryCompleted: boolean;
    explicitSummaryCompleted: boolean;
    defaultCompactBodyOmitsModel: boolean;
    explicitCompactBodyOmitsModel: boolean;
    explicitSwitchPrecedesCompact: boolean;
    defaultNoModelSwitch: boolean;
  };
  cleanup: Record<(typeof cleanupNames)[number], boolean | null>;
  preTeardown?: {
    status: Status;
    checks: Manifest["checks"];
    counts: Manifest["counts"];
    forkProvenance: Manifest["forkProvenance"];
    nativeHistory: Manifest["nativeHistory"];
    lifecycle: Manifest["lifecycle"];
    summaries: Manifest["summaries"];
    failureCode?: FailureCode;
  };
  summaries: {
    defaultComplete: boolean;
    defaultSummaryMatch: boolean;
    defaultModelMatch: boolean;
    defaultBusyIdle: boolean;
    explicitComplete: boolean;
    explicitSummaryMatch: boolean;
    explicitModelMatch: boolean;
    explicitBusyIdle: boolean;
    defaultCompactBodyOmitsModel: boolean;
    explicitCompactBodyOmitsModel: boolean;
    defaultCompactTargetValid: boolean;
    explicitCompactTargetValid: boolean;
    explicitSwitchTargetValid: boolean;
    explicitSwitchModelValid: boolean;
    explicitSwitchPrecedesCompact: boolean;
    defaultNoModelSwitch: boolean;
  };
};
type ForkObservation = { source: string; before?: string; beforePresent: boolean };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => (record(part) && typeof part.text === "string" ? [part.text] : [])).join("\n");
}
function historySignature(history: ChatMessageWithParts[]): MessageSig[] {
  return history.map(({ info, parts }) => ({
    role: info.role,
    text: parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
    sessionID: info.sessionID,
    id: info.id,
  }));
}
function exactHistory(
  history: ChatMessageWithParts[],
  sessionID: string,
  expected: Array<{ role: string; text: string }>,
): boolean {
  const actual = historySignature(history);
  return (
    actual.length === expected.length &&
    actual.every(
      (item, index) =>
        item.sessionID === sessionID && item.role === expected[index]?.role && item.text === expected[index]?.text,
    ) &&
    history.every(
      ({ info }) => info.role !== "assistant" || (info.time.completed !== undefined && info.error === undefined),
    )
  );
}
function reminted(history: ChatMessageWithParts[], ...others: ChatMessageWithParts[][]): boolean {
  const ids = history.map((item) => item.info.id);
  const partIDs = history.flatMap((item) => item.parts.map((part) => part.id));
  if (
    ids.some((id) => !id) ||
    partIDs.some((id) => !id) ||
    new Set(ids).size !== ids.length ||
    new Set(partIDs).size !== partIDs.length ||
    history.some((message) =>
      message.parts.some((part) => part.sessionID !== message.info.sessionID || part.messageID !== message.info.id),
    )
  )
    return false;
  return others.every((other) => {
    const otherMessages = new Set(other.map((item) => item.info.id));
    const otherParts = new Set(other.flatMap((item) => item.parts.map((part) => part.id)));
    return history.every(
      (item) => !otherMessages.has(item.info.id) && item.parts.every((part) => !otherParts.has(part.id)),
    );
  });
}
function exactSessionSet(actual: Array<{ id: string }>, expected: string[]): boolean {
  const ids = actual.map(({ id }) => id);
  return ids.length === expected.length && new Set(ids).size === ids.length && expected.every((id) => ids.includes(id));
}
function realChildRelation(
  child: { id: string; parentID?: string; directory?: string },
  parentID: string,
  directory: string,
) {
  return child.id !== parentID && child.parentID === parentID && child.directory === directory;
}
function noApiForDeletedLookups(apiDeltas: number[], rejected: boolean[]): boolean {
  return (
    apiDeltas.length === 2 &&
    apiDeltas.every((delta) => delta === 0) &&
    rejected.length === 4 &&
    rejected.every(Boolean)
  );
}
function exactForkRequests(requests: ForkObservation[], parentID: string, anchor: string): boolean {
  return (
    requests.length === 2 &&
    requests[0]?.source === parentID &&
    requests[0].beforePresent === false &&
    requests[1]?.source === parentID &&
    requests[1].beforePresent &&
    requests[1].before === anchor
  );
}
function compactionRecordMatches(
  value: unknown,
  queriedSessionID: string,
  expectedSessionID: string,
  summary: string,
  modelID: string,
  busyIdle: boolean,
): boolean {
  return Boolean(
    record(value) &&
      value.type === "compaction" &&
      queriedSessionID === expectedSessionID &&
      value.status === "completed" &&
      value.reason === "manual" &&
      value.summary === summary &&
      record(value.model) &&
      value.model.providerID === "fixture-provider" &&
      value.model.id === modelID &&
      busyIdle,
  );
}
function switchModelRequestMatches(value: unknown, targetSessionID: string, observedSessionID: string): boolean {
  return Boolean(
    targetSessionID === observedSessionID &&
      record(value) &&
      Object.keys(value).length === 1 &&
      Object.hasOwn(value, "model") &&
      record(value.model) &&
      Object.keys(value.model).length === 2 &&
      value.model.providerID === "fixture-provider" &&
      value.model.id === "fixture-summary-model",
  );
}
function sessionIDFromRoute(pathname: string): string | undefined {
  const match = /^\/api\/session\/([^/]+)\/(?:compact|model)$/.exec(pathname);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
function strictPass(value: unknown): value is Manifest {
  if (
    !record(value) ||
    !record(value.checks) ||
    !record(value.cleanup) ||
    !record(value.counts) ||
    !record(value.bounds) ||
    !record(value.preTeardown) ||
    !record(value.preTeardown.checks) ||
    !record(value.preTeardown.counts) ||
    !record(value.forkProvenance) ||
    !record(value.preTeardown.forkProvenance) ||
    !record(value.nativeHistory) ||
    !record(value.preTeardown.nativeHistory) ||
    !record(value.lifecycle) ||
    !record(value.preTeardown.lifecycle) ||
    !record(value.summaries) ||
    !record(value.preTeardown.summaries) ||
    value.schemaVersion !== 1 ||
    typeof value.runId !== "string" ||
    value.runId.length === 0
  )
    return false;
  const checks = value.checks as Record<string, unknown>;
  const cleanup = value.cleanup as Record<string, unknown>;
  const counts = value.counts as Record<string, unknown>;
  const preTeardown = value.preTeardown as Record<string, unknown>;
  const preTeardownChecks = preTeardown.checks as Record<string, unknown>;
  const preTeardownCounts = preTeardown.counts as Record<string, unknown>;
  const forkProvenance = value.forkProvenance as Record<string, unknown>;
  const preTeardownProvenance = preTeardown.forkProvenance as Record<string, unknown>;
  const nativeHistory = value.nativeHistory as Record<string, unknown>;
  const preTeardownNativeHistory = preTeardown.nativeHistory as Record<string, unknown>;
  const summaries = value.summaries as Record<string, unknown>;
  const preTeardownSummaries = preTeardown.summaries as Record<string, unknown>;
  return (
    value.status === "PASS" &&
    value.stage === "complete" &&
    value.failureCode === undefined &&
    value.expectedVersion === version &&
    value.observedVersion === version &&
    value.sourceCommit === sourceCommit &&
    value.sourceCommitMeaning === "inspected-release-tag" &&
    value.clientPackage === "@opencode/client@2.1.0" &&
    typeof value.executablePath === "string" &&
    value.executableSha256 === executableHash &&
    typeof value.ownedPID === "number" &&
    value.ownedPID > 0 &&
    [value.fixtureRoot, value.statePath, value.databasePath].every(isPrivateEvidencePath) &&
    typeof value.evidencePath === "string" &&
    isPrivateEvidencePath(value.evidencePath) &&
    JSON.stringify(value.bounds) === JSON.stringify(bounds) &&
    checkNames.every((key) => checks[key] === true) &&
    checkNames.every((key) => preTeardownChecks[key] === true) &&
    provenanceDiagnosticPass(forkProvenance.full as ForkProvenanceDiagnostic, "through") &&
    provenanceDiagnosticPass(forkProvenance.anchored as ForkProvenanceDiagnostic, "before") &&
    JSON.stringify(forkProvenance) === JSON.stringify(preTeardownProvenance) &&
    nativeHistory.beforeComplete === true &&
    nativeHistory.beforeIDsValid === true &&
    nativeHistory.beforeTypesValid === true &&
    nativeHistory.beforeLastType === "idle" &&
    typeof nativeHistory.beforeCount === "number" &&
    nativeHistory.beforeCount > 0 &&
    nativeHistory.beforeCount <= 64 &&
    nativeHistory.afterComplete === true &&
    nativeHistory.afterIDsValid === true &&
    nativeHistory.afterTypesValid === true &&
    nativeHistory.afterLastType === "idle" &&
    nativeHistory.afterCount === nativeHistory.beforeCount &&
    nativeHistory.orderedSnapshotUnchanged === true &&
    JSON.stringify(nativeHistory) === JSON.stringify(preTeardownNativeHistory) &&
    record(value.lifecycle) &&
    record(preTeardown.lifecycle) &&
    JSON.stringify(value.lifecycle) === JSON.stringify(preTeardown.lifecycle) &&
    Number(value.lifecycle.initialChildren) === 0 &&
    Number(value.lifecycle.listedChildren) === 1 &&
    Number(value.lifecycle.listedSessionsBeforeDelete) === 4 &&
    Number(value.lifecycle.listedForksAfterParentDelete) === 2 &&
    Number(value.lifecycle.finalSessions) === 0 &&
    Number(value.lifecycle.deletedLookupApiDelta) === 0 &&
    value.lifecycle.seededChildLocationValid === true &&
    value.lifecycle.childParentRelationValid === true &&
    value.lifecycle.childExcludedForks === true &&
    value.lifecycle.forksSurvivedParentDelete === true &&
    value.lifecycle.defaultSummaryCompleted === true &&
    value.lifecycle.explicitSummaryCompleted === true &&
    value.lifecycle.defaultCompactBodyOmitsModel === true &&
    value.lifecycle.explicitCompactBodyOmitsModel === true &&
    value.lifecycle.explicitSwitchPrecedesCompact === true &&
    value.lifecycle.defaultNoModelSwitch === true &&
    JSON.stringify(summaries) === JSON.stringify(preTeardownSummaries) &&
    Object.values(summaries).every((item) => item === true) &&
    preTeardown.status === "RUNNING" &&
    preTeardown.failureCode === undefined &&
    preTeardownCounts.sessions === bounds.sessions &&
    preTeardownCounts.forks === bounds.forks &&
    preTeardownCounts.prompts === bounds.prompts &&
    validCounts(preTeardownCounts) &&
    cleanupNames.every((key) => cleanup[key] === true) &&
    Object.values(cleanup).every((item) => item === true) &&
    validCounts(counts)
  );
}

function isPrivateEvidencePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("tmp/scribe-v2-migration/session-fork/") &&
    !isAbsolute(path) &&
    !path.split(/[\\/]/).some((segment) => segment === ".." || segment === "")
  );
}

function validCounts(value: Record<string, unknown>): boolean {
  return (
    Number.isInteger(value.apiRequests) &&
    Number(value.apiRequests) >= 0 &&
    Number(value.apiRequests) <= bounds.apiRequests &&
    value.modelRequests === bounds.modelRequests &&
    value.sessions === bounds.sessions &&
    value.forks === bounds.forks &&
    value.prompts === bounds.prompts &&
    value.sessionAttempts === bounds.sessions &&
    value.forkAttempts === bounds.forks &&
    value.promptAttempts === bounds.prompts &&
    value.compactAttempts === bounds.compacts &&
    value.modelSwitchAttempts === bounds.modelSwitches &&
    value.children === bounds.children
  );
}

function reserveOperationAttempt(current: number, limit: number): number | undefined {
  return Number.isInteger(current) && current >= 0 && current < limit ? current + 1 : undefined;
}

type NativeHistoryAccumulator = {
  complete: boolean;
  idsValid: boolean;
  typesValid: boolean;
  pages: number;
  records: NativeMessageSnapshot[];
  seenIDs: Set<string>;
  seenCursors: Set<string>;
  nextCursor?: string;
};

function emptyNativeHistory(): NativeHistoryAccumulator {
  return {
    complete: false,
    idsValid: true,
    typesValid: true,
    pages: 0,
    records: [],
    seenIDs: new Set(),
    seenCursors: new Set(),
  };
}

const nativeHistoryTypes = [
  "agent-switched",
  "model-switched",
  "location-switched",
  "user",
  "synthetic",
  "system",
  "skill",
  "shell",
  "assistant",
  "compaction",
  "idle",
] as const satisfies readonly Exclude<NativeHistoryType, "other">[];

function appendNativeHistoryPage(accumulator: NativeHistoryAccumulator, response: unknown): boolean {
  if (accumulator.complete || accumulator.pages >= 4) return false;
  accumulator.pages += 1;
  if (!record(response) || !Array.isArray(response.data) || !record(response.cursor)) return false;
  if (accumulator.records.length + response.data.length > 64) return false;
  for (const message of response.data) {
    if (!record(message) || typeof message.id !== "string" || message.id.length === 0 || message.id.length > 512) {
      accumulator.idsValid = false;
      return false;
    }
    if (accumulator.seenIDs.has(message.id)) {
      accumulator.idsValid = false;
      return false;
    }
    if (
      typeof message.type !== "string" ||
      !nativeHistoryTypes.includes(message.type as (typeof nativeHistoryTypes)[number])
    ) {
      accumulator.typesValid = false;
      return false;
    }
    accumulator.seenIDs.add(message.id);
    accumulator.records.push({ id: message.id, type: message.type as NativeMessageSnapshot["type"] });
  }
  const next = response.cursor.next;
  if (next === undefined || next === null || next === "") {
    accumulator.complete = true;
    accumulator.nextCursor = undefined;
    return true;
  }
  if (typeof next !== "string" || accumulator.seenCursors.has(next)) return false;
  accumulator.seenCursors.add(next);
  accumulator.nextCursor = next;
  return true;
}

function nativeHistorySnapshot(accumulator: NativeHistoryAccumulator) {
  const idsValid = accumulator.idsValid && accumulator.records.length > 0;
  return {
    complete: accumulator.complete && accumulator.records.length > 0,
    idsValid,
    typesValid: accumulator.typesValid && accumulator.records.length > 0,
    records: accumulator.records,
    lastType: accumulator.records.at(-1)?.type ?? null,
  };
}

function nativeHistorySnapshotsMatch(
  before: ReturnType<typeof nativeHistorySnapshot>,
  after: ReturnType<typeof nativeHistorySnapshot>,
): boolean {
  return (
    before.complete &&
    before.idsValid &&
    before.typesValid &&
    after.complete &&
    after.idsValid &&
    after.typesValid &&
    JSON.stringify(before.records) === JSON.stringify(after.records)
  );
}

async function readNativeHistory(client: OpenCodeClient, sessionID: string) {
  const accumulator = emptyNativeHistory();
  for (let page = 0; page < 4; page += 1) {
    const response = accumulator.nextCursor
      ? await client.message.list({ sessionID, cursor: accumulator.nextCursor })
      : await client.message.list({ sessionID, order: "asc" });
    if (!appendNativeHistoryPage(accumulator, response)) break;
    if (accumulator.complete) break;
  }
  return nativeHistorySnapshot(accumulator);
}

function diagnoseForkProvenance(
  value: unknown,
  responseID: string,
  sourceID: string,
  messageID: string,
): ForkProvenanceDiagnostic {
  const session = record(value) ? value : undefined;
  const fork = session && record(session.fork) ? session.fork : undefined;
  const boundary = fork && record(fork.boundary) ? fork.boundary : undefined;
  const hasParentID = Boolean(session && Object.hasOwn(session, "parentID"));
  const parentID = session?.parentID;
  const parentIDState: ParentIDState = !hasParentID
    ? "absent"
    : parentID === undefined
      ? "undefined"
      : parentID === null
        ? "null"
        : typeof parentID === "string"
          ? "string"
          : "other";
  const boundaryType: BoundaryType =
    !boundary || !Object.hasOwn(boundary, "type")
      ? "missing"
      : boundary.type === "through" || boundary.type === "before"
        ? boundary.type
        : "other";
  return {
    sessionSchemaValid: Boolean(session && typeof session.id === "string"),
    forkSchemaValid: Boolean(fork && typeof fork.sessionID === "string"),
    boundarySchemaValid: Boolean(boundary && Object.hasOwn(boundary, "type") && typeof boundary.messageID === "string"),
    responseIDMatch: session?.id === responseID,
    sourceIDMatch: fork?.sessionID === sourceID,
    boundaryType,
    expectedBoundaryIDMatch: boundary?.messageID === messageID,
    hasParentID,
    parentIDState,
  };
}

function provenanceDiagnosticPass(
  diagnostic: ForkProvenanceDiagnostic | null,
  boundary: "through" | "before",
): boolean {
  return Boolean(
    diagnostic?.sessionSchemaValid &&
      diagnostic.forkSchemaValid &&
      diagnostic.boundarySchemaValid &&
      diagnostic.responseIDMatch &&
      diagnostic.sourceIDMatch &&
      diagnostic.boundaryType === boundary &&
      diagnostic.expectedBoundaryIDMatch &&
      !diagnostic.hasParentID &&
      diagnostic.parentIDState === "absent",
  );
}

function operationAttemptsAllowed(
  counts: { sessions: number; forks: number },
  operation: "create" | "fork",
): { sessions: number; forks: number } | undefined {
  const sessions = reserveOperationAttempt(counts.sessions, bounds.sessions);
  const forks = operation === "fork" ? reserveOperationAttempt(counts.forks, bounds.forks) : counts.forks;
  if (sessions === undefined || forks === undefined) return undefined;
  return { sessions, forks };
}

function strictManifestFixture(): Manifest {
  return {
    schemaVersion: 1,
    runId: "fixture-run",
    status: "PASS",
    stage: "complete",
    expectedVersion: version,
    observedVersion: version,
    sourceCommit,
    sourceCommitMeaning: "inspected-release-tag",
    executablePath: "/fixture/opencode",
    executableSha256: executableHash,
    clientPackage: "@opencode/client@2.1.0",
    ownedPID: 42,
    fixtureRoot: "tmp/scribe-v2-migration/session-fork/fixture",
    statePath: "tmp/scribe-v2-migration/session-fork/fixture/state",
    databasePath: "tmp/scribe-v2-migration/session-fork/fixture/db",
    evidencePath: "tmp/scribe-v2-migration/session-fork/fixture/result.json",
    bounds,
    counts: {
      apiRequests: 20,
      modelRequests: 4,
      sessions: 4,
      forks: 2,
      prompts: 2,
      sessionAttempts: 4,
      forkAttempts: 2,
      promptAttempts: 2,
      compactAttempts: 2,
      modelSwitchAttempts: 1,
      children: 1,
    },
    checks: Object.fromEntries(checkNames.map((name) => [name, true])) as Manifest["checks"],
    forkProvenance: {
      full: {
        sessionSchemaValid: true,
        forkSchemaValid: true,
        boundarySchemaValid: true,
        responseIDMatch: true,
        sourceIDMatch: true,
        boundaryType: "through",
        expectedBoundaryIDMatch: true,
        hasParentID: false,
        parentIDState: "absent",
      },
      anchored: {
        sessionSchemaValid: true,
        forkSchemaValid: true,
        boundarySchemaValid: true,
        responseIDMatch: true,
        sourceIDMatch: true,
        boundaryType: "before",
        expectedBoundaryIDMatch: true,
        hasParentID: false,
        parentIDState: "absent",
      },
    },
    nativeHistory: {
      beforeComplete: true,
      beforeIDsValid: true,
      beforeTypesValid: true,
      beforeCount: 6,
      beforeLastType: "idle",
      afterComplete: true,
      afterIDsValid: true,
      afterTypesValid: true,
      afterCount: 6,
      afterLastType: "idle",
      orderedSnapshotUnchanged: true,
    },
    lifecycle: {
      initialChildren: 0,
      listedChildren: 1,
      listedSessionsBeforeDelete: 4,
      listedForksAfterParentDelete: 2,
      finalSessions: 0,
      deletedLookupApiDelta: 0,
      seededChildLocationValid: true,
      childParentRelationValid: true,
      childExcludedForks: true,
      forksSurvivedParentDelete: true,
      defaultSummaryCompleted: true,
      explicitSummaryCompleted: true,
      defaultCompactBodyOmitsModel: true,
      explicitCompactBodyOmitsModel: true,
      explicitSwitchPrecedesCompact: true,
      defaultNoModelSwitch: true,
    },
    summaries: {
      defaultComplete: true,
      defaultSummaryMatch: true,
      defaultModelMatch: true,
      defaultBusyIdle: true,
      explicitComplete: true,
      explicitSummaryMatch: true,
      explicitModelMatch: true,
      explicitBusyIdle: true,
      defaultCompactBodyOmitsModel: true,
      explicitCompactBodyOmitsModel: true,
      defaultCompactTargetValid: true,
      explicitCompactTargetValid: true,
      explicitSwitchTargetValid: true,
      explicitSwitchModelValid: true,
      explicitSwitchPrecedesCompact: true,
      defaultNoModelSwitch: true,
    },
    cleanup: Object.fromEntries(cleanupNames.map((name) => [name, true])) as Manifest["cleanup"],
    preTeardown: {
      status: "RUNNING",
      checks: Object.fromEntries(checkNames.map((name) => [name, true])) as Manifest["checks"],
      counts: {
        apiRequests: 20,
        modelRequests: 4,
        sessions: 4,
        forks: 2,
        prompts: 2,
        sessionAttempts: 4,
        forkAttempts: 2,
        promptAttempts: 2,
        compactAttempts: 2,
        modelSwitchAttempts: 1,
        children: 1,
      },
      forkProvenance: {
        full: {
          sessionSchemaValid: true,
          forkSchemaValid: true,
          boundarySchemaValid: true,
          responseIDMatch: true,
          sourceIDMatch: true,
          boundaryType: "through",
          expectedBoundaryIDMatch: true,
          hasParentID: false,
          parentIDState: "absent",
        },
        anchored: {
          sessionSchemaValid: true,
          forkSchemaValid: true,
          boundarySchemaValid: true,
          responseIDMatch: true,
          sourceIDMatch: true,
          boundaryType: "before",
          expectedBoundaryIDMatch: true,
          hasParentID: false,
          parentIDState: "absent",
        },
      },
      nativeHistory: {
        beforeComplete: true,
        beforeIDsValid: true,
        beforeTypesValid: true,
        beforeCount: 6,
        beforeLastType: "idle",
        afterComplete: true,
        afterIDsValid: true,
        afterTypesValid: true,
        afterCount: 6,
        afterLastType: "idle",
        orderedSnapshotUnchanged: true,
      },
      lifecycle: {
        initialChildren: 0,
        listedChildren: 1,
        listedSessionsBeforeDelete: 4,
        listedForksAfterParentDelete: 2,
        finalSessions: 0,
        deletedLookupApiDelta: 0,
        seededChildLocationValid: true,
        childParentRelationValid: true,
        childExcludedForks: true,
        forksSurvivedParentDelete: true,
        defaultSummaryCompleted: true,
        explicitSummaryCompleted: true,
        defaultCompactBodyOmitsModel: true,
        explicitCompactBodyOmitsModel: true,
        explicitSwitchPrecedesCompact: true,
        defaultNoModelSwitch: true,
      },
      summaries: {
        defaultComplete: true,
        defaultSummaryMatch: true,
        defaultModelMatch: true,
        defaultBusyIdle: true,
        explicitComplete: true,
        explicitSummaryMatch: true,
        explicitModelMatch: true,
        explicitBusyIdle: true,
        defaultCompactBodyOmitsModel: true,
        explicitCompactBodyOmitsModel: true,
        defaultCompactTargetValid: true,
        explicitCompactTargetValid: true,
        explicitSwitchTargetValid: true,
        explicitSwitchModelValid: true,
        explicitSwitchPrecedesCompact: true,
        defaultNoModelSwitch: true,
      },
    },
  };
}
function sse(text: string, model = "fixture-model"): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant" })}${chunk({ content: text })}${chunk({}, "stop")}data: [DONE]\n\n`;
}
function config(port: number) {
  return {
    model: "fixture-provider/fixture-model",
    enabledProviders: ["fixture-provider"],
    providers: {
      "fixture-provider": {
        name: "Local session fork fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: {
          "fixture-model": { name: "Fixture model" },
          "fixture-summary-model": { name: "Fixture summary model" },
        },
      },
    },
    plugins: [],
    mcp: {},
  };
}
async function completedCompaction(
  client: OpenCodeClient,
  queriedSessionID: string,
  expectedSessionID: string,
  expectedSummary: string,
  expectedModelID: string,
  busyIdle: () => boolean,
  deadline: number,
  signal: AbortSignal,
) {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let records: Awaited<ReturnType<typeof client.message.list>>["data"] = [];
  for (let read = 0; read < 8 && Date.now() < deadline && !signal.aborted; read += 1) {
    const response = await client.message.list(
      cursor
        ? { sessionID: queriedSessionID, cursor }
        : { sessionID: queriedSessionID, order: "asc", type: "compaction" },
    );
    records = [...records, ...response.data];
    const completed = response.data.find(
      (message) =>
        message.type === "compaction" &&
        compactionRecordMatches(
          message,
          queriedSessionID,
          expectedSessionID,
          expectedSummary,
          expectedModelID,
          busyIdle(),
        ),
    );
    if (completed) {
      return { complete: true, summaryMatch: true, modelMatch: true, busyIdle: true };
    }
    const next = response.cursor.next;
    if (typeof next === "string" && next.length > 0) {
      if (seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
      continue;
    }
    const completedInPages = records.find(
      (message) =>
        message.type === "compaction" &&
        compactionRecordMatches(
          message,
          queriedSessionID,
          expectedSessionID,
          expectedSummary,
          expectedModelID,
          busyIdle(),
        ),
    );
    if (completedInPages) return { complete: true, summaryMatch: true, modelMatch: true, busyIdle: true };
    cursor = undefined;
    seenCursors.clear();
    records = [];
    if (read < 7) await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(250, deadline - Date.now())));
  }
  return { complete: false, summaryMatch: false, modelMatch: false, busyIdle: false };
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
function waitGroupGone(pid: number, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  return new Promise((resolveWait) => {
    const poll = () => {
      try {
        process.kill(-pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return resolveWait(true);
      }
      if (Date.now() >= deadline) return resolveWait(false);
      setTimeout(poll, 25);
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
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("cleanup_timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function readyHistory(
  agent: OpenCodeAgent,
  sessionID: string,
  expected: Array<{ role: string; text: string }>,
  deadline: number,
  signal: AbortSignal,
) {
  for (let read = 0; read < 8 && Date.now() < deadline && !signal.aborted; read += 1) {
    const messages = await agent.getMessages(sessionID);
    const lastPrompt = promptEvents.at(-1);
    const busyIdle = lastPrompt?.sessionID === sessionID && lastPrompt.busy && lastPrompt.idle;
    if (busyIdle && exactHistory(messages, sessionID, expected)) return messages;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("history_readiness_timeout");
}
const promptEvents: Array<{ sessionID: string; busy: boolean; idle: boolean }> = [];

describe("native V2 fork/history fixture tooling", () => {
  it("keeps fixture summaries template-conforming so native compaction sends no nudge", () => {
    for (const answer of summaryAnswers) {
      expect(answer.split("\n").some((line) => line.trim() === "## Objective")).toBe(true);
    }
  });

  it("rejects wrong owners, repeated/original IDs, malformed prefixes and bad fork requests", () => {
    const nativePages = emptyNativeHistory();
    expect(
      appendNativeHistoryPage(nativePages, {
        data: [
          { id: "native-agent", type: "agent-switched" },
          { id: "native-model", type: "model-switched" },
          { id: "native-location", type: "location-switched" },
          { id: "native-assistant", type: "assistant" },
          { id: "native-idle", type: "idle" },
        ],
        cursor: { next: "opaque-cursor" },
      }),
    ).toBe(true);
    expect(appendNativeHistoryPage(nativePages, { data: [], cursor: { next: null } })).toBe(true);
    const nativeBefore = nativeHistorySnapshot(nativePages);
    expect(nativeBefore.complete && nativeBefore.idsValid && nativeBefore.typesValid).toBe(true);
    expect(nativeBefore.records.at(-1)).toEqual({ id: "native-idle", type: "idle" });
    expect(nativeHistorySnapshotsMatch(nativeBefore, structuredClone(nativeBefore))).toBe(true);
    const incompletePages = emptyNativeHistory();
    expect(
      appendNativeHistoryPage(incompletePages, {
        data: [{ id: "native-idle", type: "idle" }],
        cursor: { next: "more" },
      }),
    ).toBe(true);
    expect(nativeHistorySnapshot(incompletePages).complete).toBe(false);
    const malformedID = emptyNativeHistory();
    expect(appendNativeHistoryPage(malformedID, { data: [{ id: "", type: "idle" }], cursor: { next: null } })).toBe(
      false,
    );
    expect(nativeHistorySnapshot(malformedID).idsValid).toBe(false);
    const malformedType = emptyNativeHistory();
    expect(
      appendNativeHistoryPage(malformedType, {
        data: [{ id: "native-unknown", type: "unexpected" }],
        cursor: { next: null },
      }),
    ).toBe(false);
    expect(nativeHistorySnapshot(malformedType).typesValid).toBe(false);
    const repeatedCursor = emptyNativeHistory();
    expect(
      appendNativeHistoryPage(repeatedCursor, { data: [{ id: "one", type: "assistant" }], cursor: { next: "same" } }),
    ).toBe(true);
    expect(
      appendNativeHistoryPage(repeatedCursor, { data: [{ id: "two", type: "idle" }], cursor: { next: "same" } }),
    ).toBe(false);
    const overflow = emptyNativeHistory();
    expect(
      appendNativeHistoryPage(overflow, {
        data: Array.from({ length: 65 }, (_, index) => ({ id: `m${index}`, type: "assistant" })),
        cursor: { next: null },
      }),
    ).toBe(false);
    const wrongNativeID = emptyNativeHistory();
    expect(
      appendNativeHistoryPage(wrongNativeID, { data: [{ id: "wrong", type: "idle" }], cursor: { next: null } }),
    ).toBe(true);
    expect(nativeHistorySnapshotsMatch(nativeBefore, nativeHistorySnapshot(wrongNativeID))).toBe(false);
    expect(strictPass(strictManifestFixture())).toBe(true);
    const goodProvenance: ForkProvenanceDiagnostic = {
      sessionSchemaValid: true,
      forkSchemaValid: true,
      boundarySchemaValid: true,
      responseIDMatch: true,
      sourceIDMatch: true,
      boundaryType: "through",
      expectedBoundaryIDMatch: true,
      hasParentID: false,
      parentIDState: "absent",
    };
    expect(provenanceDiagnosticPass(goodProvenance, "through")).toBe(true);
    for (const invalid of [
      { ...goodProvenance, sessionSchemaValid: false },
      { ...goodProvenance, forkSchemaValid: false },
      { ...goodProvenance, boundarySchemaValid: false },
      { ...goodProvenance, responseIDMatch: false },
      { ...goodProvenance, sourceIDMatch: false },
      { ...goodProvenance, boundaryType: "other" as const },
      { ...goodProvenance, boundaryType: "missing" as const },
      { ...goodProvenance, expectedBoundaryIDMatch: false },
      { ...goodProvenance, hasParentID: true, parentIDState: "string" as const },
      { ...goodProvenance, hasParentID: true, parentIDState: "null" as const },
      { ...goodProvenance, hasParentID: true, parentIDState: "undefined" as const },
      { ...goodProvenance, hasParentID: true, parentIDState: "other" as const },
    ]) {
      expect(provenanceDiagnosticPass(invalid, "through")).toBe(false);
    }
    const failedNativeBranch = strictManifestFixture();
    failedNativeBranch.forkProvenance.full = { ...goodProvenance, responseIDMatch: false };
    failedNativeBranch.preTeardown!.forkProvenance = structuredClone(failedNativeBranch.forkProvenance);
    expect(strictPass(failedNativeBranch)).toBe(false);
    expect(strictPass({ ...strictManifestFixture(), status: "FAIL" })).toBe(false);
    for (const name of Object.keys(strictManifestFixture().summaries) as Array<keyof Manifest["summaries"]>) {
      expect(
        strictPass({
          ...strictManifestFixture(),
          summaries: { ...strictManifestFixture().summaries, [name]: false },
        }),
      ).toBe(false);
    }
    expect(strictPass({ ...strictManifestFixture(), preTeardown: undefined })).toBe(false);
    expect(
      strictPass({
        ...strictManifestFixture(),
        preTeardown: {
          ...strictManifestFixture().preTeardown!,
          counts: { ...strictManifestFixture().counts, sessions: 2 },
        },
      }),
    ).toBe(false);
    expect(
      strictPass({
        ...strictManifestFixture(),
        checks: { ...strictManifestFixture().checks, fullForkContentAndIdentity: false },
      }),
    ).toBe(false);
    expect(
      strictPass({
        ...strictManifestFixture(),
        cleanup: { ...strictManifestFixture().cleanup, isolationRemoved: false },
      }),
    ).toBe(false);
    expect(exactSessionSet([{ id: "a" }, { id: "b" }], ["a", "b"])).toBe(true);
    expect(exactSessionSet([{ id: "a" }, { id: "a" }], ["a", "b"])).toBe(false);
    expect(exactSessionSet([{ id: "a" }], ["a", "b"])).toBe(false);
    expect(realChildRelation({ id: "child", parentID: "parent", directory: "/owned" }, "parent", "/owned")).toBe(true);
    expect(realChildRelation({ id: "fork", directory: "/owned" }, "parent", "/owned")).toBe(false);
    expect(noApiForDeletedLookups([0, 0], [true, true, true, true])).toBe(true);
    expect(noApiForDeletedLookups([0, 1], [true, true, true, true])).toBe(false);
    expect(noApiForDeletedLookups([0, 0], [true, true, false, true])).toBe(false);
    expect(
      strictPass({ ...strictManifestFixture(), lifecycle: { ...strictManifestFixture().lifecycle, finalSessions: 1 } }),
    ).toBe(false);
    expect(
      strictPass({
        ...strictManifestFixture(),
        preTeardown: {
          ...strictManifestFixture().preTeardown!,
          lifecycle: { ...strictManifestFixture().lifecycle, listedChildren: 0 },
        },
      }),
    ).toBe(false);
    expect(strictPass({ ...strictManifestFixture(), fixtureRoot: "/unsafe/outside" })).toBe(false);
    expect(strictPass({ ...strictManifestFixture(), schemaVersion: 999 })).toBe(false);
    expect(strictPass({ ...strictManifestFixture(), runId: "" })).toBe(false);
    expect(
      strictPass({ ...strictManifestFixture(), statePath: "tmp/scribe-v2-migration/session-fork/../outside" }),
    ).toBe(false);
    for (const counts of [
      { apiRequests: 111 },
      { modelRequests: 999 },
      { children: 0 },
      { sessionAttempts: 5 },
      { forkAttempts: 3 },
      { promptAttempts: 3 },
      { compactAttempts: 3 },
      { modelSwitchAttempts: 2 },
    ]) {
      expect(
        strictPass({
          ...strictManifestFixture(),
          preTeardown: {
            ...strictManifestFixture().preTeardown!,
            counts: { ...strictManifestFixture().counts, ...counts },
          },
        }),
      ).toBe(false);
    }
    expect(strictPass({ ...strictManifestFixture(), counts: { ...strictManifestFixture().counts, forks: 1 } })).toBe(
      false,
    );
    const messages = (sessionID: string, ids: string[], texts: string[]) =>
      ids.map(
        (id, index) =>
          ({
            info: { id, sessionID, role: "user" },
            parts: [{ id: `${id}:part`, sessionID, messageID: id, type: "text", text: texts[index] }],
          }) as unknown as ChatMessageWithParts,
      );
    const parent = messages("p", ["p1", "p2"], ["A", "B"]);
    const full = messages("f", ["f1", "f2"], ["A", "B"]);
    const prefix = messages("a", ["a1"], ["A"]);
    expect(
      exactHistory(full, "f", [
        { role: "user", text: "A" },
        { role: "user", text: "B" },
      ]),
    ).toBe(true);
    expect(
      exactHistory(full, "wrong", [
        { role: "user", text: "A" },
        { role: "user", text: "B" },
      ]),
    ).toBe(false);
    expect(
      exactHistory(prefix, "a", [
        { role: "user", text: "A" },
        { role: "user", text: "B" },
      ]),
    ).toBe(false);
    expect(reminted(full, parent)).toBe(true);
    expect(reminted(messages("f", ["p1", "p1"], ["A", "B"]), parent)).toBe(false);
    expect(reminted(messages("f", ["x1", "x2"], ["A", "B"]), [messages("x", ["x1"], ["A"])[0]!])).toBe(false);
    const malformedParts = structuredClone(full);
    malformedParts[0]!.parts[0]!.messageID = "foreign-message";
    expect(reminted(malformedParts, parent)).toBe(false);
    const foreignPartSession = structuredClone(full);
    foreignPartSession[0]!.parts[0]!.sessionID = "foreign-session";
    expect(reminted(foreignPartSession, parent)).toBe(false);
    expect(reminted(messages("f", ["", "f2"], ["A", "B"]), parent)).toBe(false);
    expect(reminted(messages("f", ["f1", "f1"], ["A", "B"]), parent)).toBe(false);
    expect(reminted(parent)).toBe(true);
    let operationCounts = { sessions: 0, forks: 0 };
    operationCounts = operationAttemptsAllowed(operationCounts, "create")!;
    operationCounts = operationAttemptsAllowed(operationCounts, "fork")!;
    operationCounts = operationAttemptsAllowed(operationCounts, "fork")!;
    operationCounts = operationAttemptsAllowed(operationCounts, "create")!;
    expect(operationCounts).toEqual({ sessions: 4, forks: 2 });
    expect(operationAttemptsAllowed(operationCounts, "fork")).toBeUndefined();
    expect(operationAttemptsAllowed(operationCounts, "create")).toBeUndefined();
    expect(
      exactForkRequests(
        [
          { source: "p", beforePresent: false },
          { source: "p", beforePresent: true, before: "u2" },
        ],
        "p",
        "u2",
      ),
    ).toBe(true);
    expect(
      exactForkRequests(
        [
          { source: "p", beforePresent: true, before: undefined },
          { source: "p", beforePresent: true, before: "wrong" },
        ],
        "p",
        "u2",
      ),
    ).toBe(false);
    const completedRecord = {
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "safe fixture summary",
      model: { providerID: "fixture-provider", id: "fixture-model" },
    };
    expect(
      compactionRecordMatches(completedRecord, "fork", "fork", "safe fixture summary", "fixture-model", true),
    ).toBe(true);
    for (const invalid of [
      { ...completedRecord, model: { providerID: "fixture-provider", id: "wrong-model" } },
      { ...completedRecord, summary: "wrong summary" },
      { ...completedRecord, status: "running" },
      { ...completedRecord, status: "failed" },
      { ...completedRecord, model: undefined },
      { ...completedRecord, reason: "auto" },
    ]) {
      expect(compactionRecordMatches(invalid, "fork", "fork", "safe fixture summary", "fixture-model", true)).toBe(
        false,
      );
    }
    expect(
      compactionRecordMatches(completedRecord, "foreign-query", "fork", "safe fixture summary", "fixture-model", true),
    ).toBe(false);
    expect(
      compactionRecordMatches(completedRecord, "fork", "fork", "safe fixture summary", "fixture-model", false),
    ).toBe(false);
    expect(sessionIDFromRoute("/api/session/anchored%20fork/model")).toBe("anchored fork");
    expect(sessionIDFromRoute("/api/session/anchored%20fork/switch")).toBeUndefined();
    expect(
      switchModelRequestMatches(
        { model: { providerID: "fixture-provider", id: "fixture-summary-model" } },
        "anchored",
        "anchored",
      ),
    ).toBe(true);
    expect(
      switchModelRequestMatches(
        { model: { providerID: "fixture-provider", id: "wrong-model" } },
        "anchored",
        "anchored",
      ),
    ).toBe(false);
    expect(
      switchModelRequestMatches(
        { model: { providerID: "fixture-provider", id: "fixture-summary-model" } },
        "anchored",
        "wrong-session",
      ),
    ).toBe(false);
  });

  it("runs two native forks through the isolated production agent", { skip: !enabled, timeout: 105_000 }, async () => {
    const forkProcess = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof forkProcess.send === "function" && forkProcess.connected === true;
    const root = await realpath(rootPath);
    const base = resolve(root, "tmp/scribe-v2-migration/session-fork");
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
    let observedVersion: string | null = null;
    let apiRequests = 0;
    let modelRequests = 0;
    let sessions = 0;
    let forkCount = 0;
    let prompts = 0;
    let sessionAttempts = 0;
    let forkAttempts = 0;
    let promptAttempts = 0;
    let compactAttempts = 0;
    let modelSwitchAttempts = 0;
    let summaryOperation = 0;
    let fixtureOrigin: string | undefined;
    let ownedOrigin: string | undefined;
    const forkRequests: ForkObservation[] = [];
    let summaryTargetID: string | undefined;
    const summaryRequests: Array<{
      kind: "compact" | "switch";
      operation: number;
      bodyModelAbsent: boolean;
      targetValid: boolean;
      modelValid: boolean;
    }> = [];
    const checks = Object.fromEntries(checkNames.map((name) => [name, false])) as Manifest["checks"];
    const manifest: Manifest = {
      schemaVersion: 1,
      runId,
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
      counts: {
        apiRequests: 0,
        modelRequests: 0,
        sessions: 0,
        forks: 0,
        prompts: 0,
        sessionAttempts: 0,
        forkAttempts: 0,
        promptAttempts: 0,
        compactAttempts: 0,
        modelSwitchAttempts: 0,
        children: 0,
      },
      checks,
      forkProvenance: { full: null, anchored: null },
      nativeHistory: {
        beforeComplete: false,
        beforeIDsValid: false,
        beforeTypesValid: false,
        beforeCount: 0,
        beforeLastType: null,
        afterComplete: false,
        afterIDsValid: false,
        afterTypesValid: false,
        afterCount: 0,
        afterLastType: null,
        orderedSnapshotUnchanged: false,
      },
      lifecycle: {
        initialChildren: 0,
        listedChildren: 0,
        listedSessionsBeforeDelete: 0,
        listedForksAfterParentDelete: 0,
        finalSessions: 0,
        deletedLookupApiDelta: 0,
        seededChildLocationValid: false,
        childParentRelationValid: false,
        childExcludedForks: false,
        forksSurvivedParentDelete: false,
        defaultSummaryCompleted: false,
        explicitSummaryCompleted: false,
        defaultCompactBodyOmitsModel: false,
        explicitCompactBodyOmitsModel: false,
        explicitSwitchPrecedesCompact: false,
        defaultNoModelSwitch: false,
      },
      summaries: {
        defaultComplete: false,
        defaultSummaryMatch: false,
        defaultModelMatch: false,
        defaultBusyIdle: false,
        explicitComplete: false,
        explicitSummaryMatch: false,
        explicitModelMatch: false,
        explicitBusyIdle: false,
        defaultCompactBodyOmitsModel: false,
        explicitCompactBodyOmitsModel: false,
        defaultCompactTargetValid: false,
        explicitCompactTargetValid: false,
        explicitSwitchTargetValid: false,
        explicitSwitchModelValid: false,
        explicitSwitchPrecedesCompact: false,
        defaultNoModelSwitch: false,
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
    const overall = new AbortController();
    let activeStage: Stage = "preflight";
    const setStage = (stage: Stage) => {
      activeStage = stage;
      manifest.stage = stage;
    };
    const fail = (code: FailureCode) => {
      manifest.failureCode ??= code;
      manifest.failureStage ??= activeStage;
      manifest.status = "FAIL";
      overall.abort(new Error(code));
    };
    const timer = setTimeout(() => fail("overall_deadline"), bounds.overallMs);
    const busyIdleEvents = new Map<string, { busy: boolean; idle: boolean }>();
    promptEvents.length = 0;
    try {
      await persist();
      checks.dedicatedFork = dedicatedFork;
      if (!dedicatedFork) throw Object.assign(new Error(), { code: "dedicated_fork_required" });
      if (!executable || !isAbsolute(executable))
        throw Object.assign(new Error(), { code: "explicit_executable_required" });
      const metadata = JSON.parse(
        await readFile(resolve(root, "packages/agents/opencode/node_modules/@opencode/client/package.json"), "utf8"),
      ) as Record<string, unknown>;
      checks.clientMetadataPinned = metadata.name === "@opencode/client" && metadata.version === "2.1.0";
      manifest.clientPackage =
        typeof metadata.name === "string" && typeof metadata.version === "string"
          ? `${metadata.name}@${metadata.version}`
          : null;
      if (!checks.clientMetadataPinned) throw Object.assign(new Error(), { code: "client_metadata_mismatch" });
      const binary = await readFile(executable).catch(() => undefined);
      if (!binary) throw Object.assign(new Error(), { code: "executable_unavailable" });
      manifest.executableSha256 = createHash("sha256").update(binary).digest("hex");
      checks.executableHashPinned = manifest.executableSha256 === executableHash;
      if (!checks.executableHashPinned) throw Object.assign(new Error(), { code: "executable_hash_mismatch" });
      isolation = await createV2TestIsolation(runRoot);
      manifest.fixtureRoot = relative(root, isolation.root);
      manifest.statePath = relative(root, isolation.paths.state);
      manifest.databasePath = relative(root, isolation.paths.database);
      checks.projectLocalIsolation = true;
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      checks.ambientGateClear =
        evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, await inspectAmbientConfigSources())
          .status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.ambientGateClear) throw Object.assign(new Error(), { code: "ambient_gate_blocked" });

      fixture = createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          fail("unexpected_mock_route");
          response.writeHead(404).end();
          return;
        }
        modelRequests += 1;
        if (
          modelRequests > bounds.modelRequests ||
          (modelRequests <= 2 && promptAttempts < modelRequests) ||
          (modelRequests > 2 && (summaryOperation === 0 || modelRequests !== summaryOperation + 2))
        ) {
          fail("unexpected_model_request_order");
          response.writeHead(409).end();
          return;
        }
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > bounds.modelBodyBytes) {
            fail("model_body_limit");
            response.writeHead(413).end();
            return;
          }
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          fail("invalid_model_body");
          response.writeHead(400).end();
          return;
        }
        const wanted = modelRequests <= 2 ? answers[modelRequests - 1] : summaryAnswers[modelRequests - 3];
        const expectedModel = modelRequests === 4 ? "fixture-summary-model" : "fixture-model";
        if (
          !wanted ||
          !record(parsed) ||
          parsed.model !== expectedModel ||
          !Array.isArray(parsed.messages) ||
          (modelRequests <= 2 &&
            !parsed.messages.some(
              (item) =>
                record(item) && item.role === "user" && textContent(item.content) === controls[modelRequests - 1],
            )) ||
          (modelRequests > 2 &&
            !parsed.messages.some(
              (item) => record(item) && item.role === "user" && textContent(item.content).includes(controls[0]),
            ))
        ) {
          fail("model_prompt_mismatch");
          response.writeHead(409).end();
          return;
        }
        response
          .writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
          .end(sse(wanted, expectedModel));
      });
      const fixturePort = await listen(fixture);
      fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
      const fixtureConfig = config(fixturePort);
      await writeFile(join(isolation.paths.config, "opencode", "opencode.json"), JSON.stringify(fixtureConfig), {
        mode: 0o600,
      });

      const nativeFetch = originalFetch.bind(globalThis);
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const requestSignal = input instanceof Request ? input.signal : undefined;
        const signals = [
          overall.signal,
          AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          ...(requestSignal ? [requestSignal] : []),
          ...(init?.signal ? [init.signal] : []),
        ];
        if (url.pathname.startsWith("/api/")) {
          apiRequests += 1;
          if (apiRequests > bounds.apiRequests) {
            fail("api_request_limit");
            throw new Error("api_request_limit");
          }
          if (!ownedOrigin) {
            if (url.pathname !== "/api/info" || url.hostname !== "127.0.0.1") {
              fail("first_api_not_owned_info");
              throw new Error("first_api_not_owned_info");
            }
            ownedOrigin = url.origin;
          }
          if (url.hostname !== "127.0.0.1" || url.origin !== ownedOrigin) {
            fail("foreign_api_origin");
            throw new Error("foreign_api_origin");
          }
          const createSession = method === "POST" && /\/api\/session$/.test(url.pathname);
          const forkSession = method === "POST" && /\/api\/session\/[^/]+\/fork$/.test(url.pathname);
          const promptSession = method === "POST" && /\/api\/session\/[^/]+\/prompt$/.test(url.pathname);
          const compactSession = method === "POST" && /\/api\/session\/[^/]+\/compact$/.test(url.pathname);
          const switchSession = method === "POST" && /\/api\/session\/[^/]+\/model$/.test(url.pathname);
          if (compactSession || switchSession) {
            const raw = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
            const observedSessionID = sessionIDFromRoute(url.pathname);
            if (compactSession) {
              compactAttempts += 1;
              const targetValid = Boolean(summaryTargetID && observedSessionID === summaryTargetID);
              const bodyModelAbsent = !record(raw) || !Object.hasOwn(raw, "model");
              if (
                compactAttempts > bounds.compacts ||
                summaryOperation === 0 ||
                compactAttempts !== summaryOperation ||
                !targetValid ||
                !bodyModelAbsent
              ) {
                fail("unexpected_compaction_request");
                throw new Error("unexpected_compaction_request");
              }
              summaryRequests.push({
                kind: "compact",
                operation: summaryOperation,
                bodyModelAbsent,
                targetValid,
                modelValid: true,
              });
            } else {
              modelSwitchAttempts += 1;
              const targetValid = Boolean(summaryTargetID && observedSessionID === summaryTargetID);
              const modelValid = Boolean(
                raw && switchModelRequestMatches(raw, summaryTargetID ?? "", observedSessionID ?? ""),
              );
              if (modelSwitchAttempts > bounds.modelSwitches || summaryOperation !== 2 || !targetValid || !modelValid) {
                fail("unexpected_compaction_request");
                throw new Error("unexpected_compaction_request");
              }
              summaryRequests.push({
                kind: "switch",
                operation: summaryOperation,
                bodyModelAbsent: false,
                targetValid,
                modelValid,
              });
            }
          }
          if (createSession || forkSession) {
            const next = operationAttemptsAllowed(
              { sessions: sessionAttempts, forks: forkAttempts },
              createSession ? "create" : "fork",
            );
            if (!next) {
              fail("session_operation_limit");
              throw new Error("session_operation_limit");
            }
            sessionAttempts = next.sessions;
            forkAttempts = next.forks;
          }
          if (promptSession) {
            if (summaryOperation !== 0) {
              fail("unexpected_model_request_order");
              throw new Error("unexpected_model_request_order");
            }
            promptAttempts += 1;
            if (promptAttempts > bounds.prompts) {
              fail("prompt_operation_limit");
              throw new Error("prompt_operation_limit");
            }
          }
          if (forkSession) {
            const raw =
              typeof init?.body === "string"
                ? (JSON.parse(init.body) as unknown)
                : input instanceof Request
                  ? await input
                      .clone()
                      .json()
                      .catch(() => undefined)
                  : undefined;
            const parts = url.pathname.split("/");
            let source = "";
            try {
              source = decodeURIComponent(parts[3] ?? "");
            } catch {
              fail("malformed_fork_path");
            }
            forkRequests.push({
              source,
              before: record(raw) && typeof raw.before === "string" ? raw.before : undefined,
              beforePresent: record(raw) && Object.hasOwn(raw, "before"),
            });
          }
        } else if (
          !fixtureOrigin ||
          url.origin !== fixtureOrigin ||
          url.pathname !== "/v1/chat/completions" ||
          method !== "POST"
        ) {
          fail("unexpected_nonowned_request");
          throw new Error("unexpected_nonowned_request");
        }
        const response = await nativeFetch(input, { ...init, signal: AbortSignal.any(signals) });
        if (response.ok && method === "POST" && /\/api\/session$/.test(url.pathname)) sessions += 1;
        if (response.ok && method === "POST" && /\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) prompts += 1;
        if (response.ok && method === "POST" && /\/api\/session\/[^/]+\/fork$/.test(url.pathname)) {
          forkCount += 1;
          sessions += 1;
        }
        if (url.pathname === "/api/info" && response.ok) {
          const info: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          if (record(info)) {
            observedVersion = typeof info.version === "string" ? info.version : null;
            ownedPID = typeof info.pid === "number" ? info.pid : undefined;
            manifest.observedVersion = observedVersion;
            manifest.ownedPID = ownedPID ?? null;
          }
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
      setStage("connect");
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
      agent.onEvent((event: AgentEvent) => {
        if (event.type !== "session.status") return;
        const current = busyIdleEvents.get(event.properties.sessionID) ?? { busy: false, idle: false };
        if (event.properties.status.type === "busy") current.busy = true;
        if (event.properties.status.type === "idle" && current.busy) current.idle = true;
        busyIdleEvents.set(event.properties.sessionID, current);
        const item = [...promptEvents].reverse().find((entry) => entry.sessionID === event.properties.sessionID);
        if (item) {
          item.busy ||= current.busy;
          item.idle ||= current.idle;
        }
      });
      await agent.connect();
      setStage("session_setup");
      const parent = await agent.createSession("native fork fixture");
      if (parent.directory !== isolation.paths.cwd) throw new Error("session_location_mismatch");
      const parentBaseline = await agent.getMessages(parent.id);
      const histories: ChatMessageWithParts[][] = [];
      for (let index = 0; index < controls.length; index += 1) {
        setStage("prompt");
        if (index === 1 && prompts !== 1) throw new Error("second_prompt_gate_not_satisfied");
        busyIdleEvents.set(parent.id, { busy: false, idle: false });
        promptEvents.push({ sessionID: parent.id, busy: false, idle: false });
        await agent.sendMessage(parent.id, controls[index], { primaryAgent: "scout" });
        setStage("history");
        const expected = controls.slice(0, index + 1).flatMap((control, position) => [
          { role: "user", text: control },
          { role: "assistant", text: answers[position] },
        ]);
        const history = await readyHistory(agent, parent.id, expected, deadline, overall.signal);
        histories.push(history);
        if (index === 0 && (prompts !== 1 || modelRequests !== 1))
          throw new Error("first_prompt_request_count_mismatch");
        if (index === 1 && (prompts !== 2 || modelRequests !== 2))
          throw new Error("second_prompt_request_count_mismatch");
      }
      const parentBeforeForks = await agent.getMessages(parent.id);
      checks.parentHistoryCompletedExactly =
        exactHistory(
          parentBeforeForks,
          parent.id,
          controls.flatMap((control, index) => [
            { role: "user", text: control },
            { role: "assistant", text: answers[index] },
          ]),
        ) && reminted(parentBeforeForks);
      const anchor = parentBeforeForks.find(
        (message) =>
          message.info.role === "user" &&
          message.parts.some((part) => part.type === "text" && part.text === controls[1]),
      )?.info.id;
      if (!anchor) throw new Error("second_user_anchor_missing");
      const native = (agent as unknown as { v2Client?: OpenCodeClient }).v2Client;
      if (!native) throw new Error("native_history_contract_mismatch");
      const nativeBefore = await readNativeHistory(native, parent.id);
      const throughBoundaryID = nativeBefore.records.at(-1)?.id;
      manifest.nativeHistory = {
        beforeComplete: nativeBefore.complete,
        beforeIDsValid: nativeBefore.idsValid,
        beforeTypesValid: nativeBefore.typesValid,
        beforeCount: nativeBefore.records.length,
        beforeLastType: nativeBefore.lastType,
        afterComplete: false,
        afterIDsValid: false,
        afterTypesValid: false,
        afterCount: 0,
        afterLastType: null,
        orderedSnapshotUnchanged: false,
      };
      if (
        !nativeBefore.complete ||
        !nativeBefore.idsValid ||
        !nativeBefore.typesValid ||
        nativeBefore.lastType !== "idle" ||
        !throughBoundaryID
      ) {
        throw new Error("native_history_contract_mismatch");
      }
      setStage("fork");
      const fullFork = await agent.forkSession(parent.id);
      const fullHistory = await agent.getMessages(fullFork.id);
      const anchoredFork = await agent.forkSession(parent.id, anchor);
      const anchoredHistory = await agent.getMessages(anchoredFork.id);
      const parentAfterForks = await agent.getMessages(parent.id);
      const nativeAfter = await readNativeHistory(native, parent.id);
      const nativeStable = nativeHistorySnapshotsMatch(nativeBefore, nativeAfter);
      manifest.nativeHistory = {
        beforeComplete: nativeBefore.complete,
        beforeIDsValid: nativeBefore.idsValid,
        beforeTypesValid: nativeBefore.typesValid,
        beforeCount: nativeBefore.records.length,
        beforeLastType: nativeBefore.lastType,
        afterComplete: nativeAfter.complete,
        afterIDsValid: nativeAfter.idsValid,
        afterTypesValid: nativeAfter.typesValid,
        afterCount: nativeAfter.records.length,
        afterLastType: nativeAfter.lastType,
        orderedSnapshotUnchanged: nativeStable,
      };
      const forkIDs = new Set([fullFork.id, anchoredFork.id]);
      checks.fullForkContentAndIdentity =
        fullFork.id !== parent.id &&
        fullFork.id !== anchoredFork.id &&
        fullFork.directory === isolation.paths.cwd &&
        exactHistory(
          fullHistory,
          fullFork.id,
          controls.flatMap((control, index) => [
            { role: "user", text: control },
            { role: "assistant", text: answers[index] },
          ]),
        ) &&
        reminted(fullHistory, parentBeforeForks, anchoredHistory);
      checks.anchoredForkPrefixAndIdentity =
        anchoredFork.id !== parent.id &&
        anchoredFork.id !== fullFork.id &&
        anchoredFork.directory === isolation.paths.cwd &&
        fullFork.parentID === undefined &&
        anchoredFork.parentID === undefined &&
        !forkIDs.has(parent.id) &&
        exactHistory(anchoredHistory, anchoredFork.id, [
          { role: "user", text: controls[0] },
          { role: "assistant", text: answers[0] },
        ]) &&
        reminted(anchoredHistory, parentBeforeForks, fullHistory);
      const fullNative = native ? await native.session.get({ sessionID: fullFork.id }) : undefined;
      const anchoredNative = native ? await native.session.get({ sessionID: anchoredFork.id }) : undefined;
      manifest.forkProvenance = {
        full: diagnoseForkProvenance(fullNative, fullFork.id, parent.id, throughBoundaryID),
        anchored: diagnoseForkProvenance(anchoredNative, anchoredFork.id, parent.id, anchor),
      };
      checks.nativeForkProvenance =
        provenanceDiagnosticPass(manifest.forkProvenance.full, "through") &&
        provenanceDiagnosticPass(manifest.forkProvenance.anchored, "before");
      checks.nativeHistoryStable = nativeStable;
      checks.forkRequestShapesExact = exactForkRequests(forkRequests, parent.id, anchor) && forkCount === 2;
      checks.parentHistoryUnchanged =
        exactHistory(
          parentAfterForks,
          parent.id,
          controls.flatMap((control, index) => [
            { role: "user", text: control },
            { role: "assistant", text: answers[index] },
          ]),
        ) && JSON.stringify(historySignature(parentBeforeForks)) === JSON.stringify(historySignature(parentAfterForks));
      setStage("lifecycle");
      const connectedAgent = agent;
      if (!connectedAgent) throw new Error("session_lifecycle_assertion_failed");
      const initialChildren = await connectedAgent.getChildSessions(parent.id);
      checks.realChildInitiallyAbsent = exactSessionSet(initialChildren, []);
      if (!checks.realChildInitiallyAbsent) throw new Error("session_lifecycle_assertion_failed");
      const childTitle = "native real child fixture";
      const seededChild = await native.session.create({
        parentID: parent.id,
        title: childTitle,
        location: { directory: isolation.paths.cwd },
      });
      const seededChildID = record(seededChild) && typeof seededChild.id === "string" ? seededChild.id : "";
      const seededChildInfo = await native.session.get({ sessionID: seededChildID });
      const childMapped = await connectedAgent.getSession(seededChildID);
      manifest.lifecycle.seededChildLocationValid =
        record(seededChild) &&
        seededChild.location?.directory === isolation.paths.cwd &&
        record(seededChildInfo) &&
        seededChildInfo.parentID === parent.id &&
        childMapped.directory === isolation.paths.cwd;
      manifest.lifecycle.childParentRelationValid = realChildRelation(childMapped, parent.id, isolation.paths.cwd);
      const listedChildren = await connectedAgent.getChildSessions(parent.id);
      const forkIDsArray = [fullFork.id, anchoredFork.id];
      manifest.lifecycle.initialChildren = initialChildren.length;
      manifest.lifecycle.listedChildren = listedChildren.length;
      manifest.lifecycle.childExcludedForks =
        exactSessionSet(listedChildren, [seededChildID]) &&
        forkIDsArray.every((id) => !listedChildren.some((item) => item.id === id));
      checks.realChildSeedValid =
        manifest.lifecycle.seededChildLocationValid && manifest.lifecycle.childParentRelationValid;
      checks.realChildListedExactly = manifest.lifecycle.childExcludedForks;
      const beforeDeleteSessions = await connectedAgent.listSessions();
      const ownedIDs = [parent.id, fullFork.id, anchoredFork.id, seededChildID];
      manifest.lifecycle.listedSessionsBeforeDelete = beforeDeleteSessions.length;
      checks.ownedSessionListExact = exactSessionSet(beforeDeleteSessions, ownedIDs);
      if (!checks.realChildSeedValid || !checks.realChildListedExactly || !checks.ownedSessionListExact)
        throw new Error("session_lifecycle_assertion_failed");

      await connectedAgent.deleteSession(seededChildID);
      const childrenAfterChildDelete = await connectedAgent.getChildSessions(parent.id);
      checks.realChildTombstoned = exactSessionSet(childrenAfterChildDelete, []);
      const apiBeforeChildTombstoneLookups = apiRequests;
      const deletedChildLookups: boolean[] = [];
      for (const lookup of [
        () => connectedAgent.getSession(seededChildID),
        () => connectedAgent.getMessages(seededChildID),
      ]) {
        try {
          await lookup();
          deletedChildLookups.push(false);
        } catch {
          deletedChildLookups.push(true);
        }
      }
      const childLookupApiDelta = apiRequests - apiBeforeChildTombstoneLookups;
      await connectedAgent.deleteSession(parent.id);
      checks.parentTombstoned = true;
      const apiBeforeParentTombstoneLookups = apiRequests;
      const deletedParentLookups: boolean[] = [];
      for (const lookup of [() => connectedAgent.getSession(parent.id), () => connectedAgent.getMessages(parent.id)]) {
        try {
          await lookup();
          deletedParentLookups.push(false);
        } catch {
          deletedParentLookups.push(true);
        }
      }
      const tombstoneLookups = [...deletedChildLookups, ...deletedParentLookups];
      const parentLookupApiDelta = apiRequests - apiBeforeParentTombstoneLookups;
      manifest.lifecycle.deletedLookupApiDelta = childLookupApiDelta + parentLookupApiDelta;
      checks.deletedLookupsNoApi = noApiForDeletedLookups(
        [childLookupApiDelta, parentLookupApiDelta],
        tombstoneLookups,
      );
      const forksAfterParentDelete = await connectedAgent.listSessions();
      manifest.lifecycle.listedForksAfterParentDelete = forksAfterParentDelete.length;
      checks.forksRemainAfterParentDelete = exactSessionSet(forksAfterParentDelete, forkIDsArray);
      const fullHistoryAfterDelete = await connectedAgent.getMessages(fullFork.id);
      const anchoredHistoryAfterDelete = await connectedAgent.getMessages(anchoredFork.id);
      manifest.lifecycle.forksSurvivedParentDelete =
        JSON.stringify(historySignature(fullHistoryAfterDelete)) === JSON.stringify(historySignature(fullHistory)) &&
        JSON.stringify(historySignature(anchoredHistoryAfterDelete)) ===
          JSON.stringify(historySignature(anchoredHistory));
      if (!checks.forksRemainAfterParentDelete || !manifest.lifecycle.forksSurvivedParentDelete)
        throw new Error("session_lifecycle_assertion_failed");

      setStage("default_summary");
      summaryOperation = 1;
      summaryTargetID = fullFork.id;
      busyIdleEvents.set(fullFork.id, { busy: false, idle: false });
      await connectedAgent.summarizeSession(fullFork.id);
      const defaultResult = await completedCompaction(
        native,
        fullFork.id,
        fullFork.id,
        summaryAnswers[0],
        "fixture-model",
        () => {
          const state = busyIdleEvents.get(fullFork.id);
          return Boolean(state?.busy && state.idle);
        },
        deadline,
        overall.signal,
      );
      manifest.summaries.defaultComplete = defaultResult.complete;
      manifest.summaries.defaultSummaryMatch = defaultResult.summaryMatch;
      manifest.summaries.defaultModelMatch = defaultResult.modelMatch;
      manifest.summaries.defaultBusyIdle = defaultResult.busyIdle;
      manifest.summaries.defaultCompactBodyOmitsModel = summaryRequests.some(
        (item) => item.kind === "compact" && item.operation === 1 && item.bodyModelAbsent,
      );
      manifest.summaries.defaultCompactTargetValid = summaryRequests.some(
        (item) => item.kind === "compact" && item.operation === 1 && item.targetValid,
      );
      manifest.summaries.defaultNoModelSwitch = !summaryRequests.some(
        (item) => item.kind === "switch" && item.operation === 1,
      );
      manifest.lifecycle.defaultSummaryCompleted =
        defaultResult.complete && defaultResult.summaryMatch && defaultResult.modelMatch && defaultResult.busyIdle;
      manifest.lifecycle.defaultCompactBodyOmitsModel = manifest.summaries.defaultCompactBodyOmitsModel;
      manifest.lifecycle.defaultNoModelSwitch = manifest.summaries.defaultNoModelSwitch;
      checks.defaultSummaryCompacted =
        manifest.lifecycle.defaultSummaryCompleted &&
        manifest.lifecycle.defaultCompactBodyOmitsModel &&
        manifest.lifecycle.defaultNoModelSwitch;
      checks.defaultSummaryCompacted &&= manifest.summaries.defaultCompactTargetValid;
      if (!checks.defaultSummaryCompacted) throw new Error("session_lifecycle_assertion_failed");

      setStage("explicit_summary");
      summaryOperation = 2;
      summaryTargetID = anchoredFork.id;
      busyIdleEvents.set(anchoredFork.id, { busy: false, idle: false });
      await connectedAgent.summarizeSession(anchoredFork.id, {
        providerID: "fixture-provider",
        modelID: "fixture-summary-model",
      });
      const explicitResult = await completedCompaction(
        native,
        anchoredFork.id,
        anchoredFork.id,
        summaryAnswers[1],
        "fixture-summary-model",
        () => {
          const state = busyIdleEvents.get(anchoredFork.id);
          return Boolean(state?.busy && state.idle);
        },
        deadline,
        overall.signal,
      );
      manifest.summaries.explicitComplete = explicitResult.complete;
      manifest.summaries.explicitSummaryMatch = explicitResult.summaryMatch;
      manifest.summaries.explicitModelMatch = explicitResult.modelMatch;
      manifest.summaries.explicitBusyIdle = explicitResult.busyIdle;
      manifest.summaries.explicitCompactBodyOmitsModel = summaryRequests.some(
        (item) => item.kind === "compact" && item.operation === 2 && item.bodyModelAbsent,
      );
      manifest.summaries.explicitCompactTargetValid = summaryRequests.some(
        (item) => item.kind === "compact" && item.operation === 2 && item.targetValid,
      );
      manifest.summaries.explicitSwitchTargetValid = summaryRequests.some(
        (item) => item.kind === "switch" && item.operation === 2 && item.targetValid,
      );
      manifest.summaries.explicitSwitchModelValid = summaryRequests.some(
        (item) => item.kind === "switch" && item.operation === 2 && item.modelValid,
      );
      const explicitSwitch = summaryRequests.findIndex((item) => item.kind === "switch" && item.operation === 2);
      const explicitCompact = summaryRequests.findIndex((item) => item.kind === "compact" && item.operation === 2);
      manifest.summaries.explicitSwitchPrecedesCompact = explicitSwitch >= 0 && explicitCompact > explicitSwitch;
      manifest.lifecycle.explicitSummaryCompleted =
        explicitResult.complete && explicitResult.summaryMatch && explicitResult.modelMatch && explicitResult.busyIdle;
      manifest.lifecycle.explicitCompactBodyOmitsModel = manifest.summaries.explicitCompactBodyOmitsModel;
      manifest.lifecycle.explicitSwitchPrecedesCompact = manifest.summaries.explicitSwitchPrecedesCompact;
      checks.explicitSummaryCompacted =
        manifest.lifecycle.explicitSummaryCompleted &&
        manifest.lifecycle.explicitCompactBodyOmitsModel &&
        manifest.lifecycle.explicitSwitchPrecedesCompact &&
        manifest.summaries.explicitCompactTargetValid &&
        manifest.summaries.explicitSwitchTargetValid &&
        manifest.summaries.explicitSwitchModelValid;
      if (!checks.explicitSummaryCompacted) throw new Error("session_lifecycle_assertion_failed");
      const forkDeleteResults = await Promise.all(
        forkIDsArray.map(async (id) => {
          try {
            await connectedAgent.deleteSession(id);
            return true;
          } catch {
            return false;
          }
        }),
      );
      checks.forksDeleted = manifest.lifecycle.forksSurvivedParentDelete && forkDeleteResults.every(Boolean);
      const finalSessions = await connectedAgent.listSessions();
      manifest.lifecycle.finalSessions = finalSessions.length;
      checks.finalOwnedListEmpty = exactSessionSet(finalSessions, []);
      if (
        !checks.realChildTombstoned ||
        !checks.parentTombstoned ||
        !checks.deletedLookupsNoApi ||
        !checks.forksRemainAfterParentDelete ||
        !checks.forksDeleted ||
        !checks.finalOwnedListEmpty
      )
        throw new Error("session_lifecycle_assertion_failed");
      checks.privateChildVersionAndPID =
        observedVersion === version && ownedPID !== undefined && ownedOrigin !== undefined;
      checks.nativeConfigIsSafe =
        fixtureConfig.enabledProviders.length === 1 &&
        fixtureConfig.plugins.length === 0 &&
        Object.keys(fixtureConfig.mcp).length === 0 &&
        Object.keys(fixtureConfig.providers).length === 1;
      checks.noAdditionalModelRequests =
        modelRequests === 4 && prompts === 2 && compactAttempts === 2 && modelSwitchAttempts === 1;
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions,
        forks: forkCount,
        prompts,
        sessionAttempts,
        forkAttempts,
        promptAttempts,
        compactAttempts,
        modelSwitchAttempts,
        children: ownedPID ? 1 : 0,
      };
      checks.requestBounds =
        Date.now() - started <= bounds.overallMs &&
        apiRequests <= bounds.apiRequests &&
        modelRequests === 4 &&
        compactAttempts === 2 &&
        modelSwitchAttempts === 1 &&
        sessions === bounds.sessions &&
        forkCount === bounds.forks &&
        prompts === bounds.prompts &&
        ownedPID !== undefined;
      manifest.status = checkNames.every((key) => checks[key]) ? "RUNNING" : "FAIL";
      if (manifest.status === "FAIL") manifest.failureCode = "fork_history_assertion_failed";
    } catch (error) {
      const code = record(error)
        ? typeof error.code === "string"
          ? error.code
          : error instanceof Error
            ? error.message
            : undefined
        : error instanceof Error
          ? error.message
          : undefined;
      const blockedCodes: FailureCode[] = [
        "dedicated_fork_required",
        "explicit_executable_required",
        "client_metadata_mismatch",
        "executable_unavailable",
        "executable_hash_mismatch",
        "ambient_gate_blocked",
        "spawn_gate_blocked",
      ];
      const knownCode = failureCodes.find((candidate) => candidate === code);
      manifest.failureCode ??= knownCode ?? "fixture_operation_failed";
      manifest.failureStage ??= activeStage;
      manifest.status = blockedCodes.some((candidate) => candidate === manifest.failureCode) ? "BLOCKED" : "FAIL";
    } finally {
      clearTimeout(timer);
      setStage("pre_teardown");
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions,
        forks: forkCount,
        prompts,
        sessionAttempts,
        forkAttempts,
        promptAttempts,
        compactAttempts,
        modelSwitchAttempts,
        children: ownedPID ? 1 : 0,
      };
      manifest.preTeardown = {
        status: manifest.status,
        checks: { ...checks },
        counts: { ...manifest.counts },
        forkProvenance: structuredClone(manifest.forkProvenance),
        nativeHistory: structuredClone(manifest.nativeHistory),
        lifecycle: structuredClone(manifest.lifecycle),
        summaries: structuredClone(manifest.summaries),
        ...(manifest.failureCode ? { failureCode: manifest.failureCode } : {}),
      };
      await persist().catch(() => {
        manifest.status = "FAIL";
        manifest.failureCode ??= "pre_teardown_persist_failed";
      });
      setStage("cleanup");
      if (agent) {
        try {
          agent.disconnect();
          await bounded(
            (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise ?? Promise.resolve(),
            5_000,
          );
          manifest.cleanup.agentDisconnected = true;
        } catch {
          manifest.cleanup.agentDisconnected = false;
        }
      }
      const processGroupGone = ownedPID ? await waitGroupGone(ownedPID, 2_000) : true;
      manifest.cleanup.processGroupReaped = ownedPID ? processGroupGone : false;
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
          fixtureClosed = false;
        }
      }
      manifest.cleanup.fixtureClosed = fixtureClosed;
      if (isolation) {
        if (processGroupGone) {
          try {
            await isolation.dispose();
            manifest.cleanup.isolationRemoved = await absent(isolation.root);
          } catch {
            manifest.cleanup.isolationRemoved = false;
          }
        } else {
          manifest.cleanup.isolationRemoved = false;
        }
        manifest.cleanup.stateAbsent = await absent(isolation.paths.state);
        manifest.cleanup.databaseAbsent = await absent(isolation.paths.database);
      } else {
        manifest.cleanup.isolationRemoved = false;
        manifest.cleanup.stateAbsent = false;
        manifest.cleanup.databaseAbsent = false;
      }
      if (environmentReplaced) {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, originalEnvironment);
      }
      manifest.cleanup.environmentRestored =
        Object.keys(process.env).length === Object.keys(originalEnvironment).length &&
        Object.entries(originalEnvironment).every(([key, value]) => process.env[key] === value);
      globalThis.fetch = originalFetch;
      manifest.cleanup.fetchRestored = globalThis.fetch === originalFetch;
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions,
        forks: forkCount,
        prompts,
        sessionAttempts,
        forkAttempts,
        promptAttempts,
        compactAttempts,
        modelSwitchAttempts,
        children: ownedPID ? 1 : 0,
      };
      if (
        manifest.status === "RUNNING" &&
        checkNames.every((key) => checks[key]) &&
        cleanupNames.every((key) => manifest.cleanup[key] === true)
      )
        manifest.status = "PASS";
      else if (manifest.status === "RUNNING") {
        manifest.status = "FAIL";
        manifest.failureCode ??= "cleanup_or_check_failed";
      }
      setStage("complete");
      await persist().catch(() => {
        manifest.status = "FAIL";
        manifest.failureCode ??= "final_persist_failed";
      });
      let saved = JSON.parse(await readFile(evidencePath, "utf8")) as unknown;
      if (manifest.status === "PASS" && !strictPass(saved)) {
        manifest.status = "FAIL";
        manifest.failureCode = "strict_manifest_readback_failed";
        await persist();
        saved = JSON.parse(await readFile(evidencePath, "utf8")) as unknown;
      }
      expect(strictPass(saved), JSON.stringify(saved)).toBe(true);
    }
  });
});
