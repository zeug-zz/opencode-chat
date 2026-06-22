import type {
  MessagePart,
  QuestionRequest,
  ReasoningPart as ReasoningPartType,
  TextPart,
  ToolPart,
} from "@opencode-chat/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageWithParts } from "../../../App";
import { useAppContext } from "../../../contexts/AppContext";
import { useLocale } from "../../../locales";
import { postMessage } from "../../../vscode-api";
import { ActionButton } from "../../atoms/ActionButton";
import { ChevronRightIcon, EditIcon, InfoCircleIcon, SpinnerIcon } from "../../atoms/icons";
import { ShellResultView } from "../../molecules/ShellResultView";
import { TextPartView } from "../../molecules/TextPartView";
import { QuestionView } from "../QuestionView";
import { isTaskToolPart, type SubtaskPart, SubtaskPartView } from "../SubtaskPartView";
import { ToolPartView } from "../ToolPartView";
import styles from "./MessageItem.module.css";

// コピー用アイコン（二重ページのクリップボード）と、コピー完了時のチェックマーク。
// TextPartView のコードブロックコピーボタンと同じ視覚言語に合わせた。
const COPY_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>`;
const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.763.646z"/></svg>`;

type Props = {
  message: MessageWithParts;
  activeSessionId: string;
  questions: Map<string, QuestionRequest>;
  onEditAndResend?: (messageId: string, text: string) => void;
};

/**
 * アシスタントメッセージの可視テキストパートから、コピー用の Markdown ソースを組み立てる。
 *
 * - `type === "text"` のパートのみを対象とする（tool/reasoning/subtask/file 等は除外）。
 * - 複数パートは Markdown ブロック境界を保つため `\n\n` で連結する。
 * - 空文字列のパートは可視コンテンツではないので除外する。
 * - コピー対象が存在しない場合は `null` を返す（no-copy sentinel）。
 */
export function getAssistantMarkdownSource(parts: MessagePart[]): string | null {
  const texts = parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .filter((text) => text.length > 0);

  return texts.length > 0 ? texts.join("\n\n") : null;
}

/**
 * メッセージのコンテキスト（role / shell 判定）に応じてコピー対象を絞り込む。
 *
 * - ユーザーメッセージ・シェル結果のアシスタントメッセージはコピー対象外。
 * - それ以外（通常の assistant）で可視テキストパートがあれば Step 1.1 の Markdown ソースを返す。
 * - 可視テキストパートが無ければ `null`（no-copy sentinel）。
 */
export function getCopyableAssistantMarkdownSource(
  parts: MessagePart[],
  options: { isUser: boolean; isShell: boolean },
): string | null {
  if (options.isUser || options.isShell) return null;
  return getAssistantMarkdownSource(parts);
}

export function MessageItem({ message, activeSessionId, questions, onEditAndResend }: Props) {
  const t = useLocale();
  const { isShellMessage, childSessions, onNavigateToChild } = useAppContext();
  const { info, parts } = message;
  const isUser = info.role === "user";
  const isShellUser = isUser && isShellMessage(info.id);
  const isShell = !isUser && isShellMessage(info.id);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);
  // コピー直後にチェックマークへ切り替えるための短時間フラグ。
  // 連続クリックでも前のタイマーが残らないように ref で管理する。
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  // このメッセージに紐づく質問リクエストを取得する
  // QuestionRequest.tool.messageID でメッセージと紐付ける
  const messageQuestions = Array.from(questions.values()).filter((q) => q.tool?.messageID === info.id);

  // ユーザーメッセージはテキストパートのみ抽出
  // synthetic かつテキストが空でないものは SDK がファイルコンテキスト用に生成したもの
  // ただし全パートが synthetic の場合は全て表示する（フォールバック）
  const textParts = isUser ? parts.filter((p) => p.type === "text") : [];
  const nonSyntheticTexts = textParts.filter((p) => !(p as TextPart).synthetic);
  const displayTextParts = nonSyntheticTexts.length > 0 ? nonSyntheticTexts : textParts;
  const userText = isUser ? displayTextParts.map((p) => (p as { text: string }).text).join("") : null;

  // ユーザーメッセージに添付されたファイルパートを取得する
  const userFiles = isUser
    ? parts
        .filter((p) => p.type === "file")
        .map((p) => {
          const fp = p as { filename?: string; url?: string };
          const name = fp.filename ?? fp.url ?? "file";
          // file:// プレフィックスを除去し、パスのファイル名だけ表示する
          const cleaned = name.replace(/^file:\/\//, "");
          const basename = cleaned.split("/").pop() ?? cleaned;
          return basename;
        })
    : [];

  // コピー対象の Markdown ソースを組み立てる。
  // user メッセージ / shell 結果 / 可視テキスト無しの場合は null。
  const copyableMarkdown = getCopyableAssistantMarkdownSource(parts, { isUser, isShell });

  const handleStartEdit = useCallback(() => {
    if (!isUser || !userText) return;
    setEditText(userText);
    setEditing(true);
  }, [isUser, userText]);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      // テキストエリアの高さを内容に合わせる
      editRef.current.style.height = "auto";
      editRef.current.style.height = `${editRef.current.scrollHeight}px`;
    }
  }, [editing]);

  const handleEditSubmit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || !onEditAndResend) return;
    setEditing(false);
    onEditAndResend(info.id, trimmed);
  }, [editText, info.id, onEditAndResend]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleEditSubmit();
      }
      if (e.key === "Escape") {
        setEditing(false);
      }
    },
    [handleEditSubmit],
  );

  return (
    <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
      {isUser ? (
        // シェルコマンドのユーザーメッセージは非表示。
        // ShellResultView が "$ command" を既に表示しているため冗長。
        isShellUser ? null : (
          <>
            {editing ? (
              <div className={styles.editContainer}>
                <textarea
                  ref={editRef}
                  className={styles.editTextarea}
                  value={editText}
                  onChange={(e) => {
                    setEditText(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={handleEditKeyDown}
                  rows={1}
                />
                <div className={styles.editActions}>
                  <ActionButton variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    {t["message.cancel"]}
                  </ActionButton>
                  <ActionButton size="sm" onClick={handleEditSubmit} disabled={!editText.trim()}>
                    {t["message.send"]}
                  </ActionButton>
                </div>
              </div>
            ) : (
              <div className={styles.userBubble} onClick={handleStartEdit} title={t["message.clickToEdit"]}>
                <div className={styles.content}>{userText}</div>
                <div className={styles.editIcon}>
                  <EditIcon width={12} height={12} />
                </div>
              </div>
            )}
            {userFiles.length > 0 && (
              <div className={styles.userFiles}>
                {userFiles.map((name, i) => (
                  <span key={i} className={styles.userFileChip}>
                    {name}
                  </span>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <div className={styles.content}>
          {isShell ? (
            // ユーザーが ! プレフィクスで実行したシェルコマンドの結果をターミナル風に表示する。
            // TextPart（“The following tool was executed by the user” 等）は不要なので非表示。
            <ShellResultView parts={parts.filter((p) => p.type === "tool") as ToolPart[]} />
          ) : (
            parts.map((part) => {
              switch (part.type) {
                case "text":
                  return <TextPartView key={part.id} part={part} />;
                case "tool":
                  // task ツール呼び出しはサブエージェント起動なので SubtaskPartView で表示する
                  if (isTaskToolPart(part)) {
                    return (
                      <SubtaskPartView
                        key={part.id}
                        part={part as ToolPart}
                        childSessions={childSessions}
                        onNavigateToChild={onNavigateToChild}
                      />
                    );
                  }
                  return <ToolPartView key={part.id} part={part} />;
                case "subtask":
                  return (
                    <SubtaskPartView
                      key={part.id}
                      part={part as SubtaskPart}
                      childSessions={childSessions}
                      onNavigateToChild={onNavigateToChild}
                    />
                  );
                case "reasoning":
                  return <ReasoningPartView key={part.id} part={part as ReasoningPartType} />;
                default:
                  return null;
              }
            })
          )}
          {messageQuestions.map((q) => (
            <QuestionView key={q.id} question={q} />
          ))}
          {copyableMarkdown && (
            <button
              type="button"
              className={`${styles.copyMarkdownButton}${copied ? ` ${styles.copied}` : ""}`}
              aria-label={t["message.copyMarkdown"]}
              title={t["message.copyMarkdown"]}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                postMessage({ type: "copyToClipboard", text: copyableMarkdown });
                setCopied(true);
                if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
                copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
              }}
            >
              <span dangerouslySetInnerHTML={{ __html: copied ? CHECK_ICON : COPY_ICON }} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Thinking/Reasoning パートの折りたたみ表示 */
function ReasoningPartView({ part }: { part: ReasoningPartType }) {
  const t = useLocale();
  const [expanded, setExpanded] = useState(false);
  const isComplete = !!part.time?.end;

  return (
    <div className={`${styles.reasoningPart} ${isComplete ? "" : styles.reasoningActive}`}>
      <div className={styles.reasoningHeader} onClick={() => setExpanded((s) => !s)} title={t["message.toggleThought"]}>
        <span className={styles.reasoningIcon}>
          {isComplete ? <InfoCircleIcon /> : <SpinnerIcon className={styles.spinner} width={14} height={14} />}
        </span>
        <span className={styles.reasoningLabel}>{isComplete ? t["message.thought"] : t["message.thinking"]}</span>
        <span className={`${styles.chevron} ${expanded ? styles.expanded : ""}`}>
          <ChevronRightIcon />
        </span>
      </div>
      {expanded && <div className={styles.reasoningBody}>{part.text}</div>}
    </div>
  );
}
