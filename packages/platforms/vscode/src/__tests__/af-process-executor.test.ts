import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  AfExecutionPolicyAdapter,
  AfPolicyDescriptor,
  AfPolicyExecutionFact,
  AfPolicyIoLimits,
  AfPreflightDescriptor,
} from "../vibefeld/af-execution-boundary";
import type { AfOutputParserSet } from "../vibefeld/af-parser-mode";
import { AfProcessExecutor, type AfProcessResult } from "../vibefeld/af-process-executor";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/vibefeld/${name}`, import.meta.url), "utf8");

const liveFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");

const closedUnknown = { outcome: "unavailable", reason: "unknown", structuralStatus: null } as const;

const readiness = { state: "ready" as const, execution: "direct" as const };

const createAdapter = (
  fact: AfPolicyExecutionFact,
  cleanup: "reaped" | "failed" = "reaped",
): AfExecutionPolicyAdapter & {
  launches: AfPolicyDescriptor[];
  preflightLaunches: AfPreflightDescriptor[];
  limits?: AfPolicyIoLimits;
} => {
  const launches: AfPolicyDescriptor[] = [];
  const preflightLaunches: AfPreflightDescriptor[] = [];
  return {
    platform: "darwin",
    readiness,
    launches,
    preflightLaunches,
    launch: async (descriptor, _signal, limits) => {
      launches.push(descriptor);
      return { ...fact, ...(limits ? { stderr: fact.stderr } : {}) };
    },
    launchPreflight: async (descriptor, _signal, limits) => {
      preflightLaunches.push(descriptor);
      return { ...fact, ...(limits ? { stderr: fact.stderr } : {}) };
    },
    terminateAndReap: async () => ({ outcome: cleanup }),
  };
};

const options = (adapter: AfExecutionPolicyAdapter) => ({
  adapter,
  commandContext: { executable: "/Applications/af", workspace: "/extension/vibefeld/review" },
});

describe("AF process executor", () => {
  it("uses only the direct descriptor and bounded transport limits", async () => {
    const adapter = createAdapter({ outcome: "exited", exitCode: 0, stdout: fixture("version.json"), stderr: "" });
    const result = await new AfProcessExecutor(options(adapter)).execute({ operation: "version" });
    expect(result).toMatchObject({ ok: true, structuralStatus: null });
    expect(adapter.launches[0]).toEqual({
      executable: "/Applications/af",
      argv: ["/Applications/af", "version", "--json"],
      cwd: "/extension/vibefeld/review",
    });
    expect(Object.keys(adapter.launches[0]).sort()).toEqual(["argv", "cwd", "executable"]);
  });

  it("carries the operation's own working directory into the descriptor", async () => {
    const adapter = createAdapter({ outcome: "exited", exitCode: 0, stdout: "", stderr: "" });
    await new AfProcessExecutor(options(adapter)).execute({ operation: "init", conjecture: "c", author: "a" });
    expect(adapter.launches[0].cwd).toBe("/extension/vibefeld/review");
    expect(adapter.launches[0].argv).toEqual([
      "/Applications/af",
      "init",
      "--conjecture",
      "c",
      "--author",
      "a",
      "--dir",
      "/extension/vibefeld/review",
    ]);
  });

  it("executes the injected claim parser for a claim build", async () => {
    const adapter = createAdapter({ outcome: "exited", exitCode: 0, stdout: liveFixture("claim.json"), stderr: "" });
    const claim = vi.fn(() => ({ ok: true as const, facts: { executed: "claim" }, structuralStatus: null }));
    const unused = vi.fn(() => ({ ok: false as const, failure: closedUnknown }));
    const parsers: AfOutputParserSet = {
      version: unused,
      schema: unused,
      init: unused,
      claim,
      refine: unused,
      status: unused,
    };
    const result = await new AfProcessExecutor({ ...options(adapter), parsers }).execute({
      operation: "claim",
      nodeId: "1",
      role: "prover",
    });
    expect(result).toEqual({ ok: true, operation: "claim", facts: { executed: "claim" }, structuralStatus: null });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    expect(adapter.launches[0].argv[1]).toBe("claim");
  });

  it("executes the injected refine parser for a refine build", async () => {
    const adapter = createAdapter({ outcome: "exited", exitCode: 0, stdout: liveFixture("refine.json"), stderr: "" });
    const refine = vi.fn(() => ({ ok: true as const, facts: { executed: "refine" }, structuralStatus: null }));
    const unused = vi.fn(() => ({ ok: false as const, failure: closedUnknown }));
    const parsers: AfOutputParserSet = {
      version: unused,
      schema: unused,
      init: unused,
      claim: unused,
      refine,
      status: unused,
    };
    const result = await new AfProcessExecutor({ ...options(adapter), parsers }).execute({
      operation: "refine",
      parentId: "1",
      statements: ["statement"],
    });
    expect(result).toEqual({ ok: true, operation: "refine", facts: { executed: "refine" }, structuralStatus: null });
    expect(refine).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    expect(adapter.launches[0].argv[1]).toBe("refine");
  });

  it("preflights version and schema through the same direct descriptor shape", async () => {
    const adapter = createAdapter({ outcome: "exited", exitCode: 0, stdout: fixture("version.json"), stderr: "" });
    await new AfProcessExecutor(options(adapter)).executePreflight({ operation: "version" }, { cwd: "/preflight" });
    expect(adapter.preflightLaunches[0]).toEqual({
      executable: "/Applications/af",
      argv: ["/Applications/af", "version", "--json"],
      cwd: "/preflight",
    });
    expect(adapter.launches).toHaveLength(0);
  });

  it.each([
    ["non-zero", { outcome: "exited", exitCode: 3 }, "non-zero"],
    ["signal", { outcome: "signaled", signal: "SIGTERM" }, "signaled"],
    ["malformed", { outcome: "exited", exitCode: 0, stdout: "not-json" }, "malformed"],
    ["oversized", { outcome: "exited", exitCode: 0, stdout: "x".repeat(40_000) }, "oversized"],
  ] as const)("keeps %s bounded and non-success", async (_name, fact, reason) => {
    const adapter = createAdapter(fact);
    const result = await new AfProcessExecutor(options(adapter)).execute({ operation: "version" });
    expect(result).toMatchObject({
      ok: false,
      classification: { outcome: "unavailable", reason, structuralStatus: null },
    });
    expect(JSON.stringify(result)).not.toContain(fact.stdout ?? "never");
  });

  it.each([
    ["timeout", { outcome: "timed-out" }, "timeout"],
    ["cancellation", { outcome: "cancelled" }, "cancelled"],
  ] as const)("terminates and reaps after %s", async (_name, fact, reason) => {
    const adapter = createAdapter(fact);
    const result = await new AfProcessExecutor(options(adapter)).execute({ operation: "status" });
    expect(result).toMatchObject({
      ok: false,
      classification: { outcome: "unavailable", reason, structuralStatus: null },
    });
  });

  it.each([
    ["claim", { operation: "claim", nodeId: "1", role: "prover" } as const, 5_000],
    ["refine", { operation: "refine", parentId: "1", statements: ["statement"] } as const, 15_000],
  ] as const)("applies the %s per-operation timeout", async (_name, operation, timeout) => {
    vi.useFakeTimers();
    try {
      const adapter = createAdapter({ outcome: "exited", exitCode: 0, stdout: "", stderr: "" });
      adapter.launch = async () => new Promise<never>(() => {});
      const pending: Promise<AfProcessResult> = new AfProcessExecutor(options(adapter)).execute(operation);
      let settled: AfProcessResult | undefined;
      void pending.then((result) => {
        settled = result;
      });
      await vi.advanceTimersByTimeAsync(timeout - 1);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({
        ok: false,
        classification: { outcome: "unavailable", reason: "timeout", structuralStatus: null },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates after cleanup failure and refuses subsequent work", async () => {
    const adapter = createAdapter({ outcome: "timed-out" }, "failed");
    const executor = new AfProcessExecutor(options(adapter));
    const first = await executor.execute({ operation: "status" });
    const second = await executor.execute({ operation: "version" });
    expect(first).toMatchObject({ ok: false, classification: { outcome: "audit-failed", reason: "audit-failure" } });
    expect(second).toMatchObject({ ok: false, classification: { outcome: "audit-failed", reason: "audit-failure" } });
    expect(adapter.launches).toHaveLength(1);
    expect(executor.isInvalidated).toBe(true);
  });

  it("does not retry an unavailable direct-readiness failure through another boundary", async () => {
    const launch = vi.fn();
    const adapter = {
      platform: "darwin" as const,
      readiness: { state: "unavailable" as const },
      launch,
      terminateAndReap: vi.fn(),
    };
    const result = await new AfProcessExecutor(options(adapter)).execute({ operation: "version" });
    expect(result).toMatchObject({ ok: false, classification: { outcome: "audit-failed", reason: "policy-failure" } });
    expect(launch).not.toHaveBeenCalled();
    expect(adapter.terminateAndReap).not.toHaveBeenCalled();
  });

  it("has no process fallback, confinement tool, or grant channel of its own", () => {
    const source = readFileSync(path.resolve(__dirname, "../vibefeld/af-process-executor.ts"), "utf8");
    expect(source).not.toMatch(/nono/iu);
    expect(source).not.toMatch(/\bprofile\b/iu);
    expect(source).not.toMatch(/grant|denied[-_ ]?domain|nested/iu);
    expect(source).not.toMatch(/node:child_process|spawn\s*\(/u);
  });
});
