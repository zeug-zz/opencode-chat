import { lstat, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ambientConfigSourcePaths,
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  runNodeFixture,
  V2_0_32_ISOLATION_CONTRACT,
  V2_1_0_ISOLATION_CONTRACT,
} from "./v2-test-isolation.js";

const isolations: Awaited<ReturnType<typeof createV2TestIsolation>>[] = [];
const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

afterEach(async () => {
  for (const isolation of isolations.splice(0)) await isolation.dispose();
});

async function createIsolation() {
  const isolation = await createV2TestIsolation();
  isolations.push(isolation);
  return isolation;
}

describe("V2 fixture isolation preflight", () => {
  it("separates the static prelaunch gate from unrun runtime evidence", async () => {
    expect(V2_0_32_ISOLATION_CONTRACT).toMatchObject({
      sourceCommit: "843a6c514e606b436a7fe713422ace0a93ad3d61",
      defaultServeReadsServiceConfig: false,
      defaultServeRegistersService: false,
      defaultServePrintsGeneratedPassword: true,
      systemAndManagedDiscoveryCanBeDisabledByCliFlag: false,
      projectDiscoveryFlag: "OPENCODE_CONFIG_PROJECT_DISABLE",
      projectDiscoveryAlias: "OPENCODE_DISABLE_PROJECT_CONFIG",
      modelsFetchDisableFlag: "OPENCODE_DISABLE_MODELS_FETCH",
      claudeDiscoveryDisableFlag: "OPENCODE_DISABLE_CLAUDE_CODE",
    });
    expect(V2_1_0_ISOLATION_CONTRACT).toMatchObject({
      sourceCommit: "60c68d145a14127ce633e26aa5fdfb882a7baa6d",
      sourceCommitMeaning: "inspected-release-tag",
      defaultServeReadsServiceConfig: false,
      defaultServeRegistersService: false,
      defaultServePrintsGeneratedPassword: true,
      systemAndManagedDiscoveryCanBeDisabledByCliFlag: false,
      projectDiscoveryFlag: "OPENCODE_CONFIG_PROJECT_DISABLE",
      projectDiscoveryAlias: "OPENCODE_DISABLE_PROJECT_CONFIG",
      modelsFetchDisableFlag: "OPENCODE_DISABLE_MODELS_FETCH",
      claudeDiscoveryDisableFlag: "OPENCODE_DISABLE_CLAUDE_CODE",
    });
    const isolation = await createIsolation();
    expect(isolation.staticGate.status).toBe(
      isolation.ambientConfigGate.status === "CLEAR" ? "READY_FOR_DISPOSABLE_SPIKE" : "BLOCKED",
    );
    expect(isolation.runtimeEvidence).toBe("NOT_RUN");
    expect(isolation.environment.OPENCODE_DISABLE_MODELS_FETCH).toBe("1");
  });

  it("allows a valid static plan only with clear ambient paths and blocks present or unreadable paths", async () => {
    const isolation = await createIsolation();
    const clear = { status: "CLEAR", presentSourceCount: 0, checkedSourceCount: 3, inspectionErrorCount: 0 } as const;
    expect(evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, clear)).toEqual({
      status: "READY_FOR_DISPOSABLE_SPIKE",
      blockers: [],
    });

    const present = { ...clear, status: "BLOCKED", presentSourceCount: 1 } as const;
    const blockedByPresent = evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, present);
    expect(blockedByPresent.status).toBe("BLOCKED");
    expect(blockedByPresent.blockers.join(" ")).toContain("present");
    const unreadable = await inspectAmbientConfigSources(["fixture-system-source"], async () => {
      throw new Error("unreadable");
    });
    expect(unreadable).toMatchObject({ status: "BLOCKED", inspectionErrorCount: 1 });
    const blockedByUnreadable = evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, unreadable);
    expect(blockedByUnreadable.status).toBe("BLOCKED");
    expect(blockedByUnreadable.blockers.join(" ")).toContain("unreadable");
  });

  it("uses project-local unique roots and an exact non-inherited environment allowlist", async () => {
    const previous = process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL;
    process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL = "must-not-reach-child";
    try {
      const isolation = await createIsolation();
      const project = await realpath(projectRoot);
      expect(isolation.root.startsWith(resolve(project, "tmp/scribe-v2-isolation/run-"))).toBe(true);
      expect(isolation.environment).not.toHaveProperty("OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL");
      expect(isolation.environment).not.toHaveProperty("PATH");
      expect(isolation.paths).toEqual({
        home: join(isolation.root, "home"),
        config: join(isolation.root, "xdg-config"),
        data: join(isolation.root, "xdg-data"),
        cache: join(isolation.root, "xdg-cache"),
        state: join(isolation.root, "xdg-state"),
        database: join(isolation.root, "database.sqlite"),
        serviceState: join(isolation.root, "xdg-state", "opencode"),
        tmp: join(isolation.root, "tmp"),
        cwd: join(isolation.root, "cwd"),
      });
      expect(isolation.runtimeEvidence).toBe("NOT_RUN");
      expect(isolation.ambientConfigGate.checkedSourceCount).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL;
      else process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL = previous;
    }
  });

  it("runs only a bounded Node echo fixture with the allowlisted environment", async () => {
    const isolation = await createIsolation();
    const previousSentinel = process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL;
    const previousSecondarySentinel = process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL_2;
    process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL = "must-not-reach-child";
    process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL_2 = "also-must-not-reach-child";
    try {
      const output = await runNodeFixture(
        isolation,
        "process.stdout.write(JSON.stringify({ home: process.env.HOME, config: process.env.XDG_CONFIG_HOME, data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME, database: process.env.OPENCODE_DB, cwd: process.cwd(), inherited: process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL ?? null, secondaryInherited: process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL_2 ?? null }))",
      );
      expect(JSON.parse(output)).toEqual({
        home: isolation.paths.home,
        config: isolation.paths.config,
        data: isolation.paths.data,
        state: isolation.paths.state,
        database: isolation.paths.database,
        cwd: isolation.paths.cwd,
        inherited: null,
        secondaryInherited: null,
      });
    } finally {
      if (previousSentinel === undefined) delete process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL;
      else process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL = previousSentinel;
      if (previousSecondarySentinel === undefined) delete process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL_2;
      else process.env.OPENCODE_CHAT_ISOLATION_PARENT_SENTINEL_2 = previousSecondarySentinel;
    }
  });

  it("terminates a fixture that exceeds its deadline", async () => {
    const isolation = await createIsolation();
    await expect(runNodeFixture(isolation, "setInterval(() => {}, 1000)", 100)).rejects.toThrow(/bounded runtime/);
  });

  it("reaps a timed-out fixture's descendant process group", async () => {
    const isolation = await createIsolation();
    const fixture = [
      'const { spawn } = require("node:child_process")',
      'const { writeFileSync } = require("node:fs")',
      'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })',
      'writeFileSync("descendant.pid", String(descendant.pid))',
      "setInterval(() => {}, 1000)",
    ].join("; ");
    await expect(runNodeFixture(isolation, fixture, 1_000)).rejects.toThrow(/bounded runtime/);
    const descendantPid = Number(await readFile(join(isolation.paths.cwd, "descendant.pid"), "utf8"));
    let descendantExists = true;
    try {
      process.kill(descendantPid, 0);
    } catch (error) {
      descendantExists = (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
    expect(descendantExists).toBe(false);
  });

  it("has no delayed escalation after a fixture exits normally", async () => {
    const isolation = await createIsolation();
    const kill = vi.spyOn(process, "kill");
    try {
      await expect(runNodeFixture(isolation, 'process.stdout.write("complete")')).resolves.toBe("complete");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      expect(kill.mock.calls.some(([, signal]) => signal === "SIGKILL")).toBe(false);
    } finally {
      kill.mockRestore();
    }
  });

  it("path-only blocks host system/managed roots but never reads their contents", async () => {
    expect(ambientConfigSourcePaths("darwin", undefined, "fixture-user")).toEqual([
      "/Library/Application Support/opencode",
      "/Library/Managed Preferences/fixture-user/ai.opencode.managed.plist",
      "/Library/Managed Preferences/ai.opencode.managed.plist",
    ]);
    expect(ambientConfigSourcePaths("linux")).toEqual(["/etc/opencode"]);
    expect(ambientConfigSourcePaths("win32", "C:\\FixtureData")).toEqual(["C:\\FixtureData\\opencode"]);
    const paths = ambientConfigSourcePaths("darwin", undefined, "fixture-user");
    await expect(inspectAmbientConfigSources(paths, async () => false)).resolves.toMatchObject({
      status: "CLEAR",
      presentSourceCount: 0,
      checkedSourceCount: 3,
    });
    await expect(inspectAmbientConfigSources(paths, async (path) => path === paths[1])).resolves.toMatchObject({
      status: "BLOCKED",
      presentSourceCount: 1,
      checkedSourceCount: 3,
    });
    await expect(
      inspectAmbientConfigSources(paths, async () => Promise.reject(new Error("unreadable"))),
    ).resolves.toMatchObject({
      status: "BLOCKED",
      inspectionErrorCount: 3,
    });
  });

  it("rejects output that exceeds the fixture cap instead of truncating it", async () => {
    const isolation = await createIsolation();
    await expect(runNodeFixture(isolation, 'process.stdout.write("x".repeat(5000))')).rejects.toThrow(/output limit/);
  });

  it("rejects credential-bearing environment entries and non-allowlisted keys", async () => {
    const isolation = await createIsolation();
    expect(() =>
      assertIsolatedEnvironment({ ...isolation.environment, OPENAI_API_KEY: "redacted-test-value" }, isolation.paths),
    ).toThrow(/allowlist/);
    expect(() =>
      assertIsolatedEnvironment(
        { ...isolation.environment, OPENCODE_AUTH_TOKEN: "redacted-test-value" },
        isolation.paths,
      ),
    ).toThrow(/allowlist/);
  });

  it("rejects traversal and symlink escapes", async () => {
    const isolation = await createIsolation();
    await expect(assertOwnedPath(isolation.root, join(isolation.root, "..", "outside"))).rejects.toThrow(/escapes/);
    const external = await mkdtemp(join(resolve(projectRoot, "tmp"), "v2-isolation-outside-"));
    try {
      const link = join(isolation.root, "escape-link");
      await symlink(external, link, "dir");
      await expect(assertOwnedPath(isolation.root, join(link, "child"))).rejects.toThrow(/symlink/);
      const rootLink = join(external, "root-link");
      await symlink(isolation.root, rootLink, "dir");
      await expect(assertOwnedPath(rootLink, rootLink)).rejects.toThrow(/canonical/);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });

  it("refuses disposal after ownership is changed and removes only its owned root", async () => {
    const isolation = await createIsolation();
    const marker = join(isolation.root, ".v2-isolation-owner");
    const original = await readFile(marker, "utf8");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(marker, "not-the-owner");
    await expect(isolation.dispose()).rejects.toThrow(/owner marker/);
    await writeFile(marker, original);
    await isolation.dispose();
    await expect(lstat(isolation.root)).rejects.toMatchObject({ code: "ENOENT" });
    isolations.splice(isolations.indexOf(isolation), 1);
  });
});
