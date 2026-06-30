import type { AgentEvent } from "@opencode-chat/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage } from "../../vscode-api";
import { createAllProvidersData, createProvider, createSession } from "../factories";
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

  it("コンパクション後にフォールバックトークンが再び機能すること", async () => {
    await sendEvent({
      type: "session.next.compaction.started",
      properties: { sessionID: "s1", messageID: "m1", timestamp: Date.now() },
    });

    await sendEvent({
      type: "session.next.context.updated",
      properties: { sessionID: "s1", text: "5.2K (3%)" },
    });

    await sendEvent({
      type: "session.next.step.ended",
      properties: {
        sessionID: "s1",
        tokens: {
          input: 10000,
          output: 2000,
          reasoning: 500,
          cache: { read: 8000, write: 1000 },
        },
      },
    });
    const text = await getContextMemoryText();
    expect(text).not.toBeNull();
    expect(text).not.toBe("5.2K (3%)");
  });
});
