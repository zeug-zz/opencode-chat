import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { postMessage } from "../../vscode-api";
import { createSession } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

async function setupActiveSession() {
  renderApp();
  const session = createSession({ id: "s1", title: "Chat" });
  await sendExtMessage({ type: "activeSession", session });
  vi.mocked(postMessage).mockClear();
  return session;
}

describe("シェルコマンド実行", () => {
  it("! プレフィクスを含む入力を通常の sendMessage として送信すること", async () => {
    const session = await setupActiveSession();
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");

    await user.type(textarea, "!ls -la{Enter}");

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sendMessage",
        sessionId: session.id,
        text: "!ls -la",
      }),
    );
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "executeShell" }));
  });

  it("シェルモードの UI を表示しないこと", async () => {
    await setupActiveSession();
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");

    await user.type(textarea, "!");

    expect(textarea).toHaveValue("!");
    expect(screen.queryByTestId("shell-chip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shell-toggle")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Enter shell command...")).not.toBeInTheDocument();
  });

  it("通常の入力を送信した後に入力欄をクリアすること", async () => {
    await setupActiveSession();
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");

    await user.type(textarea, "!pwd{Enter}");

    expect(textarea).toHaveValue("");
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "executeShell" }));
  });
});
