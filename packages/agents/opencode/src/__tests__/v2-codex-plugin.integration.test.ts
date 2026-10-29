import { createHash, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

// Opt-in native fixture for the locally qualifiable subset of task 3.5 (delivered Codex quota-retry plugin).
// It executes the user's delivered plugin code, so it needs its own explicit opt-in on top of the adapter gate.
// Native facts it relies on (core/src and plugin/src of the inspected tag):
// - plugin/source-directory.ts discover(): every `<config dir>/{plugin,plugins}/` child is a candidate; a `symlink`
//   entry ending in .ts/.js is admitted when `fs.isFile` (stat, follows the link) is true. The target stays the link path.
// - config/plugin/source.ts scan(): a non-directory absolute target becomes `{server: file URL of the link}`;
//   plugin/module.ts load() reports `source: {type:"local", path: <link path>}` (not the realpath) and imports the link
//   via the runtime loader, which resolves relative imports (`../lib/...`) from the real file location.
// - plugin/src/source.bun.ts prepareSource() scans imports relative to the LINK path (a nonexistent owned `lib`); that
//   scan only tracks/watches and falls back to `track(dirname)`, it never fails the load.
// - Explicit `plugins` config entries that are files are rejected, so discovery through the owned plugins directory is
//   the only file-plugin lane; this fixture therefore writes no `plugins` config key.
// The delivered lib acts only on the hard-coded chatgpt.com Codex origin, so this lane proves only: module-evaluation
// install succeeded in a fresh process, non-Codex traffic passes through, the private correlation header never reaches a
// provider, and delivered files are untouched. Persisted evidence is booleans/enums/counts/hashes only.
const enabled = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const codexOptIn = process.env.OPENCODE_CHAT_RUN_V2_CODEX_PLUGIN === "1";
const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const rootPath = fileURLToPath(new URL("../../../../../", import.meta.url));
const version = "2.2.0";
const executableHash = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const evidencePrefix = "tmp/scribe-v2-migration/codex-plugin/";
const pluginId = "codex-quota-retry";
const privateHeader = "x-opencode-codex-quota-retry-correlation";
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
const hex64 = /^[0-9a-f]{64}$/u;

const checkNames = [
  "dedicatedFork",
  "clientMetadataPinned",
  "executableHashPinned",
  "deliveredFilesHashedBefore",
  "deliveredLibResolutionMatches",
  "projectLocalIsolation",
  "ambientGateClear",
  "spawnGateClear",
  "deliveredPluginSymlinked",
  "ownedConfigWritten",
  "connectSucceeded",
  "privateChildVersionAndPID",
  "pluginListComplete",
  "pluginActive",
  "noUnexpectedLocalPluginEntries",
  "sessionIdleClean",
  "pluginStateStableAfterRun",
  "modelRequestOrderExact",
  "noPrivateHeaderAtProvider",
  "modelRequestsLoopbackOnly",
  "deliveredFilesUnchanged",
  "noConfigWrites",
  "requestBounds",
] as const;
const cleanupNames = [
  "agentDisconnected",
  "processGroupReaped",
  "fixtureClosed",
  "deliveredFilesUnchangedAfterCleanup",
  "isolationRemoved",
  "stateAbsent",
  "databaseAbsent",
  "environmentRestored",
  "fetchRestored",
] as const;
const stages = ["preflight", "connect", "plugin", "session", "pre_teardown", "cleanup", "complete"] as const;
const failureCodes = [
  "dedicated_fork_required",
  "explicit_executable_required",
  "client_metadata_mismatch",
  "executable_unavailable",
  "executable_hash_mismatch",
  "delivered_files_unavailable",
  "delivered_resolution_mismatch",
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
  "symlink_install_failed",
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
  "delivered_files_unavailable",
  "delivered_resolution_mismatch",
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
type SourceKind = "link" | "realpath" | "other" | "absent";
type PluginObservation = {
  entries: number;
  status: "active" | "failed" | "absent" | "other";
  idMatches: boolean;
  sourceKind: SourceKind;
  unexpectedLocalEntries: number;
};
type Delivered = {
  entrySha256Before: string | null;
  entrySha256After: string | null;
  libSha256Before: string | null;
  libSha256After: string | null;
  unchanged: boolean | null;
};
type ProviderObservation = { requestsInspected: number; requestsWithPrivateHeader: number; nonLoopbackPeers: number };
type Observed = {
  plugin: PluginObservation | null;
  stableAfterRun: boolean | null;
  delivered: Delivered;
  provider: ProviderObservation;
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
function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Delivered file locations under a home directory; pure so default tests never touch the real home. */
function deliveredLocations(home: string) {
  const configRoot = join(home, ".config", "opencode");
  return {
    entry: join(configRoot, "plugins", "codex-quota-retry.ts"),
    lib: join(configRoot, "lib", "codex-quota-retry.ts"),
  };
}
async function hashFile(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path));
  } catch {
    return null;
  }
}

/** The owned plugins directory entry that the fixture symlinks to the delivered plugin. */
function linkPath(isolation: V2TestIsolation): string {
  return join(isolation.paths.config, "opencode", "plugins", "codex-quota-retry.ts");
}
/** Create the owned-plugins symlink and verify the link, its target, and containment. */
async function installSymlink(isolation: V2TestIsolation, target: string): Promise<boolean> {
  const link = linkPath(isolation);
  await mkdir(dirname(link), { recursive: true });
  await assertOwnedPath(isolation.root, dirname(link));
  await symlink(target, link);
  const info = await lstat(link);
  return (
    info.isSymbolicLink() &&
    (await readlink(link)) === target &&
    (await realpath(link)) === target &&
    within(await realpath(isolation.root), dirname(link))
  );
}

function within(directory: string, candidate: string): boolean {
  return candidate === directory || candidate.startsWith(`${directory}${sep}`);
}
function ownedConfig(port: number) {
  return {
    model: "fixture-provider/fixture-model",
    enabledProviders: ["fixture-provider"],
    providers: {
      "fixture-provider": {
        name: "Local codex plugin fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${port}/v1` },
        models: { "fixture-model": { name: "Fixture model" } },
      },
    },
  };
}
function ownedConfigMatchesPlan(value: unknown): boolean {
  return (
    record(value) &&
    Object.keys(value).length === 3 &&
    value.plugins === undefined &&
    value.mcp === undefined &&
    value.policies === undefined &&
    typeof value.model === "string" &&
    Array.isArray(value.enabledProviders)
  );
}

/** Summarize native `plugin.list` for the delivered plugin; returns null for a malformed catalog. */
function observePlugin(data: unknown, link: string, real: string): PluginObservation | null {
  if (!Array.isArray(data)) return null;
  const matched: Array<Record<string, unknown>> = [];
  let sourceKind: SourceKind = "absent";
  let unexpectedLocalEntries = 0;
  for (const entry of data as readonly unknown[]) {
    if (!record(entry) || !record(entry.source) || !record(entry.state)) return null;
    if (typeof entry.source.type !== "string" || typeof entry.state.status !== "string") return null;
    if (entry.source.type !== "local") continue;
    if (typeof entry.source.path !== "string") return null;
    const sourcePath = entry.source.path;
    if (sourcePath === link || sourcePath === real) {
      matched.push(entry);
      if (matched.length === 1) sourceKind = sourcePath === link ? "link" : "realpath";
    } else unexpectedLocalEntries += 1;
  }
  const first = matched[0];
  const state = first && record(first.state) ? first.state.status : undefined;
  return {
    entries: matched.length,
    status: !first ? "absent" : state === "active" || state === "failed" ? state : "other",
    idMatches: !!first && first.id === pluginId,
    sourceKind: first ? sourceKind : "other",
    unexpectedLocalEntries,
  };
}
function pluginPass(value: unknown): value is PluginObservation {
  return (
    record(value) &&
    Object.keys(value).length === 5 &&
    value.entries === 1 &&
    value.status === "active" &&
    value.idMatches === true &&
    (value.sourceKind === "link" || value.sourceKind === "realpath") &&
    value.unexpectedLocalEntries === 0
  );
}

type TreeSnapshot = Map<string, string>;
/** Fingerprint a tree; symlinks are recorded by link-target hash and never followed. */
async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const snapshot: TreeSnapshot = new Map();
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isSymbolicLink()) {
        snapshot.set(relative(root, full), `link:${sha256(Buffer.from(await readlink(full)))}`);
      } else if (entry.isFile()) {
        const [bytes, info] = await Promise.all([readFile(full), stat(full)]);
        snapshot.set(relative(root, full), `${sha256(bytes)}:${info.mtimeMs}:${info.size}`);
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

/** True when any raw header name is the private correlation header or another quota-retry marker. */
function hasPrivateHeader(rawHeaders: readonly string[]): boolean {
  return rawHeaders.some((value, index) => {
    if (index % 2 !== 0) return false;
    const name = value.toLowerCase();
    return name === privateHeader || name.includes("codex-quota-retry");
  });
}
function isLoopbackPeer(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const forbiddenContent =
  /"(?:command|environment|env|policies|servers|mcp|plugins|path|error|ref|message|source|headers|authorization|token|secret)"\s*:/iu;
function containsForbiddenContent(text: string): boolean {
  return forbiddenContent.test(text) || text.includes(".config/opencode") || text.includes(homedir());
}

function validCounts(value: Record<string, unknown>): boolean {
  return (
    Number.isInteger(value.apiRequests) &&
    Number(value.apiRequests) >= 0 &&
    Number(value.apiRequests) <= bounds.apiRequests &&
    value.modelRequests === expectedModelRequests &&
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
function validDelivered(value: unknown): boolean {
  if (!record(value) || Object.keys(value).length !== 5) return false;
  const { entrySha256Before, entrySha256After, libSha256Before, libSha256After } = value;
  return (
    [entrySha256Before, entrySha256After, libSha256Before, libSha256After].every(
      (hash) => typeof hash === "string" && hex64.test(hash),
    ) &&
    entrySha256Before === entrySha256After &&
    libSha256Before === libSha256After &&
    value.unchanged === true
  );
}
function validObserved(value: unknown): boolean {
  if (!record(value) || !record(value.config) || !record(value.provider)) return false;
  const config = value.config;
  const provider = value.provider;
  return (
    Object.keys(value).length === 5 &&
    pluginPass(value.plugin) &&
    value.stableAfterRun === true &&
    validDelivered(value.delivered) &&
    Object.keys(provider).length === 3 &&
    provider.requestsInspected === expectedModelRequests &&
    provider.requestsWithPrivateHeader === 0 &&
    provider.nonLoopbackPeers === 0 &&
    Number.isInteger(config.filesBefore) &&
    Number(config.filesBefore) >= 2 &&
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
function passingObserved(): Observed {
  return {
    plugin: { entries: 1, status: "active", idMatches: true, sourceKind: "link", unexpectedLocalEntries: 0 },
    stableAfterRun: true,
    delivered: {
      entrySha256Before: "a".repeat(64),
      entrySha256After: "a".repeat(64),
      libSha256Before: "b".repeat(64),
      libSha256After: "b".repeat(64),
      unchanged: true,
    },
    provider: { requestsInspected: expectedModelRequests, requestsWithPrivateHeader: 0, nonLoopbackPeers: 0 },
    config: { filesBefore: 2, filesChanged: 0, filesAdded: 0 },
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
  const observed = passingObserved();
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

describe("native V2 delivered Codex plugin fixture tooling", () => {
  it("derives delivered locations from a supplied home without touching the filesystem", () => {
    const locations = deliveredLocations("/nonexistent-home");
    expect(locations.entry).toBe(join("/nonexistent-home", ".config", "opencode", "plugins", "codex-quota-retry.ts"));
    expect(locations.lib).toBe(join("/nonexistent-home", ".config", "opencode", "lib", "codex-quota-retry.ts"));
    expect(relative(dirname(locations.entry), locations.lib)).toBe(join("..", "lib", "codex-quota-retry.ts"));
  });

  it("symlinks an owned plugins entry to a target, verifies it, and leaves the target when disposed", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const target = join(isolation.paths.cwd, "benign.ts");
      await writeFile(target, "export default {};\n", { mode: 0o600 });
      const canonical = await realpath(target);
      expect(await installSymlink(isolation, canonical)).toBe(true);
      expect(within(isolation.paths.config, linkPath(isolation))).toBe(true);
      expect((await lstat(linkPath(isolation))).isSymbolicLink()).toBe(true);
      // A second install over the same name must not silently replace the link.
      await expect(installSymlink(isolation, canonical)).rejects.toThrow();
      // A dangling target is rejected by the realpath check rather than accepted.
      const second = await createV2TestIsolation();
      try {
        await expect(installSymlink(second, join(second.paths.cwd, "missing.ts"))).rejects.toThrow();
      } finally {
        await second.dispose();
      }
    } finally {
      await isolation.dispose();
    }
  });

  it("fingerprints symlinks by target without following them", async () => {
    const isolation = await createV2TestIsolation();
    try {
      const first = join(isolation.paths.cwd, "first.ts");
      const second = join(isolation.paths.cwd, "second.ts");
      await writeFile(first, "a\n", { mode: 0o600 });
      await writeFile(second, "b\n", { mode: 0o600 });
      const directory = join(isolation.paths.config, "opencode", "plugins");
      await mkdir(directory, { recursive: true });
      await symlink(await realpath(first), join(directory, "link.ts"));
      const before = await snapshotTree(isolation.paths.config);
      expect([...before.keys()].some((key) => key.endsWith("link.ts"))).toBe(true);
      expect(diffSnapshots(before, await snapshotTree(isolation.paths.config))).toMatchObject({
        filesChanged: 0,
        filesAdded: 0,
      });
      // Mutating the link target's content does not change the link fingerprint; retargeting does.
      await writeFile(first, "changed\n");
      expect(diffSnapshots(before, await snapshotTree(isolation.paths.config)).filesChanged).toBe(0);
      await unlink(join(directory, "link.ts"));
      await symlink(await realpath(second), join(directory, "link.ts"));
      expect(diffSnapshots(before, await snapshotTree(isolation.paths.config)).filesChanged).toBe(1);
    } finally {
      await isolation.dispose();
    }
  });

  it("rejects owned configs that carry a plugins key or other drift", () => {
    const base = ownedConfig(1);
    expect(ownedConfigMatchesPlan(base)).toBe(true);
    expect(ownedConfigMatchesPlan({ ...base, plugins: ["/x"] })).toBe(false);
    expect(ownedConfigMatchesPlan({ ...base, mcp: {} })).toBe(false);
    expect(ownedConfigMatchesPlan({ ...base, policies: [] })).toBe(false);
    expect(ownedConfigMatchesPlan({ ...base, extra: 1 })).toBe(false);
    expect(ownedConfigMatchesPlan(null)).toBe(false);
  });

  it("classifies native plugin.list entries for the delivered plugin without trusting presence alone", () => {
    const link = "/owned/plugins/codex-quota-retry.ts";
    const real = "/delivered/plugins/codex-quota-retry.ts";
    const good = [
      { source: { type: "builtin" }, state: { status: "active" } },
      { id: pluginId, source: { type: "local", path: link }, state: { status: "active" } },
    ];
    const observed = observePlugin(good, link, real);
    expect(pluginPass(observed)).toBe(true);
    expect(observed?.sourceKind).toBe("link");
    expect(JSON.stringify(observed)).not.toContain("/owned");
    const viaReal = observePlugin(
      [{ id: pluginId, source: { type: "local", path: real }, state: { status: "active" } }],
      link,
      real,
    );
    expect(viaReal?.sourceKind).toBe("realpath");
    expect(pluginPass(viaReal)).toBe(true);

    const drift = (entries: unknown) => observePlugin(entries, link, real);
    const entry = good[1] as Record<string, unknown>;
    expect(pluginPass(drift([{ ...entry, state: { status: "failed" } }]))).toBe(false);
    expect(pluginPass(drift([{ ...entry, state: { status: "pending" } }]))).toBe(false);
    expect(pluginPass(drift([{ ...entry, id: "other" }]))).toBe(false);
    expect(pluginPass(drift([{ ...entry, id: undefined }]))).toBe(false);
    expect(pluginPass(drift([]))).toBe(false);
    expect(pluginPass(drift([entry, entry]))).toBe(false);
    expect(
      pluginPass(
        drift([entry, { id: "x", source: { type: "local", path: "/elsewhere" }, state: { status: "active" } }]),
      ),
    ).toBe(false);
    // A prefix-sibling path is not the delivered plugin.
    expect(drift([{ ...entry, source: { type: "local", path: `${link}.bak` } }])?.entries).toBe(0);
    expect(drift(undefined)).toBeNull();
    expect(drift([{ source: {}, state: { status: "active" } }])).toBeNull();
    expect(drift([{ source: { type: "local" }, state: { status: "active" } }])).toBeNull();
    expect(drift([null])).toBeNull();
    expect(pluginPass(null)).toBe(false);
  });

  it("detects the private correlation header by raw header name only", () => {
    expect(hasPrivateHeader(["Content-Type", "application/json"])).toBe(false);
    expect(hasPrivateHeader([privateHeader, "x"])).toBe(true);
    expect(hasPrivateHeader(["X-OpenCode-Codex-Quota-Retry-Correlation", "x"])).toBe(true);
    expect(hasPrivateHeader(["x-codex-quota-retry-other", "x"])).toBe(true);
    // A value that merely mentions the header is not a header name.
    expect(hasPrivateHeader(["x-other", privateHeader])).toBe(false);
    expect(isLoopbackPeer("127.0.0.1")).toBe(true);
    expect(isLoopbackPeer("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackPeer("10.0.0.2")).toBe(false);
    expect(isLoopbackPeer(undefined)).toBe(false);
  });

  it("detects changed, added and removed config entries by fingerprint", () => {
    const before: TreeSnapshot = new Map([
      ["opencode/opencode.json", "aa:1:10"],
      ["opencode/plugins/codex-quota-retry.ts", "link:aa"],
    ]);
    expect(diffSnapshots(before, new Map(before))).toMatchObject({ filesChanged: 0, filesAdded: 0 });
    expect(
      diffSnapshots(before, new Map([...before, ["opencode/plugins/codex-quota-retry.ts", "link:bb"]])),
    ).toMatchObject({ filesChanged: 1 });
    expect(diffSnapshots(before, new Map([["opencode/opencode.json", "aa:1:10"]]))).toMatchObject({ filesChanged: 1 });
    expect(diffSnapshots(before, new Map([...before, ["opencode/opencode.jsonc", "cc:1:1"]]))).toMatchObject({
      filesAdded: 1,
      addedConfigFile: true,
    });
  });

  it("flags config, path, credential, and delivered-location content in a persisted manifest", () => {
    expect(containsForbiddenContent(JSON.stringify(strictManifestFixture()))).toBe(false);
    expect(containsForbiddenContent('{"plugins":[]}')).toBe(true);
    expect(containsForbiddenContent('{"path":"/x"}')).toBe(true);
    expect(containsForbiddenContent('{"headers":{}}')).toBe(true);
    expect(containsForbiddenContent('{"Authorization": "x"}')).toBe(true);
    expect(containsForbiddenContent('{"x":"~/.config/opencode/plugins/codex-quota-retry.ts"}')).toBe(true);
    expect(containsForbiddenContent(JSON.stringify({ x: join(homedir(), "anything") }))).toBe(true);
  });

  it("requires a strict, complete, bounded, hash-stable, and cleaned-up manifest", () => {
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
    expect(strictPass({ ...base, evidencePath: "tmp/scribe-v2-migration/plugin-failure/x/result.json" })).toBe(false);
    expect(strictPass({ ...base, bounds: { ...bounds, modelRequests: 99 } })).toBe(false);
    for (const name of checkNames) {
      expect(strictPass({ ...base, checks: { ...base.checks, [name]: false } }), name).toBe(false);
      expect(strictPass(withPre({ checks: { ...base.checks, [name]: false } })), name).toBe(false);
    }
    const { pluginActive: _omitted, ...withoutCheck } = base.checks;
    expect(strictPass({ ...base, checks: withoutCheck })).toBe(false);
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
      { modelRequests: 2 },
      { modelRequests: 0 },
      { sessions: 2 },
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
    const good = base.observed;
    const observedPatches: Array<Partial<Observed>> = [
      { plugin: null },
      { plugin: { ...(good.plugin as PluginObservation), status: "failed" } },
      { plugin: { ...(good.plugin as PluginObservation), entries: 2 } },
      { plugin: { ...(good.plugin as PluginObservation), idMatches: false } },
      { plugin: { ...(good.plugin as PluginObservation), sourceKind: "other" } },
      { plugin: { ...(good.plugin as PluginObservation), unexpectedLocalEntries: 1 } },
      { stableAfterRun: false },
      { stableAfterRun: null },
      { delivered: { ...good.delivered, entrySha256After: "c".repeat(64) } },
      { delivered: { ...good.delivered, libSha256After: "c".repeat(64) } },
      { delivered: { ...good.delivered, entrySha256Before: null, entrySha256After: null } },
      { delivered: { ...good.delivered, libSha256Before: "short", libSha256After: "short" } },
      { delivered: { ...good.delivered, unchanged: false } },
      { delivered: { ...good.delivered, unchanged: null } },
      { provider: { ...good.provider, requestsWithPrivateHeader: 1 } },
      { provider: { ...good.provider, nonLoopbackPeers: 1 } },
      { provider: { ...good.provider, requestsInspected: 0 } },
      { config: null },
      { config: { filesBefore: 2, filesChanged: 1, filesAdded: 0 } },
      { config: { filesBefore: 1, filesChanged: 0, filesAdded: 0 } },
    ];
    for (const patch of observedPatches) {
      const observed = { ...good, ...patch };
      expect(strictPass({ ...base, observed }), JSON.stringify(patch)).toBe(false);
      expect(strictPass(withPre({ observed })), JSON.stringify(patch)).toBe(false);
    }
    // The final copy must equal the frozen pre-teardown copy.
    expect(
      strictPass({ ...base, observed: { ...good, config: { filesBefore: 3, filesChanged: 0, filesAdded: 0 } } }),
    ).toBe(false);
    expect(strictPass({ ...base, counts: { ...base.counts, apiRequests: 21 } })).toBe(false);
    expect(strictPass({ ...base, extra: { command: ["node"] } })).toBe(false);
    expect(strictPass({ ...base, observed: { ...good, extra: 1 } })).toBe(false);
  });

  it("observes the delivered Codex plugin through the production agent", {
    skip: !enabled || !codexOptIn,
    timeout: bounds.overallMs + 20_000,
  }, async () => {
    const forkProcess = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof forkProcess.send === "function" && forkProcess.connected === true;
    const root = await realpath(rootPath);
    const base = resolve(root, "tmp/scribe-v2-migration/codex-plugin");
    await mkdir(base, { recursive: true });
    await assertOwnedPath(root, base);
    const runId = randomUUID();
    const runRoot = join(base, runId);
    await mkdir(runRoot, { recursive: false });
    await assertOwnedPath(base, runRoot);
    const evidencePath = join(runRoot, "result.json");
    const originalFetch = globalThis.fetch;
    const originalEnvironment = { ...process.env };
    // The home is read before the environment is replaced; it is never persisted.
    const delivered = deliveredLocations(homedir());
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
    let privateHeaderRequests = 0;
    let nonLoopbackPeers = 0;
    let fixtureOrigin: string | undefined;
    let ownedOrigin: string | undefined;
    let orderExact = true;
    let configBefore: TreeSnapshot | undefined;
    let plugin: PluginObservation | null = null;
    let stableAfterRun: boolean | null = null;
    let configObservation: Observed["config"] = null;
    let realEntry: string | undefined;
    let realLib: string | undefined;
    const deliveredObserved: Delivered = {
      entrySha256Before: null,
      entrySha256After: null,
      libSha256Before: null,
      libSha256After: null,
      unchanged: null,
    };
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
      counts: { apiRequests: 0, modelRequests: 0, sessions: 0, children: 0, pluginListReads: 0, maxModelBodyBytes: 0 },
      checks,
      observed: {
        plugin: null,
        stableAfterRun: null,
        delivered: deliveredObserved,
        provider: { requestsInspected: 0, requestsWithPrivateHeader: 0, nonLoopbackPeers: 0 },
        config: null,
      },
      cleanup: {
        agentDisconnected: false,
        processGroupReaped: null,
        fixtureClosed: false,
        deliveredFilesUnchangedAfterCleanup: null,
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
    const rehash = async () => {
      deliveredObserved.entrySha256After = await hashFile(delivered.entry);
      deliveredObserved.libSha256After = await hashFile(delivered.lib);
      return (
        deliveredObserved.entrySha256Before !== null &&
        deliveredObserved.entrySha256After === deliveredObserved.entrySha256Before &&
        deliveredObserved.libSha256After === deliveredObserved.libSha256Before
      );
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
      manifest.executableSha256 = sha256(binary);
      checks.executableHashPinned = manifest.executableSha256 === executableHash;
      if (!checks.executableHashPinned) throw stop("executable_hash_mismatch");

      // Read-only: hash the delivered files and prove the runtime-resolved lib is the hashed one.
      deliveredObserved.entrySha256Before = await hashFile(delivered.entry);
      deliveredObserved.libSha256Before = await hashFile(delivered.lib);
      checks.deliveredFilesHashedBefore =
        deliveredObserved.entrySha256Before !== null && deliveredObserved.libSha256Before !== null;
      if (!checks.deliveredFilesHashedBefore) throw stop("delivered_files_unavailable");
      realEntry = await realpath(delivered.entry);
      realLib = await realpath(delivered.lib);
      checks.deliveredLibResolutionMatches =
        (await realpath(join(dirname(realEntry), "..", "lib", "codex-quota-retry.ts")).catch(() => undefined)) ===
        realLib;
      if (!checks.deliveredLibResolutionMatches) throw stop("delivered_resolution_mismatch");

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
      checks.deliveredPluginSymlinked = await installSymlink(isolation, realEntry).catch(() => false);
      if (!checks.deliveredPluginSymlinked) throw stop("symlink_install_failed");

      fixture = createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          fail("unexpected_mock_route");
          response.writeHead(404).end();
          return;
        }
        modelRequests += 1;
        // Headers are inspected in memory only; only counts are retained.
        if (hasPrivateHeader(request.rawHeaders)) privateHeaderRequests += 1;
        if (!isLoopbackPeer(request.socket.remoteAddress)) nonLoopbackPeers += 1;
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
        response.end(sse("fixture codex plugin done"));
      });
      const fixturePort = await listen(fixture);
      fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
      const configDirectory = join(isolation.paths.config, "opencode");
      const configPath = join(configDirectory, "opencode.json");
      await writeFile(configPath, JSON.stringify(ownedConfig(fixturePort)), { mode: 0o600 });
      // Fixture setup only: the effective result is proven by native plugin.list, never by this readback.
      checks.ownedConfigWritten = ownedConfigMatchesPlan(JSON.parse(await readFile(configPath, "utf8")));
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
      // Production agent unchanged: no plugin source is composed (pluginSources empty), so the only plugin is the
      // symlinked one discovered in the owned global config directory. Sandbox is off: no OS containment is claimed.
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
        checks.connectSucceeded = true;
      } catch {
        throw stop("connect_failed");
      }
      const connected = agent;
      const native = (connected as unknown as { v2Client?: OpenCodeClient }).v2Client;
      if (!native) throw stop("plugin_catalog_unavailable");
      const workspace = isolation.paths.cwd;
      const linkedEntry = linkPath(isolation);
      const readCatalog = async (): Promise<PluginObservation | null> => {
        pluginListReads += 1;
        try {
          const response: unknown = await native.plugin.list({ location: { directory: workspace } });
          return record(response) ? observePlugin(response.data, linkedEntry, realEntry ?? "") : null;
        } catch {
          return null;
        }
      };

      setStage("plugin");
      for (let read = 0; read < pluginPollLimit && Date.now() < deadline && !overall.signal.aborted; read += 1) {
        plugin = await readCatalog();
        if (plugin !== null && plugin.entries === 1) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, pluginPollMs));
      }
      // Let a late reload surface before the observation is frozen.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, settleMs));
      plugin = (await readCatalog()) ?? plugin;
      if (plugin === null) throw stop("plugin_catalog_unavailable");
      checks.pluginListComplete = plugin.entries === 1;
      checks.pluginActive = pluginPass(plugin);
      checks.noUnexpectedLocalPluginEntries = plugin.unexpectedLocalEntries === 0;

      setStage("session");
      const session = await connected.createSession("codex plugin");
      if (session.directory !== isolation.paths.cwd) throw stop("fixture_operation_failed");
      await connected.sendMessage(session.id, "fixture codex plugin probe", { primaryAgent: "scout" });
      while (
        Date.now() < deadline &&
        !overall.signal.aborted &&
        !(sessionState.busy && sessionState.idle && modelRequests >= expectedModelRequests)
      ) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      if (!(sessionState.busy && sessionState.idle && modelRequests >= expectedModelRequests))
        throw stop("session_idle_timeout");
      checks.sessionIdleClean = assistantsClean(await connected.getMessages(session.id));
      const after = await readCatalog();
      stableAfterRun = after !== null && JSON.stringify(after) === JSON.stringify(plugin) && after.entries === 1;
      checks.pluginStateStableAfterRun = stableAfterRun;
      const diff = diffSnapshots(configBefore, await snapshotTree(isolation.paths.config));
      configObservation = {
        filesBefore: diff.filesBefore,
        filesChanged: diff.filesChanged,
        filesAdded: diff.filesAdded,
      };
      checks.noConfigWrites = diff.filesChanged === 0 && !diff.addedConfigFile && diff.filesBefore >= 2;
      deliveredObserved.unchanged = await rehash();
      checks.deliveredFilesUnchanged = deliveredObserved.unchanged;

      checks.privateChildVersionAndPID =
        observedVersion === version && ownedPID !== undefined && ownedOrigin !== undefined;
      checks.modelRequestOrderExact = orderExact && modelRequests === expectedModelRequests;
      checks.noPrivateHeaderAtProvider = privateHeaderRequests === 0 && modelRequests === expectedModelRequests;
      checks.modelRequestsLoopbackOnly = nonLoopbackPeers === 0 && modelRequests === expectedModelRequests;
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
      // A deviation is a finding recorded in observed/checks, not a forced PASS.
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
      if (deliveredObserved.entrySha256Before !== null && deliveredObserved.unchanged === null) {
        deliveredObserved.unchanged = await rehash();
      }
      manifest.observed = {
        plugin,
        stableAfterRun,
        delivered: deliveredObserved,
        provider: {
          requestsInspected: modelRequests,
          requestsWithPrivateHeader: privateHeaderRequests,
          nonLoopbackPeers,
        },
        config: configObservation,
      };
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
      // The delivered files must also be unchanged after the child exited; recorded separately so the frozen
      // pre-teardown observation is not mutated.
      manifest.cleanup.deliveredFilesUnchangedAfterCleanup =
        deliveredObserved.entrySha256Before !== null &&
        (await hashFile(delivered.entry)) === deliveredObserved.entrySha256Before &&
        (await hashFile(delivered.lib)) === deliveredObserved.libSha256Before;
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
