import type { ReasoningAssistStage, ReasoningAssistSummary } from "@opencode-chat/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReasoningAssist } from "../../hooks/useReasoningAssist";

const summary: ReasoningAssistSummary = {
  candidateConclusion: "Structure supports one bounded conclusion.",
  assumptions: ["Assumption one", "Assumption two"],
  evidenceBoundary: "Only same-thread evidence was considered.",
  criticObjections: [
    { target: "candidate_conclusion", objection: "Scope may exceed the evidence." },
    { target: "assumption", objection: "The second assumption may not hold." },
  ],
  afFact: "recorded_structure",
};

function progressMessage(stage: ReasoningAssistStage, promptToken = "token-1", sessionId = "session-1") {
  return { type: "reasoningAssistProgress" as const, sessionId, promptToken, stage };
}

function summaryMessage(promptToken = "token-1", sessionId = "session-1") {
  return { type: "reasoningAssistSummary" as const, sessionId, promptToken, summary };
}

function clearedMessage(promptToken = "token-1", sessionId = "session-1") {
  return { type: "reasoningAssistCleared" as const, sessionId, promptToken };
}

describe("useReasoningAssist", () => {
  it("tracks ordered progress for a prompt token", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("assessing")));
    act(() => result.current.handleHostMessage(progressMessage("mapping")));
    act(() => result.current.handleHostMessage(progressMessage("recording")));

    const rows = result.current.rowsForSession("session-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: "session-1",
      promptToken: "token-1",
      stage: "recording",
      applied: false,
    });
    expect(rows[0].summary).toBeUndefined();
  });

  it("keeps first-seen insertion order across prompt tokens", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-1")));
    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-2")));
    act(() => result.current.handleHostMessage(progressMessage("mapping", "token-1")));

    expect(result.current.rowsForSession("session-1").map((row) => row.promptToken)).toEqual(["token-1", "token-2"]);
  });

  it("latches applied once the applied stage arrives", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("preparing")));
    act(() => result.current.handleHostMessage(summaryMessage()));
    act(() => result.current.handleHostMessage(progressMessage("applied")));
    act(() => result.current.handleHostMessage(progressMessage("preparing")));

    const row = result.current.rowsForSession("session-1")[0];
    expect(row.applied).toBe(true);
    expect(row.summary).toEqual(summary);
  });

  it("attaches only the validated summary and no raw fields", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("preparing")));
    act(() => result.current.handleHostMessage(summaryMessage()));

    const row = result.current.rowsForSession("session-1")[0];
    expect(row.summary).toEqual(summary);
    const allowedRowKeys = new Set(["sessionId", "promptToken", "stage", "summary", "applied", "anchorMessageId"]);
    for (const key of Object.keys(row)) {
      expect(allowedRowKeys.has(key)).toBe(true);
    }
    expect(Object.keys(row.summary ?? {}).sort()).toEqual(Object.keys(summary).sort());
  });

  it("creates a preparing row from a summary without prior progress", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(summaryMessage()));

    expect(result.current.rowsForSession("session-1")[0]).toMatchObject({ stage: "preparing", summary });
  });

  it("clears only the addressed prompt token", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-1")));
    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-2")));
    act(() => result.current.handleHostMessage(clearedMessage("token-1")));

    const rows = result.current.rowsForSession("session-1");
    expect(rows.map((row) => row.promptToken)).toEqual(["token-2"]);
    expect(rows[0].stage).toBe("assessing");

    act(() => result.current.handleHostMessage(clearedMessage("token-2")));

    expect(result.current.rowsForSession("session-1")).toEqual([]);
  });

  it("removes pending activity on cleared and stays empty for duplicate clears", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("mapping")));
    expect(result.current.rowsForSession("session-1")).toHaveLength(1);

    act(() => result.current.handleHostMessage(clearedMessage()));
    expect(result.current.rowsForSession("session-1")).toEqual([]);

    // 二重の cleared（再キャンセル）は state を変えない
    const afterFirstClear = result.current.rowsForSession;
    act(() => result.current.handleHostMessage(clearedMessage()));
    expect(result.current.rowsForSession("session-1")).toEqual([]);
    expect(result.current.rowsForSession).toBe(afterFirstClear);
  });

  it("keeps a newer pending row when a stale token is cleared", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-stale-old")));
    act(() => result.current.handleHostMessage(progressMessage("mapping", "token-new")));
    act(() => result.current.handleHostMessage(clearedMessage("token-stale-old")));

    const rows = result.current.rowsForSession("session-1");
    expect(rows.map((row) => row.promptToken)).toEqual(["token-new"]);
    expect(rows[0].stage).toBe("mapping");

    act(() => result.current.handleHostMessage(clearedMessage("token-new")));
    expect(result.current.rowsForSession("session-1")).toEqual([]);
  });

  it("keeps an applied row when a newer pending token is cleared", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("preparing", "token-applied")));
    act(() => result.current.handleHostMessage(summaryMessage("token-applied")));
    act(() => result.current.handleHostMessage(progressMessage("applied", "token-applied")));
    act(() => result.current.handleHostMessage(progressMessage("mapping", "token-newer")));
    act(() => result.current.handleHostMessage(clearedMessage("token-newer")));

    const rows = result.current.rowsForSession("session-1");
    expect(rows.map((row) => row.promptToken)).toEqual(["token-applied"]);
    expect(rows[0]).toMatchObject({ applied: true, summary });
  });

  it("drops pending-only sessions on a session change and stays idempotent", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("critiquing", "token-pending")));
    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-other", "session-2")));

    act(() => result.current.clearPendingOnSessionChange());

    expect(result.current.rowsForSession("session-1")).toEqual([]);
    expect(result.current.rowsForSession("session-2")).toEqual([]);

    const afterFirstClear = result.current.rowsForSession;
    act(() => result.current.clearPendingOnSessionChange());
    expect(result.current.rowsForSession).toBe(afterFirstClear);
  });

  it("drops pending rows but retains applied summary rows on a session change", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-1")));
    act(() => result.current.handleHostMessage(progressMessage("preparing", "token-2")));
    act(() => result.current.handleHostMessage(summaryMessage("token-2")));
    act(() => result.current.handleHostMessage(progressMessage("applied", "token-2")));
    act(() => result.current.handleHostMessage(progressMessage("applied", "token-3")));
    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-4", "session-2")));

    act(() => result.current.clearPendingOnSessionChange());

    expect(result.current.rowsForSession("session-1").map((row) => row.promptToken)).toEqual(["token-2"]);
    expect(result.current.rowsForSession("session-1")[0]).toMatchObject({ applied: true, summary });
    expect(result.current.rowsForSession("session-2")).toEqual([]);
  });

  it("anchors only rows without an anchor and never overwrites an existing one", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() =>
      result.current.handleHostMessage(progressMessage("assessing", "token-anchored"), {
        anchorMessageId: "user-message-1",
      }),
    );
    act(() => result.current.handleHostMessage(progressMessage("assessing", "token-pending")));

    act(() => result.current.anchorUnanchoredRows("session-1", "user-message-9"));

    const rows = result.current.rowsForSession("session-1");
    expect(rows.find((row) => row.promptToken === "token-anchored")?.anchorMessageId).toBe("user-message-1");
    expect(rows.find((row) => row.promptToken === "token-pending")?.anchorMessageId).toBe("user-message-9");
  });

  it("keeps the previous state when there is nothing to anchor or the session is unknown", () => {
    const { result } = renderHook(() => useReasoningAssist());

    // 行が無い場合は state を変更しない（同一の rowsForSession 参照が保たれる）
    const beforeNoRows = result.current.rowsForSession;
    act(() => result.current.anchorUnanchoredRows("session-1", "user-message-1"));
    expect(result.current.rowsForSession).toBe(beforeNoRows);

    act(() =>
      result.current.handleHostMessage(progressMessage("mapping", "token-1"), { anchorMessageId: "user-message-1" }),
    );
    const beforeAnchored = result.current.rowsForSession;
    act(() => result.current.anchorUnanchoredRows("session-1", "user-message-2"));
    expect(result.current.rowsForSession).toBe(beforeAnchored);

    // 別セッションの呼び出しは既存行に影響しない
    const beforeOtherSession = result.current.rowsForSession;
    act(() => result.current.anchorUnanchoredRows("missing-session", "user-message-3"));
    expect(result.current.rowsForSession).toBe(beforeOtherSession);
    expect(result.current.rowsForSession("session-1")[0].anchorMessageId).toBe("user-message-1");
  });

  it("isolates rows per session", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("mapping", "token-1", "session-1")));
    act(() => result.current.handleHostMessage(progressMessage("critiquing", "token-2", "session-2")));

    expect(result.current.rowsForSession("session-1")).toHaveLength(1);
    expect(result.current.rowsForSession("session-2")).toHaveLength(1);
    expect(result.current.rowsForSession("missing-session")).toEqual([]);
    expect(result.current.rowsForSession("session-2")[0].stage).toBe("critiquing");
  });

  it("sets the anchor once and never overwrites it", () => {
    const { result } = renderHook(() => useReasoningAssist());

    act(() => result.current.handleHostMessage(progressMessage("assessing"), { anchorMessageId: "user-message-1" }));
    act(() => result.current.handleHostMessage(progressMessage("mapping"), { anchorMessageId: "user-message-2" }));
    act(() => result.current.handleHostMessage(summaryMessage(), { anchorMessageId: "user-message-3" }));

    expect(result.current.rowsForSession("session-1")[0].anchorMessageId).toBe("user-message-1");
  });

  it("exposes only the bounded assist surface", () => {
    const { result } = renderHook(() => useReasoningAssist());

    expect(Object.keys(result.current).sort()).toEqual([
      "anchorUnanchoredRows",
      "clearPendingOnSessionChange",
      "handleHostMessage",
      "rowsForSession",
    ]);
  });
});
