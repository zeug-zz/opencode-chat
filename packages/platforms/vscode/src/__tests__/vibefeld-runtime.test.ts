import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  AfExecutionPolicyAdapter,
  AfPolicyDescriptor,
  AfPolicyExecutionFact,
  AfPreflightDescriptor,
} from "../vibefeld/af-execution-boundary";
import type { AfLiveSchemaFacts, AfLiveStatusFacts, AfLiveVersionFacts } from "../vibefeld/af-live-output";
import {
  type AfOutputParserSet,
  createAfOutputParsers,
  createProductionAfOutputParsers,
} from "../vibefeld/af-parser-mode";
import type { AfProcessResult } from "../vibefeld/af-process-executor";
import { VibefeldRuntimeBridge } from "../vibefeld/vibefeld-runtime";

const live = (name: string) =>
  readFileSync(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");
const fixtureManifest = readFileSync(new URL("./fixtures/vibefeld/manifest.json", import.meta.url), "utf8");

const readiness = { state: "ready" as const, execution: "direct" as const };

/** Normalized live `af version --json` facts (sanitized capture). */
const version: AfLiveVersionFacts = {
  version: "0.1.11",
  commit: "611291b",
  buildDate: "2026-09-21T00:24:48Z",
  goVersion: "go1.27.1",
  format: "1.1",
  policy: "0.1.9",
};
/** Normalized live `af schema --format json` facts (bounded section counts). */
const schema: AfLiveSchemaFacts = {
  sections: {
    inference_types: 11,
    node_types: 5,
    workflow_states: 3,
    epistemic_states: 7,
    taint_states: 4,
    challenge_targets: 9,
  },
  totalEntries: 39,
};
const compatibility = { version: "0.1.11", commit: "611291b", format: "1.1", policy: "0.1.9" } as const;

const success = <T>(operation: "version" | "schema" | "init" | "status", facts: T): AfProcessResult<T> => ({
  ok: true,
  operation,
  facts,
  structuralStatus: null,
});

const readyPolicy = (): AfExecutionPolicyAdapter => ({
  platform: "darwin",
  readiness,
  launch: vi.fn(),
  launchPreflight: vi.fn(),
  terminateAndReap: vi.fn(),
});

const makeBridge = (
  executor: { executePreflight: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn>; isInvalidated: boolean },
  allocate = vi.fn(async () => ({ token: "opaque" }) as never),
  resolveExecutable: () => string | undefined | Promise<string | undefined> = vi.fn(async () => "/private/af"),
  overrides: Partial<{
    platform: NodeJS.Platform;
    architecture: string;
    policy: AfExecutionPolicyAdapter | undefined;
    parsers: AfOutputParserSet;
  }> = {},
) => {
  const proofStore = {
    allocate,
    resolvePath: vi.fn(() => "/private/review-root"),
    cleanup: vi.fn(async () => ({ ok: true as const })),
  };
  const createExecutor = vi.fn(() => executor);
  return {
    bridge: new VibefeldRuntimeBridge({
      platform: overrides.platform ?? "darwin",
      architecture: (overrides.architecture ?? "arm64") as "arm64" | "x64" | "arm" | "ia32",
      resolveExecutable,
      policy: Object.hasOwn(overrides, "policy") ? overrides.policy : readyPolicy(),
      proofStore,
      ...(overrides.parsers ? { parsers: overrides.parsers } : {}),
      preflightCwd: "/private/preflight",
      createExecutor,
    }),
    proofStore,
    createExecutor,
  };
};

/** A fake dedicated policy that replays sanitized live captures; it never spawns. */
const createLiveCapturePolicy = (
  outputs: Readonly<{ version: string; schema: string; init?: string; status?: string }>,
) => {
  const preflightLaunches: Array<AfPreflightDescriptor> = [];
  const launches: Array<AfPolicyDescriptor> = [];
  const stdoutFor = (operation: string | undefined): string | undefined => {
    if (operation === "init") return outputs.init;
    if (operation === "status") return outputs.status;
    if (operation === "schema") return outputs.schema;
    return outputs.version;
  };
  const adapter: AfExecutionPolicyAdapter = {
    platform: "darwin",
    readiness,
    launch: async (descriptor) => {
      launches.push(descriptor);
      return { outcome: "exited", exitCode: 0, stdout: stdoutFor(descriptor.argv[1]) };
    },
    launchPreflight: async (descriptor) => {
      preflightLaunches.push(descriptor);
      return { outcome: "exited", exitCode: 0, stdout: stdoutFor(descriptor.argv[1]) };
    },
    terminateAndReap: async () => ({ outcome: "reaped" }),
  };
  return { adapter, preflightLaunches, launches };
};

/** Bridge with the real host-private executor and a fake policy; nothing spawns. */
const makeLiveCaptureBridge = (
  outputs: Readonly<{ version: string; schema: string; init?: string; status?: string }>,
) => {
  const { adapter, preflightLaunches, launches } = createLiveCapturePolicy(outputs);
  const proofStore = {
    allocate: vi.fn(async () => ({ token: "opaque" }) as never),
    resolvePath: vi.fn(() => "/private/review-root"),
    cleanup: vi.fn(async () => ({ ok: true as const })),
  };
  const bridge = new VibefeldRuntimeBridge({
    platform: "darwin",
    architecture: "arm64",
    resolveExecutable: async () => "/private/af",
    policy: adapter,
    proofStore,
    preflightCwd: "/private/preflight",
  });
  return { bridge, proofStore, adapter, preflightLaunches, launches };
};

const expectBoundedResult = (value: unknown, forbidden: readonly string[] = []) => {
  expect(value).toMatchObject({ structuralStatus: null });
  const serialized = JSON.stringify(value);
  for (const secret of forbidden) expect(serialized).not.toContain(secret);
  expect(serialized).not.toMatch(/(?:executable|cwd|proof|raw|ledger|source|prompt|reasoning|credential)/iu);
};

describe("Vibefeld runtime bridge", () => {
  it("is dormant until explicit preflight and allocates only after live version/schema", async () => {
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
    const policy = readyPolicy();
    const { bridge } = makeBridge(executor, allocate, resolveExecutable, { policy });

    expect(bridge.getState()).toBe("dormant");
    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
    expect(executor.executePreflight).not.toHaveBeenCalled();
    expect(policy.launch).not.toHaveBeenCalled();
    expect(policy.launchPreflight).not.toHaveBeenCalled();
  });

  it("reaches ready only after live compatibility and returns the host-private metadata", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(),
    };
    const { bridge } = makeBridge(executor);
    const result = await bridge.preflight();

    expect(result).toEqual({ state: "ready", compatibility, structuralStatus: null });
    expectBoundedResult(result, ["/private"]);
  });

  it("uses the production live parsers by default and forwards injected parsers to the executor seam", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(),
    };
    const { bridge, createExecutor } = makeBridge(executor);
    await bridge.preflight();
    expect(createExecutor.mock.calls.at(-1)?.[0].parsers).toBe(createProductionAfOutputParsers());

    const injected = createAfOutputParsers("fixture");
    if (!injected) throw new Error("expected the fixture test double");
    const second = makeBridge(executor, undefined, undefined, { parsers: injected });
    await second.bridge.preflight();
    expect(second.createExecutor.mock.calls.at(-1)?.[0].parsers).toBe(injected);
    expect(createExecutor.mock.calls.at(-1)?.[0].parsers).not.toBe(injected);
  });

  it("parses sanitized live captures through the production parsers and never exposes raw output", async () => {
    const { bridge, proofStore, preflightLaunches } = makeLiveCaptureBridge({
      version: live("version.json"),
      schema: live("schema.json"),
      init: live("init.txt"),
      status: live("status.json"),
    });
    const result = await bridge.preflight();

    expect(result).toEqual({ state: "ready", compatibility, structuralStatus: null });
    expect(preflightLaunches.map((descriptor) => descriptor.argv.slice(1))).toEqual([
      ["version", "--json"],
      ["schema", "--format", "json"],
    ]);
    expect(
      preflightLaunches.every((descriptor) => Object.keys(descriptor).sort().join(",") === "argv,cwd,executable"),
    ).toBe(true);

    const init = await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });
    expect(init).toMatchObject({ state: "ready", facts: { initialized: true }, compatibility });
    const status = await bridge.run({ operation: "status" });
    expect(status).toMatchObject({
      state: "ready",
      facts: {
        statistics: { totalNodes: 1, totalChallenges: 0, openChallenges: 0 },
        jobs: { proverJobs: 0, verifierJobs: 1 },
        nodeCount: 1,
      },
    });
    expect(proofStore.allocate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([result, init, status])).not.toContain("All primes");
    expect(JSON.stringify([result, init, status])).not.toContain("/private");
    expect(JSON.stringify([result, init, status])).not.toMatch(/(?:workspace|path|raw|stdout)/iu);
  });

  it("keeps fixture-shaped live evidence dormant and never allocates a root", async () => {
    const { bridge, proofStore, preflightLaunches } = makeLiveCaptureBridge({
      version: fixtureManifest,
      schema: fixtureManifest,
    });
    const result = await bridge.preflight();

    expect(result).toMatchObject({ state: "unavailable", reason: "malformed", diagnostic: "preflight" });
    expect(proofStore.allocate).not.toHaveBeenCalled();
    expect(preflightLaunches).toHaveLength(1);
    expectBoundedResult(result, ["/private", "af-runtime-fixture"]);
  });

  it("does not allocate a root when live compatibility fails", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? { ...version, version: "0.2.0" } : schema),
      ),
      execute: vi.fn(),
    };
    const { bridge, proofStore } = makeBridge(executor);
    const result = await bridge.preflight();
    expect(result).toMatchObject({ state: "incompatible", reason: "runtime-mismatch", structuralStatus: null });
    expect(proofStore.allocate).not.toHaveBeenCalled();
  });

  it("rejects a non-1.1 format and missing fields before root allocation", async () => {
    const formatMismatch = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? { ...version, format: "2.0" } : schema),
      ),
      execute: vi.fn(),
    };
    const first = makeBridge(formatMismatch);
    expect(await first.bridge.preflight()).toMatchObject({ state: "incompatible", reason: "runtime-mismatch" });
    expect(first.proofStore.allocate).not.toHaveBeenCalled();

    const missingField = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? { ...version, policy: undefined } : schema),
      ),
      execute: vi.fn(),
    };
    const second = makeBridge(missingField);
    const missingFieldResult = await second.bridge.preflight();
    expect(missingFieldResult).toMatchObject({
      state: "unavailable",
      reason: "malformed",
      diagnostic: "preflight",
    });
    expect(second.proofStore.allocate).not.toHaveBeenCalled();
    expectBoundedResult(missingFieldResult, ["/private"]);
  });

  it.each([
    ["unsupported platform", { platform: "win32" as NodeJS.Platform }, "unsupported-platform"],
    ["unsupported architecture", { architecture: "riscv64" }, "unsupported-platform"],
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
    const initFacts = { initialized: true } as const;
    const statusFacts: AfLiveStatusFacts = {
      statistics: { totalNodes: 0, totalChallenges: 0, openChallenges: 0 },
      jobs: { proverJobs: 0, verifierJobs: 0 },
      nodeCount: 0,
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
      execute: vi.fn(async () => success("init", { initialized: true })),
    };
    const createExecutor = vi.fn(() => executor);
    const proofStore = {
      allocate: vi.fn(async () => ({ token: "opaque-root-handle" }) as never),
      resolvePath: vi.fn(() => "/private/review-root"),
      cleanup: vi.fn(async () => ({ ok: true as const })),
    };
    const bridge = new VibefeldRuntimeBridge({
      platform: "darwin",
      architecture: "arm64",
      resolveExecutable: vi.fn(async () => "/private/af"),
      policy: readyPolicy(),
      proofStore,
      preflightCwd: "/private/preflight",
      createExecutor,
    });
    await bridge.preflight();
    expect(createExecutor).toHaveBeenCalledTimes(2);
    expect(createExecutor.mock.calls.at(-1)?.[0]).toMatchObject({ workspace: "/private/review-root" });
    expect(createExecutor.mock.calls.at(-1)?.[0]).not.toHaveProperty("reviewRootWriteGrant");
    expect(createExecutor.mock.calls.at(-1)?.[0]).not.toHaveProperty("readOnlyRuntimeGrants");
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
