import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, ChatMessageWithParts } from "@opencode-chat/core";
import { describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent.js";
import { RESTRICTED_REVIEW_PROMPT } from "../restricted-review-overlay.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

// Opt-in native effective-policy fixture. Native 2.2.0 facts it relies on (core/src at the pinned release commit):
// - tool.ts Tool.snapshot: a tool is hidden when the last rule matching its action is a resource-"*" deny;
//   read/glob/grep/webfetch/websearch/question/edit/subagent are direct (`codemode: false`). `write` (write.ts:59) and
//   `patch` (patch.ts:81) are also `codemode: false` but governed by the `edit` permission (write.ts:78-79 asserts
//   action `edit`), so Write, which holds `edit`, advertises `write` directly. `shell` and `skill` are direct too
//   (`codemode: false`) and expected to be hidden by deny; skill execution additionally asserts action `skill` on its ID.
//   `execute` exists unless wholly denied.
// - config/plugin/agent.ts: global `permissions` are pushed first, agent-level `permissions` last (last match wins).
// - tool/plugin/subagent.ts: the tool is `subagent`, asserting action `subagent` on the target agent ID.
const enabled = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const rootPath = fileURLToPath(new URL("../../../../../", import.meta.url));
const version = "2.2.0";
const executablePath = "/opt/homebrew/Cellar/opencode-v2/2.2.0/bin/opencode";
const executableHash = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const evidencePrefix = "tmp/scribe-v2-migration/effective-policy/";
const expectedModelRequests = 16;
const expectedApiSessions = 4;
const expectedPrompts = 3;
const expectedGenerates = 1;
const bounds = {
  overallMs: 120_000,
  apiRequests: 150,
  modelRequests: 16,
  sessions: 5,
  children: 1,
  modelBodyBytes: 512 * 1024,
} as const;

const roles = ["scout", "worker", "write", "reviewer"] as const;
type Role = (typeof roles)[number];
const knownToolNames = [
  "execute",
  "read",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "question",
  "subagent",
  "edit",
  "write",
  "patch",
  "shell",
  "bash",
  "task",
  "todowrite",
  "skill",
] as const;
// Native 2.2.0's built-in browser plugin appends a scoped `skill:browser` deny after the configured
// rules, so `skill` stays advertised even though the wildcard `skill` deny blocks execution. Scout,
// the worker and Write therefore treat `skill` as visible-but-denied (proved by execution probes),
// while the hidden reviewers stay strictly tool-less.
const forbiddenBase = ["shell", "bash", "write", "patch", "task", "todowrite"];
const readDiscoveryWeb = ["read", "glob", "grep", "webfetch", "websearch"];
// Direct names derive from native 2.2.0 (see header). `write` is gated by the `edit` permission, so Write must
// advertise `edit` and `write`; Scout and the worker must advertise neither.
const writeForbidden = forbiddenBase.filter((name) => name !== "write");
const toolPolicy: Record<Role, { required: string[]; allowed: string[]; forbidden: string[] }> = {
  scout: {
    required: ["execute", "subagent", ...readDiscoveryWeb],
    allowed: ["execute", "subagent", "question", "skill", ...readDiscoveryWeb],
    forbidden: [...forbiddenBase, "edit"],
  },
  worker: {
    required: ["execute", ...readDiscoveryWeb],
    allowed: ["execute", "skill", ...readDiscoveryWeb],
    forbidden: [...forbiddenBase, "edit", "subagent"],
  },
  write: {
    required: ["execute", "edit", "write"],
    allowed: ["execute", "edit", "write", "skill", ...readDiscoveryWeb],
    forbidden: [...writeForbidden, "subagent"],
  },
  reviewer: { required: [], allowed: [], forbidden: [...forbiddenBase, "skill", "execute", "edit", "subagent"] },
};

const checkNames = [
  "dedicatedFork",
  "clientMetadataPinned",
  "executableHashPinned",
  "projectLocalIsolation",
  "ambientGateClear",
  "spawnGateClear",
  "privateChildVersionAndPID",
  "nativeConfigIsSafe",
  "inheritedPermissiveConfigWritten",
  "scoutToolsObserved",
  "scoutAdvertisesExecute",
  "scoutToolsMatchPolicy",
  "skillFixtureWritten",
  "scoutBashDenied",
  "scoutWriteDenied",
  "scoutSkillDenied",
  "scoutFixtureFileAbsent",
  "scoutShellDenied",
  "scoutShellMarkerAbsent",
  "scoutNestedShellDenied",
  "scoutNestedShellMarkerAbsent",
  "scoutSessionIdleClean",
  "scoutNoStaleSuccess",
  "delegationNonWorkerDenied",
  "delegationWorkerAllowed",
  "workerRequestIsSubagentChild",
  "workerToolsMatchPolicy",
  "workerSkillDenied",
  "delegationSessionIdle",
  "writeToolsMatchPolicy",
  "writeSkillDenied",
  "writeBashDenied",
  "writeShellDenied",
  "writeShellMarkerAbsent",
  "writeSessionIdleClean",
  "writeNoStaleSuccess",
  "reviewerRequestIdentified",
  "reviewerNoTools",
  "reviewerNoExecute",
  "skillSentinelNotDelivered",
  "modelRequestOrderExact",
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
const stages = [
  "preflight",
  "connect",
  "scout",
  "delegation",
  "write",
  "reviewer",
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
  "model_body_limit",
  "invalid_model_body",
  "api_request_limit",
  "first_api_not_owned_info",
  "foreign_api_origin",
  "unexpected_nonowned_request",
  "session_location_mismatch",
  "session_idle_timeout",
  "restricted_review_not_ready",
  "restricted_review_stage_failed",
  "policy_assertion_failed",
  "fixture_operation_failed",
  "cleanup_or_check_failed",
  "pre_teardown_persist_failed",
  "strict_manifest_readback_failed",
  "final_persist_failed",
] as const;
const blockedCodes: FailureCode[] = [
  "dedicated_fork_required",
  "explicit_executable_required",
  "client_metadata_mismatch",
  "executable_unavailable",
  "executable_hash_mismatch",
  "ambient_gate_blocked",
  "spawn_gate_blocked",
];
type Status = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
type Stage = (typeof stages)[number];
type FailureCode = (typeof failureCodes)[number];
type ResultOutcome = "denied" | "unavailable" | "completed" | "success" | "other" | "missing";
type ToolReport = { names: string[]; unknownCount: number };
type Counts = {
  apiRequests: number;
  modelRequests: number;
  sessions: number;
  prompts: number;
  generates: number;
  delegations: number;
  children: number;
  maxModelBodyBytes: number;
};
type Denials = {
  scoutBash: ResultOutcome;
  scoutWrite: ResultOutcome;
  scoutSkill: ResultOutcome;
  scoutShell: ResultOutcome;
  scoutNestedShell: ResultOutcome;
  delegationNonWorker: ResultOutcome;
  delegationWorker: ResultOutcome;
  workerSkill: ResultOutcome;
  writeBash: ResultOutcome;
  writeShell: ResultOutcome;
  writeSkill: ResultOutcome;
};
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
  sandboxMode: "off";
  executablePath: string | null;
  executableSha256: string | null;
  clientPackage: string | null;
  ownedPID: number | null;
  fixtureRoot: string | null;
  statePath: string | null;
  databasePath: string | null;
  evidencePath: string;
  bounds: typeof bounds;
  counts: Counts;
  checks: Record<(typeof checkNames)[number], boolean>;
  tools: Record<Role, ToolReport | null>;
  denials: Denials;
  cleanup: Record<(typeof cleanupNames)[number], boolean | null>;
  preTeardown?: {
    status: Status;
    checks: Manifest["checks"];
    counts: Counts;
    tools: Manifest["tools"];
    denials: Denials;
    failureCode?: FailureCode;
  };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => (record(part) && typeof part.text === "string" ? [part.text] : [])).join("\n");
}
/** Names advertised in a chat-completions or responses-style `tools` array; an absent field advertises nothing. */
function toolNamesFromBody(body: unknown): string[] {
  if (!record(body) || !Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => {
    if (!record(tool)) return [];
    if (record(tool.function) && typeof tool.function.name === "string") return [tool.function.name];
    return typeof tool.name === "string" ? [tool.name] : [];
  });
}
/** Reduces advertised names to a persistable report: only fixed known names, everything else is counted. */
function toolReport(names: string[]): ToolReport {
  const unique = [...new Set(names)];
  const known = (knownToolNames as readonly string[]).filter((name) => unique.includes(name));
  return { names: known, unknownCount: unique.filter((name) => !known.includes(name)).length };
}
function classifyToolReport(role: Role, report: ToolReport) {
  const policy = toolPolicy[role];
  const present = new Set(report.names);
  const requiredPresent = policy.required.every((name) => present.has(name));
  const noForbidden = !policy.forbidden.some((name) => present.has(name));
  const noUnexpected = report.unknownCount === 0 && report.names.every((name) => policy.allowed.includes(name));
  return { requiredPresent, noForbidden, noUnexpected, pass: requiredPresent && noForbidden && noUnexpected };
}
function validToolReport(value: unknown): value is ToolReport {
  return (
    record(value) &&
    Array.isArray(value.names) &&
    value.names.every((name) => typeof name === "string" && (knownToolNames as readonly string[]).includes(name)) &&
    new Set(value.names).size === value.names.length &&
    Number.isInteger(value.unknownCount) &&
    Number(value.unknownCount) >= 0
  );
}
function classifyResult(text: string | undefined): ResultOutcome {
  if (text === undefined) return "missing";
  if (text.includes("fixture worker complete")) return "completed";
  if (/(?:Wrote|Created) file successfully/u.test(text)) return "success";
  if (/No tool named|not available|unavailable/iu.test(text)) return "unavailable";
  if (/denied|rejected/iu.test(text)) return "denied";
  return "other";
}
/** A permission failure is distinct from a missing/hidden skill or a successful load. */
function classifySkillResult(text: string | undefined, sentinel: string): ResultOutcome {
  if (text === undefined) return "missing";
  if (text.includes(sentinel)) return "success";
  if (/Permission denied: skill\b/iu.test(text)) return "denied";
  if (/Unable to load skill scribe-fixture\b/iu.test(text)) return "unavailable";
  return classifyResult(text);
}
/** Nested `tools.shell` rejection inside `execute`: the code returns a classification per call (see code-mode fixture). */
function classifyNestedResult(text: string | undefined): ResultOutcome {
  if (text === undefined) return "missing";
  const found = [...text.matchAll(/classification\\*"\s*:\s*\\*"([a-z-]+)/gu)].map((match) => match[1]);
  if (found.length !== 1) return "other";
  if (found[0] === "unknown-tool") return "unavailable";
  if (found[0] === "permission-denied") return "denied";
  if (found[0] === "unexpected-success") return "success";
  return "other";
}
const denialOutcome = (value: unknown) => value === "denied" || value === "unavailable";
function deniedPass(denials: Record<string, unknown>): boolean {
  return (
    denialOutcome(denials.scoutBash) &&
    denialOutcome(denials.scoutWrite) &&
    denialOutcome(denials.scoutShell) &&
    denialOutcome(denials.scoutNestedShell) &&
    denialOutcome(denials.delegationNonWorker) &&
    denials.delegationWorker === "completed" &&
    denialOutcome(denials.writeBash) &&
    denialOutcome(denials.writeShell) &&
    denials.scoutSkill === "denied" &&
    denials.workerSkill === "denied" &&
    denials.writeSkill === "denied"
  );
}
function toolsPass(tools: Record<string, unknown>): boolean {
  return roles.every((role) => {
    const report = tools[role];
    return validToolReport(report) && classifyToolReport(role, report).pass;
  });
}
function validCounts(value: Record<string, unknown>): boolean {
  return (
    Number.isInteger(value.apiRequests) &&
    Number(value.apiRequests) >= 0 &&
    Number(value.apiRequests) <= bounds.apiRequests &&
    value.modelRequests === expectedModelRequests &&
    Number(value.modelRequests) <= bounds.modelRequests &&
    value.sessions === expectedApiSessions &&
    value.prompts === expectedPrompts &&
    value.generates === expectedGenerates &&
    value.delegations === 1 &&
    Number(value.sessions) + Number(value.delegations) <= bounds.sessions &&
    value.children === bounds.children &&
    Number.isInteger(value.maxModelBodyBytes) &&
    Number(value.maxModelBodyBytes) > 0 &&
    Number(value.maxModelBodyBytes) <= bounds.modelBodyBytes
  );
}
function isPrivateEvidencePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(evidencePrefix) &&
    !isAbsolute(path) &&
    !path.split(/[\\/]/).some((segment) => segment === ".." || segment === "")
  );
}
function strictPass(value: unknown): value is Manifest {
  if (
    !record(value) ||
    !record(value.checks) ||
    !record(value.cleanup) ||
    !record(value.counts) ||
    !record(value.bounds) ||
    !record(value.tools) ||
    !record(value.denials) ||
    !record(value.preTeardown) ||
    !record(value.preTeardown.checks) ||
    !record(value.preTeardown.counts) ||
    !record(value.preTeardown.tools) ||
    !record(value.preTeardown.denials) ||
    value.schemaVersion !== 1 ||
    typeof value.runId !== "string" ||
    value.runId.length === 0
  )
    return false;
  const checks = value.checks as Record<string, unknown>;
  const cleanup = value.cleanup as Record<string, unknown>;
  const pre = value.preTeardown as Record<string, unknown>;
  const preChecks = pre.checks as Record<string, unknown>;
  const preCounts = pre.counts as Record<string, unknown>;
  const preTools = pre.tools as Record<string, unknown>;
  return (
    value.status === "PASS" &&
    value.stage === "complete" &&
    value.failureCode === undefined &&
    value.expectedVersion === version &&
    value.observedVersion === version &&
    value.sourceCommit === sourceCommit &&
    value.sourceCommitMeaning === "inspected-release-tag" &&
    value.sandboxMode === "off" &&
    value.clientPackage === "@opencode/client@2.1.0" &&
    typeof value.executablePath === "string" &&
    value.executableSha256 === executableHash &&
    typeof value.ownedPID === "number" &&
    value.ownedPID > 0 &&
    [value.fixtureRoot, value.statePath, value.databasePath, value.evidencePath].every(isPrivateEvidencePath) &&
    JSON.stringify(value.bounds) === JSON.stringify(bounds) &&
    checkNames.every((key) => checks[key] === true) &&
    checkNames.every((key) => preChecks[key] === true) &&
    toolsPass(value.tools as Record<string, unknown>) &&
    toolsPass(preTools) &&
    JSON.stringify(value.tools) === JSON.stringify(pre.tools) &&
    deniedPass(value.denials as Record<string, unknown>) &&
    JSON.stringify(value.denials) === JSON.stringify(pre.denials) &&
    pre.status === "RUNNING" &&
    pre.failureCode === undefined &&
    validCounts(preCounts) &&
    validCounts(value.counts as Record<string, unknown>) &&
    cleanupNames.every((key) => cleanup[key] === true) &&
    Object.values(cleanup).every((item) => item === true)
  );
}
function strictManifestFixture(): Manifest {
  const counts: Counts = {
    apiRequests: 40,
    modelRequests: expectedModelRequests,
    sessions: expectedApiSessions,
    prompts: expectedPrompts,
    generates: expectedGenerates,
    delegations: 1,
    children: 1,
    maxModelBodyBytes: 30_000,
  };
  const checks = Object.fromEntries(checkNames.map((name) => [name, true])) as Manifest["checks"];
  const tools: Manifest["tools"] = {
    scout: toolReport(toolPolicy.scout.required),
    worker: toolReport(toolPolicy.worker.required),
    write: toolReport(toolPolicy.write.required),
    reviewer: toolReport([]),
  };
  const denials: Denials = {
    scoutBash: "unavailable",
    scoutWrite: "unavailable",
    scoutSkill: "denied",
    scoutShell: "unavailable",
    scoutNestedShell: "unavailable",
    delegationNonWorker: "denied",
    delegationWorker: "completed",
    workerSkill: "denied",
    writeBash: "unavailable",
    writeShell: "unavailable",
    writeSkill: "denied",
  };
  return {
    schemaVersion: 1,
    runId: "fixture-run",
    status: "PASS",
    stage: "complete",
    expectedVersion: version,
    observedVersion: version,
    sourceCommit,
    sourceCommitMeaning: "inspected-release-tag",
    sandboxMode: "off",
    executablePath: "/fixture/opencode",
    executableSha256: executableHash,
    clientPackage: "@opencode/client@2.1.0",
    ownedPID: 42,
    fixtureRoot: `${evidencePrefix}fixture`,
    statePath: `${evidencePrefix}fixture/state`,
    databasePath: `${evidencePrefix}fixture/db`,
    evidencePath: `${evidencePrefix}fixture/result.json`,
    bounds,
    counts,
    checks,
    tools,
    denials,
    cleanup: Object.fromEntries(cleanupNames.map((name) => [name, true])) as Manifest["cleanup"],
    preTeardown: {
      status: "RUNNING",
      checks: { ...checks },
      counts: { ...counts },
      tools: structuredClone(tools),
      denials: { ...denials },
    },
  };
}

function sse(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant" })}${chunk({ content: text })}${chunk({}, "stop")}data: [DONE]\n\n`;
}
function toolCall(callId: string, name: string, args: Record<string, unknown>): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant", tool_calls: [{ index: 0, id: callId, type: "function", function: { name, arguments: JSON.stringify(args) } }] })}${chunk({}, "tool_calls")}data: [DONE]\n\n`;
}
/** Result text of the trailing tool message, with its call ID. */
function lastToolResult(messages: unknown[]): { callId: string; text: string } | undefined {
  const last = messages.at(-1);
  if (!record(last) || last.role !== "tool" || typeof last.tool_call_id !== "string") return undefined;
  return { callId: last.tool_call_id, text: textContent(last.content) };
}
function lastUserText(messages: unknown[]): string {
  const user = [...messages].reverse().find((item) => record(item) && item.role === "user");
  return record(user) ? textContent(user.content) : "";
}
const inheritedPermissions = [
  { action: "shell", resource: "*", effect: "allow" },
  { action: "bash", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "allow" },
  { action: "write", resource: "*", effect: "allow" },
  { action: "subagent", resource: "*", effect: "allow" },
  { action: "*", resource: "*", effect: "allow" },
] as const;
function config(port: number) {
  return {
    model: "fixture-provider/fixture-model",
    enabledProviders: ["fixture-provider"],
    providers: {
      "fixture-provider": {
        name: "Local effective policy fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { "fixture-model": { name: "Fixture model" } },
      },
    },
    plugins: [],
    mcp: {},
    permissions: inheritedPermissions,
  };
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
const nativeFailureTools = ["bash", "write", "shell", "edit"];
/** True when the history holds a completed direct mutation/shell tool part or an unfinished/errored assistant turn. */
function staleSuccess(history: ChatMessageWithParts[]): boolean {
  return history.some((message) =>
    message.parts.some(
      (part) => part.type === "tool" && nativeFailureTools.includes(part.tool) && part.state.status === "completed",
    ),
  );
}
function assistantsClean(history: ChatMessageWithParts[]): boolean {
  const assistants = history.filter(({ info }) => info.role === "assistant");
  return (
    assistants.length > 0 &&
    assistants.every(({ info }) => info.time.completed !== undefined && info.error === undefined)
  );
}

describe("native V2 effective-policy fixture tooling", () => {
  it("classifies advertised tool lists per role and rejects policy violations", () => {
    for (const role of roles) {
      const good = toolReport(toolPolicy[role].required);
      expect(classifyToolReport(role, good).pass, role).toBe(true);
    }
    expect(classifyToolReport("scout", toolReport([...toolPolicy.scout.allowed])).pass).toBe(true);
    expect(classifyToolReport("write", toolReport([...toolPolicy.write.allowed])).pass).toBe(true);
    expect(
      toolNamesFromBody({ tools: [{ type: "function", function: { name: "execute" } }, { name: "read" }] }),
    ).toEqual(["execute", "read"]);
    expect(toolNamesFromBody({ messages: [] })).toEqual([]);
    expect(toolNamesFromBody({ tools: [null, 3, {}] })).toEqual([]);

    const scout = toolPolicy.scout.required;
    expect(classifyToolReport("scout", toolReport([...scout, "bash"])).noForbidden).toBe(false);
    expect(classifyToolReport("scout", toolReport([...scout, "shell"])).pass).toBe(false);
    expect(classifyToolReport("scout", toolReport([...scout, "edit"])).pass).toBe(false);
    expect(classifyToolReport("scout", toolReport([...scout, "write"])).pass).toBe(false);
    expect(classifyToolReport("scout", toolReport([...scout, "patch"])).pass).toBe(false);
    // `skill` is advertised but not a forbidden definition; its execution denial is asserted separately.
    expect(classifyToolReport("scout", toolReport([...scout, "skill"])).pass).toBe(true);
    expect(classifyToolReport("reviewer", toolReport(["skill"])).noForbidden).toBe(false);
    expect(classifyToolReport("scout", toolReport(scout.filter((name) => name !== "execute"))).requiredPresent).toBe(
      false,
    );
    expect(classifyToolReport("scout", toolReport(scout.filter((name) => name !== "subagent"))).pass).toBe(false);
    const unknown = toolReport([...scout, "worktree_remove", "session_move"]);
    expect(unknown).toEqual({ names: toolReport(scout).names, unknownCount: 2 });
    expect(classifyToolReport("scout", unknown)).toMatchObject({ noUnexpected: false, pass: false });

    const worker = toolPolicy.worker.required;
    expect(classifyToolReport("worker", toolReport([...worker, "subagent"])).pass).toBe(false);
    expect(classifyToolReport("worker", toolReport([...worker, "edit"])).pass).toBe(false);
    expect(classifyToolReport("worker", toolReport([...worker, "skill"])).pass).toBe(true);
    expect(classifyToolReport("worker", toolReport(worker.filter((name) => name !== "execute"))).pass).toBe(false);
    expect(classifyToolReport("worker", toolReport(worker.filter((name) => name !== "websearch"))).pass).toBe(false);
    expect(classifyToolReport("worker", { names: worker, unknownCount: 1 }).pass).toBe(false);

    const write = toolPolicy.write.required;
    expect(classifyToolReport("write", toolReport([...write, "bash"])).pass).toBe(false);
    expect(classifyToolReport("write", toolReport([...write, "shell"])).pass).toBe(false);
    expect(classifyToolReport("write", toolReport([...write, "subagent"])).pass).toBe(false);
    expect(classifyToolReport("write", toolReport([...write, "task"])).pass).toBe(false);
    expect(classifyToolReport("write", toolReport([...write, "skill"])).pass).toBe(true);
    expect(classifyToolReport("write", toolReport(write.filter((name) => name !== "edit"))).pass).toBe(false);
    expect(classifyToolReport("write", toolReport(write.filter((name) => name !== "write"))).pass).toBe(false);
    expect(classifyToolReport("write", toolReport([...write, "patch"])).pass).toBe(false);
    expect(classifyToolReport("write", toolReport(write.filter((name) => name !== "execute"))).pass).toBe(false);

    expect(classifyToolReport("reviewer", toolReport([])).pass).toBe(true);
    expect(classifyToolReport("reviewer", toolReport(["read"])).pass).toBe(false);
    expect(classifyToolReport("reviewer", toolReport(["execute"])).pass).toBe(false);
    expect(classifyToolReport("reviewer", { names: [], unknownCount: 1 }).pass).toBe(false);
    expect(validToolReport({ names: ["not-a-known-name"], unknownCount: 0 })).toBe(false);
    expect(validToolReport({ names: ["read", "read"], unknownCount: 0 })).toBe(false);
  });

  it("classifies tool results without trusting success text or missing results", () => {
    expect(classifyResult(undefined)).toBe("missing");
    expect(classifyResult('No tool named "bash" is currently available.')).toBe("unavailable");
    expect(classifyResult("Subagent denied: build")).toBe("denied");
    expect(classifyResult("Created file successfully: /x")).toBe("success");
    expect(classifyResult("Wrote file successfully: /x")).toBe("success");
    expect(classifyResult("fixture worker complete")).toBe("completed");
    expect(classifyResult("Unknown agent: nope")).toBe("other");
    const sentinel = "SCRIBE_EFFECTIVE_POLICY_SKILL_SENTINEL_fixture";
    expect(classifySkillResult(undefined, sentinel)).toBe("missing");
    expect(classifySkillResult("Permission denied: skill", sentinel)).toBe("denied");
    expect(classifySkillResult("Unable to load skill scribe-fixture", sentinel)).toBe("unavailable");
    expect(classifySkillResult(`loaded ${sentinel}`, sentinel)).toBe("success");
    expect(classifyNestedResult(undefined)).toBe("missing");
    expect(classifyNestedResult('{"denials":[{"status":"rejected","classification":"unknown-tool"}]}')).toBe(
      "unavailable",
    );
    expect(
      classifyNestedResult(
        '{\\"denials\\":[{\\"status\\":\\"rejected\\",\\"classification\\":\\"permission-denied\\"}]}',
      ),
    ).toBe("denied");
    expect(classifyNestedResult('{"denials":[{"status":"fulfilled","classification":"unexpected-success"}]}')).toBe(
      "success",
    );
    expect(classifyNestedResult('{"denials":[{"status":"rejected","classification":"other-error"}]}')).toBe("other");
    expect(classifyNestedResult("no classification here")).toBe("other");
    expect(deniedPass(strictManifestFixture().denials)).toBe(true);
    expect(deniedPass({ ...strictManifestFixture().denials, scoutShell: "success" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, scoutShell: "missing" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, scoutNestedShell: "success" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, scoutNestedShell: "other" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, writeShell: "success" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, writeShell: "other" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, scoutSkill: "unavailable" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, workerSkill: "missing" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, writeSkill: "success" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, scoutBash: "success" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, writeBash: "missing" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, delegationWorker: "denied" })).toBe(false);
    expect(deniedPass({ ...strictManifestFixture().denials, delegationNonWorker: "other" })).toBe(false);
  });

  it("requires a strict, complete, bounded and cleaned-up manifest", () => {
    const base = strictManifestFixture();
    expect(strictPass(base)).toBe(true);
    const withPre = (patch: Partial<NonNullable<Manifest["preTeardown"]>>) => ({
      ...base,
      preTeardown: { ...base.preTeardown!, ...patch },
    });
    expect(strictPass({ ...base, status: "FAIL" })).toBe(false);
    expect(strictPass({ ...base, status: "BLOCKED" })).toBe(false);
    expect(strictPass({ ...base, stage: "cleanup" })).toBe(false);
    expect(strictPass({ ...base, failureCode: "policy_assertion_failed" })).toBe(false);
    expect(strictPass({ ...base, schemaVersion: 2 })).toBe(false);
    expect(strictPass({ ...base, runId: "" })).toBe(false);
    expect(strictPass({ ...base, observedVersion: "2.0.32" })).toBe(false);
    expect(strictPass({ ...base, executableSha256: "0".repeat(64) })).toBe(false);
    expect(strictPass({ ...base, sourceCommit: "0".repeat(40) })).toBe(false);
    expect(strictPass({ ...base, clientPackage: "@opencode/client@2.0.32" })).toBe(false);
    expect(strictPass({ ...base, ownedPID: 0 })).toBe(false);
    expect(strictPass({ ...base, sandboxMode: "on" })).toBe(false);
    expect(strictPass({ ...base, fixtureRoot: "/unsafe/outside" })).toBe(false);
    expect(strictPass({ ...base, statePath: `${evidencePrefix}../outside` })).toBe(false);
    expect(strictPass({ ...base, evidencePath: "tmp/scribe-v2-migration/session-fork/x/result.json" })).toBe(false);
    expect(strictPass({ ...base, bounds: { ...bounds, modelRequests: 99 } })).toBe(false);
    for (const name of checkNames) {
      expect(strictPass({ ...base, checks: { ...base.checks, [name]: false } }), name).toBe(false);
      expect(strictPass(withPre({ checks: { ...base.checks, [name]: false } })), name).toBe(false);
    }
    expect(strictPass({ ...base, preTeardown: undefined })).toBe(false);
    expect(strictPass(withPre({ status: "PASS" }))).toBe(false);
    expect(strictPass(withPre({ failureCode: "policy_assertion_failed" }))).toBe(false);

    // Missing/failed cleanup gates, including null (never evaluated).
    for (const name of cleanupNames) {
      expect(strictPass({ ...base, cleanup: { ...base.cleanup, [name]: false } }), name).toBe(false);
      expect(strictPass({ ...base, cleanup: { ...base.cleanup, [name]: null } }), name).toBe(false);
    }

    // Overflowed or inexact counts, in the final and pre-teardown copies.
    for (const patch of [
      { apiRequests: bounds.apiRequests + 1 },
      { apiRequests: -1 },
      { modelRequests: bounds.modelRequests + 1 },
      { modelRequests: expectedModelRequests - 1 },
      { sessions: bounds.sessions + 1 },
      { sessions: expectedApiSessions - 1 },
      { prompts: expectedPrompts + 1 },
      { generates: expectedGenerates + 1 },
      { delegations: 2 },
      { delegations: 0 },
      { children: 2 },
      { children: 0 },
      { maxModelBodyBytes: bounds.modelBodyBytes + 1 },
      { maxModelBodyBytes: 0 },
    ]) {
      expect(strictPass({ ...base, counts: { ...base.counts, ...patch } }), JSON.stringify(patch)).toBe(false);
      expect(strictPass(withPre({ counts: { ...base.counts, ...patch } })), JSON.stringify(patch)).toBe(false);
    }

    // Tool lists are recomputed from the persisted names, never trusted from booleans.
    const tools = (patch: Partial<Manifest["tools"]>): Manifest["tools"] => ({ ...base.tools, ...patch });
    const bad: Array<Partial<Manifest["tools"]>> = [
      { scout: toolReport([...toolPolicy.scout.required, "bash"]) },
      { scout: toolReport(toolPolicy.scout.required.filter((name) => name !== "execute")) },
      { worker: toolReport([...toolPolicy.worker.required, "subagent"]) },
      { write: toolReport([...toolPolicy.write.required, "shell"]) },
      { write: toolReport([...toolPolicy.write.required, "subagent"]) },
      { reviewer: toolReport(["skill"]) },
      { reviewer: toolReport(["read"]) },
      { reviewer: toolReport(["execute"]) },
      { scout: { names: toolPolicy.scout.required, unknownCount: 1 } },
      { scout: null },
    ];
    for (const patch of bad) {
      expect(
        strictPass({ ...base, tools: tools(patch), preTeardown: { ...base.preTeardown!, tools: tools(patch) } }),
      ).toBe(false);
    }
    expect(strictPass({ ...base, tools: tools({ scout: toolReport([...toolPolicy.scout.allowed]) }) })).toBe(false);
    expect(strictPass({ ...base, denials: { ...base.denials, scoutWrite: "success" } })).toBe(false);
    expect(strictPass({ ...base, denials: { ...base.denials, writeBash: "other" } })).toBe(false);
    expect(
      strictPass({
        ...base,
        denials: { ...base.denials, delegationNonWorker: "missing" },
        preTeardown: { ...base.preTeardown!, denials: { ...base.denials, delegationNonWorker: "missing" } },
      }),
    ).toBe(false);
    for (const skillResult of ["unavailable", "missing", "success"] as const) {
      for (const skill of ["scoutSkill", "workerSkill", "writeSkill"] as const) {
        const denials = { ...base.denials, [skill]: skillResult };
        expect(
          strictPass({ ...base, denials, preTeardown: { ...base.preTeardown!, denials } }),
          `${skill} ${skillResult}`,
        ).toBe(false);
      }
    }
  });

  it("observes effective native policy for Scout, worker, Write and reviewer through the production agent", {
    skip: !enabled,
    timeout: 135_000,
  }, async () => {
    const forkProcess = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof forkProcess.send === "function" && forkProcess.connected === true;
    const root = await realpath(rootPath);
    const base = resolve(root, "tmp/scribe-v2-migration/effective-policy");
    await mkdir(base, { recursive: true });
    await assertOwnedPath(root, base);
    const runId = randomUUID();
    const skillSentinel = `SCRIBE_EFFECTIVE_POLICY_SKILL_SENTINEL_${runId}`;
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
    let prompts = 0;
    let generates = 0;
    let delegations = 0;
    let maxModelBodyBytes = 0;
    let skillSentinelDelivered = false;
    let fixtureOrigin: string | undefined;
    let ownedOrigin: string | undefined;
    let fixtureFile: string | undefined;
    let orderExact = true;
    const observed: Record<Role, string[] | undefined> = {
      scout: undefined,
      worker: undefined,
      write: undefined,
      reviewer: undefined,
    };
    const results: Denials = {
      scoutBash: "missing",
      scoutWrite: "missing",
      scoutSkill: "missing",
      scoutShell: "missing",
      scoutNestedShell: "missing",
      delegationNonWorker: "missing",
      delegationWorker: "missing",
      workerSkill: "missing",
      writeBash: "missing",
      writeShell: "missing",
      writeSkill: "missing",
    };
    let workerIsChild = false;
    let reviewerIdentified = false;
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
      sandboxMode: "off",
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
        prompts: 0,
        generates: 0,
        delegations: 0,
        children: 0,
        maxModelBodyBytes: 0,
      },
      checks,
      tools: { scout: null, worker: null, write: null, reviewer: null },
      denials: { ...results },
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
    const statuses = new Map<string, { busy: boolean; idle: boolean }>();
    const waitIdle = async (sessionID: string, minModelRequests: number) => {
      while (Date.now() < deadline && !overall.signal.aborted) {
        const status = statuses.get(sessionID);
        if (status?.busy && status.idle && modelRequests >= minModelRequests) return true;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      throw Object.assign(new Error(), { code: "session_idle_timeout" });
    };
    const prompt = async (sessionID: string, text: string, primaryAgent: "scout" | "build") => {
      statuses.set(sessionID, { busy: false, idle: false });
      await agent?.sendMessage(sessionID, text, { primaryAgent });
    };
    try {
      await persist();
      checks.dedicatedFork = dedicatedFork;
      if (!dedicatedFork) throw Object.assign(new Error(), { code: "dedicated_fork_required" });
      if (!executable || !isAbsolute(executable))
        throw Object.assign(new Error(), { code: "explicit_executable_required" });
      if (resolve(executable) !== executablePath)
        throw Object.assign(new Error(), { code: "executable_hash_mismatch" });
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
      fixtureFile = join(isolation.paths.cwd, "scout-denied.txt");
      const markers = {
        scout: join(isolation.paths.cwd, "shell-marker-scout.txt"),
        nested: join(isolation.paths.cwd, "shell-marker-nested.txt"),
        write: join(isolation.paths.cwd, "shell-marker-write.txt"),
      };
      const skillDirectory = join(isolation.paths.config, "opencode", "skills", "scribe-fixture");
      await mkdir(skillDirectory, { recursive: true });
      await assertOwnedPath(isolation.root, skillDirectory);
      const skillFile = join(skillDirectory, "SKILL.md");
      const skillDocument = [
        "---",
        "name: scribe-fixture",
        "description: Harmless fixture-only native skill policy probe.",
        "---",
        "",
        "This fixture-only skill is used to verify effective permission denial.",
        skillSentinel,
        "",
      ].join("\n");
      await writeFile(skillFile, skillDocument, { mode: 0o600 });
      checks.skillFixtureWritten = (await readFile(skillFile, "utf8")) === skillDocument;
      const shellCommand = (path: string) => `printf fixture-denied > ${JSON.stringify(path)}`;
      const nestedCode = `const results = await Promise.allSettled([(async () => await tools.shell({command:${JSON.stringify(shellCommand(markers.nested))}}))()]); const denials = results.map(result => { if (result.status === "fulfilled") return {status:result.status,classification:"unexpected-success"}; const error = String(result.reason); const classification = /UnknownTool|unknown tool/i.test(error) ? "unknown-tool" : /PermissionRejected|permission denied|permissiondenied/i.test(error) ? "permission-denied" : "other-error"; return {status:result.status,classification}; }); return {denials};`;

      fixture = createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          fail("unexpected_mock_route");
          response.writeHead(404).end();
          return;
        }
        modelRequests += 1;
        const step = modelRequests;
        if (step > expectedModelRequests) {
          orderExact = false;
          fail("unexpected_model_request_order");
          response.writeHead(409).end();
          return;
        }
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (Buffer.byteLength(raw) > bounds.modelBodyBytes) {
            fail("model_body_limit");
            response.writeHead(413).end();
            return;
          }
        }
        if (raw.includes(skillSentinel)) skillSentinelDelivered = true;
        maxModelBodyBytes = Math.max(maxModelBodyBytes, Buffer.byteLength(raw));
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          fail("invalid_model_body");
          response.writeHead(400).end();
          return;
        }
        const messages = record(parsed) && Array.isArray(parsed.messages) ? parsed.messages : [];
        const names = toolNamesFromBody(parsed);
        const tail = lastToolResult(messages);
        // Each step is only valid directly after the call it answers; anything else is an ordering failure.
        const expectTail = (callId: string) => {
          if (tail?.callId === callId) return tail.text;
          orderExact = false;
          return undefined;
        };
        const reply = (body: string) => {
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }).end(body);
        };
        switch (step) {
          case 1:
            observed.scout = names;
            return reply(toolCall("call-bash-scout", "bash", { command: "printf fixture-denied" }));
          case 2:
            results.scoutBash = classifyResult(expectTail("call-bash-scout"));
            return reply(
              toolCall("call-write-scout", "write", { path: fixtureFile ?? "scout-denied.txt", content: "fixture" }),
            );
          case 3:
            results.scoutWrite = classifyResult(expectTail("call-write-scout"));
            return reply(toolCall("call-shell-scout", "shell", { command: shellCommand(markers.scout) }));
          case 4:
            results.scoutShell = classifyResult(expectTail("call-shell-scout"));
            return reply(toolCall("call-skill-scout", "skill", { id: "scribe-fixture" }));
          case 5:
            results.scoutSkill = classifySkillResult(expectTail("call-skill-scout"), skillSentinel);
            return reply(toolCall("call-exec-nested", "execute", { code: nestedCode }));
          case 6:
            results.scoutNestedShell = classifyNestedResult(expectTail("call-exec-nested"));
            return reply(sse("fixture scout done"));
          case 7:
            return reply(
              toolCall("call-sub-deny", "subagent", {
                agent: "build",
                description: "deny probe",
                prompt: "fixture denied delegation",
              }),
            );
          case 8:
            results.delegationNonWorker = classifyResult(expectTail("call-sub-deny"));
            return reply(
              toolCall("call-sub-ok", "subagent", {
                agent: "chat-research-worker",
                description: "worker probe",
                prompt: "fixture worker task",
              }),
            );
          case 9:
            observed.worker = names;
            workerIsChild = lastUserText(messages).startsWith("You are a subagent spawned by another session.");
            return reply(toolCall("call-skill-worker", "skill", { id: "scribe-fixture" }));
          case 10:
            results.workerSkill = classifySkillResult(expectTail("call-skill-worker"), skillSentinel);
            return reply(sse("fixture worker complete"));
          case 11:
            results.delegationWorker = classifyResult(expectTail("call-sub-ok"));
            return reply(sse("fixture delegation done"));
          case 12:
            observed.write = names;
            return reply(toolCall("call-bash-write", "bash", { command: "printf fixture-denied" }));
          case 13:
            results.writeBash = classifyResult(expectTail("call-bash-write"));
            return reply(toolCall("call-shell-write", "shell", { command: shellCommand(markers.write) }));
          case 14:
            results.writeShell = classifyResult(expectTail("call-shell-write"));
            return reply(toolCall("call-skill-write", "skill", { id: "scribe-fixture" }));
          case 15:
            results.writeSkill = classifySkillResult(expectTail("call-skill-write"), skillSentinel);
            return reply(sse("fixture write done"));
          case 16: {
            observed.reviewer = names;
            const systemText = messages
              .flatMap((item) => (record(item) && item.role === "system" ? [textContent(item.content)] : []))
              .join("\n");
            reviewerIdentified = systemText.includes(RESTRICTED_REVIEW_PROMPT);
            return reply(sse('{"kind":"ordinary"}'));
          }
          default:
            orderExact = false;
            fail("unexpected_model_request_order");
            response.writeHead(409).end();
            return;
        }
      });
      const fixturePort = await listen(fixture);
      fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
      const fixtureConfig = config(fixturePort);
      const configPath = join(isolation.paths.config, "opencode", "opencode.json");
      await writeFile(configPath, JSON.stringify(fixtureConfig), { mode: 0o600 });
      const written: unknown = JSON.parse(await readFile(configPath, "utf8"));
      // Fixture setup only: the effective result is proven by the denials below, never by this readback.
      checks.inheritedPermissiveConfigWritten =
        record(written) &&
        Array.isArray(written.permissions) &&
        ["shell", "edit", "subagent", "*"].every((action) =>
          (written.permissions as unknown[]).some(
            (rule) => record(rule) && rule.action === action && rule.resource === "*" && rule.effect === "allow",
          ),
        );

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
        if (response.ok && method === "POST" && /\/api\/session\/[^/]+\/generate$/.test(url.pathname)) generates += 1;
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
      // Production overlay agents/permissions are used unchanged; sandbox is off so no OS containment is claimed.
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
      agent.onEvent((event: AgentEvent) => {
        if (event.type !== "session.status") return;
        const current = statuses.get(event.properties.sessionID) ?? { busy: false, idle: false };
        if (event.properties.status.type === "busy") current.busy = true;
        if (event.properties.status.type === "idle" && current.busy) current.idle = true;
        statuses.set(event.properties.sessionID, current);
      });
      await agent.connect();
      const connected = agent;

      setStage("scout");
      const scoutA = await connected.createSession("effective policy scout");
      if (scoutA.directory !== isolation.paths.cwd) throw new Error("session_location_mismatch");
      await prompt(scoutA.id, "fixture scout policy probe", "scout");
      await waitIdle(scoutA.id, 6);
      const scoutHistory = await connected.getMessages(scoutA.id);
      const scoutReport = toolReport(observed.scout ?? []);
      manifest.tools.scout = scoutReport;
      checks.scoutToolsObserved = observed.scout !== undefined;
      checks.scoutAdvertisesExecute = scoutReport.names.includes("execute");
      checks.scoutToolsMatchPolicy = checks.scoutToolsObserved && classifyToolReport("scout", scoutReport).pass;
      checks.scoutBashDenied = denialOutcome(results.scoutBash);
      checks.scoutWriteDenied = denialOutcome(results.scoutWrite);
      checks.scoutSkillDenied = results.scoutSkill === "denied";
      checks.scoutFixtureFileAbsent = await absent(fixtureFile);
      checks.scoutShellDenied = denialOutcome(results.scoutShell);
      checks.scoutShellMarkerAbsent = await absent(markers.scout);
      checks.scoutNestedShellDenied = denialOutcome(results.scoutNestedShell);
      checks.scoutNestedShellMarkerAbsent = await absent(markers.nested);
      checks.scoutSessionIdleClean = assistantsClean(scoutHistory);
      checks.scoutNoStaleSuccess = !staleSuccess(scoutHistory);

      setStage("delegation");
      const scoutB = await connected.createSession("effective policy delegation");
      await prompt(scoutB.id, "fixture delegation probe", "scout");
      await waitIdle(scoutB.id, 11);
      delegations = workerIsChild ? 1 : 0;
      const workerReport = toolReport(observed.worker ?? []);
      manifest.tools.worker = workerReport;
      checks.delegationNonWorkerDenied = denialOutcome(results.delegationNonWorker);
      checks.delegationWorkerAllowed = results.delegationWorker === "completed";
      checks.workerRequestIsSubagentChild = workerIsChild;
      checks.workerToolsMatchPolicy = observed.worker !== undefined && classifyToolReport("worker", workerReport).pass;
      checks.workerSkillDenied = results.workerSkill === "denied";
      checks.delegationSessionIdle = assistantsClean(await connected.getMessages(scoutB.id));

      setStage("write");
      const writer = await connected.createSession("effective policy write");
      await prompt(writer.id, "fixture write policy probe", "build");
      await waitIdle(writer.id, 15);
      const writeHistory = await connected.getMessages(writer.id);
      const writeReport = toolReport(observed.write ?? []);
      manifest.tools.write = writeReport;
      checks.writeToolsMatchPolicy = observed.write !== undefined && classifyToolReport("write", writeReport).pass;
      checks.writeSkillDenied = results.writeSkill === "denied";
      checks.writeBashDenied = denialOutcome(results.writeBash);
      checks.writeShellDenied = denialOutcome(results.writeShell);
      checks.writeShellMarkerAbsent = await absent(markers.write);
      checks.writeSessionIdleClean = assistantsClean(writeHistory);
      checks.writeNoStaleSuccess = !staleSuccess(writeHistory);

      setStage("reviewer");
      const review = connected.createRestrictedReviewProvider({
        providerID: "fixture-provider",
        modelID: "fixture-model",
      });
      if (!review || !(await review.checkReadiness()))
        throw Object.assign(new Error(), { code: "restricted_review_not_ready" });
      const token = await review.beginReview();
      const reviewer = await review.createSession("effective policy reviewer");
      if (!reviewer.ok) throw Object.assign(new Error(), { code: "restricted_review_not_ready" });
      const stage = await review.runStage(reviewer.sessionId, '{"kind":"ordinary"}', 5_000, "architect");
      if (!stage.ok) throw Object.assign(new Error(), { code: "restricted_review_stage_failed" });
      const cancelled = await bounded(review.cancelReview(token), 5_000);
      if (!cancelled.ok) throw Object.assign(new Error(), { code: "restricted_review_stage_failed" });
      const reviewerReport = toolReport(observed.reviewer ?? []);
      manifest.tools.reviewer = reviewerReport;
      checks.reviewerRequestIdentified = observed.reviewer !== undefined && reviewerIdentified;
      checks.reviewerNoTools = observed.reviewer !== undefined && observed.reviewer.length === 0;
      checks.reviewerNoExecute = observed.reviewer !== undefined && !observed.reviewer.includes("execute");
      checks.skillSentinelNotDelivered = !skillSentinelDelivered;

      manifest.denials = { ...results };
      checks.privateChildVersionAndPID =
        observedVersion === version && ownedPID !== undefined && ownedOrigin !== undefined;
      checks.nativeConfigIsSafe =
        fixtureConfig.enabledProviders.length === 1 &&
        fixtureConfig.plugins.length === 0 &&
        Object.keys(fixtureConfig.mcp).length === 0 &&
        Object.keys(fixtureConfig.providers).length === 1;
      checks.modelRequestOrderExact = orderExact && modelRequests === expectedModelRequests;
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions,
        prompts,
        generates,
        delegations,
        children: ownedPID ? 1 : 0,
        maxModelBodyBytes,
      };
      checks.requestBounds =
        Date.now() - started <= bounds.overallMs && validCounts({ ...manifest.counts }) && ownedPID !== undefined;
      manifest.status = checkNames.every((key) => checks[key]) ? "RUNNING" : "FAIL";
      if (manifest.status === "FAIL") manifest.failureCode = "policy_assertion_failed";
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
      const knownCode = failureCodes.find((candidate) => candidate === code);
      manifest.failureCode ??= knownCode ?? "fixture_operation_failed";
      manifest.failureStage ??= activeStage;
      manifest.status = blockedCodes.some((candidate) => candidate === manifest.failureCode) ? "BLOCKED" : "FAIL";
    } finally {
      clearTimeout(timer);
      setStage("pre_teardown");
      manifest.denials = { ...results };
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions,
        prompts,
        generates,
        delegations,
        children: ownedPID ? 1 : 0,
        maxModelBodyBytes,
      };
      manifest.preTeardown = {
        status: manifest.status,
        checks: { ...checks },
        counts: { ...manifest.counts },
        tools: structuredClone(manifest.tools),
        denials: { ...manifest.denials },
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
