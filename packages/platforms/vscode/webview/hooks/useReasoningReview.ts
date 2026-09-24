import type { HostToUIMessage, ReasoningReviewRuntime, UIToHostMessage } from "@opencode-chat/core";
import { useCallback, useState } from "react";
import { postMessage } from "../vscode-api";

/** Host-published preference for the availability-gated settings control. */
export type ReasoningReviewPreference = Extract<HostToUIMessage, { type: "reasoningReviewPreference" }>["preference"];
/** Bounded preference patch sent back to the host; only present keys are written. */
export type ReasoningReviewPreferencePatch = Extract<
  UIToHostMessage,
  { type: "setReasoningReviewPreference" }
>["preference"];

type ReasoningReviewHostMessage = Extract<HostToUIMessage, { type: "reasoningRuntime" | "reasoningReviewPreference" }>;

/**
 * Runtime and preference state for the availability-gated settings control.
 * There is no completed-message review surface: assistance is prompt-scoped and
 * owned by the host.
 */
export function useReasoningReview() {
  const [runtime, setRuntime] = useState<ReasoningReviewRuntime | null>(null);
  const [preference, setPreference] = useState<ReasoningReviewPreference | null>(null);

  const updatePreference = useCallback((patch: ReasoningReviewPreferencePatch) => {
    postMessage({ type: "setReasoningReviewPreference", preference: patch });
  }, []);

  const handleHostMessage = useCallback((message: ReasoningReviewHostMessage) => {
    if (message.type === "reasoningRuntime") {
      setRuntime(message.runtime);
      return;
    }

    setPreference(message.preference);
  }, []);

  return { runtime, preference, updatePreference, handleHostMessage } as const;
}
