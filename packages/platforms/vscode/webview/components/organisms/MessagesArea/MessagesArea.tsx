import type { QuestionRequest } from "@opencode-chat/core";
import type { MessageWithParts } from "../../../App";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import type { ReasoningAssistRowState } from "../../../hooks/useReasoningAssist";
import { useLocale } from "../../../locales";
import { ForkIcon, RevertIcon } from "../../atoms/icons";
import { ScrollToBottomButton } from "../../atoms/ScrollToBottomButton";
import { StreamingIndicator } from "../../atoms/StreamingIndicator";
import { MessageItem } from "../MessageItem";
import { ReasoningAssistRow } from "../ReasoningAssistRow";
import styles from "./MessagesArea.module.css";

type Props = {
  messages: MessageWithParts[];
  sessionBusy: boolean;
  activeSessionId: string;
  showAllThinking?: boolean;
  questions: Map<string, QuestionRequest>;
  reasoningAssistRows?: ReasoningAssistRowState[];
  onEditAndResend: (messageId: string, text: string) => void;
  onRevertToCheckpoint: (assistantMessageId: string, userText: string | null) => void;
  onForkFromCheckpoint: (messageId: string) => void;
};

/**
 * Splits the session's assist rows into rows anchored to a specific user
 * message and rows still waiting for one. Insertion order is preserved.
 */
function groupReasoningAssistRows(rows: ReasoningAssistRowState[]) {
  const anchored = new Map<string, ReasoningAssistRowState[]>();
  const unanchored: ReasoningAssistRowState[] = [];
  for (const row of rows) {
    if (row.anchorMessageId === undefined) {
      unanchored.push(row);
      continue;
    }
    const existing = anchored.get(row.anchorMessageId);
    if (existing) existing.push(row);
    else anchored.set(row.anchorMessageId, [row]);
  }
  return { anchored, unanchored };
}

function getQuestionsForMessage(questions: Map<string, QuestionRequest>, messageId: string) {
  return new Map(Array.from(questions).filter(([, question]) => question.tool?.messageID === messageId));
}

export function MessagesArea({
  messages,
  sessionBusy,
  activeSessionId,
  showAllThinking = false,
  questions,
  reasoningAssistRows,
  onEditAndResend,
  onRevertToCheckpoint,
  onForkFromCheckpoint,
}: Props) {
  const t = useLocale();
  const { containerRef, bottomRef, handleScroll, isNearBottom, scrollToBottom } = useAutoScroll(messages, questions);

  // アシスト行はアンカーのユーザーメッセージ直後に表示する。アンカーが無い行は
  // プリフライト中で対応するプロンプトがまだ届いていないため、トランスクリプト
  // 末尾（最終メッセージの後、メッセージが無ければリストの後）に表示する。
  const { anchored: anchoredAssistRows, unanchored: unanchoredAssistRows } = groupReasoningAssistRows(
    reasoningAssistRows ?? [],
  );

  return (
    <div ref={containerRef} className={styles.root} onScroll={handleScroll}>
      {messages.map((msg, index) => {
        // アシスタントメッセージの直後にチェックポイント区切り線を表示する
        // ただし最後のメッセージの後、busy 中、次がユーザーメッセージの場合のみ
        const isAssistant = msg.info.role === "assistant";
        const nextMsg = messages[index + 1];
        const showCheckpoint = isAssistant && nextMsg && nextMsg.info.role === "user";
        const anchoredRows = msg.info.role === "user" ? anchoredAssistRows.get(msg.info.id) : undefined;
        const carriesUnanchoredRows = unanchoredAssistRows.length > 0 && index === messages.length - 1;

        return (
          <div key={msg.info.id}>
            <MessageItem
              message={msg}
              activeSessionId={activeSessionId}
              showAllThinking={showAllThinking}
              questions={isAssistant ? getQuestionsForMessage(questions, msg.info.id) : new Map()}
              onEditAndResend={onEditAndResend}
            />
            {anchoredRows?.map((row) => (
              <ReasoningAssistRow key={row.promptToken} row={row} />
            ))}
            {carriesUnanchoredRows &&
              unanchoredAssistRows.map((row) => <ReasoningAssistRow key={row.promptToken} row={row} />)}
            {showCheckpoint && (
              <div className={styles.checkpointDivider} title={t["checkpoint.revertTitle"]}>
                <div className={styles.checkpointLine} />
                <button
                  type="button"
                  className={styles.checkpointButton}
                  onClick={() => {
                    // 次のユーザーメッセージのテキストを取得して入力欄に戻す
                    const userMsg = nextMsg;
                    const textParts = userMsg.parts.filter((p) => p.type === "text" && !(p as any).synthetic);
                    const fallbackParts =
                      textParts.length > 0 ? textParts : userMsg.parts.filter((p) => p.type === "text");
                    const userText = fallbackParts.map((p) => (p as any).text).join("") || null;
                    // revert API は指定 ID 以降を削除するので、user メッセージの ID を渡す
                    // こうすることで assistant メッセージまでは残る
                    onRevertToCheckpoint(userMsg.info.id, userText);
                  }}
                >
                  <RevertIcon />
                  <span>{t["checkpoint.retryFromHere"]}</span>
                </button>
                <button
                  type="button"
                  className={styles.checkpointButton}
                  onClick={() => {
                    // 次のユーザーメッセージの ID を渡す。fork API は指定 ID の手前までをコピーするため、
                    // ユーザーメッセージ ID を渡すことでアシスタント応答までが含まれる
                    onForkFromCheckpoint(nextMsg.info.id);
                  }}
                >
                  <ForkIcon />
                  <span>{t["checkpoint.forkFromHere"]}</span>
                </button>
                <div className={styles.checkpointLine} />
              </div>
            )}
          </div>
        );
      })}
      {/* 初回プロンプトはプリフライト中にまだメッセージが無いため、その間も行を表示する */}
      {messages.length === 0 &&
        unanchoredAssistRows.map((row) => <ReasoningAssistRow key={row.promptToken} row={row} />)}
      <div className={styles.scrollButtonSlot}>
        <ScrollToBottomButton
          visible={!isNearBottom}
          ariaLabel={t["scrollToBottom.ariaLabel"]}
          onClick={() => scrollToBottom()}
        />
      </div>
      {sessionBusy && <StreamingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
