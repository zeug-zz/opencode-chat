import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextPartView } from "../../../components/molecules/TextPartView";
import { postMessage } from "../../../vscode-api";
import { createTextPart } from "../../factories";

// コードブロックの実レンダリングを検証するテストでは、setup.ts の
// marked モックではなく本物の Marked を使用する。
vi.unmock("marked");

// Mermaid レンダリング補助のモック：テストでは実際の Mermaid ライブラリを
// 使用せず、string-render ヘルパーの戻り値 ({ svg, bindFunctions }) を返す。
const mockRenderMermaidDiagram = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      svg: '<svg viewBox="0 0 10 10"><text>diagram</text></svg>',
      bindFunctions: vi.fn(),
    }),
  ),
);

vi.mock("../../../utils/mermaid", () => ({
  renderMermaidDiagram: mockRenderMermaidDiagram,
}));

const MOCK_SVG = '<svg viewBox="0 0 10 10"><text>diagram</text></svg>';

/** Default `mockResolvedValue` for the Mermaid helper, used in `beforeEach`. */
function mockResolveMermaid() {
  mockRenderMermaidDiagram.mockResolvedValue({
    svg: MOCK_SVG,
    bindFunctions: vi.fn(),
  });
}

describe("TextPartView", () => {
  // when rendered with a text part
  context("テキストパートを渡した場合", () => {
    // renders HTML content
    it("HTML コンテンツをレンダリングすること", () => {
      const part = createTextPart("Hello world");
      const { container } = render(<TextPartView part={part} />);
      expect(container.querySelector(".markdown")).toBeInTheDocument();
    });

    // renders the text
    it("テキストを表示すること", () => {
      const part = createTextPart("Hello world");
      const { container } = render(<TextPartView part={part} />);
      expect(container.textContent).toContain("Hello world");
    });
  });

  // when text changes
  context("テキストが異なる場合", () => {
    // renders updated text
    it("更新されたテキストを表示すること", () => {
      const part = createTextPart("Updated text");
      const { container } = render(<TextPartView part={part} />);
      expect(container.textContent).toContain("Updated text");
    });
  });

  // XSS protection via DOMPurify
  context("悪意のある HTML を含むテキストの場合", () => {
    // strips <script> tags
    it("<script> タグが除去されること", () => {
      const part = createTextPart('<script>alert("xss")</script>');
      const { container } = render(<TextPartView part={part} />);
      expect(container.querySelector("script")).toBeNull();
    });

    // strips onerror attributes
    it("onerror 属性が除去されること", () => {
      const part = createTextPart('<img src="x" onerror="alert(1)">');
      const { container } = render(<TextPartView part={part} />);
      expect(container.innerHTML).not.toContain("onerror");
    });

    // strips javascript: URLs
    it("javascript: URL が除去されること", () => {
      const part = createTextPart('<a href="javascript:alert(1)">click</a>');
      const { container } = render(<TextPartView part={part} />);
      expect(container.innerHTML).not.toContain("javascript:");
    });

    // strips <iframe> tags
    it("<iframe> タグが除去されること", () => {
      const part = createTextPart('<iframe src="https://evil.com"></iframe>');
      const { container } = render(<TextPartView part={part} />);
      expect(container.querySelector("iframe")).toBeNull();
    });

    // safe inline HTML is escaped by Marked first, then preserved by DOMPurify
    it("安全な HTML コンテンツは保持されること", () => {
      const part = createTextPart("safe <b>bold</b> text");
      const { container } = render(<TextPartView part={part} />);
      // Marked escapes the <b> tags, so textContent shows them literally
      expect(container.textContent).toContain("safe");
      expect(container.textContent).toContain("bold");
      expect(container.textContent).toContain("text");
    });
  });

  // file path link click handling
  context("ファイルパスリンクをクリックした場合", () => {
    // sends openFile message when file link is clicked
    it("openFile メッセージが送信されること", () => {
      // linkifyAbsolutePaths が絶対パスを data-file-path 付きリンクに変換する
      const part = createTextPart("See /home/user/project/src/main.ts for details");
      const { container } = render(<TextPartView part={part} />);
      const link = container.querySelector("a[data-file-path]");
      expect(link).toBeInTheDocument();
      fireEvent.click(link!);
      expect(vi.mocked(postMessage)).toHaveBeenCalledWith({
        type: "openFile",
        filePath: "/home/user/project/src/main.ts",
        line: undefined,
      });
    });

    // sends openFile message with line number when path has :line suffix
    it("行番号付きパスの場合 line が送信されること", () => {
      const part = createTextPart("Error at /home/user/project/src/main.ts:42 found");
      const { container } = render(<TextPartView part={part} />);
      const link = container.querySelector("a[data-file-path]");
      expect(link).toBeInTheDocument();
      fireEvent.click(link!);
      expect(vi.mocked(postMessage)).toHaveBeenCalledWith({
        type: "openFile",
        filePath: "/home/user/project/src/main.ts",
        line: 42,
      });
    });
  });

  // non-Mermaid fenced code blocks render unchanged through the real code renderer
  context("通常のコードブロック（非 Mermaid）の場合", () => {
    // renders a code-block-wrapper without mermaid-specific elements
    it("コードブロックラッパーがレンダリングされ、Mermaid 要素が存在しないこと", () => {
      const part = createTextPart("```ts\nconst x = 1;\n```");
      const { container } = render(<TextPartView part={part} />);
      const wrapper = container.querySelector(".code-block-wrapper");
      expect(wrapper).toBeInTheDocument();
      expect(wrapper!.querySelector(".code-block-lang")?.textContent).toBe("ts");
      expect(wrapper!.querySelector("pre code")).toBeInTheDocument();
      expect(wrapper!.querySelector("pre code")!.textContent).toContain("const x = 1");
      expect(wrapper!.querySelector(".mermaid-block")).toBeNull();
      expect(wrapper!.querySelector(".mermaid-render-target")).toBeNull();
    });

    // highlights JavaScript code when lang is detected
    it("シンタックスハイライトが適用されること", () => {
      const part = createTextPart('```js\nconst fn = () => "hello";\n```');
      const { container } = render(<TextPartView part={part} />);
      const codeEl = container.querySelector(".code-block-wrapper pre code");
      expect(codeEl).toBeInTheDocument();
      // hljs adds <span class="hljs-keyword"> for keywords like "const"
      expect(codeEl!.innerHTML).toContain('class="hljs-keyword"');
    });

    // copy button posts raw code text via real renderer (no stubs)
    it("コピーボタンでコード本文のみが送信されること（実レンダラー）", () => {
      const part = createTextPart('```py\nprint("hello")\n```');
      const { container } = render(<TextPartView part={part} />);
      const copyBtn = container.querySelector<HTMLElement>(".code-block-copy");
      expect(copyBtn).toBeInTheDocument();
      fireEvent.click(copyBtn!);
      expect(vi.mocked(postMessage)).toHaveBeenCalledWith({
        type: "copyToClipboard",
        text: 'print("hello")',
      });
    });
  });

  // Mermaid fenced blocks preserve source and call the rendering helper
  context("Mermaid コードブロックの場合", () => {
    const MERMAID_SOURCE = "flowchart TD\n  A[Start] --> B[Done]";
    const MERMAID_MARKDOWN = "```mermaid\nflowchart TD\n  A[Start] --> B[Done]\n```";

    beforeEach(() => {
      mockResolveMermaid();
    });

    // mermaid-block wrapper and source preservation
    it("ソースが保持され、Mermaid ブロック構造がレンダリングされること", () => {
      const part = createTextPart(MERMAID_MARKDOWN);
      const { container } = render(<TextPartView part={part} />);

      const block = container.querySelector(".mermaid-block");
      expect(block).toBeInTheDocument();
      // .code-block-wrapper クラスとの互換性
      expect(block!.classList.contains("code-block-wrapper")).toBe(true);

      const sourceCode = block!.querySelector<HTMLElement>(".mermaid-source code");
      expect(sourceCode).toBeInTheDocument();
      expect(sourceCode!.textContent).toContain(MERMAID_SOURCE);
    });

    // render target with accessibility attributes
    it("レンダリングターゲットがアクセシビリティ属性を持つこと", () => {
      const part = createTextPart(MERMAID_MARKDOWN);
      const { container } = render(<TextPartView part={part} />);

      const target = container.querySelector(".mermaid-render-target");
      expect(target).toBeInTheDocument();
      expect(target!.getAttribute("role")).toBe("img");
      expect(target!.getAttribute("aria-label")).toBe("Mermaid diagram");
      expect(target!.getAttribute("tabindex")).toBe("0");
    });

    // renderMermaidDiagram is called with source and signal only (string-render path)
    it("renderMermaidDiagram がソースと signal のみで呼ばれ、container を渡さないこと", async () => {
      mockRenderMermaidDiagram.mockClear();
      const part = createTextPart(MERMAID_MARKDOWN);
      render(<TextPartView part={part} />);

      await waitFor(() => {
        expect(mockRenderMermaidDiagram).toHaveBeenCalledTimes(1);
      });

      const [firstCallSource, firstCallOptions] = mockRenderMermaidDiagram.mock.calls[0] as [
        string,
        { signal?: AbortSignal; container?: Element },
      ];
      expect(firstCallSource).toBe(MERMAID_SOURCE);
      // options オブジェクトに signal（AbortSignal）が含まれている
      expect(firstCallOptions).toBeDefined();
      expect(firstCallOptions.signal).toBeInstanceOf(AbortSignal);
      // ライブ DOM container を渡さない（string-render 経路）
      expect("container" in firstCallOptions).toBe(false);
    });

    // bindFunctions is called with the .mermaid-render-target after SVG insertion
    it("SVG 挿入後に bindFunctions が .mermaid-render-target に対して呼ばれること", async () => {
      const bindFn = vi.fn();
      mockRenderMermaidDiagram.mockResolvedValueOnce({
        svg: MOCK_SVG,
        bindFunctions: bindFn,
      });

      const part = createTextPart(MERMAID_MARKDOWN);
      const { container } = render(<TextPartView part={part} />);
      const target = container.querySelector<HTMLElement>(".mermaid-render-target");

      await waitFor(() => {
        expect(bindFn).toHaveBeenCalledTimes(1);
      });
      expect(bindFn).toHaveBeenCalledWith(target);
    });

    // bindFunctions failure should not erase a successfully inserted SVG
    it("bindFunctions が失敗しても SVG は表示済み状態のまま保持されること", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const bindError = new Error("bind failed");
      mockRenderMermaidDiagram.mockResolvedValueOnce({
        svg: MOCK_SVG,
        bindFunctions: () => {
          throw bindError;
        },
      });

      try {
        const part = createTextPart(MERMAID_MARKDOWN);
        const { container } = render(<TextPartView part={part} />);
        const block = container.querySelector(".mermaid-block")!;

        await waitFor(() => {
          expect(block.getAttribute("data-mermaid-pending")).toBe("false");
        });

        expect(block.classList.contains("mermaid-rendered")).toBe(true);
        expect(block.classList.contains("mermaid-error")).toBe(false);
        expect(block.querySelector(".mermaid-render-target")!.innerHTML).toContain("diagram");
        expect(consoleSpy).toHaveBeenCalledWith("Mermaid bindFunctions failed", bindError);
      } finally {
        consoleSpy.mockRestore();
      }
    });

    // after async resolution: SVG rendered, state classes set
    it("非同期レンダリング完了後に SVG が挿入され、状態クラスが設定されること", async () => {
      const part = createTextPart(MERMAID_MARKDOWN);
      const { container } = render(<TextPartView part={part} />);

      await waitFor(() => {
        expect(container.querySelector('[data-mermaid-pending="false"]')).toBeInTheDocument();
      });

      const block = container.querySelector(".mermaid-block")!;
      expect(block.classList.contains("mermaid-rendered")).toBe(true);
      const target = block.querySelector(".mermaid-render-target");
      expect(target).toBeInTheDocument();
      expect(target!.innerHTML).toContain("viewBox");
      expect(target!.innerHTML).toContain("diagram");
    });

    // copy button posts raw Mermaid source (not SVG)
    it("コピーボタンで Mermaid ソースが送信されること", async () => {
      const part = createTextPart(MERMAID_MARKDOWN);
      const { container } = render(<TextPartView part={part} />);
      const copyBtn = container.querySelector<HTMLElement>(".code-block-copy");
      expect(copyBtn).toBeInTheDocument();
      expect(copyBtn!.getAttribute("aria-label")).toBe("Copy Mermaid source");

      await waitFor(() => {
        // レンダリング完了を待つ（コピーは同期的でソースは常に存在する）
        expect(container.querySelector('[data-mermaid-pending="false"]')).toBeInTheDocument();
      });

      // Cache-driven re-render can replace the DOM, so re-query the copy
      // button from the current container before clicking.
      const freshCopyBtn = container.querySelector<HTMLElement>(".code-block-copy");
      fireEvent.click(freshCopyBtn!);
      expect(vi.mocked(postMessage)).toHaveBeenCalledWith({
        type: "copyToClipboard",
        text: MERMAID_SOURCE,
      });
      // SVG がコピーされていないこと
      const lastCall = vi.mocked(postMessage).mock.calls.at(-1)?.[0];
      expect(lastCall?.text).not.toContain("<svg");
    });

    // render failure: error state and source preservation
    it("レンダリング失敗時にエラー状態が表示され、ソースが保持されること", async () => {
      const parseError = new Error("Parse error on line 3: syntax error near '-->'");
      mockRenderMermaidDiagram.mockRejectedValueOnce(parseError);

      // TextPartView は async エフェクト内でエラーを捕捉するため、
      // render() 自体はスローしない（unhandled rejection も発生しない）
      // コントラクト: エラーはコンソールに表示されず DOM に表示される
      const { container } = render(<TextPartView part={createTextPart(MERMAID_MARKDOWN)} />);

      await waitFor(() => {
        expect(container.querySelector('[data-mermaid-pending="false"]')).toBeInTheDocument();
      });

      const block = container.querySelector(".mermaid-block")!;

      // エラークラスが設定され、成功クラスは付与されない
      expect(block.classList.contains("mermaid-error")).toBe(true);
      expect(block.classList.contains("mermaid-rendered")).toBe(false);

      // エラーメッセージが target に表示される
      const target = block.querySelector(".mermaid-render-target");
      expect(target).toBeInTheDocument();
      expect(target!.textContent).toContain("Unable to render Mermaid diagram.");
      expect(target!.textContent).toContain("Parse error on line 3");

      // 元の Mermaid ソースは保持されている
      const sourceCode = block.querySelector<HTMLElement>(".mermaid-source code");
      expect(sourceCode).toBeInTheDocument();
      expect(sourceCode!.textContent).toContain(MERMAID_SOURCE);

      // コピーボタンは引き続き動作する
      const copyBtn = block.querySelector<HTMLElement>(".code-block-copy");
      expect(copyBtn).toBeInTheDocument();
      expect(copyBtn!.getAttribute("aria-label")).toBe("Copy Mermaid source");
      fireEvent.click(copyBtn!);
      expect(vi.mocked(postMessage)).toHaveBeenCalledWith({
        type: "copyToClipboard",
        text: MERMAID_SOURCE,
      });
    });
  });

  // Regression: file path linkification is scoped outside Mermaid source
  context("Mermaid ソース内のファイルパスがリンク化されない場合", () => {
    beforeEach(() => {
      mockResolveMermaid();
    });

    it("Mermaid 外部のパスのみリンク化され、内部のパスはテキストのままであること", async () => {
      const text =
        "Check /home/user/config.ts for settings.\n\n" +
        "```mermaid\nflowchart TD\n  /home/user/data.ts --> /home/user/output.ts\n```\n\n" +
        "Also see /home/user/readme.md.";
      const part = createTextPart(text);
      const { container } = render(<TextPartView part={part} />);

      // Mermaid ソース内に拡張子付きパスが含まれていることを確認
      const mermaidSource = container.querySelector(".mermaid-source");
      expect(mermaidSource).toBeInTheDocument();
      expect(mermaidSource!.textContent).toContain("/home/user/data.ts");
      expect(mermaidSource!.textContent).toContain("/home/user/output.ts");

      // Mermaid 内部には data-file-path リンクが存在しない
      expect(mermaidSource!.querySelector("a[data-file-path]")).toBeNull();

      // 非 Mermaid 領域のリンクを `.mermaid-source` の祖先を持たないものに絞る
      const allLinks = container.querySelectorAll<HTMLAnchorElement>("a[data-file-path]");
      const extLinks = Array.from(allLinks).filter((link) => !link.closest(".mermaid-source"));
      expect(extLinks.length).toBeGreaterThanOrEqual(2);

      // Mermaid 外部の最初のリンクをクリックすると openFile が送信される
      const firstLink = extLinks[0];
      fireEvent.click(firstLink!);
      expect(vi.mocked(postMessage)).toHaveBeenCalledWith({
        type: "openFile",
        filePath: "/home/user/config.ts",
        line: undefined,
      });
    });
  });

  // code-block copy button posts only the <pre><code> text, independent of the
  // message-level Copy Markdown action added in copy-chat-markdown.
  // Tests use the real Marked renderer (unmocked in this file).
  context("コードブロックのコピーボタンをクリックした場合", () => {
    // posts the raw <pre><code> text only, not the full Markdown source
    it("コード本文のみを postMessage に送信すること", () => {
      const part = createTextPart("```ts\nconst x = 1;\n```");
      const { container } = render(<TextPartView part={part} />);
      const copyBtn = container.querySelector<HTMLElement>(".code-block-copy");
      expect(copyBtn).toBeInTheDocument();
      fireEvent.click(copyBtn!);
      expect(vi.mocked(postMessage)).toHaveBeenCalledWith({
        type: "copyToClipboard",
        text: "const x = 1;",
      });
    });

    // does not include the code fence or surrounding prose
    it("コードフェンスや前後の文章を含まないこと", () => {
      const part = createTextPart('Here is code:\n\n```py\nprint("hi")\n```\n\nDone.');
      const { container } = render(<TextPartView part={part} />);
      const copyBtn = container.querySelector<HTMLElement>(".code-block-copy");
      expect(copyBtn).toBeInTheDocument();
      fireEvent.click(copyBtn!);
      const call = vi.mocked(postMessage).mock.calls[0]?.[0];
      expect(call).toEqual({ type: "copyToClipboard", text: 'print("hi")' });
      // フェンスや前後に投稿された場合の文字列が混入していないこと
      expect(call?.text).not.toContain("```");
      expect(call?.text).not.toContain("Here is code");
      expect(call?.text).not.toContain("Done.");
    });
  });
});
