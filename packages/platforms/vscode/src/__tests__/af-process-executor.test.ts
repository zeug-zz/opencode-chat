import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  AfExecutionPolicyAdapter,
  AfPolicyDescriptor,
  AfPolicyExecutionFact,
  AfPolicyIoLimits,
} from "../vibefeld/af-execution-boundary";
import { AfProcessExecutor } from "../vibefeld/af-process-executor";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/vibefeld/${name}`, import.meta.url), "utf8");

const readiness = {
  state: "ready" as const,
  descendantConfinement: "inherited" as const,
  childExecution: "deny-unapproved" as const,
  deniedDomains: "enforced" as const,
  audit: "verified" as const,
};

const createAdapter = (
  fact: AfPolicyExecutionFact,
  cleanup: "reaped" | "failed" = "reaped",
): AfExecutionPolicyAdapter & { launches: AfPolicyDescriptor[]; limits?: AfPolicyIoLimits } => {
  const launches: AfPolicyDescriptor[] = [];
  return {
    platform: "darwin",
    readiness,
    launches,
    launch: async (descriptor, _signal, limits) => {
      launches.push(descriptor);
      return { ...fact, ...(limits ? { stderr: fact.stderr } : {}) };
    },
    terminateAndReap: async () => ({ outcome: cleanup }),
  };
};

const options = (adapter: AfExecutionPolicyAdapter) => ({
  adapter,
  commandContext: { executable: "/Applications/af", workspace: "/extension/vibefeld/review" },
  readOnlyRuntimeGrants: [{ path: "/Applications/runtime" }],
  reviewRootWriteGrant: { path: "/extension/vibefeld/review" },
});

describe("AF process executor", () => {
  it("uses only the dedicated descriptor and bounded transport limits", async () => {
    const adapter = createAdapter({ outcome: "exited", exitCode: 0, stdout: fixture("version.json"), stderr: "" });
    const result = await new AfProcessExecutor(options(adapter)).execute({ operation: "version" });
    expect(result).toMatchObject({ ok: true, structuralStatus: null });
    expect(adapter.launches[0]).toMatchObject({ shell: false, executable: "/Applications/af" });
    expect(adapter.launches[0].argv).toEqual(["/Applications/af", "version", "--json"]);
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

  it("does not retry a policy failure through another boundary", async () => {
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
});
