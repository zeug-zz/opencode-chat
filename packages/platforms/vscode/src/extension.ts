import * as path from "node:path";
import {
  buildHindsightCompanionIntegration,
  buildMcpOverlay,
  detectMemoryProvider,
  OpenCodeAgent,
  type OpenCodeLaunchConfiguration,
  RESTRICTED_REVIEW_MAX_STEPS,
  RESTRICTED_REVIEW_PROMPT,
  type RestrictedReviewModel,
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
  ReasoningReviewRuntime,
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
import { DEFAULT_MEMORY_RETENTION_SETTINGS, resolveMemoryRetentionStatus } from "./memory-retention-settings";
import { promptForInitialNonoProfile, readSelectedNonoProfile, selectNonoProfile } from "./nono-profile-settings";
import { discoverNonoProfiles, type NonoResolution, resolveNonoBackend } from "./nono-resolver";
import {
  type AvailablePrivateRelease,
  abandonLocalInstaller,
  checkForPrivateReleaseUpdates,
  downloadAndValidatePrivateRelease,
} from "./private-release-updater";
import { resolveAfRuntime } from "./vibefeld/af-runtime-resolution";
import { ClaimProjectionReasoningReviewController } from "./vibefeld/claim-projection-reasoning-review-controller";
import { createCurrentVibefeldClaimProjectionSeam } from "./vibefeld/current-vibefeld-claim-projection";
import { HIDDEN_SESSION_MARKER_PREFIX } from "./vibefeld/hidden-session-registry";
import {
  createReasoningAssistStructureRecorder,
  type ReasoningAssistStructureRecorder,
} from "./vibefeld/reasoning-assist-structure-recorder";
import type { IReasoningReviewController } from "./vibefeld/reasoning-review-controller";
import type { ReasoningAssistRestrictedReviewAdapter } from "./vibefeld/restricted-review-adapter";
import {
  DORMANT_REASONING_REVIEW_RUNTIME,
  deriveReasoningReviewRuntime,
  PREFLIGHT_FAILED_REASONING_REVIEW_RUNTIME,
  RuntimeReportingReasoningReviewController,
} from "./vibefeld/runtime-reporting-reasoning-review-controller";
import { UnavailableReasoningReviewController } from "./vibefeld/unavailable-reasoning-review-controller";
import {
  createVibefeldActivation,
  teardownVibefeldActivation,
  type VibefeldActivationComposition,
} from "./vibefeld/vibefeld-activation";
import {
  readVibefeldAfPath,
  readVibefeldPreference,
  updateVibefeldEnabled,
  updateVibefeldWorkspaceOptOut,
} from "./vibefeld/vibefeld-settings";
import { resolveOpencodeBinary, VscodePlatformServices } from "./vscode-platform-services";

let agent!: OpenCodeAgent;
let restrictedReviewDisposal: (() => Promise<void>) | undefined;
let reasoningAssistDisposal: (() => void) | undefined;
let resolvedRestrictedReviewModel: RestrictedReviewModel | undefined;
let chatInitialization: Promise<ChatViewProvider | undefined> | undefined;
let sandboxController: ChatSandboxController<ChatSandboxStatus> | undefined;
let memoryProviderStatus: MemoryProviderStatus = {
  id: "none",
  displayName: "No memory provider",
  state: "unavailable",
  capabilities: { retain: false, recall: false, reflect: false },
};
const MCP_INVENTORY_ERROR_MESSAGE =
  "OpenCode Scribe could not resolve its MCP inventory. Repair the OpenCode configuration and reload the extension.";
const MAX_STARTUP_HIDDEN_SESSION_SCAVENGE = 8;

class McpInventoryError extends Error {
  constructor() {
    super(MCP_INVENTORY_ERROR_MESSAGE);
    this.name = "McpInventoryError";
  }
}

// Extension Host プロセスが強制終了された場合でもサーバーを停止する
process.on("exit", () => agent?.disconnect());

export async function activate(context: vscode.ExtensionContext) {
  // VS Code always supplies extension/globalState. The compatibility branch
  // keeps lightweight host-test contexts working without weakening the real
  // lazy lifecycle.
  if (!context.extension && !context.globalState) {
    const provider = await initializeChat(context);
    if (!provider) return;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider));
    return;
  }

  const installedVersion = context.extension?.packageJSON?.version ?? "0.0.0";
  const globalState = context.globalState ?? {
    get: () => undefined,
    update: async () => undefined,
  };
  const offerUpdate = async (release: AvailablePrivateRelease) => {
    const action = await vscode.window.showInformationMessage(
      `OpenCode Scribe update available: ${release.version}`,
      "Update",
      "View Release",
    );
    if (action === "View Release") {
      await vscode.env.openExternal(vscode.Uri.parse("https://github.com/zeug-zz/opencode-chat/releases"));
      return;
    }
    if (action !== "Update") return;

    let installerUri: Awaited<ReturnType<typeof downloadAndValidatePrivateRelease>>;
    try {
      installerUri = await downloadAndValidatePrivateRelease(release, context.globalStorageUri, {
        uriFactory: (filePath) => vscode.Uri.file(filePath),
      });
      if (!installerUri) throw new Error("release artifact validation failed");
      await vscode.commands.executeCommand("workbench.extensions.installExtension", installerUri);
    } catch {
      vscode.window.showWarningMessage("OpenCode Scribe could not install the update. Try again later.");
      return;
    } finally {
      if (installerUri) await abandonLocalInstaller(installerUri);
    }

    const reloadAction = await vscode.window.showInformationMessage(
      "OpenCode Scribe was updated. Restart VS Code to finish.",
      "Restart VS Code",
    );
    if (reloadAction !== "Restart VS Code") return;
    try {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    } catch {
      vscode.window.showWarningMessage("OpenCode Scribe could not restart VS Code. Try again manually.");
    }
  };
  const checkForUpdates = (manual = false) =>
    checkForPrivateReleaseUpdates({
      installedVersion,
      globalState,
      manual,
      announce: (release) => {
        void offerUpdate(release).catch(() => {
          vscode.window.showWarningMessage("OpenCode Scribe could not complete the update prompt. Try again later.");
        });
      },
      reportNoUpdate: manual
        ? () => {
            vscode.window.showInformationMessage("OpenCode Scribe is up to date.");
          }
        : undefined,
      reportFailure: manual
        ? () => {
            vscode.window.showWarningMessage("OpenCode Scribe could not check for updates.");
          }
        : undefined,
    });
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-chat.checkForUpdates", () => checkForUpdates(true)),
  );
  void checkForUpdates().catch(() => undefined);

  const lazyChatProvider = new LazyChatViewProvider(() => {
    chatInitialization ??= initializeChat(context);
    return chatInitialization;
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, lazyChatProvider));
}

async function initializeChat(context: vscode.ExtensionContext): Promise<ChatViewProvider | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(vscode.l10n.t("OpenCode Scribe requires an open workspace folder."));
    return;
  }

  const workspaceUri = vscode.Uri.file(workspaceFolder);
  const memoryRetentionSettings = DEFAULT_MEMORY_RETENTION_SETTINGS;
  const chatMcpPrefs = new VscodeChatMcpPrefsStore(context.workspaceState);
  const sandboxSettings = resolveChatSandboxSettings(workspaceUri);
  const storedNonoProfile = readSelectedNonoProfile(workspaceUri);
  let initialCustomProfiles: string[] = [];
  if (
    sandboxSettings.enabled &&
    !storedNonoProfile &&
    (process.platform === "darwin" || process.platform === "linux")
  ) {
    initialCustomProfiles = await discoverNonoProfiles();
  }
  let selectedLaunchResolution: NonoResolution = await resolveNonoBackend(sandboxSettings.enabled, {
    selectedProfile: storedNonoProfile,
  });
  let selectedLaunchBackend = selectedLaunchResolution.backend;
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
  let inheritedPluginSources: OpenCodeLaunchConfiguration["pluginSources"] = [];
  let hindsightResolution: Awaited<ReturnType<typeof resolveHindsightPlugin>>;
  let resolvedModel: string | undefined;
  let hindsightResolutionFailed = false;
  try {
    const effectiveConfig = readEffectiveOpenCodeConfiguration(openCodePaths.config, workspaceFolder);
    resolvedModel = effectiveConfig.model;
    inheritedPluginSources = (effectiveConfig.plugin ?? []) as OpenCodeLaunchConfiguration["pluginSources"];
    hindsightResolution = await resolveHindsightPlugin(effectiveConfig, readHindsightPackageMetadata);
  } catch {
    hindsightResolutionFailed = true;
    hindsightResolution = undefined;
  }
  resolvedRestrictedReviewModel = parseRestrictedReviewModel(resolvedModel);
  // The preflight launch must keep provider hooks disabled. Exact observed
  // inventory verification below is the gate that activates lifecycle
  // retention on the final launch.
  let activeHindsightCompanionIntegration =
    hindsightResolution &&
    (memoryRetentionSettings.policy.automaticSessionRetention || memoryRetentionSettings.policy.enabled)
      ? {
          ...hindsightResolution,
          toolPatterns: [] as const,
          automaticSessionRetention: false,
          environment: { HINDSIGHT_DISABLE_HOOKS: "1" as const },
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
      backend: selectedLaunchBackend,
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
      ...(inheritedPluginSources.length ? { pluginSources: inheritedPluginSources } : {}),
      mcpOverlay: { mcp: mcpOverlay.mcp },
      mcpTransport,
      ...(Object.keys(guidanceOverlay).length ? { guidanceOverlay } : {}),
      memoryRetentionPolicy: memoryRetentionSettings.policy,
      ...(selectedLaunchResolution.backend === "nono" &&
      selectedLaunchResolution.executablePath &&
      selectedLaunchResolution.profile
        ? {
            nono: {
              executablePath: selectedLaunchResolution.executablePath,
              profile: selectedLaunchResolution.profile,
            },
          }
        : {}),
      ...(hindsightIntegration && providerPathsAvailable
        ? { hindsightCompanionIntegration: hindsightIntegration }
        : {}),
      ...(resolvedRestrictedReviewModel
        ? {
            restrictedReview: {
              model: `${resolvedRestrictedReviewModel.providerID}/${resolvedRestrictedReviewModel.modelID}`,
              prompt: RESTRICTED_REVIEW_PROMPT,
              maxSteps: RESTRICTED_REVIEW_MAX_STEPS,
            },
          }
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
        selectedLaunchBackend,
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
    if (message.startsWith("Inherited OpenCode plugins were unavailable during startup")) {
      vscode.window.showWarningMessage(vscode.l10n.t("OpenCode Scribe: {0}", message));
      return;
    }
    const sandboxStatus: ChatSandboxStatus = status ?? {
      ...sandboxSettings,
      enabled: false,
      applying: false,
      error: message,
    };
    initialSandboxStatus = sandboxStatus;
    chatViewProvider?.publishChatSandboxStatus(sandboxStatus);
    vscode.window.showErrorMessage(vscode.l10n.t("OpenCode Scribe: {0}", message));
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
      await scavengeLeftoverRestrictedReviewSessions();
    } catch (error) {
      const kind = classifyConnectError(error);
      if (kind === "not-found") {
        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'OpenCode Scribe: "opencode" command not found. Please install OpenCode first: https://github.com/anomalyco/opencode',
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
            "OpenCode Scribe: Another OpenCode process may be using the project database. Please close other OpenCode instances (e.g., terminal UI) and reload the window.",
          ),
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const truncated = message.length > 500 ? `${message.slice(0, 500)}...` : message;
        vscode.window.showErrorMessage(
          vscode.l10n.t("OpenCode Scribe: Failed to start OpenCode server. {0}", truncated),
        );
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
        selectedLaunchBackend,
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

  const memoryRetentionStatus = resolveMemoryRetentionStatus(memoryRetentionSettings, memoryProviderStatus);

  // Host-private runtime resolution. Discovery runs once here and the
  // composition stays dormant unless the resolution is ready, so no executable
  // resolver or direct-execution adapter is ever supplied to a dormant host.
  //
  // A context without extension global storage cannot compose at all, so the
  // host resolution is skipped there rather than running a bounded process for
  // a composition that stays dormant.
  const globalStoragePath = context.globalStorageUri?.fsPath ?? "";
  const afRuntimeResolution = globalStoragePath
    ? await (async () => {
        const explicitExecutable = readVibefeldAfPath(workspaceUri);
        return explicitExecutable ? resolveAfRuntime({ explicitExecutable }) : resolveAfRuntime();
      })()
    : undefined;

  // Host-private activation composition. Construction is dormant and free of
  // side effects; preflight and controller selection are separate steps. A
  // lightweight host-test context may omit global storage, which keeps the
  // composition dormant instead of failing activation.
  const vibefeldActivation = createVibefeldActivation({
    globalStoragePath,
    repositoryPath: workspaceFolder,
    ...(afRuntimeResolution?.state === "ready"
      ? {
          resolveExecutable: afRuntimeResolution.resolveExecutable,
          policy: afRuntimeResolution.policy,
        }
      : {}),
  });
  context.subscriptions.push(
    new vscode.Disposable(() => {
      void teardownVibefeldActivation(vibefeldActivation).catch(() => undefined);
    }),
  );

  const platformServices = new VscodePlatformServices();
  // Dynamic selection: the composition above is constructed once and this is
  // the only bridge preflight of the extension activation. Ordinary messages,
  // session switches, and later view resolves reuse the injected controller.
  const {
    controller: reasoningReviewController,
    reasoningAssistAdapter,
    reasoningAssistStructureRecorder,
  } = await selectReasoningReviewDependencies(vibefeldActivation);
  const reasoningReviewPreference = {
    read: () => readVibefeldPreference(workspaceUri),
    setUserEnabled: (value: boolean) => updateVibefeldEnabled(value, workspaceUri),
    setWorkspaceOptOut: (value: boolean) => updateVibefeldWorkspaceOptOut(value, workspaceUri),
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-chat.selectNonoProfile", () => selectNonoProfile(workspaceUri)),
  );

  let panelUpdateInProgress = false;
  let lastResolvedKey = resolvedSettingsKey(sandboxSettings);
  chatViewProvider = new ChatViewProvider(context.extensionUri, agent, platformServices, {
    chatMcpPrefs,
    memoryProviderStatus,
    memoryRetentionStatus,
    reasoningReviewController,
    // Host-private reasoning-assist dependencies selected by the single
    // activation composition above; both are optional and the assist stays
    // dormant whenever either is absent.
    ...(reasoningAssistAdapter ? { reasoningAssistAdapter } : {}),
    ...(reasoningAssistStructureRecorder ? { reasoningAssistStructureRecorder } : {}),
    // Availability-gated preference seam: the user toggle writes the Global
    // target and the workspace opt-out writes the Workspace target for this
    // workspace. Reads and writes stay within the two bounded boolean keys.
    reasoningReviewPreference,
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
  });
  // The assist preflight holds host-private lifecycle state: deactivation must
  // stop every in-flight preflight before adapters and sessions are torn down.
  reasoningAssistDisposal = () => chatViewProvider?.cancelAllReasoningAssistWork();
  sandboxController = new ChatSandboxController<ChatSandboxStatus>({
    stop: () => agent.stopForReconnect(),
    start: async (settings) => {
      const resolved = resolveChatSandboxSettings(workspaceUri);
      // Re-resolve only when a new settings transition creates a connection;
      // reconnects within that connection retain the selected discriminant.
      selectedLaunchResolution = await resolveNonoBackend(resolved.enabled, {
        selectedProfile: readSelectedNonoProfile(workspaceUri),
      });
      selectedLaunchBackend = selectedLaunchResolution.backend;
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
      await chatViewProvider?.refresh(status);
    },
    onError: (error, status) => reportSandboxError(error, status),
  });
  chatViewProvider.publishChatSandboxStatus(initialSandboxStatus);
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
      const nonoChanged = event.affectsConfiguration("opencode-chat.nono.profile", workspaceUri);
      if (!chatChanged && !nativeChanged && !nonoChanged) return;
      if (panelUpdateInProgress) return;

      const resolved = resolveChatSandboxSettings(workspaceUri);
      if (nativeChanged && !chatChanged && !nonoChanged && resolved.mode !== "inherit") return;
      const nextKey = resolvedSettingsKey(resolved);
      if (nextKey === lastResolvedKey && !nonoChanged) return;
      lastResolvedKey = nextKey;
      void sandboxController?.update(resolved).catch((error) => {
        console.error("[OpenCode] Failed to apply sandbox configuration change:", error);
      });
    }),
  );

  // Start the optional picker only after the connection and its setting
  // listener exist, so an explicit custom choice can reconnect immediately.
  if (initialCustomProfiles.length > 0) {
    void promptForInitialNonoProfile(workspaceUri, initialCustomProfiles).catch(() => undefined);
  }

  // When connectFailed is true (database-locked or other non-ENOENT), the agent
  // has no client. The webview provider is still registered so the sidebar is
  // not an infinite spinner. The ready handler will throw from agent methods
  // (getPath, listSessions, etc.) with "OpenCode client is not connected".
  // Those errors are caught by ChatViewProvider.handleWebviewMessage and
  // logged. The webview shows an error surface rather than hanging silently.
  return chatViewProvider;
}

async function scavengeLeftoverRestrictedReviewSessions(): Promise<void> {
  try {
    const sessions = await agent.listSessions();
    let deleted = 0;
    for (const session of sessions) {
      if (deleted >= MAX_STARTUP_HIDDEN_SESSION_SCAVENGE) break;
      if (!session.title?.startsWith(HIDDEN_SESSION_MARKER_PREFIX)) continue;
      try {
        await agent.deleteSession(session.id);
        deleted += 1;
      } catch {
        // Startup scavenging is best effort and must not block activation.
      }
    }
  } catch {
    // A failed session listing is nonfatal; no configuration is changed.
  }
}

/**
 * Bounded runtime status for a ready runtime whose bridge reports no supported
 * claim operation. Availability is never published from compatibility or
 * direct-execution readiness alone.
 */
const CLAIM_CAPABILITY_UNAVAILABLE_REASONING_REVIEW_RUNTIME: ReasoningReviewRuntime = {
  state: "unavailable",
  reason: "claim-capability-unavailable",
};

/**
 * The bounded set of host-private review dependencies selected by the single
 * activation composition. The assist dependencies stay optional and are
 * omitted whenever their runtime gate fails.
 */
type ReasoningReviewSelection = Readonly<{
  controller: IReasoningReviewController;
  reasoningAssistAdapter?: ReasoningAssistRestrictedReviewAdapter;
  reasoningAssistStructureRecorder?: ReasoningAssistStructureRecorder;
}>;

/**
 * Runs the one bounded activation preflight and selects the review
 * dependencies. A dormant composition is never inspected. A composed bridge is
 * preflighted exactly once, and the claim seam is then constructed once from
 * the settled preflight without touching the bridge. Only a ready preflight
 * whose seam reports an explicitly supported claim operation selects the
 * claim-projection controller; a ready runtime without that capability keeps
 * the unavailable controller and publishes the bounded
 * `claim-capability-unavailable` status, so `available` is never published
 * without a supported claim operation. Any preflight or construction failure
 * is nonfatal and bounded: no raw error or host path escapes, and the dormant
 * unavailable controller stays injected. The published runtime status is fixed
 * from this single outcome, so later status reads never re-preflight,
 * discover, or spawn.
 *
 * The readiness-gated restricted-provider attempt runs independently of the
 * claim-path selection: a ready provider always builds the host-private
 * adapter and registers its disposal, the adapter is injected for the
 * reasoning-assist only when the preflight is ready, and the adversarial
 * controller is selected exactly when no claim controller was selected. The
 * structure recorder is built from the already-preflighted claim seam only
 * when its single guarded capability read reports support. Every attempt
 * failure is fail-closed and never changes the controller fallback.
 */
async function selectReasoningReviewDependencies(
  composition: VibefeldActivationComposition,
  options: RestrictedReviewSelectionOptions = {},
): Promise<ReasoningReviewSelection> {
  let runtime: ReasoningReviewRuntime =
    composition.state === "composed" ? PREFLIGHT_FAILED_REASONING_REVIEW_RUNTIME : DORMANT_REASONING_REVIEW_RUNTIME;
  let claimAvailable = false;
  let preflightReady = false;
  let claimSeam: ReturnType<typeof createCurrentVibefeldClaimProjectionSeam> | undefined;
  try {
    if (composition.state === "composed") {
      const preflight = await composition.bridge.preflight();
      if (preflight.state === "ready") {
        preflightReady = true;
        claimSeam = createCurrentVibefeldClaimProjectionSeam(composition.bridge);
        claimAvailable = claimSeam.getCapability().supported;
        runtime = claimAvailable
          ? deriveReasoningReviewRuntime(preflight)
          : CLAIM_CAPABILITY_UNAVAILABLE_REASONING_REVIEW_RUNTIME;
      } else {
        runtime = deriveReasoningReviewRuntime(preflight);
      }
    }
  } catch {
    // A rejected preflight is nonfatal; the bounded failure status stays.
  }

  let controller: IReasoningReviewController | undefined;
  if (claimAvailable && claimSeam) {
    controller = new RuntimeReportingReasoningReviewController(
      new ClaimProjectionReasoningReviewController(claimSeam),
      runtime,
    );
  }

  let reasoningAssistAdapter: ReasoningAssistRestrictedReviewAdapter | undefined;
  try {
    const model = options.model ?? resolvedRestrictedReviewModel;
    const createProvider =
      options.createProvider ??
      ((pinnedModel: RestrictedReviewModel) => agent?.createRestrictedReviewProvider(pinnedModel));
    const provider = model ? createProvider(model) : undefined;
    if (provider && (await provider.checkReadiness())) {
      // Keep the adversarial implementation dormant-by-construction when no
      // host-pinned model/provider exists on the current host.
      const [
        { AdversarialReviewReasoningReviewController },
        { createAdversarialReviewSeam },
        { createRestrictedReviewAdapter },
      ] = await Promise.all([
        import("./vibefeld/adversarial-review-reasoning-review-controller"),
        import("./vibefeld/adversarial-review-seam"),
        import("./vibefeld/restricted-review-adapter"),
      ]);
      const adapter = createRestrictedReviewAdapter({ provider });
      // Every constructed adapter owns host-private lifecycle state, so its
      // disposal is registered whether it is injected for the assist or only
      // selected behind the adversarial fallback controller.
      restrictedReviewDisposal = adapter.dispose;
      if (preflightReady) reasoningAssistAdapter = adapter;
      if (!controller) {
        const seam = createAdversarialReviewSeam(adapter);
        if (seam.getCapability().supported) {
          controller = new RuntimeReportingReasoningReviewController(
            new AdversarialReviewReasoningReviewController(seam, {
              readinessCheck: () => provider.checkReadiness(),
            }),
            { state: "available" },
          );
        }
      }
    }
  } catch {
    // Restricted review is optional and fails closed.
    reasoningAssistAdapter = undefined;
  }

  let reasoningAssistStructureRecorder: ReasoningAssistStructureRecorder | undefined;
  try {
    // The seam capability is read exactly once above; a throw or unsupported
    // report leaves the recorder absent instead of failing activation.
    reasoningAssistStructureRecorder =
      claimSeam && claimAvailable ? createReasoningAssistStructureRecorder(claimSeam) : undefined;
  } catch {
    reasoningAssistStructureRecorder = undefined;
  }

  return {
    controller:
      controller ?? new RuntimeReportingReasoningReviewController(new UnavailableReasoningReviewController(), runtime),
    reasoningAssistAdapter,
    reasoningAssistStructureRecorder,
  };
}

type RestrictedReviewSelectionOptions = Readonly<{
  model?: RestrictedReviewModel;
  createProvider?: (model: RestrictedReviewModel) => ReturnType<OpenCodeAgent["createRestrictedReviewProvider"]>;
}>;

function parseRestrictedReviewModel(value: string | undefined): RestrictedReviewModel | undefined {
  if (
    !value ||
    value.length > 256 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  const providerID = value.slice(0, separator);
  const modelID = value.slice(separator + 1);
  if (!providerID || !modelID || providerID.length > 128 || modelID.length > 256) return undefined;
  return { providerID, modelID };
}

class LazyChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly resolveProvider: () => Promise<ChatViewProvider | undefined>) {}

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const provider = await this.resolveProvider();
    provider?.resolveWebviewView(webviewView, context, token);
  }
}

export async function deactivate() {
  sandboxController = undefined;
  // Stop host-private assist work before restricted children and the agent
  // connection are torn down; a provider without in-flight work is a no-op.
  const disposeAssist = reasoningAssistDisposal;
  reasoningAssistDisposal = undefined;
  if (disposeAssist) {
    try {
      disposeAssist();
    } catch {
      // Assist cleanup is best effort during shutdown.
    }
  }
  const dispose = restrictedReviewDisposal;
  restrictedReviewDisposal = undefined;
  if (dispose) {
    try {
      await dispose();
    } catch {
      // Restricted child cleanup is best effort during shutdown.
    }
  }
  agent?.disconnect();
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
