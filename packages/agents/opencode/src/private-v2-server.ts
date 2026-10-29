import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { EventEmitter } from "node:events";

const STARTUP_TIMEOUT_MS = 10_000;
const MAX_STARTUP_OUTPUT_BYTES = 16 * 1024;
const MAX_READINESS_BODY_BYTES = 32 * 1024;
const MINIMUM_STABLE_V2_VERSION = "2.1.3";

type ChildLike = Pick<ChildProcess, "pid" | "stdout" | "stderr" | "exitCode" | "signalCode" | "once" | "kill"> &
  EventEmitter;

export type PrivateV2ServerOptions = {
  command: string;
  args: readonly string[];
  shell: boolean;
  cwd: string;
  environment: NodeJS.ProcessEnv;
  /** Exact by default; production launches opt into the reviewed stable V2 range. */
  versionPolicy?: "stable-v2-forward";
  /** The exact version by default, or the minimum version when forward policy is enabled. */
  expectedVersion: string;
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildLike;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** Test seam for observing owned-child/group termination. */
  terminateProcessGroup?: (pid: number, child: ChildLike) => Promise<void>;
  onChildLifecycle?: (event: { kind: "exit" | "error"; code?: number | null; signal?: NodeJS.Signals | null }) => void;
};

export type PrivateV2Server = {
  readonly url: string;
  /** Non-enumerable, in-memory transport headers; cleared by close(). */
  readonly headers: { authorization: string };
  close(): Promise<void>;
};

export type PrivateV2ServerErrorCode =
  | "spawn-error"
  | "early-exit"
  | "output-limit"
  | "readiness-timeout"
  | "malformed-output"
  | "non-loopback-endpoint"
  | "authentication-failed"
  | "identity-mismatch"
  | "version-mismatch"
  | "location-mismatch"
  | "redirect-rejected"
  | "readiness-failed"
  | "cleanup-failed";

/** Only a validated exact version is interpolated; observed versions and child output never are. */
function versionMismatchHint(
  code: PrivateV2ServerErrorCode,
  requiredVersion: string | undefined,
  versionPolicy?: "stable-v2-forward",
): string {
  if (code === "version-mismatch" && versionPolicy === "stable-v2-forward") {
    return " Scribe requires stable OpenCode V2 >=2.1.3 and <3.0.0; update OpenCode or Scribe.";
  }
  if (code !== "version-mismatch" || !requiredVersion || !/^\d+\.\d+\.\d+$/.test(requiredVersion)) return "";
  return ` Scribe requires OpenCode ${requiredVersion}; install that version or update Scribe.`;
}

export class PrivateV2ServerError extends Error {
  constructor(
    readonly code: PrivateV2ServerErrorCode,
    requiredVersion?: string,
    versionPolicy?: "stable-v2-forward",
  ) {
    super(
      `Private OpenCode V2 startup failed (${code}); child output and credentials were discarded.${versionMismatchHint(code, requiredVersion, versionPolicy)}`,
    );
    this.name = "PrivateV2ServerError";
  }
}

function basicHeader(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`;
}

type NumericVersion = { major: number; minor: number; patch: number };

function parseCanonicalStableVersion(version: string): NumericVersion | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major, minor, patch };
}

function compareVersions(left: NumericVersion, right: NumericVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function isEligibleStableV2Version(version: string, minimumVersion: string): boolean {
  const parsed = parseCanonicalStableVersion(version);
  const minimum = parseCanonicalStableVersion(minimumVersion);
  const policyFloor = parseCanonicalStableVersion(MINIMUM_STABLE_V2_VERSION);
  return Boolean(
    parsed &&
      minimum &&
      policyFloor &&
      parsed.major === 2 &&
      minimum.major === 2 &&
      compareVersions(minimum, policyFloor) >= 0 &&
      compareVersions(parsed, minimum) >= 0,
  );
}

function defaultSpawn(command: string, args: string[], options: SpawnOptions): ChildLike {
  return nodeSpawn(command, args, options) as ChildLike;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChildClose(child: ChildLike, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("close", onClose);
      reject(new PrivateV2ServerError("cleanup-failed"));
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("close", onClose);
  });
}

async function terminateOwnedProcess(pid: number, child: ChildLike, windows: boolean): Promise<void> {
  if (windows) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    try {
      await waitForChildClose(child, 1_000);
    } catch {
      child.kill("SIGKILL");
      await waitForChildClose(child, 1_000);
    }
    return;
  }

  const groupExists = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const waitGroupGone = async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (groupExists() && Date.now() < deadline) await sleep(20);
    return !groupExists();
  };
  if (groupExists()) signal("SIGTERM");
  if (!(await waitGroupGone(1_000))) {
    signal("SIGKILL");
    if (!(await waitGroupGone(1_000))) throw new PrivateV2ServerError("cleanup-failed");
  }
  await waitForChildClose(child, 1_000);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_READINESS_BODY_BYTES) {
    await response.body?.cancel();
    throw new PrivateV2ServerError("readiness-failed");
  }
  if (!response.body) throw new PrivateV2ServerError("readiness-failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abortRead = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new PrivateV2ServerError("readiness-timeout");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_READINESS_BODY_BYTES) {
        await reader.cancel();
        throw new PrivateV2ServerError("readiness-failed");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  try {
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new PrivateV2ServerError("readiness-failed");
  }
}

function serverInfoEndpoint(line: string): { url?: string; error?: PrivateV2ServerErrorCode } | undefined {
  const prefix = "server listening on ";
  if (!line.startsWith(prefix)) return undefined;
  const rawUrl = line.slice(prefix.length);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "malformed-output" };
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
    return { error: "non-loopback-endpoint" };
  }
  if (
    url.port === "" ||
    Number(url.port) < 1 ||
    Number(url.port) > 65_535 ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    rawUrl !== url.origin
  ) {
    return { error: "malformed-output" };
  }
  return { url: url.origin };
}

/** Starts and authenticates one already-selected/wrapped foreground serve command. */
export async function startPrivateV2Server(options: PrivateV2ServerOptions): Promise<PrivateV2Server> {
  if (
    options.versionPolicy === "stable-v2-forward" &&
    !isEligibleStableV2Version(options.expectedVersion, MINIMUM_STABLE_V2_VERSION)
  ) {
    throw new PrivateV2ServerError("version-mismatch", undefined, options.versionPolicy);
  }
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? STARTUP_TIMEOUT_MS;
  let child: ChildLike;
  try {
    child = (options.spawnProcess ?? defaultSpawn)(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.environment,
      shell: options.shell,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new PrivateV2ServerError("spawn-error");
  }

  let stdoutBytes = 0;
  let stderrBytes = 0;
  let password: string | undefined;
  let endpoint: string | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let lifecycleListenersInstalled = false;
  const headers: { authorization: string } = { authorization: "" };
  const removeLifecycleListeners = () => {
    if (!lifecycleListenersInstalled) return;
    child.removeListener("exit", onPostReadyExit);
    child.removeListener("error", onPostReadyError);
    lifecycleListenersInstalled = false;
  };
  const close = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    controller.abort();
    password = undefined;
    headers.authorization = "";
    cleanupPromise = (async () => {
      try {
        if (child.pid && child.pid > 1 && child.pid !== process.pid) {
          await (
            options.terminateProcessGroup ??
            ((pid, ownedChild) => terminateOwnedProcess(pid, ownedChild, process.platform === "win32"))
          )(child.pid, child);
        } else if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
          try {
            await waitForChildClose(child, 1_000);
          } catch {
            child.kill("SIGKILL");
            await waitForChildClose(child, 1_000);
          }
        }
      } catch {
        throw new PrivateV2ServerError("cleanup-failed");
      }
      removeLifecycleListeners();
      child.stdout?.removeListener("data", drainOutput);
      child.stderr?.removeListener("data", drainOutput);
    })();
    return cleanupPromise;
  };
  const onPostReadyExit = (code: number | null, signal: NodeJS.Signals | null) => {
    try {
      options.onChildLifecycle?.({ kind: "exit", code, signal });
    } catch {
      // Parent notification is best-effort and never includes child output.
    }
  };
  const onPostReadyError = () => {
    try {
      options.onChildLifecycle?.({ kind: "error" });
    } catch {
      // Parent notification is best-effort and never includes child output.
    }
  };
  const drainOutput = () => undefined;

  try {
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    const ready = await new Promise<{ url: string; authorization: string }>((resolve, reject) => {
      let settled = false;
      let validationStarted = false;
      let stdoutCarry = "";
      const finish = (error?: PrivateV2ServerError, value?: { url: string; authorization: string }) => {
        if (settled) return;
        settled = true;
        if (readinessTimer) clearTimeout(readinessTimer);
        controller.signal.removeEventListener("abort", onAbort);
        stdoutCarry = "";
        child.stdout?.removeListener("data", onStdout);
        child.stderr?.removeListener("data", onStderr);
        child.removeListener("error", onSpawnError);
        child.removeListener("exit", onEarlyExit);
        if (error) reject(error);
        else if (value) resolve(value);
      };
      const onAbort = () => finish(new PrivateV2ServerError("readiness-timeout"));
      const validate = async (baseUrl: string, secret: string) => {
        const authHeaders = { authorization: basicHeader(secret) };
        const fetcher = options.fetcher ?? fetch;
        const request = async (url: URL): Promise<Response> => {
          try {
            return await fetcher(url, { headers: authHeaders, redirect: "manual", signal: controller.signal });
          } catch {
            throw controller.signal.aborted
              ? new PrivateV2ServerError("readiness-timeout")
              : new PrivateV2ServerError("readiness-failed");
          }
        };
        const infoResponse = await request(new URL("/api/info", baseUrl));
        if (infoResponse.status >= 300 && infoResponse.status < 400)
          throw new PrivateV2ServerError("redirect-rejected");
        if (infoResponse.status === 401 || infoResponse.status === 403)
          throw new PrivateV2ServerError("authentication-failed");
        if (!infoResponse.ok) throw new PrivateV2ServerError("readiness-failed");
        const info = await readBoundedJson(infoResponse, controller.signal);
        if (
          !isPlainRecord(info) ||
          typeof info.version !== "string" ||
          typeof info.pid !== "number" ||
          !Array.isArray(info.urls)
        )
          throw new PrivateV2ServerError("readiness-failed");
        if (
          info.pid !== child.pid ||
          !info.urls.every((value) => typeof value === "string") ||
          !info.urls.includes(baseUrl)
        ) {
          throw new PrivateV2ServerError("identity-mismatch");
        }
        const versionIsEligible =
          options.versionPolicy === "stable-v2-forward"
            ? isEligibleStableV2Version(info.version, options.expectedVersion)
            : info.version === options.expectedVersion;
        if (!versionIsEligible)
          throw new PrivateV2ServerError("version-mismatch", options.expectedVersion, options.versionPolicy);
        const locationResponse = await request(new URL("/api/location", baseUrl));
        if (locationResponse.status >= 300 && locationResponse.status < 400)
          throw new PrivateV2ServerError("redirect-rejected");
        if (locationResponse.status === 401 || locationResponse.status === 403)
          throw new PrivateV2ServerError("authentication-failed");
        if (!locationResponse.ok) throw new PrivateV2ServerError("readiness-failed");
        const location = await readBoundedJson(locationResponse, controller.signal);
        if (!isPlainRecord(location) || typeof location.directory !== "string" || location.directory !== options.cwd)
          throw new PrivateV2ServerError("location-mismatch");
        return { url: baseUrl, authorization: authHeaders.authorization };
      };
      const beginValidation = () => {
        if (settled || validationStarted || !password || !endpoint) return;
        validationStarted = true;
        void validate(endpoint, password).then(
          (value) => finish(undefined, value),
          (error: unknown) =>
            finish(error instanceof PrivateV2ServerError ? error : new PrivateV2ServerError("readiness-failed")),
        );
      };
      const onLine = (line: string) => {
        if (line.startsWith("server listening on ")) {
          const result = serverInfoEndpoint(line);
          if (result?.error) {
            finish(new PrivateV2ServerError(result.error));
            return;
          }
          if (result?.url) endpoint = result.url;
        }
        const match = /^server password ([A-Za-z0-9_-]+)$/.exec(line);
        if (match) password = match[1];
        beginValidation();
      };
      const onStdout = (chunk: Buffer | string) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        stdoutBytes += Buffer.byteLength(text);
        if (stdoutBytes > MAX_STARTUP_OUTPUT_BYTES) {
          finish(new PrivateV2ServerError("output-limit"));
          return;
        }
        stdoutCarry += text;
        const lines = stdoutCarry.split(/\r?\n/u);
        stdoutCarry = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      };
      const onStderr = (chunk: Buffer | string) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > MAX_STARTUP_OUTPUT_BYTES) finish(new PrivateV2ServerError("output-limit"));
      };
      const onSpawnError = () => finish(new PrivateV2ServerError("spawn-error"));
      const onEarlyExit = () => finish(new PrivateV2ServerError("early-exit"));
      child.stdout?.on("data", onStdout);
      child.stderr?.on("data", onStderr);
      child.once("error", onSpawnError);
      child.once("exit", onEarlyExit);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      readinessTimer = setTimeout(() => {
        controller.abort();
        finish(new PrivateV2ServerError("readiness-timeout"));
      }, timeoutMs);
    });
    password = undefined;
    headers.authorization = ready.authorization;
    child.stdout?.on("data", drainOutput);
    child.stderr?.on("data", drainOutput);
    child.once("exit", onPostReadyExit);
    child.once("error", onPostReadyError);
    lifecycleListenersInstalled = true;
    const server = { url: ready.url, headers, close } as PrivateV2Server;
    Object.defineProperty(server, "headers", { enumerable: false, configurable: false, value: headers });
    return server;
  } catch (error) {
    controller.abort();
    password = undefined;
    headers.authorization = "";
    try {
      await close();
    } catch {
      throw new PrivateV2ServerError("cleanup-failed");
    }
    throw error instanceof PrivateV2ServerError ? error : new PrivateV2ServerError("readiness-failed");
  }
}
