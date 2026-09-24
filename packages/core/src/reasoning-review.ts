/**
 * Provider-neutral contracts for an optional, manually requested reasoning
 * review. Provider implementations may keep their own runtime details, but
 * only these bounded review facts cross the shared package boundary.
 */

export type ReasoningReviewRuntimeState = "unavailable" | "checking" | "incompatible" | "available";

export type ReasoningReviewStatus =
  | "not_reviewed"
  | "reviewing"
  | "structurally_checked"
  | "conditional"
  | "unresolved"
  | "refuted"
  | "blocked"
  | "audit_failed"
  | "unavailable";

export type ReasoningEvidenceStatus =
  | "not_assessed"
  | "not_required"
  | "source_recorded"
  | "unverified"
  | "human_verified"
  | "conflicted";

export type ReasoningReviewInvocation = "manual" | "automatic";

/** Stable, provider-neutral reasons for an automatically selected review. */
export type ReasoningReviewRoutingReasonCode =
  | "evidence_dependent"
  | "multi_step_argument"
  | "high_impact_recommendation";

/** Allowlisted explanations suitable for display without provider details. */
export type ReasoningReviewRoutingSummary =
  | "Evidence-dependent response"
  | "Multi-step argument"
  | "High-impact recommendation";

export type ReasoningReviewRoutingMetadata = {
  reasonCode: ReasoningReviewRoutingReasonCode;
  summary?: ReasoningReviewRoutingSummary;
};

export type ReasoningReviewChallengeSeverity = "critical" | "major" | "minor" | "note";

export type ReasoningReviewChallenge = {
  severity: ReasoningReviewChallengeSeverity;
  target: string;
  reason: string;
};

/** An opaque identifier for provider-owned review artifacts. */
export type ReasoningReviewArtifactHandle = string;

export type ReasoningReviewRuntime = {
  state: ReasoningReviewRuntimeState;
  reason?: string;
};

export type ReasoningReviewSummary = {
  reviewedMessageId: string;
  status: ReasoningReviewStatus;
  invocation: ReasoningReviewInvocation;
  conclusion: string;
  assumptions: string[];
  evidenceStatus: ReasoningEvidenceStatus;
  openChallenges: ReasoningReviewChallenge[];
  interpretiveBoundary?: string;
  artifactHandle?: ReasoningReviewArtifactHandle;
  routing?: ReasoningReviewRoutingMetadata;
};
