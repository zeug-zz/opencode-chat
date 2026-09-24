import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AF_CAPTURE_AUTHOR,
  AF_CAPTURE_MANIFEST_FILE,
  type AfCaptureOperation,
  buildCaptureArgv,
  buildCaptureSet,
  sanitizeCaptureOutput,
} from "../vibefeld/af-capture-harness";
import {
  parseLiveInitOutput,
  parseLiveSchemaOutput,
  parseLiveStatusOutput,
  parseLiveVersionOutput,
} from "../vibefeld/af-live-output";

/**
 * Explicitly opted-in live capture integration. The opt-in flag and the
 * selected AF executable are read before any resolution, workspace allocation,
 * or spawn-capable import; the suite skips by default and no default test
 * launches a shell, a subprocess, or a live AF command. The staged capture set
 * is removed after the run unless `OPENCODE_CHAT_KEEP_VIBEFELD_CAPTURE` is `1`.
 */

const RUN_FLAG = "OPENCODE_CHAT_RUN_VIBEFELD_CAPTURE";
const EXECUTABLE_FLAG = "OPENCODE_CHAT_VIBEFELD_AF_EXECUTABLE";
const KEEP_FLAG = "OPENCODE_CHAT_KEEP_VIBEFELD_CAPTURE";
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const TMP_ROOT = path.join(PACKAGE_ROOT, "tmp");
const MAX_OUTPUT_BYTES = 32_768;
const EXIT_TIMEOUT_MS = 30_000;
const INIT_CONJECTURE = "All primes greater than 2 are odd";
const CAPTURE_SEQUENCE = ["version", "schema", "init", "claim", "refine", "status"] as const;

type CaptureGate =
  | Readonly<{ enabled: false; reason: "flag" | "executable" }>
  | Readonly<{ enabled: true; executable: string }>;

/** The only gate read; absent inputs skip, they never fall back to a default. */
const readCaptureGate = (env: NodeJS.ProcessEnv): CaptureGate => {
  if (env[RUN_FLAG] !== "1") return { enabled: false, reason: "flag" };
  const executable = env[EXECUTABLE_FLAG];
  if (typeof executable !== "string" || executable.length === 0 || executable.length > 4_096) {
    return { enabled: false, reason: "executable" };
  }
  return { enabled: true, executable };
};

const CAPTURE_GATE = readCaptureGate(process.env);

/** The staging root survives the run only behind the explicit keep flag. */
const KEEP_STAGING_ROOT = process.env[KEEP_FLAG] === "1";

type CaptureSeams = Readonly<{
  resolveExecutable: (selected: string) => unknown;
  allocateWorkspace: (selected: string) => unknown;
  spawn: (selected: string) => unknown;
}>;

const prepareCapture = (
  env: NodeJS.ProcessEnv,
  seams: CaptureSeams,
): Readonly<{ skipped: true; reason: "flag" | "executable" }> | Readonly<{ skipped: false }> => {
  const gate = readCaptureGate(env);
  if (!gate.enabled) return { skipped: true, reason: gate.reason };
  seams.resolveExecutable(gate.executable);
  seams.allocateWorkspace(gate.executable);
  seams.spawn(gate.executable);
  return { skipped: false };
};

type CaptureRun = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

const bounded = (value: Buffer): string => value.toString("utf8").slice(0, MAX_OUTPUT_BYTES);

const runCapturedCommand = (
  spawnProcess: typeof import("node:child_process").spawn,
  executable: string,
  argv: readonly string[],
  cwd: string,
): Promise<CaptureRun> =>
  new Promise((resolve) => {
    const child = spawnProcess(executable, [...argv], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]).subarray(0, MAX_OUTPUT_BYTES + 1);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]).subarray(0, MAX_OUTPUT_BYTES + 1);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), EXIT_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: 127, signal: null, stdout: bounded(stdout), stderr: bounded(stderr) });
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout: bounded(stdout), stderr: bounded(stderr) });
    });
  });

describe("Vibefeld AF live-capture harness integration", () => {
  it("skips before executable resolution, workspace allocation, or spawn when the gate is absent", () => {
    const resolveExecutable = vi.fn();
    const allocateWorkspace = vi.fn();
    const spawnProcess = vi.fn();
    const prepared = prepareCapture({}, { resolveExecutable, allocateWorkspace, spawn: spawnProcess });

    expect(prepared).toEqual({ skipped: true, reason: "flag" });
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(allocateWorkspace).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("skips before any spawn-capable work when only the opt-in flag is present", () => {
    const resolveExecutable = vi.fn();
    const allocateWorkspace = vi.fn();
    const spawnProcess = vi.fn();
    const prepared = prepareCapture({ [RUN_FLAG]: "1" }, { resolveExecutable, allocateWorkspace, spawn: spawnProcess });

    expect(prepared).toEqual({ skipped: true, reason: "executable" });
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(allocateWorkspace).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  const captureDescribe = CAPTURE_GATE.enabled ? describe : describe.skip;

  captureDescribe("explicit live capture", () => {
    it("captures the six fixed CLI shapes, sanitizes them, and removes the disposable root by default", async () => {
      const gate = readCaptureGate(process.env);
      expect(gate.enabled, "The capture gate requires the opt-in flag and a selected AF executable.").toBe(true);
      if (!gate.enabled) throw new Error("The capture gate is missing the opt-in flag or the selected AF executable.");

      const { spawn } = await import("node:child_process");
      const { constants } = await import("node:fs");
      const { access, mkdir, readFile, realpath, rm, writeFile } = await import("node:fs/promises");

      const root = path.join(TMP_ROOT, `vibefeld-capture-${process.pid}`);
      const workspaceRoot = path.join(root, "workspace");
      await mkdir(workspaceRoot, { recursive: true });
      try {
        await access(gate.executable, constants.X_OK);
        const workspaceCandidates = new Set([workspaceRoot, await realpath(workspaceRoot)]);
        const outputs: Record<AfCaptureOperation, string> = {
          version: "",
          schema: "",
          init: "",
          claim: "",
          refine: "",
          status: "",
        };

        for (const operation of CAPTURE_SEQUENCE) {
          const argv = buildCaptureArgv(operation, { workspace: workspaceRoot, conjecture: INIT_CONJECTURE });
          expect(argv, `${operation} must resolve a fixed argv`).toBeDefined();
          if (!argv) throw new Error(`The capture harness resolved no fixed argv for ${operation}`);
          if (operation === "init" || operation === "claim" || operation === "refine") {
            expect(argv, `${operation} must use the fixed host-owned capture owner`).toContain(AF_CAPTURE_AUTHOR);
          }

          const run = await runCapturedCommand(spawn, gate.executable, argv, workspaceRoot);
          expect(run.exitCode, `${operation} must exit successfully`).toBe(0);
          expect(run.stdout.length).toBeGreaterThan(0);

          let sanitized = sanitizeCaptureOutput(operation, run.stdout, workspaceRoot);
          for (const candidate of workspaceCandidates) {
            if (sanitized.ok) break;
            sanitized = sanitizeCaptureOutput(operation, run.stdout, candidate);
          }
          expect(sanitized.ok, `${operation} capture must sanitize into bounded output`).toBe(true);
          if (!sanitized.ok) throw new Error(`The ${operation} capture failed sanitization (${sanitized.reason})`);
          outputs[operation] = sanitized.contents;
        }

        const versionResult = parseLiveVersionOutput(outputs.version, { exitCode: 0 });
        expect(versionResult.ok, "the captured version shape must parse as live output").toBe(true);
        if (!versionResult.ok) {
          throw new Error(`The captured version shape is not a live shape (${versionResult.failure.reason})`);
        }
        const runtimeIdentity = {
          version: versionResult.facts.version,
          commit: versionResult.facts.commit,
          build_date: versionResult.facts.buildDate,
          go_version: versionResult.facts.goVersion,
          format: versionResult.facts.format,
          policy: versionResult.facts.policy,
        };
        expect(parseLiveSchemaOutput(outputs.schema, { exitCode: 0 }).ok).toBe(true);
        expect(parseLiveInitOutput(outputs.init, { exitCode: 0 }).ok).toBe(true);
        expect(parseLiveStatusOutput(outputs.status, { exitCode: 0 }).ok).toBe(true);

        // No live claim/refine parsers exist yet: assert the captured JSON stayed on the
        // sanitize path and that recorded content remained redacted.
        const claimOutput = JSON.parse(outputs.claim) as Record<string, unknown>;
        const refineOutput = JSON.parse(outputs.refine) as { children: Array<Record<string, unknown>> };
        expect(claimOutput.context, "captured claim context must stay redacted").toBe("<context>");
        expect(refineOutput.children[0].statement, "captured refine statements must stay redacted").toBe("<statement>");

        const captureSet = buildCaptureSet(outputs, runtimeIdentity, new Date().toISOString());
        expect(captureSet.ok, "the capture set must assemble within bounds").toBe(true);
        if (!captureSet.ok) throw new Error(`The capture set failed assembly (${captureSet.reason})`);
        expect(captureSet.files.map((file) => file.relativePath)).toEqual([
          "version.json",
          "schema.json",
          "init.txt",
          "claim.json",
          "refine.json",
          "status.json",
          AF_CAPTURE_MANIFEST_FILE,
        ]);

        for (const file of captureSet.files) {
          expect(file.relativePath).toMatch(/^[a-z]+\.(?:json|txt)$/u);
          const target = path.join(root, file.relativePath);
          await writeFile(target, file.contents, "utf8");
          const written = await readFile(target, "utf8");
          expect(written).toBe(file.contents);
          expect(written).not.toContain(workspaceRoot);
          expect(written).not.toContain(root);
          expect(written).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:[\\/]/u);
          expect(written).not.toMatch(
            /(?:prompt|source[-_ ]?packet|private[-_ ]?reasoning|secret|password|credential|api[-_ ]?key)/iu,
          );
          expect(new TextEncoder().encode(written).length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
        }

        const fileContents = new Map(captureSet.files.map((file) => [file.relativePath, file.contents]));
        expect(fileContents.get("init.txt")).toContain("<workspace>");
        expect(fileContents.get(AF_CAPTURE_MANIFEST_FILE)).toContain("<workspace>");
      } finally {
        if (!KEEP_STAGING_ROOT) await rm(root, { recursive: true, force: true });
      }
      if (!KEEP_STAGING_ROOT) await expect(access(root)).rejects.toThrow();
    });
  });
});
