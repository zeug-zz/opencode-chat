import type { AgentEvent, ChatSession } from "@opencode-chat/core";
import { act, renderHook } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { describe, expect, it } from "vitest";
import { useQuestions } from "../../hooks/useQuestions";

function createSessionRef(session: ChatSession | null = null): RefObject<ChatSession | null> {
  const ref = createRef<ChatSession | null>() as { current: ChatSession | null };
  ref.current = session;
  return ref;
}

describe("useQuestions", () => {
  // initial state
  context("初期状態の場合", () => {
    // questions is empty
    it("questions が空の Map であること", () => {
      const { result } = renderHook(() => useQuestions(createSessionRef()));
      expect(result.current.questions.size).toBe(0);
    });
  });

  // question.asked
  context("question.asked イベントを受信した場合", () => {
    // adds question request to the map
    it("questions に追加されること", () => {
      const ref = createSessionRef({ id: "active" } as ChatSession);
      const { result } = renderHook(() => useQuestions(ref));
      const event = {
        type: "question.asked",
        properties: {
          id: "req-1",
          sessionID: "active",
          questions: [
            { question: "Which tool?", header: "Tool selection", options: [{ label: "A", description: "" }] },
          ],
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(event));
      expect(result.current.questions.has("req-1")).toBe(true);
    });

    // stores the question request data
    it("QuestionRequest のデータが保持されること", () => {
      const ref = createSessionRef({ id: "active" } as ChatSession);
      const { result } = renderHook(() => useQuestions(ref));
      const questionRequest = {
        id: "req-1",
        sessionID: "active",
        questions: [{ question: "Which tool?", header: "Tool selection", options: [{ label: "A", description: "" }] }],
      };
      const event = { type: "question.asked", properties: questionRequest } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(event));
      expect(result.current.questions.get("req-1")).toEqual(questionRequest);
    });

    // handles multiple question requests
    it("複数のリクエストを保持できること", () => {
      const ref = createSessionRef({ id: "active" } as ChatSession);
      const { result } = renderHook(() => useQuestions(ref));
      const event1 = {
        type: "question.asked",
        properties: {
          id: "req-1",
          sessionID: "active",
          questions: [{ question: "Q1", header: "H1", options: [] }],
        },
      } as unknown as AgentEvent;
      const event2 = {
        type: "question.asked",
        properties: {
          id: "req-2",
          sessionID: "active",
          questions: [{ question: "Q2", header: "H2", options: [] }],
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(event1));
      act(() => result.current.handleQuestionEvent(event2));
      expect(result.current.questions.size).toBe(2);
    });

    // foreign session question is ignored
    it("別セッションの question.asked は無視されること", () => {
      const ref = createSessionRef({ id: "active" } as ChatSession);
      const { result } = renderHook(() => useQuestions(ref));
      const event = {
        type: "question.asked",
        properties: {
          id: "req-1",
          sessionID: "other",
          questions: [
            { question: "Which tool?", header: "Tool selection", options: [{ label: "A", description: "" }] },
          ],
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(event));
      expect(result.current.questions.has("req-1")).toBe(false);
    });
  });

  // question.replied
  context("question.replied イベントを受信した場合", () => {
    // removes question from the map
    it("questions から削除されること", () => {
      const ref = createSessionRef({ id: "active" } as ChatSession);
      const { result } = renderHook(() => useQuestions(ref));
      // first add
      const addEvent = {
        type: "question.asked",
        properties: {
          id: "req-1",
          sessionID: "active",
          questions: [{ question: "Q?", header: "H", options: [] }],
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(addEvent));
      // then reply
      const replyEvent = {
        type: "question.replied",
        properties: { sessionID: "active", requestID: "req-1" },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(replyEvent));
      expect(result.current.questions.has("req-1")).toBe(false);
    });
  });

  // question.rejected
  context("question.rejected イベントを受信した場合", () => {
    // removes question from the map
    it("questions から削除されること", () => {
      const ref = createSessionRef({ id: "active" } as ChatSession);
      const { result } = renderHook(() => useQuestions(ref));
      // first add
      const addEvent = {
        type: "question.asked",
        properties: {
          id: "req-1",
          sessionID: "active",
          questions: [{ question: "Q?", header: "H", options: [] }],
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(addEvent));
      // then reject
      const rejectEvent = {
        type: "question.rejected",
        properties: { sessionID: "active", requestID: "req-1" },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(rejectEvent));
      expect(result.current.questions.has("req-1")).toBe(false);
    });
  });

  // unrelated events
  context("無関係なイベントを受信した場合", () => {
    // does not change questions
    it("questions が変わらないこと", () => {
      const { result } = renderHook(() => useQuestions(createSessionRef()));
      const event = {
        type: "session.updated",
        properties: { id: "session1" },
      } as unknown as AgentEvent;
      act(() => result.current.handleQuestionEvent(event));
      expect(result.current.questions.size).toBe(0);
    });
  });
});
