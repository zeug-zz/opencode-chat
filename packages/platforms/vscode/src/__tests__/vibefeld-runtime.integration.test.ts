import { type ChildProcess, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  AfExecutionPolicyAdapter,
  AfPolicyDescriptor,
  AfPolicyExecutionFact,
  AfPreflightDescriptor,
} from "../vibefeld/af-execution-boundary";
import { createProofWorkspaceStore } from "../vibefeld/proof-workspace-store";
import { VibefeldRuntimeBridge } from "../vibefeld/vibefeld-runtime";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FIXTURE_PATH = path.join(__dirname, "fixtures/vibefeld/manifest.json");
const RUN_FLAG = "OPENCODE_CHAT_RUN_VIBEFELD_INTEGRATION";
const EXECUTABLE_FLAG = "OPENCODE_CHAT_VIBEFELD_AF_EXECUTABLE";
const POLICY_EXECUTABLE_FLAG = "OPENCODE_CHAT_VIBEFELD_POLICY_EXECUTABLE";
const POLICY_MANIFEST_FLAG = "OPENCODE_CHAT_VIBEFELD_POLICY_MANIFEST";
const MAX_OUTPUT_BYTES = 2_048;
const DENIED_DOMAINS = ["repository", "home-directory", "opencode-state", "sibling-review-roots"] as const;

type Gate =
  | { readonly enabled: false; readonly reason: "flag" | "executable" | "policy" }
  | {
      readonly enabled: true;
      readonly executable: string;
      readonly policyExecutable: string;
      readonly policyManifest: string;
    };

const readGate = (env: NodeJS.ProcessEnv): Gate => {
  if (env[RUN_FLAG] !== "1") return { enabled: false, reason: "flag" };
  if (!env[EXECUTABLE_FLAG]) return { enabled: false, reason: "executable" };
  if (!env[POLICY_EXECUTABLE_FLAG] || !env[POLICY_MANIFEST_FLAG]) return { enabled: false, reason: "policy" };
  return {
    enabled: true,
    executable: env[EXECUTABLE_FLAG],
    policyExecutable: env[POLICY_EXECUTABLE_FLAG],
    policyManifest: env[POLICY_MANIFEST_FLAG],
  };
};

const prepareIntegration = (
  env: NodeJS.ProcessEnv,
  seams: Readonly<{
    resolveExecutable: (selected: string) => unknown;
    validatePolicy: (selected: string) => unknown;
    spawn: () => unknown;
  }>,
): { readonly skipped: true; readonly reason: Gate["reason"] } | { readonly skipped: false } => {
  const gate = readGate(env);
  if (!gate.enabled) return { skipped: true, reason: gate.reason };
  seams.resolveExecutable(gate.executable);
  seams.validatePolicy(gate.policyManifest);
  seams.spawn();
  return { skipped: false };
};

const projectPath = (value: string): string | undefined => {
  if (path.isAbsolute(value)) return undefined;
  const resolved = path.resolve(REPO_ROOT, value);
  const relative = path.relative(REPO_ROOT, resolved);
  return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) ? undefined : resolved;
};

type PolicyManifest = Readonly<{
  kind: "dedicated-af-policy";
  protocol: "argv-v1";
  platforms: readonly NodeJS.Platform[];
  shell: false;
  descendantConfinement: "inherited";
  childExecution: "deny-unapproved";
  deniedDomains: readonly string[];
  boundedOutput: true;
  terminateAndReap: true;
  noDowngrade: true;
  denialProbe: "argv-v1";
}>;

const validatePolicyManifest = (value: unknown): value is PolicyManifest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest.kind === "dedicated-af-policy" &&
    manifest.protocol === "argv-v1" &&
    Array.isArray(manifest.platforms) &&
    manifest.platforms.includes(process.platform) &&
    manifest.shell === false &&
    manifest.descendantConfinement === "inherited" &&
    manifest.childExecution === "deny-unapproved" &&
    JSON.stringify(manifest.deniedDomains) === JSON.stringify(DENIED_DOMAINS) &&
    manifest.boundedOutput === true &&
    manifest.terminateAndReap === true &&
    manifest.noDowngrade === true &&
    manifest.denialProbe === "argv-v1"
  );
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

/**
 * The selected policy executable is an external, disposable launcher. Its
 * argv-v1 contract is validated from a project-local manifest before this
 * adapter is constructed; this adapter never falls back to direct spawn.
 */
const createDisposablePolicy = (policyExecutable: string, manifest: PolicyManifest): AfExecutionPolicyAdapter => {
  const launches: Array<{
    descriptor: AfPolicyDescriptor | AfPreflightDescriptor;
    child: ChildProcess;
    settled: Promise<AfPolicyExecutionFact>;
  }> = [];
  let reaped = 0;
  const launch = async (descriptor: AfPolicyDescriptor | AfPreflightDescriptor): Promise<AfPolicyExecutionFact> => {
    expect(descriptor.shell).toBe(false);
    expect(descriptor.deniedDomains).toEqual(DENIED_DOMAINS);
    expect(manifest.noDowngrade).toBe(true);
    const child = spawn(policyExecutable, ["--run", descriptor.executable, ...descriptor.argv.slice(1)], {
      cwd: descriptor.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const settled = waitForChild(child);
    launches.push({ descriptor, child, settled });
    return settled;
  };
  return {
    platform: process.platform,
    readiness: {
      state: "ready",
      descendantConfinement: "inherited",
      childExecution: "deny-unapproved",
      deniedDomains: "enforced",
      audit: "verified",
    },
    launch,
    launchPreflight: launch,
    terminateAndReap: async () => {
      for (const { child } of launches) {
        if (child.exitCode === null && child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
        }
      }
      await Promise.all(launches.map(({ settled }) => settled.catch(() => undefined)));
      reaped += launches.length;
      return { outcome: "reaped" };
    },
    get observedLaunches() {
      return launches;
    },
    get reapedCount() {
      return reaped;
    },
  } as AfExecutionPolicyAdapter & { readonly observedLaunches: typeof launches; readonly reapedCount: number };
};

const loadLiveInputs = async (gate: Extract<Gate, { enabled: true }>) => {
  const executable = projectPath(gate.executable);
  const policyExecutable = projectPath(gate.policyExecutable);
  const policyManifest = projectPath(gate.policyManifest);
  if (!executable || !policyExecutable || !policyManifest) return undefined;
  try {
    await Promise.all([access(executable), access(policyExecutable), access(policyManifest)]);
    const manifest = JSON.parse(await readFile(policyManifest, "utf8")) as unknown;
    if (!validatePolicyManifest(manifest)) return undefined;
    return { executable, policyExecutable, manifest };
  } catch {
    return undefined;
  }
};

const runDeniedWriteProbe = async (policyExecutable: string, root: string, domain: string) => {
  const target = path.join(root, `denied-${domain}.txt`);
  const child = spawn(policyExecutable, ["--probe-denied-write", domain, target], {
    cwd: root,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const fact = await waitForChild(child);
  expect(fact.outcome).toBe("exited");
  expect(fact.exitCode).not.toBe(0);
  expect(fact.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(fact.stderr.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  await expect(access(target)).rejects.toThrow();
};

const waitForLaunch = async (launches: readonly unknown[], minimum: number): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (launches.length < minimum && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(launches.length).toBeGreaterThanOrEqual(minimum);
};

describe("Vibefeld runtime AF integration", () => {
  it("skips before executable resolution, policy validation, or spawn when the gate is absent", async () => {
    const resolveExecutable = vi.fn();
    const validatePolicy = vi.fn();
    const spawnProcess = vi.fn();
    const gate = prepareIntegration(
      {},
      {
        resolveExecutable,
        validatePolicy,
        spawn: spawnProcess,
      },
    );

    expect(gate).toEqual({ skipped: true, reason: "flag" });
    await Promise.resolve();
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(validatePolicy).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  const liveGate = readGate(process.env);
  // Once explicitly opted in, invalid or missing artifacts are a failed gate,
  // not a skip. Only the absent opt-in flag is allowed to skip this suite.
  const live = process.env[RUN_FLAG] === "1" ? describe : describe.skip;

  live("explicit disposable AF boundary", () => {
    it("runs only after independent policy validation and preserves fixed argv and bounded results", async () => {
      expect(liveGate.enabled, "The integration gate requires all selected executable and policy inputs.").toBe(true);
      if (!liveGate.enabled) throw new Error("The integration gate is missing selected executable or policy inputs");
      const inputs = await loadLiveInputs(liveGate);
      expect(
        inputs,
        "Selected AF executable/policy artifacts are missing, invalid, or outside the repository.",
      ).toBeDefined();
      if (!inputs) throw new Error("Invalid gated Vibefeld integration inputs");
      const fixtureJson = await readFile(FIXTURE_PATH, "utf8");
      await mkdir(path.join(REPO_ROOT, "tmp"), { recursive: true });
      const root = await mkdtemp(path.join(REPO_ROOT, "tmp/vibefeld-integration-"));
      const runtimeRoot = path.join(root, "runtime");
      const preflightRoot = path.join(root, "preflight");
      await Promise.all([mkdir(runtimeRoot, { recursive: true }), mkdir(preflightRoot, { recursive: true })]);
      await Promise.all([
        writeFile(path.join(runtimeRoot, ".keep"), ""),
        writeFile(path.join(preflightRoot, ".keep"), ""),
      ]);
      const policy = createDisposablePolicy(inputs.policyExecutable, inputs.manifest);
      const store = createProofWorkspaceStore({
        globalStoragePath: root,
        repositoryPath: REPO_ROOT,
        homePath: os.homedir(),
        openCodeStatePath: path.join(root, "opencode-state"),
      });
      const bridge = new VibefeldRuntimeBridge({
        fixtureJson,
        platform: process.platform,
        architecture: process.arch as "arm64" | "x64" | "arm" | "ia32",
        resolveExecutable: () => inputs.executable,
        policy,
        proofStore: store,
        readOnlyRuntimeGrants: [{ path: runtimeRoot }],
        preflightCwd: preflightRoot,
      });
      try {
        const preflight = await bridge.preflight();
        expect(preflight).toMatchObject({ state: "ready", structuralStatus: null });
        const launches = (
          policy as AfExecutionPolicyAdapter & {
            observedLaunches: Array<{ descriptor: AfPolicyDescriptor | AfPreflightDescriptor }>;
          }
        ).observedLaunches;
        expect(launches.every(({ descriptor }) => descriptor.shell === false)).toBe(true);
        expect(launches.slice(0, 2).map(({ descriptor }) => descriptor.argv.slice(1))).toEqual([
          ["version", "--json"],
          ["schema", "--format", "json"],
        ]);
        const result = await bridge.run({ operation: "init", conjecture: "integration", author: "disposable" });
        expect(result).toMatchObject({ state: "ready", structuralStatus: null });
        expect(JSON.stringify(result)).not.toContain(inputs.executable);
        expect(JSON.stringify(result)).not.toMatch(/(?:stderr|stdout|ledger|credential|raw)/iu);
        expect(launches.every(({ descriptor }) => descriptor.argv.every((argument) => argument.length <= 256))).toBe(
          true,
        );
        for (const domain of DENIED_DOMAINS) await runDeniedWriteProbe(inputs.policyExecutable, root, domain);
      } finally {
        await bridge.teardown();
        await rm(root, { recursive: true, force: true });
      }
    });

    it("does not retry or downgrade after cancellation and reaps descendants", async () => {
      expect(liveGate.enabled, "The integration gate requires all selected executable and policy inputs.").toBe(true);
      if (!liveGate.enabled) throw new Error("The integration gate is missing selected executable or policy inputs");
      const inputs = await loadLiveInputs(liveGate);
      expect(
        inputs,
        "Selected AF executable/policy artifacts are missing, invalid, or outside the repository.",
      ).toBeDefined();
      if (!inputs) throw new Error("Invalid gated Vibefeld integration inputs");
      await mkdir(path.join(REPO_ROOT, "tmp"), { recursive: true });
      const root = await mkdtemp(path.join(REPO_ROOT, "tmp/vibefeld-integration-"));
      await mkdir(path.join(root, "runtime"), { recursive: true });
      const store = createProofWorkspaceStore({
        globalStoragePath: root,
        repositoryPath: REPO_ROOT,
        homePath: os.homedir(),
        openCodeStatePath: path.join(root, "opencode-state"),
      });
      const policy = createDisposablePolicy(inputs.policyExecutable, inputs.manifest);
      const bridge = new VibefeldRuntimeBridge({
        fixtureJson: await readFile(FIXTURE_PATH, "utf8"),
        platform: process.platform,
        architecture: process.arch as "arm64" | "x64" | "arm" | "ia32",
        resolveExecutable: () => inputs.executable,
        policy,
        proofStore: store,
        readOnlyRuntimeGrants: [{ path: path.join(root, "runtime") }],
        preflightCwd: root,
      });
      try {
        const preflight = await bridge.preflight();
        expect(preflight.state).toBe("ready");
        const controller = new AbortController();
        const launches = (
          policy as AfExecutionPolicyAdapter & {
            observedLaunches: Array<{ child: ChildProcess }>;
          }
        ).observedLaunches;
        const run = bridge.run({ operation: "init", conjecture: "cancel", author: "disposable" }, controller.signal);
        await waitForLaunch(launches, 3);
        controller.abort();
        const result = await run;
        expect(result.state).toMatch(/unavailable|audit-failed/);
        expect((policy as AfExecutionPolicyAdapter & { reapedCount: number }).reapedCount).toBeGreaterThan(0);
        expect(launches.every(({ child }) => child.exitCode !== null)).toBe(true);
        expect(launches).toHaveLength(3);
        expect(JSON.stringify(result)).not.toMatch(/(?:unsandboxed|chat sandbox|raw|stderr|stdout)/iu);
        expect(JSON.stringify(result)).not.toContain(inputs.executable);
      } finally {
        await bridge.teardown();
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
