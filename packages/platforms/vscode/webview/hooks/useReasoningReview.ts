import type {
  HostToUIMessage,
  ReasoningReviewProgressStage,
  ReasoningReviewRuntime,
  ReasoningReviewSummary,
  UIToHostMessage,
} from "@opencode-chat/core";
import { useCallback, useRef, useState } from "react";
import { postMessage } from "../vscode-api";

/** Host-published preference for the availability-gated settings control. */
export type ReasoningReviewPreference = Extract<HostToUIMessage, { type: "reasoningReviewPreference" }>["preference"];
/** Bounded preference patch sent back to the host; only present keys are written. */
export type ReasoningReviewPreferencePatch = Extract<
  UIToHostMessage,
  { type: "setReasoningReviewPreference" }
>["preference"];

export type ReasoningReviewViewState =
  | Readonly<{ phase: "reviewing" | "cancelling"; requestId: string; stage: ReasoningReviewProgressStage }>
  | Readonly<{ phase: "result"; requestId: string; summary: ReasoningReviewSummary }>
  | Readonly<{ phase: "cancelled"; requestId: string }>;

type ReasoningReviewHostMessage = Extract<
  HostToUIMessage,
  | { type: "reasoningRuntime" }
  | { type: "reasoningReviewPreference" }
  | { type: "reasoningReviewProgress" }
  | { type: "reasoningReviewResult" }
  | { type: "reasoningReviewCancelled" }
>;

const reviewKey = (sessionId: string, messageId: string): string => `${sessionId}\u0000${messageId}`;

/**
 * Runtime, preference, and explicit completed-answer review state. The host
 * owns all review work; the webview sends only a typed request or cancellation.
 */
export function useReasoningReview() {
  const [runtime, setRuntime] = useState<ReasoningReviewRuntime | null>(null);
  const [preference, setPreference] = useState<ReasoningReviewPreference | null>(null);
  const [reviews, setReviews] = useState<ReadonlyMap<string, ReasoningReviewViewState>>(() => new Map());
  const requestCounter = useRef(0);

  const updatePreference = useCallback((patch: ReasoningReviewPreferencePatch) => {
    postMessage({ type: "setReasoningReviewPreference", preference: patch });
  }, []);

  const requestReview = useCallback(
    (sessionId: string, messageId: string) => {
      if (runtime?.state !== "available") return;
      const requestId = `manual-review-${Date.now().toString(36)}-${(++requestCounter.current).toString(36)}`;
      setReviews((current) => {
        const next = new Map(current);
        next.set(reviewKey(sessionId, messageId), { phase: "reviewing", requestId, stage: "claimProjection" });
        return next;
      });
      postMessage({ type: "requestReasoningReview", sessionId, messageId, requestId });
    },
    [runtime?.state],
  );

  const cancelReview = useCallback(
    (sessionId: string, messageId: string) => {
      const key = reviewKey(sessionId, messageId);
      const current = reviews.get(key);
      if (current?.phase !== "reviewing") return;
      setReviews((previous) => {
        const next = new Map(previous);
        next.set(key, { ...current, phase: "cancelling" });
        return next;
      });
      postMessage({ type: "cancelReasoningReview", sessionId, messageId, requestId: current.requestId });
    },
    [reviews],
  );

  const clearReviews = useCallback(() => setReviews(new Map()), []);

  const handleHostMessage = useCallback((message: ReasoningReviewHostMessage) => {
    if (message.type === "reasoningRuntime") {
      setRuntime(message.runtime);
      return;
    }

    if (message.type === "reasoningReviewPreference") {
      setPreference(message.preference);
      return;
    }

    const key = reviewKey(message.sessionId, message.messageId);
    setReviews((current) => {
      const existing = current.get(key);
      if (!existing || existing.requestId !== message.requestId) return current;
      const next = new Map(current);
      if (message.type === "reasoningReviewProgress") {
        next.set(key, {
          phase: existing.phase === "cancelling" ? "cancelling" : "reviewing",
          requestId: message.requestId,
          stage: message.stage,
        });
      } else if (message.type === "reasoningReviewResult") {
        if (message.summary.reviewedMessageId !== message.messageId) return current;
        next.set(key, { phase: "result", requestId: message.requestId, summary: message.summary });
      } else {
        next.set(key, { phase: "cancelled", requestId: message.requestId });
      }
      return next;
    });
  }, []);

  return {
    runtime,
    preference,
    reviews,
    updatePreference,
    requestReview,
    cancelReview,
    clearReviews,
    handleHostMessage,
  } as const;
}
