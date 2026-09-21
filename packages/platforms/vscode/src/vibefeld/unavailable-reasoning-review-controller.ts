import type { ReasoningReviewRuntime, ReasoningReviewSummary } from "@opencode-chat/core";
import type { IReasoningReviewController } from "./reasoning-review-controller";

const UNAVAILABLE_REASON = "No reasoning-review runtime is available.";
const UNAVAILABLE_CONCLUSION = "This response was not reviewed because no reasoning-review runtime is available.";
const UNAVAILABLE_BOUNDARY = "Manual review is unavailable; this fallback does not assess the original response.";

export class UnavailableReasoningReviewController implements IReasoningReviewController {
  async getRuntime(): Promise<ReasoningReviewRuntime> {
    return {
      state: "unavailable",
      reason: UNAVAILABLE_REASON,
    };
  }

  async review({
    messageId,
  }: {
    sessionId: string;
    messageId: string;
    sourceText: string;
  }): Promise<ReasoningReviewSummary> {
    return {
      reviewedMessageId: messageId,
      status: "unavailable",
      invocation: "manual",
      conclusion: UNAVAILABLE_CONCLUSION,
      assumptions: [],
      evidenceStatus: "not_assessed",
      openChallenges: [],
      interpretiveBoundary: UNAVAILABLE_BOUNDARY,
    };
  }

  cancel(_sessionId: string, _messageId: string): void {
    // There is no in-flight work to cancel for the unavailable fallback.
  }
}
