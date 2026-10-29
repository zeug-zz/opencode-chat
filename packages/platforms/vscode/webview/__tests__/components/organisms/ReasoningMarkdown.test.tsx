import type { MessagePart } from "@opencode-chat/core";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.unmock("marked");

import type { MessageWithParts } from "../../../App";
import { MessageItem } from "../../../components/organisms/MessageItem/MessageItem";
import { AppContextProvider, type AppContextValue } from "../../../contexts/AppContext";
import { postMessage } from "../../../vscode-api";
import { createMessage } from "../../factories";

function createContextWrapper() {
  const contextValue = { isShellMessage: () => false } as unknown as AppContextValue;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AppContextProvider value={contextValue}>{children}</AppContextProvider>;
  };
}

function createReasoningMessage(text: string): MessageWithParts {
  const part: MessagePart = {
    id: "reasoning-1",
    type: "reasoning",
    text,
    sessionID: "session-1",
    messageID: "message-1",
    time: { start: 1 },
  };
  return { info: createMessage({ id: "message-1", role: "assistant" }), parts: [part] };
}

describe("Reasoning Markdown rendering", () => {
  const props = { activeSessionId: "session-1", questions: new Map() };

  it("uses sanitized Markdown for thinking content", () => {
    const markdown =
      '**bold**\n\n- item\n\n`inline code` <script>window.compromised = true</script> <img src=x onerror="alert(1)"> [unsafe](javascript:alert(1))';
    const { container } = render(
      <MessageItem {...props} message={createReasoningMessage(markdown)} showAllThinking />,
      { wrapper: createContextWrapper() },
    );

    expect(container.querySelector(".reasoningBody strong")).toHaveTextContent("bold");
    expect(container.querySelector(".reasoningBody li")).toHaveTextContent("item");
    expect(container.querySelector(".reasoningBody code")).toHaveTextContent("inline code");
    expect(container.querySelector(".reasoningBody script")).not.toBeInTheDocument();
    expect(container.querySelector(".reasoningBody [onerror]")).not.toBeInTheDocument();
    expect(container.querySelector('.reasoningBody a[href^="javascript:"]')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("**bold**");
  });

  it("updates streaming Markdown and retains collapse, re-expand, and show-all behavior", () => {
    const initial = createReasoningMessage("**first**");
    const { rerender } = render(<MessageItem {...props} message={initial} />, { wrapper: createContextWrapper() });
    expect(screen.queryByText("first", { selector: "strong" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Toggle thought details"));
    expect(screen.getByText("first", { selector: "strong" })).toBeInTheDocument();

    const updated = createReasoningMessage("**first update**");
    rerender(<MessageItem {...props} message={updated} />);
    expect(screen.getByText("first update", { selector: "strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Toggle thought details"));
    expect(screen.queryByText("first update", { selector: "strong" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Toggle thought details"));
    expect(screen.getByText("first update", { selector: "strong" })).toBeInTheDocument();

    rerender(<MessageItem {...props} message={updated} showAllThinking />);
    fireEvent.click(screen.getByTitle("Toggle thought details"));
    expect(screen.getByText("first update", { selector: "strong" })).toBeInTheDocument();
  });

  it("renders each visible reasoning segment independently without thinking copy", () => {
    const first = "**First section**";
    const second = "**Second section**";
    const message: MessageWithParts = {
      info: createMessage({ id: "message-1", role: "assistant" }),
      parts: [
        {
          id: "answer-text",
          type: "text",
          text: "The answer only.",
          sessionID: "session-1",
          messageID: "message-1",
        },
        ...[first, second].map((text, index) => ({
          id: `reasoning-${index + 1}`,
          type: "reasoning" as const,
          text,
          sessionID: "session-1",
          messageID: "message-1",
          time: { start: index + 1 },
        })),
      ],
    };
    const { container } = render(<MessageItem {...props} message={message} showAllThinking />, {
      wrapper: createContextWrapper(),
    });

    const bodies = container.querySelectorAll(".reasoningBody");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.querySelector("strong")).toHaveTextContent("First section");
    expect(bodies[1]?.querySelector("strong")).toHaveTextContent("Second section");
    expect(container.textContent).not.toContain("****");
    expect(container.textContent).not.toContain("First section**Second section");

    expect(screen.queryByRole("button", { name: "Copy thinking as Markdown" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(postMessage).toHaveBeenCalledWith({ type: "copyToClipboard", text: "The answer only." });
    expect(JSON.stringify(vi.mocked(postMessage).mock.calls)).not.toContain(first);
    expect(JSON.stringify(vi.mocked(postMessage).mock.calls)).not.toContain(second);
    expect(container.querySelectorAll(".reasoningBody")).toHaveLength(2);
  });

  it("does not show a copy button for an empty visible reasoning segment", () => {
    const message = createReasoningMessage("");
    render(<MessageItem {...props} message={message} showAllThinking />, { wrapper: createContextWrapper() });

    expect(screen.queryByRole("button", { name: /copy thinking/i })).not.toBeInTheDocument();
  });
});
