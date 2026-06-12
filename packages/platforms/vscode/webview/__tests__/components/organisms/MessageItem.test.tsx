import { fireEvent, render, screen } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MessageWithParts } from "../../../App";
import {
  getAssistantMarkdownSource,
  getCopyableAssistantMarkdownSource,
  MessageItem,
} from "../../../components/organisms/MessageItem/MessageItem";
import { AppContextProvider, type AppContextValue } from "../../../contexts/AppContext";
import { postMessage } from "../../../vscode-api";
import { createMessage, createSubtaskPart, createTextPart, createToolPart } from "../../factories";

/** AppContext 必須の値を最小限で提供するラッパー */
function createContextWrapper(overrides: Partial<AppContextValue> = {}) {
  const contextValue = {
    isShellMessage: () => false,
    ...overrides,
  } as unknown as AppContextValue;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AppContextProvider value={contextValue}>{children}</AppContextProvider>;
  };
}

describe("MessageItem", () => {
  const wrapper = createContextWrapper();
  const defaultProps = {
    activeSessionId: "session-1",
    questions: new Map(),
    onEditAndResend: vi.fn(),
  };
  // デフォルトロケール（en）の "message.copyMarkdown" 値。
  // aria-label / title / 可視テキストの期待値として全 Copy Markdown 関連テストで使う。
  const COPY_MARKDOWN_LABEL = "Copy Markdown";

  // when rendered with a user message
  context("ユーザーメッセージの場合", () => {
    const userMsg: MessageWithParts = {
      info: createMessage({ role: "user" }),
      parts: [createTextPart("Hello")],
    };

    // renders as user message
    it("ユーザーメッセージとしてレンダリングすること", () => {
      const { container } = render(<MessageItem {...defaultProps} message={userMsg} />, { wrapper });
      expect(container.querySelector(".user")).toBeInTheDocument();
    });

    // renders user text
    it("ユーザーテキストを表示すること", () => {
      const { container } = render(<MessageItem {...defaultProps} message={userMsg} />, { wrapper });
      expect(container.querySelector(".content")?.textContent).toBe("Hello");
    });

    // shows edit icon
    it("編集アイコンを表示すること", () => {
      const { container } = render(<MessageItem {...defaultProps} message={userMsg} />, { wrapper });
      expect(container.querySelector(".editIcon")).toBeInTheDocument();
    });
  });

  // when user message bubble is clicked
  context("ユーザーメッセージバブルをクリックした場合", () => {
    const userMsg: MessageWithParts = {
      info: createMessage({ role: "user" }),
      parts: [createTextPart("Hello")],
    };

    // enters edit mode
    it("編集モードに入ること", () => {
      const { container } = render(<MessageItem {...defaultProps} message={userMsg} />, { wrapper });
      fireEvent.click(container.querySelector(".userBubble")!);
      expect(container.querySelector(".editTextarea")).toBeInTheDocument();
    });
  });

  // when rendered with an assistant message
  context("アシスタントメッセージの場合", () => {
    const assistantMsg: MessageWithParts = {
      info: createMessage({ role: "assistant" }),
      parts: [createTextPart("Response"), createToolPart("file_read")],
    };

    // renders as assistant message
    it("アシスタントメッセージとしてレンダリングすること", () => {
      const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      expect(container.querySelector(".assistant")).toBeInTheDocument();
    });

    // renders text and tool parts
    it("テキストとツールパートをレンダリングすること", () => {
      const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      expect(container.querySelector(".root")).toBeInTheDocument();
    });
  });

  // when rendered with a shell assistant message
  context("シェルコマンド結果のアシスタントメッセージの場合", () => {
    const shellWrapper = createContextWrapper({ isShellMessage: (id: string) => id === "shell-msg" });
    const shellMsg: MessageWithParts = {
      info: createMessage({ id: "shell-msg", role: "assistant" }),
      parts: [
        createTextPart("The following tool was executed by the user"),
        createToolPart("bash", {
          state: { status: "completed", title: "ls", input: { command: "ls" }, output: "file.txt" },
        } as any),
      ],
    };

    // renders ShellResultView instead of ToolPartView
    it("ShellResultView をレンダリングすること", () => {
      render(<MessageItem {...defaultProps} message={shellMsg} />, { wrapper: shellWrapper });
      expect(screen.getByText("Shell")).toBeInTheDocument();
    });

    // does not render the synthetic text part
    it("テキストパートを表示しないこと", () => {
      render(<MessageItem {...defaultProps} message={shellMsg} />, { wrapper: shellWrapper });
      expect(screen.queryByText("The following tool was executed by the user")).not.toBeInTheDocument();
    });
  });

  // when rendered with a shell user message
  context("シェルコマンドのユーザーメッセージの場合", () => {
    const shellWrapper = createContextWrapper({ isShellMessage: (id: string) => id === "shell-user" });
    const shellUserMsg: MessageWithParts = {
      info: createMessage({ id: "shell-user", role: "user" }),
      parts: [createTextPart("!ls -la")],
    };

    // hides user bubble
    it("ユーザー吹き出しが非表示であること", () => {
      const { container } = render(<MessageItem {...defaultProps} message={shellUserMsg} />, { wrapper: shellWrapper });
      expect(container.querySelector("[class*='userBubble']")).not.toBeInTheDocument();
    });
  });

  // Copy Markdown action rendering
  describe("Copy Markdown アクション", () => {
    const copyButtonQuery = () => screen.queryByRole("button", { name: COPY_MARKDOWN_LABEL });

    // 通常アシスタントで text パートがある時のみ表示される
    it("通常の assistant メッセージで表示されること", () => {
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      expect(copyButtonQuery()).toBeInTheDocument();
    });

    // ユーザーメッセージには表示されない
    it("user メッセージでは表示されないこと", () => {
      const userMsg: MessageWithParts = {
        info: createMessage({ role: "user" }),
        parts: [createTextPart("Hello")],
      };
      render(<MessageItem {...defaultProps} message={userMsg} />, { wrapper });
      expect(copyButtonQuery()).not.toBeInTheDocument();
    });

    // シェル結果の assistant には表示されない
    it("shell の assistant メッセージでは表示されないこと", () => {
      const shellWrapper = createContextWrapper({ isShellMessage: (id: string) => id === "shell-msg" });
      const shellMsg: MessageWithParts = {
        info: createMessage({ id: "shell-msg", role: "assistant" }),
        parts: [
          createTextPart("The following tool was executed by the user"),
          createToolPart("bash", {
            state: { status: "completed", title: "ls", input: { command: "ls" }, output: "file.txt" },
          } as any),
        ],
      };
      render(<MessageItem {...defaultProps} message={shellMsg} />, { wrapper: shellWrapper });
      expect(copyButtonQuery()).not.toBeInTheDocument();
    });

    // シェルユーザーメッセージにも表示されない
    it("shell の user メッセージでは表示されないこと", () => {
      const shellWrapper = createContextWrapper({ isShellMessage: (id: string) => id === "shell-user" });
      const shellUserMsg: MessageWithParts = {
        info: createMessage({ id: "shell-user", role: "user" }),
        parts: [createTextPart("!ls -la")],
      };
      render(<MessageItem {...defaultProps} message={shellUserMsg} />, { wrapper: shellWrapper });
      expect(copyButtonQuery()).not.toBeInTheDocument();
    });

    // text パートが無く非テキストのみの場合は表示されない
    it("非テキストパートのみの assistant では表示されないこと", () => {
      const toolOnlyMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        // SubtaskPartView は childSessions を要求するため、ここでは ToolPart のみを使い
        // UI レンダリングを伴わずに「コピー対象テキスト無し」を検証する。
        parts: [createToolPart("file_read")],
      };
      render(<MessageItem {...defaultProps} message={toolOnlyMsg} />, { wrapper });
      expect(copyButtonQuery()).not.toBeInTheDocument();
    });

    // クリックしてもユーザー編集モードに入らず、例外も投げない
    it("クリックしても編集モードに入らず例外を投げないこと", () => {
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = copyButtonQuery();
      expect(button).toBeInTheDocument();
      expect(() => fireEvent.click(button!)).not.toThrow();
      // ユーザーメッセージ編集 textarea は生成されない
      expect(container.querySelector(".editTextarea")).not.toBeInTheDocument();
    });

    // aria-label / title がロケール文字列に一致し、ボタン本体はアイコン SVG を表示すること
    it("aria-label / title がロケール文字列（Copy Markdown）になり、本体はアイコン SVG であること", () => {
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = copyButtonQuery();
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-label", COPY_MARKDOWN_LABEL);
      expect(button).toHaveAttribute("title", COPY_MARKDOWN_LABEL);
      // 可視テキストは出さず、アイコン SVG を表示する
      expect(button?.textContent?.trim()).toBe("");
      const svg = container.querySelector<HTMLElement>(".copyMarkdownButton svg");
      expect(svg).toBeInTheDocument();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
    });

    // クリック直後はチェックマークアイコンに切り替えられ、1500ms 後にコピーマークへ戻ること
    it("クリック後にチェックマークへ切り替わり 1500ms 後にコピーマークへ戻ること", () => {
      vi.useFakeTimers();
      try {
        const assistantMsg: MessageWithParts = {
          info: createMessage({ role: "assistant" }),
          parts: [createTextPart("Response")],
        };
        const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
        const button = screen.getByRole("button", { name: COPY_MARKDOWN_LABEL });
        fireEvent.click(button);
        // クリック直後は .copied クラスが付き、path d 属性がチェックマークになる
        const btnAfter = container.querySelector<HTMLElement>(".copyMarkdownButton");
        expect(btnAfter?.className).toContain("copied");
        const svgAfter = btnAfter?.querySelector("svg path");
        // チェックマークの path は d="M14.431..." で始まる（クリップボードの d="M4 4l1-1..." と区別）
        expect(svgAfter?.getAttribute("d")?.startsWith("M14.431")).toBe(true);
        // postMessage は発火している
        expect(postMessage).toHaveBeenCalledWith({ type: "copyToClipboard", text: "Response" });
        // 1500ms 経過で .copied クラスが外れ、コピーマークへ戻る
        act(() => {
          vi.advanceTimersByTime(1500);
        });
        const btnLater = container.querySelector<HTMLElement>(".copyMarkdownButton");
        expect(btnLater?.className).not.toContain("copied");
        const svgLater = btnLater?.querySelector("svg path");
        expect(svgLater?.getAttribute("d")?.startsWith("M4 4l1-1")).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Copy Markdown クリックで postMessage されること
  describe("Copy Markdown クリックで postMessage されること", () => {
    // KaTeX を含む生ソースがそのまま postMessage されること
    it("KaTeX を含む assistant メッセージのクリックで生ソースが postMessage されること", () => {
      const source = "Inline $E=mc^2$\n\nDisplay:\n\n$$\\frac{\\partial}{\\partial t}$$";
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart(source)],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = screen.getByRole("button", { name: COPY_MARKDOWN_LABEL });
      fireEvent.click(button);
      expect(postMessage).toHaveBeenCalledWith({ type: "copyToClipboard", text: source });
    });

    // 複数テキストパートは \n\n 連結で postMessage されること
    it("複数のテキストパートは \\n\\n 連結で postMessage されること", () => {
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("First paragraph."), createTextPart("Second paragraph with `code`.")],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = screen.getByRole("button", { name: COPY_MARKDOWN_LABEL });
      fireEvent.click(button);
      expect(postMessage).toHaveBeenCalledWith({
        type: "copyToClipboard",
        text: "First paragraph.\n\nSecond paragraph with `code`.",
      });
    });

    // postMessage される文字列が生ソース（KaTeX 記法を含む）であること
    it("postMessage される文字列は KaTeX 記法を含む生ソースであること", () => {
      const source = "Inline $E=mc^2$\n\n$$\\frac{\\partial}{\\partial t}$$";
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart(source)],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = screen.getByRole("button", { name: COPY_MARKDOWN_LABEL });
      fireEvent.click(button);
      const call = vi.mocked(postMessage).mock.calls[0]?.[0];
      // 生ソースと完全一致する（getCopyableAssistantMarkdownSource の戻り値がそのまま送られる）
      expect(call).toEqual({ type: "copyToClipboard", text: source });
      // KaTeX ソースが保持されている
      expect(call?.text).toContain("$$\\frac{\\partial}{\\partial t}$$");
    });

    // ユーザーメッセージではボタンが描画されず postMessage も発火しないこと
    it("user メッセージでは postMessage が呼ばれないこと", () => {
      const userMsg: MessageWithParts = {
        info: createMessage({ role: "user" }),
        parts: [createTextPart("Hello")],
      };
      render(<MessageItem {...defaultProps} message={userMsg} />, { wrapper });
      const button = screen.queryByRole("button", { name: COPY_MARKDOWN_LABEL });
      expect(button).not.toBeInTheDocument();
      expect(postMessage).not.toHaveBeenCalled();
    });

    // シェル結果の assistant メッセージでは postMessage も発火しないこと
    it("shell の assistant メッセージでは postMessage が呼ばれないこと", () => {
      const shellWrapper = createContextWrapper({ isShellMessage: (id: string) => id === "shell-msg" });
      const shellMsg: MessageWithParts = {
        info: createMessage({ id: "shell-msg", role: "assistant" }),
        parts: [
          createTextPart("The following tool was executed by the user"),
          createToolPart("bash", {
            state: { status: "completed", title: "ls", input: { command: "ls" }, output: "file.txt" },
          } as any),
        ],
      };
      render(<MessageItem {...defaultProps} message={shellMsg} />, { wrapper: shellWrapper });
      const button = screen.queryByRole("button", { name: COPY_MARKDOWN_LABEL });
      expect(button).not.toBeInTheDocument();
      expect(postMessage).not.toHaveBeenCalled();
    });

    // 非テキストのみ / テキスト無しの assistant では postMessage も発火しないこと
    it("非テキストパートのみの assistant では postMessage が呼ばれないこと", () => {
      const toolOnlyMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createToolPart("file_read")],
      };
      render(<MessageItem {...defaultProps} message={toolOnlyMsg} />, { wrapper });
      const button = screen.queryByRole("button", { name: COPY_MARKDOWN_LABEL });
      expect(button).not.toBeInTheDocument();
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  // Code-block copy と message-level Copy Markdown の独立性を担保する回帰テスト
  // (copy-chat-markdown Step 3.1)。
  describe("コードブロックコピーと Markdown コピーの独立", () => {
    // メッセージレベル: コードフェンスを含む生ソースがそのまま postMessage されること
    it("メッセージレベルの Copy Markdown はコードフェンスを含む生ソースを postMessage すること", () => {
      const source = "Here is code:\n\n```ts\nconst x = 1;\n```\n\nDone.";
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart(source)],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = screen.getByRole("button", { name: COPY_MARKDOWN_LABEL });
      fireEvent.click(button);
      // コードフェンスを含む完全な Markdown ソースが送られる
      expect(postMessage).toHaveBeenCalledWith({ type: "copyToClipboard", text: source });
      // フェンスや前後に投稿された場合の文字列が含まれている
      const call = vi.mocked(postMessage).mock.calls[0]?.[0];
      expect(call?.text).toContain("```ts");
      expect(call?.text).toContain("const x = 1;");
      expect(call?.text).toContain("Done.");
    });

    // コードブロックレベル: 同じメッセージにコードブロックが含まれていても、
    // メッセージレベルはコード本文だけにはせず、必ずソース全体を postMessage する
    it("メッセージレベルボタンはコード本文のみに切り詰めた形で postMessage しないこと", () => {
      const source = "Here is code:\n\n```ts\nconst x = 1;\n```";
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart(source)],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = screen.getByRole("button", { name: COPY_MARKDOWN_LABEL });
      fireEvent.click(button);
      const call = vi.mocked(postMessage).mock.calls[0]?.[0];
      // メッセージレベルは Markdown 全体を送り、コード本文のみの切り詰めは行わない
      expect(call?.text).not.toBe("const x = 1;");
      expect(call?.text).toBe(source);
    });
  });

  // ネイティブ選択コピー (Ctrl+C) と Markdown コピーの独立 (copy-chat-markdown Step 3.2)。
  // MessageItem は document/window の copy イベントに一切干渉しないことが期待される。
  describe("ネイティブ選択コピーと Markdown コピーの独立", () => {
    // MessageItem は document の copy イベントをリッスンしていないこと
    it("document に copy イベントリスナーが追加されていないこと", () => {
      const addSpy = vi.spyOn(document, "addEventListener");
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const copyRegistrations = addSpy.mock.calls.filter(([type]) => type === "copy");
      expect(copyRegistrations).toHaveLength(0);
      addSpy.mockRestore();
    });

    // MessageItem は window の copy イベントもリッスンしていないこと
    it("window に copy イベントリスナーが追加されていないこと", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const copyRegistrations = addSpy.mock.calls.filter(([type]) => type === "copy");
      expect(copyRegistrations).toHaveLength(0);
      addSpy.mockRestore();
    });

    // ユーザーがコンテンツ領域でテキスト選択 → Ctrl+C した場合、
    // ネイティブの copy イベントが preventDefault されずブラウザ既定のコピー処理が走る
    it("content 要素で copy イベントが preventDefault されないこと", () => {
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const contentEl = container.querySelector<HTMLElement>(".content");
      expect(contentEl).toBeInTheDocument();
      // ユーザーがテキストを選択した状態を模倣（jsdom では getSelection は null を返すので
      // clipboardData のみ設定した copy イベントを dispatch する）
      const event = new Event("copy", { bubbles: true, cancelable: true });
      // clipboardData は ClipboardEvent でのみ読めるが、jsdom 環境では
      // 「preventDefault されていない」ことを defaultPrevented で検証できれば十分。
      Object.defineProperty(event, "clipboardData", {
        value: { setData: vi.fn(), getData: vi.fn(() => "Response") },
        writable: false,
      });
      contentEl!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      // ネイティブ copy 経由では postMessage は発火しない（ボタン onClick ではない）
      expect(postMessage).not.toHaveBeenCalled();
    });

    // ボタンのクリックハンドラは自分の click イベントにのみ preventDefault/stopPropagation
    // をかけており、document の copy イベントには干渉しない
    it("Copy Markdown ボタンの click は document の copy イベントに伝播しないこと", () => {
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = screen.getByRole("button", { name: COPY_MARKDOWN_LABEL });
      // ボタンの click 後でも、別途 dispatch した copy イベントは preventDefault されない
      fireEvent.click(button);
      const event = new Event("copy", { bubbles: true, cancelable: true });
      container.querySelector<HTMLElement>(".content")!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    // ボタン自身のテキストもネイティブ選択可能（user-select が無効化されていない）
    it("Copy Markdown ボタンのテキストがネイティブ選択可能なままであること", () => {
      const assistantMsg: MessageWithParts = {
        info: createMessage({ role: "assistant" }),
        parts: [createTextPart("Response")],
      };
      const { container } = render(<MessageItem {...defaultProps} message={assistantMsg} />, { wrapper });
      const button = container.querySelector<HTMLElement>(".copyMarkdownButton");
      expect(button).toBeInTheDocument();
      // user-select が none になっていないことを確認（CSS Modules の非スコープ化により
      // クラス名はそのまま解決される）
      const styles = window.getComputedStyle(button!);
      expect(styles.userSelect).not.toBe("none");
    });
  });

  // getAssistantMarkdownSource helper
  describe("getAssistantMarkdownSource", () => {
    // 単一のテキストパートは生の Markdown / KaTeX ソースをそのまま返すこと
    it("単一のテキストパートを KaTeX を含めてそのまま返すこと", () => {
      const source = "Inline math: $E=mc^2$\n\nDisplay:\n\n$$\\frac{\\partial}{\\partial t}$$";
      const result = getAssistantMarkdownSource([createTextPart(source)]);
      expect(result).toBe(source);
    });

    // 複数のテキストパートは表示順を維持し空行で連結すること
    it("複数のテキストパートを \\n\\n で連結して返すこと", () => {
      const result = getAssistantMarkdownSource([
        createTextPart("First paragraph."),
        createTextPart("Second paragraph with `code`."),
      ]);
      expect(result).toBe("First paragraph.\n\nSecond paragraph with `code`.");
    });

    // テキスト以外のパートは除外されること
    it("非テキストパート（tool / subtask / reasoning）を除外すること", () => {
      const result = getAssistantMarkdownSource([
        createTextPart("Visible text."),
        createToolPart("file_read"),
        createSubtaskPart("general", "desc"),
        {
          id: "part-reasoning",
          sessionID: "session-1",
          messageID: "msg-1",
          type: "reasoning",
          text: "internal thought that must not be copied",
        },
      ]);
      expect(result).toBe("Visible text.");
    });

    // 空文字列のパートはコピー対象から除外されること
    it("空テキストパートを無視すること", () => {
      const result = getAssistantMarkdownSource([
        createTextPart(""),
        createTextPart("Only this is copyable."),
        createTextPart(""),
      ]);
      expect(result).toBe("Only this is copyable.");
    });

    // 全て空 or テキスト以外なら null を返すこと
    it("空テキストのみ、もしくは非テキストのみの場合 null を返すこと", () => {
      expect(getAssistantMarkdownSource([createTextPart("")])).toBeNull();
      expect(getAssistantMarkdownSource([createToolPart("bash"), createSubtaskPart("general", "desc")])).toBeNull();
      expect(getAssistantMarkdownSource([])).toBeNull();
    });
  });

  // getCopyableAssistantMarkdownSource context-aware helper
  describe("getCopyableAssistantMarkdownSource", () => {
    // 通常の assistant メッセージは Step 1.1 と同じ生 Markdown を返すこと
    it("通常の assistant メッセージで KaTeX を含む生ソースを返すこと", () => {
      const source = "Inline $E=mc^2$\n\n$$\\frac{\\partial}{\\partial t}$$";
      const result = getCopyableAssistantMarkdownSource([createTextPart(source)], {
        isUser: false,
        isShell: false,
      });
      expect(result).toBe(source);
    });

    // ユーザーメッセージはコピー対象外
    it("user メッセージは null を返すこと", () => {
      const result = getCopyableAssistantMarkdownSource([createTextPart("Hello")], {
        isUser: true,
        isShell: false,
      });
      expect(result).toBeNull();
    });

    // シェル結果の assistant メッセージはコピー対象外
    it("shell の assistant メッセージは null を返すこと", () => {
      const result = getCopyableAssistantMarkdownSource(
        [
          createTextPart("The following tool was executed by the user"),
          createToolPart("bash", {
            state: { status: "completed", title: "ls", input: { command: "ls" }, output: "file.txt" },
          } as any),
        ],
        { isUser: false, isShell: true },
      );
      expect(result).toBeNull();
    });

    // 可視テキストパートが無い assistant は null
    it("非テキストパートのみの assistant は null を返すこと", () => {
      const result = getCopyableAssistantMarkdownSource(
        [createToolPart("file_read"), createSubtaskPart("general", "desc")],
        { isUser: false, isShell: false },
      );
      expect(result).toBeNull();
    });

    // テキスト + 非テキスト混在はテキスト部分のみを返すこと
    it("テキストと非テキストが混在する場合テキスト部分のみ返すこと", () => {
      const result = getCopyableAssistantMarkdownSource(
        [createTextPart("Visible text."), createToolPart("file_read"), createSubtaskPart("general", "desc")],
        { isUser: false, isShell: false },
      );
      expect(result).toBe("Visible text.");
    });
  });
});
