import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import type {
  AfExecutionPolicyAdapter,
  AfPolicyCleanupFact,
  AfPolicyDescriptor,
  AfPolicyExecutionFact,
  AfPolicyIoLimits,
  AfPreflightDescriptor,
} from "./af-execution-boundary";

const MAX_HOST_PATH_LENGTH = 4_096;
const SHELL_TOKEN = /[;&|`$\n\r]|\$\(|\b(?:sh|bash|zsh|fish|powershell|cmd)\s+-c\b/i;
const ENVIRONMENT_KEYS = ["PATH", "HOME", "XDG_CONFIG_HOME"] as const;
const ESCALATION_DELAY_MS = 2_000;
const KILL_GRACE_MS = 100;

export type AfDirectSpawn = typeof spawn;
export type AfDirectKill = (pid: number, signal: NodeJS.Signals) => void;

export type AfDirectLaunchOptions = Readonly<{
  signal?: AbortSignal;
  limits: AfPolicyIoLimits;
  env: NodeJS.ProcessEnv;
}>;

export interface AfDirectLauncher {
  launch(
    descriptor: AfPolicyDescriptor | AfPreflightDescriptor,
    options: AfDirectLaunchOptions,
  ): Promise<AfPolicyExecutionFact>;
  terminateAndReap(): Promise<AfPolicyCleanupFact["outcome"]>;
}

const isSupportedPlatform = (platform: NodeJS.Platform): boolean => platform === "darwin" || platform === "linux";

const isHostExecutable = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_HOST_PATH_LENGTH &&
  path.isAbsolute(value) &&
  !value.includes("\0") &&
  !SHELL_TOKEN.test(value);

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

const boundOutput = (value: string | undefined, limit: number): string | undefined => {
  if (value === undefined || utf8Bytes(value) <= limit + 1) return value;
  return new TextDecoder().decode(new TextEncoder().encode(value).slice(0, limit + 1));
};

const boundFact = (fact: AfPolicyExecutionFact, limits: AfPolicyIoLimits): AfPolicyExecutionFact => ({
  ...fact,
  ...(fact.stdout === undefined ? {} : { stdout: boundOutput(fact.stdout, limits.stdoutBytes) }),
  ...(fact.stderr === undefined ? {} : { stderr: boundOutput(fact.stderr, limits.stderrBytes) }),
});

/** The host environment source; the launcher keeps only the allowlist below. */
export const hostEnvironment = (): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
};

const allowlistedEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const filtered: NodeJS.ProcessEnv = {};
  for (const key of ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) filtered[key] = value;
  }
  return filtered;
};

const collect = (stream: NodeJS.ReadableStream | null, limit: number): Promise<string> =>
  new Promise((resolve) => {
    if (!stream) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size <= limit) {
        const remaining = limit + 1 - size;
        const bounded = bytes.subarray(0, remaining);
        chunks.push(bounded);
        size += bounded.byteLength;
      }
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

export type AfDirectLauncherSeams = Readonly<{
  spawn?: AfDirectSpawn;
  kill?: AfDirectKill;
}>;

/**
 * Runs the fixed AF command directly as a detached child process group with
 * bounded stdio and an allowlisted environment. `terminateAndReap` escalates
 * from `SIGTERM` to `SIGKILL`, clears the active child reference, and can be
 * reused across successive launches.
 */
export const createDefaultAfDirectLauncher = (seams: AfDirectLauncherSeams = {}): AfDirectLauncher => {
  const spawnProcess = seams.spawn ?? spawn;
  const killProcess = seams.kill ?? ((pid, signal) => process.kill(pid, signal));
  let child: ChildProcess | undefined;
  let cleanupPromise: Promise<AfPolicyCleanupFact["outcome"]> | undefined;

  const terminateAndReap = (): Promise<AfPolicyCleanupFact["outcome"]> => {
    if (cleanupPromise) return cleanupPromise;
    const active = child;
    if (!active || active.exitCode !== null || active.signalCode !== null) {
      child = undefined;
      return Promise.resolve("reaped");
    }
    const promise = new Promise<AfPolicyCleanupFact["outcome"]>((resolve) => {
      const pid = active.pid;
      let escalationTimer: ReturnType<typeof setTimeout> | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (outcome: AfPolicyCleanupFact["outcome"]) => {
        active.removeListener("exit", onExit);
        if (escalationTimer) clearTimeout(escalationTimer);
        if (graceTimer) clearTimeout(graceTimer);
        if (child === active) child = undefined;
        resolve(outcome);
      };
      const onExit = () => finish("reaped");
      const escalate = () => {
        if (pid === undefined) {
          finish("failed");
          return;
        }
        try {
          killProcess(-pid, "SIGKILL");
        } catch {
          finish("failed");
          return;
        }
        graceTimer = setTimeout(() => finish("failed"), KILL_GRACE_MS);
      };
      escalationTimer = setTimeout(escalate, ESCALATION_DELAY_MS);
      active.once("exit", onExit);
      try {
        if (pid === undefined) {
          finish("failed");
          return;
        }
        killProcess(-pid, "SIGTERM");
      } catch {
        finish("failed");
      }
    });
    cleanupPromise = promise;
    void promise.then(() => {
      if (cleanupPromise === promise) cleanupPromise = undefined;
    });
    return promise;
  };

  return {
    async launch(descriptor, options) {
      const spawned = spawnProcess(descriptor.executable, [...descriptor.argv.slice(1)], {
        cwd: descriptor.cwd,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: allowlistedEnvironment(options.env),
      });
      child = spawned;
      const stdout = collect(spawned.stdout, options.limits.stdoutBytes);
      const stderr = collect(spawned.stderr, options.limits.stderrBytes);
      const abort = () => {
        void terminateAndReap();
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      const result = await new Promise<AfPolicyExecutionFact>((resolve) => {
        spawned.once("error", () => resolve({ outcome: "signaled", signal: "SIGTERM" }));
        spawned.once("exit", (code, signal) => {
          void Promise.all([stdout, stderr]).then(([out, err]) =>
            resolve({
              outcome: signal ? "signaled" : "exited",
              ...(code === null ? {} : { exitCode: code }),
              ...(signal ? { signal } : {}),
              stdout: out,
              stderr: err,
            }),
          );
        });
      });
      options.signal?.removeEventListener("abort", abort);
      return boundFact(result, options.limits);
    },
    terminateAndReap,
  };
};

export type CreateAfDirectPolicyOptions = Readonly<{
  platform: NodeJS.Platform;
  /** Host-resolved AF executable; never supplied by a model, prompt, or webview. */
  resolveExecutable: () => string | undefined;
  launcher?: AfDirectLauncher;
  /** Host environment source; the launcher keeps only the allowlist. */
  environment?: () => NodeJS.ProcessEnv;
  spawn?: AfDirectSpawn;
  kill?: AfDirectKill;
}>;

const readinessFor = (options: CreateAfDirectPolicyOptions): AfExecutionPolicyAdapter["readiness"] => {
  if (!isSupportedPlatform(options.platform)) return { state: "unavailable" };
  let executable: unknown;
  try {
    executable = options.resolveExecutable();
  } catch {
    return { state: "unavailable" };
  }
  if (!isHostExecutable(executable)) return { state: "unavailable" };
  return { state: "ready", execution: "direct" };
};

/** Direct execution is the only path: no alternate execution or retry variant exists. */
export const createAfDirectPolicyAdapter = (options: CreateAfDirectPolicyOptions): AfExecutionPolicyAdapter => {
  const launcher =
    options.launcher ??
    createDefaultAfDirectLauncher({
      ...(options.spawn ? { spawn: options.spawn } : {}),
      ...(options.kill ? { kill: options.kill } : {}),
    });
  const environment = options.environment ?? hostEnvironment;
  const readiness = readinessFor(options);
  const unavailable = async (): Promise<AfPolicyExecutionFact> => ({ outcome: "cancelled" });
  const launch = async (
    descriptor: AfPolicyDescriptor | AfPreflightDescriptor,
    signal?: AbortSignal,
    limits: AfPolicyIoLimits = { stdinBytes: 0, stdoutBytes: 0, stderrBytes: 0 },
  ): Promise<AfPolicyExecutionFact> => {
    if (readiness.state !== "ready") return unavailable();
    const fact = await launcher.launch(descriptor, { signal, limits, env: environment() });
    return boundFact(fact, limits);
  };
  return {
    platform: options.platform,
    readiness,
    launch,
    launchPreflight: launch,
    terminateAndReap: async () => {
      try {
        return { outcome: await launcher.terminateAndReap() };
      } catch {
        return { outcome: "failed" };
      }
    },
  };
};
