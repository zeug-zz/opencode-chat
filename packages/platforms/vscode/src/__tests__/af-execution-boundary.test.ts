import { describe, expect, it } from "vitest";
import {
  type AfExecutionPolicyAdapter,
  buildAfPolicyDescriptor,
  buildAfPreflightDescriptor,
} from "../vibefeld/af-execution-boundary";

const adapter: AfExecutionPolicyAdapter = {
  platform: "darwin",
  readiness: { state: "ready", execution: "direct" },
  launch: async () => ({ outcome: "exited", exitCode: 0 }),
  terminateAndReap: async () => ({ outcome: "reaped" }),
};

const request = {
  executable: "/Applications/af",
  argv: ["/Applications/af", "status", "--format", "json"] as readonly string[],
  cwd: "/extension-storage/vibefeld/reviews/session/review",
};

describe("AF execution boundary", () => {
  it("constructs only the direct-execution descriptor", () => {
    expect(buildAfPolicyDescriptor(adapter, request)).toEqual({
      available: true,
      descriptor: {
        executable: request.executable,
        argv: request.argv,
        cwd: request.cwd,
      },
    });
    expect(buildAfPreflightDescriptor(adapter, request)).toEqual({
      available: true,
      descriptor: {
        executable: request.executable,
        argv: request.argv,
        cwd: request.cwd,
      },
    });
  });

  it("crosses the boundary with no grant, denied-domain, network, or audit field", () => {
    const result = buildAfPolicyDescriptor(adapter, request);
    if (!result.available) throw new Error("expected an available descriptor");
    expect(Object.keys(result.descriptor).sort()).toEqual(["argv", "cwd", "executable"]);
  });

  it.each([
    [undefined, "missing-adapter"],
    [{ ...adapter, platform: "win32" }, "unsupported-platform"],
    [{ ...adapter, readiness: { state: "ambiguous" } }, "ambiguous-policy"],
    [{ ...adapter, readiness: { state: "unavailable" } }, "policy-not-ready"],
    [{ ...adapter, readiness: { state: "ready", execution: "inherited" } }, "policy-not-ready"],
  ] as const)("fails closed when direct readiness is %s", (policy, reason) => {
    expect(buildAfPolicyDescriptor(policy as AfExecutionPolicyAdapter | undefined, request)).toEqual({
      available: false,
      reason,
    });
  });

  it.each([
    [{ ...request, argv: ["/other/af", "status"] }, "invalid-request"],
    [{ ...request, executable: "relative/af" }, "invalid-request"],
    [{ ...request, cwd: "/extension-storage/x; rm -rf /" }, "invalid-request"],
    [{ ...request, argv: ["/Applications/af", "status", "x".repeat(300)] }, "invalid-request"],
    [{ ...request, shell: false }, "invalid-request"],
    [{ ...request, readOnlyRuntimeGrants: [{ path: "/Applications" }] }, "invalid-request"],
    [{ ...request, reviewRootWriteGrant: { path: request.cwd } }, "invalid-request"],
    [{ ...request, deniedDomains: ["repository"] }, "invalid-request"],
  ] as const)("rejects caller-controlled or widened descriptor data", (candidate, reason) => {
    expect(buildAfPolicyDescriptor(adapter, candidate as never)).toEqual({ available: false, reason });
    expect(buildAfPreflightDescriptor(adapter, candidate as never)).toEqual({ available: false, reason });
  });
});
