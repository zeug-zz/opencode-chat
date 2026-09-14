import type { AgentEvent } from "@opencode-chat/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage } from "../../vscode-api";
import { createAllProvidersData, createMessage, createProvider, createSession, createTextPart } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

describe("コンパクション中のコンテキストメモリガード", () => {
  beforeEach(async () => {
    renderApp();
    await sendExtMessage({
      type: "sessions",
      sessions: [createSession({ id: "s1", title: "Test" })],
    });
    await sendExtMessage({
      type: "providers",
      providers: [
        createProvider("anthropic", {
          "claude-4-opus": {
            id: "claude-4-opus",
            name: "Claude 4 Opus",
            limit: { context: 200000, output: 4096 },
          },
        }),
      ],
      allProviders: createAllProvidersData(
        ["anthropic"],
        [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-4-opus": {
                id: "claude-4-opus",
                name: "Claude 4 Opus",
                limit: { context: 200000, output: 4096 },
              },
            },
          },
        ],
      ),
      default: {},
      configModel: "anthropic/claude-4-opus",
    });
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
    vi.mocked(postMessage).mockClear();
  });

  async function sendEvent(event: AgentEvent) {
    await sendExtMessage({ type: "event", event });
  }

  async function getContextMemoryText(): Promise<string | null> {
    const el = screen.queryByTitle("Contextual memory");
    return el?.textContent ?? null;
  }

  it("コンパクション開始前に context.updated で設定した値が表示されること", async () => {
    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "22.1K (11%)" },
    });
    expect(await getContextMemoryText()).toBe("22.1K (11%)");
  });

  it("コンパクション開始時にチップがクリアされること", async () => {
    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "22.1K (11%)" },
    });
    expect(await getContextMemoryText()).toBe("22.1K (11%)");

    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });
    expect(await getContextMemoryText()).toBeNull();
  });

  it("コンパクション中の step.ended トークンでチップが更新されないこと", async () => {
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });

    await sendEvent({
      type: "session.next.step.ended",
      properties: {
        sessionID: "s1",
        tokens: {
          input: 280000,
          output: 5000,
          reasoning: 1000,
          cache: { read: 200000, write: 50000 },
        },
      },
    });
    expect(await getContextMemoryText()).toBeNull();
  });

  it("コンパクション中の message.updated トークンでチップが更新されないこと", async () => {
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });

    await sendEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "m1",
          role: "assistant",
          sessionID: "s1",
          time: { created: Date.now() },
          tokens: {
            input: 280000,
            output: 5000,
            reasoning: 1000,
            cache: { read: 200000, write: 50000 },
          },
        },
      },
    });
    expect(await getContextMemoryText()).toBeNull();
  });

  it("コンパクション中の session.updated トークンでチップが更新されないこと", async () => {
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });

    await sendEvent({
      type: "session.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "s1",
          title: "Test",
          time: { created: Date.now(), updated: Date.now() },
          tokens: {
            input: 280000,
            output: 5000,
            reasoning: 1000,
            cache: { read: 200000, write: 50000 },
          },
        },
      },
    });
    expect(await getContextMemoryText()).toBeNull();
  });

  it("コンパクション終了の summary text がチップに表示されないこと", async () => {
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });

    await sendEvent({
      type: "session.next.compaction.ended",
      properties: {
        sessionID: "s1",
        text: "This is a compaction summary, not a context meter.",
        recent: "recent context text",
      },
    });
    expect(await getContextMemoryText()).toBeNull();
  });

  it("コンパクション後に context.updated が届いたらチップが更新されること", async () => {
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });

    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "5.2K (3%)" },
    });
    expect(await getContextMemoryText()).toBe("5.2K (3%)");
  });

  it("コンパクション後に context.updated が届いたらチップが更新されること（再確認）", async () => {
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });

    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "5.2K (3%)" },
    });
    expect(await getContextMemoryText()).toBe("5.2K (3%)");

    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "8.0K (4%)" },
    });
    expect(await getContextMemoryText()).toBe("8.0K (4%)");
  });

  it("後の assistant スナップショットが前の値を置き換えること", async () => {
    await sendEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: createMessage({
          id: "m1",
          sessionID: "s1",
          role: "assistant",
          tokens: { input: 10000, output: 0, reasoning: 0, cache: { read: 2000, write: 0 } },
        }),
      },
    });
    expect(await getContextMemoryText()).toBe("12K (6%)");

    await sendEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: createMessage({
          id: "m2",
          sessionID: "s1",
          role: "assistant",
          tokens: { input: 18000, output: 0, reasoning: 0, cache: { read: 2000, write: 0 } },
        }),
      },
    });
    expect(await getContextMemoryText()).toBe("20K (10%)");
  });

  it("loaded assistant メッセージでは最新の有効な値だけを表示すること", async () => {
    const older = createMessage({
      id: "m1",
      sessionID: "s1",
      role: "assistant",
      tokens: { input: 10000, output: 0, reasoning: 0, cache: { read: 2000, write: 0 } },
    });
    const latest = createMessage({
      id: "m2",
      sessionID: "s1",
      role: "assistant",
      tokens: { input: 18000, output: 0, reasoning: 0, cache: { read: 2000, write: 0 } },
    });
    await sendExtMessage({
      type: "messages",
      sessionId: "s1",
      messages: [
        { info: older, parts: [createTextPart("Older response", { messageID: "m1", sessionID: "s1" })] },
        { info: latest, parts: [createTextPart("Latest response", { messageID: "m2", sessionID: "s1" })] },
      ],
    });

    expect(await getContextMemoryText()).toBe("20K (10%)");
  });

  it("複数 step の配信と重複配信では最新スナップショットを維持すること", async () => {
    const step = (input: number, read: number) =>
      sendEvent({
        type: "session.next.step.ended",
        properties: {
          sessionID: "s1",
          tokens: { input, output: 0, reasoning: 0, cache: { read, write: 0 } },
        },
      });

    await step(80000, 20000);
    expect(await getContextMemoryText()).toBe("100K (50%)");

    await step(100000, 20000);
    expect(await getContextMemoryText()).toBe("120K (60%)");

    await step(100000, 20000);
    expect(await getContextMemoryText()).toBe("120K (60%)");
  });

  it("同じ更新の fallback より非ゼロの context.updated text を優先すること", async () => {
    await sendEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: createMessage({
          id: "m1",
          sessionID: "s1",
          role: "assistant",
          tokens: { input: 10000, output: 0, reasoning: 0, cache: { read: 2000, write: 0 } },
        }),
      },
    });
    expect(await getContextMemoryText()).toBe("12K (6%)");

    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "19.5K (9.75%)" },
    });
    expect(await getContextMemoryText()).toBe("19.5K (9.75%)");

    await sendEvent({
      type: "session.next.step.ended",
      properties: {
        sessionID: "s1",
        tokens: { input: 12000, output: 0, reasoning: 0, cache: { read: 3000, write: 0 } },
      },
    });
    expect(await getContextMemoryText()).toBe("19.5K (9.75%)");
  });

  it("zero の context.updated text では最後の有効値を保持すること", async () => {
    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "24K (12%)" },
    });
    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "0 (0%)" },
    });
    expect(await getContextMemoryText()).toBe("24K (12%)");
  });

  it("session.updated の累積 tokens では chip を更新しないこと", async () => {
    await sendEvent({
      type: "session.next.step.ended",
      properties: {
        sessionID: "s1",
        tokens: { input: 18000, output: 0, reasoning: 0, cache: { read: 2000, write: 0 } },
      },
    });
    expect(await getContextMemoryText()).toBe("20K (10%)");

    await sendEvent({
      type: "session.updated",
      properties: {
        sessionID: "s1",
        info: {
          id: "s1",
          title: "Test",
          time: { created: Date.now(), updated: Date.now() },
          tokens: { input: 180000, output: 5000, reasoning: 1000, cache: { read: 200000, write: 50000 } },
        },
      },
    });
    expect(await getContextMemoryText()).toBe("20K (10%)");
  });

  it("zero または不完全な fallback tokens では最後の有効値を保持すること", async () => {
    await sendEvent({
      type: "session.next.step.ended",
      properties: {
        sessionID: "s1",
        tokens: { input: 18000, output: 0, reasoning: 0, cache: { read: 2000, write: 0 } },
      },
    });
    expect(await getContextMemoryText()).toBe("20K (10%)");

    await sendEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: createMessage({
          id: "m-zero",
          sessionID: "s1",
          role: "assistant",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      },
    });
    await sendEvent({
      type: "session.next.step.ended",
      properties: {
        sessionID: "s1",
        tokens: { input: 1000, cache: {} } as unknown as {
          input: number;
          output: number;
          reasoning: number;
          cache: { read: number; write: number };
        },
      },
    });
    expect(await getContextMemoryText()).toBe("20K (10%)");
  });

  it("非アクティブセッションのイベントでは chip を更新しないこと", async () => {
    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "16K (8%)" },
    });
    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s2", text: "99K (50%)" },
    });
    await sendEvent({
      type: "session.next.step.ended",
      properties: {
        sessionID: "s2",
        tokens: { input: 90000, output: 0, reasoning: 0, cache: { read: 9000, write: 0 } },
      },
    });
    expect(await getContextMemoryText()).toBe("16K (8%)");
  });

  it("コンパクション後は fallback snapshot でも chip を再表示すること", async () => {
    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "22K (11%)" },
    });
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: 1 },
    });
    expect(await getContextMemoryText()).toBeNull();

    await sendEvent({
      type: "session.next.compaction.ended",
      properties: { sessionID: "s1", text: "summary", recent: "recent" },
    });
    await sendEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: createMessage({
          id: "m-post-compaction",
          sessionID: "s1",
          role: "assistant",
          tokens: { input: 7000, output: 0, reasoning: 0, cache: { read: 1000, write: 0 } },
        }),
      },
    });
    expect(await getContextMemoryText()).toBe("8K (4%)");
  });

  it("input と cache.read の合計で token limit percentage を表示すること", async () => {
    await sendEvent({
      type: "message.updated",
      properties: {
        sessionID: "s1",
        info: createMessage({
          id: "m-limit",
          sessionID: "s1",
          role: "assistant",
          tokens: { input: 100000, output: 500000, reasoning: 100000, cache: { read: 50000, write: 300000 } },
        }),
      },
    });
    expect(await getContextMemoryText()).toBe("150K (75%)");
  });
});
