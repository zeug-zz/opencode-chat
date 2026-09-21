import type {
  AgentEvent,
  HostToUIMessage,
  ReasoningReviewRuntime,
  ReasoningReviewSummary,
  UIToHostMessage,
} from "@opencode-chat/core";
import { type RefObject, useCallback, useRef, useState } from "react";
import { postMessage } from "../vscode-api";

export type ReasoningReviewSummaries = ReadonlyMap<string, ReadonlyMap<string, ReasoningReviewSummary>>;
export type ReasoningReviewPending = ReadonlyMap<string, ReadonlySet<string>>;
/** Bounded local review-card feedback: two booleans, never content or paths. */
export type ReasoningReviewFeedback = Readonly<{ correct: boolean; falseChallenge?: boolean }>;
export type ReasoningReviewFeedbackMap = ReadonlyMap<string, ReasoningReviewFeedback>;
/** Host-published preference for the availability-gated settings control. */
export type ReasoningReviewPreference = Extract<HostToUIMessage, { type: "reasoningReviewPreference" }>["preference"];
/** Bounded preference patch sent back to the host; only present keys are written. */
export type ReasoningReviewPreferencePatch = Extract<
  UIToHostMessage,
  { type: "setReasoningReviewPreference" }
>["preference"];

type ReasoningReviewHostMessage = Extract<
  HostToUIMessage,
  { type: "reasoningRuntime" | "reasoningReviewPreference" | "reasoningReview" }
>;

/** Ephemeral review state, explicitly scoped by session and assistant message. */
export function useReasoningReview(activeSessionRef: RefObject<{ id: string } | null>) {
  const [runtime, setRuntime] = useState<ReasoningReviewRuntime | null>(null);
  const [preference, setPreference] = useState<ReasoningReviewPreference | null>(null);
  const [summaries, setSummaries] = useState<ReasoningReviewSummaries>(new Map());
  const [feedback, setFeedback] = useState<ReasoningReviewFeedbackMap>(new Map());
  const [pending, setPending] = useState<ReasoningReviewPending>(new Map());
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const cancelledKeysRef = useRef<Set<string>>(new Set());
  const submittedFeedbackKeysRef = useRef<Set<string>>(new Set());

  const updatePreference = useCallback((patch: ReasoningReviewPreferencePatch) => {
    postMessage({ type: "setReasoningReviewPreference", preference: patch });
  }, []);

  const getSummary = useCallback(
    (sessionId: string, messageId: string): ReasoningReviewSummary | undefined =>
      summaries.get(sessionId)?.get(messageId),
    [summaries],
  );

  const isReviewing = useCallback(
    (sessionId: string, messageId: string) => pendingKeysRef.current.has(`${sessionId}:${messageId}`),
    [],
  );

  const getFeedback = useCallback(
    (sessionId: string, messageId: string): ReasoningReviewFeedback | undefined =>
      feedback.get(`${sessionId}:${messageId}`),
    [feedback],
  );

  /**
   * Post one bounded feedback tuple at most once per session/message. Only the
   * two booleans leave the webview; response text and paths are never carried.
   */
  const submitFeedback = useCallback((sessionId: string, messageId: string, value: ReasoningReviewFeedback) => {
    const key = `${sessionId}:${messageId}`;
    if (submittedFeedbackKeysRef.current.has(key)) return;
    submittedFeedbackKeysRef.current.add(key);
    const normalized: ReasoningReviewFeedback = {
      correct: value.correct === true,
      ...(value.falseChallenge === true ? { falseChallenge: true } : {}),
    };
    setFeedback((previous) => {
      const next = new Map(previous);
      next.set(key, normalized);
      return next;
    });
    postMessage({ type: "setReasoningReviewFeedback", sessionId, messageId, ...normalized });
  }, []);

  const startReview = useCallback(
    (sessionId: string, messageId: string) => {
      if (isReviewing(sessionId, messageId)) return;
      pendingKeysRef.current.add(`${sessionId}:${messageId}`);
      setPending((previous) => {
        const sessionPending = new Set(previous.get(sessionId) ?? []);
        sessionPending.add(messageId);
        const next = new Map(previous);
        next.set(sessionId, sessionPending);
        return next;
      });
      cancelledKeysRef.current.delete(`${sessionId}:${messageId}`);
      postMessage({ type: "requestReasoningReview", sessionId, messageId });
    },
    [isReviewing],
  );

  const cancelReview = useCallback(
    (sessionId: string, messageId: string) => {
      if (!isReviewing(sessionId, messageId)) return;
      pendingKeysRef.current.delete(`${sessionId}:${messageId}`);
      setPending((previous) => {
        const sessionPending = new Set(previous.get(sessionId) ?? []);
        sessionPending.delete(messageId);
        const next = new Map(previous);
        if (sessionPending.size === 0) next.delete(sessionId);
        else next.set(sessionId, sessionPending);
        return next;
      });
      cancelledKeysRef.current.add(`${sessionId}:${messageId}`);
      postMessage({ type: "cancelReasoningReview", sessionId, messageId });
    },
    [isReviewing],
  );

  const handleHostMessage = useCallback(
    (message: ReasoningReviewHostMessage) => {
      if (message.type === "reasoningRuntime") {
        setRuntime(message.runtime);
        return;
      }

      if (message.type === "reasoningReviewPreference") {
        setPreference(message.preference);
        return;
      }

      if (message.sessionId !== activeSessionRef.current?.id) return;

      const key = `${message.sessionId}:${message.summary.reviewedMessageId}`;
      if (cancelledKeysRef.current.has(key)) {
        cancelledKeysRef.current.delete(key);
        return;
      }

      pendingKeysRef.current.delete(key);

      setPending((previous) => {
        const sessionPending = new Set(previous.get(message.sessionId) ?? []);
        sessionPending.delete(message.summary.reviewedMessageId);
        const next = new Map(previous);
        if (sessionPending.size === 0) next.delete(message.sessionId);
        else next.set(message.sessionId, sessionPending);
        return next;
      });

      setSummaries((previous) => {
        const sessionSummaries = new Map(previous.get(message.sessionId) ?? []);
        sessionSummaries.set(message.summary.reviewedMessageId, message.summary);
        const next = new Map(previous);
        next.set(message.sessionId, sessionSummaries);
        return next;
      });
    },
    [activeSessionRef],
  );

  const clearSessionState = useCallback((sessionId?: string) => {
    setPending((previous) => {
      if (sessionId === undefined) return new Map();
      if (!previous.has(sessionId)) return previous;
      const next = new Map(previous);
      next.delete(sessionId);
      return next;
    });
    if (sessionId === undefined) pendingKeysRef.current.clear();
    else
      for (const key of pendingKeysRef.current) if (key.startsWith(`${sessionId}:`)) pendingKeysRef.current.delete(key);
    if (sessionId === undefined) cancelledKeysRef.current.clear();
    else
      for (const key of cancelledKeysRef.current)
        if (key.startsWith(`${sessionId}:`)) cancelledKeysRef.current.delete(key);
    setSummaries((previous) => {
      if (sessionId === undefined) return new Map();
      if (!previous.has(sessionId)) return previous;
      const next = new Map(previous);
      next.delete(sessionId);
      return next;
    });
    if (sessionId === undefined) submittedFeedbackKeysRef.current.clear();
    else
      for (const key of submittedFeedbackKeysRef.current)
        if (key.startsWith(`${sessionId}:`)) submittedFeedbackKeysRef.current.delete(key);
    setFeedback((previous) => {
      if (sessionId === undefined) return new Map();
      let changed = false;
      const next = new Map(previous);
      for (const key of previous.keys())
        if (key.startsWith(`${sessionId}:`)) {
          next.delete(key);
          changed = true;
        }
      return changed ? next : previous;
    });
  }, []);

  const handleSessionEvent = useCallback((event: AgentEvent) => {
    if (event.type !== "session.deleted") return;
    const deletedSessionId = event.properties.info.id;
    setPending((previous) => {
      if (!previous.has(deletedSessionId)) return previous;
      const next = new Map(previous);
      next.delete(deletedSessionId);
      return next;
    });
    for (const key of pendingKeysRef.current)
      if (key.startsWith(`${deletedSessionId}:`)) pendingKeysRef.current.delete(key);
    for (const key of cancelledKeysRef.current)
      if (key.startsWith(`${deletedSessionId}:`)) cancelledKeysRef.current.delete(key);
    setSummaries((previous) => {
      if (!previous.has(deletedSessionId)) return previous;
      const next = new Map(previous);
      next.delete(deletedSessionId);
      return next;
    });
    for (const key of submittedFeedbackKeysRef.current)
      if (key.startsWith(`${deletedSessionId}:`)) submittedFeedbackKeysRef.current.delete(key);
    setFeedback((previous) => {
      let changed = false;
      const next = new Map(previous);
      for (const key of previous.keys())
        if (key.startsWith(`${deletedSessionId}:`)) {
          next.delete(key);
          changed = true;
        }
      return changed ? next : previous;
    });
  }, []);

  return {
    runtime,
    preference,
    summaries,
    feedback,
    pending,
    getSummary,
    getFeedback,
    isReviewing,
    startReview,
    cancelReview,
    submitFeedback,
    updatePreference,
    handleHostMessage,
    handleSessionEvent,
    clearSessionState,
  } as const;
}
