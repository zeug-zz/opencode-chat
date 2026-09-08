import * as path from "node:path";
import {
  buildHindsightCompanionIntegration,
  buildMcpOverlay,
  detectMemoryProvider,
  OpenCodeAgent,
  type OpenCodeLaunchConfiguration,
  readEffectiveOpenCodeConfiguration,
  readHindsightPackageMetadata,
  resolveHindsightPlugin,
  resolveMcpInventory,
} from "@opencode-chat/agent-opencode";
import type {
  BundledResourceMetadata,
  ChatSandboxSettings,
  ChatSandboxStatus,
  MemoryProviderStatus,
} from "@opencode-chat/core";
import * as vscode from "vscode";
import { type BundledResource, loadBundledResearchResources } from "./bundled-research-resources";
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
import {
  loadMemoryRetentionSettings,
  resolveMemoryRetentionStatus,
  updateMemoryRetentionSettings,
} from "./memory-retention-settings";
import { resolveOpencodeBinary, VscodePlatformServices } from "./vscode-platform-services";

let agent = new OpenCodeAgent();
let sandboxController: ChatSandboxController<ChatSandboxStatus> | undefined;
let memoryProviderStatus: MemoryProviderStatus = {
  id: "none",
  displayName: "No memory provider",
  state: "unavailable",
  capabilities: { retain: false, recall: false, reflect: false },
};
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
  let memoryRetentionSettings = loadMemoryRetentionSettings(workspaceUri);
  const chatMcpPrefs = new VscodeChatMcpPrefsStore(context.workspaceState);
  const sandboxSettings = resolveChatSandboxSettings(workspaceUri);
  const executablePath = resolveOpencodeBinary();
  const resolvedExecutablePath = path.isAbsolute(executablePath) ? executablePath : undefined;
  const extensionPath = context.extensionPath ?? context.extensionUri.fsPath;
  const bundledResourceRoot = path.join(extensionPath, "dist", "skills-commands");
  const bundledResources = await loadBundledResearchResources(bundledResourceRoot);
  const bundledSkills = bundledResources.resources.filter(
    (resource): resource is Extract<BundledResource, { type: "skill" }> => resource.type === "skill",
  );
  const bundledCommands = bundledResources.resources.filter(
    (resource): resource is Extract<BundledResource, { type: "command" }> => resource.type === "command",
  );
  const bundledResourceMetadata: BundledResourceMetadata[] = bundledResources.resources.map((resource) => ({
    source: "bundled",
    type: resource.type,
    name: resource.name,
    description: resource.description,
  }));
  const guidanceOverlay: OpenCodeLaunchConfiguration["guidanceOverlay"] = {
    ...(bundledSkills.length ? { skills: { paths: [path.join(bundledResourceRoot, "skills")] } } : {}),
    ...(bundledCommands.length
      ? {
          command: Object.fromEntries(
            bundledCommands.map((resource) => [
              resource.name,
              { description: resource.description, template: resource.template },
            ]),
          ),
        }
      : {}),
  };
  const openCodePaths = resolveOpenCodePaths();
  let hindsightResolution: Awaited<ReturnType<typeof resolveHindsightPlugin>>;
  let hindsightResolutionFailed = false;
  try {
    const effectiveConfig = readEffectiveOpenCodeConfiguration(openCodePaths.config, workspaceFolder);
    hindsightResolution = await resolveHindsightPlugin(effectiveConfig, readHindsightPackageMetadata);
  } catch {
    hindsightResolutionFailed = true;
    hindsightResolution = undefined;
  }
  // The preflight launch must use the effective lifecycle decision.  It is
  // still only a bounded, approved-provider startup; inventory verification
  // below decides whether the provider remains active.
  let activeHindsightCompanionIntegration =
    hindsightResolution &&
    (memoryRetentionSettings.policy.automaticSessionRetention || memoryRetentionSettings.policy.enabled)
      ? {
          ...hindsightResolution,
          toolPatterns: [] as const,
          automaticSessionRetention: memoryRetentionSettings.policy.automaticSessionRetention,
          environment: memoryRetentionSettings.policy.automaticSessionRetention
            ? ({} as const)
            : { HINDSIGHT_DISABLE_HOOKS: "1" as const },
        }
      : undefined;
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
  const providerReadPaths = () =>
    hindsightResolution
      ? [
          ...(hindsightResolution.packageRoot ? [hindsightResolution.packageRoot] : []),
          ...hindsightResolution.runtimePaths,
          ...hindsightResolution.configurationPaths,
        ]
      : [];
  let currentLaunchProviderBlocked = false;
  let initialLaunchProviderAvailable = true;
  const createLaunchConfiguration = (
    settings: typeof sandboxSettings,
    mcpOverlay = initialMcpOverlay,
    mcpTransport = initialMcpTransport,
    hindsightIntegration:
      | OpenCodeLaunchConfiguration["hindsightCompanionIntegration"]
      | null = activeHindsightCompanionIntegration,
    recordAsInitialLaunch = false,
  ): OpenCodeLaunchConfiguration => {
    const baseInput = {
      workspacePath: workspaceFolder,
      ...(bundledSkills.length ? { packagedSkillDirectory: path.join(bundledResourceRoot, "skills") } : {}),
      openCodePaths,
      runtimeCachePaths,
      temporaryPaths: [openCodePaths.temp],
      executablePath: resolvedExecutablePath,
      executablePaths,
    };
    let providerPathsAvailable = true;
    let filesystemPolicy: OpenCodeLaunchConfiguration["sandbox"]["filesystemPolicy"];
    if (settings.enabled && hindsightIntegration) {
      try {
        filesystemPolicy = buildChatSandboxFilesystemPolicy({ ...baseInput, providerReadPaths: providerReadPaths() });
      } catch {
        providerPathsAvailable = false;
        currentLaunchProviderBlocked = true;
        memoryProviderStatus = blockedHindsightStatus();
        filesystemPolicy = buildChatSandboxFilesystemPolicy(baseInput);
      }
    } else {
      filesystemPolicy = buildChatSandboxFilesystemPolicy(baseInput);
    }
    if (!providerPathsAvailable) currentLaunchProviderBlocked = true;
    else currentLaunchProviderBlocked = false;
    if (recordAsInitialLaunch) initialLaunchProviderAvailable = providerPathsAvailable;
    return {
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
      ...(Object.keys(guidanceOverlay).length ? { guidanceOverlay } : {}),
      memoryRetentionPolicy: memoryRetentionSettings.policy,
      ...(hindsightIntegration && providerPathsAvailable
        ? { hindsightCompanionIntegration: hindsightIntegration }
        : {}),
    };
  };
  const launchConfiguration = createLaunchConfiguration(
    sandboxSettings,
    initialMcpOverlay,
    initialMcpTransport,
    activeHindsightCompanionIntegration,
    true,
  );
  const baseLaunchConfiguration = createLaunchConfiguration(
    sandboxSettings,
    initialMcpOverlay,
    initialMcpTransport,
    null,
  );
  agent = new OpenCodeAgent(launchConfiguration);
  const refreshHindsightIntegration = async (): Promise<void> => {
    if (!hindsightResolution) {
      activeHindsightCompanionIntegration = undefined;
      memoryProviderStatus = noHindsightProviderStatus();
      return;
    }
    try {
      const toolIds = (await agent.getToolIds()).map((tool) => tool.id);
      const observedToolIds = toolIds;
      const detectedStatus = await detectCompanionMemoryProviderFromInventory(observedToolIds);
      const result = buildHindsightCompanionIntegration(
        detectedStatus,
        observedToolIds,
        hindsightResolution,
        memoryRetentionSettings.policy,
      );
      // A lifecycle integration is usable only when the normalized provider
      // status explicitly advertises that capability. Explicit recall/reflect
      // and retention permissions remain governed by the adapter result.
      activeHindsightCompanionIntegration =
        result.integration &&
        (!result.integration.automaticSessionRetention ||
          detectedStatus.capabilities.automaticSessionRetention === true)
          ? result.integration
          : undefined;
      memoryProviderStatus = activeHindsightCompanionIntegration
        ? result.status
        : automaticRetentionUnavailableStatus(result.status);
    } catch {
      activeHindsightCompanionIntegration = undefined;
      memoryProviderStatus = hindsightErrorStatus();
    }
  };
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
      let fallbackConnected = false;
      let connectionError: unknown = error;
      if (activeHindsightCompanionIntegration) {
        agent.disconnect();
        agent = new OpenCodeAgent(baseLaunchConfiguration);
        try {
          await connectAgent(sandboxSettings.enabled);
          fallbackConnected = true;
        } catch (fallbackError) {
          connectionError = fallbackError;
        }
        if (fallbackConnected) {
          connectFailed = false;
        }
      }
      if (!fallbackConnected) {
        const kind = classifyConnectError(connectionError);
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
            error: connectionError instanceof Error ? connectionError.message : String(connectionError),
          };
        }
        if (kind === "database-locked") {
          vscode.window.showErrorMessage(
            vscode.l10n.t(
              "OpenCode Research: Another OpenCode process may be using the project database. Please close other OpenCode instances (e.g., terminal UI) and reload the window.",
            ),
          );
        } else {
          const message = connectionError instanceof Error ? connectionError.message : String(connectionError);
          const truncated = message.length > 500 ? `${message.slice(0, 500)}...` : message;
          vscode.window.showErrorMessage(
            vscode.l10n.t("OpenCode Research: Failed to start OpenCode server. {0}", truncated),
          );
        }
      }
    }
  }

  if (!initialLaunchProviderAvailable) {
    memoryProviderStatus = blockedHindsightStatus();
  } else if (activeHindsightCompanionIntegration && !connectFailed) {
    try {
      const toolIds = await agent.getToolIds();
      const observedToolIds = toolIds.map((tool) => tool.id);
      const detectedStatus = await detectCompanionMemoryProviderFromInventory(observedToolIds);
      const result = buildHindsightCompanionIntegration(
        detectedStatus,
        observedToolIds,
        hindsightResolution,
        memoryRetentionSettings.policy,
      );
      const verifiedIntegration =
        result.integration &&
        (!result.integration.automaticSessionRetention ||
          detectedStatus.capabilities.automaticSessionRetention === true)
          ? result.integration
          : undefined;
      memoryProviderStatus = verifiedIntegration ? result.status : automaticRetentionUnavailableStatus(result.status);
      if (verifiedIntegration) {
        activeHindsightCompanionIntegration = verifiedIntegration;
        await agent.stopForReconnect();
        const finalConfiguration = createLaunchConfiguration(
          sandboxSettings,
          initialMcpOverlay,
          initialMcpTransport,
          result.integration,
        );
        agent.updateLaunchConfiguration(finalConfiguration);
        await connectAgent(sandboxSettings.enabled);
      } else {
        activeHindsightCompanionIntegration = undefined;
        await agent.stopForReconnect();
        agent.updateLaunchConfiguration(
          createLaunchConfiguration(sandboxSettings, initialMcpOverlay, initialMcpTransport, null),
        );
        await connectAgent(sandboxSettings.enabled);
      }
    } catch {
      activeHindsightCompanionIntegration = undefined;
      memoryProviderStatus = hindsightErrorStatus();
      try {
        await agent.stopForReconnect();
        agent.updateLaunchConfiguration(
          createLaunchConfiguration(sandboxSettings, initialMcpOverlay, initialMcpTransport, null),
        );
        await connectAgent(sandboxSettings.enabled);
      } catch {
        // Keep the original connection error handling nonfatal.
      }
    }
  } else if (hindsightResolutionFailed) {
    memoryProviderStatus = hindsightErrorStatus();
  } else {
    memoryProviderStatus = noHindsightProviderStatus();
  }

  let memoryRetentionStatus = resolveMemoryRetentionStatus(memoryRetentionSettings, memoryProviderStatus);

  const platformServices = new VscodePlatformServices();

  let panelUpdateInProgress = false;
  let lastResolvedKey = resolvedSettingsKey(sandboxSettings);
  chatViewProvider = new ChatViewProvider(context.extensionUri, agent, platformServices, {
    chatMcpPrefs,
    memoryProviderStatus,
    memoryRetentionStatus,
    bundledResources: bundledResourceMetadata,
    bundledCommandNames: bundledCommands.map((resource) => resource.name),
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
    setMemoryRetentionPolicy: async (policy) => {
      const previous = memoryRetentionSettings;
      try {
        await updateMemoryRetentionSettings(policy, workspaceUri);
        memoryRetentionSettings = loadMemoryRetentionSettings(workspaceUri);
        memoryRetentionStatus = resolveMemoryRetentionStatus(memoryRetentionSettings, memoryProviderStatus);
        const resolved = resolveChatSandboxSettings(workspaceUri);
        await refreshHindsightIntegration();
        agent.updateLaunchConfiguration(createLaunchConfiguration(resolved));
        await sandboxController?.update(resolved);
        return memoryRetentionStatus;
      } catch {
        memoryRetentionSettings = previous;
        memoryRetentionStatus = resolveMemoryRetentionStatus(memoryRetentionSettings, memoryProviderStatus, true);
        throw new Error("Retention settings could not be updated");
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
      const launchIntegration = activeHindsightCompanionIntegration;
      agent.updateLaunchConfiguration(createLaunchConfiguration(resolved, mcpOverlay, mcpTransport, launchIntegration));
      await connectAgent(resolved.enabled);
      // Inventory is authoritative after every reconnect. If the provider
      // failed or became unsafe, reconnect once on the same requested
      // sandbox mode with the ordinary fallback rather than leaving stale
      // lifecycle state attached to the agent.
      const providerBlockedForLaunch = currentLaunchProviderBlocked;
      if (!providerBlockedForLaunch) await refreshHindsightIntegration();
      if (launchIntegration && !providerBlockedForLaunch && !activeHindsightCompanionIntegration) {
        await agent.stopForReconnect();
        agent.updateLaunchConfiguration(createLaunchConfiguration(resolved, mcpOverlay, mcpTransport, null));
        await connectAgent(resolved.enabled);
      }
      return resolveChatSandboxSettings(workspaceUri);
    },
    publishStatus: (status) => chatViewProvider?.publishChatSandboxStatus(status),
    onReconnected: async (status) => {
      if (currentLaunchProviderBlocked) memoryProviderStatus = blockedHindsightStatus();
      chatViewProvider?.publishMemoryProviderStatus(memoryProviderStatus);
      memoryRetentionStatus = resolveMemoryRetentionStatus(memoryRetentionSettings, memoryProviderStatus);
      chatViewProvider?.publishMemoryRetentionStatus?.(memoryRetentionStatus);
      await chatViewProvider?.refresh(status);
    },
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
      const retentionChanged =
        event.affectsConfiguration("opencode-chat.memoryRetention.enabled", workspaceUri) ||
        event.affectsConfiguration("opencode-chat.memoryRetention.requireConfirmation", workspaceUri) ||
        event.affectsConfiguration("opencode-chat.memoryRetention.automaticSessionRetention", workspaceUri);
      if (!chatChanged && !nativeChanged && !retentionChanged) return;
      if (panelUpdateInProgress) return;

      const resolved = resolveChatSandboxSettings(workspaceUri);
      if (retentionChanged && !chatChanged && !nativeChanged) {
        memoryRetentionSettings = loadMemoryRetentionSettings(workspaceUri);
        memoryRetentionStatus = resolveMemoryRetentionStatus(memoryRetentionSettings, memoryProviderStatus);
        void (async () => {
          await refreshHindsightIntegration();
          await sandboxController?.update(resolved);
        })().catch((error) => {
          console.error("[OpenCode] Failed to apply memory retention configuration change:", error);
        });
        return;
      }
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

export function getMemoryProviderStatus(): MemoryProviderStatus {
  return memoryProviderStatus;
}

async function safelyDetectMemoryProvider(
  context: Parameters<typeof detectMemoryProvider>[0],
): Promise<MemoryProviderStatus> {
  try {
    return await detectMemoryProvider(context);
  } catch {
    return {
      id: "hindsight",
      displayName: "Hindsight",
      state: "error",
      capabilities: { retain: false, recall: false, reflect: false },
      reason: "Provider detection failed",
    };
  }
}

function noHindsightProviderStatus(): MemoryProviderStatus {
  return {
    id: "none",
    displayName: "No memory provider",
    state: "unavailable",
    capabilities: { retain: false, recall: false, reflect: false },
  };
}

async function detectCompanionMemoryProviderFromInventory(toolIds: readonly string[]): Promise<MemoryProviderStatus> {
  return safelyDetectMemoryProvider({
    hindsight: {
      configured: true,
      probe: async () => ({
        reachable: true,
        capabilities: {
          retain: toolIds.includes("hindsight_ingest_document"),
          recall: [
            "hindsight_search_knowledge_pages",
            "hindsight_list_knowledge_pages",
            "hindsight_read_knowledge_page",
          ].every((id) => toolIds.includes(id)),
          reflect: toolIds.includes("hindsight_reflect"),
          // The exact approved companion inventory is the lifecycle-support
          // verification gate. No provider operation is performed here.
          automaticSessionRetention: true,
        },
      }),
    },
  });
}

function blockedHindsightStatus(): MemoryProviderStatus {
  return {
    id: "hindsight",
    displayName: "Hindsight",
    state: "blocked",
    capabilities: { retain: false, recall: false, reflect: false },
    reason: "Provider blocked by companion policy",
  };
}

function hindsightErrorStatus(): MemoryProviderStatus {
  return {
    id: "hindsight",
    displayName: "Hindsight",
    state: "error",
    capabilities: { retain: false, recall: false, reflect: false },
    reason: "Provider detection failed",
  };
}

function automaticRetentionUnavailableStatus(status: MemoryProviderStatus): MemoryProviderStatus {
  return {
    ...status,
    capabilities: { ...status.capabilities, automaticSessionRetention: false },
    automaticSessionRetention: { state: "unavailable", reason: "No usable retention provider is available" },
  };
}

function resolvedSettingsKey(settings: { mode: string; enabled: boolean; allowNetwork: boolean }): string {
  return JSON.stringify({
    enabled: settings.enabled,
    allowNetwork: settings.enabled ? settings.allowNetwork : true,
  });
}
