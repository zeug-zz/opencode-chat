import type {
  ReasoningEvidenceStatus,
  ReasoningReviewChallenge,
  ReasoningReviewChallengeSeverity,
  ReasoningReviewStatus,
  ReasoningReviewSummary,
} from "@opencode-chat/core";
import { redactReviewReason } from "./adversarial-review-redaction";

const STATUS_VALUES: readonly ReasoningReviewStatus[] = [
  "not_reviewed",
  "reviewing",
  "structurally_checked",
  "conditional",
  "unresolved",
  "refuted",
  "blocked",
  "audit_failed",
  "unavailable",
];
const EVIDENCE_VALUES: readonly ReasoningEvidenceStatus[] = [
  "not_assessed",
  "not_required",
  "source_recorded",
  "unverified",
  "human_verified",
  "conflicted",
];
const SEVERITIES: readonly ReasoningReviewChallengeSeverity[] = ["critical", "major", "minor", "note"];
const SAFE_TARGET = /^(?:claim|assumption|logical_dependency|evidence):[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FAILURE_BOUNDARY =
  "This result describes the review process only; it does not establish the truth of the source, premises, citations, or conclusion.";
const STRUCTURAL_BOUNDARY =
  "Structural status describes recorded relationships under stated assumptions; it does not establish external truth or source accuracy. Reviewers assessed a compressed argument map, not the full answer or cited sources; missing packet detail is not proof of an omission in the answer.";
const ADVERSARIAL_FAILURE_NOTE = "The prover/verifier review did not complete; no challenges are reported.";

const CONCLUSIONS: Readonly<Record<ReasoningReviewStatus, string>> = {
  not_reviewed: "No reasoning review was requested.",
  reviewing: "Reasoning review is in progress.",
  structurally_checked:
    "The argument structure was recorded; this does not establish that the conclusion follows or is true.",
  conditional: "This conclusion depends on the stated assumption or unverified evidence.",
  unresolved: "The conclusion is not established; a bounded objection or evidence dependency remains unresolved.",
  refuted: "The proposed claim fails because the recorded structure does not support it.",
  blocked: "Reasoning review was blocked before a bounded result could be produced.",
  audit_failed: "This reasoning check did not complete reliably and should be treated as unverified.",
  unavailable: "Manual review is unavailable; no claim status was inferred.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeChallenge(value: unknown): ReasoningReviewChallenge | undefined {
  if (!isRecord(value)) return undefined;
  const severity = value.severity;
  const target = value.target;
  const reason = value.reason;
  if (
    typeof severity !== "string" ||
    !SEVERITIES.includes(severity as ReasoningReviewChallengeSeverity) ||
    typeof target !== "string" ||
    typeof reason !== "string"
  )
    return undefined;
  return {
    severity: severity as ReasoningReviewChallengeSeverity,
    target: SAFE_TARGET.test(target) ? target : "argument",
    reason: redactReviewReason(reason),
  };
}

/** Rebuild a public summary from allowlisted fields; never forward provider-shaped data. */
export function normalizeReasoningReviewSummary(value: unknown, messageId: string): ReasoningReviewSummary {
  if (!isRecord(value)) return unavailableReasoningReviewSummary(messageId);
  const status = STATUS_VALUES.includes(value.status as ReasoningReviewStatus)
    ? (value.status as ReasoningReviewStatus)
    : "unavailable";
  const evidenceStatus = EVIDENCE_VALUES.includes(value.evidenceStatus as ReasoningEvidenceStatus)
    ? (value.evidenceStatus as ReasoningEvidenceStatus)
    : "not_assessed";
  const assumptions = Array.isArray(value.assumptions)
    ? value.assumptions
        .filter((assumption): assumption is string => typeof assumption === "string")
        .slice(0, 8)
        .map(redactReviewReason)
        .filter((assumption) => assumption.length > 0)
    : [];
  const openChallenges = Array.isArray(value.openChallenges)
    ? value.openChallenges
        .map(normalizeChallenge)
        .filter((challenge): challenge is ReasoningReviewChallenge => !!challenge)
        .slice(0, 3)
    : [];
  const includesStageFailure =
    typeof value.interpretiveBoundary === "string" && value.interpretiveBoundary.includes(ADVERSARIAL_FAILURE_NOTE);

  return {
    reviewedMessageId: messageId,
    status,
    invocation: "manual",
    conclusion: CONCLUSIONS[status],
    assumptions,
    evidenceStatus,
    openChallenges,
    interpretiveBoundary:
      status === "unavailable" || status === "blocked" || status === "audit_failed"
        ? FAILURE_BOUNDARY
        : includesStageFailure
          ? `${STRUCTURAL_BOUNDARY} ${ADVERSARIAL_FAILURE_NOTE}`
          : STRUCTURAL_BOUNDARY,
  };
}

export function unavailableReasoningReviewSummary(messageId: string): ReasoningReviewSummary {
  return {
    reviewedMessageId: messageId,
    status: "unavailable",
    invocation: "manual",
    conclusion: CONCLUSIONS.unavailable,
    assumptions: [],
    evidenceStatus: "not_assessed",
    openChallenges: [],
    interpretiveBoundary: FAILURE_BOUNDARY,
  };
}
