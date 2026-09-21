import { describe, expect, it, vi } from "vitest";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import { mapClaimProjectionToSummary } from "../vibefeld/claim-projection-mapper";
import {
  CURRENT_VIBEFELD_CLAIM_CAPABILITY,
  type CurrentVibefeldRuntimeBoundary,
  createCurrentVibefeldClaimProjectionSeam,
} from "../vibefeld/current-vibefeld-claim-projection";
import { normalizeEvidenceReferences } from "../vibefeld/evidence-metadata";

const graph = compileClaimGraph("CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.");

describe("current Vibefeld runtime claim boundary", () => {
  it("declares no claim capability without probing the compatibility bridge", async () => {
    const runtime: CurrentVibefeldRuntimeBoundary = {
      preflight: vi.fn(),
      run: vi.fn(),
      teardown: vi.fn(),
    };
    const seam = createCurrentVibefeldClaimProjectionSeam(runtime);

    expect(CURRENT_VIBEFELD_CLAIM_CAPABILITY).toEqual({ supported: false });
    expect(seam.getCapability()).toEqual({ supported: false });
    if (!graph.ok) throw new Error("test graph must be valid");
    expect(await seam.project(graph.graph)).toEqual({ status: "unavailable", reason: "unsupported" });
    expect(runtime.preflight).not.toHaveBeenCalled();
    expect(runtime.run).not.toHaveBeenCalled();
    expect(runtime.teardown).not.toHaveBeenCalled();
  });

  it("maps the current no-claim result as unavailable and non-structural", async () => {
    const runtime: CurrentVibefeldRuntimeBoundary = {
      preflight: vi.fn(),
      run: vi.fn(),
      teardown: vi.fn(),
    };
    const seam = createCurrentVibefeldClaimProjectionSeam(runtime);
    if (!graph.ok) throw new Error("test graph must be valid");
    const evidence = normalizeEvidenceReferences([]);
    const result = mapClaimProjectionToSummary({
      reviewedMessageId: "message-1",
      graph,
      evidence,
      outcome: await seam.project(graph.graph),
    });

    expect(result.status).toBe("unavailable");
    expect(result.evidenceStatus).toBe("not_required");
    expect(JSON.stringify(result)).not.toContain("structurally_checked");
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
