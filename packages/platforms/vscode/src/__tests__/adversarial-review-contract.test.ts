import { describe, expect, it } from "vitest";
import {
  type BoundedAdversarialReviewFailure,
  type ObjectionProposal,
  RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
  type ReviewPacket,
  type VerifierResult,
} from "../vibefeld/adversarial-review-contract";

describe("private adversarial review contract", () => {
  it("exposes only the exact denied permission profile", () => {
    expect(RESTRICTED_REVIEW_PERMISSION_ATTESTATION).toEqual({
      schemaVersion: "1",
      roles: ["prover", "verifier"],
      permissions: {
        repositoryRead: false,
        repositoryWrite: false,
        shell: false,
        packageManager: false,
        terminal: false,
        arbitraryTaskDelegation: false,
        afWorkspace: false,
        plugin: false,
        mcp: false,
        modelVisibleTools: false,
      },
      channels: { reviewPacket: "review_packet", reviewResult: "review_result" },
    });
  });

  it("keeps contract examples limited to bounded private data", () => {
    const packet = {
      packetId: "packet-1",
      conclusionId: "claim-1",
      claims: [],
      assumptions: [],
      logicalDependencies: [],
      evidenceReferences: [],
      evidenceStatus: "not_required",
      limits: {
        maxClaims: 64,
        maxAssumptions: 128,
        maxDependencies: 128,
        maxEvidenceReferences: 128,
        maxStatementLength: 512,
        maxReasonLength: 256,
      },
    } satisfies ReviewPacket;
    const proposal = {
      proposalId: "proposal-1",
      prover: { identity: "prover-1", role: "prover", contextNumber: 1 },
      objections: [],
    } satisfies ObjectionProposal;
    const result = {
      verifier: { identity: "verifier-1", role: "verifier", contextNumber: 2 },
      proposalId: "proposal-1",
      dispositions: [],
    } satisfies VerifierResult;
    const failure = {
      status: "unavailable",
      phase: "host",
      reason: "unsupported",
    } satisfies BoundedAdversarialReviewFailure;

    for (const value of [packet, proposal, result, failure]) {
      expect(Object.keys(value)).not.toContain("prompt");
      expect(Object.keys(value)).not.toContain("command");
      expect(Object.keys(value)).not.toContain("path");
      expect(Object.keys(value)).not.toContain("payload");
      expect(Object.keys(value)).not.toContain("ledger");
    }
  });
});
