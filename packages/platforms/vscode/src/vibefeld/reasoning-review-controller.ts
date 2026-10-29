import type { ReasoningReviewProgressStage, ReasoningReviewRuntime, ReasoningReviewSummary } from "@opencode-chat/core";

export type ReasoningReviewControllerInput = Readonly<{
  sessionId: string;
  messageId: string;
  sourceText: string;
  invocation?: "manual" | "automatic";
  onProgress?: (stage: ReasoningReviewProgressStage) => void;
}>;

export interface IReasoningReviewController {
  getRuntime(): Promise<ReasoningReviewRuntime>;
  review(input: ReasoningReviewControllerInput): Promise<ReasoningReviewSummary>;
  cancel(sessionId: string, messageId: string): void;
}
