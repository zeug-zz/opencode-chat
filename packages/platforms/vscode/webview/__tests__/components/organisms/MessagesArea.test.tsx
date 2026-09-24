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
import type { ReasoningAssistRowState } from "../../../hooks/useReasoningAssist";
import { createMessage, createTextPart } from "../../factories";

function createAssistRow(overrides: Partial<ReasoningAssistRowState> = {}): ReasoningAssistRowState {
  return {
    sessionId: "session-1",
    promptToken: "assist-token",
    stage: "mapping",
    applied: false,
    ...overrides,
  };
}

/** ドキュメント順で `later` が `earlier` の後に来るかを返す。 */
function documentOrder(earlier: Node, later: Node): "after" | "before" {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? "after" : "before";
}

/** `middle` がドキュメント順で `before` と `after` の間に表示されるかを返す。 */
function rendersBetween(before: Node, middle: Node, after: Node): boolean {
  return documentOrder(before, middle) === "after" && documentOrder(middle, after) === "after";
}

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

  // reasoning-assist row placement
  context("reasoning assist 行がある場合", () => {
    const msgs: MessageWithParts[] = [
      { info: createMessage({ role: "user", id: "usr-1" }), parts: [createTextPart("First prompt")] },
      { info: createMessage({ role: "assistant", id: "ast-1" }), parts: [createTextPart("First reply")] },
      { info: createMessage({ role: "user", id: "usr-2" }), parts: [createTextPart("Second prompt")] },
    ];

    // renders the anchored row directly after its user message and before the reply
    it("アンカーのユーザーメッセージ直後に行をレンダリングすること", () => {
      render(
        <MessagesArea
          {...defaultProps}
          messages={msgs}
          reasoningAssistRows={[createAssistRow({ promptToken: "token-anchored", anchorMessageId: "usr-1" })]}
        />,
        { wrapper },
      );

      const firstPrompt = screen.getByText("First prompt");
      const reply = screen.getByText("First reply");
      const row = screen.getByText("Reasoning assist");

      expect(firstPrompt.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(row.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // renders anchor-less rows after the final message, not inside the previous turn
    it("末尾がアシスタント応答の場合、アンカーが無い行を前のターン内ではなく最終メッセージの後にレンダリングすること", () => {
      const previousTurn: MessageWithParts[] = [
        { info: createMessage({ role: "user", id: "usr-1" }), parts: [createTextPart("First prompt")] },
        { info: createMessage({ role: "assistant", id: "ast-1" }), parts: [createTextPart("First reply")] },
      ];
      render(
        <MessagesArea
          {...defaultProps}
          messages={previousTurn}
          reasoningAssistRows={[createAssistRow({ promptToken: "token-trailing" })]}
        />,
        { wrapper },
      );

      const prompt = screen.getByText("First prompt");
      const reply = screen.getByText("First reply");
      const row = screen.getByText("Reasoning assist");

      expect(documentOrder(reply, row)).toBe("after");
      expect(rendersBetween(prompt, row, reply)).toBe(false);
      expect(documentOrder(prompt, reply)).toBe("after");
    });

    // renders anchor-less rows after the last user message while it is the final message
    it("アンカーが無い行を最後のユーザーメッセージの後にレンダリングすること", () => {
      render(
        <MessagesArea
          {...defaultProps}
          messages={msgs}
          reasoningAssistRows={[
            createAssistRow({ promptToken: "token-anchored", anchorMessageId: "usr-1" }),
            createAssistRow({ promptToken: "token-trailing" }),
          ]}
        />,
        { wrapper },
      );

      const [anchoredRow, trailingRow] = screen.getAllByText("Reasoning assist");
      const secondPrompt = screen.getByText("Second prompt");

      expect(documentOrder(secondPrompt, trailingRow)).toBe("after");
      expect(documentOrder(anchoredRow, trailingRow)).toBe("after");
    });

    // renders anchor-less rows after the final message when the session has no user message
    it("ユーザーメッセージが無い場合は最終メッセージの後にレンダリングすること", () => {
      render(
        <MessagesArea
          {...defaultProps}
          messages={[assistantMsg]}
          reasoningAssistRows={[createAssistRow({ promptToken: "token-only" })]}
        />,
        { wrapper },
      );

      const reply = screen.getByText("Hi there");
      const row = screen.getByText("Reasoning assist");

      expect(documentOrder(reply, row)).toBe("after");
    });

    // renders anchor-less rows while the first prompt's preflight runs before any message exists
    it("メッセージが無い場合もアンカー無しの行をレンダリングすること", () => {
      render(
        <MessagesArea
          {...defaultProps}
          messages={[]}
          reasoningAssistRows={[createAssistRow({ promptToken: "token-empty" })]}
        />,
        { wrapper },
      );

      expect(screen.getByText("Reasoning assist")).toBeInTheDocument();
      expect(screen.getByText("Mapping argument")).toBeInTheDocument();
    });

    // renders nothing when no row is published
    it("行が無い場合は何もレンダリングしないこと", () => {
      render(<MessagesArea {...defaultProps} messages={msgs} reasoningAssistRows={[]} />, { wrapper });

      expect(screen.queryByText("Reasoning assist")).not.toBeInTheDocument();
    });

    // an ordinary (cleared) preflight leaves neither a row nor the removed review surfaces
    it("クリア済みの通常フローでは行もレビューカードも思考面も表示しないこと", () => {
      const { container } = render(<MessagesArea {...defaultProps} messages={msgs} reasoningAssistRows={[]} />, {
        wrapper,
      });

      expect(screen.queryByText("Reasoning assist")).not.toBeInTheDocument();
      expect(container.querySelector(".reviewCard")).toBeNull();
      expect(container.querySelector(".reasoningPart")).toBeNull();
      expect(container.querySelector(".reasoningHeader")).toBeNull();
      expect(screen.queryByRole("region", { name: "Reasoning review" })).not.toBeInTheDocument();
      expect(screen.queryByText("Thought")).not.toBeInTheDocument();
      expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
    });

    // a pending row removed by cleared leaves no row, spinner, review card, or blocked surface
    it("保留行がクリアされると行もスピナーもカードも blocked も残さないこと", () => {
      const { container, rerender } = render(
        <MessagesArea
          {...defaultProps}
          messages={msgs}
          reasoningAssistRows={[
            createAssistRow({ promptToken: "token-pending", stage: "recording", anchorMessageId: "usr-1" }),
          ]}
        />,
        { wrapper },
      );
      expect(screen.getByText("Reasoning assist")).toBeInTheDocument();
      expect(screen.getByText("Recording structure")).toBeInTheDocument();

      rerender(<MessagesArea {...defaultProps} messages={msgs} reasoningAssistRows={[]} />);

      expect(screen.queryByText("Reasoning assist")).not.toBeInTheDocument();
      expect(container.textContent).not.toContain("blocked");
      expect(container.querySelector("[data-testid='streaming-indicator']")).toBeNull();
      expect(container.querySelector(".reviewCard")).toBeNull();
      expect(container.querySelector(".reasoningPart")).toBeNull();
      expect(container.querySelector(".reasoningHeader")).toBeNull();
      expect(screen.queryByText("Thought")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Reasoning review" })).not.toBeInTheDocument();
      // 通常のトランスクリプトは影響を受けない
      expect(screen.getByText("First prompt")).toBeInTheDocument();
      expect(screen.getByText("First reply")).toBeInTheDocument();
      expect(screen.getByText("Second prompt")).toBeInTheDocument();
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
