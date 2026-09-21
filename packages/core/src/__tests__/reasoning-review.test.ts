import { describe, expect, it } from "vitest";
import type {
  ReasoningEvidenceStatus,
  ReasoningReviewArtifactHandle,
  ReasoningReviewChallenge,
  ReasoningReviewRoutingMetadata,
  ReasoningReviewRoutingReasonCode,
  ReasoningReviewRoutingSummary,
  ReasoningReviewRuntime,
  ReasoningReviewStatus,
  ReasoningReviewSummary,
} from "..";

describe("reasoning review core contract", () => {
  it("models runtime state and every review status", () => {
    const runtime: ReasoningReviewRuntime = { state: "unavailable", reason: "Not installed" };
    const statuses: ReasoningReviewStatus[] = [
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
    const evidenceStatuses: ReasoningEvidenceStatus[] = [
      "not_assessed",
      "not_required",
      "source_recorded",
      "unverified",
      "human_verified",
      "conflicted",
    ];

    expect(runtime.state).toBe("unavailable");
    expect(statuses).toHaveLength(9);
    expect(evidenceStatuses).toHaveLength(6);
  });

  it("constructs a summary with an opaque artifact handle and challenge details", () => {
    const artifactHandle: ReasoningReviewArtifactHandle = "opaque-review-artifact";
    const challenge: ReasoningReviewChallenge = {
      severity: "major",
      target: "central claim",
      reason: "Needs supporting evidence",
    };
    const summary: ReasoningReviewSummary = {
      reviewedMessageId: "message-1",
      status: "conditional",
      invocation: "manual",
      conclusion: "The argument is plausible with an unresolved assumption.",
      assumptions: ["The stated premise holds"],
      evidenceStatus: "unverified",
      openChallenges: [challenge],
      interpretiveBoundary: "This is a post-delivery review.",
      artifactHandle,
    };

    expect(summary).toEqual({
      reviewedMessageId: "message-1",
      status: "conditional",
      invocation: "manual",
      conclusion: "The argument is plausible with an unresolved assumption.",
      assumptions: ["The stated premise holds"],
      evidenceStatus: "unverified",
      openChallenges: [challenge],
      interpretiveBoundary: "This is a post-delivery review.",
      artifactHandle: "opaque-review-artifact",
    });

    for (const field of [
      "afNodeId",
      "executablePath",
      "workspacePath",
      "command",
      "flags",
      "ledger",
      "prompt",
      "reasoningTrace",
      "sourcePacket",
      "credential",
      "privateReasoning",
    ]) {
      expect(summary).not.toHaveProperty(field);
    }
  });

  it("supports bounded automatic routing metadata while keeping it optional", () => {
    const reasonCodes: ReasoningReviewRoutingReasonCode[] = [
      "evidence_dependent",
      "multi_step_argument",
      "high_impact_recommendation",
    ];
    const explanations: ReasoningReviewRoutingSummary[] = [
      "Evidence-dependent response",
      "Multi-step argument",
      "High-impact recommendation",
    ];
    const routing: ReasoningReviewRoutingMetadata = {
      reasonCode: "evidence_dependent",
      summary: "Evidence-dependent response",
    };
    const automatic: ReasoningReviewSummary = {
      reviewedMessageId: "message-2",
      status: "conditional",
      invocation: "automatic",
      conclusion: "The argument needs supporting evidence.",
      assumptions: [],
      evidenceStatus: "unverified",
      openChallenges: [],
      routing,
    };

    expect(reasonCodes).toHaveLength(3);
    expect(explanations).toHaveLength(3);
    expect(automatic.routing).toEqual(routing);
    expect(JSON.parse(JSON.stringify(automatic))).toEqual(automatic);
  });

  it("exposes only JSON-safe provider-neutral review data", () => {
    const runtimeStates: ReasoningReviewRuntime["state"][] = ["unavailable", "checking", "incompatible", "available"];
    const challengeSeverities: ReasoningReviewChallenge["severity"][] = ["critical", "major", "minor", "note"];
    const review = {
      runtimeStates,
      challengeSeverities,
      summary: {
        reviewedMessageId: "message-1",
        status: "not_reviewed" as const,
        invocation: "manual" as const,
        conclusion: "No review has been requested.",
        assumptions: [],
        evidenceStatus: "not_assessed" as const,
        openChallenges: [],
        artifactHandle: "opaque-handle",
      } satisfies ReasoningReviewSummary,
    };

    expect(JSON.parse(JSON.stringify(review))).toEqual(review);
    expect(Object.keys(review.summary).sort()).toEqual([
      "artifactHandle",
      "assumptions",
      "conclusion",
      "evidenceStatus",
      "invocation",
      "openChallenges",
      "reviewedMessageId",
      "status",
    ]);
  });
});
