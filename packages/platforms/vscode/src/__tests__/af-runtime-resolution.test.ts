import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AfDirectLauncher, AfDirectLaunchOptions } from "../vibefeld/af-direct-policy";
import { AF_DISCOVERY_ROOTS, type AfDiscoveryAccess } from "../vibefeld/af-discovery";
import type {
  AfExecutionPolicyAdapter,
  AfPolicyDescriptor,
  AfPolicyExecutionFact,
  AfPreflightDescriptor,
} from "../vibefeld/af-execution-boundary";
import type { AfOutputParserSet } from "../vibefeld/af-parser-mode";
import { createAfProcessExecutor } from "../vibefeld/af-process-executor";
import { resolveAfExecutable, resolveAfRuntime } from "../vibefeld/af-runtime-resolution";
import type { ProofWorkspaceFileSystem, ProofWorkspaceStore } from "../vibefeld/proof-workspace-store";
import { createVibefeldActivation } from "../vibefeld/vibefeld-activation";
import { createVibefeldRuntimeBridge } from "../vibefeld/vibefeld-runtime";

/**
 * Resolution tests use injected seams only: no real AF process and no
 * filesystem mutation is reachable from this suite.
 */

const AF_PATH = "/opt/homebrew/bin/af";
const GLOBAL_STORAGE = "/host/global-storage";
const PREFLIGHT_CWD = `${GLOBAL_STORAGE}/vibefeld/reviews`;
const live = (name: string) =>
  readFileSync(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const afSeams = (
  files: Record<string, { isFile?: boolean; ownedByHost?: boolean; access?: AfDiscoveryAccess }> = {},
) => {
  const stat = vi.fn((candidate: string) => {
    const file = files[candidate];
    return file ? { isFile: file.isFile ?? true, ownedByHost: file.ownedByHost ?? true } : undefined;
  });
  const access = vi.fn((candidate: string) => files[candidate]?.access ?? "executable");
  return { stat, access };
};

/** Records the fixed direct argv and replays sanitized live captures; it never spawns. */
class RecordingLauncher implements AfDirectLauncher {
  readonly calls: Array<{
    descriptor: AfPolicyDescriptor | AfPreflightDescriptor;
    options: AfDirectLaunchOptions;
  }> = [];

  async launch(
    descriptor: AfPolicyDescriptor | AfPreflightDescriptor,
    options: AfDirectLaunchOptions,
  ): Promise<AfPolicyExecutionFact> {
    this.calls.push({ descriptor, options });
    return {
      outcome: "exited",
      exitCode: 0,
      stdout: descriptor.argv.includes("schema") ? live("schema.json") : live("version.json"),
      stderr: "",
    };
  }

  async terminateAndReap(): Promise<"reaped" | "failed"> {
    return "reaped";
  }
}

/** In-memory proof-store seam: no real directory is created or read. */
const createProofFileSystem = (): ProofWorkspaceFileSystem =>
  ({
    lstat: vi.fn(async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    mkdir: vi.fn(async () => undefined),
    realpath: vi.fn(async (target: string) => path.posix.normalize(target)),
    rm: vi.fn(async () => undefined),
    rmdir: vi.fn(async () => undefined),
  }) as unknown as ProofWorkspaceFileSystem;

describe("host-owned AF executable resolution", () => {
  it("returns the found executable from the fixed roots", () => {
    const { stat, access } = afSeams({ [AF_PATH]: {} });
    expect(
      resolveAfExecutable({ platform: "darwin", pathValue: "", candidateRoots: AF_DISCOVERY_ROOTS, stat, access }),
    ).toEqual({ state: "found", executable: AF_PATH });
    expect(stat).toHaveBeenCalledWith(AF_PATH);
    expect(access).toHaveBeenCalledWith(AF_PATH);
  });

  it("finds an executable installed only in an approved home root", () => {
    const homePath = "/host/home";
    const homeAf = `${homePath}/go/bin/af`;
    const { stat, access } = afSeams({ [homeAf]: {} });
    expect(resolveAfExecutable({ platform: "darwin", pathValue: "", homePath, stat, access })).toEqual({
      state: "found",
      executable: homeAf,
    });
  });

  it("reaches ready with a home-root executable without launching", async () => {
    const homePath = "/host/home";
    const homeAf = `${homePath}/go/bin/af`;
    const { stat, access } = afSeams({ [homeAf]: {} });
    const launcher = new RecordingLauncher();
    const resolution = await resolveAfRuntime({ platform: "darwin", pathValue: "", homePath, stat, access, launcher });
    expect(resolution.state).toBe("ready");
    if (resolution.state === "ready") expect(resolution.resolveExecutable()).toBe(homeAf);
    expect(launcher.calls).toHaveLength(0);
  });

  it("does not add home roots for an invalid home path", () => {
    const { stat, access } = afSeams();
    expect(resolveAfExecutable({ platform: "darwin", pathValue: "", homePath: "relative/home", stat, access })).toEqual(
      {
        state: "unavailable",
        reason: "absent",
      },
    );
    expect(stat).toHaveBeenCalledTimes(AF_DISCOVERY_ROOTS.length);
  });

  it("deduplicates a PATH candidate matching a home root", () => {
    const homePath = "/host/home";
    const homeAf = `${homePath}/go/bin/af`;
    const { stat, access } = afSeams({ [homeAf]: {} });
    expect(
      resolveAfExecutable({ platform: "darwin", homePath, pathValue: `${homePath}/go/bin`, stat, access }),
    ).toEqual({ state: "found", executable: homeAf });
    expect(stat.mock.calls.filter(([candidate]) => candidate === homeAf)).toHaveLength(1);
  });

  it.each([
    ["not-owned", { ownedByHost: false }, "not-owned"],
    ["not a regular file", { isFile: false }, "not-executable"],
    ["not executable", { access: "not-executable" as const }, "not-executable"],
  ] as const)("keeps the existing reason for a home candidate that is %s", (_name, metadata, reason) => {
    const homeAf = "/host/home/go/bin/af";
    const { stat, access } = afSeams({ [homeAf]: metadata });
    expect(resolveAfExecutable({ platform: "darwin", pathValue: "", homePath: "/host/home", stat, access })).toEqual({
      state: "unavailable",
      reason,
    });
  });

  it("remains ambiguous across system and home roots", () => {
    const homeAf = "/host/home/go/bin/af";
    const { stat, access } = afSeams({ [AF_PATH]: {}, [homeAf]: {} });
    expect(resolveAfExecutable({ platform: "darwin", pathValue: "", homePath: "/host/home", stat, access })).toEqual({
      state: "unavailable",
      reason: "ambiguous",
    });
  });

  it("returns absent without a PATH entry", () => {
    const { stat, access } = afSeams();
    expect(
      resolveAfExecutable({ platform: "darwin", pathValue: "", candidateRoots: AF_DISCOVERY_ROOTS, stat, access }),
    ).toEqual({ state: "unavailable", reason: "absent" });
  });

  it("fails closed as ambiguous when distinct fixed and PATH candidates exist", () => {
    const { stat, access } = afSeams({ [AF_PATH]: {}, "/custom/bin/af": {} });
    expect(
      resolveAfExecutable({
        platform: "darwin",
        pathValue: "/custom/bin",
        candidateRoots: AF_DISCOVERY_ROOTS,
        stat,
        access,
      }),
    ).toEqual({ state: "unavailable", reason: "ambiguous" });
  });

  it.each([
    ["not-executable", { [AF_PATH]: { access: "not-executable" as const } }, "not-executable"],
    ["not-owned", { [AF_PATH]: { ownedByHost: false } }, "not-owned"],
    ["not a file", { [AF_PATH]: { isFile: false } }, "not-executable"],
  ] as const)("fails closed for a %s candidate", (_name, files, reason) => {
    const { stat, access } = afSeams(files);
    expect(
      resolveAfExecutable({ platform: "darwin", pathValue: "", candidateRoots: AF_DISCOVERY_ROOTS, stat, access }),
    ).toEqual({ state: "unavailable", reason });
  });

  it("never inspects the filesystem on an unsupported platform", () => {
    const { stat, access } = afSeams({ [AF_PATH]: {} });
    expect(
      resolveAfExecutable({ platform: "win32", pathValue: "", candidateRoots: AF_DISCOVERY_ROOTS, stat, access }),
    ).toEqual({ state: "unavailable", reason: "unsupported-platform" });
    expect(stat).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
  });

  it("ignores model-supplied executable, path, environment, and argv input", () => {
    const { stat, access } = afSeams();
    const modelInput = { executable: "/model/af", path: "/model", environment: { PATH: "/model" }, argv: ["--x"] };
    expect(
      resolveAfExecutable({
        platform: "darwin",
        pathValue: "",
        candidateRoots: AF_DISCOVERY_ROOTS,
        stat,
        access,
        ...modelInput,
      } as never),
    ).toEqual({ state: "unavailable", reason: "absent" });
    expect(stat).toHaveBeenCalledTimes(AF_DISCOVERY_ROOTS.length);
  });
});

describe("composed AF runtime resolution", () => {
  const runtimeOptions = (overrides: Record<string, unknown> = {}) => {
    const { stat, access } = afSeams({ [AF_PATH]: {} });
    return {
      stat,
      access,
      options: {
        platform: "darwin" as const,
        pathValue: "",
        candidateRoots: AF_DISCOVERY_ROOTS,
        stat,
        access,
        ...overrides,
      },
    };
  };

  it("reports direct readiness from the host-owned executable without launching anything", async () => {
    const launcher = new RecordingLauncher();
    const { options } = runtimeOptions({ launcher });

    const resolution = await resolveAfRuntime(options);

    expect(resolution.state).toBe("ready");
    if (resolution.state !== "ready") return;
    expect(resolution.resolveExecutable()).toBe(AF_PATH);
    expect(resolution.resolveExecutable()).toBe(AF_PATH);
    expect(resolution.policy.platform).toBe("darwin");
    expect(resolution.policy.readiness).toEqual({ state: "ready", execution: "direct" });
    // Resolution alone never requests a process.
    expect(launcher.calls).toHaveLength(0);

    const fact = await resolution.policy.launch(
      { executable: AF_PATH, argv: [AF_PATH, "version", "--json"], cwd: PREFLIGHT_CWD },
      undefined,
      { stdinBytes: 0, stdoutBytes: 4_096, stderrBytes: 4_096 },
    );
    expect(fact).toMatchObject({ outcome: "exited", exitCode: 0 });
    expect(launcher.calls[0].descriptor).toEqual({
      executable: AF_PATH,
      argv: [AF_PATH, "version", "--json"],
      cwd: PREFLIGHT_CWD,
    });
  });

  it.each([
    ["absent", {}, ""],
    ["ambiguous", { [AF_PATH]: {}, "/custom/bin/af": {} }, "/custom/bin"],
    ["not-executable", { [AF_PATH]: { access: "not-executable" as const } }, ""],
    ["not-owned", { [AF_PATH]: { ownedByHost: false } }, ""],
  ] as const)("stays dormant without a process for an %s executable", async (_name, files, pathValue) => {
    const { stat, access } = afSeams(files as Record<string, { access?: AfDiscoveryAccess }>);
    const launcher = new RecordingLauncher();

    const resolution = await resolveAfRuntime({
      platform: "darwin",
      pathValue,
      candidateRoots: AF_DISCOVERY_ROOTS,
      stat,
      access,
      launcher,
    });

    expect(resolution).toEqual({ state: "dormant", reason: "missing-af" });
    expect(resolution).not.toHaveProperty("policy");
    expect(resolution).not.toHaveProperty("resolveExecutable");
    expect(JSON.stringify(resolution)).not.toContain("/opt/homebrew");
    expect(launcher.calls).toHaveLength(0);
  });

  it("never composes from a relative PATH resolution", async () => {
    const { stat, access } = afSeams({ "relative/bin/af": {} });
    const launcher = new RecordingLauncher();

    const resolution = await resolveAfRuntime({
      platform: "darwin",
      pathValue: "relative/bin",
      candidateRoots: AF_DISCOVERY_ROOTS,
      stat,
      access,
      launcher,
    });

    expect(resolution).toEqual({ state: "dormant", reason: "missing-af" });
    expect(launcher.calls).toHaveLength(0);
  });

  it("stays dormant on unsupported platforms without inspecting or launching anything", async () => {
    const { stat, access } = afSeams({ [AF_PATH]: {} });
    const launcher = new RecordingLauncher();

    const resolution = await resolveAfRuntime({
      platform: "win32",
      pathValue: "",
      candidateRoots: AF_DISCOVERY_ROOTS,
      stat,
      access,
      launcher,
    });

    expect(resolution).toEqual({ state: "dormant", reason: "unsupported-platform" });
    expect(stat).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(launcher.calls).toHaveLength(0);
  });

  it("uses a valid explicit executable directly without discovery", async () => {
    const explicitExecutable = "/host/custom/af";
    const { stat, access } = afSeams({ [explicitExecutable]: {} });

    const resolution = await resolveAfRuntime({
      platform: "darwin",
      explicitExecutable,
      stat,
      access,
      launcher: new RecordingLauncher(),
    });

    expect(resolution.state).toBe("ready");
    if (resolution.state !== "ready") return;
    expect(resolution.resolveExecutable()).toBe(explicitExecutable);
    expect(stat).toHaveBeenCalledWith(explicitExecutable);
    expect(access).toHaveBeenCalledWith(explicitExecutable);
    expect(stat.mock.calls.map(([candidate]) => candidate)).toEqual([explicitExecutable]);
  });

  it.each([
    ["relative", "custom/af", undefined],
    ["blank", "", undefined],
    ["whitespace", "  \t", undefined],
    ["missing", "/host/custom/missing-af", undefined],
    ["not-owned", "/host/custom/not-owned-af", { ownedByHost: false }],
    ["not a regular file", "/host/custom/directory", { isFile: false }],
    ["not executable", "/host/custom/not-executable-af", { access: "not-executable" as const }],
    ["access denied", "/host/custom/denied-af", { access: "denied" as const }],
  ] as const)(
    "fails closed for an invalid explicit executable that is %s",
    async (_name, explicitExecutable, metadata) => {
      const files = metadata ? { [explicitExecutable]: metadata } : {};
      const { stat, access } = afSeams(files);

      const resolution = await resolveAfRuntime({
        platform: "darwin",
        explicitExecutable,
        pathValue: "/fallback/bin",
        candidateRoots: AF_DISCOVERY_ROOTS,
        stat,
        access,
      });

      expect(resolution).toEqual({ state: "dormant", reason: "missing-af" });
      expect(stat.mock.calls.map(([candidate]) => candidate)).toEqual(
        explicitExecutable.trim() && path.posix.isAbsolute(explicitExecutable) ? [explicitExecutable] : [],
      );
      expect(stat.mock.calls.every(([candidate]) => candidate === explicitExecutable)).toBe(true);
    },
  );

  it("leaves discovery unchanged when the explicit executable is unset", async () => {
    const { options } = runtimeOptions();
    const withoutExplicit = await resolveAfRuntime(options);
    const withUndefined = await resolveAfRuntime({ ...options, explicitExecutable: undefined });

    expect(withUndefined.state).toBe(withoutExplicit.state);
    expect(withUndefined).toMatchObject({ state: "ready" });
  });
});

describe("ready composition descriptor and preflight proof", () => {
  const readyResolution = async (launcher: AfDirectLauncher) => {
    const resolution = await resolveAfRuntime({
      platform: "darwin",
      pathValue: "",
      candidateRoots: AF_DISCOVERY_ROOTS,
      stat: afSeams({ [AF_PATH]: {} }).stat,
      access: afSeams({ [AF_PATH]: {} }).access,
      launcher,
    });
    if (resolution.state !== "ready") throw new Error("expected a ready runtime resolution");
    return resolution;
  };

  it("reaches a ready bridge preflight with fixed direct argv and no grant field", async () => {
    const launcher = new RecordingLauncher();
    const resolution = await readyResolution(launcher);

    const composition = createVibefeldActivation({
      globalStoragePath: GLOBAL_STORAGE,
      repositoryPath: "/host/workspace",
      homePath: "/host/home",
      openCodeStatePath: "/host/state",
      platform: "darwin",
      architecture: "arm64",
      resolveExecutable: resolution.resolveExecutable,
      policy: resolution.policy,
      preflightCwd: PREFLIGHT_CWD,
      idFactory: () => "bound",
      fileSystem: createProofFileSystem(),
    });
    expect(composition.state).toBe("composed");
    if (composition.state !== "composed") return;

    const preflight = await composition.bridge.preflight();

    expect(preflight).toMatchObject({
      state: "ready",
      structuralStatus: null,
      compatibility: { version: "0.1.11", commit: "611291b", format: "1.1", policy: "0.1.9" },
    });
    expect(launcher.calls.map((call) => call.descriptor.argv.slice(1))).toEqual([
      ["version", "--json"],
      ["schema", "--format", "json"],
    ]);
    for (const call of launcher.calls) {
      // Only the three bounded execution fields cross the boundary; the review
      // root is the working directory and is never published as a grant.
      expect(Object.keys(call.descriptor).sort()).toEqual(["argv", "cwd", "executable"]);
      expect(call.descriptor.cwd).toBe(PREFLIGHT_CWD);
      expect(call.options.limits.stdoutBytes).toBeGreaterThan(0);
    }
  });

  it("passes the resolution's direct adapter into an injected executor factory during preflight", async () => {
    const launcher = new RecordingLauncher();
    const resolution = await readyResolution(launcher);
    const allocate = vi.fn(async () => ({ token: "opaque" }));
    const createExecutor = vi.fn(
      (executorOptions: {
        adapter: AfExecutionPolicyAdapter | undefined;
        executable: string;
        workspace: string;
        parsers: AfOutputParserSet;
      }) =>
        createAfProcessExecutor({
          adapter: executorOptions.adapter,
          commandContext: { executable: executorOptions.executable, workspace: executorOptions.workspace },
          parsers: executorOptions.parsers,
        }),
    );
    const bridge = createVibefeldRuntimeBridge({
      platform: "darwin",
      architecture: "arm64",
      resolveExecutable: resolution.resolveExecutable,
      policy: resolution.policy,
      proofStore: {
        allocate,
        resolvePath: vi.fn(() => `${PREFLIGHT_CWD}/review-1`),
        cleanup: vi.fn(async () => ({ ok: true as const })),
      } as unknown as ProofWorkspaceStore,
      preflightCwd: PREFLIGHT_CWD,
      createExecutor,
    });

    await expect(bridge.preflight()).resolves.toMatchObject({ state: "ready" });

    expect(createExecutor).toHaveBeenCalledTimes(2);
    for (const call of createExecutor.mock.calls) {
      expect(call[0].adapter).toBe(resolution.policy);
      expect(call[0]).not.toHaveProperty("readOnlyRuntimeGrants");
      expect(call[0]).not.toHaveProperty("reviewRootWriteGrant");
    }
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(launcher.calls).toHaveLength(2);
  });

  it("keeps the bridge unavailable without a direct adapter and allocates no review root", async () => {
    const launcher = new RecordingLauncher();
    const resolution = await readyResolution(launcher);
    const allocate = vi.fn(async () => ({ token: "opaque" }));
    const bridge = createVibefeldRuntimeBridge({
      platform: "darwin",
      architecture: "arm64",
      resolveExecutable: resolution.resolveExecutable,
      policy: undefined,
      proofStore: {
        allocate,
        resolvePath: vi.fn(() => `${PREFLIGHT_CWD}/review-1`),
        cleanup: vi.fn(async () => ({ ok: true as const })),
      } as unknown as ProofWorkspaceStore,
      preflightCwd: PREFLIGHT_CWD,
    });

    const result = await bridge.preflight();

    expect(result).toMatchObject({ state: "unavailable", reason: "policy-unavailable", diagnostic: "policy" });
    expect(allocate).not.toHaveBeenCalled();
    expect(launcher.calls).toHaveLength(0);
  });
});

describe("resolution security pins", () => {
  const source = readSource("../vibefeld/af-runtime-resolution.ts");

  it("does not reuse the Chat sandbox, add a second confinement layer, or write configuration", () => {
    for (const forbidden of [
      "SandboxManager",
      "chat-sandbox",
      "chat-sandbox-policy",
      "resolveOpenCodePaths",
      "writeFile",
      "mkdir",
      "configuration.update",
      "shell: true",
      "unsandboxed",
      "spawn(",
      "detached",
      "nono",
      "profile",
      "grant",
      "deniedDomain",
      "audit",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('from "./af-discovery"');
    expect(source).toContain('from "./af-direct-policy"');
  });

  it("keeps the real host seams and no process channel in production code", () => {
    expect(source).toContain("options.platform ?? process.platform");
    expect(source).toContain('options.pathValue ?? process.env.PATH ?? ""');
    expect(source).toContain("options.candidateRoots ?? createAfDiscoveryRoots(options.homePath ?? os.homedir())");
    expect(source).toContain("options.stat ?? defaultStat");
    expect(source).toContain("options.access ?? defaultAccess");
    expect(source).toContain("accessSync(candidate, fsConstants.X_OK)");
    expect(source).toContain("metadata.uid === uid");
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("execFile");
  });

  it("never launches AF and has no write, allocation, or resolution-cache path", () => {
    expect(source).not.toMatch(/\b(?:allocate|proofWorkspace|reviewRoot|globalStorage)\b/u);
    expect(source).not.toMatch(/(?:writeFileSync|appendFile|rmSync|unlinkSync|createWriteStream)/u);
    expect(source).not.toMatch(/process\.env\s*=/u);
  });
});
