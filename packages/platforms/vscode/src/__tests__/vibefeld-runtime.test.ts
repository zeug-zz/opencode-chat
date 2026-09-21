import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AfExecutionPolicyAdapter } from "../vibefeld/af-execution-boundary";
import type { AfProcessResult } from "../vibefeld/af-process-executor";
import { VibefeldRuntimeBridge } from "../vibefeld/vibefeld-runtime";

const fixture = readFileSync(new URL("./fixtures/vibefeld/manifest.json", import.meta.url), "utf8");
const readiness = {
  state: "ready" as const,
  descendantConfinement: "inherited" as const,
  childExecution: "deny-unapproved" as const,
  deniedDomains: "enforced" as const,
  audit: "verified" as const,
};

const version = {
  fixtureSchema: "af-runtime-fixture-1" as const,
  runtime: {
    executableName: "af" as const,
    version: "0.1.7" as const,
    commit: "5a37413" as const,
    buildDate: "2026-09-08T02:25:39Z" as const,
    goVersion: "go1.27.1" as const,
  },
  operatingSystem: "darwin" as const,
  architecture: "arm64" as const,
};
const schema = {
  fixtureSchema: "af-runtime-fixture-1" as const,
  workspaceFormat: "1.0" as const,
  schemaKeys: [] as never[],
};

const success = <T>(operation: "version" | "schema" | "init" | "status", facts: T): AfProcessResult<T> => ({
  ok: true,
  operation,
  facts,
  structuralStatus: null,
});

const makeBridge = (
  executor: { executePreflight: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn>; isInvalidated: boolean },
  allocate = vi.fn(async () => ({ token: "opaque" }) as never),
  resolveExecutable: () => string | undefined | Promise<string | undefined> = vi.fn(async () => "/private/af"),
  overrides: Partial<{
    fixtureJson: string;
    platform: NodeJS.Platform;
    architecture: "arm64" | "x64" | "arm" | "ia32";
    policy: AfExecutionPolicyAdapter | undefined;
  }> = {},
) => {
  const proofStore = {
    allocate,
    resolvePath: vi.fn(() => "/private/review-root"),
    cleanup: vi.fn(async () => ({ ok: true as const })),
  };
  const policy: AfExecutionPolicyAdapter = {
    platform: "darwin",
    readiness,
    launch: vi.fn(),
    launchPreflight: vi.fn(),
    terminateAndReap: vi.fn(),
  };
  return {
    bridge: new VibefeldRuntimeBridge({
      fixtureJson: overrides.fixtureJson ?? fixture,
      platform: overrides.platform ?? "darwin",
      architecture: overrides.architecture ?? "arm64",
      resolveExecutable,
      policy: Object.hasOwn(overrides, "policy") ? overrides.policy : policy,
      proofStore,
      readOnlyRuntimeGrants: [{ path: "/private/runtime" }],
      preflightCwd: "/private/preflight",
      createExecutor: vi.fn(() => executor),
    }),
    proofStore,
  };
};

const expectBoundedResult = (value: unknown, forbidden: readonly string[] = []) => {
  expect(value).toMatchObject({ structuralStatus: null });
  const serialized = JSON.stringify(value);
  for (const secret of forbidden) expect(serialized).not.toContain(secret);
  expect(serialized).not.toMatch(/(?:executable|cwd|proof|raw|ledger|source|prompt|reasoning|credential)/iu);
};

describe("Vibefeld runtime bridge", () => {
  it("is dormant until explicit preflight and allocates only after version/schema", async () => {
    const events: string[] = [];
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) => {
        events.push(operation);
        return success(operation, operation === "version" ? version : schema);
      }),
      execute: vi.fn(),
    };
    const allocate = vi.fn(async () => {
      events.push("allocate");
      return { token: "opaque" } as never;
    });
    const { bridge } = makeBridge(executor, allocate);
    expect(bridge.getState()).toBe("dormant");
    expect(allocate).not.toHaveBeenCalled();
    const result = await bridge.preflight();
    expect(result).toMatchObject({ state: "ready", structuralStatus: null });
    expect(events).toEqual(["version", "schema", "allocate"]);
  });

  it("does no constructor-time resolution, policy launch, process, root, config, or Chat sandbox work", () => {
    const executor = { isInvalidated: false, executePreflight: vi.fn(), execute: vi.fn() };
    const allocate = vi.fn();
    const resolveExecutable = vi.fn(async () => "/private/af");
    const policy: AfExecutionPolicyAdapter = {
      platform: "darwin",
      readiness,
      launch: vi.fn(),
      launchPreflight: vi.fn(),
      terminateAndReap: vi.fn(),
    };
    const { bridge } = makeBridge(executor, allocate, resolveExecutable, { policy });

    expect(bridge.getState()).toBe("dormant");
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
    expect(executor.executePreflight).not.toHaveBeenCalled();
    expect(policy.launch).not.toHaveBeenCalled();
    expect(policy.launchPreflight).not.toHaveBeenCalled();
  });

  it("reaches ready only after pinned version and schema validation", async () => {
    const events: string[] = [];
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) => {
        events.push(operation);
        return success(operation, operation === "version" ? version : schema);
      }),
      execute: vi.fn(),
    };
    const { bridge } = makeBridge(executor);
    const result = await bridge.preflight();

    expect(events).toEqual(["version", "schema"]);
    expect(result).toEqual({
      state: "ready",
      compatibility: {
        fixtureSchema: "af-runtime-fixture-1",
        version: "0.1.7",
        commit: "5a37413",
        workspaceFormat: "1.0",
      },
      structuralStatus: null,
    });
    expectBoundedResult(result, ["/private"]);
  });

  it("does not allocate a root when compatibility fails", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async () => success("version", { ...version, architecture: "x64" })),
      execute: vi.fn(),
    };
    const { bridge, proofStore } = makeBridge(executor);
    const result = await bridge.preflight();
    expect(result).toMatchObject({ state: "incompatible", reason: "runtime-mismatch", structuralStatus: null });
    expect(proofStore.allocate).not.toHaveBeenCalled();
  });

  it("rejects a schema workspace-format mismatch before root allocation", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : { ...schema, workspaceFormat: "2.0" }),
      ),
      execute: vi.fn(),
    };
    const { bridge, proofStore } = makeBridge(executor);
    const result = await bridge.preflight();

    expect(result).toMatchObject({ state: "incompatible", reason: "runtime-mismatch", structuralStatus: null });
    expect(proofStore.allocate).not.toHaveBeenCalled();
    expectBoundedResult(result, ["/private"]);
  });

  it.each([["malformed fixture", "{", "fixture-invalid"]])(
    "returns bounded incompatibility for %s",
    async (_name, fixtureJson, reason) => {
      const executor = { isInvalidated: false, executePreflight: vi.fn(), execute: vi.fn() };
      const { bridge, proofStore } = makeBridge(executor, undefined, undefined, { fixtureJson });
      const result = await bridge.preflight();

      expect(result).toMatchObject({ state: "incompatible", reason, structuralStatus: null });
      expect(proofStore.allocate).not.toHaveBeenCalled();
      expect(executor.executePreflight).not.toHaveBeenCalled();
      expectBoundedResult(result, ["/private"]);
    },
  );

  it.each([
    ["unsupported platform", { platform: "win32" as NodeJS.Platform }, "unsupported-platform"],
    ["missing policy", { policy: undefined }, "policy-unavailable"],
    [
      "ambiguous policy",
      {
        policy: {
          platform: "darwin",
          readiness: { state: "ambiguous" as const },
          launch: vi.fn(),
          terminateAndReap: vi.fn(),
        },
      },
      "policy-unavailable",
    ],
  ])("fails closed for %s without fallback", async (_name, overrides, reason) => {
    const executor = { isInvalidated: false, executePreflight: vi.fn(), execute: vi.fn() };
    const resolveExecutable = vi.fn(async () => "/private/af");
    const { bridge, proofStore } = makeBridge(executor, undefined, resolveExecutable, overrides);
    const result = await bridge.preflight();

    expect(result).toMatchObject({ state: "unavailable", reason, structuralStatus: null });
    expect(proofStore.allocate).not.toHaveBeenCalled();
    expect(executor.executePreflight).not.toHaveBeenCalled();
    expectBoundedResult(result, ["/private", "Chat"]);
  });

  it("does not preflight or allocate when executable resolution is missing", async () => {
    const executor = { isInvalidated: false, executePreflight: vi.fn(), execute: vi.fn() };
    const { bridge, proofStore } = makeBridge(
      executor,
      undefined,
      vi.fn(async () => undefined),
    );
    const result = await bridge.preflight();

    expect(result).toMatchObject({ state: "unavailable", reason: "missing-executable", structuralStatus: null });
    expect(proofStore.allocate).not.toHaveBeenCalled();
    expect(executor.executePreflight).not.toHaveBeenCalled();
  });

  it.each([
    ["non-zero", "non-zero"],
    ["malformed", "malformed"],
    ["oversized", "oversized"],
    ["timeout", "timeout"],
    ["signal", "signal"],
  ])("does not allocate a root after %s preflight failure", async (_name, diagnostic) => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(
        async () =>
          ({
            ok: false,
            classification: { outcome: "unavailable", reason: diagnostic, structuralStatus: null },
            diagnostic,
          }) as AfProcessResult,
      ),
      execute: vi.fn(),
    };
    const { bridge, proofStore } = makeBridge(executor);
    const result = await bridge.preflight();

    expect(result).toMatchObject({ state: "unavailable", reason: diagnostic, structuralStatus: null });
    expect(proofStore.allocate).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
    expectBoundedResult(result, ["/private"]);
  });

  it("returns a typed redacted unavailable result when executable resolution rejects", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(),
      execute: vi.fn(),
    };
    const allocate = vi.fn(async () => ({ token: "opaque" }) as never);
    const { bridge } = makeBridge(executor, allocate, async () => {
      throw new Error("raw resolver path and details");
    });
    const result = await bridge.preflight();
    expect(result).toEqual({
      state: "unavailable",
      reason: "missing-executable",
      diagnostic: "executable",
      structuralStatus: null,
    });
    expect(allocate).not.toHaveBeenCalled();
    expect(executor.executePreflight).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("raw resolver path");
  });

  it("returns normalized redacted facts and refuses work after audit invalidation", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(
        async () =>
          ({
            ok: false,
            classification: { outcome: "audit-failed", reason: "audit-failure", structuralStatus: null },
            diagnostic: "cleanup",
          }) as AfProcessResult,
      ),
    };
    const { bridge } = makeBridge(executor);
    await bridge.preflight();
    const first = await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });
    expect(first).toMatchObject({ state: "audit-failed", reason: "cleanup-failure", structuralStatus: null });
    expect(JSON.stringify(first)).not.toContain("/private");
    const second = await bridge.run({ operation: "status" });
    expect(second).toMatchObject({ state: "audit-failed", reason: "audit-failure", structuralStatus: null });
  });

  it("rejects status before init and returns ready-running-ready for init then status", async () => {
    const initFacts = {
      fixtureSchema: "af-runtime-fixture-1" as const,
      workspaceFormat: "1.0" as const,
      entryCount: 1,
      directoryCount: 1,
      fileCount: 0,
    };
    const statusFacts = {
      fixtureSchema: "af-runtime-fixture-1" as const,
      workspaceFormat: "1.0" as const,
      rootState: "pending" as const,
      rootResolution: "unresolved" as const,
      statistics: { totalNodes: 0, pendingNodes: 0, unresolvedNodes: 0, totalChallenges: 0, openChallenges: 0 },
      jobs: { proverJobs: 0, verifierJobs: 0 },
      nodeCount: 0,
      challengeCount: 0,
    };
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(async (operation: { operation: "init" | "status" }) =>
        success(operation.operation, operation.operation === "init" ? initFacts : statusFacts),
      ),
    };
    const { bridge } = makeBridge(executor);
    await bridge.preflight();
    expect(await bridge.run({ operation: "status" })).toMatchObject({ state: "ready", reason: "operation-not-ready" });
    expect(await bridge.run({ operation: "init", conjecture: "bounded", author: "host" })).toMatchObject({
      state: "ready",
      facts: initFacts,
      structuralStatus: null,
    });
    expect(bridge.getState()).toBe("ready");
    const status = await bridge.run({ operation: "status" });
    expect(status).toMatchObject({ state: "ready", facts: statusFacts, structuralStatus: null });
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expectBoundedResult(status, ["/private"]);
  });

  it("passes only the allocated root to the private executor and never returns that path", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(async () =>
        success("init", {
          fixtureSchema: "af-runtime-fixture-1",
          workspaceFormat: "1.0",
          entryCount: 0,
          directoryCount: 0,
          fileCount: 0,
        }),
      ),
    };
    const createExecutor = vi.fn(() => executor);
    const proofStore = {
      allocate: vi.fn(async () => ({ token: "opaque-root-handle" }) as never),
      resolvePath: vi.fn(() => "/private/review-root"),
      cleanup: vi.fn(async () => ({ ok: true as const })),
    };
    const bridge = new VibefeldRuntimeBridge({
      fixtureJson: fixture,
      platform: "darwin",
      architecture: "arm64",
      resolveExecutable: vi.fn(async () => "/private/af"),
      policy: { platform: "darwin", readiness, launch: vi.fn(), launchPreflight: vi.fn(), terminateAndReap: vi.fn() },
      proofStore,
      readOnlyRuntimeGrants: [{ path: "/private/runtime" }],
      preflightCwd: "/private/preflight",
      createExecutor,
    });
    await bridge.preflight();
    expect(createExecutor).toHaveBeenCalledTimes(2);
    expect(createExecutor.mock.calls.at(-1)?.[0]).toMatchObject({
      workspace: "/private/review-root",
      reviewRootWriteGrant: { path: "/private/review-root" },
    });
    expectBoundedResult(await bridge.run({ operation: "init", conjecture: "c", author: "a" }), [
      "/private/review-root",
      "/private/af",
    ]);
  });

  it("classifies cancellation as audit failure and refuses subsequent work without fallback", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(
        async () =>
          ({
            ok: false,
            classification: { outcome: "audit-failed", reason: "cancelled", structuralStatus: null },
            diagnostic: "cancelled",
          }) as AfProcessResult,
      ),
    };
    const { bridge } = makeBridge(executor);
    await bridge.preflight();
    const result = await bridge.run({ operation: "init", conjecture: "c", author: "a" }, new AbortController().signal);
    expect(result).toMatchObject({ state: "audit-failed", reason: "audit-failure", structuralStatus: null });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(await bridge.run({ operation: "init", conjecture: "c", author: "a" })).toMatchObject({
      state: "audit-failed",
    });
    expectBoundedResult(result, ["/private", "Chat", "unsandboxed"]);
  });

  it("tears down once on success and fails closed on cleanup failure", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(),
    };
    const { bridge, proofStore } = makeBridge(executor);
    await bridge.preflight();
    expect(await bridge.teardown()).toEqual({ state: "unavailable", structuralStatus: null });
    expect(await bridge.teardown()).toEqual({ state: "unavailable", structuralStatus: null });
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(await bridge.run({ operation: "init", conjecture: "c", author: "a" })).toMatchObject({
      state: "unavailable",
    });
    const failing = makeBridge(executor);
    failing.proofStore.cleanup.mockResolvedValue({ ok: false, code: "cleanup-failure" });
    await failing.bridge.preflight();
    const teardown = await failing.bridge.teardown();
    expect(teardown).toMatchObject({ state: "audit-failed", reason: "cleanup-failure", structuralStatus: null });
    expect(await failing.bridge.run({ operation: "status" })).toMatchObject({ state: "audit-failed" });
    expectBoundedResult(teardown, ["/private"]);
  });
});
