import type { HostToUIMessage } from "@opencode-chat/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReasoningReview } from "../../hooks/useReasoningReview";
import { postMessage } from "../../vscode-api";

describe("useReasoningReview", () => {
  it("keeps runtime state separate and typed", () => {
    const { result } = renderHook(() => useReasoningReview());
    const runtime: HostToUIMessage = { type: "reasoningRuntime", runtime: { state: "unavailable" } };

    act(() => result.current.handleHostMessage(runtime));

    expect(result.current.runtime).toEqual({ state: "unavailable" });
    expect(result.current.preference).toBeNull();
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

  it("exposes no completed-message review surface or review messages", () => {
    const { result } = renderHook(() => useReasoningReview());
    vi.mocked(postMessage).mockClear();

    const surface: Record<string, unknown> = result.current;
    for (const field of [
      "summaries",
      "feedback",
      "pending",
      "getSummary",
      "getFeedback",
      "isReviewing",
      "startReview",
      "cancelReview",
      "submitFeedback",
      "handleSessionEvent",
      "clearSessionState",
    ]) {
      expect(surface[field]).toBeUndefined();
    }
    expect(Object.keys(surface).sort()).toEqual(["handleHostMessage", "preference", "runtime", "updatePreference"]);

    const outbound = vi.mocked(postMessage).mock.calls.map(([message]) => message);
    expect(outbound).toEqual([]);
  });
});
