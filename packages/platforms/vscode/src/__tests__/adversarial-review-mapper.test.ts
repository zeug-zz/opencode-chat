import { describe, expect, it, vi } from "vitest";
import {
  RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
  type ReviewContextMetadata,
} from "../vibefeld/adversarial-review-contract";
import { mapAdversarialReviewToSummary } from "../vibefeld/adversarial-review-mapper";
import { createAdversarialReviewOrchestrator } from "../vibefeld/adversarial-review-orchestrator";
import type { AdversarialReviewSeam } from "../vibefeld/adversarial-review-seam";
import { normalizeEvidenceReferences } from "../vibefeld/evidence-metadata";

const source = [
  "CONCLUSION: claim-conclusion",
  "CLAIM: claim-premise|empirical|A bounded observation is recorded.",
  "CLAIM: claim-conclusion|deductive|The conclusion follows from the premise.",
  "ASSUMPTION: assumption-1|claim-conclusion|The premise applies to this case.",
  "DEPENDS: edge-1|claim-conclusion|claim-premise",
  "EVIDENCE: evidence-1|claim-premise|observation|source_recorded",
].join("\n");

const provenance = (role: "prover" | "verifier", identity: string) =>
  ({
    identity,
    role,
    contextNumber: role === "prover" ? 1 : 2,
  }) as const;

function reviewSeam(disposition: "confirmed" | "rejected" | "unresolved"): AdversarialReviewSeam {
  const prover = {
    handle: "prover-handle" as ReviewContextMetadata["handle"],
    provenance: provenance("prover", "prover-id"),
  };
  const verifier = {
    handle: "verifier-handle" as ReviewContextMetadata["handle"],
    provenance: provenance("verifier", "verifier-id"),
  };
  return {
    getCapability: () => ({ supported: true, attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION }),
    createContext: vi.fn(async (role) => ({ ok: true as const, value: role === "prover" ? prover : verifier })),
    runProver: vi.fn(async () => ({
      ok: true as const,
      value: {
        proposalId: "proposal-1",
        prover: prover.provenance,
        objections: [
          {
            objectionId: "objection-1",
            target: { kind: "claim" as const, id: "claim-conclusion" },
            severity: "major" as const,
            reason: "The conclusion depends on an assumption.",
          },
        ],
      },
    })),
    runVerifier: vi.fn(async () => ({
      ok: true as const,
      value: {
        verifier: verifier.provenance,
        proposalId: "proposal-1",
        dispositions: [{ objectionId: "objection-1", disposition, reason: "The bounded objection was evaluated." }],
      },
    })),
    cancelContext: vi.fn(async () => undefined),
  };
}

function evidence(status: "source_recorded" | "conflicted") {
  return normalizeEvidenceReferences([
    { id: "evidence-1", claimId: "claim-premise", metadata: { sourceKind: "observation", status } },
  ]);
}

async function mapped(
  disposition: "confirmed" | "rejected" | "unresolved",
  evidenceResult = evidence("source_recorded"),
) {
  const outcome = await createAdversarialReviewOrchestrator(reviewSeam(disposition)).review(source);
  expect(outcome.ok).toBe(true);
  return mapAdversarialReviewToSummary({ reviewedMessageId: "message-1", evidence: evidenceResult, outcome });
}

describe("adversarial review mapping", () => {
  it.each(["confirmed", "unresolved"] as const)(
    "publishes %s objections as bounded open challenges",
    async (disposition) => {
      const result = await mapped(disposition);
      expect(result.status).toBe("unresolved");
      expect(result.openChallenges).toEqual([
        {
          severity: "major",
          target: "claim:claim-conclusion",
          reason: "The bounded objection was evaluated.",
        },
      ]);
      expect(result).not.toHaveProperty("provenance");
    },
  );

  it("keeps rejected objections conditional and never structurally checked or refuted", async () => {
    const result = await mapped("rejected");
    expect(result.status).toBe("conditional");
    expect(result.openChallenges).toEqual([]);
    expect(["structurally_checked", "refuted"]).not.toContain(result.status);
    expect(result.interpretiveBoundary).toMatch(/does not establish source accuracy/);
  });

  it("keeps evidence conflict independent and weaker than agreement", async () => {
    const result = await mapped("rejected", evidence("conflicted"));
    expect(result.status).toBe("unresolved");
    expect(result.evidenceStatus).toBe("conflicted");
    expect(result.openChallenges).toEqual([]);
    expect(result.conclusion).not.toMatch(/truth|proved/i);
  });

  it("maps bounded failures without exposing failure payloads", () => {
    const result = mapAdversarialReviewToSummary({
      reviewedMessageId: "message-1",
      evidence: evidence("source_recorded"),
      outcome: { ok: false, failure: { status: "audit_failed", phase: "verifier", reason: "timeout" } },
    });
    expect(result.status).toBe("audit_failed");
    expect(JSON.stringify(result)).not.toMatch(/timeout|verifier|command|path|prompt/);
  });
});
