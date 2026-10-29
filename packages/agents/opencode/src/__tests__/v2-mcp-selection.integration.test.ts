import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, ChatMessageWithParts } from "@opencode-chat/core";
import { describe, expect, it } from "vitest";
import { resolveMcpInventory } from "../mcp-inventory.js";
import { buildMcpOverlay } from "../mcp-overlay.js";
import { OpenCodeAgent } from "../opencode-agent.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

// Opt-in native MCP selection/suppression/policy fixture. Native 2.1.2 facts it relies on (core/src of the inspected tag):
// - config/plugin/mcp.ts: documents are applied in load order and a later complete definition replaces an earlier one,
//   so the process overlay (OPENCODE_CONFIG_CONTENT, loaded after global config) overrides a config-disabled server.
// - mcp/index.ts replaceServer: `disabled` registers the server as `disabled` without calling startServer, so no
//   stdio child is spawned for an unselected server; an enabled one is started and listed as `connected`.
// - config/plugin/policy.ts + managed-policy.ts: `integration.use` deny on `mcp:<name>` removes the server after every
//   authored document (including this global config's `policies`) has been composed, so it wins over the overlay.
// - schema/config/policy.ts: policy statement is {action: provider.use|tool.use|integration.use, resource, effect}.
// Server names carry the reviewed `firecrawl_` prefix because Scout's permissions are deny-all plus the reviewed MCP
// prefixes (opencode-agent.ts CHAT_AGENT_OVERLAY); an unreviewed name would be hidden from the catalog by that policy.
const enabled = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const rootPath = fileURLToPath(new URL("../../../../../", import.meta.url));
const version = "2.2.0";
const executableHash = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const evidencePrefix = "tmp/scribe-v2-migration/mcp-selection/";
const expectedModelRequests = 2;
const bounds = {
  overallMs: 90_000,
  apiRequests: 60,
  modelRequests: 2,
  sessions: 1,
  children: 1,
  mcpChildProcesses: 3,
  modelBodyBytes: 512 * 1024,
} as const;
const statusPollLimit = 14;
const statusPollMs = 350;
const settleMs = 750;

const roles = ["alpha", "beta", "gamma"] as const;
type Role = (typeof roles)[number];
const serverNames: Record<Role, string> = {
  alpha: "firecrawl_alpha",
  beta: "firecrawl_beta",
  gamma: "firecrawl_gamma",
};
// alpha: config-disabled but selected (must start); beta: config-enabled but unselected (must not start);
// gamma: config-enabled and selected, but denied by native policy (must not start).
const selectionPlan = {
  alpha: { configDisabled: true, selected: true, nativePolicyDenied: false, expectStart: true },
  beta: { configDisabled: false, selected: false, nativePolicyDenied: false, expectStart: false },
  gamma: { configDisabled: false, selected: true, nativePolicyDenied: true, expectStart: false },
} as const;
const selectionPrefs: Record<string, boolean> = Object.fromEntries(
  roles.map((role) => [serverNames[role], selectionPlan[role].selected]),
);
const expectedMarkerCounts: Record<Role, number> = { alpha: 1, beta: 0, gamma: 0 };

const checkNames = [
  "dedicatedFork",
  "clientMetadataPinned",
  "executableHashPinned",
  "projectLocalIsolation",
  "ambientGateClear",
  "spawnGateClear",
  "ownedConfigWritten",
  "inventoryProductionPath",
  "overlayProductionPath",
  "privateChildVersionAndPID",
  "mcpStatusAlphaConnected",
  "mcpStatusBetaNotAvailable",
  "mcpStatusGammaNotAvailable",
  "alphaMarkerPresent",
  "alphaStartedOnce",
  "betaMarkerAbsentAfterSettle",
  "gammaMarkerAbsentAfterSettle",
  "betaMarkerAbsentAfterRun",
  "gammaMarkerAbsentAfterRun",
  "mcpChildProcessCountBounded",
  "catalogHasAlphaTool",
  "catalogOmitsBetaAndGamma",
  "noDirectMcpToolDuplication",
  "alphaToolReachableThroughExecute",
  "sessionIdleClean",
  "noConfigWrites",
  "modelRequestOrderExact",
  "requestBounds",
] as const;
const cleanupNames = [
  "agentDisconnected",
  "processGroupReaped",
  "mcpChildrenGone",
  "fixtureClosed",
  "isolationRemoved",
  "stateAbsent",
  "databaseAbsent",
  "environmentRestored",
  "fetchRestored",
] as const;
const stages = ["preflight", "connect", "selection", "catalog", "pre_teardown", "cleanup", "complete"] as const;
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
  "session_idle_timeout",
  "owned_config_invalid",
  "production_overlay_unexpected",
  "mcp_selection_not_observed",
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
type StatusCategory = "connected" | "disabled" | "absent" | "other";
type Counts = {
  apiRequests: number;
  modelRequests: number;
  sessions: number;
  children: number;
  mcpChildProcesses: number;
  startMarkers: Record<Role, number>;
  maxModelBodyBytes: number;
};
type CatalogObservation = {
  executeAdvertised: boolean;
  alphaInCatalog: boolean;
  betaInRequest: boolean;
  gammaInRequest: boolean;
  mcpNamesInDirectTools: number;
  directToolCount: number;
};
type Observed = {
  mcpStatus: Record<Role, StatusCategory | null>;
  catalog: CatalogObservation | null;
  config: { filesBefore: number; filesChanged: number; filesAdded: number } | null;
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
  selection: typeof selectionPlan;
  counts: Counts;
  checks: Record<(typeof checkNames)[number], boolean>;
  observed: Observed;
  cleanup: Record<(typeof cleanupNames)[number], boolean | null>;
  preTeardown?: {
    status: Status;
    checks: Manifest["checks"];
    counts: Counts;
    observed: Observed;
    failureCode?: FailureCode;
  };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tiny dependency-free stdio MCP server: writes a start marker on launch and exposes one `probe` tool. */
function fixtureServerSource(): string {
  return `"use strict";
const fs = require("node:fs");
const [, , role, marker] = process.argv;
fs.appendFileSync(marker, process.pid + "\\n");
let buffer = "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
    if (message.method === "initialize") {
      reply({
        protocolVersion: (message.params && message.params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-" + role, version: "0.0.0" },
      });
    } else if (message.method === "tools/list") {
      reply({ tools: [{ name: "probe", description: "Fixture probe " + role, inputSchema: { type: "object", properties: {} } }] });
    } else if (message.method === "tools/call") {
      reply({ content: [{ type: "text", text: role + " pong" }] });
    } else if (message.method === "ping") {
      reply({});
    } else {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;
}

type FixturePaths = { script: string; markers: Record<Role, string> };
function fixturePaths(isolation: V2TestIsolation): FixturePaths {
  const directory = join(isolation.paths.cwd, "mcp-fixture");
  return {
    script: join(directory, "server.cjs"),
    markers: Object.fromEntries(roles.map((role) => [role, join(directory, "markers", `${role}.start`)])) as Record<
      Role,
      string
    >,
  };
}
async function writeFixtureServers(paths: FixturePaths): Promise<void> {
  await mkdir(join(paths.script, "..", "markers"), { recursive: true });
  await writeFile(paths.script, fixtureServerSource(), { mode: 0o600 });
}

/** Owned global config: three local stdio servers, a mock provider, and a native deny for gamma only. */
function ownedConfig(port: number, paths: FixturePaths) {
  const server = (role: Role, disabled: boolean) => ({
    type: "local" as const,
    command: [process.execPath, paths.script, role, paths.markers[role]],
    ...(disabled ? { disabled: true } : {}),
  });
  return {
    model: "fixture-provider/fixture-model",
    enabledProviders: ["fixture-provider"],
    providers: {
      "fixture-provider": {
        name: "Local MCP selection fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { "fixture-model": { name: "Fixture model" } },
      },
    },
    plugins: [],
    mcp: {
      servers: Object.fromEntries(
        roles.map((role) => [serverNames[role], server(role, selectionPlan[role].configDisabled)]),
      ),
    },
    policies: [{ action: "integration.use", resource: `mcp:${serverNames.gamma}`, effect: "deny" }],
  };
}
function ownedConfigMatchesPlan(value: unknown, paths: FixturePaths): boolean {
  if (!record(value) || !record(value.mcp) || !record(value.mcp.servers)) return false;
  const servers = value.mcp.servers;
  const policies = Array.isArray(value.policies) ? value.policies : [];
  const denies = policies.filter(
    (policy) =>
      record(policy) &&
      policy.action === "integration.use" &&
      policy.effect === "deny" &&
      typeof policy.resource === "string",
  ) as Array<{ resource: string }>;
  return (
    Object.keys(servers).length === roles.length &&
    roles.every((role) => {
      const entry = servers[serverNames[role]];
      return (
        record(entry) &&
        entry.type === "local" &&
        Array.isArray(entry.command) &&
        entry.command[1] === paths.script &&
        (entry.disabled === true) === selectionPlan[role].configDisabled
      );
    }) &&
    policies.length === 1 &&
    denies.length === 1 &&
    denies[0].resource === `mcp:${serverNames.gamma}`
  );
}

function classifyStatus(map: Record<string, { connected: boolean; status: string }>, name: string): StatusCategory {
  const entry = Object.hasOwn(map, name) ? map[name] : undefined;
  if (!entry) return "absent";
  if (entry.connected && entry.status === "connected") return "connected";
  if (!entry.connected && entry.status === "disabled") return "disabled";
  return "other";
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textContent).join("\n");
  if (record(value)) return Object.values(value).map(textContent).join("\n");
  return "";
}
function toolNamesFromBody(body: unknown): string[] {
  if (!record(body) || !Array.isArray(body.tools)) return [];
  return body.tools.flatMap((definition) => {
    if (!record(definition)) return [];
    if (record(definition.function) && typeof definition.function.name === "string") return [definition.function.name];
    return typeof definition.name === "string" ? [definition.name] : [];
  });
}
function inspectCatalog(body: unknown): CatalogObservation {
  const names = toolNamesFromBody(body);
  const messages = record(body) && Array.isArray(body.messages) ? body.messages : [];
  const messageText = messages.map((message) => (record(message) ? textContent(message.content) : "")).join("\n");
  const requestText = JSON.stringify(body) ?? "";
  const toolsText = JSON.stringify(record(body) ? (body.tools ?? []) : []);
  const path = (name: string) => new RegExp(`tools(?:\\.${name}|\\["${name}"\\])\\.probe`, "u");
  return {
    executeAdvertised: names.includes("execute"),
    alphaInCatalog: messageText.includes("# Code Mode") && path(serverNames.alpha).test(messageText),
    betaInRequest: requestText.includes(serverNames.beta),
    gammaInRequest: requestText.includes(serverNames.gamma),
    mcpNamesInDirectTools: [...names, toolsText].filter((text) => /firecrawl_(?:alpha|beta|gamma)|probe/iu.test(text))
      .length,
    directToolCount: names.length,
  };
}
function catalogPass(value: unknown): value is CatalogObservation {
  return (
    record(value) &&
    value.executeAdvertised === true &&
    value.alphaInCatalog === true &&
    value.betaInRequest === false &&
    value.gammaInRequest === false &&
    value.mcpNamesInDirectTools === 0 &&
    Number.isInteger(value.directToolCount) &&
    Number(value.directToolCount) >= 1
  );
}

type TreeSnapshot = Map<string, string>;
async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const snapshot: TreeSnapshot = new Map();
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const [bytes, info] = await Promise.all([readFile(full), stat(full)]);
        snapshot.set(
          relative(root, full),
          `${createHash("sha256").update(bytes).digest("hex")}:${info.mtimeMs}:${info.size}`,
        );
      }
    }
  };
  await walk(root);
  return snapshot;
}
function diffSnapshots(before: TreeSnapshot, after: TreeSnapshot) {
  let filesChanged = 0;
  for (const [file, fingerprint] of before) if (after.get(file) !== fingerprint) filesChanged += 1;
  const added = [...after.keys()].filter((file) => !before.has(file));
  return {
    filesBefore: before.size,
    filesChanged,
    filesAdded: added.length,
    addedConfigFile: added.some((file) => /(?:^|[\\/])opencode\.jsonc?$/u.test(file)),
  };
}

const forbiddenContent = /"(?:command|environment|env|policies|servers|mcp|headers|authorization|token|secret)"\s*:/iu;
function containsForbiddenContent(text: string): boolean {
  return forbiddenContent.test(text);
}

function validCounts(value: Record<string, unknown>): boolean {
  const markers = value.startMarkers;
  return (
    Number.isInteger(value.apiRequests) &&
    Number(value.apiRequests) >= 0 &&
    Number(value.apiRequests) <= bounds.apiRequests &&
    value.modelRequests === expectedModelRequests &&
    Number(value.modelRequests) <= bounds.modelRequests &&
    value.sessions === bounds.sessions &&
    value.children === bounds.children &&
    value.mcpChildProcesses === 1 &&
    Number(value.mcpChildProcesses) <= bounds.mcpChildProcesses &&
    record(markers) &&
    roles.every((role) => markers[role] === expectedMarkerCounts[role]) &&
    Object.keys(markers).length === roles.length &&
    Number.isInteger(value.maxModelBodyBytes) &&
    Number(value.maxModelBodyBytes) > 0 &&
    Number(value.maxModelBodyBytes) <= bounds.modelBodyBytes
  );
}
function validObserved(value: unknown): boolean {
  if (!record(value) || !record(value.mcpStatus) || !record(value.config)) return false;
  const config = value.config;
  return (
    value.mcpStatus.alpha === "connected" &&
    value.mcpStatus.beta === "disabled" &&
    (value.mcpStatus.gamma === "absent" || value.mcpStatus.gamma === "disabled") &&
    catalogPass(value.catalog) &&
    Number.isInteger(config.filesBefore) &&
    Number(config.filesBefore) >= 1 &&
    config.filesChanged === 0 &&
    Number.isInteger(config.filesAdded) &&
    Number(config.filesAdded) >= 0
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
    !record(value.selection) ||
    !record(value.preTeardown) ||
    !record(value.preTeardown.checks) ||
    !record(value.preTeardown.counts) ||
    value.schemaVersion !== 1 ||
    typeof value.runId !== "string" ||
    value.runId.length === 0
  )
    return false;
  const checks = value.checks as Record<string, unknown>;
  const cleanup = value.cleanup as Record<string, unknown>;
  const pre = value.preTeardown as Record<string, unknown>;
  const preChecks = pre.checks as Record<string, unknown>;
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
    JSON.stringify(value.selection) === JSON.stringify(selectionPlan) &&
    Object.keys(checks).length === checkNames.length &&
    checkNames.every((key) => checks[key] === true) &&
    checkNames.every((key) => preChecks[key] === true) &&
    validObserved(value.observed) &&
    validObserved(pre.observed) &&
    JSON.stringify(value.observed) === JSON.stringify(pre.observed) &&
    pre.status === "RUNNING" &&
    pre.failureCode === undefined &&
    validCounts(pre.counts as Record<string, unknown>) &&
    validCounts(value.counts as Record<string, unknown>) &&
    JSON.stringify(value.counts) === JSON.stringify(pre.counts) &&
    Object.keys(cleanup).length === cleanupNames.length &&
    cleanupNames.every((key) => cleanup[key] === true) &&
    !containsForbiddenContent(JSON.stringify(value))
  );
}
function strictManifestFixture(): Manifest {
  const counts: Counts = {
    apiRequests: 30,
    modelRequests: expectedModelRequests,
    sessions: 1,
    children: 1,
    mcpChildProcesses: 1,
    startMarkers: { ...expectedMarkerCounts },
    maxModelBodyBytes: 20_000,
  };
  const checks = Object.fromEntries(checkNames.map((name) => [name, true])) as Manifest["checks"];
  const observed: Observed = {
    mcpStatus: { alpha: "connected", beta: "disabled", gamma: "absent" },
    catalog: {
      executeAdvertised: true,
      alphaInCatalog: true,
      betaInRequest: false,
      gammaInRequest: false,
      mcpNamesInDirectTools: 0,
      directToolCount: 7,
    },
    config: { filesBefore: 1, filesChanged: 0, filesAdded: 0 },
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
    selection: selectionPlan,
    counts,
    checks,
    observed,
    cleanup: Object.fromEntries(cleanupNames.map((name) => [name, true])) as Manifest["cleanup"],
    preTeardown: {
      status: "RUNNING",
      checks: { ...checks },
      counts: structuredClone(counts),
      observed: structuredClone(observed),
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
function lastToolResult(messages: unknown[]): { callId: string; text: string } | undefined {
  const last = messages.at(-1);
  if (!record(last) || last.role !== "tool" || typeof last.tool_call_id !== "string") return undefined;
  return { callId: last.tool_call_id, text: textContent(last.content) };
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
function processGone(pid: number, group = false): boolean {
  try {
    process.kill(group ? -pid : pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
async function waitGone(pids: readonly number[], milliseconds: number, group = false): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (!pids.every((pid) => processGone(pid, group)) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return pids.every((pid) => processGone(pid, group));
}
async function absent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}
async function readMarkerPids(path: string): Promise<number[]> {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => Number(line))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
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
function assistantsClean(history: ChatMessageWithParts[]): boolean {
  const assistants = history.filter(({ info }) => info.role === "assistant");
  return (
    assistants.length > 0 &&
    assistants.every(({ info }) => info.time.completed !== undefined && info.error === undefined)
  );
}

describe("native V2 MCP selection fixture tooling", () => {
  it("derives the expected overlay through the production inventory and overlay builders", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const paths = fixturePaths(isolation);
      const configDirectory = join(isolation.paths.config, "opencode");
      await writeFile(join(configDirectory, "opencode.json"), JSON.stringify(ownedConfig(1, paths)), { mode: 0o600 });
      const inventory = resolveMcpInventory(configDirectory, isolation.paths.cwd);
      expect(Object.keys(inventory.servers).sort()).toEqual(roles.map((role) => serverNames[role]).sort());
      for (const role of roles) {
        expect(inventory.servers[serverNames[role]].explicitlyDisabled).toBe(selectionPlan[role].configDisabled);
        expect(inventory.servers[serverNames[role]].transport).toBe("stdio");
      }
      const overlay = buildMcpOverlay(inventory, selectionPrefs);
      const overlayServers = overlay.mcp.servers;
      expect(overlayServers[serverNames.alpha].disabled).toBe(false);
      expect(overlayServers[serverNames.beta].disabled).toBe(true);
      // Selection is overlaid even for the policy-denied server; native policy, not Scribe, removes it.
      expect(overlayServers[serverNames.gamma].disabled).toBe(false);
      expect(
        ownedConfigMatchesPlan(JSON.parse(await readFile(join(configDirectory, "opencode.json"), "utf8")), paths),
      ).toBe(true);
      expect(JSON.stringify(overlay)).not.toContain("policies");
    } finally {
      await isolation.dispose();
    }
  });

  it("rejects owned configs that drift from the selection plan", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const paths = fixturePaths(isolation);
      const base = ownedConfig(1, paths);
      expect(ownedConfigMatchesPlan(base, paths)).toBe(true);
      expect(ownedConfigMatchesPlan({ ...base, policies: [] }, paths)).toBe(false);
      expect(
        ownedConfigMatchesPlan(
          { ...base, policies: [{ action: "integration.use", resource: "mcp:firecrawl_beta", effect: "deny" }] },
          paths,
        ),
      ).toBe(false);
      expect(
        ownedConfigMatchesPlan(
          { ...base, policies: [{ action: "integration.use", resource: `mcp:${serverNames.gamma}`, effect: "allow" }] },
          paths,
        ),
      ).toBe(false);
      const alphaEnabled = structuredClone(base);
      delete (alphaEnabled.mcp.servers[serverNames.alpha] as { disabled?: boolean }).disabled;
      expect(ownedConfigMatchesPlan(alphaEnabled, paths)).toBe(false);
      expect(ownedConfigMatchesPlan({ ...base, mcp: {} }, paths)).toBe(false);
      expect(ownedConfigMatchesPlan(null, paths)).toBe(false);
    } finally {
      await isolation.dispose();
    }
  });

  it("speaks the stdio handshake and writes one start marker per launch", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const paths = fixturePaths(isolation);
      await writeFixtureServers(paths);
      const child = spawn(process.execPath, [paths.script, "alpha", paths.markers.alpha], {
        cwd: isolation.paths.cwd,
        env: isolation.environment,
        stdio: ["pipe", "pipe", "ignore"],
      });
      const lines: string[] = [];
      let pending = "";
      const exited = new Promise<void>((resolveExit) => child.once("close", () => resolveExit()));
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        pending += chunk;
        let index = pending.indexOf("\n");
        while (index >= 0) {
          lines.push(pending.slice(0, index));
          pending = pending.slice(index + 1);
          index = pending.indexOf("\n");
        }
      });
      const requests = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "probe", arguments: {} } },
        { jsonrpc: "2.0", id: 4, method: "prompts/list" },
      ];
      child.stdin.write(`${requests.map((item) => JSON.stringify(item)).join("\n")}\n`);
      child.stdin.end();
      await exited;
      clearTimeout(killTimer);
      const replies = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(replies).toHaveLength(4);
      expect((replies[0].result as Record<string, unknown>).protocolVersion).toBe("2025-06-18");
      expect(JSON.stringify(replies[1].result)).toContain('"name":"probe"');
      expect(JSON.stringify(replies[2].result)).toContain("alpha pong");
      expect((replies[3].error as Record<string, unknown>).code).toBe(-32601);
      const pids = await readMarkerPids(paths.markers.alpha);
      expect(pids).toHaveLength(1);
      expect(pids[0]).toBe(child.pid);
      expect(await readMarkerPids(paths.markers.beta)).toEqual([]);
    } finally {
      await isolation.dispose();
    }
  });

  it("classifies native MCP status without trusting presence alone", () => {
    expect(classifyStatus({ x: { connected: true, status: "connected" } }, "x")).toBe("connected");
    expect(classifyStatus({ x: { connected: false, status: "disabled" } }, "x")).toBe("disabled");
    expect(classifyStatus({}, "x")).toBe("absent");
    expect(classifyStatus({ x: { connected: false, status: "failed" } }, "x")).toBe("other");
    expect(classifyStatus({ x: { connected: true, status: "disabled" } }, "x")).toBe("other");
    expect(classifyStatus({ x: { connected: false, status: "pending" } }, "x")).toBe("other");
  });

  it("recognizes the Code Mode catalog and rejects direct or foreign MCP exposure", () => {
    const catalog = [
      "# Code Mode",
      "Use the `execute` tool to call the tools listed below",
      `tools.${serverNames.alpha}.probe(args)`,
    ].join("\n");
    const good = {
      messages: [{ role: "user", content: catalog }],
      tools: [
        { type: "function", function: { name: "execute" } },
        { type: "function", function: { name: "read" } },
      ],
    };
    expect(catalogPass(inspectCatalog(good))).toBe(true);
    expect(
      catalogPass(
        inspectCatalog({ ...good, messages: [{ role: "user", content: catalog.replace("firecrawl_alpha", "x") }] }),
      ),
    ).toBe(false);
    expect(
      catalogPass(
        inspectCatalog({ ...good, messages: [{ role: "user", content: catalog.replace("# Code Mode", "") }] }),
      ),
    ).toBe(false);
    expect(
      catalogPass(
        inspectCatalog({
          ...good,
          messages: [{ role: "user", content: `${catalog}\ntools.${serverNames.beta}.probe()` }],
        }),
      ),
    ).toBe(false);
    expect(
      catalogPass(
        inspectCatalog({ ...good, messages: [{ role: "user", content: `${catalog}\n${serverNames.gamma}` }] }),
      ),
    ).toBe(false);
    for (const name of [`${serverNames.alpha}_probe`, "probe", "firecrawl_alpha.probe"]) {
      expect(
        catalogPass(inspectCatalog({ ...good, tools: [...good.tools, { type: "function", function: { name } }] })),
      ).toBe(false);
    }
    expect(catalogPass(inspectCatalog({ ...good, tools: [{ type: "function", function: { name: "read" } }] }))).toBe(
      false,
    );
    expect(catalogPass(inspectCatalog({ messages: [] }))).toBe(false);
    expect(
      catalogPass(
        inspectCatalog({
          ...good,
          tools: [{ type: "function", function: { name: "read", description: "probe schema dump" } }, ...good.tools],
        }),
      ),
    ).toBe(false);
  });

  it("detects changed, added and removed config files by bytes and mtime fingerprint", () => {
    const before: TreeSnapshot = new Map([
      ["opencode/opencode.json", "aa:1:10"],
      ["opencode/other.json", "bb:1:5"],
    ]);
    expect(diffSnapshots(before, new Map(before))).toMatchObject({ filesChanged: 0, filesAdded: 0 });
    expect(diffSnapshots(before, new Map([...before, ["opencode/opencode.json", "aa:2:10"]]))).toMatchObject({
      filesChanged: 1,
    });
    expect(diffSnapshots(before, new Map([...before, ["opencode/opencode.json", "ab:1:10"]]))).toMatchObject({
      filesChanged: 1,
    });
    expect(diffSnapshots(before, new Map([["opencode/opencode.json", "aa:1:10"]]))).toMatchObject({ filesChanged: 1 });
    expect(diffSnapshots(before, new Map([...before, ["opencode/opencode.jsonc", "cc:1:1"]]))).toMatchObject({
      filesAdded: 1,
      addedConfigFile: true,
    });
    expect(diffSnapshots(before, new Map([...before, ["cache/x", "cc:1:1"]]))).toMatchObject({
      filesAdded: 1,
      addedConfigFile: false,
    });
  });

  it("flags config, environment and credential content in a persisted manifest", () => {
    expect(containsForbiddenContent(JSON.stringify(strictManifestFixture()))).toBe(false);
    expect(containsForbiddenContent('{"command":["node"]}')).toBe(true);
    expect(containsForbiddenContent('{"environment":{}}')).toBe(true);
    expect(containsForbiddenContent('{"policies":[]}')).toBe(true);
    expect(containsForbiddenContent('{"mcp":{}}')).toBe(true);
    expect(containsForbiddenContent('{"Authorization": "x"}')).toBe(true);
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
    expect(strictPass({ ...base, evidencePath: "tmp/scribe-v2-migration/effective-policy/x/result.json" })).toBe(false);
    expect(strictPass({ ...base, bounds: { ...bounds, modelRequests: 99 } })).toBe(false);
    expect(
      strictPass({ ...base, selection: { ...selectionPlan, gamma: { ...selectionPlan.gamma, selected: false } } }),
    ).toBe(false);
    for (const name of checkNames) {
      expect(strictPass({ ...base, checks: { ...base.checks, [name]: false } }), name).toBe(false);
      expect(strictPass(withPre({ checks: { ...base.checks, [name]: false } })), name).toBe(false);
    }
    // A missing marker check (never initialized) must not pass.
    const { alphaMarkerPresent: _omitted, ...withoutMarkerCheck } = base.checks;
    expect(strictPass({ ...base, checks: withoutMarkerCheck })).toBe(false);
    expect(strictPass({ ...base, preTeardown: undefined })).toBe(false);
    expect(strictPass(withPre({ status: "PASS" }))).toBe(false);
    expect(strictPass(withPre({ failureCode: "policy_assertion_failed" }))).toBe(false);

    for (const name of cleanupNames) {
      expect(strictPass({ ...base, cleanup: { ...base.cleanup, [name]: false } }), name).toBe(false);
      expect(strictPass({ ...base, cleanup: { ...base.cleanup, [name]: null } }), name).toBe(false);
    }

    const countPatches: Array<Partial<Counts>> = [
      { apiRequests: bounds.apiRequests + 1 },
      { apiRequests: -1 },
      { modelRequests: bounds.modelRequests + 1 },
      { modelRequests: expectedModelRequests - 1 },
      { sessions: 2 },
      { sessions: 0 },
      { children: 2 },
      { children: 0 },
      { mcpChildProcesses: 2 },
      { mcpChildProcesses: 0 },
      { mcpChildProcesses: bounds.mcpChildProcesses + 1 },
      { startMarkers: { alpha: 0, beta: 0, gamma: 0 } },
      { startMarkers: { alpha: 2, beta: 0, gamma: 0 } },
      { startMarkers: { alpha: 1, beta: 1, gamma: 0 } },
      { startMarkers: { alpha: 1, beta: 0, gamma: 1 } },
      { maxModelBodyBytes: bounds.modelBodyBytes + 1 },
      { maxModelBodyBytes: 0 },
    ];
    for (const patch of countPatches) {
      expect(strictPass({ ...base, counts: { ...base.counts, ...patch } }), JSON.stringify(patch)).toBe(false);
      expect(strictPass(withPre({ counts: { ...base.counts, ...patch } })), JSON.stringify(patch)).toBe(false);
    }

    const observedPatches: Array<Partial<Observed>> = [
      { mcpStatus: { alpha: "disabled", beta: "disabled", gamma: "absent" } },
      { mcpStatus: { alpha: "connected", beta: "connected", gamma: "absent" } },
      { mcpStatus: { alpha: "connected", beta: "absent", gamma: "absent" } },
      { mcpStatus: { alpha: "connected", beta: "disabled", gamma: "connected" } },
      { mcpStatus: { alpha: null, beta: null, gamma: null } },
      { catalog: null },
      { catalog: { ...base.observed.catalog!, alphaInCatalog: false } },
      { catalog: { ...base.observed.catalog!, betaInRequest: true } },
      { catalog: { ...base.observed.catalog!, gammaInRequest: true } },
      { catalog: { ...base.observed.catalog!, mcpNamesInDirectTools: 1 } },
      { catalog: { ...base.observed.catalog!, executeAdvertised: false } },
      { config: null },
      { config: { filesBefore: 1, filesChanged: 1, filesAdded: 0 } },
      { config: { filesBefore: 0, filesChanged: 0, filesAdded: 0 } },
    ];
    for (const patch of observedPatches) {
      const observed = { ...base.observed, ...patch };
      expect(strictPass({ ...base, observed }), JSON.stringify(patch)).toBe(false);
      expect(strictPass(withPre({ observed })), JSON.stringify(patch)).toBe(false);
    }
    expect(
      strictPass({
        ...base,
        observed: { ...base.observed, mcpStatus: { alpha: "connected", beta: "disabled", gamma: "disabled" } },
        preTeardown: {
          ...base.preTeardown!,
          observed: { ...base.observed, mcpStatus: { alpha: "connected", beta: "disabled", gamma: "disabled" } },
        },
      }),
    ).toBe(true);
    // The final copy must equal the frozen pre-teardown copy.
    expect(
      strictPass({
        ...base,
        observed: { ...base.observed, mcpStatus: { alpha: "connected", beta: "disabled", gamma: "disabled" } },
      }),
    ).toBe(false);
    expect(strictPass({ ...base, counts: { ...base.counts, apiRequests: 31 } })).toBe(false);
    expect(strictPass({ ...base, extra: { command: ["node"] } })).toBe(false);
  });

  it("observes native MCP selection, suppression and policy denial through the production agent", {
    skip: !enabled,
    timeout: bounds.overallMs + 20_000,
  }, async () => {
    const forkProcess = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof forkProcess.send === "function" && forkProcess.connected === true;
    const root = await realpath(rootPath);
    const base = resolve(root, "tmp/scribe-v2-migration/mcp-selection");
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
    let maxModelBodyBytes = 0;
    let fixtureOrigin: string | undefined;
    let ownedOrigin: string | undefined;
    let orderExact = true;
    let alphaResultObserved = false;
    let catalog: CatalogObservation | null = null;
    let mcpPids: number[] = [];
    let configBefore: TreeSnapshot | undefined;
    const startMarkers: Record<Role, number> = { alpha: 0, beta: 0, gamma: 0 };
    const mcpStatus: Observed["mcpStatus"] = { alpha: null, beta: null, gamma: null };
    let configObservation: Observed["config"] = null;
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
      selection: selectionPlan,
      counts: {
        apiRequests: 0,
        modelRequests: 0,
        sessions: 0,
        children: 0,
        mcpChildProcesses: 0,
        startMarkers: { alpha: 0, beta: 0, gamma: 0 },
        maxModelBodyBytes: 0,
      },
      checks,
      observed: { mcpStatus: { ...mcpStatus }, catalog: null, config: null },
      cleanup: {
        agentDisconnected: false,
        processGroupReaped: null,
        mcpChildrenGone: null,
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
    const sessionState = { busy: false, idle: false };
    const stop = (code: FailureCode) => Object.assign(new Error(code), { code });
    const snapshotMarkers = async (paths: FixturePaths) => {
      const pids: number[] = [];
      for (const role of roles) {
        const found = await readMarkerPids(paths.markers[role]);
        startMarkers[role] = found.length;
        pids.push(...found);
      }
      mcpPids = [...new Set([...mcpPids, ...pids])];
    };
    try {
      await persist();
      checks.dedicatedFork = dedicatedFork;
      if (!dedicatedFork) throw stop("dedicated_fork_required");
      if (!executable || !isAbsolute(executable)) throw stop("explicit_executable_required");
      const metadata = JSON.parse(
        await readFile(resolve(root, "packages/agents/opencode/node_modules/@opencode/client/package.json"), "utf8"),
      ) as Record<string, unknown>;
      checks.clientMetadataPinned = metadata.name === "@opencode/client" && metadata.version === "2.1.0";
      manifest.clientPackage =
        typeof metadata.name === "string" && typeof metadata.version === "string"
          ? `${metadata.name}@${metadata.version}`
          : null;
      if (!checks.clientMetadataPinned) throw stop("client_metadata_mismatch");
      const binary = await readFile(executable).catch(() => undefined);
      if (!binary) throw stop("executable_unavailable");
      manifest.executableSha256 = createHash("sha256").update(binary).digest("hex");
      checks.executableHashPinned = manifest.executableSha256 === executableHash;
      if (!checks.executableHashPinned) throw stop("executable_hash_mismatch");
      isolation = await createV2TestIsolation(runRoot);
      manifest.fixtureRoot = relative(root, isolation.root);
      manifest.statePath = relative(root, isolation.paths.state);
      manifest.databasePath = relative(root, isolation.paths.database);
      checks.projectLocalIsolation = true;
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      checks.ambientGateClear =
        evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, await inspectAmbientConfigSources())
          .status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.ambientGateClear) throw stop("ambient_gate_blocked");
      const fixturePath = fixturePaths(isolation);
      await writeFixtureServers(fixturePath);

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
        const reply = (body: string) => {
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }).end(body);
        };
        if (step === 1) {
          // Request bodies stay in memory; only booleans and counts are recorded.
          catalog = inspectCatalog(parsed);
          return reply(
            toolCall("call-alpha-probe", "execute", {
              code: `return await tools.${serverNames.alpha}.probe({});`,
            }),
          );
        }
        const tail = lastToolResult(messages);
        if (tail?.callId !== "call-alpha-probe") orderExact = false;
        alphaResultObserved = tail?.callId === "call-alpha-probe" && tail.text.includes("alpha pong");
        return reply(sse("fixture mcp selection done"));
      });
      const fixturePort = await listen(fixture);
      fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
      const configDirectory = join(isolation.paths.config, "opencode");
      const configPath = join(configDirectory, "opencode.json");
      await writeFile(configPath, JSON.stringify(ownedConfig(fixturePort, fixturePath)), { mode: 0o600 });
      // Fixture setup only: the effective result is proven by status, markers and catalog, never by this readback.
      checks.ownedConfigWritten = ownedConfigMatchesPlan(JSON.parse(await readFile(configPath, "utf8")), fixturePath);
      if (!checks.ownedConfigWritten) throw stop("owned_config_invalid");

      // Production composition, as extension.ts does: inventory from the config directory, overlay from preferences.
      const inventory = resolveMcpInventory(configDirectory, isolation.paths.cwd);
      const mcpOverlay = buildMcpOverlay(inventory, selectionPrefs);
      const mcpTransport = Object.fromEntries(
        Object.entries(inventory.servers).map(([name, server]) => [name, server.transport]),
      );
      checks.inventoryProductionPath =
        Object.keys(inventory.servers).length === roles.length &&
        roles.every(
          (role) =>
            inventory.servers[serverNames[role]]?.explicitlyDisabled === selectionPlan[role].configDisabled &&
            inventory.servers[serverNames[role]]?.transport === "stdio",
        );
      checks.overlayProductionPath =
        Object.keys(mcpOverlay.mcp.servers).length === roles.length &&
        mcpOverlay.mcp.servers[serverNames.alpha]?.disabled === false &&
        mcpOverlay.mcp.servers[serverNames.beta]?.disabled === true &&
        mcpOverlay.mcp.servers[serverNames.gamma]?.disabled === false;
      if (!checks.inventoryProductionPath || !checks.overlayProductionPath) throw stop("production_overlay_unexpected");
      configBefore = await snapshotTree(isolation.paths.config);

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
      if (!checks.spawnGateClear) throw stop("spawn_gate_blocked");

      setStage("connect");
      // Production overlay agents/permissions are used unchanged; sandbox is off so no OS containment is claimed.
      agent = new OpenCodeAgent({
        workspacePath: isolation.paths.cwd,
        hostPaths: { config: configDirectory, state: isolation.paths.state },
        backend: "sdk",
        sandbox: {
          mode: "off",
          enabled: false,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [isolation.paths.cwd], readOnlyPaths: [] },
        },
        executable: { path: resolve(executable) },
        pluginSources: [],
        mcpOverlay,
        mcpTransport,
      });
      agent.onEvent((event: AgentEvent) => {
        if (event.type !== "session.status") return;
        if (event.properties.status.type === "busy") sessionState.busy = true;
        if (event.properties.status.type === "idle" && sessionState.busy) sessionState.idle = true;
      });
      await agent.connect();
      const connected = agent;

      setStage("selection");
      let lastStatus: Awaited<ReturnType<OpenCodeAgent["getMcpStatus"]>> = {};
      for (let read = 0; read < statusPollLimit && Date.now() < deadline && !overall.signal.aborted; read += 1) {
        try {
          lastStatus = await connected.getMcpStatus();
        } catch {
          lastStatus = {};
        }
        if (
          classifyStatus(lastStatus, serverNames.alpha) === "connected" &&
          classifyStatus(lastStatus, serverNames.beta) === "disabled"
        )
          break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, statusPollMs));
      }
      // Let any late (incorrect) child start of beta/gamma surface before the first absence check.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, settleMs));
      try {
        lastStatus = await connected.getMcpStatus();
      } catch {
        lastStatus = {};
      }
      for (const role of roles) mcpStatus[role] = classifyStatus(lastStatus, serverNames[role]);
      checks.mcpStatusAlphaConnected = mcpStatus.alpha === "connected";
      checks.mcpStatusBetaNotAvailable = mcpStatus.beta === "disabled";
      checks.mcpStatusGammaNotAvailable = mcpStatus.gamma === "absent" || mcpStatus.gamma === "disabled";
      await snapshotMarkers(fixturePath);
      checks.alphaMarkerPresent = startMarkers.alpha >= 1;
      checks.alphaStartedOnce = startMarkers.alpha === 1;
      checks.betaMarkerAbsentAfterSettle = startMarkers.beta === 0;
      checks.gammaMarkerAbsentAfterSettle = startMarkers.gamma === 0;

      setStage("catalog");
      const session = await connected.createSession("mcp selection");
      if (session.directory !== isolation.paths.cwd) throw stop("fixture_operation_failed");
      await connected.sendMessage(session.id, "fixture mcp selection probe", { primaryAgent: "scout" });
      while (
        Date.now() < deadline &&
        !overall.signal.aborted &&
        !(sessionState.busy && sessionState.idle && modelRequests >= expectedModelRequests)
      ) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      if (!(sessionState.busy && sessionState.idle && modelRequests >= expectedModelRequests))
        throw stop("session_idle_timeout");
      const history = await connected.getMessages(session.id);
      await snapshotMarkers(fixturePath);
      checks.betaMarkerAbsentAfterRun = startMarkers.beta === 0;
      checks.gammaMarkerAbsentAfterRun = startMarkers.gamma === 0;
      checks.mcpChildProcessCountBounded = mcpPids.length === 1 && mcpPids.length <= bounds.mcpChildProcesses;
      const seenCatalog = catalog as CatalogObservation | null;
      checks.catalogHasAlphaTool = seenCatalog?.alphaInCatalog === true;
      checks.catalogOmitsBetaAndGamma =
        seenCatalog !== null && seenCatalog.betaInRequest === false && seenCatalog.gammaInRequest === false;
      checks.noDirectMcpToolDuplication =
        seenCatalog !== null && catalogPass(seenCatalog) && seenCatalog.mcpNamesInDirectTools === 0;
      checks.alphaToolReachableThroughExecute = alphaResultObserved;
      checks.sessionIdleClean = assistantsClean(history);
      const diff = diffSnapshots(configBefore, await snapshotTree(isolation.paths.config));
      configObservation = {
        filesBefore: diff.filesBefore,
        filesChanged: diff.filesChanged,
        filesAdded: diff.filesAdded,
      };
      checks.noConfigWrites = diff.filesChanged === 0 && !diff.addedConfigFile && diff.filesBefore >= 1;

      checks.privateChildVersionAndPID =
        observedVersion === version && ownedPID !== undefined && ownedOrigin !== undefined;
      checks.modelRequestOrderExact = orderExact && modelRequests === expectedModelRequests;
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions,
        children: ownedPID ? 1 : 0,
        mcpChildProcesses: mcpPids.length,
        startMarkers: { ...startMarkers },
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
      manifest.counts = {
        apiRequests,
        modelRequests,
        sessions,
        children: ownedPID ? 1 : 0,
        mcpChildProcesses: mcpPids.length,
        startMarkers: { ...startMarkers },
        maxModelBodyBytes,
      };
      manifest.observed = { mcpStatus: { ...mcpStatus }, catalog, config: configObservation };
      manifest.preTeardown = {
        status: manifest.status,
        checks: { ...checks },
        counts: structuredClone(manifest.counts),
        observed: structuredClone(manifest.observed),
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
      // No forced kill: the groups and fixture children must exit through the adapter's own disconnect.
      const processGroupGone = ownedPID ? await waitGone([ownedPID], 3_000, true) : true;
      manifest.cleanup.processGroupReaped = ownedPID ? processGroupGone : false;
      manifest.cleanup.mcpChildrenGone = mcpPids.length > 0 ? await waitGone(mcpPids, 3_000) : false;
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
      expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
      expect(strictPass(saved), JSON.stringify(saved)).toBe(true);
    }
  });
});
