import type { AgentEvent, ChatSession, HostToUIMessage, ReasoningReviewSummary } from "@opencode-chat/core";
import { act, renderHook } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { useReasoningReview } from "../../hooks/useReasoningReview";
import { postMessage } from "../../vscode-api";

function createSessionRef(sessionId: string | null): RefObject<ChatSession | null> {
  const ref = createRef<ChatSession | null>() as { current: ChatSession | null };
  ref.current = sessionId ? ({ id: sessionId } as ChatSession) : null;
  return ref;
}

function summary(messageId: string, conclusion = messageId): ReasoningReviewSummary {
  return {
    reviewedMessageId: messageId,
    status: "unavailable",
    invocation: "manual",
    conclusion,
    assumptions: [],
    evidenceStatus: "not_assessed",
    openChallenges: [],
  };
}

function reviewMessage(sessionId: string, review: ReasoningReviewSummary): HostToUIMessage {
  return { type: "reasoningReview", sessionId, summary: review };
}

describe("useReasoningReview", () => {
  it("posts only the typed request once while a review is pending, then cancels it", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));
    vi.mocked(postMessage).mockClear();

    act(() => {
      result.current.startReview("session-a", "message-1");
      result.current.startReview("session-a", "message-1");
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "requestReasoningReview",
      sessionId: "session-a",
      messageId: "message-1",
    });
    expect(result.current.isReviewing("session-a", "message-1")).toBe(true);

    act(() => result.current.cancelReview("session-a", "message-1"));

    expect(postMessage).toHaveBeenLastCalledWith({
      type: "cancelReasoningReview",
      sessionId: "session-a",
      messageId: "message-1",
    });
    expect(result.current.isReviewing("session-a", "message-1")).toBe(false);
  });

  it("ignores a late completion after cancellation without exposing request data", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));

    act(() => result.current.startReview("session-a", "message-1"));
    act(() => result.current.cancelReview("session-a", "message-1"));
    act(() => result.current.handleHostMessage(reviewMessage("session-a", summary("message-1", "private source"))));

    expect(result.current.getSummary("session-a", "message-1")).toBeUndefined();
    const outbound = vi.mocked(postMessage).mock.calls.map(([message]) => message);
    expect(JSON.stringify(outbound)).not.toContain("private source");
  });

  it("keeps summaries isolated by session and assistant message", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));

    act(() => {
      result.current.handleHostMessage(reviewMessage("session-a", summary("message-1", "A1")));
      result.current.handleHostMessage(reviewMessage("session-a", summary("message-2", "A2")));
    });

    expect(result.current.getSummary("session-a", "message-1")?.conclusion).toBe("A1");
    expect(result.current.getSummary("session-a", "message-2")?.conclusion).toBe("A2");
    expect(result.current.getSummary("session-b", "message-1")).toBeUndefined();
  });

  it("replaces a summary deterministically for the same session/message key", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));

    act(() => {
      result.current.handleHostMessage(reviewMessage("session-a", summary("message-1", "old")));
      result.current.handleHostMessage(reviewMessage("session-a", summary("message-1", "new")));
    });

    expect(result.current.getSummary("session-a", "message-1")?.conclusion).toBe("new");
  });

  it("ignores inactive-session summaries and clears deleted sessions", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));
    const deleted: AgentEvent = {
      type: "session.deleted",
      properties: { info: { id: "session-a" } },
    } as AgentEvent;

    act(() => {
      result.current.handleHostMessage(reviewMessage("session-b", summary("message-1", "foreign")));
      result.current.handleHostMessage(reviewMessage("session-a", summary("message-1", "owned")));
      result.current.handleSessionEvent(deleted);
    });

    expect(result.current.getSummary("session-b", "message-1")).toBeUndefined();
    expect(result.current.getSummary("session-a", "message-1")).toBeUndefined();
  });

  it("keeps runtime state separate and typed", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));
    const runtime: HostToUIMessage = { type: "reasoningRuntime", runtime: { state: "unavailable" } };

    act(() => result.current.handleHostMessage(runtime));

    expect(result.current.runtime).toEqual({ state: "unavailable" });
    expect(result.current.summaries.size).toBe(0);
  });

  it("stores the host-published preference and posts only the bounded patch", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));
    vi.mocked(postMessage).mockClear();

    act(() =>
      result.current.handleHostMessage({
        type: "reasoningReviewPreference",
        preference: { userEnabled: true, workspaceOptOut: true, effective: false },
      }),
    );

    expect(result.current.preference).toEqual({ userEnabled: true, workspaceOptOut: true, effective: false });

    act(() => result.current.updatePreference({ workspaceOptOut: false }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "setReasoningReviewPreference",
      preference: { workspaceOptOut: false },
    });
  });

  it("posts each bounded feedback tuple once and keeps it keyed by session/message", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));
    vi.mocked(postMessage).mockClear();

    act(() => result.current.submitFeedback("session-a", "message-1", { correct: true }));
    act(() => result.current.submitFeedback("session-a", "message-1", { correct: false, falseChallenge: true }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "setReasoningReviewFeedback",
      sessionId: "session-a",
      messageId: "message-1",
      correct: true,
    });
    expect(result.current.getFeedback("session-a", "message-1")).toEqual({ correct: true });
    expect(result.current.getFeedback("session-a", "message-2")).toBeUndefined();
    expect(result.current.getFeedback("session-b", "message-1")).toBeUndefined();

    act(() => result.current.submitFeedback("session-a", "message-2", { correct: false, falseChallenge: true }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "setReasoningReviewFeedback",
      sessionId: "session-a",
      messageId: "message-2",
      correct: false,
      falseChallenge: true,
    });
  });

  it("carries no content or paths in outbound feedback and clears deleted sessions", () => {
    const ref = createSessionRef("session-a");
    const { result } = renderHook(() => useReasoningReview(ref));
    vi.mocked(postMessage).mockClear();

    act(() => result.current.submitFeedback("session-a", "message-1", { correct: false, falseChallenge: true }));

    const outbound = vi.mocked(postMessage).mock.calls.map(([message]) => message);
    expect(JSON.stringify(outbound)).not.toMatch(/prompt|source|response|path|workspace/iu);

    act(() =>
      result.current.handleSessionEvent({
        type: "session.deleted",
        properties: { info: { id: "session-a" } },
      } as AgentEvent),
    );
    expect(result.current.getFeedback("session-a", "message-1")).toBeUndefined();
  });
});
