import type { HostToUIMessage, ReasoningReviewSummary } from "@opencode-chat/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReasoningReview } from "../../hooks/useReasoningReview";
import { postMessage } from "../../vscode-api";

const summary: ReasoningReviewSummary = {
  reviewedMessageId: "answer-1",
  status: "conditional",
  invocation: "manual",
  conclusion: "The conclusion depends on the stated assumption or unverified evidence.",
  assumptions: ["The premise applies to this case."],
  evidenceStatus: "source_recorded",
  openChallenges: [{ severity: "major", target: "claim:claim-1", reason: "The objection remains open." }],
};

describe("useReasoningReview", () => {
  it("keeps runtime state separate and typed", () => {
    const { result } = renderHook(() => useReasoningReview());
    const runtime: HostToUIMessage = { type: "reasoningRuntime", runtime: { state: "unavailable" } };

    act(() => result.current.handleHostMessage(runtime));

    expect(result.current.runtime).toEqual({ state: "unavailable" });
    expect(result.current.preference).toBeNull();
    expect(result.current.reviews.size).toBe(0);
  });

  it("stores the host-published preference and posts only the bounded patch", () => {
    const { result } = renderHook(() => useReasoningReview());
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

  it("posts a typed request only when review readiness is available", () => {
    const { result } = renderHook(() => useReasoningReview());
    vi.mocked(postMessage).mockClear();

    act(() => result.current.requestReview("session-1", "answer-1"));
    expect(postMessage).not.toHaveBeenCalled();
    expect(result.current.reviews.size).toBe(0);

    act(() => result.current.handleHostMessage({ type: "reasoningRuntime", runtime: { state: "available" } }));
    act(() => result.current.requestReview("session-1", "answer-1"));

    const state = result.current.reviews.get("session-1\u0000answer-1");
    expect(state).toMatchObject({ phase: "reviewing", stage: "claimProjection" });
    expect(postMessage).toHaveBeenCalledWith({
      type: "requestReasoningReview",
      sessionId: "session-1",
      messageId: "answer-1",
      requestId: expect.stringMatching(/^manual-review-/u),
    });
  });

  it("applies progress and normalized results only to the matching request", () => {
    const { result } = renderHook(() => useReasoningReview());
    act(() => result.current.handleHostMessage({ type: "reasoningRuntime", runtime: { state: "available" } }));
    act(() => result.current.requestReview("session-1", "answer-1"));
    const key = "session-1\u0000answer-1";
    const requestId = result.current.reviews.get(key)?.requestId;
    if (!requestId) throw new Error("review request was not created");

    act(() =>
      result.current.handleHostMessage({
        type: "reasoningReviewProgress",
        sessionId: "session-1",
        messageId: "answer-1",
        requestId: "stale-request",
        stage: "adversarialReview",
      }),
    );
    expect(result.current.reviews.get(key)).toMatchObject({ phase: "reviewing", stage: "claimProjection" });

    act(() =>
      result.current.handleHostMessage({
        type: "reasoningReviewProgress",
        sessionId: "session-1",
        messageId: "answer-1",
        requestId,
        stage: "adversarialReview",
      }),
    );
    expect(result.current.reviews.get(key)).toMatchObject({ phase: "reviewing", stage: "adversarialReview" });

    act(() =>
      result.current.handleHostMessage({
        type: "reasoningReviewResult",
        sessionId: "session-1",
        messageId: "answer-1",
        requestId,
        summary: { ...summary, reviewedMessageId: "another-answer" },
      }),
    );
    expect(result.current.reviews.get(key)?.phase).toBe("reviewing");

    act(() =>
      result.current.handleHostMessage({
        type: "reasoningReviewResult",
        sessionId: "session-1",
        messageId: "answer-1",
        requestId,
        summary,
      }),
    );
    expect(result.current.reviews.get(key)).toEqual({ phase: "result", requestId, summary });
  });

  it("marks explicit cancellation and clears review state on session change", () => {
    const { result } = renderHook(() => useReasoningReview());
    vi.mocked(postMessage).mockClear();
    act(() => result.current.handleHostMessage({ type: "reasoningRuntime", runtime: { state: "available" } }));
    act(() => result.current.requestReview("session-1", "answer-1"));
    const key = "session-1\u0000answer-1";
    const requestId = result.current.reviews.get(key)?.requestId;
    if (!requestId) throw new Error("review request was not created");

    act(() => result.current.cancelReview("session-1", "answer-1"));
    expect(result.current.reviews.get(key)).toMatchObject({ phase: "cancelling", requestId });
    expect(postMessage).toHaveBeenCalledWith({
      type: "cancelReasoningReview",
      sessionId: "session-1",
      messageId: "answer-1",
      requestId,
    });

    act(() =>
      result.current.handleHostMessage({
        type: "reasoningReviewCancelled",
        sessionId: "session-1",
        messageId: "answer-1",
        requestId,
      }),
    );
    expect(result.current.reviews.get(key)).toEqual({ phase: "cancelled", requestId });

    act(() => result.current.clearReviews());
    expect(result.current.reviews.size).toBe(0);
  });
});
