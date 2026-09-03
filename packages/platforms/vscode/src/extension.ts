import * as path from "node:path";
import {
  buildMcpOverlay,
  OpenCodeAgent,
  type OpenCodeLaunchConfiguration,
  resolveMcpInventory,
} from "@opencode-chat/agent-opencode";
import type { ChatSandboxSettings, ChatSandboxStatus } from "@opencode-chat/core";
import * as vscode from "vscode";
import { VscodeChatMcpPrefsStore } from "./chat-mcp-prefs";
import { ChatSandboxController } from "./chat-sandbox-controller";
import {
  buildChatSandboxFilesystemPolicy,
  buildChatSandboxNetworkPolicy,
  resolveOpenCodePaths,
  resolveRuntimeCachePaths,
} from "./chat-sandbox-policy";
import { resolveChatSandboxSettings, updateChatSandboxSettings } from "./chat-sandbox-settings";
import { ChatViewProvider } from "./chat-view-provider";
import { classifyConnectError } from "./connect-error";
import { resolveOpencodeBinary, VscodePlatformServices } from "./vscode-platform-services";

let agent = new OpenCodeAgent();
let sandboxController: ChatSandboxController<ChatSandboxStatus> | undefined;
const MCP_INVENTORY_ERROR_MESSAGE =
  "OpenCode Research could not resolve its MCP inventory. Repair the OpenCode configuration and reload the extension.";

class McpInventoryError extends Error {
  constructor() {
    super(MCP_INVENTORY_ERROR_MESSAGE);
    this.name = "McpInventoryError";
  }
}

// Extension Host プロセスが強制終了された場合でもサーバーを停止する
process.on("exit", () => agent?.disconnect());

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(vscode.l10n.t("OpenCode Research requires an open workspace folder."));
    return;
  }

  const workspaceUri = vscode.Uri.file(workspaceFolder);
  const chatMcpPrefs = new VscodeChatMcpPrefsStore(context.workspaceState);
  const sandboxSettings = resolveChatSandboxSettings(workspaceUri);
  const executablePath = resolveOpencodeBinary();
  const resolvedExecutablePath = path.isAbsolute(executablePath) ? executablePath : undefined;
  const openCodePaths = resolveOpenCodePaths();
  let initialMcpOverlay: ReturnType<typeof buildMcpOverlay> = { mcp: {} };
  let initialMcpTransport: OpenCodeLaunchConfiguration["mcpTransport"] = {};
  let inventoryError: McpInventoryError | undefined;
  try {
    const inventory = resolveMcpInventory(openCodePaths.config, workspaceFolder);
    initialMcpOverlay = buildMcpOverlay(inventory, chatMcpPrefs.read());
    initialMcpTransport = Object.fromEntries(
      Object.entries(inventory.servers).map(([name, server]) => [name, server.transport]),
    );
  } catch {
    inventoryError = new McpInventoryError();
  }
  const runtimeCachePaths = resolveRuntimeCachePaths();
  const executablePaths = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);
  const filesystemPolicy = buildChatSandboxFilesystemPolicy({
    workspacePath: workspaceFolder,
    openCodePaths,
    runtimeCachePaths,
    temporaryPaths: [openCodePaths.temp],
    executablePath: resolvedExecutablePath,
    executablePaths,
  });
  const createLaunchConfiguration = (
    settings: typeof sandboxSettings,
    mcpOverlay = initialMcpOverlay,
    mcpTransport = initialMcpTransport,
  ): OpenCodeLaunchConfiguration => ({
    workspacePath: workspaceFolder,
    sandbox: {
      mode: settings.enabled ? "on" : "off",
      enabled: settings.enabled,
      allowNetwork: settings.allowNetwork,
      filesystemPolicy,
      networkPolicy: buildChatSandboxNetworkPolicy({
        allowNetwork: settings.allowNetwork,
        platform: process.platform,
      }),
    },
    executable: { path: executablePath },
    mcpOverlay: { mcp: mcpOverlay.mcp },
    mcpTransport,
  });
  const launchConfiguration = createLaunchConfiguration(sandboxSettings);
  agent = new OpenCodeAgent(launchConfiguration);
  let chatViewProvider: ChatViewProvider | undefined;
  let initialSandboxStatus: ChatSandboxStatus = sandboxSettings;
  const reportSandboxError = (error: unknown, status?: ChatSandboxStatus) => {
    if (error instanceof McpInventoryError) {
      const sandboxStatus: ChatSandboxStatus = status ?? {
        ...sandboxSettings,
        enabled: false,
        applying: false,
        error: MCP_INVENTORY_ERROR_MESSAGE,
      };
      initialSandboxStatus = sandboxStatus;
      chatViewProvider?.publishChatSandboxStatus(sandboxStatus);
      vscode.window.showErrorMessage(vscode.l10n.t(MCP_INVENTORY_ERROR_MESSAGE));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const sandboxStatus: ChatSandboxStatus = status ?? {
      ...sandboxSettings,
      enabled: false,
      applying: false,
      error: message,
    };
    initialSandboxStatus = sandboxStatus;
    chatViewProvider?.publishChatSandboxStatus(sandboxStatus);
    vscode.window.showErrorMessage(vscode.l10n.t("OpenCode Research: {0}", message));
  };
  agent.onAvailabilityError = (error) => reportSandboxError(error);

  const connectAgent = async (sandboxEnabled: boolean) => {
    agent.workspaceFolder = workspaceFolder;
    if (sandboxEnabled) {
      await agent.connect();
      return;
    }

    // SDK の createOpencodeServer は cwd オプションを持たないため、
    // プロセスのカレントディレクトリを変更してからサーバーを起動する。
    const originalCwd = process.cwd();
    process.chdir(workspaceFolder);
    try {
      await agent.connect();
    } finally {
      process.chdir(originalCwd);
    }
  };

  let connectFailed = false;
  if (inventoryError) {
    connectFailed = true;
    initialSandboxStatus = {
      ...sandboxSettings,
      enabled: false,
      applying: false,
      error: MCP_INVENTORY_ERROR_MESSAGE,
    };
    vscode.window.showErrorMessage(vscode.l10n.t(MCP_INVENTORY_ERROR_MESSAGE));
  } else {
    try {
      await connectAgent(sandboxSettings.enabled);
    } catch (error) {
      const kind = classifyConnectError(error);
      if (kind === "not-found") {
        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'OpenCode Research: "opencode" command not found. Please install OpenCode first: https://github.com/anomalyco/opencode',
          ),
        );
        return;
      }
      connectFailed = true;
      if (sandboxSettings.enabled) {
        initialSandboxStatus = {
          ...sandboxSettings,
          enabled: false,
          applying: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (kind === "database-locked") {
        vscode.window.showErrorMessage(
          vscode.l10n.t(
            "OpenCode Research: Another OpenCode process may be using the project database. Please close other OpenCode instances (e.g., terminal UI) and reload the window.",
          ),
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const truncated = message.length > 500 ? `${message.slice(0, 500)}...` : message;
        vscode.window.showErrorMessage(
          vscode.l10n.t("OpenCode Research: Failed to start OpenCode server. {0}", truncated),
        );
      }
    }
  }

  const platformServices = new VscodePlatformServices();

  let panelUpdateInProgress = false;
  let lastResolvedKey = resolvedSettingsKey(sandboxSettings);
  chatViewProvider = new ChatViewProvider(context.extensionUri, agent, platformServices, {
    chatMcpPrefs,
    setChatSandboxSettings: async (settings: ChatSandboxSettings) => {
      const previousKey = lastResolvedKey;
      const previousStatus = initialSandboxStatus;
      panelUpdateInProgress = true;
      try {
        await updateChatSandboxSettings(settings, workspaceUri);
        const resolved = resolveChatSandboxSettings(workspaceUri);
        lastResolvedKey = resolvedSettingsKey(resolved);
        const status = await sandboxController?.update(resolved);
        if (!status) throw new Error("Chat sandbox controller is unavailable");
        initialSandboxStatus = status;
        return status;
      } catch (error) {
        lastResolvedKey = previousKey;
        initialSandboxStatus = previousStatus;
        throw error;
      } finally {
        panelUpdateInProgress = false;
      }
    },
  });
  sandboxController = new ChatSandboxController<ChatSandboxStatus>({
    stop: () => agent.stopForReconnect(),
    start: async (settings) => {
      const resolved = resolveChatSandboxSettings(workspaceUri);
      let mcpOverlay: ReturnType<typeof buildMcpOverlay>;
      let mcpTransport: OpenCodeLaunchConfiguration["mcpTransport"];
      try {
        const inventory = resolveMcpInventory(openCodePaths.config, workspaceFolder);
        mcpOverlay = buildMcpOverlay(inventory, chatMcpPrefs.read());
        mcpTransport = Object.fromEntries(
          Object.entries(inventory.servers).map(([name, server]) => [name, server.transport]),
        );
      } catch {
        throw new McpInventoryError();
      }
      agent.updateLaunchConfiguration(createLaunchConfiguration(resolved, mcpOverlay, mcpTransport));
      await connectAgent(resolved.enabled);
      return resolveChatSandboxSettings(workspaceUri);
    },
    publishStatus: (status) => chatViewProvider?.publishChatSandboxStatus(status),
    onReconnected: (status) => chatViewProvider?.refresh(status),
    onError: (error, status) => reportSandboxError(error, status),
  });
  chatViewProvider.publishChatSandboxStatus(initialSandboxStatus);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider));
  // diff エディタ用の仮想ドキュメントプロバイダー。
  // URI のクエリ部分にエンコードされたコンテンツを返す。
  const diffContentProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return decodeURIComponent(uri.query);
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("opencode-chat-diff-before", diffContentProvider),
    vscode.workspace.registerTextDocumentContentProvider("opencode-chat-diff-after", diffContentProvider),
  );

  context.subscriptions.push(new vscode.Disposable(() => agent.disconnect()));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      const chatChanged =
        event.affectsConfiguration("opencode-chat.chatSandbox.mode", workspaceUri) ||
        event.affectsConfiguration("opencode-chat.chatSandbox.allowNetwork", workspaceUri);
      const nativeChanged = event.affectsConfiguration("chat.agent.sandbox.enabled", workspaceUri);
      if (!chatChanged && !nativeChanged) return;
      if (panelUpdateInProgress) return;

      const resolved = resolveChatSandboxSettings(workspaceUri);
      if (nativeChanged && !chatChanged && resolved.mode !== "inherit") return;
      const nextKey = resolvedSettingsKey(resolved);
      if (nextKey === lastResolvedKey) return;
      lastResolvedKey = nextKey;
      void sandboxController?.update(resolved).catch((error) => {
        console.error("[OpenCode] Failed to apply sandbox configuration change:", error);
      });
    }),
  );

  // When connectFailed is true (database-locked or other non-ENOENT), the agent
  // has no client. The webview provider is still registered so the sidebar is
  // not an infinite spinner. The ready handler will throw from agent methods
  // (getPath, listSessions, etc.) with "OpenCode client is not connected".
  // Those errors are caught by ChatViewProvider.handleWebviewMessage and
  // logged. The webview shows an error surface rather than hanging silently.
}

export function deactivate() {
  sandboxController = undefined;
  agent.disconnect();
}

function resolvedSettingsKey(settings: { mode: string; enabled: boolean; allowNetwork: boolean }): string {
  return JSON.stringify({
    enabled: settings.enabled,
    allowNetwork: settings.enabled ? settings.allowNetwork : true,
  });
}
