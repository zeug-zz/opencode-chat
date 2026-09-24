import type { ReasoningEvidenceStatus, ReasoningReviewStatus, ReasoningReviewSummary } from "@opencode-chat/core";
import type { ClaimGraphValidationResult, EvidenceStatus } from "./claim-graph";
import type { NormalizedProjectionOutcome } from "./claim-projection-seam";
import type { EvidenceNormalizationResult } from "./evidence-metadata";

export type { NormalizedProjectionOutcome } from "./claim-projection-seam";

export type ClaimProjectionMappingInput = Readonly<{
  reviewedMessageId: string;
  graph: ClaimGraphValidationResult;
  evidence: EvidenceNormalizationResult;
  outcome: NormalizedProjectionOutcome;
}>;

const STRUCTURAL_BOUNDARY =
  "Structural review describes recorded relationships under stated assumptions; it does not establish external truth, source accuracy, or normative correctness.";
const FAILURE_BOUNDARY =
  "This result describes the review process only; it does not establish the truth of the source, premises, citations, or conclusion.";

const CONCLUSIONS: Readonly<Record<ReasoningReviewStatus, string>> = {
  not_reviewed: "No reasoning review was requested.",
  reviewing: "Reasoning review is in progress.",
  structurally_checked: "The recorded argument supports this conclusion under the stated assumptions.",
  conditional: "This conclusion depends on the stated assumption or unverified evidence.",
  unresolved: "The conclusion is not established; the central open objection is unresolved.",
  refuted: "The proposed claim fails because the recorded structure does not support it.",
  blocked: "Reasoning review was blocked because the claim structure could not be validated.",
  audit_failed: "This reasoning check did not complete reliably and should be treated as unverified.",
  unavailable: "Structural review was not performed because the projection capability was unavailable.",
};

function toReasoningEvidenceStatus(status: EvidenceStatus): ReasoningEvidenceStatus {
  return status;
}

function summaryBase(reviewedMessageId: string, evidenceStatus: ReasoningEvidenceStatus): ReasoningReviewSummary {
  return {
    reviewedMessageId,
    status: "blocked",
    invocation: "manual",
    conclusion: CONCLUSIONS.blocked,
    assumptions: [],
    evidenceStatus,
    openChallenges: [],
    interpretiveBoundary: FAILURE_BOUNDARY,
  };
}

/**
 * Convert only validated, host-private facts into a complete provider-neutral
 * summary. This function never includes graph identifiers, bridge details, or
 * arbitrary provider text in the shared result.
 */
export function mapClaimProjectionToSummary(input: ClaimProjectionMappingInput): ReasoningReviewSummary {
  if (!input.graph.ok) {
    const summary = summaryBase(input.reviewedMessageId, "not_assessed");
    summary.openChallenges = [
      { severity: "major", target: "claim structure", reason: "The claim structure could not be validated." },
    ];
    return summary;
  }

  if (!input.evidence.ok) {
    const summary = summaryBase(input.reviewedMessageId, "not_assessed");
    summary.openChallenges = [
      { severity: "major", target: "evidence metadata", reason: "The evidence metadata could not be normalized." },
    ];
    return summary;
  }

  const evidenceStatus = toReasoningEvidenceStatus(input.evidence.assessment.status);
  const summary: ReasoningReviewSummary = {
    ...summaryBase(input.reviewedMessageId, evidenceStatus),
    assumptions: input.graph.graph.assumptions.map(({ statement }) => statement),
    openChallenges: [],
  };

  if (input.outcome.status === "unavailable" || input.outcome.status === "audit_failed") {
    summary.status = input.outcome.status;
    summary.conclusion = CONCLUSIONS[input.outcome.status];
    summary.interpretiveBoundary = FAILURE_BOUNDARY;
    return summary;
  }

  let status: ReasoningReviewStatus = input.outcome.status;
  if (input.outcome.status === "structurally_checked") {
    if (evidenceStatus === "conflicted") status = "unresolved";
    else if (evidenceStatus === "source_recorded" || evidenceStatus === "unverified") status = "conditional";
  }

  summary.status = status;
  summary.conclusion = CONCLUSIONS[status];
  summary.interpretiveBoundary = STRUCTURAL_BOUNDARY;
  return summary;
}
