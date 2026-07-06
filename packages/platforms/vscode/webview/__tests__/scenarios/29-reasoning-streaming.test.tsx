import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createMessage, createSession, createTextPart } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

async function setupWithMessage() {
  renderApp();
  const session = createSession({ id: "s1" });
  await sendExtMessage({ type: "activeSession", session });

  const msg = createMessage({ id: "m1", sessionID: "s1", role: "assistant" });
  const part = createTextPart("placeholder", { messageID: "m1", sessionID: "s1" });
  await sendExtMessage({
    type: "messages",
    sessionId: "s1",
    messages: [{ info: msg, parts: [part] }],
  });
}

describe("リーズニングストリーミング表示", () => {
  context("reasoning.started イベント受信時", () => {
    beforeEach(async () => {
      await setupWithMessage();
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as any,
      });
    });

    it("Thinking… が表示されリーズニングブロックが展開されること", () => {
      expect(screen.getByText("Thinking\u2026")).toBeInTheDocument();
    });
  });

  context("reasoning.delta 受信でテキストが累積表示される場合", () => {
    beforeEach(async () => {
      await setupWithMessage();
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as any,
      });
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Step 1" },
        } as any,
      });
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: " Step 2" },
        } as any,
      });
    });

    it("累積テキストが表示されること", async () => {
      const user = userEvent.setup();
      await user.click(screen.getByTitle("Toggle thought details"));
      expect(await screen.findByText("Step 1 Step 2")).toBeInTheDocument();
    });
  });

  context("reasoning.ended 受信で完了状態になる場合", () => {
    beforeEach(async () => {
      await setupWithMessage();
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.started",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1" },
        } as any,
      });
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.delta",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", delta: "Final" },
        } as any,
      });
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.ended",
          properties: { sessionID: "s1", assistantMessageID: "m1", reasoningID: "r1", text: "Final thought" },
        } as any,
      });
    });

    it("Thought が表示されスピナーが非表示になること", () => {
      expect(screen.getByText("Thought")).toBeInTheDocument();
      expect(screen.queryByText("Thinking\u2026")).not.toBeInTheDocument();
      const part = screen.getByText("Thought").closest(".reasoningPart");
      expect(part).not.toHaveClass("reasoningActive");
      expect(part?.querySelector(".spinner")).not.toBeInTheDocument();
    });
  });

  context("別セッションの reasoning イベントの場合", () => {
    beforeEach(async () => {
      await setupWithMessage();
      await sendExtMessage({
        type: "event",
        event: {
          type: "session.next.reasoning.started",
          properties: { sessionID: "other", assistantMessageID: "m1", reasoningID: "r1" },
        } as any,
      });
    });

    it("イベントが無視されること", () => {
      expect(screen.queryByText("Thinking\u2026")).not.toBeInTheDocument();
    });
  });
});
