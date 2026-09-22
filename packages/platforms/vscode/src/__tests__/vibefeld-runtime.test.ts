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
import { type AfBridgeOperation, VibefeldRuntimeBridge } from "../vibefeld/vibefeld-runtime";

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

const success = <T>(
  operation: "version" | "schema" | "init" | "claim" | "refine" | "status",
  facts: T,
): AfProcessResult<T> => ({
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

type LiveCaptureOutputs = Readonly<{
  version: string;
  schema: string;
  init?: string;
  claim?: string;
  refine?: string;
  status?: string;
}>;

/** A fake dedicated policy that replays sanitized live captures; it never spawns. */
const createLiveCapturePolicy = (outputs: LiveCaptureOutputs) => {
  const preflightLaunches: Array<AfPreflightDescriptor> = [];
  const launches: Array<AfPolicyDescriptor> = [];
  const stdoutFor = (operation: string | undefined): string | undefined => {
    if (operation === "init") return outputs.init;
    if (operation === "claim") return outputs.claim;
    if (operation === "refine") return outputs.refine;
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
const makeLiveCaptureBridge = (outputs: LiveCaptureOutputs) => {
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

  it("reports the exact frozen claim capability with no preflight, spawn, allocation, or state change", () => {
    const executor = { isInvalidated: false, executePreflight: vi.fn(), execute: vi.fn() };
    const allocate = vi.fn(async () => ({ token: "opaque" }) as never);
    const resolveExecutable = vi.fn(async () => "/private/af");
    const policy = readyPolicy();
    const { bridge, proofStore, createExecutor } = makeBridge(executor, allocate, resolveExecutable, { policy });

    expect(bridge.getState()).toBe("dormant");
    const capability = bridge.getClaimCapability();
    expect(capability).toEqual({ supported: true, operation: "claim_projection" });
    expect(Object.keys(capability).sort()).toEqual(["operation", "supported"]);
    expect(Object.isFrozen(capability)).toBe(true);
    expect(bridge.getClaimCapability()).toBe(capability);
    expect(bridge.getState()).toBe("dormant");

    expect(resolveExecutable).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
    expect(proofStore.resolvePath).not.toHaveBeenCalled();
    expect(proofStore.cleanup).not.toHaveBeenCalled();
    expect(createExecutor).not.toHaveBeenCalled();
    expect(executor.executePreflight).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
    expect(policy.launch).not.toHaveBeenCalled();
    expect(policy.launchPreflight).not.toHaveBeenCalled();
    expect(JSON.stringify(capability)).not.toMatch(/(?:path|version|executable|workspace|error|profile)/iu);
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
        statistics: { totalNodes: 2, totalChallenges: 0, openChallenges: 0 },
        jobs: { proverJobs: 0, verifierJobs: 1 },
        nodeCount: 2,
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
      execute: vi.fn(async (operation: { operation: "init" | "claim" | "refine" | "status" }) =>
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

  it("keeps claim, refine, and status unavailable until init, then returns parsed claim/refine facts", async () => {
    const { bridge, proofStore, launches } = makeLiveCaptureBridge({
      version: live("version.json"),
      schema: live("schema.json"),
      init: live("init.txt"),
      claim: live("claim.json"),
      refine: live("refine.json"),
      status: live("status.json"),
    });
    await bridge.preflight();

    expect(await bridge.run({ operation: "claim", nodeId: "1", role: "prover" })).toEqual({
      state: "ready",
      reason: "operation-not-ready",
      diagnostic: "operation",
      structuralStatus: null,
    });
    expect(await bridge.run({ operation: "refine", parentId: "1", statements: ["bounded"] })).toEqual({
      state: "ready",
      reason: "operation-not-ready",
      diagnostic: "operation",
      structuralStatus: null,
    });
    expect(await bridge.run({ operation: "status" })).toEqual({
      state: "ready",
      reason: "operation-not-ready",
      diagnostic: "operation",
      structuralStatus: null,
    });
    expect(launches).toHaveLength(0);
    expect(proofStore.allocate).toHaveBeenCalledTimes(1);

    const init = await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });
    expect(init).toMatchObject({ state: "ready", facts: { initialized: true }, structuralStatus: null });

    const claim = await bridge.run({ operation: "claim", nodeId: "1", role: "prover" });
    const refine = await bridge.run({ operation: "refine", parentId: "1", statements: ["bounded"] });
    const status = await bridge.run({ operation: "status" });

    expect(claim).toMatchObject({ state: "ready", facts: { nodeId: "1", role: "prover", claimed: true } });
    expect(refine).toMatchObject({ state: "ready", facts: { parentId: "1", childIds: ["1.1"], childCount: 1 } });
    expect(status).toMatchObject({ state: "ready", facts: { nodeCount: 2 } });
    for (const value of [init, claim, refine, status]) {
      expect(value.structuralStatus).toBeNull();
      expectBoundedResult(value, ["/private", "<statement>", "<context>", "capture"]);
    }
    expect(launches.map((descriptor) => descriptor.argv[1])).toEqual(["init", "claim", "refine", "status"]);
  });

  const failingClaim: AfBridgeOperation = { operation: "claim", nodeId: "1", role: "prover" };
  const failingRefine: AfBridgeOperation = { operation: "refine", parentId: "1", statements: ["bounded"] };

  it.each([
    ["claim", failingClaim],
    ["refine", failingRefine],
  ] as const)(
    "maps %s failures to the bounded unavailable result and refuses further work",
    async (_name, operation) => {
      const executor = {
        isInvalidated: false,
        executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
          success(operation, operation === "version" ? version : schema),
        ),
        execute: vi.fn(async (value: { operation: string }) =>
          value.operation === "init"
            ? success("init", { initialized: true })
            : ({
                ok: false,
                classification: { outcome: "unavailable", reason: "non-zero", structuralStatus: null },
                diagnostic: "non-zero",
              } as AfProcessResult),
        ),
      };
      const { bridge } = makeBridge(executor);
      await bridge.preflight();
      await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });

      const failed = await bridge.run(operation);
      expect(failed).toEqual({
        state: "unavailable",
        reason: "non-zero",
        diagnostic: "operation",
        structuralStatus: null,
      });
      expectBoundedResult(failed, ["/private"]);
      expect(await bridge.run(operation)).toEqual({
        state: "unavailable",
        reason: "operation-not-ready",
        diagnostic: "operation",
        structuralStatus: null,
      });
      expect(executor.execute).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ["claim", failingClaim],
    ["refine", failingRefine],
  ] as const)(
    "maps %s audit failures to the bounded audit-failed result and refuses further work",
    async (_name, operation) => {
      const executor = {
        isInvalidated: false,
        executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
          success(operation, operation === "version" ? version : schema),
        ),
        execute: vi.fn(async (value: { operation: string }) =>
          value.operation === "init"
            ? success("init", { initialized: true })
            : ({
                ok: false,
                classification: { outcome: "audit-failed", reason: "audit-failure", structuralStatus: null },
                diagnostic: "cleanup",
              } as AfProcessResult),
        ),
      };
      const { bridge } = makeBridge(executor);
      await bridge.preflight();
      await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });

      const failed = await bridge.run(operation);
      expect(failed).toEqual({
        state: "audit-failed",
        reason: "cleanup-failure",
        diagnostic: "cleanup",
        structuralStatus: null,
      });
      expectBoundedResult(failed, ["/private"]);
      expect(await bridge.run(operation)).toEqual({
        state: "audit-failed",
        reason: "audit-failure",
        diagnostic: "audit",
        structuralStatus: null,
      });
      expect(executor.execute).toHaveBeenCalledTimes(2);
    },
  );

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

  it("reuses the preflight-allocated root until a projection initializes it", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(),
    };
    const { bridge, proofStore, createExecutor } = makeBridge(executor);

    expect(await bridge.beginReview()).toEqual({
      state: "unavailable",
      reason: "operation-not-ready",
      diagnostic: "operation",
      structuralStatus: null,
    });
    expect(proofStore.allocate).not.toHaveBeenCalled();

    await bridge.preflight();
    const review = await bridge.beginReview();
    expect(review).toEqual({ state: "ready", compatibility, structuralStatus: null });
    expectBoundedResult(review, ["/private", "/private/af"]);
    expect(proofStore.allocate).toHaveBeenCalledTimes(1);
    expect(proofStore.resolvePath).toHaveBeenCalledTimes(1);
    expect(proofStore.cleanup).not.toHaveBeenCalled();
    expect(createExecutor).toHaveBeenCalledTimes(2);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("refuses beginReview once the executor is invalidated without touching the workspace", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(),
    };
    const { bridge, proofStore } = makeBridge(executor);
    await bridge.preflight();

    executor.isInvalidated = true;
    expect(await bridge.beginReview()).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expect(proofStore.cleanup).not.toHaveBeenCalled();
    expect(proofStore.allocate).toHaveBeenCalledTimes(1);
  });

  it("rotates to a fresh contained root once a projection initialized the current one", async () => {
    const policy = readyPolicy();
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(async (operation: { operation: "init" | "claim" | "refine" | "status" }) =>
        success(
          operation.operation,
          operation.operation === "init"
            ? { initialized: true as const }
            : { nodeId: "1", role: "prover" as const, claimed: true as const },
        ),
      ),
    };
    let allocations = 0;
    const allocate = vi.fn(async () => {
      allocations += 1;
      return { token: `root-${allocations}` } as never;
    });
    const proofStore = {
      allocate,
      resolvePath: vi.fn((handle: unknown) => `/private/${(handle as { token: string }).token}`),
      cleanup: vi.fn(async () => ({ ok: true as const })),
    };
    const createExecutor = vi.fn(() => executor);
    const bridge = new VibefeldRuntimeBridge({
      platform: "darwin",
      architecture: "arm64",
      resolveExecutable: vi.fn(async () => "/private/af"),
      policy,
      proofStore,
      preflightCwd: "/private/preflight",
      createExecutor,
    });

    await bridge.preflight();
    await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });
    const rotated = await bridge.beginReview();

    expect(rotated).toEqual({ state: "ready", compatibility, structuralStatus: null });
    expectBoundedResult(rotated, ["/private", "/private/af"]);
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(proofStore.cleanup).toHaveBeenCalledWith({ token: "root-1" });
    expect(allocate).toHaveBeenCalledTimes(2);
    expect(proofStore.resolvePath).toHaveBeenLastCalledWith({ token: "root-2" });
    expect(createExecutor).toHaveBeenCalledTimes(3);
    expect(createExecutor.mock.calls.at(-1)?.[0]).toMatchObject({
      adapter: policy,
      executable: "/private/af",
      workspace: "/private/root-2",
    });
    expect(createExecutor.mock.calls.at(-1)?.[0].parsers).toBe(createProductionAfOutputParsers());

    expect(await bridge.run({ operation: "claim", nodeId: "1", role: "prover" })).toEqual({
      state: "ready",
      reason: "operation-not-ready",
      diagnostic: "operation",
      structuralStatus: null,
    });
    const init = await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });
    const claim = await bridge.run({ operation: "claim", nodeId: "1", role: "prover" });
    expect(init).toMatchObject({ state: "ready", facts: { initialized: true }, structuralStatus: null });
    expect(claim).toMatchObject({
      state: "ready",
      facts: { nodeId: "1", role: "prover", claimed: true },
      structuralStatus: null,
    });
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(proofStore.allocate).toHaveBeenCalledTimes(2);
    expect(executor.execute).toHaveBeenCalledTimes(3);
  });

  it("fails closed as audit-failed when rotation cleanup fails and never retries it", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(async () => success("init", { initialized: true })),
    };
    const { bridge, proofStore } = makeBridge(executor);
    await bridge.preflight();
    await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });
    proofStore.cleanup.mockResolvedValue({ ok: false, code: "cleanup-failure" });

    const failed = await bridge.beginReview();
    expect(failed).toEqual({
      state: "audit-failed",
      reason: "cleanup-failure",
      diagnostic: "cleanup",
      structuralStatus: null,
    });
    expectBoundedResult(failed, ["/private", "/private/review-root", "/private/af"]);
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(proofStore.allocate).toHaveBeenCalledTimes(1);

    expect(await bridge.beginReview()).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expect(await bridge.run({ operation: "status" })).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(proofStore.allocate).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed as audit-failed when rotation allocation fails and never allocates again", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(async () => success("init", { initialized: true })),
    };
    let allocations = 0;
    const allocate = vi.fn(async () => {
      allocations += 1;
      if (allocations === 2) throw new Error("raw allocation path detail");
      return { token: "opaque" } as never;
    });
    const { bridge, proofStore } = makeBridge(executor, allocate);
    await bridge.preflight();
    await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });

    const failed = await bridge.beginReview();
    expect(failed).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expectBoundedResult(failed, ["/private", "raw allocation path detail"]);
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(allocate).toHaveBeenCalledTimes(2);

    expect(await bridge.beginReview()).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expect(await bridge.run({ operation: "claim", nodeId: "1", role: "prover" })).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(allocate).toHaveBeenCalledTimes(2);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed as audit-failed when the rotated root cannot be rebound", async () => {
    const executor = {
      isInvalidated: false,
      executePreflight: vi.fn(async ({ operation }: { operation: "version" | "schema" }) =>
        success(operation, operation === "version" ? version : schema),
      ),
      execute: vi.fn(async () => success("init", { initialized: true })),
    };
    const { bridge, proofStore, createExecutor } = makeBridge(executor);
    await bridge.preflight();
    await bridge.run({ operation: "init", conjecture: "bounded", author: "host" });
    createExecutor.mockImplementationOnce(() => {
      throw new Error("raw rebinding failure detail");
    });

    const failed = await bridge.beginReview();
    expect(failed).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expectBoundedResult(failed, ["/private", "raw rebinding failure detail"]);
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(proofStore.allocate).toHaveBeenCalledTimes(2);

    expect(await bridge.beginReview()).toEqual({
      state: "audit-failed",
      reason: "audit-failure",
      diagnostic: "audit",
      structuralStatus: null,
    });
    expect(proofStore.cleanup).toHaveBeenCalledTimes(1);
    expect(proofStore.allocate).toHaveBeenCalledTimes(2);
  });
});
