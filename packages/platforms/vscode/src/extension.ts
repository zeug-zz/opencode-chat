import * as path from "node:path";
import {
  buildHindsightCompanionIntegration,
  buildMcpOverlay,
  detectMemoryProvider,
  OpenCodeAgent,
  type OpenCodeLaunchConfiguration,
  RESTRICTED_REVIEW_MAX_STEPS,
  RESTRICTED_REVIEW_PROMPT,
  type RestrictedReviewProvider,
  readEffectiveOpenCodeConfiguration,
  readHindsightPackageMetadata,
  resolveHindsightPlugin,
  resolveMcpInventory,
} from "@opencode-chat/agent-opencode";
import type {
  AppPaths,
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
  type LocalInstallerUri,
} from "./private-release-updater";
import { resolveBundledScribeContextPlugin } from "./scribe-context-plugin";
import { resolveAfRuntime } from "./vibefeld/af-runtime-resolution";
import { ClaimProjectionReasoningReviewController } from "./vibefeld/claim-projection-reasoning-review-controller";
import type { ClaimProjectionSeam } from "./vibefeld/claim-projection-seam";
import { createCurrentVibefeldClaimProjectionSeam } from "./vibefeld/current-vibefeld-claim-projection";
import { HIDDEN_SESSION_MARKER_PREFIX } from "./vibefeld/hidden-session-registry";
import {
  createReasoningAssistStructureRecorder,
  type ReasoningAssistStructureRecorder,
} from "./vibefeld/reasoning-assist-structure-recorder";
import {
  createReasoningDiagnosticClock,
  createReasoningDiagnosticReporter,
  elapsedReasoningMilliseconds,
  type ReasoningDiagnosticReporter,
} from "./vibefeld/reasoning-diagnostics";
import type { IReasoningReviewController } from "./vibefeld/reasoning-review-controller";
import { type RestrictedReviewBinding, RestrictedReviewHolder } from "./vibefeld/restricted-review-holder";
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
let restrictedReviewHolder: RestrictedReviewHolder | undefined;
let chatInitialization: Promise<ChatViewProvider | undefined> | undefined;
let sandboxController: ChatSandboxController<ChatSandboxStatus> | undefined;
let disposeHostDiagnosticChannel: (() => void) | undefined;
let memoryProviderStatus: MemoryProviderStatus = {
  id: "none",
  displayName: "No memory provider",
  state: "unavailable",
  capabilities: { retain: false, recall: false, reflect: false },
};
const MCP_INVENTORY_ERROR_MESSAGE =
  "OpenCode Scribe could not resolve its MCP inventory. Repair the OpenCode configuration and reload the extension.";
const MAX_STARTUP_HIDDEN_SESSION_SCAVENGE = 8;
// Keep the host fail-closed bound just beyond the adapter's bounded 18-second activation barrier.
const HINDSIGHT_TOOL_INVENTORY_TIMEOUT_MS = 20_000;
const SAFE_DIAGNOSTIC_PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_SAFE_CONNECTION_ERROR_LENGTH = 320;
const SAFE_PRIVATE_V2_STARTUP_ERROR =
  /^Private OpenCode V2 startup failed \((?:spawn-error|early-exit|output-limit|readiness-timeout|malformed-output|non-loopback-endpoint|authentication-failed|identity-mismatch|version-mismatch|location-mismatch|redirect-rejected|readiness-failed|cleanup-failed)\); child output and credentials were discarded\.(?: Scribe requires stable OpenCode V2 >=\d{1,4}\.\d{1,4}\.\d{1,4} and <\d{1,4}\.\d{1,4}\.\d{1,4}; update OpenCode or Scribe\.)?$/;
const SAFE_AVAILABILITY_FAILURES = new Set([
  "Private OpenCode companion exited unexpectedly; Chat is unavailable.",
  "OpenCode event stream disconnected; Chat is unavailable.",
  "Private OpenCode companion cleanup failed; availability is uncertain.",
]);
const GENERIC_CONNECTION_FAILURE =
  "OpenCode Scribe could not connect to its private OpenCode server. Check the OpenCode Scribe output for a bounded diagnostic, then retry.";
const DATABASE_LOCKED_CONNECTION_FAILURE =
  "Another OpenCode process may be using the project database. Close other OpenCode instances and reconnect.";

type LaunchDiagnosticTransition = "initial" | "settings";
type LaunchDiagnosticStage = "started" | "ready" | "failed";
type DiagnosticLevel = "info" | "warn" | "error";
type HostDiagnosticSink = (level: DiagnosticLevel, message: string) => void;

function createHostDiagnosticSink(context: vscode.ExtensionContext): HostDiagnosticSink | undefined {
  let channel: vscode.LogOutputChannel;
  try {
    channel = vscode.window.createOutputChannel("OpenCode Scribe", { log: true });
  } catch {
    return undefined;
  }

  let disposed = false;
  let disposable: vscode.Disposable;
  try {
    disposable = new vscode.Disposable(() => {
      if (disposed) return;
      disposed = true;
      try {
        channel.dispose();
      } catch {
        // Disposing diagnostics must not affect extension shutdown.
      }
    });
    context.subscriptions.push(disposable);
  } catch {
    try {
      channel.dispose();
    } catch {
      // The optional log channel is best effort.
    }
    return undefined;
  }

  const dispose = () => {
    try {
      disposable.dispose();
    } catch {
      // The output channel is optional and shutdown is best effort.
    }
  };
  disposeHostDiagnosticChannel = dispose;
  return (level, message) => {
    if (disposed) return;
    try {
      if (level === "error") channel.error(message);
      else if (level === "warn") channel.warn(message);
      else channel.info(message);
    } catch {
      // Logging failures never change launch or prompt behavior.
    }
  };
}

function emitHostDiagnostic(sink: HostDiagnosticSink | undefined, level: DiagnosticLevel, message: string): void {
  try {
    if (sink) {
      sink(level, message);
      return;
    }
  } catch {
    // Fall back to the bounded console diagnostic if host logging is unavailable.
  }
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.info(message);
}

function diagnosticBackend(value: unknown): "sdk" | "vscode" | "nono" | "unknown" {
  return value === "sdk" || value === "vscode" || value === "nono" ? value : "unknown";
}

function diagnosticPreflight(value: unknown): string {
  switch (value) {
    case "disabled":
    case "unsupported-platform":
    case "resolved-and-preflighted":
    case "missing-executable":
    case "non-executable":
    case "preflight-failed":
    case "preflight-unsupported":
      return value;
    default:
      return "unknown";
  }
}

function diagnosticProfile(value: unknown, sandboxEnabled: boolean): string {
  if (!sandboxEnabled) return "not-selected";
  const profile = value ?? "opencode";
  return typeof profile === "string" &&
    SAFE_DIAGNOSTIC_PROFILE_NAME.test(profile) &&
    profile !== "." &&
    profile !== ".."
    ? profile
    : "redacted";
}

function logLaunchDiagnostic(
  fields: {
    attempt: number;
    transition: LaunchDiagnosticTransition;
    stage: LaunchDiagnosticStage;
    backend: unknown;
    preflight: unknown;
    profile: unknown;
    sandboxEnabled: boolean;
    binaryResolved: boolean;
    workspace: "selected" | "location-bound";
    containment: "nono-selected" | "vscode-selected" | "none";
    hindsight: "approved-descriptor" | "ignored-descriptor" | "absent";
  },
  sink?: HostDiagnosticSink,
): void {
  const line =
    `[OpenCode] companion launch attempt=${fields.attempt} transition=${fields.transition} stage=${fields.stage}` +
    ` backend=${diagnosticBackend(fields.backend)} preflight=${diagnosticPreflight(fields.preflight)}` +
    ` profile=${diagnosticProfile(fields.profile, fields.sandboxEnabled)}` +
    ` binary=${fields.binaryResolved ? "absolute-resolved" : "command-fallback"}` +
    ` workspace=${fields.workspace} containment-requested=${fields.containment}` +
    ` hindsight=${fields.hindsight}${fields.stage === "failed" ? " failure=connect-failed" : ""}`;
  emitHostDiagnostic(sink, fields.stage === "failed" ? "error" : "info", line);
}

/**
 * Plugin activation is a bounded optional startup probe. If it does not finish,
 * callers fail the provider closed and reconnect on the already-selected backend
 * without the unverified Hindsight integration.
 */
async function awaitHindsightToolInventory<T>(inventory: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(inventory),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Hindsight plugin activation timed out.")),
          HINDSIGHT_TOOL_INVENTORY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class McpInventoryError extends Error {
  constructor() {
    super(MCP_INVENTORY_ERROR_MESSAGE);
    this.name = "McpInventoryError";
  }
}

function safeConnectionFailure(error: unknown): string {
  if (error instanceof McpInventoryError) return MCP_INVENTORY_ERROR_MESSAGE;
  if (!(error instanceof Error)) return GENERIC_CONNECTION_FAILURE;

  const kind = classifyConnectError(error);
  if (kind === "not-found") return "OpenCode executable was not found. Install OpenCode, then reconnect.";
  if (kind === "database-locked") return DATABASE_LOCKED_CONNECTION_FAILURE;
  if (error.message.length <= MAX_SAFE_CONNECTION_ERROR_LENGTH && SAFE_PRIVATE_V2_STARTUP_ERROR.test(error.message)) {
    return error.message;
  }
  if (SAFE_AVAILABILITY_FAILURES.has(error.message)) return error.message;
  return GENERIC_CONNECTION_FAILURE;
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
        uriFactory: (filePath) => {
          const uri = vscode.Uri.file(filePath);
          if (!isLocalInstallerUri(uri)) throw new Error("release installer URI must use the file scheme");
          return uri;
        },
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
  const hostDiagnosticSink = createHostDiagnosticSink(context);
  const reasoningDiagnostics = createReasoningDiagnosticReporter(hostDiagnosticSink);
  const reasoningDiagnosticNow = createReasoningDiagnosticClock();
  reasoningDiagnostics({ stage: "initialization", outcome: "started" });

  const workspaceUri = vscode.Uri.file(workspaceFolder);
  const memoryRetentionSettings = DEFAULT_MEMORY_RETENTION_SETTINGS;
  const chatMcpPrefs = new VscodeChatMcpPrefsStore(context.workspaceState);
  const sandboxSettings = resolveChatSandboxSettings(workspaceUri);
  const storedNonoProfile = readSelectedNonoProfile(workspaceUri);
  let selectedNonoProfile = storedNonoProfile;
  let initialCustomProfiles: string[] = [];
  if (
    sandboxSettings.enabled &&
    !storedNonoProfile &&
    (process.platform === "darwin" || process.platform === "linux")
  ) {
    initialCustomProfiles = await discoverNonoProfiles();
  }
  let selectedLaunchResolution: NonoResolution = await resolveNonoBackend(sandboxSettings.enabled, {
    selectedProfile: selectedNonoProfile,
  });
  let selectedLaunchBackend = selectedLaunchResolution.backend;
  const executablePath = resolveOpencodeBinary();
  const resolvedExecutablePath = path.isAbsolute(executablePath) ? executablePath : undefined;
  const extensionPath = context.extensionPath ?? context.extensionUri.fsPath;
  const bundledResourceRoot = path.join(extensionPath, "dist", "skills-commands");
  const reasoningContextPlugin = await resolveBundledScribeContextPlugin(extensionPath);
  const scribePluginSource: OpenCodeLaunchConfiguration["pluginSources"] = reasoningContextPlugin.available
    ? [{ package: reasoningContextPlugin.sourcePath }]
    : [];
  reasoningDiagnostics({ stage: "brief", outcome: reasoningContextPlugin.available ? "ready" : "unavailable" });
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
  let hindsightResolutionFailed = false;
  try {
    const effectiveConfig = readEffectiveOpenCodeConfiguration(openCodePaths.config, workspaceFolder);
    inheritedPluginSources = effectiveConfig.plugins ?? [];
    hindsightResolution = await resolveHindsightPlugin(effectiveConfig, readHindsightPackageMetadata);
  } catch {
    hindsightResolutionFailed = true;
    hindsightResolution = undefined;
  }
  // The preflight launch must keep provider hooks disabled. Exact observed
  // inventory verification below is the gate that activates lifecycle
  // retention on the final launch.
  let activeHindsightCompanionIntegration: OpenCodeLaunchConfiguration["hindsightCompanionIntegration"] =
    hindsightResolution &&
    (memoryRetentionSettings.policy.automaticSessionRetention || memoryRetentionSettings.policy.enabled)
      ? {
          ...hindsightResolution,
          toolPatterns: [] as const,
          automaticSessionRetention: false,
          environment: { HINDSIGHT_DISABLE_HOOKS: "1" as const },
        }
      : undefined;
  let initialMcpOverlay: ReturnType<typeof buildMcpOverlay> = { mcp: { servers: {} } };
  let initialMcpTransport: OpenCodeLaunchConfiguration["mcpTransport"] = {};
  let inventoryError: McpInventoryError | undefined;
  let chatMcpLocked: readonly string[] = [];
  try {
    const inventory = resolveMcpInventory(openCodePaths.config, workspaceFolder);
    chatMcpLocked = inventory.locked;
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
      hostPaths: { config: openCodePaths.config, state: openCodePaths.state },
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
      ...(inheritedPluginSources.length || scribePluginSource.length
        ? { pluginSources: [...inheritedPluginSources, ...scribePluginSource] }
        : {}),
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
      restrictedReview: {
        modelResolution: "native-default",
        prompt: RESTRICTED_REVIEW_PROMPT,
        maxSteps: RESTRICTED_REVIEW_MAX_STEPS,
      },
    };
  };
  const launchConfiguration = createLaunchConfiguration(
    sandboxSettings,
    initialMcpOverlay,
    initialMcpTransport,
    activeHindsightCompanionIntegration,
    true,
  );
  agent = new OpenCodeAgent(
    launchConfiguration,
    hostDiagnosticSink,
    reasoningContextPlugin.available ? reasoningContextPlugin.sourcePath : undefined,
  );
  const refreshHindsightIntegration = async (): Promise<void> => {
    if (!hindsightResolution) {
      activeHindsightCompanionIntegration = undefined;
      memoryProviderStatus = noHindsightProviderStatus();
      return;
    }
    try {
      const toolIds = (await awaitHindsightToolInventory(agent.getToolIds())).map((tool) => tool.id);
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
  let agentAvailable = false;
  let connectionFailure: string | undefined;
  const markAgentUnavailable = (error: unknown, status?: ChatSandboxStatus): string => {
    const message = safeConnectionFailure(error);
    agentAvailable = false;
    connectionFailure = message;
    initialSandboxStatus = {
      ...(status ?? initialSandboxStatus),
      applying: false,
      error: message,
    };
    chatViewProvider?.setAgentAvailable(false);
    chatViewProvider?.publishChatSandboxStatus(initialSandboxStatus);
    return message;
  };
  const markAgentAvailable = (): void => {
    agentAvailable = true;
    chatViewProvider?.setAgentAvailable(true);
    if (!connectionFailure) return;
    if (initialSandboxStatus.error === connectionFailure) {
      const status = { ...initialSandboxStatus };
      delete status.error;
      initialSandboxStatus = status;
      chatViewProvider?.publishChatSandboxStatus(status);
    }
    connectionFailure = undefined;
  };
  const reportSandboxError = (error: unknown, status?: ChatSandboxStatus) => {
    const rawMessage = error instanceof Error ? error.message : "";
    if (rawMessage.startsWith("Inherited OpenCode plugins were unavailable during startup")) {
      vscode.window.showWarningMessage(vscode.l10n.t("OpenCode Scribe: inherited OpenCode plugins are unavailable."));
      return;
    }
    const message = markAgentUnavailable(error, status);
    if (error instanceof McpInventoryError) {
      vscode.window.showErrorMessage(vscode.l10n.t(MCP_INVENTORY_ERROR_MESSAGE));
      return;
    }
    vscode.window.showErrorMessage(vscode.l10n.t("OpenCode Scribe: {0}", message));
  };
  agent.onAvailabilityError = (error) => reportSandboxError(error);

  let launchDiagnosticAttempt = 0;
  const connectAgent = async (sandboxEnabled: boolean, transition: LaunchDiagnosticTransition) => {
    const attempt = ++launchDiagnosticAttempt;
    agent.workspaceFolder = workspaceFolder;
    const launchBackend = selectedLaunchResolution.backend;
    const launchContainment =
      launchBackend === "nono" ? "nono-selected" : launchBackend === "vscode" ? "vscode-selected" : "none";
    const integration = agent.launchConfiguration?.hindsightCompanionIntegration;
    const launchHindsight =
      integration === undefined
        ? "absent"
        : integration.packageName === "@vectorize-io/hindsight-coding-agents"
          ? "approved-descriptor"
          : "ignored-descriptor";
    const recordLaunch = (stage: LaunchDiagnosticStage, workspace: "selected" | "location-bound") =>
      logLaunchDiagnostic(
        {
          attempt,
          transition,
          stage,
          backend: launchBackend,
          preflight: selectedLaunchResolution.diagnostic,
          profile: selectedLaunchResolution.profile ?? selectedNonoProfile,
          sandboxEnabled,
          binaryResolved: resolvedExecutablePath !== undefined,
          workspace,
          containment: launchContainment,
          hindsight: launchHindsight,
        },
        hostDiagnosticSink,
      );
    recordLaunch("started", "selected");
    try {
      if (sandboxEnabled) {
        await agent.connect();
      } else {
        // SDK の createOpencodeServer は cwd オプションを持たないため、
        // プロセスのカレントディレクトリを変更してからサーバーを起動する。
        const originalCwd = process.cwd();
        process.chdir(workspaceFolder);
        try {
          await agent.connect();
        } finally {
          process.chdir(originalCwd);
        }
      }
      markAgentAvailable();
      void restrictedReviewHolder?.rebind();
      recordLaunch("ready", "location-bound");
    } catch (error) {
      markAgentUnavailable(error);
      recordLaunch("failed", "selected");
      throw error;
    }
  };

  let connectFailed = false;
  if (inventoryError) {
    connectFailed = true;
    markAgentUnavailable(new McpInventoryError());
    vscode.window.showErrorMessage(vscode.l10n.t(MCP_INVENTORY_ERROR_MESSAGE));
  } else {
    try {
      await connectAgent(sandboxSettings.enabled, "initial");
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
      if (kind === "database-locked") {
        vscode.window.showErrorMessage(vscode.l10n.t("OpenCode Scribe: {0}", DATABASE_LOCKED_CONNECTION_FAILURE));
      } else {
        const message = safeConnectionFailure(error);
        vscode.window.showErrorMessage(vscode.l10n.t("OpenCode Scribe: Failed to start OpenCode server. {0}", message));
      }
    }
  }

  if (!initialLaunchProviderAvailable) {
    memoryProviderStatus = blockedHindsightStatus();
  } else if (activeHindsightCompanionIntegration && !connectFailed) {
    try {
      const toolIds = await awaitHindsightToolInventory(agent.getToolIds());
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
        await connectAgent(sandboxSettings.enabled, "initial");
      } else {
        activeHindsightCompanionIntegration = undefined;
        await agent.stopForReconnect();
        agent.updateLaunchConfiguration(
          createLaunchConfiguration(sandboxSettings, initialMcpOverlay, initialMcpTransport, null),
        );
        await connectAgent(sandboxSettings.enabled, "initial");
      }
    } catch {
      activeHindsightCompanionIntegration = undefined;
      memoryProviderStatus = hindsightErrorStatus();
      try {
        await agent.stopForReconnect();
        agent.updateLaunchConfiguration(
          createLaunchConfiguration(sandboxSettings, initialMcpOverlay, initialMcpTransport, null),
        );
        await connectAgent(sandboxSettings.enabled, "initial");
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
  const reasoningReviewSelection = await selectReasoningReviewDependencies(vibefeldActivation, {
    diagnostics: reasoningDiagnostics,
    now: reasoningDiagnosticNow,
  });
  restrictedReviewHolder = new RestrictedReviewHolder({
    afRuntime: reasoningReviewSelection.runtime,
    createProvider: () =>
      agent.createRestrictedReviewProviderForNativeDefault({
        observe: reasoningDiagnostics,
        now: reasoningDiagnosticNow,
      }),
    createBinding: async (provider: RestrictedReviewProvider): Promise<RestrictedReviewBinding> => {
      const { createRestrictedReviewAdapter } = await import("./vibefeld/restricted-review-adapter");
      const adapter = createRestrictedReviewAdapter({
        provider,
        diagnostics: reasoningDiagnostics,
        now: reasoningDiagnosticNow,
        createAutomaticProvider: async () => {
          const resolution = await agent.createRestrictedReviewProviderForNativeDefault({
            observe: reasoningDiagnostics,
            now: reasoningDiagnosticNow,
          });
          return resolution.ok ? resolution.provider : undefined;
        },
        stageTimeoutMs: 30_000,
      });
      if (!reasoningReviewSelection.claimAvailable || !reasoningReviewSelection.claimSeam) {
        throw new Error("Required claim-projection capability unavailable.");
      }
      const [
        { ComposedReasoningReviewController },
        { createAdversarialReviewSeam },
        { createCompletedAnswerClaimMapper },
      ] = await Promise.all([
        import("./vibefeld/composed-reasoning-review-controller"),
        import("./vibefeld/adversarial-review-seam"),
        import("./vibefeld/completed-answer-claim-mapper"),
      ]);
      const seam = createAdversarialReviewSeam(adapter);
      if (!seam.getCapability().supported) throw new Error("Required restricted-review capability unavailable.");
      const controller = new ComposedReasoningReviewController(reasoningReviewSelection.claimSeam, seam, {
        readinessCheck: async () => {
          if (!provider.isReady()) {
            reasoningDiagnostics({ stage: "manual-provider", outcome: "precheck-not-ready" });
            return false;
          }
          if ((await provider.checkReadiness()) !== true) return false;
          if (!provider.isReady()) {
            reasoningDiagnostics({ stage: "manual-provider", outcome: "postcheck-not-ready" });
            return false;
          }
          return true;
        },
        mapCompletedAnswer: createCompletedAnswerClaimMapper(adapter, {
          stageTimeoutMs: 30_000,
          diagnostics: reasoningDiagnostics,
          now: reasoningDiagnosticNow,
        }),
        reviewLifecycle: provider,
        diagnostics: reasoningDiagnostics,
        now: reasoningDiagnosticNow,
      });
      return { adapter, controller };
    },
    cancelWork: () => {
      chatViewProvider?.cancelAllReasoningAssistWork();
      chatViewProvider?.cancelAllReasoningReviewWork();
    },
    onChange: (snapshot) => chatViewProvider?.publishReasoningRuntime(snapshot.runtime),
    report: (stage, outcome, elapsedMs) =>
      reasoningDiagnostics({ stage, outcome, ...(elapsedMs === undefined ? {} : { elapsedMs }) }),
    now: reasoningDiagnosticNow,
  });
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
    chatMcpLocked: () => chatMcpLocked,
    memoryProviderStatus,
    memoryRetentionStatus,
    reasoningReviewController: reasoningReviewSelection.controller,
    getReasoningReviewController: () => restrictedReviewHolder?.getSnapshot().controller,
    getReasoningRuntime: () => restrictedReviewHolder?.getSnapshot().runtime,
    getReasoningAssistAdapter: () => restrictedReviewHolder?.getSnapshot().adapter,
    reasoningAssistStructureRecorder: reasoningReviewSelection.reasoningAssistStructureRecorder,
    reasoningAssistPluginAvailable: reasoningContextPlugin.available,
    reasoningDiagnostics,
    reasoningDiagnosticNow,
    // Availability-gated preference seam: the user toggle writes the Global
    // target and the workspace opt-out writes the Workspace target for this
    // workspace. Reads and writes stay within the two bounded boolean keys.
    reasoningReviewPreference,
    initialAppPaths: { config: openCodePaths.config, state: openCodePaths.state, directory: workspaceFolder },
    agentAvailable,
    onAgentConnected: () => {
      markAgentAvailable();
      void restrictedReviewHolder?.rebind();
    },
    onAgentUnavailable: () => {
      void restrictedReviewHolder?.invalidate();
    },
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
        if (connectionFailure) {
          initialSandboxStatus = { ...previousStatus, applying: false, error: connectionFailure };
          chatViewProvider?.publishChatSandboxStatus(initialSandboxStatus);
        } else {
          initialSandboxStatus = previousStatus;
        }
        throw error;
      } finally {
        panelUpdateInProgress = false;
      }
    },
  });
  // The initial connection predates holder construction; bind it once now.
  if (agentAvailable) void restrictedReviewHolder.rebind();
  sandboxController = new ChatSandboxController<ChatSandboxStatus>({
    stop: async () => {
      agentAvailable = false;
      chatViewProvider?.setAgentAvailable(false);
      await restrictedReviewHolder?.invalidate();
      await agent.stopForReconnect();
    },
    start: async (settings) => {
      const resolved = resolveChatSandboxSettings(workspaceUri);
      // Re-resolve only when a new settings transition creates a connection;
      // reconnects within that connection retain the selected discriminant.
      selectedNonoProfile = readSelectedNonoProfile(workspaceUri);
      selectedLaunchResolution = await resolveNonoBackend(resolved.enabled, {
        selectedProfile: selectedNonoProfile,
      });
      selectedLaunchBackend = selectedLaunchResolution.backend;
      let mcpOverlay: ReturnType<typeof buildMcpOverlay>;
      let mcpTransport: OpenCodeLaunchConfiguration["mcpTransport"];
      try {
        const inventory = resolveMcpInventory(openCodePaths.config, workspaceFolder);
        chatMcpLocked = inventory.locked;
        mcpOverlay = buildMcpOverlay(inventory, chatMcpPrefs.read());
        mcpTransport = Object.fromEntries(
          Object.entries(inventory.servers).map(([name, server]) => [name, server.transport]),
        );
      } catch {
        throw new McpInventoryError();
      }
      const launchIntegration = activeHindsightCompanionIntegration;
      agent.updateLaunchConfiguration(createLaunchConfiguration(resolved, mcpOverlay, mcpTransport, launchIntegration));
      await connectAgent(resolved.enabled, "settings");
      // Inventory is authoritative after every reconnect. If the provider
      // failed or became unsafe, reconnect once on the same requested
      // sandbox mode with the ordinary fallback rather than leaving stale
      // lifecycle state attached to the agent.
      const providerBlockedForLaunch = currentLaunchProviderBlocked;
      if (!providerBlockedForLaunch) await refreshHindsightIntegration();
      if (launchIntegration && !providerBlockedForLaunch && !activeHindsightCompanionIntegration) {
        await agent.stopForReconnect();
        agent.updateLaunchConfiguration(createLaunchConfiguration(resolved, mcpOverlay, mcpTransport, null));
        await connectAgent(resolved.enabled, "settings");
      }
      return resolveChatSandboxSettings(workspaceUri);
    },
    publishStatus: (status) => chatViewProvider?.publishChatSandboxStatus(status),
    onReconnected: () => {
      if (currentLaunchProviderBlocked) memoryProviderStatus = blockedHindsightStatus();
      chatViewProvider?.publishMemoryProviderStatus(memoryProviderStatus);
      chatViewProvider?.publishMcpPrefs();
      const refresh = chatViewProvider?.refresh();
      if (refresh) {
        void refresh.catch(() => {
          console.error("[OpenCode] Chat refresh failed after sandbox reconnect.");
        });
      }
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
      void sandboxController?.update(resolved).catch(() => {
        console.error("[OpenCode] Failed to apply sandbox configuration change.");
      });
    }),
  );

  // Start the optional picker only after the connection and its setting
  // listener exist, so an explicit custom choice can reconnect immediately.
  if (initialCustomProfiles.length > 0) {
    void promptForInitialNonoProfile(workspaceUri, initialCustomProfiles).catch(() => undefined);
  }

  // Keep the provider alive after a failed connection so it can publish local
  // initialization and settings while gating requests that require the agent.
  reasoningDiagnostics({ stage: "initialization", outcome: "ready" });
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
 * The activation-scoped AF result. Restricted provider readiness is bound
 * separately to each OpenCode connection by RestrictedReviewHolder.
 */
type ReasoningReviewSelection = Readonly<{
  controller: IReasoningReviewController;
  runtime: ReasoningReviewRuntime;
  claimAvailable: boolean;
  claimSeam?: ClaimProjectionSeam;
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
 * Restricted-provider setup is intentionally absent here: AF discovery and
 * preflight happen once per activation, while model resolution and provider
 * readiness are re-run by the connection-scoped holder.
 */
async function selectReasoningReviewDependencies(
  composition: VibefeldActivationComposition,
  options: RestrictedReviewSelectionOptions = {},
): Promise<ReasoningReviewSelection> {
  const now = createReasoningDiagnosticClock(options.now);
  const report = (stage: "runtime" | "provider" | "adapter", outcome: string, startedAt?: number): void => {
    const elapsedMs = startedAt === undefined ? undefined : elapsedReasoningMilliseconds(now, startedAt);
    try {
      options.diagnostics?.({ stage, outcome, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
    } catch {
      // Optional diagnostics must not affect runtime or provider readiness.
    }
  };
  let runtime: ReasoningReviewRuntime =
    composition.state === "composed" ? PREFLIGHT_FAILED_REASONING_REVIEW_RUNTIME : DORMANT_REASONING_REVIEW_RUNTIME;
  let claimAvailable = false;
  let preflightReady = false;
  let runtimeOutcome: "ready" | "af-unavailable" | "readiness-rejected" = "af-unavailable";
  let runtimeStartedAt: number | undefined;
  let claimSeam: ReturnType<typeof createCurrentVibefeldClaimProjectionSeam> | undefined;
  try {
    if (composition.state === "composed") {
      runtimeStartedAt = now();
      const preflight = await composition.bridge.preflight();
      if (preflight.state === "ready") {
        preflightReady = true;
        runtimeOutcome = "ready";
        claimSeam = createCurrentVibefeldClaimProjectionSeam(composition.bridge, {
          observer: (outcome) => options.diagnostics?.({ stage: "af-projection", outcome }),
        });
        claimAvailable = claimSeam.getCapability().supported;
        runtime = claimAvailable
          ? deriveReasoningReviewRuntime(preflight)
          : CLAIM_CAPABILITY_UNAVAILABLE_REASONING_REVIEW_RUNTIME;
      } else {
        runtimeOutcome = "readiness-rejected";
        runtime = deriveReasoningReviewRuntime(preflight);
      }
      report("runtime", runtimeOutcome, runtimeStartedAt);
    }
  } catch {
    // A rejected preflight is nonfatal; the bounded failure status stays.
    runtimeOutcome = "readiness-rejected";
    if (composition.state === "composed") report("runtime", runtimeOutcome, runtimeStartedAt);
  }
  if (composition.state !== "composed") report("runtime", "af-unavailable");
  if (!preflightReady) report("adapter", runtimeOutcome);

  let controller: IReasoningReviewController | undefined;
  if (claimAvailable && claimSeam) {
    controller = new RuntimeReportingReasoningReviewController(
      new ClaimProjectionReasoningReviewController(claimSeam),
      runtime,
    );
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
    runtime,
    claimAvailable,
    ...(claimAvailable && claimSeam ? { claimSeam } : {}),
    reasoningAssistStructureRecorder,
  };
}

type RestrictedReviewSelectionOptions = Readonly<{
  diagnostics?: ReasoningDiagnosticReporter;
  now?: () => number;
}>;

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
  const holder = restrictedReviewHolder;
  restrictedReviewHolder = undefined;
  if (holder) {
    try {
      await holder.dispose();
    } catch {
      // Restricted holder cleanup is best effort during shutdown.
    }
  }
  agent?.disconnect();
  const disposeDiagnostics = disposeHostDiagnosticChannel;
  disposeHostDiagnosticChannel = undefined;
  try {
    disposeDiagnostics?.();
  } catch {
    // Diagnostics are best effort during shutdown.
  }
}

export function getMemoryProviderStatus(): MemoryProviderStatus {
  return memoryProviderStatus;
}

function isLocalInstallerUri(uri: vscode.Uri): uri is vscode.Uri & LocalInstallerUri {
  return uri.scheme === "file" && typeof uri.fsPath === "string" && typeof uri.toString === "function";
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
