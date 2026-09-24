import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AfExecutionPolicyAdapter, AfPreflightDescriptor } from "../vibefeld/af-execution-boundary";
import { createVibefeldActivation, teardownVibefeldActivation } from "../vibefeld/vibefeld-activation";

const projectTmpRoot = path.resolve(process.cwd(), "../../../tmp");
/** The sanitized real captures are the live-shape reference for the fake policy below. */
const liveFixture = (name: string) =>
  readFile(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");
const fixtureManifest = () => readFile(new URL("./fixtures/vibefeld/manifest.json", import.meta.url), "utf8");
let testRoot: string | undefined;

type Boundaries = Readonly<{
  globalStoragePath: string;
  repositoryPath: string;
  homePath: string;
  openCodeStatePath: string;
  runtimePath: string;
  preflightPath: string;
  executablePath: string;
}>;

const createBoundaries = async (): Promise<Boundaries> => {
  testRoot = path.join(projectTmpRoot, `vibefeld-activation-${process.pid}-${randomUUID()}`);
  const boundaries = {
    globalStoragePath: path.join(testRoot, "global-storage"),
    repositoryPath: path.join(testRoot, "repository"),
    homePath: path.join(testRoot, "home"),
    openCodeStatePath: path.join(testRoot, "opencode-state"),
    runtimePath: path.join(testRoot, "runtime"),
    preflightPath: path.join(testRoot, "preflight"),
    executablePath: path.join(testRoot, "runtime", "af"),
  } as const;
  await Promise.all(
    [boundaries.globalStoragePath, boundaries.repositoryPath, boundaries.homePath, boundaries.openCodeStatePath].map(
      (boundary) => mkdir(boundary, { recursive: true }),
    ),
  );
  return boundaries;
};

const readiness = { state: "ready" as const, execution: "direct" as const };

const readyPolicy = (): AfExecutionPolicyAdapter => ({
  platform: "darwin",
  readiness,
  launch: vi.fn(),
  launchPreflight: vi.fn(),
  terminateAndReap: vi.fn(),
});

/** Fake policy that replays the sanitized live captures; it never spawns a process. */
const liveCapturePolicy = (outputs: Readonly<{ version: string; schema: string }>) => {
  const reads: string[] = [];
  const adapter: AfExecutionPolicyAdapter = {
    platform: "darwin",
    readiness,
    launch: vi.fn(),
    launchPreflight: async (descriptor: AfPreflightDescriptor) => {
      reads.push(descriptor.argv[1]);
      return {
        outcome: "exited",
        exitCode: 0,
        stdout: descriptor.argv[1] === "version" ? outputs.version : outputs.schema,
      };
    },
    terminateAndReap: vi.fn(),
  };
  return { adapter, reads };
};

const isWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

afterEach(async () => {
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = undefined;
});

describe("Vibefeld activation composition", () => {
  it.each([
    ["an unsupported platform", { platform: "win32" as NodeJS.Platform }, "unsupported-platform"],
    ["an unsupported architecture", { architecture: "riscv64" }, "unsupported-platform"],
    ["an unusable global storage path", { globalStoragePath: "" }, "invalid-host-paths"],
    ["an unusable repository path", { repositoryPath: "" }, "invalid-host-paths"],
    ["a missing executable resolver", { resolveExecutable: undefined }, "missing-executable-resolver"],
    ["a missing policy", { policy: undefined }, "missing-policy"],
  ] as const)("stays dormant with %s and touches no host seam", async (_name, overrides, reason) => {
    const boundaries = await createBoundaries();
    const resolveExecutable = vi.fn(async () => boundaries.executablePath);
    const policy = readyPolicy();
    const fileSystem = {
      lstat: vi.fn(),
      mkdir: vi.fn(),
      realpath: vi.fn(),
      rm: vi.fn(),
      rmdir: vi.fn(),
    };
    const composition = createVibefeldActivation({
      platform: "darwin" as NodeJS.Platform,
      globalStoragePath: boundaries.globalStoragePath,
      repositoryPath: boundaries.repositoryPath,
      homePath: boundaries.homePath,
      openCodeStatePath: boundaries.openCodeStatePath,
      resolveExecutable,
      policy,
      fileSystem,
      ...overrides,
    });

    expect(composition).toEqual({ state: "dormant", reason });
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(policy.launch).not.toHaveBeenCalled();
    expect(policy.launchPreflight).not.toHaveBeenCalled();
    for (const seam of Object.values(fileSystem)) expect(seam).not.toHaveBeenCalled();
  });

  it("composes beneath global storage with no construction-time write, spawn, or resolution", async () => {
    const boundaries = await createBoundaries();
    const resolveExecutable = vi.fn(async () => boundaries.executablePath);
    const policy = readyPolicy();
    const composition = createVibefeldActivation({
      platform: "darwin" as NodeJS.Platform,
      globalStoragePath: boundaries.globalStoragePath,
      repositoryPath: boundaries.repositoryPath,
      homePath: boundaries.homePath,
      openCodeStatePath: boundaries.openCodeStatePath,
      resolveExecutable,
      policy,
      preflightCwd: boundaries.preflightPath,
    });

    expect(composition.state).toBe("composed");
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(policy.launch).not.toHaveBeenCalled();
    expect(policy.launchPreflight).not.toHaveBeenCalled();
    // The proof roots are created lazily; composition alone writes nothing.
    await expect(access(path.join(boundaries.globalStoragePath, "vibefeld"))).rejects.toThrow();
  });

  it("resolves every session root under global storage and never under a protected boundary", async () => {
    const boundaries = await createBoundaries();
    const composition = createVibefeldActivation({
      platform: "darwin" as NodeJS.Platform,
      globalStoragePath: boundaries.globalStoragePath,
      repositoryPath: boundaries.repositoryPath,
      homePath: boundaries.homePath,
      openCodeStatePath: boundaries.openCodeStatePath,
      resolveExecutable: async () => boundaries.executablePath,
      policy: readyPolicy(),
    });
    if (composition.state !== "composed") throw new Error("expected a composed activation");

    const first = await composition.proofStore.allocate();
    const second = await composition.proofStore.allocate();
    const firstRoot = composition.proofStore.resolvePath(first);
    const secondRoot = composition.proofStore.resolvePath(second);
    const reviewsRoot = path.join(boundaries.globalStoragePath, "vibefeld", "reviews");

    expect(isWithin(reviewsRoot, firstRoot)).toBe(true);
    expect(isWithin(reviewsRoot, secondRoot)).toBe(true);
    for (const protectedBoundary of [boundaries.repositoryPath, boundaries.openCodeStatePath]) {
      expect(isWithin(protectedBoundary, firstRoot)).toBe(false);
      expect(isWithin(protectedBoundary, secondRoot)).toBe(false);
    }
    expect(firstRoot).not.toBe(boundaries.homePath);
    expect(isWithin(boundaries.homePath, firstRoot)).toBe(false);
    expect(isWithin(firstRoot, boundaries.homePath)).toBe(false);
    // A review root is never a sibling review root.
    expect(firstRoot).not.toBe(secondRoot);
    expect(isWithin(firstRoot, secondRoot)).toBe(false);
    expect(isWithin(secondRoot, firstRoot)).toBe(false);
    expect((await lstat(firstRoot)).isDirectory()).toBe(true);
    expect((await lstat(secondRoot)).isDirectory()).toBe(true);

    await expect(composition.proofStore.cleanup(first)).resolves.toEqual({ ok: true });
    await expect(composition.proofStore.cleanup(second)).resolves.toEqual({ ok: true });
  });

  it.each(["repositoryPath", "openCodeStatePath"] as const)(
    "fails closed instead of allocating under the protected %s boundary",
    async (boundary) => {
      const boundaries = await createBoundaries();
      const composition = createVibefeldActivation({
        platform: "darwin" as NodeJS.Platform,
        globalStoragePath: path.join(boundaries[boundary], "storage"),
        repositoryPath: boundaries.repositoryPath,
        homePath: boundaries.homePath,
        openCodeStatePath: boundaries.openCodeStatePath,
        resolveExecutable: async () => boundaries.executablePath,
        policy: readyPolicy(),
      });
      if (composition.state !== "composed") throw new Error("expected a composed activation");

      await expect(composition.proofStore.allocate()).rejects.toMatchObject({ code: "containment" });
      const reviewsRoot = path.join(boundaries[boundary], "storage", "vibefeld", "reviews");
      await expect(readdir(reviewsRoot)).resolves.toEqual([]);
    },
  );

  it("consumes the production live parsers during preflight and surfaces only bounded metadata", async () => {
    const boundaries = await createBoundaries();
    const { adapter, reads } = liveCapturePolicy({
      version: await liveFixture("version.json"),
      schema: await liveFixture("schema.json"),
    });
    const composition = createVibefeldActivation({
      platform: "darwin" as NodeJS.Platform,
      globalStoragePath: boundaries.globalStoragePath,
      repositoryPath: boundaries.repositoryPath,
      homePath: boundaries.homePath,
      openCodeStatePath: boundaries.openCodeStatePath,
      resolveExecutable: async () => boundaries.executablePath,
      policy: adapter,
      preflightCwd: boundaries.preflightPath,
    });
    if (composition.state !== "composed") throw new Error("expected a composed activation");

    const result = await composition.bridge.preflight();

    expect(result).toEqual({
      state: "ready",
      compatibility: { version: "0.1.11", commit: "611291b", format: "1.1", policy: "0.1.9" },
      structuralStatus: null,
    });
    expect(reads).toEqual(["version", "schema"]);
    expect(JSON.stringify(result)).not.toContain(boundaries.executablePath);
  });

  it("keeps fixture-shaped live output dormant even when a policy is ready", async () => {
    const boundaries = await createBoundaries();
    const manifest = await fixtureManifest();
    const { adapter } = liveCapturePolicy({ version: manifest, schema: manifest });
    const composition = createVibefeldActivation({
      platform: "darwin" as NodeJS.Platform,
      globalStoragePath: boundaries.globalStoragePath,
      repositoryPath: boundaries.repositoryPath,
      homePath: boundaries.homePath,
      openCodeStatePath: boundaries.openCodeStatePath,
      resolveExecutable: async () => boundaries.executablePath,
      policy: adapter,
      preflightCwd: boundaries.preflightPath,
    });
    if (composition.state !== "composed") throw new Error("expected a composed activation");

    const result = await composition.bridge.preflight();

    expect(result).toMatchObject({ state: "unavailable", reason: "malformed", diagnostic: "preflight" });
    await expect(access(path.join(boundaries.globalStoragePath, "vibefeld"))).rejects.toThrow();
  });

  it("releases the composed review root on teardown and stays inert while dormant", async () => {
    const boundaries = await createBoundaries();
    const { adapter } = liveCapturePolicy({
      version: await liveFixture("version.json"),
      schema: await liveFixture("schema.json"),
    });
    const composition = createVibefeldActivation({
      platform: "darwin" as NodeJS.Platform,
      globalStoragePath: boundaries.globalStoragePath,
      repositoryPath: boundaries.repositoryPath,
      homePath: boundaries.homePath,
      openCodeStatePath: boundaries.openCodeStatePath,
      resolveExecutable: async () => boundaries.executablePath,
      policy: adapter,
      preflightCwd: boundaries.preflightPath,
    });
    if (composition.state !== "composed") throw new Error("expected a composed activation");
    await composition.bridge.preflight();
    const reviewsRoot = path.join(boundaries.globalStoragePath, "vibefeld", "reviews");
    expect((await lstat(reviewsRoot)).isDirectory()).toBe(true);

    await teardownVibefeldActivation(composition);
    await teardownVibefeldActivation(composition);

    const dormant = createVibefeldActivation({
      platform: "darwin" as NodeJS.Platform,
      globalStoragePath: boundaries.globalStoragePath,
      repositoryPath: boundaries.repositoryPath,
      homePath: boundaries.homePath,
      openCodeStatePath: boundaries.openCodeStatePath,
    });
    await expect(teardownVibefeldActivation(dormant)).resolves.toBeUndefined();
  });
});
