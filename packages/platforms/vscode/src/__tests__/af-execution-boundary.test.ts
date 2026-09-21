import { describe, expect, it } from "vitest";
import {
  AF_DENIED_POLICY_DOMAINS,
  type AfExecutionPolicyAdapter,
  buildAfPolicyDescriptor,
} from "../vibefeld/af-execution-boundary";

const adapter: AfExecutionPolicyAdapter = {
  platform: "darwin",
  readiness: {
    state: "ready",
    descendantConfinement: "inherited",
    childExecution: "deny-unapproved",
    deniedDomains: "enforced",
    audit: "verified",
  },
  launch: async () => ({ outcome: "exited", exitCode: 0 }),
  terminateAndReap: async () => ({ outcome: "reaped" }),
};

const request = {
  executable: "/Applications/af",
  argv: ["/Applications/af", "status", "--format", "json"] as [string, ...string[]],
  cwd: "/extension-storage/vibefeld/reviews/session/review",
  readOnlyRuntimeGrants: [{ path: "/Applications/af" }, { path: "/Applications/runtime" }],
  reviewRootWriteGrant: { path: "/extension-storage/vibefeld/reviews/session/review" },
};

describe("AF execution boundary", () => {
  it("constructs only a dedicated, descendant-confined descriptor", () => {
    const result = buildAfPolicyDescriptor(adapter, request);
    expect(result).toEqual({
      available: true,
      descriptor: {
        ...request,
        shell: false,
        descendantConfinement: "inherited",
        childExecution: "deny-unapproved",
        deniedDomains: AF_DENIED_POLICY_DOMAINS,
        network: "deny-denied-domains",
        audit: "verified",
      },
    });
  });

  it.each([
    [undefined, "missing-adapter"],
    [{ ...adapter, platform: "win32" }, "unsupported-platform"],
    [{ ...adapter, readiness: { state: "ambiguous" } }, "ambiguous-policy"],
    [{ ...adapter, readiness: { state: "unavailable" } }, "policy-not-ready"],
  ] as const)("fails closed when policy support is %s", (policy, reason) => {
    expect(buildAfPolicyDescriptor(policy as AfExecutionPolicyAdapter | undefined, request)).toEqual({
      available: false,
      reason,
    });
  });

  it.each([
    [{ ...request, shell: false }, "invalid-request"],
    [{ ...request, argv: ["/other/af", "status"] }, "invalid-request"],
    [
      { ...request, readOnlyRuntimeGrants: [{ path: "/Applications/runtime" }, { path: "/Applications/runtime/lib" }] },
      "invalid-grant-overlap",
    ],
    [{ ...request, reviewRootWriteGrant: { path: "/Applications" } }, "invalid-write-grant"],
  ] as const)("rejects caller-controlled or overlapping grant data", (candidate, reason) => {
    expect(buildAfPolicyDescriptor(adapter, candidate as never)).toEqual({ available: false, reason });
  });
});
