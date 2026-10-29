import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const EXECUTABLE = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const RUN_ENABLED =
  process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1" &&
  EXECUTABLE === "/opt/homebrew/Cellar/opencode-v2/2.2.0/bin/opencode";
const EXPECTED_VERSION = "2.2.0";
const EXPECTED_SHA256 = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const SOURCE_COMMIT = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const CLI_PATH = "/opt/homebrew/bin:/usr/bin:/bin";
const OVERALL_MS = 90_000;
const COMMAND_MS = 15_000;
const CLI_REAP_RESERVE_MS = 1_350;
const OUTPUT_LIMIT = 1024 * 1024;
const CLEANUP_MS = 5_000;
const FIXTURE_ANSWER = "transfer fixture known answer";
const ownedIsolations = new Set<V2TestIsolation>();
const FIXTURE_REQUEST_LIMIT = 64 * 1024;
const SOURCE_POLL_LIMIT = 8;
const SOURCE_POLL_INTERVAL_MS = 250;

const CHECK_NAMES = [
  "dedicatedVitestFork",
  "sourceIsolationGate",
  "destinationIsolationGate",
  "mutableIsolationPathsDisjoint",
  "pinnedExecutablePathAndHash",
  "installedClientVersion",
  "nativeServerVersion",
  "nativeSourceExportEnvelopeObserved",
  "nativeExportFileOwnedAndPrivate",
  "importMarkerExact",
  "copiedSessionIDFresh",
  "copiedExportValid",
  "copiedHistoryAndLocationExact",
  "importedAgentNotScout",
  "sourceExportRejectedByDestination",
  "duplicateImportRejectedByHandshake",
  "sourceSessionUnchanged",
  "sourceAgentAlive",
  "sourceHistoryHasKnownAnswer",
  "sourceSessionBusyThenIdle",
  "allOperationBounds",
  "allFourCommandsBounded",
] as const;

type CheckName = (typeof CHECK_NAMES)[number];
type Result = {
  schemaVersion: 1;
  runId: string;
  status: "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
  qualification: "CLI_IMPORT_EXPORT_NOT_TUI_GUI";
  expectedServer: "2.2.0";
  clientPackage: "@opencode/client@2.1.0";
  sourceCommit: string;
  sourceCommitMeaning: "inspected-release-tag";
  observationScope: "TEST_HARNESS_SOURCE_API_OBSERVER_ONLY";
  executablePath: string | null;
  executableSha256: string | null;
  sourceRoot: string | null;
  destinationRoot: string | null;
  sourceMutablePaths: string[];
  destinationMutablePaths: string[];
  sourceStatePath: string | null;
  destinationStatePath: string | null;
  sourceDatabasePath: string | null;
  destinationDatabasePath: string | null;
  exportPath: string | null;
  sourcePID: number | null;
  cliPIDs: number[];
  bounds: {
    overallMs: number;
    sourceApiRequests: number;
    modelRequests: number;
    sourceSessions: number;
    cliCommands: number;
    eachCliMs: number;
    outputBytes: number;
    maxModelRequestBytes: number;
    sourcePolls: number;
    sourcePollIntervalMs: number;
    maxConcurrentOpenCodeProcesses: number;
    isolationRoots: number;
  };
  counts: {
    sourceApiRequests: number;
    modelRequests: number;
    sourceSessions: number;
    cliCommands: number;
    maxCommandOutputBytes: number;
    maxModelRequestBytes: number;
    sourcePolls: number;
  };
  checks: Record<CheckName, boolean>;
  cleanup: {
    sourceAgent: boolean;
    sourceProcessGroupGone: boolean;
    cliGroups: boolean;
    fixtureServer: boolean;
    sourceIsolation: boolean;
    destinationIsolation: boolean;
    exportRemoved: boolean;
    environmentRestored: boolean;
    fetchRestored: boolean;
    stateDatabaseCleanup: boolean;
  };
  preTeardown?: {
    status: "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
    counts: Result["counts"];
    checks: Record<CheckName, boolean>;
    failureCode?: string;
  };
  failureCode?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importMarker(stdout: string, expectedID?: string): string | undefined {
  const matches = [...stdout.matchAll(/^Imported session: (ses_[A-Za-z0-9_-]+)\r?$/gmu)];
  const id = matches.length === 1 ? matches[0]?.[1] : undefined;
  return id !== undefined && (expectedID === undefined || id === expectedID) ? id : undefined;
}

function transferMessageIDs(data: unknown): string[] | undefined {
  if (!isRecord(data) || !Array.isArray(data.messages)) return undefined;
  const ids = data.messages.map((message) => (isRecord(message) ? message.id : undefined));
  return ids.every((id): id is string => typeof id === "string" && /^msg_[A-Za-z0-9_-]+$/u.test(id)) &&
    new Set(ids).size === ids.length
    ? ids
    : undefined;
}

function sameTransferHistory(expected: unknown, actual: unknown): boolean {
  if (!isRecord(expected) || !isRecord(actual)) return false;
  if (!Array.isArray(expected.messages) || !Array.isArray(actual.messages)) return false;
  const expectedMessages: unknown[] = expected.messages;
  const actualMessages: unknown[] = actual.messages;
  const expectedIDs = transferMessageIDs(expected);
  const actualIDs = transferMessageIDs(actual);
  return (
    expectedIDs !== undefined &&
    actualIDs !== undefined &&
    expectedIDs.length === actualIDs.length &&
    JSON.stringify(expectedIDs) === JSON.stringify(actualIDs) &&
    expectedMessages.every((message, index) => {
      if (!isRecord(message) || !isRecord(actualMessages[index])) return false;
      return JSON.stringify(message) === JSON.stringify(actualMessages[index]);
    })
  );
}

function sameTransferPayloadWithFreshOuterIDs(expected: unknown, actual: unknown): boolean {
  if (!isRecord(expected) || !isRecord(actual) || !Array.isArray(expected.messages) || !Array.isArray(actual.messages))
    return false;
  const expectedMessages: unknown[] = expected.messages;
  const actualMessages: unknown[] = actual.messages;
  const expectedIDs = transferMessageIDs(expected);
  const actualIDs = transferMessageIDs(actual);
  return (
    expectedIDs !== undefined &&
    actualIDs !== undefined &&
    expectedIDs.length === actualIDs.length &&
    expectedMessages.every((message, index) => {
      if (!isRecord(message) || !isRecord(actualMessages[index])) return false;
      const { id: _expectedID, ...expectedPayload } = message;
      const { id: _actualID, ...actualPayload } = actualMessages[index];
      return JSON.stringify(expectedPayload) === JSON.stringify(actualPayload);
    })
  );
}

function isOwnedSourceExportRoute(method: string, pathname: string, sourceID: string, search = "", hash = ""): boolean {
  if (method !== "GET" || search !== "" || hash !== "") return false;
  const match = /^\/api\/experimental\/session\/([^/]+)\/export$/u.exec(pathname);
  if (!match?.[1]) return false;
  try {
    return decodeURIComponent(match[1]) === sourceID;
  } catch {
    return false;
  }
}

function unwrapNativeExportEnvelope(value: unknown, sourceID: string, workspace: string): unknown | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "data")) return undefined;
  const transfer = value.data;
  if (
    !isRecord(transfer) ||
    !isRecord(transfer.info) ||
    transfer.info.id !== sourceID ||
    !Array.isArray(transfer.messages)
  )
    return undefined;
  if (
    !isRecord(transfer.info.location) ||
    transfer.info.location.directory !== workspace ||
    uniqueOuterIDs(transfer) === undefined
  )
    return undefined;
  return transfer;
}

function uniqueOuterIDs(data: unknown): string[] | undefined {
  if (!isRecord(data) || !isRecord(data.info)) return undefined;
  const sessionID = data.info.id;
  const messageIDs = transferMessageIDs(data);
  if (typeof sessionID !== "string" || !/^ses_[A-Za-z0-9_-]+$/u.test(sessionID) || !messageIDs) return undefined;
  const all = [sessionID, ...messageIDs];
  return new Set(all).size === all.length ? all : undefined;
}

function isIndependentCopy(native: unknown, copied: unknown, sourceID: string, workspace: string): boolean {
  if (!isRecord(native) || !isRecord(native.info) || !isRecord(copied) || !isRecord(copied.info)) return false;
  const nativeIDs = uniqueOuterIDs(native);
  const copiedIDs = uniqueOuterIDs(copied);
  const copiedInfo = copied.info;
  if (!nativeIDs || !copiedIDs || copiedIDs.some((id) => nativeIDs.includes(id))) return false;
  if (
    native.info.id !== sourceID ||
    copied.info.id === sourceID ||
    copiedInfo.location === null ||
    !isRecord(copiedInfo.location) ||
    copiedInfo.location.directory !== workspace ||
    "parentID" in copiedInfo ||
    "fork" in copiedInfo ||
    "agent" in copiedInfo
  )
    return false;
  const stripCopyControls = (info: Record<string, unknown>) => {
    const { id: _id, parentID: _parentID, fork: _fork, agent: _agent, ...fields } = info;
    return fields;
  };
  return (
    JSON.stringify(stripCopyControls(native.info)) === JSON.stringify(stripCopyControls(copiedInfo)) &&
    sameTransferPayloadWithFreshOuterIDs(native, copied)
  );
}

function exactDestinationEnvironment(environment: NodeJS.ProcessEnv, paths: V2TestIsolation["paths"]): boolean {
  const expectedKeys = Object.keys(environment).filter((key) => key !== "PATH");
  try {
    assertIsolatedEnvironment(Object.fromEntries(expectedKeys.map((key) => [key, environment[key]])), paths);
  } catch {
    return false;
  }
  return (
    environment.PATH === CLI_PATH &&
    !Object.keys(environment).some((key) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTH)/iu.test(key))
  );
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function hasKnownAnswer(data: unknown): boolean {
  return (
    isRecord(data) &&
    Array.isArray(data.messages) &&
    data.messages.some((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) return false;
      return message.content.some((part) => isRecord(part) && part.type === "text" && part.text === FIXTURE_ANSWER);
    })
  );
}

function response(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "transfer-fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant" })}${chunk({ content: text })}${chunk({}, "stop")}data: [DONE]\n\n`;
}

function groupExists(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function resolvePinnedFromPath(pathValue: string): Promise<string | undefined> {
  for (const directory of pathValue.split(":")) {
    if (!isAbsolute(directory)) return undefined;
    const candidate = resolve(directory, "opencode");
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        await access(candidate, constants.X_OK);
        return candidate;
      }
      const target = await realpath(candidate);
      if ((await stat(target)).isFile()) {
        await access(target, constants.X_OK);
        return candidate;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
    }
  }
  return undefined;
}

function agentDisconnected(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("cleanup_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function isAbsent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function distinctMutablePaths(source: V2TestIsolation["paths"], destination: V2TestIsolation["paths"]): boolean {
  const sourcePaths = [
    source.home,
    source.config,
    source.cache,
    source.data,
    source.state,
    source.database,
    source.serviceState,
    source.tmp,
    source.cwd,
  ];
  const destinationPaths = [
    destination.home,
    destination.config,
    destination.cache,
    destination.data,
    destination.state,
    destination.database,
    destination.serviceState,
    destination.tmp,
    destination.cwd,
  ];
  return sourcePaths.every(
    (path) => !destinationPaths.some((other) => path === other || isWithin(path, other) || isWithin(other, path)),
  );
}

async function groupGoneWithin(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (groupExists(pid) && Date.now() < deadline) await new Promise((delay) => setTimeout(delay, 25));
  return !groupExists(pid);
}

async function terminateGroupBounded(pid: number): Promise<boolean> {
  if (!groupExists(pid)) return true;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    /* cleanup continues */
  }
  if (await groupGoneWithin(pid, 350)) return true;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
  } catch {
    /* checked below */
  }
  return groupGoneWithin(pid, 1_000);
}

async function runCli(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  pids: number[],
  deadline: number,
): Promise<{ code: number | null; stdout: string; stderr: string; outputBytes: number }> {
  return new Promise((resolvePromise, reject) => {
    const child: ChildProcess = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) pids.push(child.pid);
    if (!child.stdout || !child.stderr) {
      reject(new Error("cli_output_pipe_unavailable"));
      return;
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let oversized = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let reapTimer: NodeJS.Timeout | undefined;
    let reapDeadline = 0;
    let closeCode: number | null = null;
    let closeSeen = false;
    let spawnError: unknown;
    let terminationStarted = false;
    let settled = false;
    const maxRunMs = Math.max(1, Math.min(COMMAND_MS, deadline - Date.now()) - CLI_REAP_RESERVE_MS);
    const clearTimers = () => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (reapTimer) clearTimeout(reapTimer);
    };
    const stopGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
      } catch {
        /* final bounded group check determines success */
      }
    };
    const finishIfReaped = () => {
      if (!closeSeen || settled || (child.pid !== undefined && groupExists(child.pid))) return;
      settled = true;
      clearTimers();
      if (timedOut) reject(Object.assign(new Error(), { code: "cli_timeout" }));
      else if (oversized) reject(Object.assign(new Error(), { code: "cli_output_limit" }));
      else if (spawnError) reject(Object.assign(new Error(), { code: "cli_spawn_failed" }));
      else
        resolvePromise({
          code: closeCode,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          outputBytes,
        });
    };
    const beginTermination = () => {
      if (terminationStarted) return;
      terminationStarted = true;
      stopGroup("SIGTERM");
      killTimer = setTimeout(() => {
        stopGroup("SIGKILL");
        reapDeadline = Date.now() + 1_000;
        reapTimer = setInterval(() => {
          if (child.pid && !groupExists(child.pid)) finishIfReaped();
          if (!settled && Date.now() >= reapDeadline) {
            settled = true;
            clearTimers();
            reject(Object.assign(new Error(), { code: "cli_group_reap_failed" }));
          }
        }, 25);
      }, 350);
    };
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > OUTPUT_LIMIT) {
        oversized = true;
        beginTermination();
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", capture(stdoutChunks));
    child.stderr.on("data", capture(stderrChunks));
    timer = setTimeout(() => {
      timedOut = true;
      beginTermination();
    }, maxRunMs);
    child.once("error", (error) => {
      spawnError = error;
      if (!child.pid) {
        closeSeen = true;
        finishIfReaped();
      } else beginTermination();
    });
    child.once("close", (code) => {
      closeCode = code;
      closeSeen = true;
      if (!terminationStarted && child.pid && groupExists(child.pid)) beginTermination();
      if (!child.pid || !groupExists(child.pid)) finishIfReaped();
    });
  });
}

afterEach(async () => {
  for (const isolation of ownedIsolations) {
    await isolation.dispose();
    ownedIsolations.delete(isolation);
  }
});

it("validates CLI transfer protocol helpers without runtime execution", () => {
  expect(importMarker("noise\nImported session: ses_copy\n")).toBe("ses_copy");
  expect(importMarker("Imported session: ses_copy\r\n")).toBe("ses_copy");
  expect(importMarker("Imported session: ses_other\nImported session: ses_copy\n")).toBeUndefined();
  expect(importMarker("Imported session: ses_copy-extra\n", "ses_copy")).toBeUndefined();
  expect(importMarker("Imported session: ses_other\n", "ses_copy")).toBeUndefined();
  expect(importMarker("Session already exists\n")).toBeUndefined();
  expect(importMarker("")).toBeUndefined();
  const nativeSourceTransfer = {
    info: { id: "ses_source", location: { directory: "/owned/workspace" } },
    messages: [{ id: "msg_source", type: "user", text: "fixture" }],
  };
  expect(isOwnedSourceExportRoute("GET", "/api/experimental/session/ses_source/export", "ses_source")).toBe(true);
  expect(isOwnedSourceExportRoute("GET", "/api/experimental/session/ses_foreign/export", "ses_source")).toBe(false);
  expect(isOwnedSourceExportRoute("POST", "/api/experimental/session/ses_source/export", "ses_source")).toBe(false);
  expect(isOwnedSourceExportRoute("GET", "/api/experimental/session/ses_source/export", "ses_source", "?other=1")).toBe(
    false,
  );
  expect(unwrapNativeExportEnvelope({ data: nativeSourceTransfer }, "ses_source", "/owned/workspace")).toEqual(
    nativeSourceTransfer,
  );
  expect(unwrapNativeExportEnvelope(nativeSourceTransfer, "ses_source", "/owned/workspace")).toBeUndefined();
  expect(
    unwrapNativeExportEnvelope(
      { data: { ...nativeSourceTransfer, info: { ...nativeSourceTransfer.info, id: "ses_foreign" } } },
      "ses_source",
      "/owned/workspace",
    ),
  ).toBeUndefined();
  expect(
    unwrapNativeExportEnvelope({ data: nativeSourceTransfer, unexpected: true }, "ses_source", "/owned/workspace"),
  ).toBeUndefined();
  const first = { info: { id: "ses_copy" }, messages: [{ id: "msg_one", content: [{ type: "text", text: "a" }] }] };
  const same = structuredClone(first);
  const reorderedSource = {
    info: { id: "ses_multi" },
    messages: [
      { id: "msg_first", type: "user", text: "first" },
      { id: "msg_second", type: "assistant", text: "second" },
    ],
  };
  const reordered = {
    info: { id: "ses_multi_copy" },
    messages: [
      { id: "msg_second_copy", type: "assistant", text: "second" },
      { id: "msg_first_copy", type: "user", text: "first" },
    ],
  };
  const foreign = { ...first, messages: [{ ...first.messages[0], id: "msg_foreign" }] };
  expect(sameTransferHistory(first, same)).toBe(true);
  expect(sameTransferHistory(first, foreign)).toBe(false);
  expect(sameTransferPayloadWithFreshOuterIDs(first, foreign)).toBe(true);
  expect(sameTransferHistory(reorderedSource, reordered)).toBe(false);
  expect(sameTransferPayloadWithFreshOuterIDs(reorderedSource, reordered)).toBe(false);
  const duplicate = { ...first, messages: [{ id: "msg_one" }, { id: "msg_one" }] };
  const duplicateCopy = { ...first, messages: [{ id: "msg_copy" }, { id: "msg_copy" }] };
  expect(sameTransferHistory(duplicate, duplicateCopy)).toBe(false);
  expect(sameTransferPayloadWithFreshOuterIDs(duplicate, duplicateCopy)).toBe(false);
  expect(sameTransferHistory(first, { info: {}, messages: [{ id: "foreign" }] })).toBe(false);
  const paths: V2TestIsolation["paths"] = {
    home: "h",
    config: "c",
    data: "d",
    cache: "ca",
    state: "s",
    database: "db",
    serviceState: "ss",
    tmp: "t",
    cwd: "w",
  };
  const isolationEnv = {
    HOME: "h",
    XDG_CONFIG_HOME: "c",
    XDG_DATA_HOME: "d",
    XDG_CACHE_HOME: "ca",
    XDG_STATE_HOME: "s",
    OPENCODE_DB: "db",
    TMPDIR: "t",
    OPENCODE_TEST_HOME: "h",
    OPENCODE_CONFIG_DIR: "c/opencode",
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    PATH: CLI_PATH,
  };
  expect(exactDestinationEnvironment(isolationEnv, paths)).toBe(true);
  expect(exactDestinationEnvironment({ ...isolationEnv, USER_TOKEN: "unexpected" }, paths)).toBe(false);
  expect(exactDestinationEnvironment({ ...isolationEnv, EXTRA: "ambient" }, paths)).toBe(false);
});

it.skipIf(!RUN_ENABLED)(
  "copies one source session through the pinned standalone CLI import/export contract",
  async () => {
    const started = Date.now();
    const runId = randomUUID();
    const reportBase = resolve(PROJECT_ROOT, "tmp/scribe-v2-migration/transfer");
    await mkdir(reportBase, { recursive: true });
    await assertOwnedPath(PROJECT_ROOT, reportBase);
    const runRoot = join(reportBase, runId);
    await mkdir(runRoot, { recursive: false });
    const resultPath = join(runRoot, "result.json");
    const checks = Object.fromEntries(CHECK_NAMES.map((name) => [name, false])) as Record<CheckName, boolean>;
    const result: Result = {
      schemaVersion: 1,
      runId,
      status: "RUNNING",
      qualification: "CLI_IMPORT_EXPORT_NOT_TUI_GUI",
      expectedServer: EXPECTED_VERSION,
      clientPackage: "@opencode/client@2.1.0",
      sourceCommit: SOURCE_COMMIT,
      sourceCommitMeaning: "inspected-release-tag",
      observationScope: "TEST_HARNESS_SOURCE_API_OBSERVER_ONLY",
      executablePath: EXECUTABLE && isAbsolute(EXECUTABLE) ? resolve(EXECUTABLE) : null,
      executableSha256: null,
      sourceRoot: null,
      destinationRoot: null,
      sourceMutablePaths: [],
      destinationMutablePaths: [],
      sourceStatePath: null,
      destinationStatePath: null,
      sourceDatabasePath: null,
      destinationDatabasePath: null,
      exportPath: null,
      sourcePID: null,
      cliPIDs: [],
      bounds: {
        overallMs: OVERALL_MS,
        sourceApiRequests: 35,
        modelRequests: 1,
        sourceSessions: 1,
        cliCommands: 4,
        eachCliMs: COMMAND_MS,
        outputBytes: OUTPUT_LIMIT,
        maxModelRequestBytes: FIXTURE_REQUEST_LIMIT,
        sourcePolls: SOURCE_POLL_LIMIT,
        sourcePollIntervalMs: SOURCE_POLL_INTERVAL_MS,
        maxConcurrentOpenCodeProcesses: 3,
        isolationRoots: 2,
      },
      counts: {
        sourceApiRequests: 0,
        modelRequests: 0,
        sourceSessions: 0,
        cliCommands: 0,
        maxCommandOutputBytes: 0,
        maxModelRequestBytes: 0,
        sourcePolls: 0,
      },
      checks,
      cleanup: {
        sourceAgent: false,
        sourceProcessGroupGone: false,
        cliGroups: false,
        fixtureServer: false,
        sourceIsolation: false,
        destinationIsolation: false,
        exportRemoved: false,
        environmentRestored: false,
        fetchRestored: false,
        stateDatabaseCleanup: false,
      },
    };
    const persist = async () => writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    const originalFetch = globalThis.fetch;
    const originalEnvironment = { ...process.env };
    let environmentReplaced = false;
    let fixture: Server | undefined;
    let source: V2TestIsolation | undefined;
    let destination: V2TestIsolation | undefined;
    let agent: OpenCodeAgent | undefined;
    let exportPath: string | undefined;
    let sourceID: string | undefined;
    let copiedID: string | undefined;
    let observedServerVersion: string | undefined;
    let sourcePID: number | undefined;
    let sourceOrigin: string | undefined;
    let mockOrigin: string | undefined;
    let busyObserved = false;
    let idleAfterBusyObserved = false;
    let observedNativeExport: unknown;
    let nativeExportRouteObserved = false;
    const overall = new AbortController();
    const overallTimer = setTimeout(
      () => overall.abort(new Error("overall_deadline")),
      Math.max(1, OVERALL_MS - (Date.now() - started)),
    );
    try {
      await persist();
      const fork = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
      checks.dedicatedVitestFork = typeof fork.send === "function" && fork.connected === true;
      if (!checks.dedicatedVitestFork) throw Object.assign(new Error(), { code: "dedicated_fork_required" });
      if (!EXECUTABLE || !isAbsolute(EXECUTABLE)) throw Object.assign(new Error(), { code: "executable_required" });
      source = await createV2TestIsolation(runRoot);
      destination = await createV2TestIsolation(runRoot);
      ownedIsolations.add(source);
      ownedIsolations.add(destination);
      result.sourceRoot = relative(PROJECT_ROOT, source.root);
      result.destinationRoot = relative(PROJECT_ROOT, destination.root);
      result.sourceMutablePaths = [
        source.paths.home,
        source.paths.config,
        source.paths.cache,
        source.paths.data,
        source.paths.state,
        source.paths.database,
        source.paths.serviceState,
        source.paths.tmp,
        source.paths.cwd,
      ].map((path) => relative(PROJECT_ROOT, path));
      result.destinationMutablePaths = [
        destination.paths.home,
        destination.paths.config,
        destination.paths.cache,
        destination.paths.data,
        destination.paths.state,
        destination.paths.database,
        destination.paths.serviceState,
        destination.paths.tmp,
        destination.paths.cwd,
      ].map((path) => relative(PROJECT_ROOT, path));
      result.sourceStatePath = relative(PROJECT_ROOT, source.paths.state);
      result.destinationStatePath = relative(PROJECT_ROOT, destination.paths.state);
      result.sourceDatabasePath = relative(PROJECT_ROOT, source.paths.database);
      result.destinationDatabasePath = relative(PROJECT_ROOT, destination.paths.database);
      checks.mutableIsolationPathsDisjoint = distinctMutablePaths(source.paths, destination.paths);
      if (!checks.mutableIsolationPathsDisjoint)
        throw Object.assign(new Error(), { code: "mutable_paths_not_disjoint" });
      await assertIsolatedEnvironment(source.environment, source.paths);
      const sourceGate = evaluateStaticPrelaunchGate(
        source.environment,
        source.paths,
        await inspectAmbientConfigSources(),
      );
      checks.sourceIsolationGate = sourceGate.status === "READY_FOR_DISPOSABLE_SPIKE";
      const destinationGate = evaluateStaticPrelaunchGate(
        destination.environment,
        destination.paths,
        await inspectAmbientConfigSources(),
      );
      checks.destinationIsolationGate = destinationGate.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.sourceIsolationGate || !checks.destinationIsolationGate)
        throw Object.assign(new Error(), { code: "ambient_gate_blocked" });
      if (resolve(await realpath(EXECUTABLE)) !== resolve(EXECUTABLE))
        throw Object.assign(new Error(), { code: "executable_not_canonical" });
      const binaryHash = createHash("sha256")
        .update(await readFile(EXECUTABLE))
        .digest("hex");
      result.executableSha256 = binaryHash;
      const resolvedPath = await resolvePinnedFromPath(CLI_PATH);
      if (!resolvedPath) throw Object.assign(new Error(), { code: "pinned_executable_mismatch" });
      const resolvedHash = createHash("sha256")
        .update(await readFile(resolvedPath))
        .digest("hex");
      checks.pinnedExecutablePathAndHash =
        resolve(await realpath(resolvedPath)) === resolve(EXECUTABLE) &&
        binaryHash === EXPECTED_SHA256 &&
        resolvedHash === EXPECTED_SHA256;
      if (!checks.pinnedExecutablePathAndHash) throw Object.assign(new Error(), { code: "pinned_executable_mismatch" });
      const clientPackage = JSON.parse(
        await readFile(
          join(PROJECT_ROOT, "packages/agents/opencode/node_modules/@opencode/client/package.json"),
          "utf8",
        ),
      ) as { name?: unknown; version?: unknown };
      checks.installedClientVersion = clientPackage.name === "@opencode/client" && clientPackage.version === "2.1.0";
      if (!checks.installedClientVersion) throw Object.assign(new Error(), { code: "client_version_mismatch" });
      environmentReplaced = true;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, source.environment);
      let modelRequests = 0;
      fixture = createServer((request, responseStream) => {
        void (async () => {
          if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
            responseStream.writeHead(404).end();
            return;
          }
          result.counts.modelRequests += 1;
          modelRequests += 1;
          if (modelRequests > 1) {
            responseStream.writeHead(429).end();
            return;
          }
          const contentLength = Number(request.headers["content-length"] ?? 0);
          if (Number.isFinite(contentLength) && contentLength > FIXTURE_REQUEST_LIMIT) {
            responseStream.writeHead(413).end();
            request.destroy();
            return;
          }
          let bytes = 0;
          for await (const chunk of request) {
            bytes += Buffer.byteLength(chunk);
            result.counts.maxModelRequestBytes = Math.max(result.counts.maxModelRequestBytes, bytes);
            if (bytes > FIXTURE_REQUEST_LIMIT) {
              responseStream.writeHead(413).end();
              request.destroy();
              return;
            }
          }
          responseStream.writeHead(200, { "content-type": "text/event-stream" }).end(response(FIXTURE_ANSWER));
        })().catch(() => {
          if (!responseStream.headersSent) responseStream.writeHead(500).end();
          else responseStream.destroy();
        });
      });
      const port = await new Promise<number>((resolvePort, reject) => {
        fixture?.once("error", reject);
        fixture?.listen(0, "127.0.0.1", () => {
          const address = fixture?.address();
          if (!address || typeof address === "string") reject(new Error("fixture_bind_failed"));
          else resolvePort(address.port);
        });
      });
      mockOrigin = `http://127.0.0.1:${port}`;
      await mkdir(join(source.paths.config, "opencode"), { recursive: true });
      await writeFile(
        join(source.paths.config, "opencode", "opencode.json"),
        JSON.stringify({
          model: "fixture-provider/fixture-model",
          providers: {
            "fixture-provider": {
              name: "Local fixture",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: `http://127.0.0.1:${port}/v1` },
              models: { "fixture-model": { name: "Fixture model" } },
            },
          },
          enabledProviders: ["fixture-provider"],
          plugins: [],
          mcp: {},
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(destination.paths.config, "opencode", "opencode.json"),
        JSON.stringify({ plugins: [], mcp: {}, enabledProviders: [] }),
        { mode: 0o600 },
      );
      const nativeFetch = originalFetch.bind(globalThis);
      const sourceWorkspace = source.paths.cwd;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const parsedURL = new URL(url);
        if (parsedURL.pathname.startsWith("/api/")) {
          if (
            !/^https?:$/.test(parsedURL.protocol) ||
            !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedURL.hostname)
          )
            throw new Error("non_loopback_api_request");
          sourceOrigin ??= parsedURL.origin;
          if (parsedURL.origin !== sourceOrigin) throw new Error("foreign_api_request");
          result.counts.sourceApiRequests += 1;
        } else if (parsedURL.origin !== mockOrigin) throw Object.assign(new Error(), { code: "foreign_fetch_blocked" });
        if (result.counts.sourceApiRequests > 35) throw Object.assign(new Error(), { code: "source_api_limit" });
        const signals = [
          overall.signal,
          AbortSignal.timeout(Math.max(1, OVERALL_MS - (Date.now() - started))),
          ...(input instanceof Request ? [input.signal] : []),
          ...(init?.signal ? [init.signal] : []),
        ];
        const response = await nativeFetch(input, { ...init, signal: AbortSignal.any(signals) });
        if (parsedURL.pathname === "/api/info" && response.ok) {
          const info: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          if (isRecord(info) && typeof info.version === "string" && typeof info.pid === "number") {
            observedServerVersion = info.version;
            sourcePID = info.pid;
            result.sourcePID = info.pid;
          }
        }
        if (
          sourceID &&
          isOwnedSourceExportRoute(
            (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
            parsedURL.pathname,
            sourceID,
            parsedURL.search,
            parsedURL.hash,
          )
        ) {
          nativeExportRouteObserved = true;
          const envelope: unknown = response.ok
            ? await response
                .clone()
                .json()
                .catch(() => undefined)
            : undefined;
          observedNativeExport = unwrapNativeExportEnvelope(envelope, sourceID, sourceWorkspace);
        }
        return response;
      }) as typeof fetch;
      agent = new OpenCodeAgent({
        workspacePath: source.paths.cwd,
        hostPaths: { config: join(source.paths.config, "opencode"), state: source.paths.state },
        backend: "sdk",
        sandbox: {
          mode: "off",
          enabled: false,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [source.paths.cwd], readOnlyPaths: [] },
        },
        executable: { path: resolve(EXECUTABLE) },
      });
      const sourcePrelaunch = evaluateStaticPrelaunchGate(
        source.environment,
        source.paths,
        await inspectAmbientConfigSources(),
      );
      if (sourcePrelaunch.status !== "READY_FOR_DISPOSABLE_SPIKE")
        throw Object.assign(new Error(), { code: "ambient_gate_blocked" });
      await agent.connect();
      agent.onEvent((event) => {
        if (event.type !== "session.status" || event.properties.sessionID !== sourceID) return;
        if (event.properties.status.type === "busy") busyObserved = true;
        if (event.properties.status.type === "idle" && busyObserved) idleAfterBusyObserved = true;
      });
      checks.nativeServerVersion = observedServerVersion === EXPECTED_VERSION;
      if (!checks.nativeServerVersion || sourcePID === undefined)
        throw Object.assign(new Error(), { code: "native_version_mismatch" });
      const sourceSession = await agent.createSession("transfer fixture source");
      sourceID = sourceSession.id;
      result.counts.sourceSessions = 1;
      await agent.sendMessage(sourceID, "Reply with the fixture answer.");
      const deadline = Date.now() + Math.min(35_000, OVERALL_MS - (Date.now() - started));
      let sourceMessages = await agent.getMessages(sourceID);
      let polls = 0;
      const sourceAnswerSettled = () =>
        busyObserved &&
        idleAfterBusyObserved &&
        sourceMessages.some(
          (message) =>
            message.info.role === "assistant" &&
            typeof message.info.time.completed === "number" &&
            message.parts.some((part) => part.type === "text" && part.text === FIXTURE_ANSWER),
        );
      while (!sourceAnswerSettled() && polls < SOURCE_POLL_LIMIT && Date.now() < deadline && !overall.signal.aborted) {
        polls += 1;
        result.counts.sourcePolls = polls;
        await new Promise((delay) => setTimeout(delay, SOURCE_POLL_INTERVAL_MS));
        sourceMessages = await agent.getMessages(sourceID);
      }
      if (!sourceAnswerSettled()) throw Object.assign(new Error(), { code: "source_prompt_timeout" });
      const sourceBefore = await agent.getSession(sourceID);
      if (!source) throw Object.assign(new Error(), { code: "source_isolation_missing" });
      const nativeExportPath = await agent.exportSessionSnapshot(sourceID);
      exportPath = nativeExportPath;
      result.exportPath = relative(PROJECT_ROOT, nativeExportPath);
      await assertOwnedPath(source.root, nativeExportPath);
      const fileStat = await (await import("node:fs/promises")).stat(nativeExportPath);
      const exportData: unknown = JSON.parse(await readFile(nativeExportPath, "utf8"));
      checks.nativeSourceExportEnvelopeObserved = nativeExportRouteObserved && observedNativeExport !== undefined;
      if (!checks.nativeSourceExportEnvelopeObserved)
        throw Object.assign(new Error(), { code: "native_export_envelope_invalid" });
      checks.nativeExportFileOwnedAndPrivate =
        isWithin(source.paths.tmp, nativeExportPath) &&
        (fileStat.mode & 0o777) === 0o600 &&
        isRecord(exportData) &&
        isRecord(exportData.info) &&
        Array.isArray(exportData.messages) &&
        uniqueOuterIDs(exportData) !== undefined &&
        isRecord(exportData.info.location) &&
        exportData.info.location.directory === source.paths.cwd &&
        !("parentID" in exportData.info) &&
        !("fork" in exportData.info) &&
        !("agent" in exportData.info) &&
        isIndependentCopy(observedNativeExport, exportData, sourceID, source.paths.cwd);
      checks.sourceHistoryHasKnownAnswer = hasKnownAnswer(exportData);
      checks.sourceSessionBusyThenIdle = busyObserved && idleAfterBusyObserved;
      if (!checks.nativeExportFileOwnedAndPrivate || !checks.sourceHistoryHasKnownAnswer)
        throw Object.assign(new Error(), { code: "native_export_invalid" });
      const sourceCwd = source.paths.cwd;
      const destinationIsolation = destination;
      if (!destinationIsolation) throw Object.assign(new Error(), { code: "destination_isolation_missing" });
      const expectedCopiedID =
        isRecord(exportData) && isRecord(exportData.info) && typeof exportData.info.id === "string"
          ? exportData.info.id
          : undefined;
      const importEnv = { ...destination.environment, PATH: CLI_PATH };
      if (!exactDestinationEnvironment(importEnv, destination.paths))
        throw Object.assign(new Error(), { code: "destination_environment_invalid" });
      const command = async (args: string[]) => {
        if (Date.now() - started >= OVERALL_MS - CLI_REAP_RESERVE_MS || overall.signal.aborted)
          throw Object.assign(new Error(), { code: "overall_deadline" });
        const freshDestinationGate = evaluateStaticPrelaunchGate(
          destinationIsolation.environment,
          destinationIsolation.paths,
          await inspectAmbientConfigSources(),
        );
        if (
          freshDestinationGate.status !== "READY_FOR_DISPOSABLE_SPIKE" ||
          !exactDestinationEnvironment(importEnv, destinationIsolation.paths)
        )
          throw Object.assign(new Error(), { code: "destination_environment_invalid" });
        const output = await runCli("opencode", args, sourceCwd, importEnv, result.cliPIDs, started + OVERALL_MS);
        result.counts.cliCommands += 1;
        result.counts.maxCommandOutputBytes = Math.max(result.counts.maxCommandOutputBytes, output.outputBytes);
        if (output.outputBytes > OUTPUT_LIMIT) throw Object.assign(new Error(), { code: "cli_output_limit" });
        return output;
      };
      const imported = await command(["session", "import", "--standalone", nativeExportPath]);
      copiedID = importMarker(imported.stdout, expectedCopiedID);
      checks.importMarkerExact = imported.code === 0 && copiedID === expectedCopiedID;
      if (!checks.importMarkerExact || !copiedID) throw Object.assign(new Error(), { code: "import_marker_invalid" });
      checks.copiedSessionIDFresh = copiedID !== sourceID;
      const copiedExport = await command(["session", "export", copiedID, "--standalone"]);
      let copiedData: unknown;
      try {
        copiedData = JSON.parse(copiedExport.stdout);
      } catch {
        copiedData = undefined;
      }
      checks.copiedExportValid =
        copiedExport.code === 0 &&
        isRecord(copiedData) &&
        isRecord(copiedData.info) &&
        copiedData.info.id === copiedID &&
        Array.isArray(copiedData.messages) &&
        uniqueOuterIDs(copiedData) !== undefined;
      checks.importedAgentNotScout =
        isRecord(copiedData) && isRecord(copiedData.info) && copiedData.info.agent !== "scout";
      checks.copiedHistoryAndLocationExact =
        sameTransferHistory(exportData, copiedData) &&
        isRecord(copiedData) &&
        isRecord(copiedData.info) &&
        isRecord(copiedData.info.location) &&
        copiedData.info.location.directory === source.paths.cwd;
      const sourceExport = await command(["session", "export", sourceID, "--standalone"]);
      checks.sourceExportRejectedByDestination = sourceExport.code !== 0;
      const duplicateImport = await command(["session", "import", "--standalone", nativeExportPath]);
      checks.duplicateImportRejectedByHandshake =
        duplicateImport.code === 0 &&
        importMarker(duplicateImport.stdout) === undefined &&
        duplicateImport.stderr.includes("Session already exists");
      const sourceAfter = await agent.getSession(sourceID);
      const messagesAfter = await agent.getMessages(sourceID);
      checks.sourceSessionUnchanged =
        sourceAfter.id === sourceBefore.id &&
        sourceAfter.title === sourceBefore.title &&
        JSON.stringify(messagesAfter) === JSON.stringify(sourceMessages);
      checks.sourceAgentAlive =
        sourcePID !== undefined && !agentDisconnected(sourcePID) && (await agent.getSession(sourceID)).id === sourceID;
      checks.allFourCommandsBounded =
        result.counts.cliCommands === 4 &&
        result.counts.sourcePolls <= SOURCE_POLL_LIMIT &&
        result.counts.maxModelRequestBytes <= FIXTURE_REQUEST_LIMIT &&
        result.counts.maxCommandOutputBytes <= OUTPUT_LIMIT &&
        result.cliPIDs.length === 4;
      checks.allOperationBounds =
        result.counts.sourceApiRequests <= 35 &&
        result.counts.modelRequests === 1 &&
        result.counts.sourceSessions === 1 &&
        result.counts.cliCommands === 4 &&
        Date.now() - started <= OVERALL_MS;
      result.status = Object.values(checks).every(Boolean) ? "RUNNING" : "FAIL";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const known = new Set([
        "dedicated_fork_required",
        "executable_required",
        "ambient_gate_blocked",
        "pinned_executable_mismatch",
        "executable_not_canonical",
        "client_version_mismatch",
        "native_version_mismatch",
        "isolation_roots_not_distinct",
        "mutable_paths_not_disjoint",
        "destination_environment_invalid",
        "native_export_invalid",
        "import_marker_invalid",
        "source_api_limit",
        "source_prompt_timeout",
        "cli_group_reap_failed",
        "cli_timeout",
        "cli_output_limit",
        "overall_deadline",
        "foreign_fetch_blocked",
      ]);
      result.failureCode = typeof code === "string" && known.has(code) ? code : "fixture_operation_failed";
      result.status = [
        "dedicated_fork_required",
        "executable_required",
        "ambient_gate_blocked",
        "pinned_executable_mismatch",
        "executable_not_canonical",
        "client_version_mismatch",
      ].includes(result.failureCode)
        ? "BLOCKED"
        : "FAIL";
    } finally {
      const preTeardownChecks = { ...checks };
      result.preTeardown = {
        status: result.status,
        counts: { ...result.counts },
        checks: preTeardownChecks,
        ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      };
      try {
        await persist();
      } catch {
        result.failureCode = "evidence_persist_failed";
        result.status = "FAIL";
      }
      if (agent) {
        try {
          agent.disconnect();
          const cleanup = (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise;
          if (cleanup) {
            await bounded(cleanup, CLEANUP_MS);
            result.cleanup.sourceAgent = true;
          }
        } catch {
          result.cleanup.sourceAgent = false;
        }
      }
      const cliReaps = await Promise.all(result.cliPIDs.map((pid) => terminateGroupBounded(pid).catch(() => false)));
      result.cleanup.cliGroups =
        result.cliPIDs.length === 4 && result.counts.cliCommands === 4 && cliReaps.every(Boolean);
      if (sourcePID !== undefined) {
        const sourceGroupGoneBeforeForcedReap = await groupGoneWithin(sourcePID, CLEANUP_MS);
        result.cleanup.sourceProcessGroupGone = sourceGroupGoneBeforeForcedReap && agentDisconnected(sourcePID);
        result.cleanup.sourceAgent = result.cleanup.sourceAgent && result.cleanup.sourceProcessGroupGone;
        if (!result.cleanup.sourceProcessGroupGone) await terminateGroupBounded(sourcePID).catch(() => false);
      } else {
        result.cleanup.sourceAgent = false;
        result.cleanup.sourceProcessGroupGone = false;
      }
      if (fixture) {
        try {
          const closed = new Promise<void>((resolveClose) => fixture?.close(() => resolveClose()));
          fixture.closeAllConnections();
          await bounded(closed, 1_000);
          result.cleanup.fixtureServer = true;
        } catch {
          result.cleanup.fixtureServer = false;
        }
      }
      globalThis.fetch = originalFetch;
      result.cleanup.fetchRestored = globalThis.fetch === originalFetch;
      if (exportPath) {
        const fs = await import("node:fs/promises");
        await fs.rm(exportPath, { force: true }).catch(() => undefined);
        try {
          await access(exportPath);
          result.cleanup.exportRemoved = false;
        } catch (error) {
          result.cleanup.exportRemoved = (error as NodeJS.ErrnoException).code === "ENOENT";
        }
      }
      for (const [isolation, field] of [
        [source, "sourceIsolation"],
        [destination, "destinationIsolation"],
      ] as const) {
        if (!isolation) continue;
        try {
          await isolation.dispose();
          ownedIsolations.delete(isolation);
          result.cleanup[field] = true;
        } catch {
          result.cleanup[field] = false;
        }
      }
      const ownedPathsRemoved = [
        source?.root,
        source?.paths.state,
        source?.paths.database,
        destination?.root,
        destination?.paths.state,
        destination?.paths.database,
      ].filter((path): path is string => path !== undefined);
      result.cleanup.stateDatabaseCleanup =
        ownedPathsRemoved.length === 6 && (await Promise.all(ownedPathsRemoved.map(isAbsent))).every(Boolean);
      if (environmentReplaced) {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, originalEnvironment);
        result.cleanup.environmentRestored =
          Object.keys(process.env).length === Object.keys(originalEnvironment).length &&
          Object.entries(originalEnvironment).every(([key, value]) => process.env[key] === value);
      }
      clearTimeout(overallTimer);
      result.status =
        result.status === "RUNNING" &&
        Object.values(checks).every(Boolean) &&
        Object.values(result.cleanup).every(Boolean)
          ? "PASS"
          : result.status === "BLOCKED"
            ? "BLOCKED"
            : "FAIL";
      if (result.status !== "PASS" && !result.failureCode) result.failureCode = "fixture_operation_failed";
      try {
        await persist();
      } catch {
        result.status = "FAIL";
        result.failureCode = "evidence_persist_failed";
      }
    }
    const persisted: Result = JSON.parse(await readFile(resultPath, "utf8"));
    expect(persisted.status).toBe("PASS");
    expect(Object.keys(persisted.checks).sort()).toEqual([...CHECK_NAMES].sort());
    expect(Object.values(persisted.checks).every(Boolean)).toBe(true);
    expect(persisted.counts).toEqual({
      sourceApiRequests: expect.any(Number),
      modelRequests: 1,
      sourceSessions: 1,
      cliCommands: 4,
      maxCommandOutputBytes: expect.any(Number),
      maxModelRequestBytes: expect.any(Number),
      sourcePolls: expect.any(Number),
    });
    expect(persisted.counts.sourceApiRequests).toBeLessThanOrEqual(35);
    expect(persisted.counts.maxCommandOutputBytes).toBeLessThanOrEqual(OUTPUT_LIMIT);
    expect(persisted.counts.maxModelRequestBytes).toBeLessThanOrEqual(FIXTURE_REQUEST_LIMIT);
    expect(persisted.counts.sourcePolls).toBeLessThanOrEqual(SOURCE_POLL_LIMIT);
    expect(persisted.bounds).toMatchObject({
      maxModelRequestBytes: 64 * 1024,
      sourcePolls: 8,
      sourcePollIntervalMs: 250,
      maxConcurrentOpenCodeProcesses: 3,
      isolationRoots: 2,
    });
    expect(persisted.executableSha256).toBe(EXPECTED_SHA256);
    expect(persisted.clientPackage).toBe("@opencode/client@2.1.0");
    expect(persisted.expectedServer).toBe("2.2.0");
    expect(persisted.observationScope).toBe("TEST_HARNESS_SOURCE_API_OBSERVER_ONLY");
    expect(Object.values(persisted.cleanup).every(Boolean)).toBe(true);
  },
  105_000,
);
