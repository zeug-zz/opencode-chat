import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  SCRIBE_REASONING_CONTEXT_GRACE_MS,
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES,
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS,
  validateMemoryRetentionSummary,
} from "@opencode-chat/agent-opencode";
import type {
  AppPaths,
  BundledCommandInvocation,
  BundledResourceMetadata,
  ChatMessageWithParts,
  ChatSandboxSettings,
  ChatSandboxStatus,
  ChatSession,
  HostToUIMessage,
  IAgent,
  IPlatformServices,
  MemoryProviderStatus,
  MemoryRetentionStatus,
  ReasoningAssistBriefDeliveryResult,
  ReasoningReviewProgressStage,
  ReasoningReviewRuntime,
  ReasoningReviewSummary,
  UIToHostMessage,
} from "@opencode-chat/core";
import { DEFAULT_MEMORY_RETENTION_POLICY } from "@opencode-chat/core";
import * as vscode from "vscode";
import type { ChatMcpPrefs, ChatMcpPrefsStore } from "./chat-mcp-prefs";
import { hiddenSessionRegistry } from "./vibefeld/hidden-session-registry";
import { composeReasoningAssistBrief, composeReasoningAssistSummary } from "./vibefeld/reasoning-assist-brief";
import { runReasoningAssistPreflight } from "./vibefeld/reasoning-assist-orchestrator";
import { classifyReasoningAssistPreScreen } from "./vibefeld/reasoning-assist-pre-screen";
import type { ReasoningAssistStructureRecorder } from "./vibefeld/reasoning-assist-structure-recorder";
import {
  createReasoningDiagnosticClock,
  createReasoningDiagnosticReporter,
  elapsedReasoningMilliseconds,
  type ReasoningDiagnosticOutcome,
  type ReasoningDiagnosticReporter,
  type ReasoningDiagnosticStage,
} from "./vibefeld/reasoning-diagnostics";
import type { IReasoningReviewController } from "./vibefeld/reasoning-review-controller";
import {
  normalizeReasoningReviewSummary,
  unavailableReasoningReviewSummary,
} from "./vibefeld/reasoning-review-publication";
import type { ReasoningAssistRestrictedReviewAdapter } from "./vibefeld/restricted-review-adapter";
import { resolveEffectiveVibefeldEnabled, type VibefeldPreference } from "./vibefeld/vibefeld-settings";
import { resolveTabInputFile } from "./vscode-platform-services";

type NormalPrompt = Extract<UIToHostMessage, { type: "sendMessage" }>;

const AGENT_REQUIRED_MESSAGE_TYPES: ReadonlySet<UIToHostMessage["type"]> = new Set([
  "sendMessage",
  "requestReasoningReview",
  "createSession",
  "listSessions",
  "selectSession",
  "deleteSession",
  "getMessages",
  "replyPermission",
  "replyQuestion",
  "rejectQuestion",
  "abort",
  "getProviders",
  "compressSession",
  "revertToMessage",
  "editAndResend",
  "executeShell",
  "openTerminal",
  "setModel",
  "forkSession",
  "getSessionDiff",
  "getSessionTodos",
  "getChildSessions",
  "getAgents",
  "getSkills",
  "getMcpStatus",
  "connectMcp",
  "disconnectMcp",
  "shareSession",
  "unshareSession",
  "undoSession",
  "redoSession",
]);

type PromptDispatch = {
  admitted: boolean;
};

type PromptQueueState = {
  active: boolean;
  waitingForBusy: boolean;
  pending: NormalPrompt[];
  currentDispatch?: PromptDispatch;
  reconnectIdleDispatch?: PromptDispatch;
};

type ReasoningAssistInFlightEntry = {
  generation: number;
  controller: AbortController;
  lastToken?: string;
  applied?: boolean;
};

type ReasoningAssistTurnEntry = {
  turnId: string;
  active: boolean;
  pending: boolean;
};

type ReasoningReviewInFlightEntry = {
  requestId: string;
  sessionId: string;
  messageId: string;
  sessionOperationGeneration: number;
  connectionRefreshGeneration: number;
  sessionEventRevision: number;
  startedAt: number;
  controller?: IReasoningReviewController;
  cancelled: boolean;
  cancellationAcknowledged: boolean;
  completion: Promise<void>;
};

const MANUAL_REVIEW_SOURCE_LIMIT = 12_000;
const SAFE_REVIEW_REQUEST_ID = /^[A-Za-z0-9_-]{1,96}$/;

type CompletedScoutAnswerValidation =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{
      ok: false;
      outcome: Extract<
        ReasoningDiagnosticOutcome,
        "answer-unfinished" | "wrong-role" | "failed-answer" | "empty-answer" | "source-over-limit"
      >;
    }>;

function validateCompletedScoutAnswer(
  message: ChatMessageWithParts,
  sessionId: string,
): CompletedScoutAnswerValidation {
  const { info, parts } = message;
  if (info.sessionID !== sessionId || info.role !== "assistant" || info.agent !== "scout")
    return { ok: false, outcome: "wrong-role" };
  if (info.error != null) return { ok: false, outcome: "failed-answer" };
  if (typeof info.time?.completed !== "number" || !Number.isFinite(info.time.completed))
    return { ok: false, outcome: "answer-unfinished" };
  const text = parts
    .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n\n")
    .trim();
  if (text.length === 0) return { ok: false, outcome: "empty-answer" };
  if (text.length > MANUAL_REVIEW_SOURCE_LIMIT) return { ok: false, outcome: "source-over-limit" };
  return { ok: true, text };
}

/**
 * Host seam for the reasoning-review preference. The user toggle writes the
 * Global target and the workspace opt-out writes the Workspace target; both
 * write only their own key and never unrelated configuration.
 */
export type ReasoningReviewPreferenceSeam = Readonly<{
  read: () => VibefeldPreference;
  setUserEnabled: (value: boolean) => Promise<void>;
  setWorkspaceOptOut: (value: boolean) => Promise<void>;
}>;

const MEMORY_RETENTION_PERMISSION = "hindsight_ingest_document";
export const MEMORY_RETENTION_CONFIRMATION_TTL_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** V2 stores `model` as `{ providerID, model, variant? }`; the Webview expects "providerID/model". */
function normalizeConfigModel(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.providerID === "string" && typeof value.model === "string") {
    if (value.providerID.length > 0 && value.model.length > 0) return `${value.providerID}/${value.model}`;
  }
  return undefined;
}

function getStructuredRetentionSummary(metadata: Record<string, unknown>): unknown {
  if ("input" in metadata) return metadata.input;
  if ("summary" in metadata) {
    return {
      summary: metadata.summary,
      ...("title" in metadata ? { title: metadata.title } : {}),
      ...("tags" in metadata ? { tags: metadata.tags } : {}),
    };
  }
  return undefined;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "opencode-chat.chatView";

  private view: vscode.WebviewView | undefined;
  // OpenCode サーバーには「現在アクティブなセッション」を保持する API がないため、
  // UI クライアント側で管理する（TUI も同様の設計）。
  private activeSession: ChatSession | null = null;
  private sessionOperationGeneration = 0;
  private connectionRefreshGeneration = 0;
  private refreshGeneration = 0;
  private activeSessionEventRevision = 0;
  private reconnectRefreshState:
    | { sessionId: string; generation: number; inFlight: boolean; needsRefresh: boolean; idleSeen: boolean }
    | undefined;
  private sessionListRequestGeneration = 0;
  private chatSandboxStatus: ChatSandboxStatus | undefined;
  private memoryProviderStatus: MemoryProviderStatus;
  private memoryRetentionStatus: MemoryRetentionStatus;
  private readonly chatSystemPrompt: string | null;
  private readonly writeSystemPrompt: string | null;
  private readonly setChatSandboxSettings?: (settings: ChatSandboxSettings) => Promise<ChatSandboxStatus>;
  private readonly reasoningReviewController?: IReasoningReviewController;
  private readonly getReasoningReviewController?: () => IReasoningReviewController | undefined;
  private readonly getReasoningRuntime?: () => ReasoningReviewRuntime | undefined;
  private readonly reasoningReviewPreference?: ReasoningReviewPreferenceSeam;
  /**
   * Optional host-private reasoning-assist preflight adapter. Absent means the
   * assist is fully disabled and no hidden preflight work is ever performed.
   */
  private readonly reasoningAssistAdapter?: ReasoningAssistRestrictedReviewAdapter;
  private readonly getReasoningAssistAdapter?: () => ReasoningAssistRestrictedReviewAdapter | undefined;
  /**
   * Optional host-private AF structure recorder for the reasoning-assist
   * preflight. Absent means AF facts are never requested.
   */
  private readonly reasoningAssistStructureRecorder?: ReasoningAssistStructureRecorder;
  private readonly reasoningDiagnostics: ReasoningDiagnosticReporter;
  private readonly reasoningDiagnosticNow: () => number;
  private reasoningReviewRuntime: ReasoningReviewRuntime | undefined;
  private readonly chatMcpPrefs?: ChatMcpPrefsStore;
  private readonly chatMcpLocked?: () => readonly string[];
  private readonly initialAppPaths?: AppPaths;
  private agentAvailable = true;
  private readonly onAgentConnected?: () => void;
  private readonly onAgentUnavailable?: () => void;
  private readonly bundledResources: readonly BundledResourceMetadata[];
  private readonly bundledCommandNames: ReadonlySet<string>;
  private readonly promptQueues = new Map<string, PromptQueueState>();
  /**
   * Per-session preflight generation. A cancellation bumps it so late results
   * from the cancelled run can never become current again, while a later prompt
   * for the same session starts a fresh preflight.
   */
  private readonly reasoningAssistGenerations = new Map<string, number>();
  /**
   * The one reasoning-assist preflight allowed to be in flight per session. Its
   * identity and generation are both part of the currency guard, so
   * cancellation and supersession invalidate all pending publications.
   */
  private readonly reasoningAssistInFlight = new Map<string, ReasoningAssistInFlightEntry>();
  private readonly reasoningAssistTurnBySession = new Map<string, ReasoningAssistTurnEntry>();
  private readonly reasoningAssistBriefBySession = new Map<string, string>();
  private readonly reasoningAssistBriefOperations = new Map<string, Promise<void>>();
  private readonly reasoningReviewInFlight = new Map<string, ReasoningReviewInFlightEntry>();
  private readonly reasoningAssistPluginAvailable: boolean;
  private readonly retentionPermissions = new Map<
    string,
    { sessionId: string; validPayload: boolean; expiresAt: number }
  >();
  private readonly invalidatedRetentionPermissions = new Set<string>();
  private clearRetentionPermissions(sessionId: string): void {
    for (const [permissionId, permission] of this.retentionPermissions) {
      if (permission.sessionId !== sessionId) continue;
      this.invalidateRetentionPermission(permissionId);
    }
  }

  private invalidateRetentionPermission(permissionId: string): void {
    this.retentionPermissions.delete(permissionId);
    this.invalidatedRetentionPermissions.add(permissionId);
    setTimeout(() => this.invalidatedRetentionPermissions.delete(permissionId), MEMORY_RETENTION_CONFIRMATION_TTL_MS);
  }

  private invalidateAllRetentionPermissions(): void {
    for (const permissionId of this.retentionPermissions.keys()) {
      this.invalidateRetentionPermission(permissionId);
    }
  }

  private getSystemPrompt(primaryAgent: string | undefined, explicitSystem: string | undefined): string | undefined {
    return (
      explicitSystem ??
      (primaryAgent === "scout"
        ? this.chatSystemPrompt
        : primaryAgent === "build"
          ? this.writeSystemPrompt
          : undefined) ??
      undefined
    );
  }

  /**
   * Publish the seam's current preference with the effective state resolved
   * from the already-published runtime. This reads configuration through the
   * seam and performs no runtime discovery or process work.
   */
  private publishReasoningReviewPreference(): void {
    const seam = this.reasoningReviewPreference;
    if (!seam) return;
    const preference = seam.read();
    this.postMessage({
      type: "reasoningReviewPreference",
      preference: {
        userEnabled: preference.userEnabled,
        workspaceOptOut: preference.workspaceOptOut,
        effective: resolveEffectiveVibefeldEnabled(preference, this.reasoningReviewRuntime),
      },
    });
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: IAgent,
    private readonly platformServices: IPlatformServices,
    options?: {
      setChatSandboxSettings?: (settings: ChatSandboxSettings) => Promise<ChatSandboxStatus>;
      memoryProviderStatus?: MemoryProviderStatus;
      memoryRetentionStatus?: MemoryRetentionStatus;
      reasoningReviewController?: IReasoningReviewController;
      getReasoningReviewController?: () => IReasoningReviewController | undefined;
      getReasoningRuntime?: () => ReasoningReviewRuntime | undefined;
      reasoningReviewPreference?: ReasoningReviewPreferenceSeam;
      reasoningAssistAdapter?: ReasoningAssistRestrictedReviewAdapter;
      getReasoningAssistAdapter?: () => ReasoningAssistRestrictedReviewAdapter | undefined;
      reasoningAssistStructureRecorder?: ReasoningAssistStructureRecorder;
      reasoningAssistPluginAvailable?: boolean;
      reasoningDiagnostics?: ReasoningDiagnosticReporter;
      reasoningDiagnosticNow?: () => number;
      chatMcpPrefs?: ChatMcpPrefsStore;
      /** Servers denied by higher-authority (system/managed) configuration at the last inventory. */
      chatMcpLocked?: () => readonly string[];
      initialAppPaths?: AppPaths;
      agentAvailable?: boolean;
      onAgentConnected?: () => void;
      onAgentUnavailable?: () => void;
      bundledCommandNames?: readonly string[];
      bundledResources?: readonly BundledResourceMetadata[];
    },
  ) {
    this.chatSystemPrompt = this.loadSystemPrompt("CHAT_SYSTEM.md");
    this.writeSystemPrompt = this.loadSystemPrompt("WRITE_SYSTEM.md");
    this.setChatSandboxSettings = options?.setChatSandboxSettings;
    this.memoryProviderStatus = options?.memoryProviderStatus ?? {
      id: "none",
      displayName: "No memory provider",
      state: "unavailable",
      capabilities: { retain: false, recall: false, reflect: false },
    };
    this.memoryRetentionStatus = options?.memoryRetentionStatus ?? {
      policy: { ...DEFAULT_MEMORY_RETENTION_POLICY },
      state: "unavailable",
    };
    this.reasoningReviewController = options?.reasoningReviewController;
    this.getReasoningReviewController = options?.getReasoningReviewController;
    this.getReasoningRuntime = options?.getReasoningRuntime;
    this.reasoningReviewPreference = options?.reasoningReviewPreference;
    this.reasoningAssistAdapter = options?.reasoningAssistAdapter;
    this.getReasoningAssistAdapter = options?.getReasoningAssistAdapter;
    this.reasoningAssistStructureRecorder = options?.reasoningAssistStructureRecorder;
    this.reasoningAssistPluginAvailable = options?.reasoningAssistPluginAvailable ?? false;
    this.reasoningDiagnostics = options?.reasoningDiagnostics ?? createReasoningDiagnosticReporter();
    this.reasoningDiagnosticNow = createReasoningDiagnosticClock(options?.reasoningDiagnosticNow);
    this.chatMcpPrefs = options?.chatMcpPrefs;
    this.chatMcpLocked = options?.chatMcpLocked;
    this.initialAppPaths = options?.initialAppPaths;
    this.agentAvailable = options?.agentAvailable ?? true;
    this.onAgentConnected = options?.onAgentConnected;
    this.onAgentUnavailable = options?.onAgentUnavailable;
    this.bundledResources = options?.bundledResources ?? [];
    this.bundledCommandNames = new Set(options?.bundledCommandNames ?? []);
  }

  setAgentAvailable(available: boolean): void {
    if (this.agentAvailable === available) return;
    this.agentAvailable = available;
    if (available) return;

    this.refreshGeneration++;
    this.sessionOperationGeneration++;
    this.sessionListRequestGeneration++;
    this.connectionRefreshGeneration++;
    this.reconnectRefreshState = undefined;
    this.invalidateAllRetentionPermissions();
    this.cancelAllReasoningAssistWork();
    this.cancelAllReasoningReviewWork();
    this.clearAllReasoningAssistBriefs();
    try {
      this.onAgentUnavailable?.();
    } catch {
      // Optional review readiness invalidation must not affect ordinary Chat.
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: UIToHostMessage) => this.handleWebviewMessage(message));

    // SSE イベントを Webview に転送する
    this.agent.onEvent((event) => {
      // A payload-less event (e.g. a serialized server.connected without its
      // empty properties) must forward without throwing on field access.
      const properties = (event.properties ?? {}) as unknown as {
        sessionID?: string;
        info?: { id?: string; title?: string };
      };
      const sessionId = properties.sessionID ?? properties.info?.id;
      const title = properties.info?.title;
      if (
        (sessionId !== undefined && hiddenSessionRegistry.isHiddenSessionId(sessionId)) ||
        (title !== undefined && hiddenSessionRegistry.suppressPendingEvent(title))
      ) {
        return;
      }
      if (
        sessionId !== undefined &&
        sessionId === this.activeSession?.id &&
        this.isConversationMutationEvent(event.type)
      ) {
        this.activeSessionEventRevision++;
        this.cancelReasoningReviewsForSession(sessionId, true);
      }
      let eventForWebview = event;
      if (event.type === "permission.asked" && event.properties.permission === MEMORY_RETENTION_PERMISSION) {
        // A rehydrated request with this identity is a fresh pending interaction.
        this.invalidatedRetentionPermissions.delete(event.properties.id);
        const metadata = event.properties.metadata;
        const input = isRecord(metadata) ? getStructuredRetentionSummary(metadata) : undefined;
        const expiresAt = Date.now() + MEMORY_RETENTION_CONFIRMATION_TTL_MS;
        this.retentionPermissions.set(event.properties.id, {
          sessionId: event.properties.sessionID,
          validPayload: validateMemoryRetentionSummary(input).accepted,
          expiresAt,
        });
        setTimeout(() => {
          const pending = this.retentionPermissions.get(event.properties.id);
          if (!pending || pending.expiresAt !== expiresAt) return;
          this.retentionPermissions.delete(event.properties.id);
          this.invalidatedRetentionPermissions.add(event.properties.id);
          setTimeout(
            () => this.invalidatedRetentionPermissions.delete(event.properties.id),
            MEMORY_RETENTION_CONFIRMATION_TTL_MS,
          );
        }, MEMORY_RETENTION_CONFIRMATION_TTL_MS);
        // Permission metadata can contain the proposed write. It is not a
        // provider-neutral UI surface, so never forward it to the webview.
        eventForWebview = { ...event, properties: { ...event.properties, metadata: {} } };
      }
      this.postMessage({ type: "event", event: eventForWebview });

      if (event.type === "session.status") {
        this.handleSessionStatus(event.properties.sessionID, event.properties.status.type);
      } else if (event.type === "session.deleted") {
        if (this.activeSession?.id === event.properties.info.id) {
          this.sessionOperationGeneration++;
          if (this.reconnectRefreshState?.sessionId === event.properties.info.id) {
            this.reconnectRefreshState = undefined;
          }
        }
        this.cancelReasoningAssist(event.properties.info.id);
        this.cancelReasoningReviewsForSession(event.properties.info.id, false);
        this.clearPromptQueue(event.properties.info.id);
        this.clearRetentionPermissions(event.properties.info.id);
      } else if (event.type === "session.error") {
        this.clearRetentionPermissions(event.properties.sessionID);
      }

      // The global stream also carries lifecycle events outside the typed
      // local union. A reconnect invalidates every in-flight preflight: work
      // started on a previous connection must not surface on the new one.
      const streamEventType: string = event.type;
      if (streamEventType === "server.connected") {
        // Invalidate old-generation assist work before asking the host to
        // publish readiness for the replacement connection.
        this.cancelAllReasoningAssistWork();
        this.cancelAllReasoningReviewWork();
        this.clearAllReasoningAssistBriefs();
        const sessionId = this.activeSession?.id;
        const promptQueue = sessionId ? this.promptQueues.get(sessionId) : undefined;
        if (promptQueue) {
          promptQueue.reconnectIdleDispatch = promptQueue.currentDispatch?.admitted
            ? promptQueue.currentDispatch
            : undefined;
        }
        const refreshGeneration = ++this.connectionRefreshGeneration;
        this.sessionOperationGeneration++;
        this.invalidateAllRetentionPermissions();
        this.setAgentAvailable(true);
        this.onAgentConnected?.();
        if (sessionId && !hiddenSessionRegistry.isHiddenSessionId(sessionId)) {
          const state = {
            sessionId,
            generation: refreshGeneration,
            inFlight: false,
            needsRefresh: true,
            idleSeen: false,
          };
          this.reconnectRefreshState = state;
          this.startReconnectRefresh(state);
        } else {
          this.reconnectRefreshState = undefined;
        }
      }

      // コンパクション完了時にセッション + メッセージを再取得して Webview に送信する
      // (compact API は非同期でバックグラウンド実行されるため、完了イベントでリフレッシュする)
      if (
        (event.type === "session.compacted" || event.type === "session.next.compaction.ended") &&
        event.properties.sessionID === this.activeSession?.id
      ) {
        const operationGeneration = this.sessionOperationGeneration;
        const sessionId = event.properties.sessionID;
        this.agent
          .getSession(sessionId)
          .then((session) => this.publishActiveSession(session, operationGeneration, sessionId))
          .catch((err) => console.error("[OpenCode] Failed to refresh after compaction:", err));
      }
      if (
        event.type === "session.status" &&
        event.properties.status.type === "idle" &&
        event.properties.sessionID === this.activeSession?.id
      ) {
        const state = this.reconnectRefreshState;
        if (state?.sessionId === event.properties.sessionID && state.needsRefresh) {
          state.idleSeen = true;
          this.startReconnectRefresh(state);
        }
      }
    });

    // アクティブエディタが変わるたびに Webview に通知する
    // (プッシュ型通知はメッセージルーターの責務として残す)
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.publishActiveEditor(editor);
    });
    vscode.window.tabGroups.onDidChangeTabs(() => {
      this.publishActiveEditor();
    });
  }

  private async handleWebviewMessage(message: UIToHostMessage): Promise<void> {
    try {
      await this.handleWebviewMessageInner(message);
    } catch (err) {
      console.error(`[OpenCode] Error handling message '${message.type}':`, err);
    }
  }

  private async handleWebviewMessageInner(message: UIToHostMessage): Promise<void> {
    if (!this.agentAvailable && AGENT_REQUIRED_MESSAGE_TYPES.has(message.type)) return;

    switch (message.type) {
      case "ready": {
        // Webview の初期化完了時に init メッセージを送信する（locale + toolConfig を統合）
        const paths = this.agentAvailable ? await this.agent.getPath() : this.initialAppPaths;
        if (!paths) throw new Error("OpenCode Scribe could not initialize local Chat paths.");
        this.postMessage({
          type: "init",
          capabilities: this.agent.getCapabilities(),
          locale: vscode.env.language,
          paths,
        });
        const reasoningReviewController = this.getReasoningReviewController?.() ?? this.reasoningReviewController;
        let publishedReasoningRuntime = false;
        if (reasoningReviewController) {
          try {
            const runtime = this.getReasoningRuntime?.() ?? (await reasoningReviewController.getRuntime());
            this.publishReasoningRuntime(runtime);
            publishedReasoningRuntime = true;
          } catch {
            // An optional review runtime must not block ordinary initialization.
          }
        }
        if (!publishedReasoningRuntime) this.publishReasoningReviewPreference();
        this.postMessage({ type: "bundledResources", resources: [...this.bundledResources] });
        this.postMcpPrefs();
        await this.refresh(undefined, paths);
        // 初期アクティブエディタを送信する
        this.publishActiveEditor();
        break;
      }
      case "sendMessage": {
        const bundledCommand =
          message.bundledCommand &&
          this.bundledCommandNames.has(message.bundledCommand.name) &&
          typeof message.bundledCommand.arguments === "string"
            ? ({
                name: message.bundledCommand.name,
                arguments: message.bundledCommand.arguments,
              } satisfies BundledCommandInvocation)
            : undefined;
        const prompt: NormalPrompt = {
          ...message,
          model: message.model && { ...message.model },
          effort: message.effort && { ...message.effort },
          files: message.files?.map((file) => ({ ...file })),
          ...(bundledCommand ? { bundledCommand: { ...bundledCommand } } : { bundledCommand: undefined }),
        };
        const state = this.promptQueues.get(prompt.sessionId) ?? {
          active: false,
          waitingForBusy: false,
          pending: [],
        };
        this.cancelReasoningReviewsForSession(prompt.sessionId, true);
        this.promptQueues.set(prompt.sessionId, state);
        if (state.active || state.pending.length > 0) {
          this.cancelReasoningAssist(prompt.sessionId);
          state.pending.push(prompt);
          this.postQueuedPromptCount(prompt.sessionId, state.pending.length);
          break;
        }
        state.active = true;
        state.waitingForBusy = true;
        this.postQueuedPromptCount(prompt.sessionId, 0);
        await this.dispatchPrompt(prompt, state);
        break;
      }
      case "setReasoningReviewPreference": {
        const seam = this.reasoningReviewPreference;
        if (!seam) break;
        const incoming: unknown = message.preference;
        if (isRecord(incoming)) {
          // Only present, bounded booleans are written: the user toggle writes
          // the Global target and the workspace opt-out writes the Workspace
          // target, never another configuration key.
          if (typeof incoming.userEnabled === "boolean") await seam.setUserEnabled(incoming.userEnabled);
          if (typeof incoming.workspaceOptOut === "boolean") await seam.setWorkspaceOptOut(incoming.workspaceOptOut);
        }
        this.publishReasoningReviewPreference();
        break;
      }
      case "requestReasoningReview": {
        await this.startReasoningReview(message);
        break;
      }
      case "cancelReasoningReview": {
        await this.cancelReasoningReviewRequest(message);
        break;
      }
      case "createSession": {
        const operationGeneration = ++this.sessionOperationGeneration;
        const listRequestGeneration = ++this.sessionListRequestGeneration;
        const session = await this.agent.createSession(message.title);
        if (operationGeneration !== this.sessionOperationGeneration) break;
        await this.publishActiveSession(session, operationGeneration, session.id);
        if (operationGeneration !== this.sessionOperationGeneration) break;
        const sessions = await this.agent.listSessions();
        if (
          operationGeneration !== this.sessionOperationGeneration ||
          listRequestGeneration !== this.sessionListRequestGeneration
        ) {
          break;
        }
        this.postMessage({ type: "sessions", sessions: hiddenSessionRegistry.filterSessions(sessions) });
        break;
      }
      case "listSessions": {
        const operationGeneration = this.sessionOperationGeneration;
        const listRequestGeneration = ++this.sessionListRequestGeneration;
        const sessions = await this.agent.listSessions();
        if (
          operationGeneration !== this.sessionOperationGeneration ||
          listRequestGeneration !== this.sessionListRequestGeneration
        ) {
          break;
        }
        this.postMessage({ type: "sessions", sessions: hiddenSessionRegistry.filterSessions(sessions) });
        break;
      }
      case "selectSession": {
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.getSession(message.sessionId);
        if (operationGeneration !== this.sessionOperationGeneration || !session) break;
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "deleteSession": {
        this.cancelReasoningAssist(message.sessionId);
        this.cancelReasoningReviewsForSession(message.sessionId, false);
        this.clearPromptQueue(message.sessionId);
        const deletesActiveSession = this.activeSession?.id === message.sessionId;
        const operationGeneration = deletesActiveSession
          ? ++this.sessionOperationGeneration
          : this.sessionOperationGeneration;
        const listRequestGeneration = ++this.sessionListRequestGeneration;
        await this.agent.deleteSession(message.sessionId);
        if (deletesActiveSession && this.activeSession?.id === message.sessionId) {
          await this.publishActiveSession(null, operationGeneration, undefined);
        }
        const sessions = await this.agent.listSessions();
        if (
          listRequestGeneration === this.sessionListRequestGeneration &&
          (!deletesActiveSession || operationGeneration === this.sessionOperationGeneration)
        ) {
          this.postMessage({ type: "sessions", sessions: hiddenSessionRegistry.filterSessions(sessions) });
        }
        break;
      }
      case "getMessages": {
        const operationGeneration = this.sessionOperationGeneration;
        const activeSessionId = this.activeSession?.id;
        const messages = await this.agent.getMessages(message.sessionId);
        if (
          operationGeneration !== this.sessionOperationGeneration ||
          (this.activeSession && this.activeSession.id !== message.sessionId) ||
          (activeSessionId !== undefined && activeSessionId !== message.sessionId)
        ) {
          break;
        }
        this.postMessage({ type: "messages", sessionId: message.sessionId, messages });
        break;
      }
      case "replyPermission": {
        const retention = this.retentionPermissions.get(message.permissionId);
        if (retention) {
          this.retentionPermissions.delete(message.permissionId);
          if (Date.now() >= retention.expiresAt) {
            this.invalidatedRetentionPermissions.add(message.permissionId);
            await this.agent.replyPermission(message.sessionId, message.permissionId, "reject");
            break;
          }
          if (!this.memoryRetentionStatus.policy.enabled || !retention.validPayload) {
            await this.agent.replyPermission(message.sessionId, message.permissionId, "reject");
            break;
          }
          // Explicit retention is always confirmation-gated. Do not let a
          // stale or untrusted policy value turn an "always" reply into a
          // persistent permission.
          const response = message.response === "always" ? "once" : message.response;
          await this.agent.replyPermission(message.sessionId, message.permissionId, response);
          break;
        }
        if (this.invalidatedRetentionPermissions.delete(message.permissionId)) {
          await this.agent.replyPermission(message.sessionId, message.permissionId, "reject");
          break;
        }
        await this.agent.replyPermission(message.sessionId, message.permissionId, message.response);
        break;
      }
      case "replyQuestion": {
        await this.agent.replyQuestion(message.requestId, message.answers);
        break;
      }
      case "rejectQuestion": {
        await this.agent.rejectQuestion(message.requestId);
        break;
      }
      case "abort": {
        this.cancelReasoningAssist(message.sessionId);
        this.cancelReasoningReviewsForSession(message.sessionId, true);
        await this.agent.abortSession(message.sessionId);
        break;
      }
      case "getProviders": {
        const [providersData, allProviders, paths] = await Promise.all([
          this.agent.getProviders(),
          this.agent.listAllProviders(),
          this.agent.getPath(),
        ]);
        const configModel = await this.readConfigModel(paths);
        this.postMessage({
          type: "providers",
          providers: providersData.providers,
          allProviders,
          default: providersData.default,
          configModel,
        });
        break;
      }
      // --- Platform operations delegated to IPlatformServices ---
      case "getOpenEditors": {
        const files = await this.platformServices.getOpenEditors();
        this.postMessage({ type: "openEditors", files });
        break;
      }
      case "searchWorkspaceFiles": {
        const files = await this.platformServices.searchWorkspaceFiles(message.query);
        this.postMessage({ type: "workspaceFiles", files });
        break;
      }
      case "compressSession": {
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        await this.agent.summarizeSession(message.sessionId, message.model);
        if (operationGeneration !== this.sessionOperationGeneration) break;
        const session = await this.agent.getSession(message.sessionId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "revertToMessage": {
        this.cancelReasoningAssist(message.sessionId);
        this.cancelReasoningReviewsForSession(message.sessionId, true);
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.revertSession(message.sessionId, message.messageId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "editAndResend": {
        this.cancelReasoningAssist(message.sessionId);
        this.cancelReasoningReviewsForSession(message.sessionId, true);
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        // 1. 指定メッセージまで巻き戻す（そのメッセージ以降を削除）
        const session = await this.agent.revertSession(message.sessionId, message.messageId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        // 2. 編集後のテキストを送信
        await this.agent.sendMessage(message.sessionId, message.text, {
          model: message.model,
          files: message.files,
          ...(message.primaryAgent !== undefined && { primaryAgent: message.primaryAgent }),
          ...(message.system !== undefined || message.primaryAgent !== undefined
            ? { system: this.getSystemPrompt(message.primaryAgent, message.system) }
            : {}),
          ...(message.effort !== undefined && { effort: message.effort }),
        });
        break;
      }
      case "executeShell": {
        this.requireCapability("shell");
        if (typeof message.command !== "string") break;
        await this.agent.executeShell(message.sessionId, message.command, message.model);
        break;
      }
      case "openConfigFile": {
        await this.platformServices.openConfigFile(message.filePath);
        break;
      }
      case "openTerminal": {
        const serverUrl = this.agent.getServerUrl();
        if (!serverUrl) {
          vscode.window.showErrorMessage(
            vscode.l10n.t("OpenCode Scribe: OpenCode server is not connected. Reload the window and try again."),
          );
          break;
        }
        if (!this.activeSession) {
          vscode.window.showErrorMessage(
            vscode.l10n.t("OpenCode Scribe: select an active session before handing off to the TUI."),
          );
          break;
        }
        const sessionId = this.activeSession.id;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t("OpenCode Scribe: exporting session for TUI…"),
            cancellable: false,
          },
          async () => {
            try {
              const exportPath = await this.agent.exportSessionSnapshot(sessionId);
              await this.platformServices.runHandoffTerminal(exportPath);
              vscode.window.showInformationMessage(
                vscode.l10n.t(
                  "OpenCode Scribe: opened independent TUI with a copy of this session. Chat is still running.",
                ),
              );
            } catch (err) {
              vscode.window.showErrorMessage(
                vscode.l10n.t(
                  "OpenCode Scribe: independent TUI handoff is unavailable. Chat is still running. Open the OpenCode TUI manually from a separate terminal if needed.",
                ),
              );
            }
          },
        );
        break;
      }
      case "setModel": {
        // Delegate the in-memory model default to the agent.
        await this.agent.setModel!(message.model);
        this.postMessage({ type: "modelUpdated", model: message.model, default: {} });
        break;
      }
      case "setChatSandboxSettings": {
        if (!this.setChatSandboxSettings) break;
        const previous = this.chatSandboxStatus;
        try {
          const status = await this.setChatSandboxSettings(message.settings);
          this.chatSandboxStatus = status;
          this.postMessage({ type: "chatSandboxStatus", status });
        } catch (error) {
          if (previous) {
            const failedStatus: ChatSandboxStatus = {
              ...previous,
              applying: false,
              error: error instanceof Error ? error.message : String(error),
            };
            this.chatSandboxStatus = failedStatus;
            this.postMessage({ type: "chatSandboxStatus", status: failedStatus });
          }
          throw error;
        }
        break;
      }
      case "forkSession": {
        const operationGeneration = ++this.sessionOperationGeneration;
        const listRequestGeneration = ++this.sessionListRequestGeneration;
        // Fork で新しいセッションを作成し、アクティブセッションを切り替える
        const forkedSession = await this.agent.forkSession(message.sessionId, message.messageId);
        await this.publishActiveSession(forkedSession, operationGeneration, forkedSession.id);
        if (operationGeneration !== this.sessionOperationGeneration) break;
        const forkedSessions = await this.agent.listSessions();
        if (
          operationGeneration !== this.sessionOperationGeneration ||
          listRequestGeneration !== this.sessionListRequestGeneration
        ) {
          break;
        }
        this.postMessage({
          type: "sessions",
          sessions: hiddenSessionRegistry.filterSessions(forkedSessions),
        });
        break;
      }
      case "getSessionDiff": {
        this.requireCapability("sessionDiff");
        const diffs = await this.agent.getSessionDiff(message.sessionId);
        this.postMessage({ type: "sessionDiff", sessionId: message.sessionId, diffs });
        break;
      }
      case "getSessionTodos": {
        this.requireCapability("todo");
        const todos = await this.agent.getSessionTodos(message.sessionId);
        this.postMessage({ type: "sessionTodos", sessionId: message.sessionId, todos });
        break;
      }
      case "getChildSessions": {
        const children = await this.agent.getChildSessions(message.sessionId);
        this.postMessage({ type: "childSessions", sessionId: message.sessionId, children });
        break;
      }
      case "getAgents": {
        const agents = await this.agent.getAgents();
        this.postMessage({ type: "agents", agents: hiddenSessionRegistry.filterAgents(agents) });
        break;
      }
      case "getSkills": {
        const skills = await this.agent.getSkills();
        this.postMessage({ type: "skills", skills });
        break;
      }
      // --- MCP ---
      case "getMcpStatus": {
        const mcpStatus = await this.agent.getMcpStatus();
        this.postMessage({ type: "mcpStatus", status: mcpStatus });
        break;
      }
      case "setMcpPrefs": {
        const incomingPrefs = sanitizeMcpPrefs(message.prefs);
        if (this.chatMcpPrefs) await this.chatMcpPrefs.write(incomingPrefs);
        this.postMcpPrefs();
        break;
      }
      case "connectMcp": {
        await this.agent.connectMcp(message.server);
        const connectStatus = await this.agent.getMcpStatus();
        this.postMessage({ type: "mcpStatus", status: connectStatus });
        break;
      }
      case "disconnectMcp": {
        await this.agent.disconnectMcp(message.server);
        const disconnectStatus = await this.agent.getMcpStatus();
        this.postMessage({ type: "mcpStatus", status: disconnectStatus });
        break;
      }
      case "shareSession": {
        this.requireCapability("sessionShare");
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.shareSession(message.sessionId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        // 共有 URL をクリップボードにコピーする
        if (session.share?.url) {
          await this.platformServices.copyToClipboard(session.share.url);
        }
        break;
      }
      case "unshareSession": {
        this.requireCapability("sessionShare");
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.unshareSession(message.sessionId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "copyToClipboard": {
        await this.platformServices.copyToClipboard(message.text);
        break;
      }
      case "undoSession": {
        this.cancelReasoningReviewsForSession(message.sessionId, true);
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.revertSession(message.sessionId, message.messageId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "redoSession": {
        this.cancelReasoningReviewsForSession(message.sessionId, true);
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.unrevertSession(message.sessionId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "openDiffEditor": {
        await this.platformServices.openDiffEditor(message.filePath, message.before, message.after);
        break;
      }
      case "openFile": {
        await this.platformServices.openFile(message.filePath, message.line);
        break;
      }
    }
  }

  async refresh(chatSandboxStatus?: ChatSandboxStatus, paths?: AppPaths): Promise<void> {
    if (!this.view) return;

    if (!this.agentAvailable) {
      this.postMessage({ type: "memoryStatus", status: this.memoryProviderStatus });
      const sandboxStatus = this.chatSandboxStatus ?? chatSandboxStatus;
      if (sandboxStatus) this.postMessage({ type: "chatSandboxStatus", status: sandboxStatus });
      return;
    }

    const refreshGeneration = ++this.refreshGeneration;
    const isCurrentRefresh = () => refreshGeneration === this.refreshGeneration;
    const operationGeneration = this.sessionOperationGeneration;
    const activeSessionId = this.activeSession?.id;
    const listRequestGeneration = ++this.sessionListRequestGeneration;
    const resolvedPaths = paths ?? (await this.agent.getPath());
    if (!isCurrentRefresh()) return;
    const [sessionsResult, activeSessionResult, providersResult, allProvidersResult, agentsResult, mcpStatusResult] =
      await Promise.allSettled([
        this.agent.listSessions(),
        activeSessionId ? this.agent.getSession(activeSessionId) : Promise.resolve(null),
        this.agent.getProviders(),
        this.agent.listAllProviders(),
        this.agent.getAgents(),
        this.agent.getMcpStatus(),
      ]);
    if (!isCurrentRefresh()) return;
    // One failed catalog must not suppress the others; log only the item name.
    const labelled = [
      ["sessions", sessionsResult],
      ["activeSession", activeSessionResult],
      ["providers", providersResult],
      ["allProviders", allProvidersResult],
      ["agents", agentsResult],
      ["mcpStatus", mcpStatusResult],
    ] as const;
    const failed = labelled.filter(([, result]) => result.status === "rejected").map(([label]) => label);
    if (failed.length > 0) {
      console.error(`[OpenCode] Refresh could not load: ${failed.join(", ")}.`);
    }

    const sessionOperationIsCurrent = operationGeneration === this.sessionOperationGeneration;
    const listRequestIsCurrent = listRequestGeneration === this.sessionListRequestGeneration;
    const refreshedActiveSession = activeSessionResult.status === "fulfilled" ? activeSessionResult.value : null;
    if (sessionOperationIsCurrent && this.activeSession?.id === activeSessionId && this.activeSession) {
      this.activeSession = refreshedActiveSession ?? this.activeSession;
    }

    const configModel = await this.readConfigModel(resolvedPaths);
    if (!isCurrentRefresh()) return;

    if (sessionsResult.status === "fulfilled" && sessionOperationIsCurrent && listRequestIsCurrent) {
      this.postMessage({ type: "sessions", sessions: hiddenSessionRegistry.filterSessions(sessionsResult.value) });
    }
    if (sessionOperationIsCurrent && this.activeSession?.id === activeSessionId) {
      await this.publishActiveSession(this.activeSession, operationGeneration, activeSessionId, isCurrentRefresh);
    }
    if (!isCurrentRefresh()) return;
    if (providersResult.status === "fulfilled" && allProvidersResult.status === "fulfilled") {
      this.postMessage({
        type: "providers",
        providers: providersResult.value.providers,
        allProviders: allProvidersResult.value,
        default: providersResult.value.default,
        configModel,
      });
    }
    if (agentsResult.status === "fulfilled") {
      this.postMessage({ type: "agents", agents: hiddenSessionRegistry.filterAgents(agentsResult.value) });
    }
    if (mcpStatusResult.status === "fulfilled") {
      this.postMessage({ type: "mcpStatus", status: mcpStatusResult.value });
    }
    this.postMessage({ type: "memoryStatus", status: this.memoryProviderStatus });
    const sandboxStatus = this.chatSandboxStatus ?? chatSandboxStatus;
    if (sandboxStatus) {
      this.postMessage({ type: "chatSandboxStatus", status: sandboxStatus });
    }
  }

  /** Reads the configured default model as the "providerID/model" string the Webview consumes. */
  private async readConfigModel(paths: AppPaths): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(path.join(paths.config, "opencode.json"), "utf-8");
      return normalizeConfigModel(JSON.parse(raw).model);
    } catch {
      return undefined;
    }
  }

  publishChatSandboxStatus(status: ChatSandboxStatus): void {
    this.chatSandboxStatus = status;
    if (status.applying) this.refreshGeneration += 1;
    this.postMessage({ type: "chatSandboxStatus", status });
  }

  publishMemoryProviderStatus(status: MemoryProviderStatus): void {
    this.memoryProviderStatus = status;
    this.postMessage({ type: "memoryStatus", status });
  }

  private async publishActiveSession(
    session: ChatSession | null,
    operationGeneration: number,
    expectedSessionId: string | undefined,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    if (
      !isCurrent() ||
      operationGeneration !== this.sessionOperationGeneration ||
      (session && session.id !== expectedSessionId) ||
      (!session && expectedSessionId !== undefined)
    ) {
      return false;
    }
    if (session && hiddenSessionRegistry.isHiddenSessionId(session.id)) return false;

    const previousSessionId = this.activeSession?.id;
    if (previousSessionId && previousSessionId !== session?.id) {
      this.cancelReasoningReviewsForSession(previousSessionId, false);
      void this.clearReasoningAssistBrief(previousSessionId);
    }
    this.activeSession = session;
    this.postMessage({ type: "activeSession", session });
    if (!session) return true;
    this.postQueuedPromptCount(session.id, this.promptQueues.get(session.id)?.pending.length ?? 0);

    const messages = await this.agent.getMessages(session.id);
    if (
      !isCurrent() ||
      operationGeneration !== this.sessionOperationGeneration ||
      this.activeSession?.id !== session.id
    ) {
      return false;
    }
    this.postMessage({ type: "messages", sessionId: session.id, messages });
    return true;
  }

  private isConversationMutationEvent(eventType: string): boolean {
    return [
      "session.updated",
      "session.deleted",
      "session.error",
      "session.status",
      "session.compacted",
      "session.next.context.updated",
      "session.next.step.ended",
      "session.next.compaction.started",
      "session.next.compaction.ended",
      "session.next.reasoning.started",
      "session.next.reasoning.delta",
      "session.next.reasoning.ended",
      "message.updated",
      "message.removed",
      "message.part.updated",
      "message.part.removed",
      "message.part.delta",
    ].includes(eventType);
  }

  private startReconnectRefresh(state: {
    sessionId: string;
    generation: number;
    inFlight: boolean;
    needsRefresh: boolean;
    idleSeen: boolean;
  }): void {
    if (
      !state.needsRefresh ||
      state.inFlight ||
      this.reconnectRefreshState !== state ||
      state.generation !== this.connectionRefreshGeneration ||
      state.sessionId !== this.activeSession?.id
    ) {
      return;
    }
    state.inFlight = true;
    state.idleSeen = false;
    void this.refreshActiveSessionAfterReconnect(state);
  }

  private async refreshActiveSessionAfterReconnect(state: {
    sessionId: string;
    generation: number;
    inFlight: boolean;
    needsRefresh: boolean;
    idleSeen: boolean;
  }): Promise<void> {
    const { sessionId, generation: refreshGeneration } = state;
    const operationGeneration = this.sessionOperationGeneration;
    const eventRevision = this.activeSessionEventRevision;
    try {
      const [session, messages] = await Promise.all([
        this.agent.getSession(sessionId),
        this.agent.getMessages(sessionId),
      ]);
      const current = () =>
        refreshGeneration === this.connectionRefreshGeneration &&
        operationGeneration === this.sessionOperationGeneration &&
        this.activeSession?.id === sessionId &&
        !hiddenSessionRegistry.isHiddenSessionId(sessionId);
      const messagesAreLocal =
        Array.isArray(messages) &&
        messages.every((message) => {
          if (!isRecord(message) || !isRecord(message.info) || !Array.isArray(message.parts)) return false;
          const messageId = message.info.id;
          return (
            typeof messageId === "string" &&
            message.info.sessionID === sessionId &&
            message.parts.every(
              (part) => isRecord(part) && part.sessionID === sessionId && part.messageID === messageId,
            )
          );
        });
      if (!current() || !session || session.id !== sessionId || !messagesAreLocal) return;
      if (eventRevision !== this.activeSessionEventRevision) {
        state.needsRefresh = true;
        return;
      }
      this.activeSession = session;
      this.postMessage({ type: "activeSession", session });
      this.postQueuedPromptCount(sessionId, this.promptQueues.get(sessionId)?.pending.length ?? 0);
      this.postMessage({ type: "messages", sessionId, messages });
      state.needsRefresh = false;
    } catch {
      // Reconnect reads are best-effort; never log server response payloads.
      if (this.reconnectRefreshState === state && refreshGeneration === this.connectionRefreshGeneration) {
        console.error("[OpenCode] Failed to refresh active session after reconnect.");
      }
    } finally {
      state.inFlight = false;
      if (
        this.reconnectRefreshState === state &&
        refreshGeneration === this.connectionRefreshGeneration &&
        this.activeSession?.id === sessionId &&
        state.needsRefresh &&
        state.idleSeen
      ) {
        this.startReconnectRefresh(state);
      }
    }
  }

  /** アクティブなエディタまたはファイル-backed custom tab から FileAttachment を生成する。 */
  private getActiveEditorFile(
    editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor,
  ): import("@opencode-chat/core").FileAttachment | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;

    // A custom or otherwise unsupported active tab must not reuse a stale text editor.
    if (activeTab && !(activeTab.input instanceof vscode.TabInputText)) {
      if (!(activeTab.input instanceof vscode.TabInputCustom)) return null;
      return resolveTabInputFile(activeTab.input, workspaceFolder)?.attachment ?? null;
    }

    if (!editor) return null;
    const uri = editor.document.uri;
    // 出力パネルや設定画面など、file スキーム以外は対象外
    if (uri.scheme !== "file") return null;
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder.fsPath, uri.fsPath)
      : path.basename(uri.fsPath);
    return { filePath: relativePath, fileName: path.basename(uri.fsPath) };
  }

  private publishActiveEditor(editor?: vscode.TextEditor): void {
    this.postMessage({ type: "activeEditor", file: this.getActiveEditorFile(editor) });
  }

  private postMessage(message: HostToUIMessage): void {
    this.view?.webview.postMessage(message);
  }

  private postQueuedPromptCount(sessionId: string, count: number): void {
    this.postMessage({ type: "queuedPrompts", sessionId, count });
  }

  private requireCapability(capability: keyof ReturnType<IAgent["getCapabilities"]>): void {
    if (!this.agent.getCapabilities()[capability]) {
      throw new Error(`OpenCode operation unavailable: ${capability}.`);
    }
  }

  private handleSessionStatus(sessionId: string, status: "busy" | "idle"): void {
    if (sessionId !== this.activeSession?.id) return;
    const state = this.promptQueues.get(sessionId);
    if (status === "busy") {
      const activeState = state ?? { active: true, waitingForBusy: false, pending: [] };
      activeState.active = true;
      activeState.waitingForBusy = false;
      activeState.reconnectIdleDispatch = undefined;
      this.promptQueues.set(sessionId, activeState);
      return;
    }
    if (!state?.active) return;
    if (state.waitingForBusy) {
      const reconnectDispatch = state.reconnectIdleDispatch;
      if (reconnectDispatch !== state.currentDispatch || !reconnectDispatch?.admitted) return;
      state.waitingForBusy = false;
      state.reconnectIdleDispatch = undefined;
    }
    const turn = this.reasoningAssistTurnBySession.get(sessionId);
    if (turn) {
      turn.active = false;
      const entry = this.reasoningAssistInFlight.get(sessionId);
      if (entry && !entry.applied && entry.lastToken !== undefined) {
        this.postMessage({ type: "reasoningAssistCleared", sessionId, promptToken: entry.lastToken });
        entry.lastToken = undefined;
      }
      void this.clearReasoningAssistBrief(sessionId, true, turn.turnId);
    } else {
      void this.clearReasoningAssistBrief(sessionId);
    }
    if (state.pending.length === 0) {
      state.active = false;
      state.currentDispatch = undefined;
      return;
    }
    state.active = true;
    state.waitingForBusy = true;
    const prompt = state.pending.shift();
    if (!prompt) return;
    this.postQueuedPromptCount(sessionId, state.pending.length);
    void this.dispatchPrompt(prompt, state).catch((err) => {
      console.error("[OpenCode] Error handling message 'sendMessage':", err);
    });
  }

  private clearPromptQueue(sessionId: string): void {
    if (!this.promptQueues.delete(sessionId)) return;
    this.postQueuedPromptCount(sessionId, 0);
  }

  /**
   * Invalidate every in-flight preflight for one session: bump the generation
   * so late results can never be current again, post the token-scoped cleared
   * message for the row that was pending, then abort the preflight and its
   * child work. Idempotent, and safe when nothing is in flight.
   */
  private cancelReasoningAssist(sessionId: string): void {
    this.reasoningAssistGenerations.set(sessionId, (this.reasoningAssistGenerations.get(sessionId) ?? 0) + 1);
    const entry = this.reasoningAssistInFlight.get(sessionId);
    const turn = this.reasoningAssistTurnBySession.get(sessionId);
    if (entry) {
      this.reasoningAssistInFlight.delete(sessionId);
      if (entry.lastToken !== undefined) {
        this.postMessage({ type: "reasoningAssistCleared", sessionId, promptToken: entry.lastToken });
      }
      entry.controller.abort();
    }
    if (turn) {
      turn.active = false;
      this.reasoningAssistTurnBySession.delete(sessionId);
    }
    const turnId = turn?.turnId ?? this.reasoningAssistBriefBySession.get(sessionId);
    if (entry || turn || this.reasoningAssistBriefBySession.has(sessionId)) {
      void this.clearReasoningAssistBrief(sessionId, true, turnId);
    }
  }

  /**
   * Stop every session's in-flight assist work. Used on reconnect and
   * deactivation, where no preflight started on the previous connection may
   * surface later.
   */
  cancelAllReasoningAssistWork(): void {
    const sessionIds = new Set([
      ...this.reasoningAssistInFlight.keys(),
      ...this.reasoningAssistTurnBySession.keys(),
      ...this.reasoningAssistBriefBySession.keys(),
    ]);
    for (const sessionId of sessionIds) {
      this.cancelReasoningAssist(sessionId);
    }
    this.clearAllReasoningAssistBriefs();
  }

  private enqueueReasoningAssistBriefOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.reasoningAssistBriefOperations.get(sessionId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const queued = current.then(
      () => undefined,
      () => undefined,
    );
    this.reasoningAssistBriefOperations.set(sessionId, queued);
    void queued.then(() => {
      if (this.reasoningAssistBriefOperations.get(sessionId) === queued) {
        this.reasoningAssistBriefOperations.delete(sessionId);
      }
    });
    return current;
  }

  private async storeReasoningAssistBrief(
    sessionId: string,
    turnId: string,
    brief: string,
  ): Promise<ReasoningAssistBriefDeliveryResult> {
    if (
      typeof brief !== "string" ||
      brief.length === 0 ||
      brief.length > SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS ||
      Buffer.byteLength(brief, "utf8") > SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES ||
      !this.reasoningAssistPluginAvailable ||
      this.reasoningAssistTurnBySession.get(sessionId)?.turnId !== turnId
    ) {
      return { accepted: false, internalGraceWaitMs: 0 };
    }
    this.reasoningAssistBriefBySession.set(sessionId, turnId);
    const result = await this.enqueueReasoningAssistBriefOperation(sessionId, () =>
      this.agent.setReasoningAssistBrief(sessionId, turnId, brief),
    );
    if (!result.accepted && this.reasoningAssistBriefBySession.get(sessionId) === turnId) {
      this.reasoningAssistBriefBySession.delete(sessionId);
    }
    if (result.internalGraceWaitMs > 0) {
      this.emitReasoningDiagnostic({ stage: "brief", outcome: "grace-waited", elapsedMs: result.internalGraceWaitMs });
    }
    return result;
  }

  private async clearReasoningAssistBrief(
    sessionId: string,
    force = false,
    requestedTurnId?: string,
  ): Promise<boolean> {
    const queued = this.reasoningAssistBriefOperations.get(sessionId);
    const activeTurnId =
      requestedTurnId ??
      this.reasoningAssistBriefBySession.get(sessionId) ??
      this.reasoningAssistTurnBySession.get(sessionId)?.turnId;
    if (!force && activeTurnId === undefined) {
      await queued?.catch(() => undefined);
      return true;
    }
    if (activeTurnId !== undefined && this.reasoningAssistBriefBySession.get(sessionId) === activeTurnId) {
      this.reasoningAssistBriefBySession.delete(sessionId);
    }
    const result = await this.enqueueReasoningAssistBriefOperation(sessionId, () =>
      this.agent.clearReasoningAssistBrief(sessionId, activeTurnId),
    );
    if (result.internalGraceWaitMs > 0) {
      this.emitReasoningDiagnostic({ stage: "brief", outcome: "grace-waited", elapsedMs: result.internalGraceWaitMs });
    }
    this.emitReasoningDiagnostic({ stage: "brief", outcome: result.cleared ? "cleared" : "failed" });
    return result.cleared;
  }

  private clearAllReasoningAssistBriefs(): void {
    const sessionIds = new Set([
      ...this.reasoningAssistTurnBySession.keys(),
      ...this.reasoningAssistBriefBySession.keys(),
      ...this.reasoningAssistInFlight.keys(),
    ]);
    for (const sessionId of sessionIds) {
      const turn = this.reasoningAssistTurnBySession.get(sessionId);
      if (turn) {
        turn.active = false;
        this.reasoningAssistTurnBySession.delete(sessionId);
      }
      const turnId = turn?.turnId ?? this.reasoningAssistBriefBySession.get(sessionId);
      void this.clearReasoningAssistBrief(sessionId, true, turnId);
    }
  }

  /** Publish the current host-owned AF/restricted-review readiness snapshot. */
  publishReasoningRuntime(runtime: ReasoningReviewRuntime): void {
    this.reasoningReviewRuntime = runtime;
    this.publishReasoningMessage({ type: "reasoningRuntime", runtime });
    this.publishReasoningReviewPreference();
  }

  /** Cancel and await every manual review before a holder generation is replaced. */
  cancelAllReasoningReviewWork(): void {
    for (const entry of [...this.reasoningReviewInFlight.values()]) {
      void this.cancelReasoningReviewEntry(entry, true);
    }
  }

  private async startReasoningReview(
    request: Extract<UIToHostMessage, { type: "requestReasoningReview" }>,
  ): Promise<void> {
    const startedAt = this.reasoningDiagnosticNow();
    if (!SAFE_REVIEW_REQUEST_ID.test(request.requestId)) {
      this.emitManualReviewDiagnostic("manual-request", "invalid-request", startedAt);
      return;
    }
    if (
      !this.agentAvailable ||
      this.activeSession?.id !== request.sessionId ||
      hiddenSessionRegistry.isHiddenSessionId(request.sessionId)
    ) {
      this.emitManualReviewDiagnostic(
        "manual-request",
        !this.agentAvailable ? "runtime-unready" : "invalid-request",
        startedAt,
      );
      return;
    }

    const key = this.reasoningReviewKey(request.sessionId, request.messageId);
    if (this.reasoningReviewInFlight.has(key)) {
      this.emitManualReviewDiagnostic("manual-request", "duplicate-request", startedAt);
      return;
    }
    const entry: ReasoningReviewInFlightEntry = {
      requestId: request.requestId,
      sessionId: request.sessionId,
      messageId: request.messageId,
      sessionOperationGeneration: this.sessionOperationGeneration,
      connectionRefreshGeneration: this.connectionRefreshGeneration,
      sessionEventRevision: this.activeSessionEventRevision,
      startedAt,
      cancelled: false,
      cancellationAcknowledged: false,
      completion: Promise.resolve(),
    };
    this.reasoningReviewInFlight.set(key, entry);
    this.emitManualReviewDiagnostic("manual-request", "started");
    const completion = this.runReasoningReview(entry);
    entry.completion = completion;
    await completion;
  }

  private async runReasoningReview(entry: ReasoningReviewInFlightEntry): Promise<void> {
    const isCurrent = () => this.isReasoningReviewCurrent(entry);
    try {
      let messages: ChatMessageWithParts[];
      try {
        messages = await this.agent.getMessages(entry.sessionId);
      } catch {
        if (isCurrent()) {
          this.emitManualReviewDiagnostic("manual-request", "message-load-failed", entry.startedAt);
          this.publishReasoningReviewResult(entry, unavailableReasoningReviewSummary(entry.messageId));
        }
        return;
      }
      if (!isCurrent()) {
        this.emitManualReviewDiagnostic("manual-review", "stale", entry.startedAt);
        return;
      }
      const target = messages.find((message) => message.info.id === entry.messageId);
      if (!target) {
        this.emitManualReviewDiagnostic("manual-request", "message-missing", entry.startedAt);
        this.publishReasoningReviewResult(entry, unavailableReasoningReviewSummary(entry.messageId));
        return;
      }
      const validation = validateCompletedScoutAnswer(target, entry.sessionId);
      if (!validation.ok) {
        this.emitManualReviewDiagnostic("manual-request", validation.outcome, entry.startedAt);
        this.publishReasoningReviewResult(entry, unavailableReasoningReviewSummary(entry.messageId));
        return;
      }
      const sourceText = validation.text;
      this.emitManualReviewDiagnostic("manual-request", "answer-valid", entry.startedAt);

      const controller = this.getReasoningReviewController
        ? this.getReasoningReviewController()
        : this.reasoningReviewController;
      if (!controller) {
        this.emitManualReviewDiagnostic("manual-provider", "runtime-unready", entry.startedAt);
        this.publishReasoningReviewResult(entry, unavailableReasoningReviewSummary(entry.messageId));
        return;
      }
      let runtime: ReasoningReviewRuntime | undefined;
      try {
        runtime = this.getReasoningRuntime
          ? this.getReasoningRuntime()
          : (this.reasoningReviewRuntime ?? (await controller.getRuntime()));
      } catch {
        runtime = undefined;
      }
      if (!isCurrent()) {
        this.emitManualReviewDiagnostic("manual-review", "stale", entry.startedAt);
        return;
      }
      if (runtime?.state !== "available") {
        this.emitManualReviewDiagnostic("manual-provider", "runtime-unready", entry.startedAt);
        this.publishReasoningReviewResult(entry, unavailableReasoningReviewSummary(entry.messageId));
        return;
      }

      entry.controller = controller;
      const publishProgress = (stage: ReasoningReviewProgressStage): void => {
        if (!isCurrent()) return;
        this.postMessage({
          type: "reasoningReviewProgress",
          sessionId: entry.sessionId,
          messageId: entry.messageId,
          requestId: entry.requestId,
          stage,
        });
      };
      publishProgress("claimProjection");
      const summary = await controller.review({
        sessionId: entry.sessionId,
        messageId: entry.messageId,
        sourceText,
        invocation: "manual",
        onProgress: publishProgress,
      });
      if (!isCurrent()) {
        this.emitManualReviewDiagnostic("manual-review", "stale", entry.startedAt);
        return;
      }
      this.emitManualReviewDiagnostic(
        "manual-review",
        summary.status === "unavailable" ? "unavailable" : summary.status === "audit_failed" ? "failed" : "completed",
        entry.startedAt,
      );
      this.publishReasoningReviewResult(entry, normalizeReasoningReviewSummary(summary, entry.messageId));
    } catch {
      if (isCurrent()) {
        this.emitManualReviewDiagnostic("manual-review", "failed", entry.startedAt);
        this.publishReasoningReviewResult(entry, unavailableReasoningReviewSummary(entry.messageId));
      } else {
        this.emitManualReviewDiagnostic("manual-review", "stale", entry.startedAt);
      }
    } finally {
      const key = this.reasoningReviewKey(entry.sessionId, entry.messageId);
      if (this.reasoningReviewInFlight.get(key) === entry) this.reasoningReviewInFlight.delete(key);
    }
  }

  private publishReasoningReviewResult(entry: ReasoningReviewInFlightEntry, summary: ReasoningReviewSummary): void {
    const startedAt = this.reasoningDiagnosticNow();
    if (!this.isReasoningReviewCurrent(entry)) {
      this.emitManualReviewDiagnostic("manual-publication", "stale");
      return;
    }
    let outcome: ReasoningDiagnosticOutcome = "publication-failed";
    try {
      this.postMessage({
        type: "reasoningReviewResult",
        sessionId: entry.sessionId,
        messageId: entry.messageId,
        requestId: entry.requestId,
        summary: normalizeReasoningReviewSummary(summary, entry.messageId),
      });
      outcome = "result-published";
    } finally {
      this.emitManualReviewDiagnostic("manual-publication", outcome, startedAt);
    }
  }

  private async cancelReasoningReviewRequest(
    request: Extract<UIToHostMessage, { type: "cancelReasoningReview" }>,
  ): Promise<void> {
    if (!SAFE_REVIEW_REQUEST_ID.test(request.requestId)) return;
    const entry = this.reasoningReviewInFlight.get(this.reasoningReviewKey(request.sessionId, request.messageId));
    if (!entry || entry.requestId !== request.requestId) return;
    await this.cancelReasoningReviewEntry(entry, true);
  }

  private async cancelReasoningReviewEntry(entry: ReasoningReviewInFlightEntry, acknowledge: boolean): Promise<void> {
    const key = this.reasoningReviewKey(entry.sessionId, entry.messageId);
    if (!entry.cancelled) {
      entry.cancelled = true;
      if (this.reasoningReviewInFlight.get(key) === entry) this.reasoningReviewInFlight.delete(key);
      try {
        entry.controller?.cancel(entry.sessionId, entry.messageId);
      } catch {
        // Cancellation is best effort; the controller's generation guard still suppresses publication.
      }
      this.emitManualReviewDiagnostic("manual-review", "cancelled", entry.startedAt);
    }
    await entry.completion.catch(() => undefined);
    if (
      acknowledge &&
      !entry.cancellationAcknowledged &&
      !hiddenSessionRegistry.isHiddenSessionId(entry.sessionId) &&
      this.agentAvailable &&
      this.activeSession?.id === entry.sessionId
    ) {
      entry.cancellationAcknowledged = true;
      const startedAt = this.reasoningDiagnosticNow();
      let outcome: ReasoningDiagnosticOutcome = "publication-failed";
      try {
        this.postMessage({
          type: "reasoningReviewCancelled",
          sessionId: entry.sessionId,
          messageId: entry.messageId,
          requestId: entry.requestId,
        });
        outcome = "cancellation-published";
      } finally {
        this.emitManualReviewDiagnostic("manual-publication", outcome, startedAt);
      }
    }
  }

  private cancelReasoningReviewsForSession(sessionId: string, acknowledge: boolean): void {
    for (const entry of [...this.reasoningReviewInFlight.values()]) {
      if (entry.sessionId === sessionId) void this.cancelReasoningReviewEntry(entry, acknowledge);
    }
  }

  private reasoningReviewKey(sessionId: string, messageId: string): string {
    return `${sessionId}\u0000${messageId}`;
  }

  private isReasoningReviewCurrent(entry: ReasoningReviewInFlightEntry): boolean {
    return (
      !entry.cancelled &&
      this.reasoningReviewInFlight.get(this.reasoningReviewKey(entry.sessionId, entry.messageId)) === entry &&
      this.agentAvailable &&
      this.activeSession?.id === entry.sessionId &&
      !hiddenSessionRegistry.isHiddenSessionId(entry.sessionId) &&
      this.sessionOperationGeneration === entry.sessionOperationGeneration &&
      this.connectionRefreshGeneration === entry.connectionRefreshGeneration &&
      this.activeSessionEventRevision === entry.sessionEventRevision
    );
  }

  private emitManualReviewDiagnostic(
    stage: Extract<ReasoningDiagnosticStage, `manual-${string}`>,
    outcome: ReasoningDiagnosticOutcome,
    startedAt?: number,
  ): void {
    try {
      const elapsedMs =
        startedAt === undefined ? undefined : elapsedReasoningMilliseconds(this.reasoningDiagnosticNow, startedAt);
      this.reasoningDiagnostics({ stage, outcome, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
    } catch {
      // Manual-review diagnostics are optional and cannot alter review behavior.
    }
  }

  /**
   * A prompt is eligible for the reasoning-assist preflight only when it is a
   * plain Scribe text turn: no attachments or bundled command keep the packet
   * pure, a non-Scribe agent has no assist, and the user must have enabled the
   * feature without a workspace opt-out on an available runtime.
   */
  private isReasoningAssistEligible(prompt: NormalPrompt): boolean {
    if (!this.reasoningAssistPluginAvailable) return false;
    if (typeof prompt.text !== "string" || prompt.text.length === 0) return false;
    if (prompt.files && prompt.files.length > 0) return false;
    if (prompt.bundledCommand) return false;
    if ((prompt.primaryAgent ?? prompt.agent ?? "scout") !== "scout") return false;
    const preference = this.reasoningReviewPreference?.read();
    if (!preference?.userEnabled || preference.workspaceOptOut) return false;
    return this.reasoningReviewRuntime?.state === "available";
  }

  private emitReasoningDiagnostic(event: unknown): void {
    try {
      this.reasoningDiagnostics(event);
    } catch {
      // The optional host diagnostics seam is never part of prompt behavior.
    }
  }

  private publishReasoningMessage(message: HostToUIMessage): void {
    const startedAt = this.reasoningDiagnosticNow();
    let outcome: "attempted" | "publication-failed" = "publication-failed";
    try {
      this.postMessage(message);
      outcome = "attempted";
    } finally {
      const elapsedMs = elapsedReasoningMilliseconds(this.reasoningDiagnosticNow, startedAt);
      this.emitReasoningDiagnostic({
        stage: "publication",
        outcome,
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
      });
    }
  }

  private async dispatchPrompt(prompt: NormalPrompt, state: PromptQueueState): Promise<void> {
    const dispatch: PromptDispatch = { admitted: false };
    const dispatchStartedAt = this.reasoningDiagnosticNow();
    let dispatchDiagnosticRecorded = false;
    const recordDispatch = (outcome: "dispatched" | "dispatch-failed"): void => {
      if (dispatchDiagnosticRecorded) return;
      dispatchDiagnosticRecorded = true;
      const elapsedMs = elapsedReasoningMilliseconds(this.reasoningDiagnosticNow, dispatchStartedAt);
      this.emitReasoningDiagnostic({
        stage: "dispatch",
        outcome,
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
      });
    };
    state.currentDispatch = dispatch;
    state.reconnectIdleDispatch = undefined;
    if (
      this.reasoningAssistInFlight.has(prompt.sessionId) ||
      this.reasoningAssistTurnBySession.has(prompt.sessionId) ||
      this.reasoningAssistBriefBySession.has(prompt.sessionId)
    ) {
      this.cancelReasoningAssist(prompt.sessionId);
    }
    let turnId: string | undefined;
    let turn: ReasoningAssistTurnEntry | undefined;
    let assistEntry: ReasoningAssistInFlightEntry | undefined;
    let resolveAdmission: (admitted: boolean) => void = () => undefined;
    let admissionSettled = false;
    const admission = new Promise<boolean>((resolve) => {
      resolveAdmission = resolve;
    });
    const settleAdmission = (admitted: boolean): void => {
      if (admissionSettled) return;
      admissionSettled = true;
      resolveAdmission(admitted);
    };
    try {
      const adapter = this.getReasoningAssistAdapter?.() ?? this.reasoningAssistAdapter;
      if (adapter && this.isReasoningAssistEligible(prompt)) {
        const preScreenStartedAt = this.reasoningDiagnosticNow();
        const preScreen = classifyReasoningAssistPreScreen(prompt.text);
        const preScreenElapsedMs = elapsedReasoningMilliseconds(this.reasoningDiagnosticNow, preScreenStartedAt);
        this.emitReasoningDiagnostic({
          stage: "pre-screen",
          outcome: preScreen,
          ...(preScreenElapsedMs === undefined ? {} : { elapsedMs: preScreenElapsedMs }),
        });

        if (preScreen === "maybe-argument") {
          try {
            turnId = this.agent.createReasoningAssistTurnId();
          } catch {
            turnId = undefined;
          }
          if (typeof turnId === "string" && turnId.length > 0) {
            turn = { turnId, active: true, pending: false };
            this.reasoningAssistTurnBySession.set(prompt.sessionId, turn);
            const generation = this.reasoningAssistGenerations.get(prompt.sessionId) ?? 0;
            assistEntry = { generation, controller: new AbortController() };
            this.reasoningAssistInFlight.set(prompt.sessionId, assistEntry);
            const activeTurn = turn;
            const entry = assistEntry;
            const isCurrent = (): boolean =>
              this.promptQueues.get(prompt.sessionId) === state &&
              this.reasoningAssistInFlight.get(prompt.sessionId) === entry &&
              (this.reasoningAssistGenerations.get(prompt.sessionId) ?? 0) === entry.generation;

            // Start after invoking native admission: architect work cannot delay
            // the prompt call or hold the user's turn on the critical path.
            void Promise.resolve()
              .then(() =>
                runReasoningAssistPreflight({
                  sessionId: prompt.sessionId,
                  userText: prompt.text,
                  adapter,
                  structureRecorder: this.reasoningAssistStructureRecorder,
                  signal: entry.controller.signal,
                  isCurrent,
                  now: this.reasoningDiagnosticNow,
                  onDiagnostic: (event) => this.emitReasoningDiagnostic(event),
                  onArgumentConfirmed: async () => {
                    const confirmationStartedAt = this.reasoningDiagnosticNow();
                    const reportConfirmation = (
                      outcome: "registered" | "confirmation-failed" | "confirmation-threw" | "stale" | "turn-finished",
                    ): void => {
                      const elapsedMs = elapsedReasoningMilliseconds(
                        this.reasoningDiagnosticNow,
                        confirmationStartedAt,
                      );
                      this.emitReasoningDiagnostic({
                        stage: "brief-confirmation",
                        outcome,
                        ...(elapsedMs === undefined ? {} : { elapsedMs }),
                      });
                    };
                    if (!isCurrent()) {
                      reportConfirmation("stale");
                      return false;
                    }
                    if (!activeTurn.active) {
                      reportConfirmation("turn-finished");
                      return "turn-finished";
                    }
                    let pending: boolean;
                    try {
                      pending = await this.enqueueReasoningAssistBriefOperation(prompt.sessionId, () =>
                        this.agent.pendingReasoningAssistTurn(
                          prompt.sessionId,
                          activeTurn.turnId,
                          SCRIBE_REASONING_CONTEXT_GRACE_MS,
                        ),
                      );
                    } catch {
                      reportConfirmation("confirmation-threw");
                      return false;
                    }
                    if (!isCurrent()) {
                      reportConfirmation("stale");
                      return false;
                    }
                    if (!activeTurn.active) {
                      if (pending) {
                        try {
                          await this.clearReasoningAssistBrief(prompt.sessionId, true, activeTurn.turnId);
                        } catch {
                          reportConfirmation("confirmation-threw");
                          return false;
                        }
                      }
                      reportConfirmation("turn-finished");
                      return "turn-finished";
                    }
                    if (!pending) {
                      reportConfirmation("confirmation-failed");
                      return false;
                    }
                    activeTurn.pending = true;
                    reportConfirmation("registered");
                    this.emitReasoningDiagnostic({ stage: "brief", outcome: "pending-argued" });
                    return true;
                  },
                  publishProgress: (stage, promptToken) => {
                    if (!activeTurn.active || !isCurrent()) return;
                    entry.lastToken = promptToken;
                    this.publishReasoningMessage({
                      type: "reasoningAssistProgress",
                      sessionId: prompt.sessionId,
                      promptToken,
                      stage,
                    });
                  },
                }),
              )
              .then(async (result) => {
                if (result.kind !== "argument" || !isCurrent()) return;
                if (!activeTurn.active) {
                  this.emitReasoningDiagnostic({ stage: "brief", outcome: "discarded" });
                  return;
                }

                const input = { facts: result.facts, afState: result.afState };
                const summary = composeReasoningAssistSummary(input);
                const brief = composeReasoningAssistBrief(input);
                if (!summary || !brief) {
                  activeTurn.pending = false;
                  await this.clearReasoningAssistBrief(prompt.sessionId, true, activeTurn.turnId);
                  this.postMessage({
                    type: "reasoningAssistCleared",
                    sessionId: prompt.sessionId,
                    promptToken: result.promptToken,
                  });
                  return;
                }

                const delivery = await this.storeReasoningAssistBrief(prompt.sessionId, activeTurn.turnId, brief);
                const admitted = await admission;
                if (!admitted) return;
                if (!isCurrent()) return;
                if (!activeTurn.active) {
                  if (delivery.accepted) {
                    void this.clearReasoningAssistBrief(prompt.sessionId, true, activeTurn.turnId);
                  }
                  this.emitReasoningDiagnostic({ stage: "brief", outcome: "discarded" });
                  return;
                }
                if (!delivery.accepted) {
                  activeTurn.pending = false;
                  await this.clearReasoningAssistBrief(prompt.sessionId, true, activeTurn.turnId);
                  this.postMessage({
                    type: "reasoningAssistCleared",
                    sessionId: prompt.sessionId,
                    promptToken: result.promptToken,
                  });
                  this.emitReasoningDiagnostic({ stage: "brief", outcome: "skipped" });
                  return;
                }

                this.emitReasoningDiagnostic({
                  stage: "brief",
                  outcome: delivery.internalGraceWaitMs > 0 ? "delivered-late" : "delivered",
                });
                this.publishReasoningMessage({
                  type: "reasoningAssistProgress",
                  sessionId: prompt.sessionId,
                  promptToken: result.promptToken,
                  stage: "preparing",
                });
                this.publishReasoningMessage({
                  type: "reasoningAssistSummary",
                  sessionId: prompt.sessionId,
                  promptToken: result.promptToken,
                  summary,
                });
                this.publishReasoningMessage({
                  type: "reasoningAssistProgress",
                  sessionId: prompt.sessionId,
                  promptToken: result.promptToken,
                  stage: "applied",
                });
                entry.applied = true;
              })
              .catch(() => undefined)
              .finally(() => {
                if (this.reasoningAssistInFlight.get(prompt.sessionId) === entry) {
                  this.reasoningAssistInFlight.delete(prompt.sessionId);
                }
                if (
                  this.reasoningAssistTurnBySession.get(prompt.sessionId) === activeTurn &&
                  (!activeTurn.active || !activeTurn.pending)
                ) {
                  this.reasoningAssistTurnBySession.delete(prompt.sessionId);
                }
              });
          }
        }
      }
      const baseSystem = this.getSystemPrompt(prompt.primaryAgent, prompt.system);
      await this.agent.sendMessage(prompt.sessionId, prompt.text, {
        ...(turnId === undefined ? {} : { turnID: turnId }),
        model: prompt.model,
        files: prompt.files,
        agent: prompt.agent,
        primaryAgent: prompt.primaryAgent,
        skill: prompt.skill,
        ...(prompt.bundledCommand ? { bundledCommand: prompt.bundledCommand } : {}),
        system: baseSystem,
        ...(prompt.effort !== undefined && { effort: prompt.effort }),
      });
      recordDispatch("dispatched");
      settleAdmission(true);
      if (this.promptQueues.get(prompt.sessionId) === state && state.currentDispatch === dispatch) {
        dispatch.admitted = true;
      }
    } catch (err) {
      settleAdmission(false);
      recordDispatch("dispatch-failed");
      if (assistEntry || turn) this.cancelReasoningAssist(prompt.sessionId);
      if (this.promptQueues.get(prompt.sessionId) === state && state.currentDispatch === dispatch) {
        state.active = false;
        state.waitingForBusy = false;
        state.reconnectIdleDispatch = undefined;
        state.pending.unshift(prompt);
        this.postQueuedPromptCount(prompt.sessionId, state.pending.length);
      }
      throw err;
    }
  }

  private postMcpPrefs(): void {
    this.postMessage({
      type: "mcpPrefs",
      prefs: this.chatMcpPrefs?.read() ?? {},
      locked: [...(this.chatMcpLocked?.() ?? [])],
    });
  }

  /** Re-publishes preferences and locked servers after the host re-resolves the MCP inventory. */
  publishMcpPrefs(): void {
    this.postMcpPrefs();
  }

  private loadSystemPrompt(filename: string): string | null {
    try {
      const content = readFileSync(path.join(this.extensionUri.fsPath, filename), "utf-8").trim();
      return content || null;
    } catch {
      return null;
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");

    // Vite がビルドした JS/CSS アセットを参照する
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "assets", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "assets", "index.css"));

    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; style-src-attr 'unsafe-inline'; style-src-elem ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <link rel="stylesheet" href="${styleUri}" nonce="${nonce}" />
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeMcpPrefs(value: Record<string, boolean>): ChatMcpPrefs {
  const prefs: ChatMcpPrefs = {};
  for (const [server, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") prefs[server] = enabled;
  }
  return prefs;
}
