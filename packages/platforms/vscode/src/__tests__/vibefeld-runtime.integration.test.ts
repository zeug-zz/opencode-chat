import { type ChildProcess, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type AfDirectKill,
  type AfDirectLauncher,
  createAfDirectPolicyAdapter,
  createDefaultAfDirectLauncher,
} from "../vibefeld/af-direct-policy";
import type { AfPolicyExecutionFact } from "../vibefeld/af-execution-boundary";
import { createProofWorkspaceStore } from "../vibefeld/proof-workspace-store";
import { createVibefeldRuntimeBridge } from "../vibefeld/vibefeld-runtime";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const RUN_FLAG = "OPENCODE_CHAT_RUN_VIBEFELD_INTEGRATION";
const EXECUTABLE_FLAG = "OPENCODE_CHAT_VIBEFELD_AF_EXECUTABLE";
const MAX_OUTPUT_BYTES = 2_048;
/** The execution boundary admits argv entries up to the fixture argument bound. */
const MAX_ARGUMENT_LENGTH = 256;
const REFINE_STATEMENT = "A bounded captured refinement step.";

type Gate =
  | { readonly enabled: false; readonly reason: "flag" | "executable" }
  | { readonly enabled: true; readonly executable: string };

const readGate = (env: NodeJS.ProcessEnv): Gate => {
  if (env[RUN_FLAG] !== "1") return { enabled: false, reason: "flag" };
  if (!env[EXECUTABLE_FLAG]) return { enabled: false, reason: "executable" };
  return { enabled: true, executable: env[EXECUTABLE_FLAG] };
};

const prepareIntegration = (
  env: NodeJS.ProcessEnv,
  seams: Readonly<{ resolveExecutable: (selected: string) => unknown; spawn: () => unknown }>,
): { readonly skipped: true; readonly reason: Gate["reason"] } | { readonly skipped: false } => {
  const gate = readGate(env);
  if (!gate.enabled) return { skipped: true, reason: gate.reason };
  seams.resolveExecutable(gate.executable);
  seams.spawn();
  return { skipped: false };
};

const projectPath = (value: string): string | undefined => {
  if (path.isAbsolute(value)) return undefined;
  const resolved = path.resolve(REPO_ROOT, value);
  const relative = path.relative(REPO_ROOT, resolved);
  return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) ? undefined : resolved;
};

const bounded = (value: Buffer): string => value.toString("utf8").slice(0, MAX_OUTPUT_BYTES);

const waitForChild = (child: ChildProcess): Promise<AfPolicyExecutionFact> =>
  new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]).subarray(0, MAX_OUTPUT_BYTES + 1);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]).subarray(0, MAX_OUTPUT_BYTES + 1);
    });
    child.once("error", () =>
      resolve({ outcome: "exited", exitCode: 127, stdout: bounded(stdout), stderr: bounded(stderr) }),
    );
    child.once("exit", (exitCode, signal) =>
      resolve({
        outcome: signal ? "signaled" : "exited",
        ...(signal ? { signal: signal as AfPolicyExecutionFact["signal"] } : { exitCode: exitCode ?? 1 }),
        stdout: bounded(stdout),
        stderr: bounded(stderr),
      }),
    );
  });

type ObservedLaunch = Readonly<{
  executable: string;
  argv: readonly string[];
  options: Record<string, unknown>;
  child: ChildProcess;
  settled: Promise<AfPolicyExecutionFact>;
}>;

/**
 * The production direct-execution launcher, with recording seams in front of
 * the real spawn and process-group kill so the live path's fixed argv, detached
 * stdio, allowlisted environment, and terminate-and-reap are observable.
 * Direct execution is the only path; there is no fallback launcher.
 */
const createRecordingDirectLauncher = (): {
  launcher: AfDirectLauncher;
  launches: ObservedLaunch[];
  signals: Array<{ pid: number; signal: NodeJS.Signals }>;
} => {
  const launches: ObservedLaunch[] = [];
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const spawnSeam = ((executable: string, argv: readonly string[], options: Record<string, unknown>) => {
    const child = spawn(executable, argv, options);
    launches.push({
      executable,
      argv: [...argv],
      options,
      child,
      settled: waitForChild(child),
    });
    return child;
  }) as typeof spawn;
  const killSeam: AfDirectKill = (pid, signal) => {
    signals.push({ pid, signal });
    process.kill(pid, signal);
  };
  return { launches, signals, launcher: createDefaultAfDirectLauncher({ spawn: spawnSeam, kill: killSeam }) };
};

const loadLiveExecutable = async (gate: Extract<Gate, { enabled: true }>) => {
  const executable = projectPath(gate.executable);
  if (!executable) return undefined;
  try {
    await access(executable);
    return executable;
  } catch {
    return undefined;
  }
};

const waitForLaunch = async (launches: readonly unknown[], minimum: number): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (launches.length < minimum && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(launches.length).toBeGreaterThanOrEqual(minimum);
};

const launchArgument = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

/**
 * The direct-execution envelope on every launcher-observed launch, including
 * the claim sequence: no shell, a detached process group, bounded piped stdio,
 * the host allowlisted environment, and argv entries within the argument bound.
 */
const expectContractedLaunch = ({ options, argv }: ObservedLaunch): void => {
  expect(options.shell).toBe(false);
  expect(options.detached).toBe(true);
  expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  expect(
    Object.keys(options.env as NodeJS.ProcessEnv).every((key) => ["PATH", "HOME", "XDG_CONFIG_HOME"].includes(key)),
  ).toBe(true);
  expect(argv.every((argument) => argument.length <= MAX_ARGUMENT_LENGTH)).toBe(true);
};

/**
 * A result is bounded and leak-free only when its serialization carries no
 * executable identity, host or review-root path, invocation input, or captured
 * payload field.
 */
const expectBoundedLeakFreeResult = (
  value: unknown,
  forbidden: Readonly<{ executable: string; root: string; reviewRoot: string; statement: string }>,
): void => {
  const serialized = JSON.stringify(value) ?? "";
  expect(serialized.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(serialized).not.toContain(forbidden.executable);
  expect(serialized).not.toContain(forbidden.root);
  expect(serialized).not.toContain(forbidden.reviewRoot);
  expect(serialized).not.toContain(forbidden.statement);
  expect(serialized).not.toMatch(/(?:context|statement|stdout|stderr|ledger|credential|raw)/iu);
};

describe("Vibefeld runtime AF integration", () => {
  it("skips before executable resolution or spawn when the gate is absent", async () => {
    const resolveExecutable = vi.fn();
    const spawnProcess = vi.fn();
    const gate = prepareIntegration({}, { resolveExecutable, spawn: spawnProcess });

    expect(gate).toEqual({ skipped: true, reason: "flag" });
    await Promise.resolve();
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  const liveGate = readGate(process.env);
  // Once explicitly opted in, invalid or missing artifacts are a failed gate,
  // not a skip. Only the absent opt-in flag is allowed to skip this suite.
  const live = process.env[RUN_FLAG] === "1" ? describe : describe.skip;

  live("explicit direct-execution runtime", () => {
    // Live mode only: the selected runtime must emit the real CLI shapes
    // (af 0.1.x / format "1.1"); fixture-schema output is rejected.
    it("runs directly with fixed argv, detached stdio, and bounded results", async () => {
      expect(liveGate.enabled, "The integration gate requires the selected AF executable.").toBe(true);
      if (!liveGate.enabled) throw new Error("The integration gate is missing the selected AF executable");
      const executable = await loadLiveExecutable(liveGate);
      expect(executable, "Selected AF executable is missing, invalid, or outside the repository.").toBeDefined();
      if (!executable) throw new Error("Invalid gated Vibefeld integration inputs");
      await mkdir(path.join(REPO_ROOT, "tmp"), { recursive: true });
      const root = await mkdtemp(path.join(REPO_ROOT, "tmp/vibefeld-integration-"));
      const preflightRoot = path.join(root, "preflight");
      await mkdir(preflightRoot, { recursive: true });
      const { launcher, launches } = createRecordingDirectLauncher();
      const policy = createAfDirectPolicyAdapter({
        platform: process.platform,
        resolveExecutable: () => executable,
        launcher,
      });
      const store = createProofWorkspaceStore({
        globalStoragePath: root,
        repositoryPath: REPO_ROOT,
        homePath: os.homedir(),
        openCodeStatePath: path.join(root, "opencode-state"),
      });
      const bridge = createVibefeldRuntimeBridge({
        platform: process.platform,
        architecture: process.arch as "arm64" | "x64" | "arm" | "ia32",
        resolveExecutable: () => executable,
        policy,
        proofStore: store,
        preflightCwd: preflightRoot,
      });
      try {
        const preflight = await bridge.preflight();
        expect(preflight).toMatchObject({ state: "ready", structuralStatus: null });
        expect(launches.slice(0, 2).map(({ argv }) => argv)).toEqual([
          ["version", "--json"],
          ["schema", "--format", "json"],
        ]);
        for (const launch of launches) expectContractedLaunch(launch);
        const initLaunchIndex = launches.length;
        const initResult = await bridge.run({ operation: "init", conjecture: "integration", author: "disposable" });
        expect(initResult).toMatchObject({ state: "ready", structuralStatus: null });
        const reviewRoot = launchArgument(launches[initLaunchIndex].argv, "--dir");
        expect(reviewRoot, "The init launch must run in the allocated review root.").toBeDefined();
        if (!reviewRoot) throw new Error("The init launch did not use an allocated review root");
        expect(reviewRoot.startsWith(`${root}${path.sep}`)).toBe(true);
        const forbidden = { executable, root, reviewRoot, statement: REFINE_STATEMENT };
        expectBoundedLeakFreeResult(initResult, forbidden);

        // The contracted claim sequence runs on the same disposable review root:
        // claim the root node, record one refinement, then read the bounded status.
        const sequenceStart = launches.length;
        const claimResult = await bridge.run({ operation: "claim", nodeId: "1", role: "prover" });
        expect(claimResult).toMatchObject({
          state: "ready",
          structuralStatus: null,
          facts: { nodeId: "1", role: "prover", claimed: true },
        });
        expect(Object.keys(claimResult.facts ?? {})).toEqual(["nodeId", "role", "claimed"]);
        expectBoundedLeakFreeResult(claimResult, forbidden);

        const refineResult = await bridge.run({
          operation: "refine",
          parentId: "1",
          statements: [REFINE_STATEMENT],
        });
        expect(refineResult).toMatchObject({
          state: "ready",
          structuralStatus: null,
          facts: { parentId: "1", childCount: 1 },
        });
        const refineFacts = refineResult.facts as { childIds?: readonly string[] } | undefined;
        expect(refineFacts?.childIds).toHaveLength(1);
        expect(refineFacts?.childIds?.[0]).toMatch(/^[0-9]+(?:\.[0-9]+)*$/u);
        expect(Object.keys(refineResult.facts ?? {})).toEqual(["parentId", "childIds", "childCount"]);
        expectBoundedLeakFreeResult(refineResult, forbidden);

        const statusResult = await bridge.run({ operation: "status" });
        expect(statusResult).toMatchObject({
          state: "ready",
          structuralStatus: null,
          facts: { statistics: { totalNodes: 2 }, nodeCount: 2 },
        });
        expect(Object.keys(statusResult.facts ?? {})).toEqual(["statistics", "jobs", "nodeCount"]);
        expectBoundedLeakFreeResult(statusResult, forbidden);

        const sequenceLaunches = launches.slice(sequenceStart);
        expect(sequenceLaunches).toHaveLength(3);
        expect(sequenceLaunches.map(({ argv }) => argv.slice(1)[0])).toEqual(["claim", "refine", "status"]);
        expect(sequenceLaunches.map(({ argv }) => launchArgument(argv, "--dir"))).toEqual([
          reviewRoot,
          reviewRoot,
          reviewRoot,
        ]);
        for (const launch of launches) expectContractedLaunch(launch);

        const teardown = await bridge.teardown();
        expect(teardown.state).toBe("unavailable");
        expect(launches.some(({ child }) => child.exitCode === null && child.signalCode === null)).toBe(false);
      } finally {
        await bridge.teardown();
        await rm(root, { recursive: true, force: true });
        await expect(access(root)).rejects.toThrow();
      }
    });

    it("does not retry or downgrade after cancellation and reaps the direct child", async () => {
      expect(liveGate.enabled, "The integration gate requires the selected AF executable.").toBe(true);
      if (!liveGate.enabled) throw new Error("The integration gate is missing the selected AF executable");
      const executable = await loadLiveExecutable(liveGate);
      expect(executable, "Selected AF executable is missing, invalid, or outside the repository.").toBeDefined();
      if (!executable) throw new Error("Invalid gated Vibefeld integration inputs");
      await mkdir(path.join(REPO_ROOT, "tmp"), { recursive: true });
      const root = await mkdtemp(path.join(REPO_ROOT, "tmp/vibefeld-integration-"));
      const store = createProofWorkspaceStore({
        globalStoragePath: root,
        repositoryPath: REPO_ROOT,
        homePath: os.homedir(),
        openCodeStatePath: path.join(root, "opencode-state"),
      });
      const { launcher, launches, signals } = createRecordingDirectLauncher();
      const policy = createAfDirectPolicyAdapter({
        platform: process.platform,
        resolveExecutable: () => executable,
        launcher,
      });
      const bridge = createVibefeldRuntimeBridge({
        platform: process.platform,
        architecture: process.arch as "arm64" | "x64" | "arm" | "ia32",
        resolveExecutable: () => executable,
        policy,
        proofStore: store,
        preflightCwd: root,
      });
      try {
        const preflight = await bridge.preflight();
        expect(preflight.state).toBe("ready");
        const controller = new AbortController();
        const run = bridge.run({ operation: "init", conjecture: "cancel", author: "disposable" }, controller.signal);
        await waitForLaunch(launches, 3);
        controller.abort();
        const result = await run;
        expect(result.state).toMatch(/unavailable|audit-failed/);
        expect(signals.some(({ pid, signal }) => pid < 0 && signal === "SIGTERM")).toBe(true);
        await policy.terminateAndReap();
        expect(launches.every(({ child }) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
        expect(launches).toHaveLength(3);
        expect(JSON.stringify(result)).not.toMatch(/(?:raw|stderr|stdout)/iu);
        expect(JSON.stringify(result)).not.toContain(executable);
      } finally {
        await bridge.teardown();
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
