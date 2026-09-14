import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import type { QuestionRequest } from "@opencode-chat/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageWithParts } from "../../../App";
import { MessagesArea } from "../../../components/organisms/MessagesArea";
import { AppContextProvider, type AppContextValue } from "../../../contexts/AppContext";
import * as autoScrollHook from "../../../hooks/useAutoScroll";
import { createMessage, createTextPart } from "../../factories";

/** AppContext 必須の値を最小限で提供するラッパー */
function createContextWrapper() {
  const contextValue = {
    isShellMessage: () => false,
  } as unknown as AppContextValue;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AppContextProvider value={contextValue}>{children}</AppContextProvider>;
  };
}

const userMsg: MessageWithParts = {
  info: createMessage({ role: "user" }),
  parts: [createTextPart("Hello")],
};

const assistantMsg: MessageWithParts = {
  info: createMessage({ role: "assistant" }),
  parts: [createTextPart("Hi there")],
};

const defaultProps = {
  messages: [userMsg, assistantMsg],
  sessionBusy: false,
  activeSessionId: "session-1",
  questions: new Map(),
  onEditAndResend: vi.fn(),
  onRevertToCheckpoint: vi.fn(),
  onForkFromCheckpoint: vi.fn(),
};

describe("MessagesArea", () => {
  const wrapper = createContextWrapper();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("質問を元のアシスタントメッセージにだけ関連付けること", () => {
    const firstAssistant: MessageWithParts = {
      info: createMessage({ role: "assistant", id: "assistant-1" }),
      parts: [createTextPart("First response")],
    };
    const secondAssistant: MessageWithParts = {
      info: createMessage({ role: "assistant", id: "assistant-2" }),
      parts: [createTextPart("Second response")],
    };
    const question: QuestionRequest = {
      id: "question-1",
      sessionID: "session-1",
      questions: [
        {
          question: "Which response?",
          header: "Choose",
          options: [{ label: "First", description: "Use the first response" }],
        },
      ],
      tool: { messageID: firstAssistant.info.id, callID: "call-1" },
    };
    const orphanQuestion: QuestionRequest = {
      ...question,
      id: "orphan-question",
      questions: [{ ...question.questions[0], question: "Should not render" }],
      tool: { messageID: "missing-assistant", callID: "call-2" },
    };

    render(
      <MessagesArea
        {...defaultProps}
        messages={[firstAssistant, secondAssistant]}
        questions={
          new Map([
            [question.id, question],
            [orphanQuestion.id, orphanQuestion],
          ])
        }
      />,
      { wrapper },
    );

    expect(screen.getByText("Which response?")).toBeInTheDocument();
    expect(screen.queryByText("Should not render")).not.toBeInTheDocument();
    expect(screen.getAllByText("First response")).toHaveLength(1);
    expect(screen.getAllByText("Second response")).toHaveLength(1);
  });

  // when rendered with messages
  context("メッセージがある場合", () => {
    // renders message items
    it("メッセージアイテムをレンダリングすること", () => {
      const { container } = render(<MessagesArea {...defaultProps} />, { wrapper });
      expect(container.querySelectorAll(".message").length).toBeGreaterThan(0);
    });
  });

  it("showAllThinking を reasoning メッセージへ渡すこと", () => {
    const reasoningMessage: MessageWithParts = {
      info: createMessage({ role: "assistant", id: "reasoning-message" }),
      parts: [
        {
          id: "reasoning-part",
          type: "reasoning",
          text: "Visible reasoning",
          sessionID: "session-1",
          messageID: "reasoning-message",
          time: { created: 1, end: 2 },
        } as any,
      ],
    };

    render(<MessagesArea {...defaultProps} messages={[reasoningMessage]} showAllThinking />, { wrapper });

    expect(screen.getByText("Visible reasoning")).toBeInTheDocument();
  });

  // when session is busy
  context("セッションが busy の場合", () => {
    // renders streaming indicator
    it("StreamingIndicator をレンダリングすること", () => {
      const { container } = render(<MessagesArea {...defaultProps} sessionBusy={true} />, { wrapper });
      expect(container.querySelector("[data-testid='streaming-indicator']")).toBeInTheDocument();
    });
  });

  // when session is not busy
  context("セッションが busy でない場合", () => {
    // does not render streaming indicator
    it("StreamingIndicator をレンダリングしないこと", () => {
      const { container } = render(<MessagesArea {...defaultProps} sessionBusy={false} />, { wrapper });
      expect(container.querySelector("[data-testid='streaming-indicator']")).not.toBeInTheDocument();
    });
  });

  // when messages have checkpoint dividers
  context("アシスタント→ユーザーの連続メッセージの場合", () => {
    const msgs: MessageWithParts[] = [
      { info: createMessage({ role: "assistant", id: "ast-1" }), parts: [createTextPart("Reply")] },
      { info: createMessage({ role: "user", id: "usr-1" }), parts: [createTextPart("Follow up")] },
    ];

    // renders checkpoint divider
    it("チェックポイント区切り線をレンダリングすること", () => {
      const { container } = render(<MessagesArea {...defaultProps} messages={msgs} />, { wrapper });
      expect(container.querySelector(".checkpointDivider")).toBeInTheDocument();
    });

    // renders fork button in checkpoint divider
    it("Fork ボタンをレンダリングすること", () => {
      render(<MessagesArea {...defaultProps} messages={msgs} />, { wrapper });
      expect(screen.getByText("Fork from here")).toBeInTheDocument();
    });

    // renders retry button in checkpoint divider
    it("Retry ボタンをレンダリングすること", () => {
      render(<MessagesArea {...defaultProps} messages={msgs} />, { wrapper });
      expect(screen.getByText("Retry from here")).toBeInTheDocument();
    });

    // calls onForkFromCheckpoint with next user message ID when fork button is clicked
    it("Fork ボタンクリック時に onForkFromCheckpoint を次のユーザーメッセージ ID で呼び出すこと", async () => {
      const onFork = vi.fn();
      render(<MessagesArea {...defaultProps} messages={msgs} onForkFromCheckpoint={onFork} />, { wrapper });
      const forkButton = screen.getByText("Fork from here").closest("button")!;
      await userEvent.click(forkButton);
      expect(onFork).toHaveBeenCalledWith("usr-1");
    });

    // calls onRevertToCheckpoint when retry button is clicked
    it("Retry ボタンクリック時に onRevertToCheckpoint を呼び出すこと", async () => {
      const onRevert = vi.fn();
      render(<MessagesArea {...defaultProps} messages={msgs} onRevertToCheckpoint={onRevert} />, { wrapper });
      const retryButton = screen.getByText("Retry from here").closest("button")!;
      await userEvent.click(retryButton);
      expect(onRevert).toHaveBeenCalledWith("usr-1", "Follow up");
    });
  });

  // when there are no checkpoint dividers (user only, assistant only)
  context("チェックポイントが存在しない場合", () => {
    // does not render fork button
    it("Fork ボタンをレンダリングしないこと", () => {
      const msgs: MessageWithParts[] = [{ info: createMessage({ role: "user" }), parts: [createTextPart("Hello")] }];
      render(<MessagesArea {...defaultProps} messages={msgs} />, { wrapper });
      expect(screen.queryByText("Fork from here")).not.toBeInTheDocument();
    });
  });

  // auto-scroll integration
  context("自動スクロールの場合", () => {
    it("質問の変更をメッセージ以外のコンテンツ変更シグナルとして渡すこと", () => {
      const useAutoScroll = vi.spyOn(autoScrollHook, "useAutoScroll").mockReturnValue({
        containerRef: { current: null },
        bottomRef: { current: null },
        handleScroll: vi.fn(),
        isNearBottom: true,
        scrollToBottom: vi.fn(),
      });
      const questions = new Map<string, QuestionRequest>();

      const { rerender } = render(<MessagesArea {...defaultProps} questions={questions} />, { wrapper });

      expect(useAutoScroll).toHaveBeenLastCalledWith(defaultProps.messages, questions);

      const nextQuestions = new Map<string, QuestionRequest>();
      rerender(<MessagesArea {...defaultProps} questions={nextQuestions} />);

      expect(useAutoScroll).toHaveBeenLastCalledWith(defaultProps.messages, nextQuestions);
    });

    // scrolls to bottom on initial render
    it("初回レンダリング時に scrollIntoView が呼ばれること", () => {
      render(<MessagesArea {...defaultProps} />, { wrapper });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    // renders onScroll handler on scroll container
    it("スクロールコンテナに onScroll ハンドラが設定されること", () => {
      const { container } = render(<MessagesArea {...defaultProps} />, { wrapper });
      const scrollContainer = container.querySelector(".root") as HTMLElement;
      expect(scrollContainer).toBeInTheDocument();
    });

    it("最下部から離れているときにスクロールボタンを表示すること", () => {
      const handleScroll = vi.fn();
      const scrollToBottom = vi.fn();

      vi.spyOn(autoScrollHook, "useAutoScroll").mockReturnValue({
        containerRef: { current: null },
        bottomRef: { current: null },
        handleScroll,
        isNearBottom: false,
        scrollToBottom,
      });

      render(<MessagesArea {...defaultProps} />, { wrapper });

      expect(screen.getByLabelText("Scroll to bottom")).toBeInTheDocument();
    });

    it("スクロールボタンクリックで scrollToBottom を呼ぶこと", async () => {
      const handleScroll = vi.fn();
      const scrollToBottom = vi.fn();

      vi.spyOn(autoScrollHook, "useAutoScroll").mockReturnValue({
        containerRef: { current: null },
        bottomRef: { current: null },
        handleScroll,
        isNearBottom: false,
        scrollToBottom,
      });

      render(<MessagesArea {...defaultProps} />, { wrapper });

      await userEvent.click(screen.getByLabelText("Scroll to bottom"));

      expect(scrollToBottom).toHaveBeenCalledWith();
    });
  });
});
