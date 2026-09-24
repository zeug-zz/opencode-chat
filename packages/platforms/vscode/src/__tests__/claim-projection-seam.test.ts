import { describe, expect, it, vi } from "vitest";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import {
  type ClaimGraph,
  createClaimProjectionSeam,
  createUnsupportedClaimProjectionSeam,
} from "../vibefeld/claim-projection-seam";

const graph = compileClaimGraph("CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.");

function validGraph(): ClaimGraph {
  if (!graph.ok) throw new Error("test graph must be valid");
  return graph.graph;
}

describe("private claim projection seam", () => {
  it("reports unsupported without an implementation and does not invoke anything", async () => {
    const seam = createUnsupportedClaimProjectionSeam();
    expect(seam.getCapability()).toEqual({ supported: false });
    expect(await seam.project(validGraph())).toEqual({ status: "unavailable", reason: "unsupported" });
  });

  it.each([
    { status: "structurally_checked" },
    { status: "conditional" },
    { status: "unresolved" },
    { status: "refuted" },
    { status: "unavailable", reason: "timeout" },
    { status: "audit_failed", reason: "cleanup" },
  ] as const)("normalizes the bounded result $status", async (result) => {
    const seam = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: () => result,
    });
    expect(await seam.project(validGraph())).toEqual(result);
  });

  it("rejects forbidden graph fields and invalid graphs before the delegate", async () => {
    const delegate = vi.fn(() => ({ status: "structurally_checked" as const }));
    const seam = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: delegate,
    });
    const forbidden = { ...validGraph(), argv: ["--prompt", "/private/workspace"] };
    const invalid = { ...validGraph(), conclusionId: "missing" };

    expect(await seam.project(forbidden as ClaimGraph)).toEqual({ status: "unavailable", reason: "malformed" });
    expect(await seam.project(invalid as ClaimGraph)).toEqual({ status: "unavailable", reason: "malformed" });
    expect(delegate).not.toHaveBeenCalled();
  });

  it("rejects unknown or unbounded delegate output without exposing it", async () => {
    const delegate = vi.fn(() => ({ status: "structurally_checked", ledger: "x".repeat(100_000) }));
    const seam = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: delegate,
    });

    const result = await seam.project(validGraph());
    expect(result).toEqual({ status: "unavailable", reason: "malformed" });
    expect(JSON.stringify(result)).not.toContain("ledger");
  });

  it("does not invoke a delegate for an already-aborted signal", async () => {
    const delegate = vi.fn(() => ({ status: "structurally_checked" as const }));
    const seam = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: delegate,
    });
    const controller = new AbortController();
    controller.abort();

    expect(await seam.project(validGraph(), controller.signal)).toEqual({ status: "unavailable", reason: "cancelled" });
    expect(delegate).not.toHaveBeenCalled();
  });

  it("maps cancellation while a delegate is pending", async () => {
    const delegate = vi.fn(
      (_value: ClaimGraph, signal: AbortSignal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve({ status: "structurally_checked" }))),
    );
    const seam = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: delegate,
    });
    const controller = new AbortController();
    const pending = seam.project(validGraph(), controller.signal);
    controller.abort();

    expect(await pending).toEqual({ status: "unavailable", reason: "cancelled" });
    expect(delegate).toHaveBeenCalledOnce();
  });
});
