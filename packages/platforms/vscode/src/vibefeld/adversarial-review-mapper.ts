import type {
  ReasoningEvidenceStatus,
  ReasoningReviewChallenge,
  ReasoningReviewStatus,
  ReasoningReviewSummary,
} from "@opencode-chat/core";
import type { AdversarialReviewOrchestrationResult } from "./adversarial-review-orchestrator";
import type { EvidenceNormalizationResult } from "./evidence-metadata";

export type AdversarialReviewMappingInput = Readonly<{
  reviewedMessageId: string;
  evidence: EvidenceNormalizationResult;
  outcome: AdversarialReviewOrchestrationResult;
}>;

const REVIEW_BOUNDARY =
  "Adversarial review describes bounded objections under stated assumptions; it does not establish source accuracy, external truth, or formal proof.";
const FAILURE_BOUNDARY =
  "This result describes the review process only; it does not establish the truth of the source, premises, citations, or conclusion.";

const CONCLUSIONS: Readonly<Record<ReasoningReviewStatus, string>> = {
  not_reviewed: "No reasoning review was requested.",
  reviewing: "Reasoning review is in progress.",
  structurally_checked: "Adversarial review does not establish structural success.",
  conditional: "No bounded objection was confirmed under the stated assumptions.",
  unresolved: "A bounded objection or evidence dependency remains unresolved.",
  refuted: "Adversarial review does not establish that the conclusion is refuted.",
  blocked: "Reasoning review was blocked before a bounded result could be produced.",
  audit_failed: "This reasoning check did not complete reliably and should be treated as unverified.",
  unavailable: "Adversarial review was not performed because the capability was unavailable.",
};

function evidenceStatus(result: EvidenceNormalizationResult): ReasoningEvidenceStatus {
  return result.ok ? result.assessment.status : "not_assessed";
}

function summaryBase(reviewedMessageId: string, evidence: ReasoningEvidenceStatus): ReasoningReviewSummary {
  return {
    reviewedMessageId,
    status: "unavailable",
    invocation: "manual",
    conclusion: CONCLUSIONS.unavailable,
    assumptions: [],
    evidenceStatus: evidence,
    openChallenges: [],
    interpretiveBoundary: FAILURE_BOUNDARY,
  };
}

function weakenStatus(status: "conditional" | "unresolved", evidence: ReasoningEvidenceStatus): ReasoningReviewStatus {
  return evidence === "conflicted" ? "unresolved" : status;
}

/**
 * Map only normalized private facts to the existing public review summary.
 * Agreement between the two roles is deliberately never structural success.
 */
export function mapAdversarialReviewToSummary(input: AdversarialReviewMappingInput): ReasoningReviewSummary {
  const evidence = evidenceStatus(input.evidence);
  const summary = summaryBase(input.reviewedMessageId, evidence);

  if (!input.outcome.ok) {
    summary.status = input.outcome.failure.status;
    summary.conclusion = CONCLUSIONS[summary.status];
    return summary;
  }

  const { packet, prover, verifier } = input.outcome.value;
  summary.assumptions = packet.assumptions.map(({ statement }) => statement);
  const objectionById = new Map(prover.proposal.objections.map((objection) => [objection.objectionId, objection]));
  const challenges: ReasoningReviewChallenge[] = [];

  for (const disposition of verifier.result.dispositions) {
    if (disposition.disposition === "rejected") continue;
    const objection = objectionById.get(disposition.objectionId);
    if (!objection) continue;
    challenges.push({
      severity: objection.severity,
      target: `${objection.target.kind}:${objection.target.id}`,
      reason: disposition.reason,
    });
  }

  summary.openChallenges = challenges;
  summary.status = weakenStatus(challenges.length > 0 ? "unresolved" : "conditional", evidence);
  summary.conclusion = CONCLUSIONS[summary.status];
  summary.interpretiveBoundary = REVIEW_BOUNDARY;
  // Keep the packet's evidence fact separate from adversarial agreement. The
  // normalized input remains authoritative when it differs from packet data.
  void packet.evidenceStatus;
  return summary;
}
