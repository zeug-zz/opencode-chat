import type { AgentEvent, ChatMessage, ChatSession, MessagePart, ReasoningPart, TextPart } from "@opencode-chat/core";
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

function getReasoningPartKey(sessionID: string, messageID: string, partID: string) {
  return JSON.stringify([sessionID, messageID, partID]);
}

function getLongestText(...values: Array<string | null | undefined>): string {
  return values.reduce<string>((best, value) => {
    return typeof value === "string" && value.length > best.length ? value : best;
  }, "");
}

function isTextualPart(part: MessagePart): part is TextPart | ReasoningPart {
  return part.type === "text" || part.type === "reasoning";
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
  incomingMessagePresent?: boolean;
  retained?: boolean;
  reason?: string;
  parts?: Array<{ id: string; type: string; textLength: number | null }>;
};

const COT_TRACE_PREFIX = "[opencode-chat cot-glitch]";

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
  return message.info.sessionID ?? message.parts[0]?.sessionID;
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
  const activeReasoningIdsByMessageKey = useRef<Map<string, Set<string>>>(new Map());
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
          if (buffered != null && isTextualPart(part) && typeof part.text === "string") {
            const currentText = part.text;
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
          const bufferKey = getReasoningPartKey(part.sessionID, part.messageID, part.id);
          const buffered = reasoningBuffers.current.get(bufferKey);
          if (buffered != null && part.type === "reasoning" && part.text !== buffered) {
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

    const ids = reasoningIdsByMessageKey.current.get(key) ?? new Set<string>();
    ids.add(reasoningID);
    reasoningIdsByMessageKey.current.set(key, ids);

    return { key, bufferKey: getReasoningPartKey(sessionID, messageID, reasoningID) };
  }, []);

  const markReasoningActive = useCallback((key: string, reasoningID: string) => {
    const activeIds = activeReasoningIdsByMessageKey.current.get(key) ?? new Set<string>();
    activeIds.add(reasoningID);
    activeReasoningIdsByMessageKey.current.set(key, activeIds);
    // Keep grace for already-ended sibling segments while another segment streams.
  }, []);

  const markReasoningEnded = useCallback((key: string, reasoningID: string) => {
    const activeIds = activeReasoningIdsByMessageKey.current.get(key);
    activeIds?.delete(reasoningID);
    // A segment can finish while siblings remain active; protect its final snapshot independently.
    reasoningSnapshotProtectUntil.current.set(key, Date.now() + REASONING_SNAPSHOT_GRACE_MS);
    if (activeIds && activeIds.size > 0) return;

    activeReasoningIdsByMessageKey.current.delete(key);
  }, []);

  const shouldRetainMissingReasoningMessage = useCallback((message: MessageWithParts) => {
    const sessionID = getMessageSessionID(message);
    if (!sessionID) return false;

    const key = getMessageKey(sessionID, message.info.id);
    if ((activeReasoningIdsByMessageKey.current.get(key)?.size ?? 0) > 0) return true;

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
          const previousMessage = prev.find(
            (message) => message.info.id === incomingMessage.info.id && getMessageSessionID(message) === sessionID,
          );

          const activeDelta = incomingMessage.parts.some((part) => deltaBuffers.current.has(part.id));
          const orphanedDelta =
            previousMessage?.parts.filter(
              (part) => deltaBuffers.current.has(part.id) && !incomingMessage.parts.some((p) => p.id === part.id),
            ) ?? [];

          if (!activeDelta && orphanedDelta.length === 0) return incomingMessage;

          const protectedParts = incomingMessage.parts.map((part) => {
            const buffered = deltaBuffers.current.get(part.id);
            if (buffered == null) return part;
            if (!isTextualPart(part) || typeof part.text !== "string") return part;

            const incomingText = part.text;
            const previousPart = previousMessage?.parts.find((p) => p.id === part.id);
            const previousText =
              previousPart && isTextualPart(previousPart) && typeof previousPart.text === "string"
                ? previousPart.text
                : "";
            const text = getLongestText(buffered, previousText, incomingText);

            return { ...part, text };
          });

          const preservedOrphans: MessagePart[] = orphanedDelta.flatMap((part) => {
            const buffered = deltaBuffers.current.get(part.id)!;
            if (!isTextualPart(part) || typeof part.text !== "string") return [];
            const currentText = part.text;
            const text = getLongestText(buffered, currentText);
            return [{ ...part, text }];
          });

          return {
            ...incomingMessage,
            parts: [...protectedParts, ...preservedOrphans],
          };
        }

        const trackedReasoningIDs = reasoningIdsByMessageKey.current.get(key);
        if (!trackedReasoningIDs) return incomingMessage;

        const previousMessage = prev.find(
          (message) => message.info.id === incomingMessage.info.id && getMessageSessionID(message) === sessionID,
        );
        const activeReasoningIDs = activeReasoningIdsByMessageKey.current.get(key);
        const hasActiveReasoning = (activeReasoningIDs?.size ?? 0) > 0;
        const protectUntil = reasoningSnapshotProtectUntil.current.get(key);
        const hasSnapshotGrace = protectUntil != null && protectUntil > Date.now();
        const presentReasoningIDs = new Set<string>();
        const parts = incomingMessage.parts.map((part) => {
          if (part.type !== "reasoning" || !trackedReasoningIDs.has(part.id)) return part;

          presentReasoningIDs.add(part.id);
          const bufferKey = getReasoningPartKey(sessionID, incomingMessage.info.id, part.id);
          const previousPart = previousMessage?.parts.find(
            (candidate): candidate is ReasoningPart => candidate.type === "reasoning" && candidate.id === part.id,
          );
          const bufferedText = reasoningBuffers.current.get(bufferKey);
          const isActive = activeReasoningIDs?.has(part.id) ?? false;
          const text =
            isActive && bufferedText != null
              ? getLongestText(bufferedText, previousPart?.text, part.text)
              : (hasSnapshotGrace || hasActiveReasoning) && bufferedText != null
                ? bufferedText
                : part.text;

          reasoningBuffers.current.set(bufferKey, text);
          traceTextChange({
            source: "mergeSnapshotPreservingReasoning",
            sessionID,
            messageID: incomingMessage.info.id,
            partID: part.id,
            nextText: text,
          });

          return text === part.text ? part : { ...part, text };
        });

        if (previousMessage) {
          for (const [previousIndex, previousPart] of previousMessage.parts.entries()) {
            if (previousPart.type !== "reasoning" || !trackedReasoningIDs.has(previousPart.id)) continue;
            if (presentReasoningIDs.has(previousPart.id)) continue;
            if (!activeReasoningIDs?.has(previousPart.id) && !hasActiveReasoning && !hasSnapshotGrace) continue;

            const bufferKey = getReasoningPartKey(sessionID, incomingMessage.info.id, previousPart.id);
            const bufferedText = reasoningBuffers.current.get(bufferKey);
            const text =
              activeReasoningIDs?.has(previousPart.id) && bufferedText != null
                ? getLongestText(bufferedText, previousPart.text)
                : previousPart.text;
            reasoningBuffers.current.set(bufferKey, text);

            const preservedPart = text === previousPart.text ? previousPart : { ...previousPart, text };
            const nextSharedPart = previousMessage.parts
              .slice(previousIndex + 1)
              .find((candidate) => parts.some((incomingPart) => incomingPart.id === candidate.id));
            const nextSharedIndex = nextSharedPart
              ? parts.findIndex((incomingPart) => incomingPart.id === nextSharedPart.id)
              : -1;
            const insertIndex = nextSharedIndex >= 0 ? nextSharedIndex : Math.min(previousIndex, parts.length);

            parts.splice(insertIndex, 0, preservedPart);
            presentReasoningIDs.add(previousPart.id);
          }
        }

        return { ...incomingMessage, parts };
      });

      const incomingKeys = new Set(
        incoming.map((message) => {
          const sessionID = getMessageSessionID(message);
          return sessionID ? getMessageKey(sessionID, message.info.id) : message.info.id;
        }),
      );

      const retained = prev.filter((message) => {
        const sessionID = getMessageSessionID(message);
        const messageKey = sessionID ? getMessageKey(sessionID, message.info.id) : message.info.id;
        if (incomingKeys.has(messageKey)) return false;
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

  const clearSessionState = useCallback(() => {
    if (pendingFlush.current != null) {
      cancelAnimationFrame(pendingFlush.current);
      pendingFlush.current = null;
    }
    if (reasoningPending.current != null) {
      cancelAnimationFrame(reasoningPending.current);
      reasoningPending.current = null;
    }
    pendingShell.current = false;
    reasoningBuffers.current.clear();
    deltaBuffers.current.clear();
    reasoningMessageKeys.current.clear();
    reasoningIdsByMessageKey.current.clear();
    activeReasoningIdsByMessageKey.current.clear();
    reasoningSnapshotProtectUntil.current.clear();
    cotTextLengthByPartId.current.clear();
    missingSnapshotLoggedKeys.current.clear();
    setShellMessageIds(new Set());
    setPrefillText("");
    setMessages([]);
  }, []);

  // SSE event handler for message-related events
  // activeSessionRef を介して現在のアクティブセッション ID を参照し、
  // 別セッション（サブエージェントの子セッションなど）のイベントを無視する。
  const handleMessageEvent = useCallback(
    (event: AgentEvent) => {
      const activeId = activeSessionRef.current?.id;
      switch (event.type) {
        case "message.updated": {
          const info = event.properties.info;
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
          const messageKey = getMessageKey(part.sessionID, part.messageID);
          const trackedReasoningIDs = reasoningIdsByMessageKey.current.get(messageKey);
          if (part.type === "reasoning" && trackedReasoningIDs?.has(part.id)) {
            const bufferKey = getReasoningPartKey(part.sessionID, part.messageID, part.id);
            const bufferedText = reasoningBuffers.current.get(bufferKey);
            const isActive = activeReasoningIdsByMessageKey.current.get(messageKey)?.has(part.id) ?? false;
            if (isActive && bufferedText != null && part.text.length < bufferedText.length) {
              warnCotGlitch({
                source: "message.part.updated-skip",
                eventType: event.type,
                sessionID: part.sessionID,
                messageID: part.messageID,
                partID: part.id,
                previousLength: bufferedText.length,
                nextLength: part.text.length,
                reason: "skipped stale managed reasoning snapshot",
              });
              break;
            }

            const protectCompletedText =
              (reasoningSnapshotProtectUntil.current.get(messageKey) ?? 0) > Date.now() ||
              (activeReasoningIdsByMessageKey.current.get(messageKey)?.size ?? 0) > 0;
            const text =
              isActive && bufferedText != null
                ? getLongestText(bufferedText, part.text)
                : protectCompletedText && bufferedText != null
                  ? bufferedText
                  : part.text;
            reasoningBuffers.current.set(bufferKey, text);
            setMessages((prev) => upsertPart(prev, { ...part, text }));
            break;
          }
          const textualPart = isTextualPart(part) && typeof part.text === "string";
          const serverText = textualPart ? part.text : undefined;
          const bufferedText = deltaBuffers.current.get(part.id);
          // バッファが存在する & サーバーから空テキストが送られてきた場合、
          // ストリーミング中の部分を上書きしないために setMessages をスキップする。
          if (bufferedText != null && !serverText) break;
          setMessages((prev) => {
            const msgIdx = prev.findIndex((m) => m.info.id === part.messageID);
            const existingPart = msgIdx >= 0 ? prev[msgIdx].parts.find((p) => p.id === part.id) : null;
            const existingText = existingPart && isTextualPart(existingPart) ? existingPart.text : null;
            const finalText =
              bufferedText != null ? bufferedText : existingText != null ? existingText : (serverText ?? "");
            return upsertPart(prev, textualPart ? { ...part, text: finalText } : part);
          });
          if ("time" in part && part.time != null && typeof part.time === "object" && "end" in part.time) {
            deltaBuffers.current.delete(part.id);
          }
          break;
        }
        case "message.removed": {
          if (activeId && event.properties.sessionID !== activeId) break;
          const key = getMessageKey(event.properties.sessionID, event.properties.messageID);
          reasoningMessageKeys.current.delete(key);
          activeReasoningIdsByMessageKey.current.delete(key);
          reasoningSnapshotProtectUntil.current.delete(key);

          const reasoningIds = reasoningIdsByMessageKey.current.get(key);
          if (reasoningIds) {
            for (const reasoningID of reasoningIds) {
              reasoningBuffers.current.delete(
                getReasoningPartKey(event.properties.sessionID, event.properties.messageID, reasoningID),
              );
              deltaBuffers.current.delete(reasoningID);
            }
            reasoningIdsByMessageKey.current.delete(key);
          }

          setMessages((prev) => removeMessage(prev, event.properties.messageID));
          break;
        }
        case "session.next.reasoning.started": {
          const { sessionID, assistantMessageID, reasoningID } = event.properties;
          if (activeId && sessionID !== activeId) break;
          const { key, bufferKey } = trackReasoningMessage(sessionID, assistantMessageID, reasoningID);
          markReasoningActive(key, reasoningID);

          const existingBuffered = reasoningBuffers.current.get(bufferKey);
          if (existingBuffered == null) {
            reasoningBuffers.current.set(bufferKey, "");
          }

          setMessages((prev) => {
            const msg = prev.find(
              (message) => message.info.id === assistantMessageID && getMessageSessionID(message) === sessionID,
            );
            const existingPart = msg?.parts.find((part) => part.id === reasoningID && part.type === "reasoning");
            const existingText = existingPart?.type === "reasoning" ? existingPart.text : "";
            const text = getLongestText(existingBuffered, existingText, "");
            reasoningBuffers.current.set(bufferKey, text);
            traceTextChange({
              source: "reasoning.started",
              eventType: event.type,
              sessionID,
              messageID: assistantMessageID,
              reasoningID,
              partID: reasoningID,
              nextText: text,
            });
            const reasoningPart: ReasoningPart = {
              id: reasoningID,
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
          const { key, bufferKey } = trackReasoningMessage(sessionID, assistantMessageID, reasoningID);
          markReasoningActive(key, reasoningID);
          const accumulated = (reasoningBuffers.current.get(bufferKey) ?? "") + delta;
          reasoningBuffers.current.set(bufferKey, accumulated);
          traceTextChange({
            source: "reasoning.delta-buffer",
            eventType: event.type,
            sessionID,
            messageID: assistantMessageID,
            reasoningID,
            partID: reasoningID,
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
          const { key, bufferKey } = trackReasoningMessage(sessionID, assistantMessageID, reasoningID);

          markReasoningEnded(key, reasoningID);
          deltaBuffers.current.delete(reasoningID);

          setMessages((prev) => {
            const msg = prev.find(
              (message) => message.info.id === assistantMessageID && getMessageSessionID(message) === sessionID,
            );
            const existingPart = msg?.parts.find((part) => part.id === reasoningID && part.type === "reasoning");
            const finalText = text;

            traceTextChange({
              source: "reasoning.ended",
              eventType: event.type,
              sessionID,
              messageID: assistantMessageID,
              reasoningID,
              partID: reasoningID,
              nextText: finalText,
            });

            reasoningBuffers.current.set(bufferKey, finalText);

            const endedPart: ReasoningPart = {
              id: reasoningID,
              sessionID,
              messageID: assistantMessageID,
              type: "reasoning",
              text: finalText,
              time: {
                start: existingPart?.type === "reasoning" ? (existingPart.time?.start ?? Date.now()) : Date.now(),
                end: Date.now(),
              },
            };

            return upsertPart(prev, endedPart);
          });
          break;
        }
        case "message.part.delta": {
          const { sessionID, messageID, partID, delta } = event.properties;
          if (activeId && sessionID !== activeId) break;
          const messageKey = getMessageKey(sessionID, messageID);
          const reasoningBufferKey = getReasoningPartKey(sessionID, messageID, partID);
          if (reasoningIdsByMessageKey.current.get(messageKey)?.has(partID)) {
            warnCotGlitch({
              source: "message.part.delta-skip",
              eventType: event.type,
              sessionID,
              messageID,
              partID,
              previousLength: reasoningBuffers.current.get(reasoningBufferKey)?.length ?? 0,
              nextLength: delta.length,
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
    [activeSessionRef, markReasoningActive, markReasoningEnded, trackReasoningMessage, traceTextChange],
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
    clearSessionState,
  } as const;
}
