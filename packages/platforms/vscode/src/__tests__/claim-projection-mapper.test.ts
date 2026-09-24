import { describe, expect, it } from "vitest";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import { mapClaimProjectionToSummary, type NormalizedProjectionOutcome } from "../vibefeld/claim-projection-mapper";
import { normalizeEvidenceReferences } from "../vibefeld/evidence-metadata";

const source = [
  "CONCLUSION: claim-conclusion",
  "CLAIM: claim-premise|empirical|A bounded observation is recorded.",
  "CLAIM: claim-conclusion|deductive|The conclusion follows from the premise.",
  "ASSUMPTION: assumption-1|claim-conclusion|The premise applies to this case.",
  "DEPENDS: edge-1|claim-conclusion|claim-premise",
  "EVIDENCE: evidence-1|claim-premise|observation|not_required",
].join("\n");

function input(outcome: NormalizedProjectionOutcome, evidenceStatus = "not_required") {
  const graph = compileClaimGraph(source);
  const evidence = normalizeEvidenceReferences([
    { id: "evidence-1", claimId: "claim-premise", metadata: { sourceKind: "observation", status: evidenceStatus } },
  ]);
  return { reviewedMessageId: "message-1", graph, evidence, outcome };
}

describe("private claim projection mapping", () => {
  it("allows structural success only with adequate evidence", () => {
    const result = mapClaimProjectionToSummary(input({ status: "structurally_checked" }));
    expect(result.status).toBe("structurally_checked");
    expect(result.evidenceStatus).toBe("not_required");
    expect(result.invocation).toBe("manual");
    expect(result.interpretiveBoundary).toMatch(/does not establish external truth/);
  });

  it.each([
    ["source_recorded", "conditional"],
    ["unverified", "conditional"],
    ["conflicted", "unresolved"],
  ] as const)("downgrades structural success for %s evidence", (evidenceStatus, status) => {
    const result = mapClaimProjectionToSummary(input({ status: "structurally_checked" }, evidenceStatus));
    expect(result.status).toBe(status);
    expect(result.evidenceStatus).toBe(evidenceStatus);
    expect(result.conclusion).not.toMatch(/supports this conclusion under the stated assumptions/);
  });

  it.each(["conditional", "unresolved", "refuted"] as const)("preserves explicit calibrated %s", (status) => {
    const result = mapClaimProjectionToSummary(input({ status }, "unverified"));
    expect(result.status).toBe(status);
    expect(result.evidenceStatus).toBe("unverified");
  });

  it.each(["unavailable", "audit_failed"] as const)("maps %s without a structural claim", (status) => {
    const result = mapClaimProjectionToSummary(input({ status }));
    expect(result.status).toBe(status);
    expect(result.conclusion).not.toMatch(/supports this conclusion/);
    expect(result.interpretiveBoundary).toMatch(/does not establish the truth/);
  });

  it("blocks invalid graph and does not echo invalid input", () => {
    const result = mapClaimProjectionToSummary({
      ...input({ status: "structurally_checked" }),
      graph: compileClaimGraph("CONCLUSION claim-1|private reasoning: secret"),
    });
    expect(result.status).toBe("blocked");
    expect(JSON.stringify(result)).not.toMatch(/private reasoning|secret|claim-1/);
    expect(result.evidenceStatus).toBe("not_assessed");
  });

  it("does not retain provider-shaped outcome data", () => {
    const result = mapClaimProjectionToSummary(input({ status: "unavailable" }));
    expect(JSON.stringify(result)).not.toMatch(/argv|path|command|ledger|prompt|credential|source packet/);
  });

  it("publishes only calibrated fields, never raw source, evidence, or hidden reasoning", () => {
    const rawSource = "internal source text that remains private";
    const graph = compileClaimGraph(`CONCLUSION: claim-conclusion\nCLAIM: claim-conclusion|deductive|${rawSource}`);
    const result = mapClaimProjectionToSummary({
      reviewedMessageId: "message-1",
      graph,
      evidence: normalizeEvidenceReferences([
        {
          id: "evidence-1",
          claimId: "claim-conclusion",
          metadata: { sourceKind: "observation", status: "source_recorded" },
        },
      ]),
      outcome: { status: "structurally_checked" },
    });

    expect(result.status).toBe("conditional");
    expect(JSON.stringify(result)).not.toContain(rawSource);
    expect(JSON.stringify(result)).not.toContain("internal source text");
  });
});
