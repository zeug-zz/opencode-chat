import type { TextPart } from "@opencodegui/core";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { Marked, type Renderer, type Tokens } from "marked";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { getFileIcon } from "../../../utils/file-icons";
import { preprocessNestedCodeBlocks } from "../../../utils/markdown";
import { renderMermaidDiagram } from "../../../utils/mermaid";
import { postMessage } from "../../../vscode-api";

// --- SVG アイコン (VSC アイコン相当) ---
const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>`;
const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.763.646z"/></svg>`;

/** ファイルパスから拡張子に応じたアイコンの HTML 文字列を生成する（結果はキャッシュ） */
const fileIconHtmlCache = new Map<string, string>();
function getFileIconHtml(filePath: string): string {
  const fileName = filePath.split("/").pop() || filePath;
  const FileTypeIcon = getFileIcon(fileName);
  const key = FileTypeIcon.name;

  const cached = fileIconHtmlCache.get(key);
  if (cached) return cached;

  const container = document.createElement("span");
  const root = createRoot(container);
  flushSync(() => {
    root.render(createElement(FileTypeIcon, { width: 12, height: 12, className: "file-chip-icon" }));
  });
  const html = container.innerHTML;
  root.unmount();

  fileIconHtmlCache.set(key, html);
  return html;
}

/**
 * コードブロック用カスタムレンダラー。
 * - highlight.js によるシンタックスハイライトを適用する
 * - ヘッダーにコピーボタン（plain HTML）を直接出力する
 */
const codeRenderer: Partial<Renderer> = {
  code({ text, lang }: Tokens.Code): string {
    const normalizedLang = lang?.toLowerCase().trim();

    // Mermaid diagram blocks: emit raw source with a render target for later
    // SVG rendering.  The raw source is kept in <pre><code> so the existing
    // delegated copy handler can still read it via textContent.
    if (normalizedLang === "mermaid") {
      const escapedSource = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      const copyBtn = `<button class="code-block-copy" type="button" aria-label="Copy Mermaid source">${COPY_ICON}</button>`;
      return `<div class="mermaid-block code-block-wrapper" data-mermaid-pending="true"><div class="code-block-header"><span class="code-block-lang">mermaid</span>${copyBtn}</div><pre class="mermaid-source" aria-label="Mermaid diagram source"><code class="language-mermaid">${escapedSource}</code></pre><div class="mermaid-render-target" role="img" aria-label="Mermaid diagram" tabindex="0"></div></div>`;
    }

    let highlighted: string;
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(text, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }
    const langLabel = lang ? `<span class="code-block-lang">${lang}</span>` : "";
    const copyBtn = `<button class="code-block-copy" type="button" aria-label="Copy code">${COPY_ICON}</button>`;
    return `<div class="code-block-wrapper"><div class="code-block-header">${langLabel}${copyBtn}</div><pre><code class="hljs${lang ? ` language-${lang}` : ""}">${highlighted}</code></pre></div>`;
  },
};

/**
 * マークダウンリンクのカスタムレンダラー。
 * href がローカル絶対パス（/始まり）の場合、data-file-path 属性を付与してクリックインターセプトの対象にする。
 * 行番号は `#L{number}` フラグメントから抽出する。
 */
const linkRenderer: Partial<Renderer> = {
  link({ href, text }: Tokens.Link): string {
    if (href.startsWith("/")) {
      // フラグメントから行番号を抽出する
      const lineMatch = href.match(/#L(\d+)$/);
      const filePath = lineMatch ? href.slice(0, lineMatch.index) : href;
      const lineAttr = lineMatch ? ` data-file-line="${lineMatch[1]}"` : "";
      const escapedPath = filePath.replace(/"/g, "&quot;");
      const iconHtml = getFileIconHtml(filePath);
      return `<a href="#" class="file-chip" data-file-path="${escapedPath}"${lineAttr}>${iconHtml}<span class="file-chip-label">${text}</span></a>`;
    }
    return `<a href="${href}">${text}</a>`;
  },
};

// DOMPurify で SVG 要素とカスタム data 属性を許可する設定
const PURIFY_CONFIG: DOMPurify.Config = {
  ADD_TAGS: ["svg", "path", "rect", "circle", "ellipse", "polygon", "text", "linearGradient", "stop", "defs"],
  ADD_ATTR: [
    "viewBox",
    "fill",
    "fill-rule",
    "clip-rule",
    "d",
    "xmlns",
    "data-file-path",
    "data-file-line",
    "rx",
    "ry",
    "r",
    "cx",
    "cy",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "transform",
    "opacity",
    "points",
    "text-anchor",
    "font-weight",
    "font-size",
    "font-family",
    "dominant-baseline",
    "x1",
    "x2",
    "y1",
    "y2",
    "offset",
    "stop-color",
    "gradientUnits",
    "aria-hidden",
    "role",
    "tabindex",
  ],
};

/**
 * Scoped DOMPurify config for Mermaid SVG output.
 *
 * More permissive than the base `PURIFY_CONFIG` because Mermaid renders rich
 * SVG with gradients, markers, filters, and style blocks.  Kept in a separate
 * config so the base Markdown sanitizer remains strict.
 *
 * First-release constraints:
 * - URL/link attributes (`href`, `xlink:href`) are explicitly forbidden.
 * - Clickable Mermaid actions/links are disabled.
 * - No `<a>` or `<image>` tags — even if Mermaid could emit them, the
 *   sanitizer strips them.
 * - Event-handler attributes (`onclick`, `onload`, etc.) are explicitly
 *   forbidden (redundant with DOMPurify's own `FORBID_ATTR` but explicit
 *   for auditability).
 *
 * Mermaid's own `securityLevel: "strict"` (set in the helper) provides the
 * first line of defence; this config is the second.
 */
const MERMAID_PURIFY_CONFIG: DOMPurify.Config = {
  ADD_TAGS: [
    // SVG structural
    "svg",
    "g",
    "defs",
    "symbol",
    "use",
    "mask",
    "clipPath",
    // SVG shapes
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    // SVG text / labels
    "text",
    "tspan",
    "title",
    "desc",
    // SVG gradients
    "linearGradient",
    "radialGradient",
    "stop",
    // SVG filters (drop-shadows, blurs)
    "filter",
    "feDropShadow",
    "feGaussianBlur",
    "feMerge",
    "feMergeNode",
    "feOffset",
    "feFlood",
    // SVG markers (arrowheads, etc.)
    "marker",
    // SVG patterns (hatching, fills)
    "pattern",
    // SVG styling (Mermaid uses <style> for scoped CSS)
    "style",
    // SVG containers for HTML-like layout (e.g. flowcharts with line breaks)
    "foreignObject",
    // HTML wrappers inside foreignObject
    "div",
    "span",
    "br",
    "p",
    "b",
    "i",
    "em",
    "strong",
    "table",
    "tbody",
    "tr",
    "td",
    "th",
  ],
  ADD_ATTR: [
    // Core SVG
    "viewBox",
    "version",
    "baseProfile",
    // Dimensions / coordinates
    "width",
    "height",
    "x",
    "y",
    "dx",
    "dy",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    // Path / geometry
    "d",
    "points",
    // Transform
    "transform",
    "gradientTransform",
    "patternTransform",
    // Stroke
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "stroke-opacity",
    "stroke-miterlimit",
    // Fill
    "fill",
    "fill-rule",
    "fill-opacity",
    // Opacity
    "opacity",
    // Colour / presentation
    "color",
    "display",
    "visibility",
    "overflow",
    // Gradient
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "spreadMethod",
    // Font / text
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "text-decoration",
    "letter-spacing",
    "word-spacing",
    "line-height",
    "direction",
    "unicode-bidi",
    "textLength",
    "lengthAdjust",
    // Marker (arrowheads, dots)
    "marker-start",
    "marker-mid",
    "marker-end",
    "markerWidth",
    "markerHeight",
    "orient",
    "refX",
    "refY",
    // Filter
    "in",
    "in2",
    "result",
    "stdDeviation",
    "flood-color",
    "flood-opacity",
    // Clip / mask
    "clip-path",
    "clip-rule",
    "mask",
    // Pattern
    "patternUnits",
    "patternContentUnits",
    // Layout (for tspan)
    "spacing",
    "startOffset",
    "preserveAspectRatio",
    // Namespace (required for standalone SVG fragments)
    "xmlns",
    "xmlns:xlink",
    "xml:space",
  ],
  FORBID_TAGS: ["script", "a", "image"],
  FORBID_ATTR: ["href", "xlink:href", "onclick", "onload", "onerror", "onmouseover", "onfocus"],
};

/**
 * 絶対ファイルパスの正規表現。
 * コードブロック内やすでに HTML タグ内にあるパスを除外するため、HTML 後処理で使用する。
 * パスは /[alphanumeric/._-]+ の形式で、拡張子を持つもののみマッチする。
 */
const ABSOLUTE_PATH_RE = /(?<!["\w/])(\/([\w.-]+\/)*[\w.-]+\.\w+)(?::(\d+))?/g;

/**
 * HTML 文字列中のコードブロック外にある絶対ファイルパスをリンク化する。
 * <pre>, <code>, <a> タグの内部は変換しない。
 */
function linkifyAbsolutePaths(html: string): string {
  // タグとテキストを分離して処理する
  // HTML タグ内部のパスや、既にリンク内・コード内のパスは変換しない
  let depth = 0;
  const SKIP_OPEN = /<(pre|code|a)[\s>]/gi;
  const SKIP_CLOSE = /<\/(pre|code|a)>/gi;

  return html.replace(/(<[^>]+>)|([^<]+)/g, (_match, tag: string | undefined, text: string | undefined) => {
    if (tag) {
      // スキップ対象タグの深さ管理
      SKIP_OPEN.lastIndex = 0;
      SKIP_CLOSE.lastIndex = 0;
      if (SKIP_OPEN.test(tag)) depth++;
      else if (SKIP_CLOSE.test(tag)) depth = Math.max(0, depth - 1);
      return tag;
    }
    if (!text || depth > 0) return text ?? "";
    // テキストノード内の絶対パスをリンク化
    return text.replace(ABSOLUTE_PATH_RE, (_m, filePath: string, _dir: string, lineNum: string | undefined) => {
      const escapedPath = filePath.replace(/"/g, "&quot;");
      const lineAttr = lineNum ? ` data-file-line="${lineNum}"` : "";
      const display = lineNum ? `${filePath}:${lineNum}` : filePath;
      const iconHtml = getFileIconHtml(filePath);
      return `<a href="#" class="file-chip" data-file-path="${escapedPath}"${lineAttr}>${iconHtml}<span class="file-chip-label">${display}</span></a>`;
    });
  });
}

/**
 * Format a Mermaid render/parse error into a concise user-facing string.
 *
 * Avoids stack traces and caps length to prevent huge error text in the UI.
 */
function formatMermaidError(err: unknown): string {
  const PREFIX = "Unable to render Mermaid diagram.";
  const MAX_LEN = 200;

  let message: string;
  if (err instanceof Error) {
    // Use only the first line of the message; strip stack trace entirely
    message = err.message.split("\n")[0].trim();
  } else if (typeof err === "string") {
    message = err;
  } else {
    message = "Unknown error";
  }

  if (message.length > MAX_LEN) {
    message = `${message.slice(0, MAX_LEN).trimEnd()}…`;
  }

  return `${PREFIX}\n${message}`;
}

type MermaidRenderResult = { type: "svg"; svg: string } | { type: "error"; message: string };

/**
 * Inject already-sanitised Mermaid results back into the HTML string so React
 * re-renders keep rendered diagrams (and error states) instead of replacing
 * them with the pending source wrapper.
 *
 * SVG strings in `cache` were already sanitised with
 * {@link MERMAID_PURIFY_CONFIG} before insertion, so this function does not
 * re-sanitise them.  It only mutates the parsed HTML in-memory and serialises
 * it back to a string.
 */
function injectRenderedMermaids(html: string, cache: ReadonlyMap<string, MermaidRenderResult>): string {
  if (cache.size === 0) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  let modified = false;

  for (const block of doc.querySelectorAll<HTMLElement>(".mermaid-block")) {
    const source = block.querySelector<HTMLElement>(".mermaid-source code")?.textContent ?? "";
    const cached = cache.get(source);
    if (!cached) continue;

    const target = block.querySelector<HTMLElement>(".mermaid-render-target");
    if (!target) continue;

    if (cached.type === "svg") {
      target.innerHTML = cached.svg;
      block.classList.add("mermaid-rendered");
    } else {
      target.textContent = cached.message;
      block.classList.add("mermaid-error");
    }
    block.setAttribute("data-mermaid-pending", "false");
    modified = true;
  }

  return modified ? doc.body.innerHTML : html;
}

// marked インスタンス（グローバル状態を汚染しない）
const markdownParser = new Marked({ breaks: true }, { renderer: { ...codeRenderer, ...linkRenderer } });

type Props = {
  part: TextPart;
};

export function TextPartView({ part }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mermaidSvgCacheRef = useRef(new Map<string, MermaidRenderResult>());
  const [renderedTick, setRenderedTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderedTick intentionally triggers recompute when the Mermaid cache updates.
  const html = useMemo(() => {
    const preprocessed = preprocessNestedCodeBlocks(part.text);
    const raw = markdownParser.parse(preprocessed, { async: false }) as string;
    const linked = linkifyAbsolutePaths(raw);
    const sanitized = DOMPurify.sanitize(linked, PURIFY_CONFIG);
    return injectRenderedMermaids(sanitized, mermaidSvgCacheRef.current);
  }, [part.text, renderedTick]);

  // Mermaid 描画エフェクト: html が変更されるたびに未描画の .mermaid-block を検出し、
  // 動的インポート・初期化・レンダリングを実行する。
  // クリーンアップ時に AbortController を abort することで、
  // ストリーミング更新による古い SVG の DOM 書き込みを防止する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect must rerun whenever the parsed HTML changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new AbortController();
    const { signal } = controller;

    const blocks = container.querySelectorAll<HTMLElement>('.mermaid-block[data-mermaid-pending="true"]');

    const renderPendingBlocks = async () => {
      for (const block of blocks) {
        if (signal.aborted) break;

        const sourceEl = block.querySelector<HTMLElement>(".mermaid-source code");
        const targetEl = block.querySelector<HTMLElement>(".mermaid-render-target");
        if (!sourceEl || !targetEl) continue;

        const source = sourceEl.textContent ?? "";

        // Already-failed sources should not be retried on every re-render.
        const cached = mermaidSvgCacheRef.current.get(source);
        if (cached?.type === "error") {
          targetEl.textContent = cached.message;
          block.setAttribute("data-mermaid-pending", "false");
          block.classList.add("mermaid-error");
          continue;
        }

        try {
          if (signal.aborted) break;

          const { svg, bindFunctions } = await renderMermaidDiagram(source, { signal });

          // 最後のチェック: signal が abort されていないこと、かつ target が
          // まだ DOM に接続されていること（コンポーネントのアンマウント回避）
          if (signal.aborted || !targetEl.isConnected) {
            return;
          }

          const sanitizedSvg = DOMPurify.sanitize(svg, MERMAID_PURIFY_CONFIG);
          targetEl.innerHTML = sanitizedSvg;

          // Cache the sanitised SVG so React re-renders keep the rendered
          // diagram instead of replacing it with the pending source wrapper.
          mermaidSvgCacheRef.current.set(source, { type: "svg", svg: sanitizedSvg });
          setRenderedTick((t) => t + 1);

          try {
            bindFunctions?.(targetEl);
          } catch (bindErr) {
            console.error("Mermaid bindFunctions failed", bindErr);
          }
          block.setAttribute("data-mermaid-pending", "false");
          block.classList.add("mermaid-rendered");
        } catch (err) {
          // AbortError: stale レンダリング → 次の effect に任せる
          if (err instanceof DOMException && err.name === "AbortError") {
            break;
          }

          // レンダリングエラー: ソースを残したままエラー状態を表示する。
          // target がまだ DOM に接続されている場合のみ書き込む。
          if (signal.aborted || !targetEl.isConnected) return;

          const errorMessage = formatMermaidError(err);
          mermaidSvgCacheRef.current.set(source, { type: "error", message: errorMessage });
          setRenderedTick((t) => t + 1);

          targetEl.textContent = errorMessage;
          block.setAttribute("data-mermaid-pending", "false");
          block.classList.add("mermaid-error");
        }
      }
    };

    void renderPendingBlocks();

    return () => {
      controller.abort("Mermaid render stale");
    };
  }, [html]);

  // イベント委譲: コンテナ要素に1つのクリックハンドラーを付けて
  // .code-block-copy ボタンと data-file-path リンクのクリックを検出する
  const handleClick = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    const target = e.target as HTMLElement;

    // ファイルパスリンクのクリック処理
    const fileLink = target.closest<HTMLAnchorElement>("a[data-file-path]");
    if (fileLink) {
      e.preventDefault();
      const filePath = fileLink.dataset.filePath;
      if (filePath) {
        const line = fileLink.dataset.fileLine ? Number(fileLink.dataset.fileLine) : undefined;
        postMessage({ type: "openFile", filePath, line });
      }
      return;
    }

    // コピーボタンのクリック処理
    const btn = target.closest<HTMLButtonElement>(".code-block-copy");
    if (!btn) return;

    const wrapper = btn.closest(".code-block-wrapper");
    const codeEl = wrapper?.querySelector<HTMLElement>("pre code");
    if (!codeEl) return;

    const code = codeEl.textContent ?? "";
    postMessage({ type: "copyToClipboard", text: code });

    btn.innerHTML = CHECK_ICON;
    btn.classList.add("copied");
    setTimeout(() => {
      btn.innerHTML = COPY_ICON;
      btn.classList.remove("copied");
    }, 1500);
  }, []);

  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: DOMPurify でサニタイズ済みの HTML を描画する
    // biome-ignore lint/a11y/useKeyWithClickEvents: コピーボタンとファイルリンクのイベント委譲
    // biome-ignore lint/a11y/noStaticElementInteractions: コピーボタンとファイルリンクのイベント委譲
    <div ref={containerRef} className="markdown" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
