import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

// Opt-in native plugin-failure fixture. It records how native 2.1.4 handles failing local plugins at startup; it does
// not implement or claim an eligible plugin-free fallback. Native facts it relies on (core/src of the inspected tag):
// - plugin/supervisor.ts resolve(): `modules.load` failures (import throw, invalid default export) are caught by
//   `Effect.catchCause`, logged, and recorded as a `failures` entry `{source: {type:"local", path: <package dir>},
//   state: {status:"failed", error, ref}, features}`. The entry has NO `id` (schema/plugin.ts Info.id is optional) and
//   the server proceeds with the remaining plugins.
// - plugin.ts load()/activate(): a generation whose effect/setup throws is caught with `Effect.exit`, logged, and kept
//   as a slot with `error`; slotInfo() reports `{id, source: {type:"local", path: <entry file>}, state:{status:"failed",
//   error}}` (no ref). Activation runs under registry.hold(); `awaitActivation` (ready latch) reopens after the burst,
//   so the fixture polls plugin.list instead of assuming the list is complete on connect.
// - plugin/module.ts: the default export must be `{id, effect}` or `{id, setup}`; local directories resolve the `server`
//   entry (tries `server` + .ts/.tsx/.js/...), so each fixture package has `server.js` with `"type":"module"`.
// Persisted evidence is booleans/enums/counts only; native error text, paths and config never leave memory.
const enabled = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const rootPath = fileURLToPath(new URL("../../../../../", import.meta.url));
const version = "2.2.0";
const executableHash = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const evidencePrefix = "tmp/scribe-v2-migration/plugin-failure/";
const expectedModelRequests = 1;
const bounds = {
  overallMs: 90_000,
  apiRequests: 40,
  modelRequests: 1,
  sessions: 1,
  children: 1,
  pluginListReads: 12,
  modelBodyBytes: 512 * 1024,
} as const;
const pluginPollLimit = 8;
const pluginPollMs = 350;
const settleMs = 750;

const fixtureNames = ["throwsOnImport", "invalidExport", "activationThrows", "control"] as const;
type FixtureName = (typeof fixtureNames)[number];
type PluginState = "active" | "failed";
// `id: null` means native reports no id (module load failure); the failure entry's source is the package directory.
const fixturePlan = {
  throwsOnImport: { dir: "throws-on-import", id: null, state: "failed", kind: "load" },
  invalidExport: { dir: "invalid-export", id: null, state: "failed", kind: "load" },
  activationThrows: { dir: "activation-throws", id: "fixture.activation-throws", state: "failed", kind: "activation" },
  control: { dir: "control", id: "fixture.control", state: "active", kind: "none" },
} as const satisfies Record<
  FixtureName,
  { dir: string; id: string | null; state: PluginState; kind: "load" | "activation" | "none" }
>;

const checkNames = [
  "dedicatedFork",
  "clientMetadataPinned",
  "executableHashPinned",
  "projectLocalIsolation",
  "ambientGateClear",
  "spawnGateClear",
  "ownedConfigWritten",
  "fixturePackagesWritten",
  "connectSucceededWithFailingPlugins",
  "privateChildVersionAndPID",
  "pluginListComplete",
  "throwsOnImportFailed",
  "invalidExportFailed",
  "activationThrowsFailed",
  "controlActive",
  "noUnexpectedLocalPluginEntries",
  "sessionIdleClean",
  "toolIdsEmpty",
  "pluginStatesStableAfterRun",
  "noConfigWrites",
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
const stages = ["preflight", "connect", "plugins", "session", "pre_teardown", "cleanup", "complete"] as const;
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
  "connect_failed",
  "plugin_catalog_unavailable",
  "plugin_assertion_failed",
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
type Counts = {
  apiRequests: number;
  modelRequests: number;
  sessions: number;
  children: number;
  pluginListReads: number;
  maxModelBodyBytes: number;
};
type PluginObservation = {
  entries: number;
  status: PluginState | "absent" | "other";
  idMatches: boolean;
  sourceLocal: boolean;
};
type PluginCatalog = { fixtures: Record<FixtureName, PluginObservation>; unexpectedLocalEntries: number };
type Observed = {
  catalog: PluginCatalog | null;
  stableAfterRun: boolean | null;
  toolIds: number | null;
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
  fixturePlan: typeof fixturePlan;
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

/** Per-fixture package source. Each is a real local plugin directory: package.json plus the `server.js` entry. */
const fixtureSources: Record<FixtureName, string> = {
  throwsOnImport: `throw new Error("fixture");\nexport default { id: "fixture.throws-on-import", setup: async () => {} };\n`,
  invalidExport: `export default { notAPlugin: true };\n`,
  activationThrows: `export default {\n  id: "fixture.activation-throws",\n  setup: async () => {\n    throw new Error("fixture");\n  },\n};\n`,
  control: `export default { id: "fixture.control", setup: async () => {} };\n`,
};

type FixturePaths = Record<FixtureName, string>;
function fixturePaths(isolation: V2TestIsolation): FixturePaths {
  // Not named `plugin`/`plugins`: native auto-discovers those child directories of a config root.
  const base = join(isolation.paths.cwd, "plugin-fixture");
  return Object.fromEntries(fixtureNames.map((name) => [name, join(base, fixturePlan[name].dir)])) as FixturePaths;
}
async function writeFixturePackages(paths: FixturePaths): Promise<void> {
  for (const name of fixtureNames) {
    await mkdir(paths[name], { recursive: true });
    await writeFile(
      join(paths[name], "package.json"),
      `${JSON.stringify({ name: `scribe-fixture-${fixturePlan[name].dir}`, version: "0.0.0", private: true, type: "module" })}\n`,
      { mode: 0o600 },
    );
    await writeFile(join(paths[name], "server.js"), fixtureSources[name], { mode: 0o600 });
  }
}

/** Owned global config: a local mock provider and the four absolute-path local plugins, nothing else. */
function ownedConfig(port: number, paths: FixturePaths) {
  return {
    model: "fixture-provider/fixture-model",
    enabledProviders: ["fixture-provider"],
    providers: {
      "fixture-provider": {
        name: "Local plugin failure fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { "fixture-model": { name: "Fixture model" } },
      },
    },
    plugins: fixtureNames.map((name) => paths[name]),
  };
}
function ownedConfigMatchesPlan(value: unknown, paths: FixturePaths): boolean {
  if (!record(value) || !Array.isArray(value.plugins)) return false;
  const configured: unknown[] = value.plugins;
  const expected = fixtureNames.map((name) => paths[name]);
  return (
    configured.length === expected.length &&
    expected.every((path, index) => configured[index] === path) &&
    value.mcp === undefined &&
    value.policies === undefined &&
    Object.keys(value).length === 4
  );
}

function within(directory: string, candidate: string): boolean {
  return candidate === directory || candidate.startsWith(`${directory}${sep}`);
}
/** Summarize native `plugin.list` data per fixture package; returns null for a malformed catalog. */
function observePlugins(data: unknown, paths: FixturePaths): PluginCatalog | null {
  if (!Array.isArray(data)) return null;
  const matched: Record<FixtureName, Array<Record<string, unknown>>> = {
    throwsOnImport: [],
    invalidExport: [],
    activationThrows: [],
    control: [],
  };
  let unexpectedLocalEntries = 0;
  for (const entry of data as readonly unknown[]) {
    if (!record(entry) || !record(entry.source) || !record(entry.state)) return null;
    if (typeof entry.source.type !== "string" || typeof entry.state.status !== "string") return null;
    if (entry.source.type !== "local") continue;
    if (typeof entry.source.path !== "string") return null;
    const sourcePath = entry.source.path;
    const owner = fixtureNames.find((name) => within(paths[name], sourcePath));
    if (owner) matched[owner].push(entry);
    else unexpectedLocalEntries += 1;
  }
  const fixtures = Object.fromEntries(
    fixtureNames.map((name) => {
      const entries = matched[name];
      const first = entries[0];
      const state = first && record(first.state) ? first.state.status : undefined;
      const expectedId = fixturePlan[name].id;
      const observation: PluginObservation = {
        entries: entries.length,
        status: !first ? "absent" : state === "active" || state === "failed" ? state : "other",
        idMatches: !!first && (expectedId === null ? first.id === undefined : first.id === expectedId),
        sourceLocal: !!first && record(first.source) && first.source.type === "local",
      };
      return [name, observation];
    }),
  ) as Record<FixtureName, PluginObservation>;
  return { fixtures, unexpectedLocalEntries };
}
function catalogComplete(catalog: PluginCatalog | null): boolean {
  return catalog !== null && fixtureNames.every((name) => catalog.fixtures[name].entries === 1);
}
function fixtureMatchesPlan(catalog: PluginCatalog | null, name: FixtureName): boolean {
  const observation = catalog?.fixtures[name];
  return (
    observation !== undefined &&
    observation.entries === 1 &&
    observation.status === fixturePlan[name].state &&
    observation.idMatches &&
    observation.sourceLocal
  );
}
function catalogPass(value: unknown): value is PluginCatalog {
  if (!record(value) || !record(value.fixtures)) return false;
  const fixtures = value.fixtures;
  return (
    Object.keys(fixtures).length === fixtureNames.length &&
    fixtureNames.every((name) => {
      const entry = fixtures[name];
      return (
        record(entry) &&
        entry.entries === 1 &&
        entry.status === fixturePlan[name].state &&
        entry.idMatches === true &&
        entry.sourceLocal === true &&
        Object.keys(entry).length === 4
      );
    }) &&
    value.unexpectedLocalEntries === 0
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

const forbiddenContent =
  /"(?:command|environment|env|policies|servers|mcp|plugins|path|error|ref|message|source|headers|authorization|token|secret)"\s*:/iu;
function containsForbiddenContent(text: string): boolean {
  return forbiddenContent.test(text);
}

function validCounts(value: Record<string, unknown>): boolean {
  return (
    Number.isInteger(value.apiRequests) &&
    Number(value.apiRequests) >= 0 &&
    Number(value.apiRequests) <= bounds.apiRequests &&
    value.modelRequests === expectedModelRequests &&
    Number(value.modelRequests) <= bounds.modelRequests &&
    value.sessions === bounds.sessions &&
    value.children === bounds.children &&
    Number.isInteger(value.pluginListReads) &&
    Number(value.pluginListReads) >= 2 &&
    Number(value.pluginListReads) <= bounds.pluginListReads &&
    Number.isInteger(value.maxModelBodyBytes) &&
    Number(value.maxModelBodyBytes) > 0 &&
    Number(value.maxModelBodyBytes) <= bounds.modelBodyBytes
  );
}
function validObserved(value: unknown): boolean {
  if (!record(value) || !record(value.config)) return false;
  const config = value.config;
  return (
    catalogPass(value.catalog) &&
    value.stableAfterRun === true &&
    value.toolIds === 0 &&
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
    !record(value.fixturePlan) ||
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
    JSON.stringify(value.fixturePlan) === JSON.stringify(fixturePlan) &&
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
function passingCatalog(): PluginCatalog {
  return {
    fixtures: Object.fromEntries(
      fixtureNames.map((name) => [
        name,
        { entries: 1, status: fixturePlan[name].state, idMatches: true, sourceLocal: true },
      ]),
    ) as Record<FixtureName, PluginObservation>,
    unexpectedLocalEntries: 0,
  };
}
function strictManifestFixture(): Manifest {
  const counts: Counts = {
    apiRequests: 20,
    modelRequests: expectedModelRequests,
    sessions: 1,
    children: 1,
    pluginListReads: 3,
    maxModelBodyBytes: 20_000,
  };
  const checks = Object.fromEntries(checkNames.map((name) => [name, true])) as Manifest["checks"];
  const observed: Observed = {
    catalog: passingCatalog(),
    stableAfterRun: true,
    toolIds: 0,
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
    fixturePlan,
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

describe("native V2 plugin failure fixture tooling", () => {
  it("writes four local plugin packages whose modules behave as the plan states", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const paths = fixturePaths(isolation);
      await writeFixturePackages(paths);
      const load = (name: FixtureName) => import(/* @vite-ignore */ pathToFileURL(join(paths[name], "server.js")).href);
      await expect(load("throwsOnImport")).rejects.toThrow("fixture");
      const invalid = (await load("invalidExport")) as { default: Record<string, unknown> };
      expect(invalid.default.id).toBeUndefined();
      expect(invalid.default.effect).toBeUndefined();
      expect(invalid.default.setup).toBeUndefined();
      const activation = (await load("activationThrows")) as { default: { id: string; setup: () => Promise<void> } };
      expect(activation.default.id).toBe(fixturePlan.activationThrows.id);
      await expect(activation.default.setup()).rejects.toThrow("fixture");
      const control = (await load("control")) as { default: { id: string; setup: () => Promise<void> } };
      expect(control.default.id).toBe(fixturePlan.control.id);
      await expect(control.default.setup()).resolves.toBeUndefined();
      for (const name of fixtureNames) {
        const manifest = JSON.parse(await readFile(join(paths[name], "package.json"), "utf8")) as Record<
          string,
          unknown
        >;
        expect(manifest.type).toBe("module");
        expect(fixturePaths(isolation)[name]).not.toMatch(/[\\/]plugins?(?:[\\/]|$)/u);
      }
    } finally {
      await isolation.dispose();
    }
  });

  it("rejects owned configs that drift from the plugin plan", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const paths = fixturePaths(isolation);
      const base = ownedConfig(1, paths);
      expect(ownedConfigMatchesPlan(base, paths)).toBe(true);
      expect(ownedConfigMatchesPlan({ ...base, plugins: [] }, paths)).toBe(false);
      expect(ownedConfigMatchesPlan({ ...base, plugins: [...base.plugins].reverse() }, paths)).toBe(false);
      expect(ownedConfigMatchesPlan({ ...base, plugins: [...base.plugins, "-*"] }, paths)).toBe(false);
      expect(ownedConfigMatchesPlan({ ...base, plugins: [...base.plugins.slice(0, 3), "./x"] }, paths)).toBe(false);
      expect(ownedConfigMatchesPlan({ ...base, mcp: { servers: {} } }, paths)).toBe(false);
      expect(ownedConfigMatchesPlan({ ...base, policies: [] }, paths)).toBe(false);
      expect(ownedConfigMatchesPlan(null, paths)).toBe(false);
      for (const entry of base.plugins) expect(isAbsolute(entry)).toBe(true);
    } finally {
      await isolation.dispose();
    }
  });

  it("classifies native plugin.list entries per fixture package without trusting presence alone", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const paths = fixturePaths(isolation);
      const good = [
        { source: { type: "builtin" }, state: { status: "active" }, features: {} },
        { source: { type: "local", path: paths.throwsOnImport }, state: { status: "failed", error: "x", ref: "r" } },
        { source: { type: "local", path: paths.invalidExport }, state: { status: "failed", error: "x", ref: "r" } },
        {
          id: "fixture.activation-throws",
          source: { type: "local", path: join(paths.activationThrows, "server.js") },
          state: { status: "failed", error: "x" },
        },
        {
          id: "fixture.control",
          source: { type: "local", path: join(paths.control, "server.js") },
          state: { status: "active" },
        },
      ];
      const observed = observePlugins(good, paths);
      expect(catalogComplete(observed)).toBe(true);
      expect(catalogPass(observed)).toBe(true);
      for (const name of fixtureNames) expect(fixtureMatchesPlan(observed, name)).toBe(true);
      expect(JSON.stringify(observed)).not.toContain(paths.control);

      const drift = (mutate: (entries: typeof good) => unknown) => observePlugins(mutate(structuredClone(good)), paths);
      // Control reported failed, a load failure reported active, or an activation failure missing its id must not pass.
      expect(
        catalogPass(drift((entries) => [...entries.slice(0, 4), { ...entries[4], state: { status: "failed" } }])),
      ).toBe(false);
      expect(
        catalogPass(
          drift((entries) => [{ ...entries[0] }, { ...entries[1], state: { status: "active" } }, ...entries.slice(2)]),
        ),
      ).toBe(false);
      expect(
        catalogPass(
          drift((entries) => entries.map((entry, index) => (index === 3 ? { ...entry, id: undefined } : entry))),
        ),
      ).toBe(false);
      expect(
        catalogPass(drift((entries) => entries.map((entry, index) => (index === 1 ? { ...entry, id: "x" } : entry)))),
      ).toBe(false);
      // A missing fixture, a duplicate entry, and an unexpected local entry are rejected.
      expect(catalogPass(drift((entries) => entries.filter((_, index) => index !== 2)))).toBe(false);
      expect(catalogComplete(drift((entries) => entries.filter((_, index) => index !== 2)))).toBe(false);
      expect(catalogPass(drift((entries) => [...entries, entries[4]]))).toBe(false);
      expect(
        catalogPass(
          drift((entries) => [
            ...entries,
            { source: { type: "local", path: join(isolation.paths.cwd, "elsewhere") }, state: { status: "active" } },
          ]),
        ),
      ).toBe(false);
      // A prefix-sibling path is not within a fixture directory.
      expect(
        observePlugins(
          [{ source: { type: "local", path: `${paths.control}-other` }, state: { status: "active" } }],
          paths,
        )?.unexpectedLocalEntries,
      ).toBe(1);
      // Unknown status is "other", never silently healthy or failed.
      expect(
        observePlugins(
          [{ id: "fixture.control", source: { type: "local", path: paths.control }, state: { status: "pending" } }],
          paths,
        )?.fixtures.control.status,
      ).toBe("other");
      // Malformed catalogs are unobservable rather than empty.
      expect(observePlugins(undefined, paths)).toBeNull();
      expect(observePlugins([{ source: {}, state: { status: "active" } }], paths)).toBeNull();
      expect(observePlugins([{ source: { type: "local" }, state: { status: "active" } }], paths)).toBeNull();
      expect(observePlugins([null], paths)).toBeNull();
      expect(catalogPass(null)).toBe(false);
      expect(fixtureMatchesPlan(null, "control")).toBe(false);
    } finally {
      await isolation.dispose();
    }
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
  });

  it("flags plugin, config, error and credential content in a persisted manifest", () => {
    expect(containsForbiddenContent(JSON.stringify(strictManifestFixture()))).toBe(false);
    expect(containsForbiddenContent('{"plugins":[]}')).toBe(true);
    expect(containsForbiddenContent('{"path":"/x"}')).toBe(true);
    expect(containsForbiddenContent('{"error":"boom"}')).toBe(true);
    expect(containsForbiddenContent('{"ref":"err_1"}')).toBe(true);
    expect(containsForbiddenContent('{"source":{}}')).toBe(true);
    expect(containsForbiddenContent('{"command":["node"]}')).toBe(true);
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
    expect(strictPass({ ...base, failureCode: "plugin_assertion_failed" })).toBe(false);
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
    expect(strictPass({ ...base, evidencePath: "tmp/scribe-v2-migration/mcp-selection/x/result.json" })).toBe(false);
    expect(strictPass({ ...base, bounds: { ...bounds, modelRequests: 99 } })).toBe(false);
    expect(
      strictPass({
        ...base,
        fixturePlan: { ...fixturePlan, control: { ...fixturePlan.control, state: "failed" } },
      }),
    ).toBe(false);
    for (const name of checkNames) {
      expect(strictPass({ ...base, checks: { ...base.checks, [name]: false } }), name).toBe(false);
      expect(strictPass(withPre({ checks: { ...base.checks, [name]: false } })), name).toBe(false);
    }
    // A check that was never initialized must not pass.
    const { controlActive: _omitted, ...withoutControlCheck } = base.checks;
    expect(strictPass({ ...base, checks: withoutControlCheck })).toBe(false);
    expect(strictPass({ ...base, preTeardown: undefined })).toBe(false);
    expect(strictPass(withPre({ status: "PASS" }))).toBe(false);
    expect(strictPass(withPre({ failureCode: "plugin_assertion_failed" }))).toBe(false);

    for (const name of cleanupNames) {
      expect(strictPass({ ...base, cleanup: { ...base.cleanup, [name]: false } }), name).toBe(false);
      expect(strictPass({ ...base, cleanup: { ...base.cleanup, [name]: null } }), name).toBe(false);
    }

    const countPatches: Array<Partial<Counts>> = [
      { apiRequests: bounds.apiRequests + 1 },
      { apiRequests: -1 },
      { modelRequests: bounds.modelRequests + 1 },
      { modelRequests: 0 },
      { sessions: 2 },
      { sessions: 0 },
      { children: 2 },
      { children: 0 },
      { pluginListReads: 1 },
      { pluginListReads: bounds.pluginListReads + 1 },
      { maxModelBodyBytes: bounds.modelBodyBytes + 1 },
      { maxModelBodyBytes: 0 },
    ];
    for (const patch of countPatches) {
      expect(strictPass({ ...base, counts: { ...base.counts, ...patch } }), JSON.stringify(patch)).toBe(false);
      expect(strictPass(withPre({ counts: { ...base.counts, ...patch } })), JSON.stringify(patch)).toBe(false);
    }

    const catalog = base.observed.catalog as PluginCatalog;
    const patchFixture = (name: FixtureName, patch: Partial<PluginObservation>): PluginCatalog => ({
      ...catalog,
      fixtures: { ...catalog.fixtures, [name]: { ...catalog.fixtures[name], ...patch } },
    });
    const observedPatches: Array<Partial<Observed>> = [
      { catalog: null },
      { catalog: patchFixture("control", { status: "failed" }) },
      { catalog: patchFixture("control", { status: "absent", entries: 0 }) },
      { catalog: patchFixture("throwsOnImport", { status: "active" }) },
      { catalog: patchFixture("invalidExport", { status: "other" }) },
      { catalog: patchFixture("activationThrows", { status: "active" }) },
      { catalog: patchFixture("activationThrows", { idMatches: false }) },
      { catalog: patchFixture("invalidExport", { entries: 2 }) },
      { catalog: patchFixture("control", { sourceLocal: false }) },
      { catalog: { ...catalog, unexpectedLocalEntries: 1 } },
      { stableAfterRun: false },
      { stableAfterRun: null },
      { toolIds: 1 },
      { toolIds: null },
      { config: null },
      { config: { filesBefore: 1, filesChanged: 1, filesAdded: 0 } },
      { config: { filesBefore: 0, filesChanged: 0, filesAdded: 0 } },
    ];
    for (const patch of observedPatches) {
      const observed = { ...base.observed, ...patch };
      expect(strictPass({ ...base, observed }), JSON.stringify(patch)).toBe(false);
      expect(strictPass(withPre({ observed })), JSON.stringify(patch)).toBe(false);
    }
    // The final copy must equal the frozen pre-teardown copy.
    expect(
      strictPass({
        ...base,
        observed: { ...base.observed, config: { filesBefore: 2, filesChanged: 0, filesAdded: 0 } },
      }),
    ).toBe(false);
    expect(strictPass({ ...base, counts: { ...base.counts, apiRequests: 21 } })).toBe(false);
    expect(strictPass({ ...base, extra: { command: ["node"] } })).toBe(false);
  });

  it("observes native handling of failing local plugins through the production agent", {
    skip: !enabled,
    timeout: bounds.overallMs + 20_000,
  }, async () => {
    const forkProcess = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof forkProcess.send === "function" && forkProcess.connected === true;
    const root = await realpath(rootPath);
    const base = resolve(root, "tmp/scribe-v2-migration/plugin-failure");
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
    let pluginListReads = 0;
    let maxModelBodyBytes = 0;
    let fixtureOrigin: string | undefined;
    let ownedOrigin: string | undefined;
    let orderExact = true;
    let configBefore: TreeSnapshot | undefined;
    let catalog: PluginCatalog | null = null;
    let stableAfterRun: boolean | null = null;
    let toolIds: number | null = null;
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
      fixturePlan,
      counts: { apiRequests: 0, modelRequests: 0, sessions: 0, children: 0, pluginListReads: 0, maxModelBodyBytes: 0 },
      checks,
      observed: { catalog: null, stableAfterRun: null, toolIds: null, config: null },
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
    const sessionState = { busy: false, idle: false };
    const stop = (code: FailureCode) => Object.assign(new Error(code), { code });
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
      const pluginPaths = fixturePaths(isolation);
      await writeFixturePackages(pluginPaths);
      checks.fixturePackagesWritten = true;

      fixture = createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          fail("unexpected_mock_route");
          response.writeHead(404).end();
          return;
        }
        modelRequests += 1;
        if (modelRequests > expectedModelRequests) {
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
        try {
          JSON.parse(raw);
        } catch {
          fail("invalid_model_body");
          response.writeHead(400).end();
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.end(sse("fixture plugin failure done"));
      });
      const fixturePort = await listen(fixture);
      fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
      const configDirectory = join(isolation.paths.config, "opencode");
      const configPath = join(configDirectory, "opencode.json");
      await writeFile(configPath, JSON.stringify(ownedConfig(fixturePort, pluginPaths)), { mode: 0o600 });
      // Fixture setup only: the effective result is proven by native plugin.list, never by this readback.
      checks.ownedConfigWritten = ownedConfigMatchesPlan(JSON.parse(await readFile(configPath, "utf8")), pluginPaths);
      if (!checks.ownedConfigWritten) throw stop("owned_config_invalid");
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
      // Production agent unchanged: no Hindsight/plugin source is composed (pluginSources empty), so the only plugins
      // are the owned global-config ones. Sandbox is off, so no OS containment is claimed.
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
      });
      agent.onEvent((event: AgentEvent) => {
        if (event.type !== "session.status") return;
        if (event.properties.status.type === "busy") sessionState.busy = true;
        if (event.properties.status.type === "idle" && sessionState.busy) sessionState.idle = true;
      });
      try {
        await agent.connect();
        checks.connectSucceededWithFailingPlugins = true;
      } catch {
        throw stop("connect_failed");
      }
      const connected = agent;
      const native = (connected as unknown as { v2Client?: OpenCodeClient }).v2Client;
      if (!native) throw stop("plugin_catalog_unavailable");
      const workspace = isolation.paths.cwd;
      const readCatalog = async (): Promise<PluginCatalog | null> => {
        pluginListReads += 1;
        try {
          const response: unknown = await native.plugin.list({ location: { directory: workspace } });
          return record(response) ? observePlugins(response.data, pluginPaths) : null;
        } catch {
          return null;
        }
      };

      setStage("plugins");
      // Activation runs under the registry hold; poll until every fixture package is reported (bounded).
      for (let read = 0; read < pluginPollLimit && Date.now() < deadline && !overall.signal.aborted; read += 1) {
        catalog = await readCatalog();
        if (catalogComplete(catalog)) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, pluginPollMs));
      }
      // Let a late reload (e.g. a watcher-triggered re-activation) surface before the observation is frozen.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, settleMs));
      catalog = (await readCatalog()) ?? catalog;
      checks.pluginListComplete = catalogComplete(catalog);
      if (catalog === null) throw stop("plugin_catalog_unavailable");
      checks.throwsOnImportFailed = fixtureMatchesPlan(catalog, "throwsOnImport");
      checks.invalidExportFailed = fixtureMatchesPlan(catalog, "invalidExport");
      checks.activationThrowsFailed = fixtureMatchesPlan(catalog, "activationThrows");
      checks.controlActive = fixtureMatchesPlan(catalog, "control");
      checks.noUnexpectedLocalPluginEntries = catalog.unexpectedLocalEntries === 0;

      setStage("session");
      const session = await connected.createSession("plugin failure");
      if (session.directory !== isolation.paths.cwd) throw stop("fixture_operation_failed");
      await connected.sendMessage(session.id, "fixture plugin failure probe", { primaryAgent: "scout" });
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
      checks.sessionIdleClean = assistantsClean(history);
      // No Hindsight plugin was launched, so the production inventory must be empty (and needs no native call).
      toolIds = (await connected.getToolIds()).length;
      checks.toolIdsEmpty = toolIds === 0;
      const after = await readCatalog();
      stableAfterRun = after !== null && JSON.stringify(after) === JSON.stringify(catalog) && catalogComplete(after);
      checks.pluginStatesStableAfterRun = stableAfterRun;
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
        pluginListReads,
        maxModelBodyBytes,
      };
      checks.requestBounds =
        Date.now() - started <= bounds.overallMs && validCounts({ ...manifest.counts }) && ownedPID !== undefined;
      manifest.status = checkNames.every((key) => checks[key]) ? "RUNNING" : "FAIL";
      // The exact native state is already recorded in observed.catalog; a deviation is a finding, not a forced PASS.
      if (manifest.status === "FAIL") manifest.failureCode = "plugin_assertion_failed";
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
        pluginListReads,
        maxModelBodyBytes,
      };
      manifest.observed = { catalog, stableAfterRun, toolIds, config: configObservation };
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
      // No forced kill: the child group must exit through the adapter's own disconnect.
      const processGroupGone = ownedPID ? await waitGone([ownedPID], 3_000, true) : true;
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
      expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
      expect(strictPass(saved), JSON.stringify(saved)).toBe(true);
    }
  });
});
