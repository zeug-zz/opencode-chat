import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPersistedState, postMessage } from "../../vscode-api";
import { createMessage, createSession, createTextPart } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

describe("質問ダイアログのイベントからレンダリング", () => {
  beforeEach(() => {
    vi.mocked(getPersistedState).mockReturnValue(undefined);
  });

  it("既存のビジーなアシスタントメッセージに question.asked を即時表示すること", async () => {
    renderApp();
    const session = createSession({ id: "s1", title: "Chat" });
    await sendExtMessage({ type: "activeSession", session });

    const assistantMessage = createMessage({ id: "m1", sessionID: session.id, role: "assistant" });
    const assistantPart = createTextPart("Assistant is working", {
      messageID: assistantMessage.id,
      sessionID: session.id,
    });
    await sendExtMessage({
      type: "messages",
      sessionId: session.id,
      messages: [{ info: assistantMessage, parts: [assistantPart] }],
    });
    await sendExtMessage({
      type: "event",
      event: { type: "session.status", properties: { sessionID: session.id, status: { type: "busy" } } } as any,
    });

    // Capture the rendered message before the question event. No message event
    // is sent between this snapshot and question.asked below.
    const messagesBeforeQuestion = screen.getAllByText("Assistant is working");
    expect(messagesBeforeQuestion).toHaveLength(1);
    expect(screen.getByTitle("Stop")).toBeInTheDocument();

    await sendExtMessage({
      type: "event",
      event: {
        type: "question.asked",
        properties: {
          id: "req-1",
          sessionID: session.id,
          questions: [
            {
              header: "Tool selection",
              question: "Which tool should I use?",
              options: [{ label: "Continue", description: "Keep working" }],
            },
          ],
          tool: { messageID: assistantMessage.id },
        },
      } as any,
    });

    // The question is visible from this state update alone: no interrupt,
    // unrelated message event, or session-status transition was delivered.
    expect(screen.getByText("Which tool should I use?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();

    // The existing message remains the only rendered message, and the busy
    // streaming indicator may remain while the question is answerable.
    expect(screen.getAllByText("Assistant is working")).toHaveLength(messagesBeforeQuestion.length);
    expect(screen.getByTitle("Stop")).toBeInTheDocument();
  });

  it("イベントから表示された質問への回答は元の ID と回答形式を保ち、質問を除去すること", async () => {
    renderApp();
    const session = createSession({ id: "s1", title: "Chat" });
    await sendExtMessage({ type: "activeSession", session });
    const assistantMessage = createMessage({ id: "m1", sessionID: session.id, role: "assistant" });
    const assistantPart = createTextPart("Assistant is working", {
      messageID: assistantMessage.id,
      sessionID: session.id,
    });
    await sendExtMessage({
      type: "messages",
      sessionId: session.id,
      messages: [{ info: assistantMessage, parts: [assistantPart] }],
    });
    await sendExtMessage({
      type: "event",
      event: {
        type: "question.asked",
        properties: {
          id: "req-answer",
          sessionID: session.id,
          questions: [
            {
              header: "Tool selection",
              question: "Which tool should I use?",
              options: [{ label: "Continue", description: "Keep working" }],
            },
          ],
          tool: { messageID: assistantMessage.id },
        },
      } as any,
    });

    vi.mocked(postMessage).mockClear();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(postMessage).toHaveBeenCalledWith({
      type: "replyQuestion",
      requestId: "req-answer",
      answers: [["Continue"]],
    });

    await sendExtMessage({
      type: "event",
      event: {
        type: "question.replied",
        properties: { sessionID: session.id, requestID: "req-answer" },
      } as any,
    });
    expect(screen.queryByText("Which tool should I use?")).not.toBeInTheDocument();
  });

  it("イベントから表示された質問の拒否は元の ID を保ち、質問を除去すること", async () => {
    renderApp();
    const session = createSession({ id: "s1", title: "Chat" });
    await sendExtMessage({ type: "activeSession", session });
    const assistantMessage = createMessage({ id: "m1", sessionID: session.id, role: "assistant" });
    const assistantPart = createTextPart("Assistant is working", {
      messageID: assistantMessage.id,
      sessionID: session.id,
    });
    await sendExtMessage({
      type: "messages",
      sessionId: session.id,
      messages: [{ info: assistantMessage, parts: [assistantPart] }],
    });
    await sendExtMessage({
      type: "event",
      event: {
        type: "question.asked",
        properties: {
          id: "req-reject",
          sessionID: session.id,
          questions: [
            {
              header: "Tool selection",
              question: "Which tool should I use?",
              options: [{ label: "Continue", description: "Keep working" }],
            },
          ],
          tool: { messageID: assistantMessage.id },
        },
      } as any,
    });

    vi.mocked(postMessage).mockClear();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reject" }));
    expect(postMessage).toHaveBeenCalledWith({
      type: "rejectQuestion",
      requestId: "req-reject",
    });

    await sendExtMessage({
      type: "event",
      event: {
        type: "question.rejected",
        properties: { sessionID: session.id, requestID: "req-reject" },
      } as any,
    });
    expect(screen.queryByText("Which tool should I use?")).not.toBeInTheDocument();
  });
});
