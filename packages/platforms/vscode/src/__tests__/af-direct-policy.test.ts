import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type AfDirectLauncher,
  type AfDirectLaunchOptions,
  createAfDirectPolicyAdapter,
  createDefaultAfDirectLauncher,
} from "../vibefeld/af-direct-policy";
import type { AfPolicyDescriptor, AfPolicyExecutionFact } from "../vibefeld/af-execution-boundary";

const AF_PATH = "/opt/homebrew/bin/af";
const REVIEW_ROOT = "/host/global-storage/vibefeld/reviews/session/review";

const descriptor: AfPolicyDescriptor = {
  executable: AF_PATH,
  argv: [AF_PATH, "version", "--json"],
  cwd: REVIEW_ROOT,
};

const limits = { stdinBytes: 0, stdoutBytes: 32, stderrBytes: 32 };

class RecordingLauncher implements AfDirectLauncher {
  readonly calls: Array<{ descriptor: AfPolicyDescriptor; options: AfDirectLaunchOptions }> = [];
  fact: AfPolicyExecutionFact = { outcome: "exited", exitCode: 0, stdout: "ok", stderr: "" };
  cleanup: "reaped" | "failed" = "reaped";
  throwOnCleanup = false;

  async launch(launchDescriptor: AfPolicyDescriptor, options: AfDirectLaunchOptions): Promise<AfPolicyExecutionFact> {
    this.calls.push({ descriptor: launchDescriptor, options });
    return this.fact;
  }

  async terminateAndReap(): Promise<"reaped" | "failed"> {
    if (this.throwOnCleanup) throw new Error("teardown failed");
    return this.cleanup;
  }
}

class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly stdout = null;
  readonly stderr = null;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

const spawnReturning = (
  children: FakeChild[],
  received: Array<Record<string, unknown>> = [],
): typeof import("node:child_process").spawn =>
  ((_executable: string, _argv: readonly string[], options: Record<string, unknown>) => {
    received.push(options);
    const child = new FakeChild(100 + children.length);
    children.push(child);
    return child as unknown as ChildProcess;
  }) as typeof import("node:child_process").spawn;

const createReady = (launcher = new RecordingLauncher()) => ({
  launcher,
  adapter: createAfDirectPolicyAdapter({
    platform: "linux",
    resolveExecutable: () => AF_PATH,
    launcher,
  }),
});

describe("createAfDirectPolicyAdapter", () => {
  it("reports direct execution readiness and never claims a second confinement layer", () => {
    const { adapter } = createReady();
    expect(adapter.readiness).toEqual({ state: "ready", execution: "direct" });
    expect(Object.keys(adapter.readiness).sort()).toEqual(["execution", "state"]);
  });

  it.each([
    ["an unsupported platform", { platform: "win32" as NodeJS.Platform }],
    ["a missing executable", { resolveExecutable: () => undefined }],
    ["an empty executable", { resolveExecutable: () => "" }],
    ["a relative executable", { resolveExecutable: () => "bin/af" }],
    ["an executable with shell tokens", { resolveExecutable: () => "/opt/af; rm -rf /" }],
    ["an unbounded executable", { resolveExecutable: () => `/${"a".repeat(4_100)}` }],
  ])("reports unavailable for %s", (_name, changes) => {
    const adapter = createAfDirectPolicyAdapter({
      platform: "linux",
      resolveExecutable: () => AF_PATH,
      ...changes,
    });
    expect(adapter.readiness).toEqual({ state: "unavailable" });
  });

  it("reports unavailable when the host resolver throws", () => {
    const adapter = createAfDirectPolicyAdapter({
      platform: "darwin",
      resolveExecutable: () => {
        throw new Error("raw resolver detail");
      },
    });
    expect(adapter.readiness).toEqual({ state: "unavailable" });
  });

  it("launches the descriptor executable with its fixed argv and an allowlisted environment", async () => {
    const { adapter, launcher } = createReady();
    await adapter.launch(descriptor, undefined, limits);

    expect(launcher.calls).toHaveLength(1);
    expect(launcher.calls[0].descriptor).toEqual({
      executable: AF_PATH,
      argv: [AF_PATH, "version", "--json"],
      cwd: REVIEW_ROOT,
    });
    expect(launcher.calls[0].options.limits).toEqual(limits);
    expect(launcher.calls[0].options.env).toEqual(expect.objectContaining({ PATH: process.env.PATH }));
    expect(
      Object.keys(launcher.calls[0].options.env).every((key) => ["PATH", "HOME", "XDG_CONFIG_HOME"].includes(key)),
    ).toBe(true);
  });

  it("has no alternate execution variant: preflight goes through the same direct launch", async () => {
    const { adapter, launcher } = createReady();
    await adapter.launchPreflight?.(descriptor, undefined, limits);
    expect(launcher.calls).toHaveLength(1);
    expect(launcher.calls[0].descriptor.executable).toBe(AF_PATH);
  });

  it("refuses to launch when readiness is not direct and reports a bounded cancellation", async () => {
    const launcher = new RecordingLauncher();
    const adapter = createAfDirectPolicyAdapter({
      platform: "win32",
      resolveExecutable: () => AF_PATH,
      launcher,
    });
    await expect(adapter.launch(descriptor)).resolves.toEqual({ outcome: "cancelled" });
    expect(launcher.calls).toHaveLength(0);
  });

  it("bounds oversized returned output while preserving the fact", async () => {
    const launcher = new RecordingLauncher();
    launcher.fact = { outcome: "exited", exitCode: 1, stdout: "x".repeat(100), stderr: "y".repeat(100) };
    const { adapter } = createReady(launcher);
    const fact = await adapter.launch(descriptor, undefined, { stdinBytes: 0, stdoutBytes: 8, stderrBytes: 7 });
    expect(fact.outcome).toBe("exited");
    expect(new TextEncoder().encode(fact.stdout ?? "").byteLength).toBeLessThanOrEqual(9);
    expect(new TextEncoder().encode(fact.stderr ?? "").byteLength).toBeLessThanOrEqual(8);
  });

  it.each(["reaped", "failed"] as const)("maps cleanup %s without throwing", async (outcome) => {
    const launcher = new RecordingLauncher();
    launcher.cleanup = outcome;
    const { adapter } = createReady(launcher);
    await expect(adapter.terminateAndReap()).resolves.toEqual({ outcome });
  });

  it("maps a throwing teardown to a bounded failure", async () => {
    const launcher = new RecordingLauncher();
    launcher.throwOnCleanup = true;
    const { adapter } = createReady(launcher);
    await expect(adapter.terminateAndReap()).resolves.toEqual({ outcome: "failed" });
    expect(adapter.readiness).toEqual({ state: "ready", execution: "direct" });
  });

  it("does not reuse the Chat sandbox, invoke another confinement tool, or write configuration", () => {
    const source = readFileSync(path.resolve(__dirname, "../vibefeld/af-direct-policy.ts"), "utf8");
    for (const forbidden of [
      "SandboxManager",
      "chat-sandbox",
      "wrapWithSandbox",
      "writeFile",
      "configuration.update",
      "shell: true",
      "...process.env",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("shell: false");
    expect(source).toContain("detached: true");
    expect(source).toContain('const ENVIRONMENT_KEYS = ["PATH", "HOME", "XDG_CONFIG_HOME"]');
  });
});

describe("createDefaultAfDirectLauncher", () => {
  it("spawns directly, detached, with bounded stdio and only the allowlisted environment", async () => {
    const children: FakeChild[] = [];
    const received: Array<Record<string, unknown>> = [];
    const launcher = createDefaultAfDirectLauncher({ spawn: spawnReturning(children, received) });
    const launch = launcher.launch(descriptor, {
      limits,
      env: { PATH: "/bin", HOME: "/home/tester", XDG_CONFIG_HOME: "/config", SECRET: "not-inherited" },
    });
    children[0].exitCode = 0;
    children[0].emit("exit", 0, null);
    await launch;

    expect(received[0]).toMatchObject({
      cwd: REVIEW_ROOT,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/bin", HOME: "/home/tester", XDG_CONFIG_HOME: "/config" },
    });
    const receivedEnvironment = received[0]?.env as NodeJS.ProcessEnv | undefined;
    expect(receivedEnvironment).toBeDefined();
    expect(receivedEnvironment?.SECRET).toBeUndefined();
  });

  it("spawns only the fixed argv tail and never a shell string", async () => {
    const children: FakeChild[] = [];
    const calls: Array<{ executable: string; argv: readonly string[] }> = [];
    const spawnFake = ((executable: string, argv: readonly string[], options: Record<string, unknown>) => {
      calls.push({ executable, argv: [...argv] });
      const child = new FakeChild(150 + children.length);
      children.push(child);
      return child as unknown as ChildProcess;
    }) as typeof import("node:child_process").spawn;
    const launcher = createDefaultAfDirectLauncher({ spawn: spawnFake });
    const launch = launcher.launch(
      { ...descriptor, argv: [AF_PATH, "status", "--dir", REVIEW_ROOT, "--format", "json"] },
      {
        limits,
        env: { PATH: "/bin" },
      },
    );
    children[0].exitCode = 0;
    children[0].emit("exit", 0, null);
    await launch;

    expect(calls[0]).toEqual({
      executable: AF_PATH,
      argv: ["status", "--dir", REVIEW_ROOT, "--format", "json"],
    });
  });

  it("bounds oversized stdout and stderr at the caller limits", async () => {
    class StreamingChild extends EventEmitter {
      readonly pid = 160;
      readonly stdout = new EventEmitter();
      readonly stderr = new EventEmitter();
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
    }
    const child = new StreamingChild();
    const spawnFake = (() => child as unknown as ChildProcess) as typeof import("node:child_process").spawn;
    const launcher = createDefaultAfDirectLauncher({ spawn: spawnFake });
    const launch = launcher.launch(descriptor, { limits: { stdinBytes: 0, stdoutBytes: 4, stderrBytes: 4 }, env: {} });
    child.stdout.emit("data", Buffer.from("x".repeat(100)));
    child.stderr.emit("data", Buffer.from("y".repeat(100)));
    child.stdout.emit("end");
    child.stderr.emit("end");
    child.exitCode = 0;
    child.emit("exit", 0, null);
    const fact = await launch;
    expect(new TextEncoder().encode(fact.stdout ?? "").byteLength).toBeLessThanOrEqual(5);
    expect(new TextEncoder().encode(fact.stderr ?? "").byteLength).toBeLessThanOrEqual(5);
  });

  it("reaps immediately when no child is active", async () => {
    const launcher = createDefaultAfDirectLauncher({
      spawn: vi.fn() as typeof import("node:child_process").spawn,
    });
    await expect(launcher.terminateAndReap()).resolves.toBe("reaped");
  });

  it("terminates the active process group and can repeat across successive launches", async () => {
    const children: FakeChild[] = [];
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const launcher = createDefaultAfDirectLauncher({
      spawn: spawnReturning(children),
      kill: (pid, signal) => {
        signals.push({ pid, signal });
        children.at(-1)?.emit("exit", null, signal);
      },
    });
    const firstLaunch = launcher.launch(descriptor, { limits, env: {} });
    await launcher.terminateAndReap();
    await firstLaunch;
    const secondLaunch = launcher.launch(descriptor, { limits, env: {} });
    await launcher.terminateAndReap();
    await secondLaunch;
    expect(signals).toEqual([
      { pid: -100, signal: "SIGTERM" },
      { pid: -101, signal: "SIGTERM" },
    ]);
  });

  it("escalates to the process group kill after the bounded delay and reaps on exit", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild(300);
      const signals: NodeJS.Signals[] = [];
      const launcher = createDefaultAfDirectLauncher({
        spawn: (() => child as unknown as ChildProcess) as typeof import("node:child_process").spawn,
        kill: (_pid, signal) => signals.push(signal),
      });
      const launch = launcher.launch(descriptor, { limits, env: {} });
      const cleanup = launcher.terminateAndReap();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      child.exitCode = 0;
      child.emit("exit", 0, null);
      await expect(cleanup).resolves.toBe("reaped");
      await launch;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports failed when escalation does not reap the child and clears the stale reference", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild(301);
      const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const launcher = createDefaultAfDirectLauncher({
        spawn: (() => child as unknown as ChildProcess) as typeof import("node:child_process").spawn,
        kill: (pid, signal) => signals.push({ pid, signal }),
      });
      const launch = launcher.launch(descriptor, { limits, env: {} });
      const reap = launcher.terminateAndReap();
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(reap).resolves.toBe("failed");
      expect(signals).toEqual([
        { pid: -301, signal: "SIGTERM" },
        { pid: -301, signal: "SIGKILL" },
      ]);

      // The failed cleanup still clears the reference: a later cleanup is a
      // bounded no-op instead of signalling the stale child again.
      signals.length = 0;
      await expect(launcher.terminateAndReap()).resolves.toBe("reaped");
      expect(signals).toEqual([]);

      child.exitCode = 0;
      child.emit("exit", 0, null);
      await launch;
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the process group when the caller aborts", async () => {
    const children: FakeChild[] = [];
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const launcher = createDefaultAfDirectLauncher({
      spawn: spawnReturning(children),
      kill: (pid, signal) => {
        signals.push({ pid, signal });
        children.at(-1)?.emit("exit", null, signal);
      },
    });
    const controller = new AbortController();
    const launch = launcher.launch(descriptor, { limits, env: {}, signal: controller.signal });
    controller.abort();
    await expect(launch).resolves.toMatchObject({ outcome: "signaled" });
    expect(signals).toEqual([{ pid: -100, signal: "SIGTERM" }]);
  });

  it("keeps the direct-execution path free of another confinement tool, profile flags, and grants", () => {
    const source = readFileSync(path.resolve(__dirname, "../vibefeld/af-direct-policy.ts"), "utf8");
    expect(source).not.toMatch(/nono/iu);
    expect(source).not.toMatch(/--profile|\bprofile\b/iu);
    expect(source).not.toMatch(/grant|--read\b|--allow\b|denied[-_ ]?domain/iu);
    expect(source).not.toMatch(/nested/iu);
    expect(source).not.toMatch(/spawnSync|execFile|fork\s*\(/u);
    expect(source).toContain("descriptor.argv.slice(1)");
  });
});
