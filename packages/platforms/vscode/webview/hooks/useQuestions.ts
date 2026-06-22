import type { AgentEvent, ChatSession, QuestionRequest } from "@opencode-chat/core";
import { type RefObject, useCallback, useState } from "react";

/**
 * AI からの質問リクエスト（選択式 UI）の状態管理フック。
 *
 * AI が質問を投げると question.asked で質問リクエストが届き、
 * ユーザーが回答すると question.replied で、拒否すると question.rejected で解消される。
 * Map が空でなければ未回答の質問があり、QuestionView が表示される。
 */
export function useQuestions(activeSessionRef: RefObject<ChatSession | null>) {
  const [questions, setQuestions] = useState<Map<string, QuestionRequest>>(new Map());

  const addQuestion = useCallback((question: QuestionRequest) => {
    setQuestions((prev) => {
      const next = new Map(prev);
      next.set(question.id, question);
      return next;
    });
  }, []);

  const removeQuestion = useCallback((requestID: string) => {
    setQuestions((prev) => {
      const next = new Map(prev);
      next.delete(requestID);
      return next;
    });
  }, []);

  const handleQuestionEvent = useCallback(
    (event: AgentEvent) => {
      const activeId = activeSessionRef.current?.id;
      switch (event.type) {
        case "question.asked": {
          if (activeId && event.properties.sessionID !== activeId) break;
          addQuestion(event.properties);
          break;
        }
        case "question.replied":
          removeQuestion(event.properties.requestID);
          break;
        case "question.rejected":
          removeQuestion(event.properties.requestID);
          break;
      }
    },
    [activeSessionRef, addQuestion, removeQuestion],
  );

  return {
    questions,
    handleQuestionEvent,
  } as const;
}
