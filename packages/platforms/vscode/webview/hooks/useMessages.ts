import type { AgentEvent, ChatMessage, ChatSession, MessagePart, ReasoningPart } from "@opencode-chat/core";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

export type MessageWithParts = { info: ChatMessage; parts: MessagePart[] };

/** メッセージ情報を追加または更新する */
function upsertMessage(prev: MessageWithParts[], info: ChatMessage): MessageWithParts[] {
  const idx = prev.findIndex((m) => m.info.id === info.id);
  if (idx >= 0) {
    const updated = [...prev];
    updated[idx] = { ...updated[idx], info };
    return updated;
  }
  return [...prev, { info, parts: [] }];
}

/** パートを追加または更新する */
function upsertPart(prev: MessageWithParts[], part: MessagePart): MessageWithParts[] {
  const idx = prev.findIndex((m) => m.info.id === part.messageID);
  if (idx < 0) return prev;
  const updated = [...prev];
  const msg = { ...updated[idx] };
  const partIdx = msg.parts.findIndex((p) => p.id === part.id);
  if (partIdx >= 0) {
    msg.parts = [...msg.parts];
    msg.parts[partIdx] = part;
  } else {
    msg.parts = [...msg.parts, part];
  }
  updated[idx] = msg;
  return updated;
}

/** メッセージを削除する */
function removeMessage(prev: MessageWithParts[], messageID: string): MessageWithParts[] {
  return prev.filter((m) => m.info.id !== messageID);
}

function getMessageKey(sessionID: string, messageID: string) {
  return `${sessionID}:${messageID}`;
}

function getLongestText(...values: Array<string | null | undefined>) {
  return values.reduce((best, value) => {
    if (typeof value !== "string") return best;
    return value.length > best.length ? value : best;
  }, "");
}

type CotTracePayload = {
  source: string;
  eventType?: string;
  sessionID?: string;
  messageID?: string;
  reasoningID?: string;
  partID?: string;
  previousLength?: number;
  nextLength?: number;
  previousTextPreview?: string;
  nextTextPreview?: string;
  incomingMessagePresent?: boolean;
  retained?: boolean;
  reason?: string;
  parts?: Array<{ id: string; type: string; textLength: number | null }>;
};

const COT_TRACE_PREFIX = "[opencode-chat cot-glitch]";

function getTextPreview(text: string | undefined) {
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function getPartTextLength(part: MessagePart) {
  return "text" in part && typeof part.text === "string" ? part.text.length : null;
}

function describeParts(parts: MessagePart[]) {
  return parts.map((part) => ({
    id: part.id,
    type: part.type,
    textLength: getPartTextLength(part),
  }));
}

function warnCotGlitch(payload: CotTracePayload) {
  console.warn(COT_TRACE_PREFIX, payload);
}

function getMessageSessionID(message: MessageWithParts) {
  return (
    (message.info as { sessionID?: string }).sessionID ??
    (message.parts.find((part) => "sessionID" in part) as { sessionID?: string } | undefined)?.sessionID
  );
}

const REASONING_SNAPSHOT_GRACE_MS = 5000;

/**
 * チャットメッセージの状態管理フック。
 *
 * メッセージの実体はサーバー側が保持しているが、AI の応答中はテキストやツール呼び出しの
 * パートが SSE で細かく差分配信されるため、Webview 側でも配列を保持して差分マージすることで
 * ストリーミング表示をリアルタイムに実現している。
 */
export function useMessages(activeSessionRef: RefObject<ChatSession | null>) {
  const [messages, setMessages] = useState<MessageWithParts[]>([]);
  const [prefillText, setPrefillText] = useState("");

  // ユーザーが ! プレフィクスで実行したシェルコマンドのメッセージ ID を追跡する。
  // executeShell 呼び出し直前に pendingShell を true にし、
  // 次に到着する assistant の message.updated でそのメッセージ ID を shellMessageIds に登録する。
  const pendingShell = useRef(false);
  const [shellMessageIds, setShellMessageIds] = useState<Set<string>>(new Set());

  // reasoningID → accumulated text buffer for streaming reasoning/CoT content
  const reasoningBuffers = useRef<Map<string, string>>(new Map());
  // partID → accumulated text buffer for message.part.delta streaming
  const deltaBuffers = useRef<Map<string, string>>(new Map());
  const pendingFlush = useRef<number | null>(null);
  const reasoningPending = useRef<number | null>(null);
  const reasoningMessageKeys = useRef<Set<string>>(new Set());
  const reasoningIdsByMessageKey = useRef<Map<string, Set<string>>>(new Map());
  const reasoningPartIdByMessageKey = useRef<Map<string, string>>(new Map());
  const reasoningIdToPartId = useRef<Map<string, string>>(new Map());
  const activeReasoningMessageKeys = useRef<Set<string>>(new Set());
  const reasoningSnapshotProtectUntil = useRef<Map<string, number>>(new Map());
  const cotTextLengthByPartId = useRef<Map<string, number>>(new Map());
  const missingSnapshotLoggedKeys = useRef<Set<string>>(new Set());

  const flushDeltaBuffers = useCallback(() => {
    pendingFlush.current = null;
    setMessages((prev) => {
      let changed = false;
      const updated = prev.map((msg) => {
        let partsChanged = false;
        const newParts = msg.parts.map((part) => {
          const buffered = deltaBuffers.current.get(part.id);
          if (buffered != null && "text" in part) {
            const currentText = (part as { text: string }).text;
            const text = getLongestText(buffered, currentText);
            if (text !== currentText) {
              partsChanged = true;
              return { ...part, text };
            }
          }
          return part;
        });
        if (partsChanged) {
          changed = true;
          return { ...msg, parts: newParts };
        }
        return msg;
      });
      if (changed) {
        return updated;
      }
      return prev;
    });
  }, []);

  const traceTextChange = useCallback(
    (payload: {
      source: string;
      eventType?: string;
      sessionID?: string;
      messageID?: string;
      reasoningID?: string;
      partID: string;
      nextText: string;
    }) => {
      const previousLength = cotTextLengthByPartId.current.get(payload.partID) ?? 0;
      const nextLength = payload.nextText.length;

      if (previousLength > 0 && nextLength < previousLength) {
        warnCotGlitch({
          source: payload.source,
          eventType: payload.eventType,
          sessionID: payload.sessionID,
          messageID: payload.messageID,
          reasoningID: payload.reasoningID,
          partID: payload.partID,
          previousLength,
          nextLength,
          nextTextPreview: getTextPreview(payload.nextText),
          reason: nextLength === 0 ? "reasoning text became empty" : "reasoning text shrank",
        });
      }

      cotTextLengthByPartId.current.set(payload.partID, Math.max(previousLength, nextLength));
    },
    [],
  );

  const flushReasoningBuffers = useCallback(() => {
    reasoningPending.current = null;
    if (reasoningBuffers.current.size === 0) return;
    setMessages((prev) => {
      let changed = false;
      const updated = prev.map((msg) => {
        let partsChanged = false;
        const newParts = msg.parts.map((part) => {
          if (part.type !== "reasoning") return part;
          const buffered = reasoningBuffers.current.get(part.id);
          if (buffered != null && "text" in part && (part as { text: string }).text !== buffered) {
            partsChanged = true;
            traceTextChange({
              source: "flushReasoningBuffers",
              partID: part.id,
              sessionID: part.sessionID,
              messageID: part.messageID,
              nextText: buffered,
            });
            return { ...part, text: buffered };
          }
          return part;
        });
        if (partsChanged) {
          changed = true;
          return { ...msg, parts: newParts };
        }
        return msg;
      });
      return changed ? updated : prev;
    });
  }, [traceTextChange]);

  const trackReasoningMessage = useCallback((sessionID: string, messageID: string, reasoningID: string) => {
    const key = getMessageKey(sessionID, messageID);
    reasoningMessageKeys.current.add(key);
    activeReasoningMessageKeys.current.add(key);
    reasoningSnapshotProtectUntil.current.delete(key);

    const ids = reasoningIdsByMessageKey.current.get(key) ?? new Set<string>();
    ids.add(reasoningID);
    reasoningIdsByMessageKey.current.set(key, ids);

    let partID = reasoningPartIdByMessageKey.current.get(key);
    if (!partID) {
      partID = reasoningID;
      reasoningPartIdByMessageKey.current.set(key, partID);
    }

    reasoningIdToPartId.current.set(reasoningID, partID);
    return partID;
  }, []);

  const getReasoningPartID = useCallback((reasoningID: string) => {
    return reasoningIdToPartId.current.get(reasoningID) ?? reasoningID;
  }, []);

  const shouldRetainMissingReasoningMessage = useCallback((message: MessageWithParts) => {
    const sessionID = getMessageSessionID(message);
    if (!sessionID) return false;

    const key = getMessageKey(sessionID, message.info.id);
    if (activeReasoningMessageKeys.current.has(key)) return true;

    const protectUntil = reasoningSnapshotProtectUntil.current.get(key);
    if (protectUntil != null && protectUntil > Date.now()) return true;

    return false;
  }, []);

  const mergeSnapshotPreservingReasoning = useCallback(
    (prev: MessageWithParts[], incoming: MessageWithParts[]) => {
      const merged = incoming.map((incomingMessage) => {
        const sessionID = getMessageSessionID(incomingMessage);
        if (!sessionID) return incomingMessage;

        const key = getMessageKey(sessionID, incomingMessage.info.id);

        // Reset missing-snapshot log key when message appears in a snapshot
        if (reasoningMessageKeys.current.has(key)) {
          missingSnapshotLoggedKeys.current.delete(key);
        }

        if (!reasoningMessageKeys.current.has(key)) {
          const previousMessage = prev.find((message) => message.info.id === incomingMessage.info.id);

          const activeDelta = incomingMessage.parts.some((part) => deltaBuffers.current.has(part.id));
          const orphanedDelta =
            previousMessage?.parts.filter(
              (part) => deltaBuffers.current.has(part.id) && !incomingMessage.parts.some((p) => p.id === part.id),
            ) ?? [];

          if (!activeDelta && orphanedDelta.length === 0) return incomingMessage;

          const protectedParts = incomingMessage.parts.map((part) => {
            const buffered = deltaBuffers.current.get(part.id);
            if (buffered == null) return part;
            if (!("text" in part)) return part;

            const incomingText = (part as { text: string }).text;
            const previousPart = previousMessage?.parts.find((p) => p.id === part.id);
            const previousText = previousPart && "text" in previousPart ? (previousPart as { text: string }).text : "";
            const text = getLongestText(buffered, previousText, incomingText);

            return { ...part, text };
          });

          const preservedOrphans = orphanedDelta.map((part) => {
            const buffered = deltaBuffers.current.get(part.id)!;
            const currentText = "text" in part ? (part as { text: string }).text : "";
            const text = getLongestText(buffered, currentText);
            return { ...part, text };
          });

          return {
            ...incomingMessage,
            parts: [...protectedParts, ...preservedOrphans],
          };
        }

        const canonicalPartID = reasoningPartIdByMessageKey.current.get(key);
        if (!canonicalPartID) return incomingMessage;

        const previousMessage = prev.find((message) => message.info.id === incomingMessage.info.id);
        const previousReasoning = previousMessage?.parts.find(
          (part) => part.type === "reasoning" && part.id === canonicalPartID,
        ) as ReasoningPart | undefined;

        const incomingReasoning = incomingMessage.parts.find((part) => part.type === "reasoning") as
          | ReasoningPart
          | undefined;

        const bufferedText = reasoningBuffers.current.get(canonicalPartID);
        const previousText = previousReasoning?.text;
        const incomingText = incomingReasoning?.text;
        const text = getLongestText(bufferedText, previousText, incomingText);

        if (!previousReasoning && !incomingReasoning && !text) return incomingMessage;

        reasoningBuffers.current.set(canonicalPartID, text);

        traceTextChange({
          source: "mergeSnapshotPreservingReasoning",
          sessionID,
          messageID: incomingMessage.info.id,
          partID: canonicalPartID,
          nextText: text,
        });

        const sourceReasoning = incomingReasoning ?? previousReasoning;
        const reasoningPart: ReasoningPart = {
          id: canonicalPartID,
          sessionID,
          messageID: incomingMessage.info.id,
          type: "reasoning",
          text,
          time: {
            start: sourceReasoning?.time?.start ?? Date.now(),
            end: sourceReasoning?.time?.end,
          },
          ...(sourceReasoning?.metadata !== undefined ? { metadata: sourceReasoning.metadata } : {}),
        };

        const partsWithoutReasoning = incomingMessage.parts.filter((part) => part.type !== "reasoning");
        const previousIndex = previousMessage?.parts.findIndex(
          (part) => part.type === "reasoning" && part.id === canonicalPartID,
        );
        const insertIndex =
          typeof previousIndex === "number" && previousIndex >= 0
            ? Math.min(previousIndex, partsWithoutReasoning.length)
            : 0;

        const parts = [...partsWithoutReasoning];
        parts.splice(insertIndex, 0, reasoningPart);

        return { ...incomingMessage, parts };
      });

      const incomingIds = new Set(incoming.map((message) => message.info.id));

      const retained = prev.filter((message) => {
        if (incomingIds.has(message.info.id)) return false;
        return shouldRetainMissingReasoningMessage(message);
      });

      // Log retained messages that were missing from incoming snapshot
      for (const message of retained) {
        const sessionID = getMessageSessionID(message);
        if (!sessionID) continue;
        const missingKey = getMessageKey(sessionID, message.info.id);
        if (!missingSnapshotLoggedKeys.current.has(missingKey)) {
          missingSnapshotLoggedKeys.current.add(missingKey);
          warnCotGlitch({
            source: "mergeSnapshotPreservingReasoning",
            sessionID,
            messageID: message.info.id,
            incomingMessagePresent: false,
            retained: true,
            reason: "managed reasoning message missing from incoming snapshot; retained previous local message",
            parts: describeParts(message.parts),
          });
        }
      }

      if (retained.length === 0) return merged;

      return [...merged, ...retained];
    },
    [shouldRetainMissingReasoningMessage, traceTextChange],
  );

  const setMessagesFromSnapshot = useCallback(
    (next: MessageWithParts[] | ((prev: MessageWithParts[]) => MessageWithParts[])) => {
      setMessages((prev) => {
        const incoming = typeof next === "function" ? next(prev) : next;
        return mergeSnapshotPreservingReasoning(prev, incoming);
      });
    },
    [mergeSnapshotPreservingReasoning],
  );

  const markPendingShell = useCallback(() => {
    pendingShell.current = true;
  }, []);

  const isShellMessage = useCallback((messageId: string) => shellMessageIds.has(messageId), [shellMessageIds]);

  const consumePrefill = useCallback(() => {
    setPrefillText("");
  }, []);

  // SSE event handler for message-related events
  // activeSessionRef を介して現在のアクティブセッション ID を参照し、
  // 別セッション（サブエージェントの子セッションなど）のイベントを無視する。
  const handleMessageEvent = useCallback(
    (event: AgentEvent) => {
      const activeId = activeSessionRef.current?.id;
      switch (event.type) {
        case "message.updated": {
          const info = event.properties.info as ChatMessage;
          // アクティブセッション以外のメッセージイベントは無視する。
          // サブエージェント（子セッション）のメッセージが親セッションの表示に混入するのを防ぐ。
          if (activeId && info.sessionID !== activeId) break;
          // pendingShell が true のとき、user / assistant メッセージ両方をシェルとしてタグ付けする。
          // user メッセージは吹き出しを非表示にするため、assistant メッセージは ShellResultView 表示に使う。
          if (pendingShell.current) {
            if (info.role === "user" || info.role === "assistant") {
              setShellMessageIds((prev) => new Set(prev).add(info.id));
            }
            // assistant が到着したらフラグをクリアする
            if (info.role === "assistant") {
              pendingShell.current = false;
            }
          }
          setMessages((prev) => upsertMessage(prev, info));
          break;
        }
        case "message.part.updated": {
          const part = event.properties.part;
          if (activeId && part.sessionID !== activeId) break;
          if (
            part.type === "reasoning" &&
            reasoningMessageKeys.current.has(getMessageKey(part.sessionID, part.messageID))
          ) {
            const canonicalPartID = reasoningPartIdByMessageKey.current.get(
              getMessageKey(part.sessionID, part.messageID),
            );
            const knownLength = canonicalPartID ? (reasoningBuffers.current.get(canonicalPartID)?.length ?? 0) : 0;
            const incomingText = (part as { text?: string }).text ?? "";
            if (knownLength > 0 && incomingText.length < knownLength) {
              warnCotGlitch({
                source: "message.part.updated-skip",
                eventType: event.type,
                sessionID: part.sessionID,
                messageID: part.messageID,
                partID: part.id,
                previousLength: knownLength,
                nextLength: incomingText.length,
                nextTextPreview: getTextPreview(incomingText),
                reason: "skipped stale managed reasoning snapshot",
              });
            }
            break;
          }
          const serverText = (part as { text?: string }).text;
          const bufferedText = deltaBuffers.current.get(part.id);
          const reasoningBuffered = reasoningBuffers.current.get(part.id);
          // Reasoning delta stream owns this part while active — skip stale server snapshots
          if (reasoningBuffered != null) break;
          // バッファが存在する & サーバーから空テキストが送られてきた場合、
          // ストリーミング中の部分を上書きしないために setMessages をスキップする。
          if (bufferedText != null && !serverText) break;
          setMessages((prev) => {
            const msgIdx = prev.findIndex((m) => m.info.id === part.messageID);
            const existingPart = msgIdx >= 0 ? prev[msgIdx].parts.find((p) => p.id === part.id) : null;
            const existingText =
              existingPart && "text" in existingPart ? (existingPart as { text: string }).text : null;
            const finalText =
              bufferedText != null ? bufferedText : existingText != null ? existingText : (serverText ?? "");
            return upsertPart(prev, { ...part, text: finalText });
          });
          if (
            (part as Record<string, unknown>)?.time &&
            typeof (part as Record<string, unknown>).time === "object" &&
            "end" in ((part as Record<string, unknown>).time as object)
          ) {
            deltaBuffers.current.delete(part.id);
          }
          break;
        }
        case "message.removed": {
          if (activeId && event.properties.sessionID !== activeId) break;
          const key = getMessageKey(event.properties.sessionID, event.properties.messageID);
          reasoningMessageKeys.current.delete(key);
          activeReasoningMessageKeys.current.delete(key);
          reasoningSnapshotProtectUntil.current.delete(key);

          const canonicalPartID = reasoningPartIdByMessageKey.current.get(key);
          if (canonicalPartID) {
            reasoningBuffers.current.delete(canonicalPartID);
            deltaBuffers.current.delete(canonicalPartID);
            reasoningPartIdByMessageKey.current.delete(key);
          }

          const reasoningIds = reasoningIdsByMessageKey.current.get(key);
          if (reasoningIds) {
            for (const reasoningID of reasoningIds) {
              const mappedPartID = reasoningIdToPartId.current.get(reasoningID);
              if (mappedPartID) {
                reasoningBuffers.current.delete(mappedPartID);
                deltaBuffers.current.delete(mappedPartID);
              }
              reasoningBuffers.current.delete(reasoningID);
              deltaBuffers.current.delete(reasoningID);
              reasoningIdToPartId.current.delete(reasoningID);
            }
            reasoningIdsByMessageKey.current.delete(key);
          }

          setMessages((prev) => removeMessage(prev, event.properties.messageID));
          break;
        }
        case "session.next.reasoning.started": {
          const { sessionID, assistantMessageID, reasoningID } = event.properties;
          if (activeId && sessionID !== activeId) break;
          const partID = trackReasoningMessage(sessionID, assistantMessageID, reasoningID);

          const existingBuffered = reasoningBuffers.current.get(partID);
          if (existingBuffered == null) {
            reasoningBuffers.current.set(partID, "");
          }

          setMessages((prev) => {
            const msg = prev.find((m) => m.info.id === assistantMessageID);
            const existingPart = msg?.parts.find((p) => p.id === partID && p.type === "reasoning");
            const existingText = existingPart && "text" in existingPart ? (existingPart as { text: string }).text : "";
            const text = getLongestText(existingBuffered, existingText, "");
            if (text) {
              reasoningBuffers.current.set(partID, text);
            }
            traceTextChange({
              source: "reasoning.started",
              eventType: event.type,
              sessionID,
              messageID: assistantMessageID,
              reasoningID,
              partID,
              nextText: text,
            });
            const reasoningPart: ReasoningPart = {
              id: partID,
              sessionID,
              messageID: assistantMessageID,
              type: "reasoning",
              text,
              time: { start: Date.now() },
            };
            return upsertPart(prev, reasoningPart);
          });
          break;
        }
        case "session.next.reasoning.delta": {
          const { sessionID, assistantMessageID, reasoningID, delta } = event.properties;
          if (activeId && sessionID !== activeId) break;
          const partID = trackReasoningMessage(sessionID, assistantMessageID, reasoningID);
          const accumulated = (reasoningBuffers.current.get(partID) || "") + delta;
          reasoningBuffers.current.set(partID, accumulated);
          traceTextChange({
            source: "reasoning.delta-buffer",
            eventType: event.type,
            sessionID,
            messageID: assistantMessageID,
            reasoningID,
            partID,
            nextText: accumulated,
          });
          if (reasoningPending.current == null) {
            reasoningPending.current = window.requestAnimationFrame(flushReasoningBuffers);
          }
          break;
        }
        case "session.next.reasoning.ended": {
          const { sessionID, assistantMessageID, reasoningID, text } = event.properties;
          if (activeId && sessionID !== activeId) break;
          const partID = trackReasoningMessage(sessionID, assistantMessageID, reasoningID);

          const bufferedText = reasoningBuffers.current.get(partID);
          deltaBuffers.current.delete(partID);

          const key = getMessageKey(sessionID, assistantMessageID);
          activeReasoningMessageKeys.current.delete(key);
          reasoningSnapshotProtectUntil.current.set(key, Date.now() + REASONING_SNAPSHOT_GRACE_MS);

          if (reasoningPending.current != null) {
            cancelAnimationFrame(reasoningPending.current);
            reasoningPending.current = null;
          }

          setMessages((prev) => {
            const msg = prev.find((m) => m.info.id === assistantMessageID);
            const existingPart = msg?.parts.find((p) => p.id === partID && p.type === "reasoning");
            const existingText = existingPart && "text" in existingPart ? (existingPart as { text: string }).text : "";
            const finalText = getLongestText(text, bufferedText, existingText);

            traceTextChange({
              source: "reasoning.ended",
              eventType: event.type,
              sessionID,
              messageID: assistantMessageID,
              reasoningID,
              partID,
              nextText: finalText,
            });

            reasoningBuffers.current.set(partID, finalText);

            const endedPart: ReasoningPart = {
              id: partID,
              sessionID,
              messageID: assistantMessageID,
              type: "reasoning",
              text: finalText,
              time: { start: Date.now(), end: Date.now() },
            };

            return upsertPart(prev, endedPart);
          });
          break;
        }
        case "message.part.delta": {
          const { sessionID, messageID, partID, delta } = event.properties;
          if (activeId && sessionID !== activeId) break;
          const reasoningPartID = getReasoningPartID(partID);
          if (reasoningBuffers.current.has(reasoningPartID)) {
            warnCotGlitch({
              source: "message.part.delta-skip",
              eventType: event.type,
              sessionID,
              messageID,
              partID,
              previousLength: reasoningBuffers.current.get(reasoningPartID)?.length ?? 0,
              nextLength: delta.length,
              nextTextPreview: getTextPreview(delta),
              reason: "skipped competing delta for managed reasoning part",
            });
            break;
          }
          const accumulated = (deltaBuffers.current.get(partID) || "") + delta;
          deltaBuffers.current.set(partID, accumulated);
          if (pendingFlush.current == null) {
            pendingFlush.current = window.requestAnimationFrame(flushDeltaBuffers);
          }
          break;
        }
      }
    },
    [activeSessionRef, trackReasoningMessage, getReasoningPartID, traceTextChange],
  );

  useEffect(() => {
    return () => {
      if (pendingFlush.current != null) {
        cancelAnimationFrame(pendingFlush.current);
      }
      if (reasoningPending.current != null) {
        cancelAnimationFrame(reasoningPending.current);
      }
    };
  }, []);

  return {
    messages,
    setMessages: setMessagesFromSnapshot,
    prefillText,
    setPrefillText,
    consumePrefill,
    handleMessageEvent,
    markPendingShell,
    isShellMessage,
  } as const;
}
