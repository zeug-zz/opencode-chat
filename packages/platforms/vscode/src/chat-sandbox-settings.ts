import type { ChatSandboxMode, ChatSandboxSettings, ChatSandboxStatus } from "@opencode-chat/core";
import { SandboxManager } from "@vscode/sandbox-runtime";
import * as vscode from "vscode";

const CHAT_SANDBOX_CONFIGURATION = "opencode-chat";
const NATIVE_SANDBOX_CONFIGURATION = "chat.agent.sandbox";

export type ChatSandboxSettingsResolution = ChatSandboxStatus & {
  nativeEnabled: boolean;
};

type ConfigurationValue = {
  value: unknown;
  managed: boolean;
};

function readConfigurationValue(section: string, key: string, scope?: vscode.ConfigurationScope): ConfigurationValue {
  const configuration = vscode.workspace.getConfiguration(section, scope);
  const inspected = typeof configuration.inspect === "function" ? configuration.inspect<unknown>(key) : undefined;
  const managed =
    inspected !== undefined && (inspected as unknown as { managedValue?: unknown }).managedValue !== undefined;

  return { value: configuration.get<unknown>(key), managed };
}

function normalizeMode(value: unknown): { mode: ChatSandboxMode; valid: boolean } {
  if (value === undefined) {
    return { mode: "inherit", valid: true };
  }
  if (value === "inherit" || value === "on" || value === "off") {
    return { mode: value, valid: true };
  }

  return { mode: "off", valid: false };
}

function normalizeNativeEnabled(value: unknown): { enabled: boolean; valid: boolean } {
  if (value === undefined) {
    return { enabled: false, valid: true };
  }
  if (value === "on") {
    return { enabled: true, valid: true };
  }
  if (value === "off") {
    return { enabled: false, valid: true };
  }
  return { enabled: false, valid: false };
}

function normalizeAllowNetwork(value: unknown): { allowNetwork: boolean; valid: boolean } {
  if (value === undefined) {
    return { allowNetwork: true, valid: true };
  }
  return typeof value === "boolean" ? { allowNetwork: value, valid: true } : { allowNetwork: true, valid: false };
}

export function loadChatSandboxSettings(
  scope?: vscode.ConfigurationScope,
  isSupported: () => boolean = () => SandboxManager.isSupportedPlatform(),
): ChatSandboxSettingsResolution {
  const modeValue = readConfigurationValue(CHAT_SANDBOX_CONFIGURATION, "chatSandbox.mode", scope);
  const networkValue = readConfigurationValue(CHAT_SANDBOX_CONFIGURATION, "chatSandbox.allowNetwork", scope);
  const nativeValue = readConfigurationValue(NATIVE_SANDBOX_CONFIGURATION, "enabled", scope);

  const mode = normalizeMode(modeValue.value);
  const native = normalizeNativeEnabled(nativeValue.value);
  const network = normalizeAllowNetwork(networkValue.value);
  const inherited = mode.valid && mode.mode === "inherit";
  const requestedEnabled = mode.valid && (mode.mode === "on" || (inherited && native.valid && native.enabled));
  const supported = isSupported();
  const enabled = requestedEnabled && supported;
  const errors: string[] = [];

  if (!mode.valid) {
    errors.push("Invalid opencode-chat.chatSandbox.mode; Chat sandboxing is disabled.");
  }
  if (inherited && !native.valid) {
    errors.push("Invalid chat.agent.sandbox.enabled; Chat sandboxing is disabled.");
  }
  if (!network.valid) {
    errors.push("Invalid opencode-chat.chatSandbox.allowNetwork; network access defaults to enabled.");
  }
  if (!supported) {
    errors.push("Chat sandboxing is unsupported on this platform; Chat is running unsandboxed.");
  }

  return {
    mode: mode.mode,
    allowNetwork: network.allowNetwork,
    enabled,
    inherited,
    applying: false,
    managed: modeValue.managed || networkValue.managed,
    supported,
    ...(errors.length > 0 ? { error: errors.join(" ") } : {}),
    nativeEnabled: native.enabled,
  };
}

export function resolveChatSandboxSettings(
  scope?: vscode.ConfigurationScope,
  isSupported: () => boolean = () => SandboxManager.isSupportedPlatform(),
): ChatSandboxSettingsResolution {
  return loadChatSandboxSettings(scope, isSupported);
}

export async function updateChatSandboxSettings(
  settings: ChatSandboxSettings,
  workspaceTarget: vscode.ConfigurationScope,
): Promise<void> {
  const current = loadChatSandboxSettings(workspaceTarget);
  if (current.managed) {
    throw new Error("Chat sandbox settings are managed by your organization and cannot be changed.");
  }
  const configuration = vscode.workspace.getConfiguration(CHAT_SANDBOX_CONFIGURATION, workspaceTarget);
  const mode = settings.mode === "inherit" ? undefined : settings.mode;

  await configuration.update("chatSandbox.mode", mode, vscode.ConfigurationTarget.Workspace);
  await configuration.update("chatSandbox.allowNetwork", settings.allowNetwork, vscode.ConfigurationTarget.Workspace);
}
