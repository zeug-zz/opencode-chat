import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProofWorkspaceFileSystem, ProofWorkspaceStore } from "../vibefeld/proof-workspace-store";

const projectTmpRoot = path.resolve(process.cwd(), "../../../tmp");
let testRoot: string | undefined;

const createBoundaries = async () => {
  testRoot = path.join(projectTmpRoot, `proof-workspace-store-${process.pid}-${randomUUID()}`);
  await mkdir(testRoot, { recursive: true });

  const boundaries = {
    globalStoragePath: path.join(testRoot, "global-storage"),
    repositoryPath: path.join(testRoot, "repository"),
    homePath: path.join(testRoot, "home"),
    openCodeStatePath: path.join(testRoot, "opencode-state"),
  } as const;
  await Promise.all(Object.values(boundaries).map((boundary) => mkdir(boundary, { recursive: true })));
  return boundaries;
};

const createStore = async (overrides: Partial<ConstructorParameters<typeof ProofWorkspaceStore>[0]> = {}) =>
  new ProofWorkspaceStore({ ...(await createBoundaries()), ...overrides });

afterEach(async () => {
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = undefined;
});

describe("ProofWorkspaceStore", () => {
  it("allocates unique session/review roots below project-local storage and exposes only an opaque handle", async () => {
    const boundaries = await createBoundaries();
    const store = new ProofWorkspaceStore(boundaries);
    const first = await store.allocate();
    const second = await store.allocate();
    const firstPath = store.resolvePath(first);
    const secondPath = store.resolvePath(second);

    expect(first).not.toHaveProperty("sessionPath");
    expect(first).not.toHaveProperty("reviewPath");
    expect(firstPath).not.toContain("repository");
    expect(firstPath).not.toContain("opencode-state");
    expect(firstPath).not.toBe(secondPath);
    expect(path.relative(path.join(boundaries.globalStoragePath, "vibefeld", "reviews"), firstPath)).not.toMatch(
      /^\.\./,
    );
    expect((await lstat(firstPath)).isDirectory()).toBe(true);
    expect((await lstat(secondPath)).isDirectory()).toBe(true);

    expect(await store.cleanup(first)).toEqual({ ok: true });
    expect(() => store.resolvePath(first)).toThrow(/not recognized/);
    expect((await lstat(secondPath)).isDirectory()).toBe(true);
    expect(await store.cleanup(second)).toEqual({ ok: true });
  });

  it("allows global storage beneath home while keeping protected boundary roots untouched", async () => {
    const boundaries = await createBoundaries();
    const globalStoragePath = path.join(boundaries.homePath, ".vscode", "global-storage");
    const sentinel = path.join(boundaries.homePath, "home-sentinel.txt");
    await writeFile(sentinel, "do not modify");
    const store = new ProofWorkspaceStore({ ...boundaries, globalStoragePath });
    const handle = await store.allocate();

    expect(store.resolvePath(handle)).toContain(path.join("home", ".vscode", "global-storage", "vibefeld", "reviews"));
    expect(await readFile(sentinel, "utf8")).toBe("do not modify");
    expect(await store.cleanup(handle)).toEqual({ ok: true });
    expect(await readFile(sentinel, "utf8")).toBe("do not modify");
  });

  it.each(["repositoryPath", "openCodeStatePath"] as const)(
    "rejects a review root overlapping the protected %s boundary",
    async (boundary) => {
      const boundaries = await createBoundaries();
      const store = new ProofWorkspaceStore({
        ...boundaries,
        globalStoragePath: path.join(boundaries[boundary], "storage"),
      });

      await expect(store.allocate()).rejects.toMatchObject({ code: "containment" });
    },
  );

  it.each(["..", "../escape", "/absolute", "nested/name", "nested\\name", "", "x".repeat(65)])(
    "rejects malformed or traversal-prone bounded identifier %j before allocation",
    async (identifier) => {
      const store = await createStore({ idFactory: () => identifier });

      await expect(store.allocate()).rejects.toMatchObject({ code: "unsafe-path" });
      expect(testRoot).toBeDefined();
      expect((await lstat(testRoot as string)).isDirectory()).toBe(true);
    },
  );

  it("rejects a symlinked global-storage root or ancestor before creating a review root", async () => {
    const boundaries = await createBoundaries();
    const target = path.join(testRoot as string, "real-storage");
    const linkedRoot = path.join(testRoot as string, "linked-storage");
    await mkdir(target, { recursive: true });
    await symlink(target, linkedRoot, "dir");

    const store = new ProofWorkspaceStore({ ...boundaries, globalStoragePath: linkedRoot });
    await expect(store.allocate()).rejects.toMatchObject({ code: "symlink" });
    await expect(access(path.join(target, "vibefeld"))).rejects.toThrow();
  });

  it("rejects a renamed or redirected review root without following or deleting the escape target", async () => {
    const store = await createStore();
    const handle = await store.allocate();
    const ownedPath = store.resolvePath(handle);
    const escapeTarget = path.join(testRoot as string, "escape-target");
    await mkdir(escapeTarget, { recursive: true });
    const marker = path.join(escapeTarget, "marker.txt");
    await writeFile(marker, "keep me");
    await rename(ownedPath, path.join(testRoot as string, "renamed-review"));
    await symlink(escapeTarget, ownedPath, "dir");

    await expect(store.cleanup(handle)).resolves.toEqual({ ok: false, code: "cleanup-failure" });
    expect(await readFile(marker, "utf8")).toBe("keep me");
    expect((await lstat(ownedPath)).isSymbolicLink()).toBe(true);
  });

  it("returns bounded cleanup failure without deleting the owned root when removal fails", async () => {
    const failingRm = vi.fn(async (_target: string, _options: Parameters<typeof rm>[1]) => {
      throw new Error("simulated cleanup failure with untrusted details");
    });
    const fileSystem: ProofWorkspaceFileSystem = { lstat, mkdir, realpath, rm: failingRm, rmdir };
    const store = await createStore({ fileSystem });
    const handle = await store.allocate();
    const reviewPath = store.resolvePath(handle);
    const marker = path.join(reviewPath, "only-test-state.txt");
    await writeFile(marker, "disposable state");

    await expect(store.cleanup(handle)).resolves.toEqual({ ok: false, code: "cleanup-failure" });
    expect(failingRm).toHaveBeenCalledTimes(1);
    expect(await readFile(marker, "utf8")).toBe("disposable state");
    expect(store.resolvePath(handle)).toBe(reviewPath);
  });

  it("does not persist source packets, prompts, credentials, reasoning, or child logs", async () => {
    const store = await createStore();
    const handle = await store.allocate();
    const reviewPath = store.resolvePath(handle);

    await expect(readdir(reviewPath)).resolves.toEqual([]);
    expect(Object.keys(handle)).toEqual(["token"]);
    expect(JSON.stringify(handle)).not.toMatch(/source|prompt|credential|reasoning|log|workspacePath/);
    await store.cleanup(handle);
  });
});
