import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { OpenCodeClient, SessionTransferData } from "@opencode/client";
import { copySessionTransferData } from "../native-session-transfer.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
} from "./v2-test-isolation.js";

const EXPECTED_VERSION = "2.2.0";
const EXPECTED_CLIENT_VERSION = "2.1.0";
const EXPECTED_CLIENT_NAME = "@opencode/client";
const SOURCE_COMMIT = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const OVERALL_TIMEOUT_MS = 90_000;
const API_REQUEST_LIMIT = 30;
const MODEL_REQUEST_LIMIT = 3;
const SESSION_LIMIT = 3;
const OUTPUT_LIMIT = 32_768;
const RESPONSE_TIMEOUT_MS = 5_000;
const REQUIRED_CHECKS = [
  "authNegativeProbe",
  "authenticatedReadiness",
  "serverTemporaryPath",
  "exactWorkspaceLocation",
  "hermeticPluginMcpInventory",
  "emptyAgentsRoot",
  "noServiceRegistrationFiles",
  "fixtureStateRoots",
  "fixtureDatabasePath",
  "sessionLocationAndSelection",
  "promptAdmission",
  "completedAnswer",
  "transferExportShape",
  "transferExportSourceID",
  "transferExportMessageIDs",
  "transferExportKnownAnswer",
  "transferCopyNewIDs",
  "transferCopyControlsCleared",
  "transferCopyPermissionsPreserved",
  "transferCopyHistoryPreserved",
  "transferImportID",
  "transferImportLocation",
  "transferImportAgentIndependent",
  "transferImportHistory",
  "transferCopyRename",
  "transferOriginalUnchanged",
  "transferCopyUpdated",
  "transferOriginalHistoryUnchanged",
  "eventFraming",
  "effectiveModelAgentSelection",
  "abortTransport",
  "interruptAcknowledged",
  "stalledMockObserved",
  "stalledMockClosedAfterInterrupt",
  "interruptedTerminalState",
  "modelAgentReachedMock",
  "requestBounds",
  "childCleanup",
  "fixtureStateCleanup",
  "eventBufferBound",
  "fixtureConfigSources",
] as const;

export interface SpikeResult {
  readonly status: "PASS" | "FAIL";
  readonly expectedVersion: string;
  readonly clientPackage: "@opencode/client@2.1.0";
  readonly observedVersion?: string;
  readonly sourceCommit: string;
  readonly qualification: "BUILTIN_HTTP_MOCK_PROVIDER_API_SPIKE_ONLY" | "CUSTOM_MOCK_PROVIDER_API_SPIKE_ONLY";
  readonly providerFixturePath: string;
  readonly checks: Record<string, boolean>;
  readonly counts: { readonly apiRequests: number; readonly modelRequests: number; readonly sessionOperations: number };
  readonly fixtureRoot: string;
  readonly fixturePaths: { config: string; data: string; state: string; database: string; tmp: string; cwd: string };
  readonly evidencePath: string;
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly sourceCommitMeaning: "inspected-release-tag";
  readonly clientModulePath: string;
  readonly failureStage?: string;
  readonly failureCode?: "STAGE_FAILED" | "ASSERTION_FAILED" | "BOUNDS_EXCEEDED" | "CLEANUP_FAILED";
}

interface PromiseClient {
  readonly server: { info(): Promise<{ version: string; pid: number; urls: string[]; paths: { tmp: string } }> };
  readonly location: { get(input?: unknown): Promise<{ directory: string }> };
  readonly event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<SpikeEvent>;
  };
  readonly session: {
    create(input?: Record<string, unknown>): Promise<{
      id: string;
      location: { directory: string };
      model?: { providerID: string; id: string };
      agent?: string;
    }>;
    get: OpenCodeClient["session"]["get"];
    prompt(input: { sessionID: string; text: string }): Promise<{ id: string; sessionID: string; type: "user" }>;
    switchModel(input: { sessionID: string; model: { providerID: string; id: string } }): Promise<void>;
    switchAgent(input: { sessionID: string; agent: string }): Promise<void>;
    interrupt(input: { sessionID: string }): Promise<{ interrupted: boolean }>;
    export: OpenCodeClient["session"]["export"];
    import: OpenCodeClient["session"]["import"];
    update: OpenCodeClient["session"]["update"];
  };
  readonly plugin: { list(): Promise<{ location: { directory: string }; data: unknown[] }> };
  readonly mcp: { list(): Promise<{ location: { directory: string }; data: unknown[] }> };
  readonly message: { list: OpenCodeClient["message"]["list"] };
}

interface SpikeEvent {
  type: string;
  data?: { sessionID?: string; agent?: string; model?: { providerID: string; id: string } };
}

interface ClientModule {
  make?: (options: { baseUrl: string; headers: Record<string, string>; fetch: typeof fetch }) => unknown;
  OpenCode?: { make?: ClientModule["make"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function promiseClientFactory(module: unknown): ClientModule["make"] {
  if (!isRecord(module)) return undefined;
  if (typeof module.make === "function") return module.make as ClientModule["make"];
  const namespace = module.OpenCode;
  return isRecord(namespace) && typeof namespace.make === "function"
    ? (namespace.make as ClientModule["make"])
    : undefined;
}

export function assertPromiseClient(value: unknown): PromiseClient {
  if (!isRecord(value)) throw new Error("Promise client surface is malformed");
  const paths = [
    ["server", "info"],
    ["location", "get"],
    ["event", "subscribe"],
    ["session", "create"],
    ["session", "get"],
    ["session", "prompt"],
    ["session", "switchModel"],
    ["session", "switchAgent"],
    ["session", "interrupt"],
    ["session", "export"],
    ["session", "import"],
    ["session", "update"],
    ["message", "list"],
    ["plugin", "list"],
    ["mcp", "list"],
  ];
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) current = isRecord(current) ? current[key] : undefined;
    if (typeof current !== "function") throw new Error("Promise client surface is malformed");
  }
  return value as unknown as PromiseClient;
}

export function hasHermeticInventories(plugins: unknown, mcps: unknown) {
  if (!hasEmptyListEnvelope(mcps) || !isRecord(plugins) || !Array.isArray(plugins.data)) return false;
  return plugins.data.every((plugin) => {
    if (!isRecord(plugin) || !isRecord(plugin.source) || !isRecord(plugin.state) || !isRecord(plugin.features))
      return false;
    return (
      plugin.source.type === "builtin" &&
      Object.keys(plugin.source).length === 1 &&
      plugin.state.status === "active" &&
      Object.entries(plugin.features).every(
        ([feature, enabled]) => ["server", "tui", "rpc"].includes(feature) && enabled === true,
      ) &&
      (plugin.id === undefined || typeof plugin.id === "string")
    );
  });
}

export function hasExpectedMessages(response: unknown, answer: string): boolean {
  if (!isRecord(response) || !Array.isArray(response.data)) return false;
  return response.data.some((entry) => {
    if (!isRecord(entry) || entry.type !== "assistant" || !Array.isArray(entry.content)) return false;
    return entry.content.some((part) => isRecord(part) && part.type === "text" && part.text === answer);
  });
}

export function hasEmptyListEnvelope(response: unknown): boolean {
  return isRecord(response) && Array.isArray(response.data) && response.data.length === 0;
}

export async function readInventoryStage(client: PromiseClient): Promise<boolean> {
  const [plugins, mcps] = await Promise.all([client.plugin.list(), client.mcp.list()]);
  return hasHermeticInventories(plugins, mcps);
}

export async function readMessageStage(client: PromiseClient, sessionID: string, answer: string): Promise<boolean> {
  return hasExpectedMessages(await client.message.list({ sessionID }), answer);
}

function hasTransferAnswer(data: SessionTransferData, answer: string): boolean {
  return hasExpectedMessages({ data: data.messages }, answer);
}

function hasNativeMessageIDs(data: SessionTransferData): boolean {
  return data.messages.every((message) => message.id.startsWith("msg_"));
}

export function matchesSelectedStep(event: SpikeEvent, sessionID: string): boolean {
  return (
    event.type === "session.step.started" &&
    event.data?.sessionID === sessionID &&
    event.data.agent === "spike-deny-all" &&
    event.data.model?.providerID === "spike-mock" &&
    event.data.model.id === "mock-model"
  );
}

export function isSessionExecutionSucceeded(event: SpikeEvent, sessionID: string): boolean {
  return event.type === "session.execution.succeeded" && event.data?.sessionID === sessionID;
}

export function confirmsInterrupt(response: unknown): boolean {
  return isRecord(response) && response.interrupted === true;
}

export function hasInterruptedOutcome(response: unknown): boolean {
  return isRecord(response) && response.outcome === "interrupted";
}

export function abortTransportProven(input: {
  interruptAcknowledged: boolean;
  stalledMockObserved: boolean;
  stalledMockClosedAfterInterrupt: boolean;
}): boolean {
  return input.interruptAcknowledged && input.stalledMockObserved && input.stalledMockClosedAfterInterrupt;
}

export async function waitForStalledMockClose(
  observation: { readonly closedAt?: number },
  overallDeadline: number,
  afterTimestamp: number,
  options: {
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const deadline = Math.min(overallDeadline, now() + 1_000);
  while (observation.closedAt === undefined) {
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(20, remaining));
  }
  return observation.closedAt >= afterTimestamp;
}

interface RuntimeInputs {
  executable: string;
  clientModule: string;
  lane: "native" | "aisdk-fixture";
}

function runtimeInputs(): RuntimeInputs | undefined {
  if (process.env.OPENCODE_CHAT_RUN_V2_SPIKE !== "1") return undefined;
  const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
  const clientModule = process.env.OPENCODE_CHAT_V2_CLIENT_MODULE;
  if (!executable || !isAbsolute(executable) || !clientModule || !isAbsolute(clientModule)) {
    throw new Error("V2 spike requires absolute executable and pinned Promise-client module inputs");
  }
  return {
    executable: resolve(executable),
    clientModule: resolve(clientModule),
    lane: process.env.OPENCODE_CHAT_V2_SPIKE_PROVIDER_LANE === "aisdk-fixture" ? "aisdk-fixture" : "native",
  };
}

export function evaluateEvidence(input: {
  checks: Record<string, boolean>;
  failed: boolean;
  cleanupSucceeded: boolean;
  boundsHeld: boolean;
}): "PASS" | "FAIL" {
  return !input.failed &&
    input.cleanupSucceeded &&
    input.boundsHeld &&
    REQUIRED_CHECKS.every((name) => input.checks[name] === true)
    ? "PASS"
    : "FAIL";
}

async function raceTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function basicHeader(password: string) {
  return `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`;
}

export function matchesExpectedCliVersion(output: string): boolean {
  const line = output.endsWith("\r\n") ? output.slice(0, -2) : output.endsWith("\n") ? output.slice(0, -1) : output;
  const match = /opencode v?(\d+\.\d+\.\d+)/u.exec(line);
  return match?.[0] === line && match[1] === EXPECTED_VERSION;
}

export function isExpectedClientPackage(value: unknown): value is {
  readonly name: "@opencode/client";
  readonly version: typeof EXPECTED_CLIENT_VERSION;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    "name" in value &&
    value.name === EXPECTED_CLIENT_NAME &&
    "version" in value &&
    value.version === EXPECTED_CLIENT_VERSION
  );
}

export function boundedFetch(delegate: typeof fetch, overallSignal: AbortSignal, maxRequests = API_REQUEST_LIMIT) {
  let requests = 0;
  let boundsHeld = true;
  const fetcher: typeof fetch = async (input, init) => {
    if (requests >= maxRequests) {
      boundsHeld = false;
      throw new Error("V2 spike API request limit exceeded");
    }
    requests += 1;
    const signals = [overallSignal, AbortSignal.timeout(RESPONSE_TIMEOUT_MS)];
    if (init?.signal) signals.push(init.signal as AbortSignal);
    const response = await delegate(input, { ...init, signal: AbortSignal.any(signals) });
    if (response.headers.get("content-length") && Number(response.headers.get("content-length")) > OUTPUT_LIMIT) {
      boundsHeld = false;
      throw new Error("V2 spike response byte limit exceeded");
    }
    if (!response.body) return response;
    let bytes = 0;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > OUTPUT_LIMIT) {
            boundsHeld = false;
            controller.error(new Error("V2 spike response byte limit exceeded"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return {
    fetch: fetcher,
    get requests() {
      return requests;
    },
    get boundsHeld() {
      return boundsHeld;
    },
  };
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("mock server did not bind TCP"));
      else resolvePort(address.port);
    });
  });
}

async function stopChild(child: ChildProcess | undefined): Promise<boolean> {
  if (!child || child.pid === undefined) return child === undefined;
  const pid = child.pid;
  const groupExists = () => {
    if (process.platform === "win32") return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      return false;
    }
  };
  const signal = (kind: NodeJS.Signals) => {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, kind);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const waitGroup = async (duration: number) => {
    const until = Date.now() + duration;
    while (groupExists() && Date.now() < until) await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    return !groupExists();
  };
  if (groupExists()) signal("SIGTERM");
  if (!(await waitGroup(1_000))) {
    signal("SIGKILL");
    if (!(await waitGroup(1_000))) return false;
  }
  if (child.exitCode === null && child.signalCode === null) {
    return new Promise((resolveExit) => {
      const timer = setTimeout(() => resolveExit(false), 1_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolveExit(true);
      });
    });
  }
  return !groupExists();
}

function collectOutput(child: ChildProcess, consume: (text: string) => void) {
  let bytes = 0;
  let text = "";
  let overflowed = false;
  const append = (chunk: Buffer) => {
    if (overflowed) return;
    bytes += chunk.byteLength;
    if (bytes > OUTPUT_LIMIT) {
      overflowed = true;
      child.kill("SIGTERM");
      return;
    }
    text += chunk.toString("utf8");
    consume(text);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return () => (overflowed ? "" : text);
}

function waitForLine(readOutput: () => string, pattern: RegExp, deadline: number): Promise<RegExpExecArray> {
  return new Promise((resolveLine, reject) => {
    const check = () => {
      const match = pattern.exec(readOutput());
      if (match) return resolveLine(match);
      if (Date.now() >= deadline) return reject(new Error("owned server startup deadline exceeded"));
      setTimeout(check, 20);
    };
    check();
  });
}

export async function runV2ContractSpike(): Promise<SpikeResult> {
  const inputs = runtimeInputs();
  if (!inputs) throw new Error("V2 runtime spike is opt-in and is disabled by default");

  const projectRoot = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
  const isolation = await createV2TestIsolation(projectRoot);
  const runID = randomUUID();
  const evidenceRoot = join(projectRoot, "tmp/scribe-v2-migration/spike", runID);
  await mkdir(evidenceRoot, { recursive: true });
  await assertOwnedPath(projectRoot, evidenceRoot);
  const mockRequests: Array<{ model?: string; stalled: boolean; aborted: boolean; closedAt?: number }> = [];
  let modelBoundsHeld = true;
  let modelRequestCount = 0;
  let sessionCount = 0;
  const activeMockResponses = new Set<import("node:http").ServerResponse>();
  const mock = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    modelRequestCount += 1;
    if (modelRequestCount > MODEL_REQUEST_LIMIT) {
      modelBoundsHeld = false;
      response.writeHead(429).end();
      return;
    }
    let body = "";
    let bodyBytes = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > 16_384) {
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (bodyBytes > 16_384) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const model =
        typeof parsed === "object" && parsed !== null && "model" in parsed && typeof parsed.model === "string"
          ? parsed.model
          : undefined;
      const containsControl = (value: unknown, control: string): boolean => {
        if (typeof value === "string") return value.includes(control);
        if (Array.isArray(value)) return value.some((entry) => containsControl(entry, control));
        if (isRecord(value)) return Object.values(value).some((entry) => containsControl(entry, control));
        return false;
      };
      const stalled = containsControl(parsed, "spike abort control");
      const observation: { model?: string; stalled: boolean; aborted: boolean; closedAt?: number } = {
        model,
        stalled,
        aborted: false,
      };
      mockRequests.push(observation);
      if (stalled) {
        activeMockResponses.add(response);
        const markClosed = () => {
          observation.aborted = true;
          observation.closedAt ??= Date.now();
          activeMockResponses.delete(response);
        };
        request.on("aborted", () => {
          markClosed();
        });
        response.on("close", () => {
          markClosed();
        });
        return;
      }
      const answer = containsControl(parsed, "spike completion control") ? "spike complete" : "";
      if (inputs.lane === "aisdk-fixture") {
        response.writeHead(200, { "content-type": "application/json" }).end('{"accepted":true}');
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(
        `data: ${JSON.stringify({ id: "spike", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
      );
      if (answer)
        response.write(
          `data: ${JSON.stringify({ id: "spike", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] })}\n\n`,
        );
      response.end(
        `data: ${JSON.stringify({ id: "spike", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });

  let child: ChildProcess | undefined;
  let client: PromiseClient | undefined;
  let password = "";
  let eventAbort: AbortController | undefined;
  let eventTask: Promise<void> | undefined;
  let promptTask: Promise<{ id: string; sessionID: string; type: "user" }> | undefined;
  const checks: Record<string, boolean> = {};
  let observedVersion: string | undefined;
  let executableSha256 = "";
  let failureStage = "preflight";
  let failed = false;
  let failureCode: SpikeResult["failureCode"];
  const overallAbort = new AbortController();
  const requestBudget = boundedFetch(globalThis.fetch, overallAbort.signal);
  let finalResult: SpikeResult | undefined;
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const timer = setTimeout(() => {
    overallAbort.abort();
    void stopChild(child);
  }, OVERALL_TIMEOUT_MS);
  try {
    if (isolation.staticGate.status !== "READY_FOR_DISPOSABLE_SPIKE")
      throw new Error("static prelaunch isolation gate is blocked");
    failureStage = "fixture-config";
    const port = await listen(mock);
    const configFile = join(isolation.paths.config, "opencode", "opencode.json");
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures/v2-spike-provider.mjs");
    await writeFile(
      configFile,
      JSON.stringify({
        agents: {
          "spike-deny-all": {
            mode: "primary",
            description: "Disposable no-tools contract fixture",
            permissions: [{ action: "*", resource: "*", effect: "deny" }],
          },
        },
        model: "spike-mock/mock-model",
        providers: {
          "spike-mock": {
            package: "@opencode/ai/providers/openai-compatible",
            name: "Disposable local mock",
            settings: { baseURL: `http://127.0.0.1:${port}/v1` },
            models: {
              "mock-model": {
                name: "Disposable mock model",
                ...(inputs.lane === "aisdk-fixture" ? { package: `aisdk:${pathToFileURL(fixturePath).href}` } : {}),
              },
            },
          },
        },
      }),
      { mode: 0o600 },
    );
    await assertIsolatedEnvironment(isolation.environment, isolation.paths);
    await assertOwnedPath(isolation.root, isolation.paths.cwd);
    failureStage = "executable-version";
    child = spawn(inputs.executable, ["--version"], {
      cwd: isolation.paths.cwd,
      env: isolation.environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let versionText = "";
    let versionBytes = 0;
    child.stdout?.on("data", (chunk: Buffer) => {
      versionBytes += chunk.byteLength;
      if (versionBytes > 4_096) {
        child?.kill("SIGKILL");
        return;
      }
      versionText += chunk.toString("utf8");
    });
    child.stderr?.on("data", () => {});
    const versionProcess = child;
    const versionCodePromise = new Promise<number | null>((resolveCode, reject) => {
      versionProcess.once("error", () => reject(new Error("pinned executable version check could not start")));
      versionProcess.once("close", (code) => resolveCode(code));
    });
    const versionCode = await raceTimeout(versionCodePromise, 3_000, "pinned executable version check timed out");
    const versionReaped = await stopChild(versionProcess);
    child = undefined;
    if (!versionReaped || versionCode !== 0 || !matchesExpectedCliVersion(versionText)) {
      throw new Error("selected executable did not report the pinned server version");
    }
    executableSha256 = createHash("sha256")
      .update(await readFile(inputs.executable))
      .digest("hex");
    const spawnAmbient = await inspectAmbientConfigSources();
    const spawnGate = evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, spawnAmbient);
    if (spawnGate.status !== "READY_FOR_DISPOSABLE_SPIKE")
      throw new Error("spawn-time ambient isolation check is blocked");
    for (const path of Object.values(isolation.paths)) await assertOwnedPath(isolation.root, path);
    assertIsolatedEnvironment(isolation.environment, isolation.paths);
    failureStage = "owned-server-startup";
    child = spawn(inputs.executable, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd: isolation.paths.cwd,
      env: isolation.environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const outputGetter = collectOutput(child, () => {});
    const childStartError = new Promise<never>((_, reject) => {
      child?.once("error", () => reject(new Error("owned server spawn failed")));
    });
    await Promise.race([
      waitForLine(outputGetter, /server listening on (http:\/\/127\.0\.0\.1:\d+)/, deadline),
      childStartError,
    ]);
    await Promise.race([waitForLine(outputGetter, /server password ([A-Za-z0-9_-]+)/, deadline), childStartError]);
    const urlMatch = /server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(outputGetter());
    const passwordMatch = /server password ([A-Za-z0-9_-]+)/.exec(outputGetter());
    if (!urlMatch || !passwordMatch)
      throw new Error("owned foreground server omitted expected private readiness material");
    const url = urlMatch[1];
    password = passwordMatch[1];
    failureStage = "authenticated-client-contract";
    const unauthenticated = await requestBudget.fetch(`${url}/api/info`);
    checks.authNegativeProbe = unauthenticated.status === 401;
    const clientPackagePath = resolve(dirname(inputs.clientModule), "../../package.json");
    const clientPackage: unknown = JSON.parse(await readFile(clientPackagePath, "utf8"));
    if (!isExpectedClientPackage(clientPackage)) {
      throw new Error("pinned client module metadata does not match the expected package pair");
    }
    const moduleURL = pathToFileURL(inputs.clientModule).href;
    const loaded: unknown = await import(moduleURL);
    const factory = promiseClientFactory(loaded);
    if (!factory) throw new Error("pinned client fixture does not export the Promise make contract");
    client = assertPromiseClient(
      factory({
        baseUrl: url,
        headers: { authorization: basicHeader(password) },
        fetch: requestBudget.fetch,
      }),
    );
    const info = await client.server.info();
    observedVersion = info.version;
    checks.authenticatedReadiness =
      info.version === EXPECTED_VERSION && info.pid === child.pid && info.urls.includes(url);
    checks.serverTemporaryPath = info.paths.tmp === join(isolation.paths.tmp, "opencode");
    checks.fixtureDatabasePath =
      isolation.environment.OPENCODE_DB === isolation.paths.database && (await pathExists(isolation.paths.database));
    failureStage = "inventory-and-isolation";
    const location = await client.location.get();
    checks.exactWorkspaceLocation = resolve(location.directory) === resolve(isolation.paths.cwd);
    checks.hermeticPluginMcpInventory = await readInventoryStage(client);
    checks.emptyAgentsRoot = !(await pathExists(join(isolation.paths.home, ".agents")));
    const configNames = await directoryEntries(join(isolation.paths.config, "opencode"));
    const serviceNames = await directoryEntries(isolation.paths.serviceState);
    checks.noServiceRegistrationFiles =
      !configNames.some((name) => /^service(?:[-.].*)?\.json$/u.test(name)) &&
      !serviceNames.some((name) => /^service(?:[-.].*)?\.json$/u.test(name));
    checks.fixtureConfigSources =
      configNames.includes("opencode.json") &&
      configNames.every((name) => name === "opencode.json") &&
      (await directoryEntries(isolation.paths.cwd)).length === 0;
    checks.fixtureStateRoots = (
      await Promise.all(
        [
          isolation.paths.home,
          isolation.paths.config,
          isolation.paths.data,
          isolation.paths.cache,
          isolation.paths.state,
          isolation.paths.tmp,
          isolation.paths.cwd,
          isolation.paths.database,
        ].map(async (path) => {
          await assertOwnedPath(isolation.root, path);
          return (await realpath(path)) === path;
        }),
      )
    ).every(Boolean);
    checks.fixtureDatabasePath &&= isolation.paths.database.startsWith(`${isolation.root}/`);
    failureStage = "session-contract";
    if (sessionCount >= SESSION_LIMIT) throw new Error("session bound exceeded");
    sessionCount += 1;
    const session = await client.session.create({
      title: "V2 disposable spike completion",
      location: { directory: isolation.paths.cwd },
      agent: "spike-deny-all",
      model: { providerID: "spike-mock", id: "mock-model" },
    });
    checks.sessionLocationAndSelection =
      session.id.length > 0 &&
      session.location.directory === isolation.paths.cwd &&
      session.agent === "spike-deny-all" &&
      session.model?.providerID === "spike-mock";
    eventAbort = new AbortController();
    const stream = client.event.subscribe({ signal: eventAbort.signal });
    const frames: string[] = [];
    let eventBufferHeld = true;
    let sessionExecutionStarted = false;
    let sessionExecutionSucceeded = false;
    let selectedAtExecution = false;
    eventTask = (async () => {
      for await (const event of stream) {
        if (frames.length >= 256) {
          eventBufferHeld = false;
          throw new Error("event frame buffer limit exceeded");
        }
        frames.push(event.type);
        if (event.type === "session.execution.started" && event.data?.sessionID === session.id)
          sessionExecutionStarted = true;
        if (matchesSelectedStep(event, session.id)) selectedAtExecution = true;
        if (isSessionExecutionSucceeded(event, session.id)) {
          sessionExecutionSucceeded = true;
          return;
        }
      }
    })();
    failureStage = "prompt-completion-events";
    const admitted = await client.session.prompt({ sessionID: session.id, text: "spike completion control" });
    checks.promptAdmission = admitted.sessionID === session.id && admitted.type === "user";
    await raceTimeout(eventTask, Math.max(1, deadline - Date.now()), "SSE completion deadline exceeded");
    checks.completedAnswer = await readMessageStage(client, session.id, "spike complete");
    checks.eventBufferBound = eventBufferHeld;
    checks.eventFraming = sessionExecutionStarted && sessionExecutionSucceeded;
    checks.effectiveModelAgentSelection = selectedAtExecution;
    await client.session.switchModel({ sessionID: session.id, model: { providerID: "spike-mock", id: "mock-model" } });
    await client.session.switchAgent({ sessionID: session.id, agent: "spike-deny-all" });

    failureStage = "session-transfer-contract";
    const sourceData = await client.session.export({ sessionID: session.id });
    const sourceSnapshot = structuredClone(sourceData);
    checks.transferExportShape = isRecord(sourceData.info) && Array.isArray(sourceData.messages);
    checks.transferExportSourceID = sourceData.info.id === session.id;
    checks.transferExportMessageIDs = hasNativeMessageIDs(sourceData);
    checks.transferExportKnownAnswer = hasTransferAnswer(sourceData, "spike complete");
    const copiedData = copySessionTransferData(sourceData);
    const sourceIDs = [sourceData.info.id, ...sourceData.messages.map((message) => message.id)];
    const copiedIDs = [copiedData.info.id, ...copiedData.messages.map((message) => message.id)];
    checks.transferCopyNewIDs =
      copiedIDs.every((id, index) => id !== sourceIDs[index]) &&
      copiedIDs.every((id) => !sourceIDs.includes(id)) &&
      new Set(copiedIDs).size === copiedIDs.length;
    checks.transferCopyControlsCleared =
      copiedData.info.parentID === undefined &&
      copiedData.info.fork === undefined &&
      copiedData.info.agent === undefined;
    checks.transferCopyPermissionsPreserved = isDeepStrictEqual(
      copiedData.info.permissions,
      sourceData.info.permissions,
    );
    checks.transferCopyHistoryPreserved = isDeepStrictEqual(
      copiedData.messages.map((message, index) => ({ ...message, id: sourceData.messages[index]?.id })),
      sourceData.messages,
    );
    if (sessionCount >= SESSION_LIMIT) throw new Error("session bound exceeded");
    sessionCount += 1;
    const imported = await client.session.import({
      ...copiedData,
      location: { directory: isolation.paths.cwd },
    });
    checks.transferImportID = imported.id === copiedData.info.id && imported.id !== sourceData.info.id;
    checks.transferImportLocation = imported.location.directory === isolation.paths.cwd;
    checks.transferImportAgentIndependent = imported.agent !== "spike-deny-all";
    checks.transferImportHistory = await readMessageStage(client, imported.id, "spike complete");
    const renamedTitle = "V2 disposable spike transfer copy";
    await client.session.update({ sessionID: imported.id, title: renamedTitle });
    const [originalAfterRename, copyAfterRename] = await Promise.all([
      client.session.get({ sessionID: session.id }),
      client.session.get({ sessionID: imported.id }),
    ]);
    checks.transferCopyRename = copyAfterRename.title === renamedTitle;
    checks.transferOriginalUnchanged =
      originalAfterRename.id === sourceData.info.id && originalAfterRename.title === sourceData.info.title;
    checks.transferCopyUpdated = copyAfterRename.id === imported.id && copyAfterRename.title === renamedTitle;
    checks.transferOriginalHistoryUnchanged =
      (await readMessageStage(client, session.id, "spike complete")) && isDeepStrictEqual(sourceData, sourceSnapshot);

    failureStage = "abort-contract";
    if (sessionCount >= SESSION_LIMIT) throw new Error("session bound exceeded");
    sessionCount += 1;
    const abortSession = await client.session.create({
      title: "V2 disposable spike abort",
      location: { directory: isolation.paths.cwd },
      agent: "spike-deny-all",
      model: { providerID: "spike-mock", id: "mock-model" },
    });
    promptTask = client.session.prompt({ sessionID: abortSession.id, text: "spike abort control" });
    const mockDeadline = Date.now() + 10_000;
    while (!mockRequests.some((request) => request.stalled) && Date.now() < mockDeadline)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    const stalledObservation = mockRequests.find((request) => request.stalled);
    const interruptStartedAt = Date.now();
    const interrupted = await client.session.interrupt({ sessionID: abortSession.id });
    checks.interruptAcknowledged = confirmsInterrupt(interrupted);
    checks.stalledMockObserved = stalledObservation !== undefined;
    checks.stalledMockClosedAfterInterrupt = stalledObservation
      ? await waitForStalledMockClose(stalledObservation, deadline, interruptStartedAt)
      : false;
    await raceTimeout(
      promptTask.catch(() => undefined),
      3_000,
      "interrupted prompt request did not settle",
    );
    let terminal = await client.session.get({ sessionID: abortSession.id });
    const terminalDeadline = Date.now() + 3_000;
    while (terminal.outcome !== "interrupted" && Date.now() < terminalDeadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      terminal = await client.session.get({ sessionID: abortSession.id });
    }
    checks.abortTransport = abortTransportProven({
      interruptAcknowledged: checks.interruptAcknowledged,
      stalledMockObserved: checks.stalledMockObserved,
      stalledMockClosedAfterInterrupt: checks.stalledMockClosedAfterInterrupt,
    });
    checks.interruptedTerminalState = hasInterruptedOutcome(terminal);
    checks.modelAgentReachedMock =
      modelRequestCount === 2 && mockRequests.every((request) => request.model === "mock-model");
  } catch {
    failed = true;
    failureCode = requestBudget.boundsHeld && modelBoundsHeld ? "STAGE_FAILED" : "BOUNDS_EXCEEDED";
  } finally {
    clearTimeout(timer);
    overallAbort.abort();
    eventAbort?.abort();
    if (eventTask)
      await raceTimeout(
        eventTask.catch(() => undefined),
        1_000,
        "event reader cleanup deadline exceeded",
      ).catch(() => undefined);
    if (promptTask)
      await raceTimeout(
        promptTask.catch(() => undefined),
        1_000,
        "prompt cleanup deadline exceeded",
      ).catch(() => undefined);
    for (const response of activeMockResponses) response.destroy();
    const mockClosed = await raceTimeout(
      new Promise<boolean>((resolveClose) => {
        mock.close((error) => resolveClose(error === undefined));
      }),
      1_000,
      "mock server cleanup deadline exceeded",
    ).catch(() => {
      mock.closeAllConnections();
      return false;
    });
    const processTreeClean = await stopChild(child).catch(() => false);
    checks.childCleanup = mockClosed && processTreeClean;
    client = undefined;
    password = "";
    checks.requestBounds =
      requestBudget.boundsHeld &&
      modelBoundsHeld &&
      requestBudget.requests <= API_REQUEST_LIMIT &&
      modelRequestCount <= MODEL_REQUEST_LIMIT &&
      sessionCount <= SESSION_LIMIT;
    try {
      await isolation.dispose();
      checks.fixtureStateCleanup = !(await pathExists(isolation.root));
    } catch {
      checks.fixtureStateCleanup = false;
    }
    const checksBeforeTeardown = { ...checks };
    const boundsHeld = checks.requestBounds;
    const status = evaluateEvidence({ checks, failed, cleanupSucceeded: checks.childCleanup, boundsHeld });
    if (status === "FAIL" && !failureCode) {
      failureCode = !boundsHeld ? "BOUNDS_EXCEEDED" : !checks.childCleanup ? "CLEANUP_FAILED" : "ASSERTION_FAILED";
    }
    // Persist only bounded, sanitized assertions and fixed failure classification.
    const evidence: SpikeResult = {
      status,
      expectedVersion: EXPECTED_VERSION,
      clientPackage: "@opencode/client@2.1.0",
      ...(observedVersion ? { observedVersion } : {}),
      sourceCommit: SOURCE_COMMIT,
      sourceCommitMeaning: "inspected-release-tag",
      qualification:
        inputs.lane === "native" ? "BUILTIN_HTTP_MOCK_PROVIDER_API_SPIKE_ONLY" : "CUSTOM_MOCK_PROVIDER_API_SPIKE_ONLY",
      providerFixturePath: join(dirname(fileURLToPath(import.meta.url)), "fixtures/v2-spike-provider.mjs"),
      checks: { ...checksBeforeTeardown, childCleanup: checks.childCleanup, requestBounds: checks.requestBounds },
      counts: {
        apiRequests: requestBudget.requests,
        modelRequests: modelRequestCount,
        sessionOperations: sessionCount,
      },
      fixtureRoot: isolation.root,
      fixturePaths: {
        config: isolation.paths.config,
        data: isolation.paths.data,
        state: isolation.paths.state,
        database: isolation.paths.database,
        tmp: isolation.paths.tmp,
        cwd: isolation.paths.cwd,
      },
      evidencePath: join(evidenceRoot, "result.json"),
      executablePath: inputs.executable,
      executableSha256,
      clientModulePath: inputs.clientModule,
      ...(failed ? { failureStage, failureCode } : failureCode ? { failureStage: "verification", failureCode } : {}),
    };
    finalResult = evidence;
    await writeFile(evidence.evidencePath, JSON.stringify(evidence), { mode: 0o600 });
    await writeFile(
      join(evidenceRoot, "manifest.json"),
      JSON.stringify({
        runID,
        sourceCommit: SOURCE_COMMIT,
        sourceCommitMeaning: "inspected-release-tag",
        qualification: evidence.qualification,
        providerFixturePath: evidence.providerFixturePath,
        expectedVersion: EXPECTED_VERSION,
        clientPackage: evidence.clientPackage,
        failureStage: failed ? failureStage : undefined,
        failureCode,
        requestCounts: {
          apiRequests: requestBudget.requests,
          modelRequests: modelRequestCount,
          sessionOperations: sessionCount,
        },
        checks: evidence.checks,
      }),
      { mode: 0o600 },
    );
  }
  if (!finalResult) throw new Error("V2 contract spike produced no result");
  return finalResult;
}

export function isRuntimeSpikeEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return (
    environment.OPENCODE_CHAT_RUN_V2_SPIKE === "1" &&
    !!environment.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE &&
    isAbsolute(environment.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE) &&
    !!environment.OPENCODE_CHAT_V2_CLIENT_MODULE &&
    isAbsolute(environment.OPENCODE_CHAT_V2_CLIENT_MODULE)
  );
}
