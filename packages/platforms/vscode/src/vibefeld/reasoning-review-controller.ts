import type { ReasoningReviewRuntime, ReasoningReviewSummary } from "@opencode-chat/core";

export interface IReasoningReviewController {
  getRuntime(): Promise<ReasoningReviewRuntime>;
  review(input: {
    sessionId: string;
    messageId: string;
    sourceText: string;
    invocation?: "manual" | "automatic";
  }): Promise<ReasoningReviewSummary>;
  cancel(sessionId: string, messageId: string): void;
}
