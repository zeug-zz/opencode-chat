import type { ChatSandboxSettings } from "@opencode-chat/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { loadChatSandboxSettings, updateChatSandboxSettings } from "../chat-sandbox-settings";

describe("updateChatSandboxSettings", () => {
  const workspaceTarget = { fsPath: "/workspace/project", scheme: "file" };
  const update = vi.fn().mockResolvedValue(undefined);
  const getConfiguration = vi.mocked(vscode.workspace.getConfiguration);

  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue(undefined);
    getConfiguration.mockReturnValue({
      get: vi.fn(() => undefined),
      inspect: vi.fn(() => undefined),
      update,
    } as never);
  });

  it.each([
    ["on", true],
    ["off", false],
  ] as const)("persists mode %s and the network setting at workspace scope", async (mode, allowNetwork) => {
    const settings: ChatSandboxSettings = { mode, allowNetwork };

    await updateChatSandboxSettings(settings, workspaceTarget);

    expect(getConfiguration).toHaveBeenCalledWith("opencode-chat", workspaceTarget);
    expect(update).toHaveBeenNthCalledWith(1, "chatSandbox.mode", mode, vscode.ConfigurationTarget.Workspace);
    expect(update).toHaveBeenNthCalledWith(
      2,
      "chatSandbox.allowNetwork",
      allowNetwork,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  it("removes the workspace mode override when resetting to inherit", async () => {
    await updateChatSandboxSettings({ mode: "inherit", allowNetwork: true }, workspaceTarget);

    expect(update).toHaveBeenNthCalledWith(1, "chatSandbox.mode", undefined, vscode.ConfigurationTarget.Workspace);
    expect(update).toHaveBeenNthCalledWith(2, "chatSandbox.allowNetwork", true, vscode.ConfigurationTarget.Workspace);
  });

  it("only updates extension-owned settings", async () => {
    await updateChatSandboxSettings({ mode: "on", allowNetwork: false }, workspaceTarget);

    expect(update).not.toHaveBeenCalledWith("enabled", expect.anything(), expect.anything());
    expect(update).not.toHaveBeenCalledWith("allowNetwork", expect.anything(), expect.anything());
    expect(update.mock.calls.every(([key]) => String(key).startsWith("chatSandbox."))).toBe(true);
  });

  it("fails before updating a managed Chat sandbox setting", async () => {
    getConfiguration.mockImplementation((section: string) => {
      if (section === "opencode-chat") {
        return {
          get: vi.fn((key: string) => (key === "chatSandbox.mode" ? "inherit" : true)),
          inspect: vi.fn(() => ({ managedValue: "on" })),
          update,
        } as never;
      }
      return { get: vi.fn(() => false), inspect: vi.fn(() => undefined) } as never;
    });

    await expect(updateChatSandboxSettings({ mode: "off", allowNetwork: false }, workspaceTarget)).rejects.toThrow(
      /managed.*cannot be changed/i,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("reports unsupported platforms and disables an otherwise requested sandbox", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section: string) => {
      if (section === "chat.agent.sandbox") {
        return { get: vi.fn(() => "on"), inspect: vi.fn(() => undefined) } as never;
      }
      return {
        get: vi.fn((key: string) => (key === "chatSandbox.mode" ? "inherit" : true)),
        inspect: vi.fn(() => undefined),
      } as never;
    });

    const result = loadChatSandboxSettings(workspaceTarget, () => false);

    expect(result.supported).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.error).toContain("unsupported on this platform");
  });

  it("keeps an explicitly requested sandbox inactive on unsupported Windows", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section: string) => {
      if (section === "chat.agent.sandbox") {
        return { get: vi.fn(() => "off"), inspect: vi.fn(() => undefined) } as never;
      }
      return {
        get: vi.fn((key: string) => (key === "chatSandbox.mode" ? "on" : true)),
        inspect: vi.fn(() => undefined),
      } as never;
    });

    const result = loadChatSandboxSettings(workspaceTarget, () => false);

    expect(result.mode).toBe("on");
    expect(result.supported).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.inherited).toBe(false);
    expect(result.error).toMatch(/unsupported on this platform/i);
  });
});

describe("loadChatSandboxSettings", () => {
  const workspaceTarget = { fsPath: "/workspace/project", scheme: "file" };

  it.each([
    ["on", true, true],
    ["off", false, true],
    [undefined, false, true],
    [true, false, false],
    [false, false, false],
    ["auto", false, false],
    ["true", false, false],
    ["false", false, false],
  ] as const)("normalizes native enabled value %s", (nativeValue, enabled, valid) => {
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section: string) => {
      if (section === "chat.agent.sandbox") {
        return {
          get: vi.fn(() => nativeValue),
          inspect: vi.fn(() => undefined),
        } as never;
      }
      return {
        get: vi.fn((key: string) => (key === "chatSandbox.mode" ? "inherit" : true)),
        inspect: vi.fn(() => undefined),
      } as never;
    });

    const result = loadChatSandboxSettings(workspaceTarget);

    expect(result.nativeEnabled).toBe(enabled);
    expect(result.enabled).toBe(enabled && valid);
    if (valid) {
      expect(result.error).toBeUndefined();
    } else {
      expect(result.error).toContain("Invalid chat.agent.sandbox.enabled");
    }
  });
});
