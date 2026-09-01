import type { ChatSandboxStatus } from "@opencode-chat/core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage, setPersistedState } from "../../vscode-api";
import { createSession } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

/** 設定パネル用のアクティブセッションをセットアップする */
async function setupForSettings() {
  renderApp();
  const session = createSession({ id: "s1" });
  await sendExtMessage({ type: "activeSession", session });

  // toolConfig パスを設定
  await sendExtMessage({
    type: "toolConfig",
    paths: {
      home: "/home/user",
      config: "/home/user/.config/opencode",
      state: "/home/user/.local/state/opencode",
      directory: "/workspace",
    },
  });

  vi.mocked(postMessage).mockClear();
}

function sandboxStatus(overrides: Partial<ChatSandboxStatus> = {}): ChatSandboxStatus {
  return {
    mode: "inherit",
    enabled: true,
    inherited: true,
    allowNetwork: true,
    applying: false,
    managed: false,
    supported: true,
    ...overrides,
  };
}

// Settings
describe("設定", () => {
  // Settings button opens/closes ToolConfigPanel
  it("設定ボタンで ToolConfigPanel が開閉すること", async () => {
    await setupForSettings();
    const user = userEvent.setup();

    // 設定ボタンをクリック
    await user.click(screen.getByTitle("Settings"));

    // パネルが開く
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  // Changing locale updates persisted state
  it("ロケール変更で persisted state が更新されること", async () => {
    await setupForSettings();
    const user = userEvent.setup();

    // 設定パネルを開く
    await user.click(screen.getByTitle("Settings"));

    // 「日本語」を選択 via in-panel language menu
    const languageBtn = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "listbox");
    expect(languageBtn).toBeTruthy();
    await user.click(languageBtn!);
    await user.click(screen.getByRole("option", { name: /日本語|Japanese/i }));

    expect(setPersistedState).toHaveBeenCalledWith(expect.objectContaining({ localeSetting: "ja" }));
  });

  // Config file link sends openConfigFile
  it("設定ファイルリンクで openConfigFile が送信されること", async () => {
    await setupForSettings();
    const user = userEvent.setup();

    await user.click(screen.getByTitle("Settings"));

    // グローバル設定をクリック
    await user.click(screen.getByText("Global Config"));

    expect(postMessage).toHaveBeenCalledWith({
      type: "openConfigFile",
      filePath: "/home/user/.config/opencode/opencode.json",
    });
  });

  // Project config file link sends openConfigFile
  it("プロジェクト設定ファイルリンクで openConfigFile が送信されること", async () => {
    await setupForSettings();
    const user = userEvent.setup();

    await user.click(screen.getByTitle("Settings"));

    await user.click(screen.getByText("Project Config"));

    expect(postMessage).toHaveBeenCalledWith({
      type: "openConfigFile",
      filePath: "/workspace/.opencode/opencode.json",
    });
  });

  // Terminal button sends openTerminal
  it("ターミナルボタンで openTerminal が送信されること", async () => {
    await setupForSettings();
    const user = userEvent.setup();

    await user.click(screen.getByTitle("Hand off to TUI"));

    expect(postMessage).toHaveBeenCalledWith({ type: "openTerminal" });
  });

  // Switching locale to Japanese updates UI text
  it("ロケールを日本語に変えるとUIが日本語になること", async () => {
    await setupForSettings();
    const user = userEvent.setup();

    // 設定パネルを開いて日本語に変更
    await user.click(screen.getByTitle("Settings"));
    const languageBtn = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "listbox");
    expect(languageBtn).toBeTruthy();
    await user.click(languageBtn!);
    await user.click(screen.getByRole("option", { name: /日本語|Japanese/i }));

    // ヘッダーの「New chat」が「新しいチャット」になる
    expect(screen.getByTitle("新しいチャット")).toBeInTheDocument();
  });

  context("Chat sandbox settings", () => {
    it("inherit が native on では checked、native off では unchecked になること", async () => {
      await setupForSettings();
      const user = userEvent.setup();
      await sendExtMessage({ type: "chatSandboxStatus", status: sandboxStatus({ enabled: true }) });
      await user.click(screen.getByTitle("Settings"));
      expect(screen.getByTestId("sandbox-chat-tools")).toBeChecked();

      await sendExtMessage({
        type: "chatSandboxStatus",
        status: sandboxStatus({ enabled: false, allowNetwork: false }),
      });
      expect(screen.getByTestId("sandbox-chat-tools")).not.toBeChecked();
    });

    it("workspace enable/disable/reset が typed settings payload を送ること", async () => {
      await setupForSettings();
      const user = userEvent.setup();
      await sendExtMessage({
        type: "chatSandboxStatus",
        status: sandboxStatus({ enabled: false, mode: "off", inherited: false, allowNetwork: false }),
      });
      await user.click(screen.getByTitle("Settings"));

      await user.click(screen.getByTestId("sandbox-chat-tools"));
      expect(postMessage).toHaveBeenCalledWith({
        type: "setChatSandboxSettings",
        settings: { mode: "on", allowNetwork: false },
      });

      await sendExtMessage({
        type: "chatSandboxStatus",
        status: sandboxStatus({ mode: "on", inherited: false, allowNetwork: false }),
      });
      await user.click(screen.getByTestId("sandbox-chat-tools"));
      expect(postMessage).toHaveBeenCalledWith({
        type: "setChatSandboxSettings",
        settings: { mode: "off", allowNetwork: false },
      });

      await user.click(screen.getByRole("button", { name: "Use VS Code setting" }));
      expect(postMessage).toHaveBeenCalledWith({
        type: "setChatSandboxSettings",
        settings: { mode: "inherit", allowNetwork: false },
      });
    });

    it("network-enabled と local-only の説明と network payload を表示すること", async () => {
      await setupForSettings();
      const user = userEvent.setup();
      await sendExtMessage({ type: "chatSandboxStatus", status: sandboxStatus({ allowNetwork: true }) });
      await user.click(screen.getByTitle("Settings"));
      expect(screen.getByText(/Compatibility mode: filesystem restrictions remain active/)).toBeInTheDocument();
      expect(screen.getByTestId("sandbox-network-access")).toBeChecked();

      await user.click(screen.getByTestId("sandbox-network-access"));
      expect(postMessage).toHaveBeenCalledWith({
        type: "setChatSandboxSettings",
        settings: { mode: "inherit", allowNetwork: false },
      });

      await sendExtMessage({
        type: "chatSandboxStatus",
        status: sandboxStatus({ allowNetwork: false }),
      });
      expect(screen.getByText(/Local-only operation/)).toBeInTheDocument();
      expect(screen.getByTestId("sandbox-network-access")).not.toBeChecked();
    });

    it("applying 中は sandbox controls を無効化し、success/error 後は retry できること", async () => {
      await setupForSettings();
      const user = userEvent.setup();
      await sendExtMessage({ type: "chatSandboxStatus", status: sandboxStatus({ applying: true }) });
      await user.click(screen.getByTitle("Settings"));
      expect(screen.getByTestId("sandbox-chat-tools")).toBeDisabled();
      expect(screen.getByTestId("sandbox-network-access")).toBeDisabled();

      await sendExtMessage({
        type: "chatSandboxStatus",
        status: sandboxStatus({ enabled: false, mode: "off", inherited: false }),
      });
      expect(screen.getByTestId("sandbox-chat-tools")).toBeEnabled();
      await user.click(screen.getByTestId("sandbox-chat-tools"));
      expect(postMessage).toHaveBeenCalledWith({
        type: "setChatSandboxSettings",
        settings: { mode: "on", allowNetwork: true },
      });

      await sendExtMessage({
        type: "chatSandboxStatus",
        status: sandboxStatus({ enabled: false, mode: "off", inherited: false, error: "transition failed" }),
      });
      expect(screen.getByTestId("sandbox-chat-tools")).toBeEnabled();
      await user.click(screen.getByTestId("sandbox-chat-tools"));
      expect(postMessage).toHaveBeenLastCalledWith({
        type: "setChatSandboxSettings",
        settings: { mode: "on", allowNetwork: true },
      });
    });
  });

  // toolConfig message sets paths and shows config links in the panel
  context("toolConfig メッセージを受信した場合", () => {
    beforeEach(async () => {
      renderApp();
      const session = createSession({ id: "s1" });
      await sendExtMessage({ type: "activeSession", session });

      await sendExtMessage({
        type: "toolConfig",
        paths: { home: "/h", config: "/c", state: "/s", directory: "/d" },
      });

      const user = userEvent.setup();
      await user.click(screen.getByTitle("Settings"));
    });

    // Shows Project Config link
    it("Project Config リンクが表示されること", () => {
      expect(screen.getByText("Project Config")).toBeInTheDocument();
    });

    // Shows Global Config link
    it("Global Config リンクが表示されること", () => {
      expect(screen.getByText("Global Config")).toBeInTheDocument();
    });
  });
});
