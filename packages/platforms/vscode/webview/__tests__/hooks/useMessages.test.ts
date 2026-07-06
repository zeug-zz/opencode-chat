import type { AgentEvent, ChatSession } from "@opencode-chat/core";
import { act, renderHook } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { describe, expect, it } from "vitest";
import { type MessageWithParts, useMessages } from "../../hooks/useMessages";

/** activeSessionRef のヘルパー。指定セッションを current に持つ RefObject を返す */
function createSessionRef(session: ChatSession | null = null): RefObject<ChatSession | null> {
  const ref = createRef<ChatSession | null>() as { current: ChatSession | null };
  ref.current = session;
  return ref;
}

/** テスト用の最小限のセッションオブジェクトを生成する */
function fakeSession(id: string): ChatSession {
  return { id, title: "", time: { created: 0, updated: 0 } };
}

describe("useMessages", () => {
  // initial state
  context("初期状態の場合", () => {
    // messages is empty
    it("messages が空配列であること", () => {
      const { result } = renderHook(() => useMessages(createSessionRef()));
      expect(result.current.messages).toEqual([]);
    });

    // prefillText is empty
    it("prefillText が空文字であること", () => {
      const { result } = renderHook(() => useMessages(createSessionRef()));
      expect(result.current.prefillText).toBe("");
    });
  });

  // setMessages
  context("setMessages で直接設定した場合", () => {
    // sets messages
    it("messages が設定されること", () => {
      const { result } = renderHook(() => useMessages(createSessionRef()));
      const msg = { info: { id: "m1" }, parts: [] } as unknown as MessageWithParts;
      act(() => result.current.setMessages([msg]));
      expect(result.current.messages).toHaveLength(1);
    });
  });

  // prefill management
  context("setPrefillText で値を設定した場合", () => {
    // consumePrefill clears the text
    it("consumePrefill で空文字にリセットされること", () => {
      const { result } = renderHook(() => useMessages(createSessionRef()));
      act(() => result.current.setPrefillText("hello"));
      act(() => result.current.consumePrefill());
      expect(result.current.prefillText).toBe("");
    });
  });

  // handleMessageEvent for message.updated
  context("message.updated イベントを受信した場合", () => {
    // adds new message when not existing
    it("新しいメッセージを追加すること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const event = {
        type: "message.updated",
        properties: { info: { id: "m1", role: "user", sessionID: "s1" } },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.messages).toHaveLength(1);
    });

    // updates existing message info
    it("既存メッセージの info を更新すること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const msg: MessageWithParts = { info: { id: "m1", role: "user", sessionID: "s1" } as any, parts: [] };
      act(() => result.current.setMessages([msg]));
      const event = {
        type: "message.updated",
        properties: { info: { id: "m1", role: "user", sessionID: "s1", metadata: { summary: "updated" } } },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect((result.current.messages[0].info as any).metadata.summary).toBe("updated");
    });
  });

  // handleMessageEvent for message.part.updated
  context("message.part.updated イベントを受信した場合", () => {
    // adds new part to existing message
    it("既存メッセージに新しいパートを追加すること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const msg: MessageWithParts = { info: { id: "m1" } as any, parts: [] };
      act(() => result.current.setMessages([msg]));
      const event = {
        type: "message.part.updated",
        properties: {
          sessionID: "s1",
          part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "hello" },
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.messages[0].parts).toHaveLength(1);
    });

    // preserves existing text when server sends update (priority: existing > server)
    it("既存パートのテキストを保持すること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const msg: MessageWithParts = {
        info: { id: "m1" } as any,
        parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "old" } as any],
      };
      act(() => result.current.setMessages([msg]));
      const event = {
        type: "message.part.updated",
        properties: {
          sessionID: "s1",
          part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "new" },
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      // Existing text "old" is preserved (priority 2: existing text > server text)
      expect((result.current.messages[0].parts[0] as any).text).toBe("old");
    });

    // preserves accumulated text when stale snapshot arrives with shorter text
    it("delta累積後に message.part.updated が来てもテキストが保持されること", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      // Set up message with empty parts
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // Simulate delta streaming: reasoning.started creates the part
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "rp1" },
        } as unknown as AgentEvent),
      );
      // Accumulate text via reasoning.delta (populates reasoningBuffers)
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: {
            sessionID: "s1",
            assistantMessageID: "m1",
            reasoningID: "rp1",
            delta: "accumulated reasoning text",
          },
        } as unknown as AgentEvent),
      );
      // flush the pending rAF so reasoningBuffer is applied before message.part.updated
      act(() => {
        vi.advanceTimersByTime(16);
      });
      // message.part.updated arrives with a stale shorter snapshot
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: {
              id: "rp1",
              type: "reasoning",
              text: "short",
              sessionID: "s1",
              messageID: "m1",
              time: { start: Date.now() },
            },
          },
        } as unknown as AgentEvent),
      );
      // The reasoningMessageKeys guard skips stale message.part.updated;
      // accumulated reasoning text is preserved.
      expect((result.current.messages[0].parts[0] as any).text).toBe("accumulated reasoning text");
      vi.useRealTimers();
    });

    // preserves accumulated text when message.part.updated arrives at completion
    it("完了時も既存テキストが保持されること（バッファが不足している場合）", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const reasoningPart = {
        id: "rp1",
        type: "reasoning",
        text: "partial",
        sessionID: "s1",
        messageID: "m1",
        time: { start: Date.now() },
      };
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [reasoningPart as any] }]));
      // message.part.updated arrives with the full (longer) text at completion
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: {
              id: "rp1",
              type: "reasoning",
              text: "partial complete full text",
              sessionID: "s1",
              messageID: "m1",
              time: { start: Date.now(), end: Date.now() },
            },
          },
        } as unknown as AgentEvent),
      );
      // Existing text "partial" is preserved (priority 2: existing text > server text)
      expect((result.current.messages[0].parts[0] as any).text).toBe("partial");
    });

    // preserves existing text when server sends empty text mid-stream (no buffer)
    it("サーバーが空テキストを送信した場合、既存テキストが保持されること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const existingPart = {
        id: "p1",
        type: "text",
        text: "existing reasoning text that must survive",
        sessionID: "s1",
        messageID: "m1",
      };
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [existingPart as any] }]));
      // Server sends an update with empty text (no delta buffer exists)
      const event = {
        type: "message.part.updated",
        properties: {
          sessionID: "s1",
          part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "" },
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      // Existing text should be preserved (priority 2: existing text > server text)
      expect((result.current.messages[0].parts[0] as any).text).toBe("existing reasoning text that must survive");
    });

    // uses buffer text over everything else
    it("deltaバッファが存在する場合、バッファテキストが常に優先されること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // Simulate delta streaming to populate the buffer
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "p1", field: "text", delta: "buffered text" },
        } as unknown as AgentEvent),
      );
      // Server sends a stale update with different text
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "stale snapshot" },
          },
        } as unknown as AgentEvent),
      );
      // Buffer text should win (priority 1: buffer > everything)
      expect((result.current.messages[0].parts[0] as any).text).toBe("buffered text");
    });

    // uses server text when neither buffer nor existing text exists
    it("バッファも既存テキストもない場合、サーバーテキストが使われること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      const event = {
        type: "message.part.updated",
        properties: {
          sessionID: "s1",
          part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "server text" },
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      // Server text is the only option (priority 3: fallback)
      expect((result.current.messages[0].parts[0] as any).text).toBe("server text");
    });
  });

  // handleMessageEvent for message.removed
  context("message.removed イベントを受信した場合", () => {
    // removes the message
    it("該当メッセージを削除すること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const msgs: MessageWithParts[] = [
        { info: { id: "m1" } as any, parts: [] },
        { info: { id: "m2" } as any, parts: [] },
      ];
      act(() => result.current.setMessages(msgs));
      const event = {
        type: "message.removed",
        properties: { sessionID: "s1", messageID: "m1" },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.messages).toHaveLength(1);
    });
  });

  // markPendingShell and isShellMessage
  context("markPendingShell を呼び出した場合", () => {
    // tags next assistant message as shell
    it("次の assistant メッセージがシェルメッセージとしてタグ付けされること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.markPendingShell());
      const event = {
        type: "message.updated",
        properties: { info: { id: "shell-a1", role: "assistant", sessionID: "s1" } },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.isShellMessage("shell-a1")).toBe(true);
    });

    // tags user message as shell
    it("user メッセージもシェルメッセージとしてタグ付けされること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.markPendingShell());
      const event = {
        type: "message.updated",
        properties: { info: { id: "shell-u1", role: "user", sessionID: "s1" } },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.isShellMessage("shell-u1")).toBe(true);
    });

    // clears pending flag after assistant message
    it("assistant メッセージ後にフラグがクリアされること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.markPendingShell());
      // user message arrives first
      act(() =>
        result.current.handleMessageEvent({
          type: "message.updated",
          properties: { info: { id: "u1", role: "user", sessionID: "s1" } },
        } as unknown as AgentEvent),
      );
      // assistant message arrives and clears the flag
      act(() =>
        result.current.handleMessageEvent({
          type: "message.updated",
          properties: { info: { id: "a1", role: "assistant", sessionID: "s1" } },
        } as unknown as AgentEvent),
      );
      // next message should NOT be tagged
      act(() =>
        result.current.handleMessageEvent({
          type: "message.updated",
          properties: { info: { id: "a2", role: "assistant", sessionID: "s1" } },
        } as unknown as AgentEvent),
      );
      expect(result.current.isShellMessage("a2")).toBe(false);
    });

    // does not clear pending flag on user message alone
    it("user メッセージだけではフラグがクリアされないこと", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.markPendingShell());
      act(() =>
        result.current.handleMessageEvent({
          type: "message.updated",
          properties: { info: { id: "u1", role: "user", sessionID: "s1" } },
        } as unknown as AgentEvent),
      );
      // next assistant should still be tagged
      act(() =>
        result.current.handleMessageEvent({
          type: "message.updated",
          properties: { info: { id: "a1", role: "assistant", sessionID: "s1" } },
        } as unknown as AgentEvent),
      );
      expect(result.current.isShellMessage("a1")).toBe(true);
    });
  });

  // isShellMessage returns false for normal messages
  context("markPendingShell を呼び出していない場合", () => {
    // returns false for normal messages
    it("通常メッセージの isShellMessage が false を返すこと", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const event = {
        type: "message.updated",
        properties: { info: { id: "m1", role: "assistant", sessionID: "s1" } },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.isShellMessage("m1")).toBe(false);
    });
  });

  // Session ID filtering — サブエージェント（子セッション）のイベントが親に混入しない
  context("子セッションのイベントを受信した場合", () => {
    it("message.updated: 別セッションのメッセージが追加されないこと", () => {
      const ref = createSessionRef(fakeSession("parent-session"));
      const { result } = renderHook(() => useMessages(ref));
      const event = {
        type: "message.updated",
        properties: { info: { id: "m-child", role: "assistant", sessionID: "child-session" } },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.messages).toHaveLength(0);
    });

    it("message.part.updated: 別セッションのパートが追加されないこと", () => {
      const ref = createSessionRef(fakeSession("parent-session"));
      const { result } = renderHook(() => useMessages(ref));
      // まず親セッションのメッセージを追加する
      const msg: MessageWithParts = { info: { id: "m1" } as any, parts: [] };
      act(() => result.current.setMessages([msg]));
      // 子セッションのパートイベントが来ても追加されない
      const event = {
        type: "message.part.updated",
        properties: {
          sessionID: "child-session",
          part: { id: "p1", sessionID: "child-session", messageID: "m1", type: "text", text: "leak" },
        },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.messages[0].parts).toHaveLength(0);
    });

    it("message.removed: 別セッションの削除イベントが無視されること", () => {
      const ref = createSessionRef(fakeSession("parent-session"));
      const { result } = renderHook(() => useMessages(ref));
      const msgs: MessageWithParts[] = [{ info: { id: "m1" } as any, parts: [] }];
      act(() => result.current.setMessages(msgs));
      const event = {
        type: "message.removed",
        properties: { sessionID: "child-session", messageID: "m1" },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.messages).toHaveLength(1);
    });
  });

  // activeSession が null の場合はフィルタリングをスキップする（全イベントを受け入れる）
  context("activeSession が null の場合", () => {
    it("message.updated: セッション未設定でもメッセージが追加されること", () => {
      const ref = createSessionRef(null);
      const { result } = renderHook(() => useMessages(ref));
      const event = {
        type: "message.updated",
        properties: { info: { id: "m1", role: "user", sessionID: "any-session" } },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      expect(result.current.messages).toHaveLength(1);
    });
  });

  // リーズニングストリーミング (session.next.reasoning.*)
  context("reasoning.started イベントを受信した場合", () => {
    it("空の ReasoningPart がメッセージに追加されること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      // add the parent message first
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      const event = {
        type: "session.next.reasoning.started",
        properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
      } as unknown as AgentEvent;
      act(() => result.current.handleMessageEvent(event));
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: "r1", type: "reasoning", text: "" });
      expect((parts[0] as any).time?.end).toBeUndefined();
    });
  });

  context("reasoning.delta イベントを受信した場合", () => {
    it("テキストが累積されること", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // started
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      // first delta
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      // second delta
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: " World" },
        } as unknown as AgentEvent),
      );
      // flush the pending rAF to apply buffered deltas
      act(() => {
        vi.advanceTimersByTime(16);
      });
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect((parts[0] as any).text).toBe("Hello World");
      expect((parts[0] as any).time?.end).toBeUndefined();
      vi.useRealTimers();
    });
  });

  context("reasoning.ended イベントを受信した場合", () => {
    it("time.end が設定されること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // started + some deltas
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Final" },
        } as unknown as AgentEvent),
      );
      // ended
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", text: "Final text" },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect((parts[0] as any).text).toBe("Final text");
      expect((parts[0] as any).time?.end).toBeDefined();
    });
  });

  context("子セッションの reasoning イベントを受信した場合", () => {
    it("reasoning.delta: 別セッションのイベントが無視されること", () => {
      const ref = createSessionRef(fakeSession("parent"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "child", assistantMessageID: "m1", reasoningID: "r1", delta: "leak" },
        } as unknown as AgentEvent),
      );
      expect(result.current.messages[0].parts).toHaveLength(0);
    });
  });

  context("親メッセージが存在しない場合", () => {
    it("reasoning.delta: upsertPart がメッセージ不在で何も追加しないこと", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      // no message with id "m-missing" exists
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m-missing", reasoningID: "r1", delta: "ghost" },
        } as unknown as AgentEvent),
      );
      expect(result.current.messages).toHaveLength(0);
    });
  });

  // message.part.delta — ストリーミング差分
  context("message.part.delta イベントを受信した場合", () => {
    it("既存の ReasoningPart にテキストが累積されること", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      // set up message with an existing reasoning part
      const reasoningPart = {
        id: "rp1",
        type: "reasoning",
        text: "",
        sessionID: "s1",
        messageID: "m1",
        time: { start: Date.now() },
      };
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [reasoningPart as any] }]));
      // first delta
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "rp1", field: "text", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      // second delta
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "rp1", field: "text", delta: " World" },
        } as unknown as AgentEvent),
      );
      // flush the pending setTimeout (100ms throttle) to apply buffered deltas
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Hello World");
      vi.useRealTimers();
    });

    it("既存の TextPart にテキストが累積されること", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      const textPart = {
        id: "tp1",
        type: "text",
        text: "",
        sessionID: "s1",
        messageID: "m1",
        time: { created: Date.now() },
      };
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [textPart as any] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "tp1", field: "text", delta: "Streaming" },
        } as unknown as AgentEvent),
      );
      // flush the pending setTimeout (100ms throttle) to apply buffered deltas
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Streaming");
      vi.useRealTimers();
    });

    it("別セッションの delta が無視されること", () => {
      const ref = createSessionRef(fakeSession("parent"));
      const { result } = renderHook(() => useMessages(ref));
      const textPart = {
        id: "tp1",
        type: "text",
        text: "",
        sessionID: "parent",
        messageID: "m1",
        time: { created: Date.now() },
      };
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [textPart as any] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "child", messageID: "m1", partID: "tp1", field: "text", delta: "leak" },
        } as unknown as AgentEvent),
      );
      expect((result.current.messages[0].parts[0] as any).text).toBe("");
    });

    it("メッセージが存在しない場合は無視されること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "missing", partID: "tp1", field: "text", delta: "ghost" },
        } as unknown as AgentEvent),
      );
      expect(result.current.messages).toHaveLength(0);
    });

    it("パートが存在しない場合は buffer に蓄積されて flush で反映されること", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "missing", field: "text", delta: "ghost" },
        } as unknown as AgentEvent),
      );
      // Part is NOT auto-created on delta anymore — it's tracked in createdParts
      // and flushed via setTimeout(0).
      expect(result.current.messages[0].parts).toHaveLength(0);
    });
  });

  // 10.5 Regression: managed reasoning skips server snapshot, avoids duplicate
  context("managed reasoning message with message.part.updated snapshot", () => {
    it("skips server snapshot and avoids duplicate part when reasoning events own the stream", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // reasoning.started creates the part with reasoningID "r1"
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      // reasoning.delta accumulates text
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      // flush rAF to apply the delta
      act(() => {
        vi.advanceTimersByTime(16);
      });
      // message.part.updated arrives with a DIFFERENT server-assigned part.id
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: { id: "server-r1", type: "reasoning", text: "", sessionID: "s1", messageID: "m1" },
          },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: "r1", text: "Hello" });
      // No duplicate part with server ID
      expect(parts.find((p: any) => p.id === "server-r1")).toBeUndefined();
      vi.useRealTimers();
    });

    it("fallback reasoning snapshot still works without reasoning events", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // No reasoning.* events — just message.part.updated
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: { id: "server-r1", type: "reasoning", text: "final reasoning", sessionID: "s1", messageID: "m1" },
          },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: "server-r1", text: "final reasoning" });
    });
  });
  // 10.6 Regression: make managed reasoning text monotonic/sticky
  context("managed reasoning text monotonicity", () => {
    it("duplicate reasoning.started does not blank streamed text", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect((parts[0] as any).text).toBe("Hello");
      vi.useRealTimers();
    });

    it("empty reasoning.ended preserves streamed text", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", text: "" },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect((parts[0] as any).text).toBe("Hello world");
      expect((parts[0] as any).time?.end).toBeDefined();
      vi.useRealTimers();
    });

    it("short reasoning.ended preserves longer streamed text", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", text: "Hello" },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect((parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });

    it("late delta after reasoning.ended appends instead of restarting from empty", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", text: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: " world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      const parts = result.current.messages[0].parts;
      expect((parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });

    it("message.part.delta cannot overwrite managed reasoning text when IDs match", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "r1", field: "text", delta: "Hi" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      const parts = result.current.messages[0].parts;
      expect((parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });
  });

  // 10.7 Regression: canonical reasoning part per assistant message
  context("canonical reasoning display per message", () => {
    it("second reasoningID for same message does not create second part or blank", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // first reasoning stream
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      // second reasoning stream for the same message, different reasoningID
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r2" },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: "r1", type: "reasoning" });
      expect((parts[0] as any).text).toBe("Hello");
      vi.useRealTimers();
    });

    it("delta for second reasoningID appends to canonical part", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // first reasoning stream r1
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      // start second reasoning stream r2
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r2" },
        } as unknown as AgentEvent),
      );
      // delta for r2
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r2", delta: " world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: "r1" });
      expect((parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });

    it("ended for second reasoningID updates canonical part, no duplicate", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // first reasoning stream r1
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      // second reasoning stream r2
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r2" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r2", delta: " world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      // ended for r2
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r2", text: "Hello world" },
        } as unknown as AgentEvent),
      );
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: "r1" });
      expect((parts[0] as any).text).toBe("Hello world");
      expect((parts[0] as any).time?.end).toBeDefined();
      vi.useRealTimers();
    });

    it("message.part.delta using transient reasoningID cannot compete", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1" } as any, parts: [] }]));
      // first reasoning stream r1
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      // second reasoning stream r2 started (no delta)
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r2" },
        } as unknown as AgentEvent),
      );
      // message.part.delta using transient ID r2
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "r2", field: "text", delta: "BAD" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect((parts[0] as any).text).toBe("Hello");
      vi.useRealTimers();
    });
  });

  // 10.8 Regression: full messages snapshot preserves managed reasoning
  context("full messages snapshot replacement preserves managed reasoning", () => {
    it("snapshot with empty reasoning does not blank managed reasoning", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1", sessionID: "s1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.setMessages([
          {
            info: { id: "m1", sessionID: "s1" } as any,
            parts: [
              {
                id: "server-r1",
                type: "reasoning",
                text: "",
                sessionID: "s1",
                messageID: "m1",
                time: { start: Date.now() },
              },
            ],
          },
        ]),
      );
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: "r1", type: "reasoning" });
      expect((parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });

    it("snapshot with no reasoning part preserves managed reasoning", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1", sessionID: "s1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() => result.current.setMessages([{ info: { id: "m1", sessionID: "s1" } as any, parts: [] }]));
      const parts = result.current.messages[0].parts;
      expect(parts).toHaveLength(1);
      expect((parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });

    it("snapshot with longer reasoning text can advance managed reasoning", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1", sessionID: "s1" } as any, parts: [] }]));
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.setMessages([
          {
            info: { id: "m1", sessionID: "s1" } as any,
            parts: [
              {
                id: "r1",
                type: "reasoning",
                text: "Hello world from snapshot",
                sessionID: "s1",
                messageID: "m1",
                time: { start: Date.now() },
              },
            ],
          },
        ]),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Hello world from snapshot");
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "!" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Hello world from snapshot!");
      vi.useRealTimers();
    });

    it("unmanaged snapshot fallback still replaces normally", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() => result.current.setMessages([{ info: { id: "m1", sessionID: "s1" } as any, parts: [] }]));
      act(() =>
        result.current.setMessages([
          {
            info: { id: "m1", sessionID: "s1" } as any,
            parts: [
              {
                id: "server-r1",
                type: "reasoning",
                text: "snapshot reasoning",
                sessionID: "s1",
                messageID: "m1",
                time: { start: Date.now() },
              },
            ],
          },
        ]),
      );
      expect((result.current.messages[0].parts[0] as any).text).toBe("snapshot reasoning");
      act(() =>
        result.current.setMessages([
          {
            info: { id: "m1", sessionID: "s1" } as any,
            parts: [
              {
                id: "server-r1",
                type: "reasoning",
                text: "",
                sessionID: "s1",
                messageID: "m1",
                time: { start: Date.now() },
              },
            ],
          },
        ]),
      );
      expect((result.current.messages[0].parts[0] as any).text).toBe("");
    });
  });

  // 10.9 Regression: stale snapshot omitting active assistant message
  context("stale snapshot omitting active reasoning message", () => {
    it("preserves active reasoning message when snapshot omits it", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() =>
        result.current.setMessages([
          { info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] },
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [] },
        ]),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() => result.current.setMessages([{ info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] }]));
      expect(result.current.messages).toHaveLength(2);
      const m1 = result.current.messages.find((m: any) => m.info.id === "m1");
      expect(m1).toBeDefined();
      expect(m1!.parts).toHaveLength(1);
      expect((m1!.parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });

    it("omitted unmanaged message is not retained", () => {
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() =>
        result.current.setMessages([
          { info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] },
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [] },
        ]),
      );
      act(() => result.current.setMessages([{ info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] }]));
      const m1 = result.current.messages.find((m: any) => m.info.id === "m1");
      expect(m1).toBeUndefined();
    });

    it("post-ended grace retains omitted reasoning message", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() =>
        result.current.setMessages([
          { info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] },
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [] },
        ]),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", text: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => result.current.setMessages([{ info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] }]));
      expect(result.current.messages).toHaveLength(2);
      const m1 = result.current.messages.find((m: any) => m.info.id === "m1");
      expect(m1).toBeDefined();
      expect((m1!.parts[0] as any).text).toBe("Hello");
      vi.useRealTimers();
    });

    it("after grace expires omitted completed reasoning message is not retained", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() =>
        result.current.setMessages([
          { info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] },
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [] },
        ]),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", text: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(5001);
      });
      act(() => result.current.setMessages([{ info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] }]));
      const m1 = result.current.messages.find((m: any) => m.info.id === "m1");
      expect(m1).toBeUndefined();
      vi.useRealTimers();
    });

    it("message.removed disables retention", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));
      act(() =>
        result.current.setMessages([
          { info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] },
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [] },
        ]),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      act(() =>
        result.current.handleMessageEvent({
          type: "message.removed",
          properties: { sessionID: "s1", messageID: "m1" },
        } as unknown as AgentEvent),
      );
      act(() => result.current.setMessages([{ info: { id: "u1", sessionID: "s1", role: "user" } as any, parts: [] }]));
      const m1 = result.current.messages.find((m: any) => m.info.id === "m1");
      expect(m1).toBeUndefined();
      vi.useRealTimers();
    });
  });

  // 10.12 Regression: delta-streamed parts survive full snapshot replacement
  context("delta-streamed parts survive full snapshot replacement", () => {
    it("active delta-streamed reasoning part is not blanked by snapshot with empty text", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));

      const reasoningPart = {
        id: "prt_abc",
        type: "reasoning",
        text: "",
        sessionID: "s1",
        messageID: "m1",
        time: { start: Date.now() },
      };
      act(() =>
        result.current.setMessages([
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [reasoningPart as any] },
        ]),
      );

      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "prt_abc", field: "text", delta: "Hello world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Hello world");

      act(() =>
        result.current.setMessages([
          {
            info: { id: "m1", sessionID: "s1", role: "assistant" } as any,
            parts: [
              {
                id: "prt_abc",
                type: "reasoning",
                text: "",
                sessionID: "s1",
                messageID: "m1",
                time: { start: Date.now() },
              },
            ],
          },
        ]),
      );
      expect((result.current.messages[0].parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });

    it("active delta-streamed text part is not blanked by snapshot with empty text", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));

      const textPart = {
        id: "prt_def",
        type: "text",
        text: "",
        sessionID: "s1",
        messageID: "m1",
        time: { created: Date.now() },
      };
      act(() =>
        result.current.setMessages([
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [textPart as any] },
        ]),
      );

      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "prt_def", field: "text", delta: "Streaming text" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Streaming text");

      act(() =>
        result.current.setMessages([
          {
            info: { id: "m1", sessionID: "s1", role: "assistant" } as any,
            parts: [
              {
                id: "prt_def",
                type: "text",
                text: "",
                sessionID: "s1",
                messageID: "m1",
                time: { created: Date.now() },
              },
            ],
          },
        ]),
      );
      expect((result.current.messages[0].parts[0] as any).text).toBe("Streaming text");
      vi.useRealTimers();
    });

    it("snapshot omitting active delta-streamed part preserves the part", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));

      const reasoningPart = {
        id: "prt_xyz",
        type: "reasoning",
        text: "",
        sessionID: "s1",
        messageID: "m1",
        time: { start: Date.now() },
      };
      act(() =>
        result.current.setMessages([
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [reasoningPart as any] },
        ]),
      );

      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "prt_xyz", field: "text", delta: "Streaming" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Streaming");

      act(() =>
        result.current.setMessages([{ info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [] }]),
      );
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].parts).toHaveLength(1);
      expect((result.current.messages[0].parts[0] as any).text).toBe("Streaming");
      expect((result.current.messages[0].parts[0] as any).id).toBe("prt_xyz");
      vi.useRealTimers();
    });

    it("flushDeltaBuffers does not shrink text after snapshot blank", () => {
      vi.useFakeTimers();
      const ref = createSessionRef(fakeSession("s1"));
      const { result } = renderHook(() => useMessages(ref));

      const textPart = {
        id: "prt_g",
        type: "text",
        text: "",
        sessionID: "s1",
        messageID: "m1",
        time: { created: Date.now() },
      };
      act(() =>
        result.current.setMessages([
          { info: { id: "m1", sessionID: "s1", role: "assistant" } as any, parts: [textPart as any] },
        ]),
      );

      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "prt_g", field: "text", delta: "Hello" },
        } as unknown as AgentEvent),
      );
      act(() =>
        result.current.handleMessageEvent({
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "prt_g", field: "text", delta: " world" },
        } as unknown as AgentEvent),
      );
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect((result.current.messages[0].parts[0] as any).text).toBe("Hello world");

      // Simulate a snapshot that blanks the part text, then flush runs
      // with the full buffered text. getLongestText ensures buffered text wins.
      act(() =>
        result.current.setMessages([
          {
            info: { id: "m1", sessionID: "s1", role: "assistant" } as any,
            parts: [
              {
                id: "prt_g",
                type: "text",
                text: "",
                sessionID: "s1",
                messageID: "m1",
                time: { created: Date.now() },
              },
            ],
          },
        ]),
      );
      // The snapshot blanked text, but the merge preserved buffered text
      expect((result.current.messages[0].parts[0] as any).text).toBe("Hello world");
      vi.useRealTimers();
    });
  });
});
