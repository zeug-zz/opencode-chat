import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { validateMemoryRetentionSummary } from "@opencode-chat/agent-opencode";
import type {
  AppPaths,
  BundledCommandInvocation,
  BundledResourceMetadata,
  ChatSandboxSettings,
  ChatSandboxStatus,
  ChatSession,
  HostToUIMessage,
  IAgent,
  IPlatformServices,
  MemoryProviderStatus,
  MemoryRetentionStatus,
  ReasoningReviewRuntime,
  UIToHostMessage,
} from "@opencode-chat/core";
import { DEFAULT_MEMORY_RETENTION_POLICY } from "@opencode-chat/core";
import * as vscode from "vscode";
import type { ChatMcpPrefs, ChatMcpPrefsStore } from "./chat-mcp-prefs";
import { hiddenSessionRegistry } from "./vibefeld/hidden-session-registry";
import type { ArchitectNoAssistReason } from "./vibefeld/reasoning-assist-architect";
import {
  appendReasoningAssistBrief,
  composeReasoningAssistBrief,
  composeReasoningAssistSummary,
} from "./vibefeld/reasoning-assist-brief";
import {
  type ReasoningAssistUnchangedReason,
  runReasoningAssistPreflight,
} from "./vibefeld/reasoning-assist-orchestrator";
import type { ReasoningAssistStructureRecorder } from "./vibefeld/reasoning-assist-structure-recorder";
import type { IReasoningReviewController } from "./vibefeld/reasoning-review-controller";
import type { ReasoningAssistRestrictedReviewAdapter } from "./vibefeld/restricted-review-adapter";
import { resolveEffectiveVibefeldEnabled, type VibefeldPreference } from "./vibefeld/vibefeld-settings";
import { resolveTabInputFile } from "./vscode-platform-services";

type NormalPrompt = Extract<UIToHostMessage, { type: "sendMessage" }>;

type PromptQueueState = {
  active: boolean;
  waitingForBusy: boolean;
  pending: NormalPrompt[];
};

type ReasoningAssistInFlightEntry = {
  generation: number;
  controller: AbortController;
  lastToken?: string;
};

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

/**
 * Fixed bound on the distinct preflight outcome reasons one host instance
 * diagnoses. Reasons already tracked are never logged again, and once the
 * bound is reached no new reason is tracked, so a hostile or varied prompt
 * stream cannot grow host diagnostics without limit.
 */
const REASONING_ASSIST_OUTCOME_DIAGNOSTIC_LIMIT = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  private sessionListRequestGeneration = 0;
  private chatSandboxStatus: ChatSandboxStatus | undefined;
  private memoryProviderStatus: MemoryProviderStatus;
  private memoryRetentionStatus: MemoryRetentionStatus;
  private readonly chatSystemPrompt: string | null;
  private readonly writeSystemPrompt: string | null;
  private readonly setChatSandboxSettings?: (settings: ChatSandboxSettings) => Promise<ChatSandboxStatus>;
  private readonly reasoningReviewController?: IReasoningReviewController;
  private readonly reasoningReviewPreference?: ReasoningReviewPreferenceSeam;
  /**
   * Optional host-private reasoning-assist preflight adapter. Absent means the
   * assist is fully disabled and no hidden preflight work is ever performed.
   */
  private readonly reasoningAssistAdapter?: ReasoningAssistRestrictedReviewAdapter;
  /**
   * Optional host-private AF structure recorder for the reasoning-assist
   * preflight. Absent means AF facts are never requested.
   */
  private readonly reasoningAssistStructureRecorder?: ReasoningAssistStructureRecorder;
  private reasoningReviewRuntime: ReasoningReviewRuntime | undefined;
  private readonly chatMcpPrefs?: ChatMcpPrefsStore;
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
  private readonly retentionPermissions = new Map<
    string,
    { sessionId: string; validPayload: boolean; expiresAt: number }
  >();
  private readonly invalidatedRetentionPermissions = new Set<string>();
  /**
   * Bounded preflight outcome diagnostics: each distinct reason key (the
   * reason, plus for invalid results its `/`-joined parse sub-reason) is
   * logged at most once per instance, up to
   * `REASONING_ASSIST_OUTCOME_DIAGNOSTIC_LIMIT` distinct keys. No text,
   * packet, token, or identifier is ever logged.
   */
  private readonly reasoningAssistOutcomeReasons = new Set<string>();
  private reasoningAssistArgumentLogged = false;

  private clearRetentionPermissions(sessionId: string): void {
    for (const [permissionId, permission] of this.retentionPermissions) {
      if (permission.sessionId !== sessionId) continue;
      this.retentionPermissions.delete(permissionId);
      this.invalidatedRetentionPermissions.add(permissionId);
      setTimeout(() => this.invalidatedRetentionPermissions.delete(permissionId), MEMORY_RETENTION_CONFIRMATION_TTL_MS);
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
      reasoningReviewPreference?: ReasoningReviewPreferenceSeam;
      reasoningAssistAdapter?: ReasoningAssistRestrictedReviewAdapter;
      reasoningAssistStructureRecorder?: ReasoningAssistStructureRecorder;
      chatMcpPrefs?: ChatMcpPrefsStore;
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
    this.reasoningReviewPreference = options?.reasoningReviewPreference;
    this.reasoningAssistAdapter = options?.reasoningAssistAdapter;
    this.reasoningAssistStructureRecorder = options?.reasoningAssistStructureRecorder;
    this.chatMcpPrefs = options?.chatMcpPrefs;
    this.bundledResources = options?.bundledResources ?? [];
    this.bundledCommandNames = new Set(options?.bundledCommandNames ?? []);
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
      let eventForWebview = event;
      if (event.type === "permission.asked" && event.properties.permission === MEMORY_RETENTION_PERMISSION) {
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
        this.cancelReasoningAssist(event.properties.info.id);
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
        this.cancelAllReasoningAssistWork();
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
    switch (message.type) {
      case "ready": {
        // Webview の初期化完了時に init メッセージを送信する（locale + toolConfig を統合）
        const paths = await this.agent.getPath();
        this.postMessage({
          type: "init",
          capabilities: this.agent.getCapabilities(),
          locale: vscode.env.language,
          paths,
        });
        if (this.reasoningReviewController) {
          try {
            const runtime = await this.reasoningReviewController.getRuntime();
            this.reasoningReviewRuntime = runtime;
            this.postMessage({ type: "reasoningRuntime", runtime });
          } catch {
            // An optional review runtime must not block ordinary initialization.
          }
        }
        this.publishReasoningReviewPreference();
        this.postMessage({ type: "bundledResources", resources: [...this.bundledResources] });
        this.postMcpPrefs();
        await this.refresh(undefined, paths);
        if (this.chatSandboxStatus) {
          this.postMessage({ type: "chatSandboxStatus", status: this.chatSandboxStatus });
        }
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
        this.promptQueues.set(prompt.sessionId, state);
        if (state.active || state.pending.length > 0) {
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
        await this.agent.abortSession(message.sessionId);
        break;
      }
      case "getProviders": {
        const [providersData, allProviders, paths] = await Promise.all([
          this.agent.getProviders(),
          this.agent.listAllProviders(),
          this.agent.getPath(),
        ]);
        let configModel: string | undefined;
        try {
          const raw = await fs.readFile(path.join(paths.config, "opencode.json"), "utf-8");
          configModel = JSON.parse(raw).model;
        } catch {
          // ignore
        }
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
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.revertSession(message.sessionId, message.messageId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "editAndResend": {
        this.cancelReasoningAssist(message.sessionId);
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
              const msg = err instanceof Error ? err.message : String(err);
              const choice = await vscode.window.showErrorMessage(
                vscode.l10n.t(
                  "OpenCode Scribe: independent TUI handoff failed ({0}). Chat is still running. Open on the OpenCode server instead?",
                  msg.slice(0, 200),
                ),
                vscode.l10n.t("Open on chat server"),
              );
              if (choice === vscode.l10n.t("Open on chat server")) {
                await this.platformServices.openTerminal(serverUrl, sessionId);
              }
            }
          },
        );
        break;
      }
      case "setModel": {
        // Delegate model persistence to the agent (OpenCode-specific config file workaround)
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
        const diffs = await this.agent.getSessionDiff(message.sessionId);
        this.postMessage({ type: "sessionDiff", sessionId: message.sessionId, diffs });
        break;
      }
      case "getSessionTodos": {
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
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.revertSession(message.sessionId, message.messageId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "redoSession": {
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

    const operationGeneration = this.sessionOperationGeneration;
    const activeSessionId = this.activeSession?.id;
    const listRequestGeneration = ++this.sessionListRequestGeneration;
    const resolvedPaths = paths ?? (await this.agent.getPath());
    const sessionsPromise = this.agent.listSessions();
    const activeSessionPromise = activeSessionId ? this.agent.getSession(activeSessionId) : Promise.resolve(null);
    const [sessions, refreshedActiveSession, providersData, allProviders, agents, mcpStatus] = await Promise.all([
      sessionsPromise,
      activeSessionPromise,
      this.agent.getProviders(),
      this.agent.listAllProviders(),
      this.agent.getAgents(),
      this.agent.getMcpStatus(),
    ]);

    const sessionOperationIsCurrent = operationGeneration === this.sessionOperationGeneration;
    const listRequestIsCurrent = listRequestGeneration === this.sessionListRequestGeneration;
    if (sessionOperationIsCurrent && this.activeSession?.id === activeSessionId && this.activeSession) {
      this.activeSession = refreshedActiveSession ?? this.activeSession;
    }

    let configModel: string | undefined;
    try {
      const raw = await fs.readFile(path.join(resolvedPaths.config, "opencode.json"), "utf-8");
      configModel = JSON.parse(raw).model;
    } catch {}

    if (sessionOperationIsCurrent && listRequestIsCurrent) {
      this.postMessage({ type: "sessions", sessions: hiddenSessionRegistry.filterSessions(sessions) });
    }
    if (sessionOperationIsCurrent && this.activeSession?.id === activeSessionId) {
      await this.publishActiveSession(this.activeSession, operationGeneration, activeSessionId);
    }
    this.postMessage({
      type: "providers",
      providers: providersData.providers,
      allProviders,
      default: providersData.default,
      configModel,
    });
    this.postMessage({ type: "agents", agents: hiddenSessionRegistry.filterAgents(agents) });
    this.postMessage({ type: "mcpStatus", status: mcpStatus });
    this.postMessage({ type: "memoryStatus", status: this.memoryProviderStatus });
    if (chatSandboxStatus) {
      this.postMessage({ type: "chatSandboxStatus", status: chatSandboxStatus });
    }
  }

  publishChatSandboxStatus(status: ChatSandboxStatus): void {
    this.chatSandboxStatus = status;
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
  ): Promise<boolean> {
    if (
      operationGeneration !== this.sessionOperationGeneration ||
      (session && session.id !== expectedSessionId) ||
      (!session && expectedSessionId !== undefined)
    ) {
      return false;
    }
    if (session && hiddenSessionRegistry.isHiddenSessionId(session.id)) return false;

    this.activeSession = session;
    this.postMessage({ type: "activeSession", session });
    if (!session) return true;
    this.postQueuedPromptCount(session.id, this.promptQueues.get(session.id)?.pending.length ?? 0);

    const messages = await this.agent.getMessages(session.id);
    if (operationGeneration !== this.sessionOperationGeneration || this.activeSession?.id !== session.id) {
      return false;
    }
    this.postMessage({ type: "messages", sessionId: session.id, messages });
    return true;
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

  private handleSessionStatus(sessionId: string, status: "busy" | "idle"): void {
    if (sessionId !== this.activeSession?.id) return;
    const state = this.promptQueues.get(sessionId);
    if (status === "busy") {
      const activeState = state ?? { active: true, waitingForBusy: false, pending: [] };
      activeState.active = true;
      activeState.waitingForBusy = false;
      this.promptQueues.set(sessionId, activeState);
      return;
    }
    if (!state?.active) return;
    if (state.waitingForBusy) {
      return;
    }
    if (state.pending.length === 0) {
      state.active = false;
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
    if (!entry) return;
    this.reasoningAssistInFlight.delete(sessionId);
    if (entry.lastToken !== undefined) {
      this.postMessage({ type: "reasoningAssistCleared", sessionId, promptToken: entry.lastToken });
    }
    entry.controller.abort();
  }

  /**
   * Stop every session's in-flight assist work. Used on reconnect and
   * deactivation, where no preflight started on the previous connection may
   * surface later.
   */
  cancelAllReasoningAssistWork(): void {
    for (const sessionId of [...this.reasoningAssistInFlight.keys()]) {
      this.cancelReasoningAssist(sessionId);
    }
  }

  /**
   * A prompt is eligible for the reasoning-assist preflight only when it is a
   * plain Scribe text turn: no attachments or bundled command keep the packet
   * pure, a non-Scribe agent has no assist, and the user must have enabled the
   * feature without a workspace opt-out on an available runtime.
   */
  private isReasoningAssistEligible(prompt: NormalPrompt): boolean {
    if (typeof prompt.text !== "string" || prompt.text.length === 0) return false;
    if (prompt.files && prompt.files.length > 0) return false;
    if (prompt.bundledCommand) return false;
    if ((prompt.primaryAgent ?? prompt.agent ?? "scout") !== "scout") return false;
    const preference = this.reasoningReviewPreference?.read();
    if (!preference?.userEnabled || preference.workspaceOptOut) return false;
    return this.reasoningReviewRuntime?.state === "available";
  }

  /**
   * Record one bounded preflight outcome diagnostic. Each distinct reason key
   * is logged at most once per host instance and no more than
   * `REASONING_ASSIST_OUTCOME_DIAGNOSTIC_LIMIT` distinct reason keys are ever
   * tracked; ordinary outcomes are informational while every other reason is
   * an error-level diagnostic. For an invalid stage result the key composes
   * `reason/parseReason` so each bounded schema-validation sub-reason gets its
   * own line, and the message additionally names the numeric stage text
   * length. A timed-out stage or expired preflight names the numeric elapsed
   * stage time instead. It never names raw stage text, packet content, or
   * identifiers.
   */
  private logReasoningAssistOutcome(
    reason: ReasoningAssistUnchangedReason,
    stageTextLength?: number,
    parseReason?: ArchitectNoAssistReason,
    stageElapsedMs?: number,
  ): void {
    const reasonKey = parseReason === undefined ? reason : `${reason}/${parseReason}`;
    if (this.reasoningAssistOutcomeReasons.has(reasonKey)) return;
    if (this.reasoningAssistOutcomeReasons.size >= REASONING_ASSIST_OUTCOME_DIAGNOSTIC_LIMIT) return;
    this.reasoningAssistOutcomeReasons.add(reasonKey);
    const stageText = stageTextLength === undefined ? "" : ` stageTextLength=${stageTextLength}`;
    const stageElapsed = stageElapsedMs === undefined ? "" : ` stageElapsedMs=${stageElapsedMs}`;
    const message = `[opencode-chat] Reasoning assist preflight outcome (${reasonKey})${stageText}${stageElapsed}`;
    if (reason === "ordinary") console.log(message);
    else console.error(message);
  }

  private async dispatchPrompt(prompt: NormalPrompt, state: PromptQueueState): Promise<void> {
    try {
      const adapter = this.reasoningAssistAdapter;
      let assist: Readonly<{ brief: string; promptToken: string }> | undefined;
      if (adapter && this.isReasoningAssistEligible(prompt)) {
        const generation = this.reasoningAssistGenerations.get(prompt.sessionId) ?? 0;
        const entry: ReasoningAssistInFlightEntry = { generation, controller: new AbortController() };
        this.reasoningAssistInFlight.set(prompt.sessionId, entry);
        // A preflight is current only while it still owns this prompt's queue
        // state and the session's in-flight slot, and no cancellation bumped
        // its generation. Cancellation and supersession therefore invalidate
        // every later publication from the same run.
        const isCurrent = (): boolean =>
          this.promptQueues.get(prompt.sessionId) === state &&
          this.reasoningAssistInFlight.get(prompt.sessionId) === entry &&
          (this.reasoningAssistGenerations.get(prompt.sessionId) ?? 0) === entry.generation;
        try {
          const result = await runReasoningAssistPreflight({
            sessionId: prompt.sessionId,
            userText: prompt.text,
            adapter,
            structureRecorder: this.reasoningAssistStructureRecorder,
            signal: entry.controller.signal,
            isCurrent,
            publishProgress: (stage, promptToken) => {
              entry.lastToken = promptToken;
              this.postMessage({ type: "reasoningAssistProgress", sessionId: prompt.sessionId, promptToken, stage });
            },
          });
          if (result.kind === "argument") {
            // The argument map itself is a bounded, once-per-instance
            // diagnostic fact; it never names prompt or graph content.
            if (!this.reasoningAssistArgumentLogged) {
              this.reasoningAssistArgumentLogged = true;
              console.log("[opencode-chat] Reasoning assist preflight produced an argument map");
            }
            // Retaining a summary and adding the brief are publications too, so
            // the currency guard gates them exactly like live progress.
            if (isCurrent()) {
              const input = { facts: result.facts, afState: result.afState, objections: result.objections };
              const summary = composeReasoningAssistSummary(input);
              const brief = composeReasoningAssistBrief(input);
              if (summary && brief) {
                this.postMessage({
                  type: "reasoningAssistProgress",
                  sessionId: prompt.sessionId,
                  promptToken: result.promptToken,
                  stage: "preparing",
                });
                this.postMessage({
                  type: "reasoningAssistSummary",
                  sessionId: prompt.sessionId,
                  promptToken: result.promptToken,
                  summary,
                });
                assist = { brief, promptToken: result.promptToken };
              } else {
                // Bounded failure: no valid brief means no retained row, and the
                // prompt still dispatches unchanged.
                this.postMessage({
                  type: "reasoningAssistCleared",
                  sessionId: prompt.sessionId,
                  promptToken: result.promptToken,
                });
              }
            }
          } else if (result.kind === "dispatch-unchanged") {
            // A stale preflight posts nothing so it can never clear a newer prompt
            // row; an ordinary outcome clears only its own token-scoped row.
            this.logReasoningAssistOutcome(
              result.reason,
              result.stageTextLength,
              result.parseReason,
              result.stageElapsedMs,
            );
            this.postMessage({
              type: "reasoningAssistCleared",
              sessionId: prompt.sessionId,
              promptToken: result.promptToken,
            });
          }
        } finally {
          // Deleting only this entry keeps newer work registered, and a
          // cancelled run never resurrects its slot.
          if (this.reasoningAssistInFlight.get(prompt.sessionId) === entry) {
            this.reasoningAssistInFlight.delete(prompt.sessionId);
          }
        }
      }
      const baseSystem = this.getSystemPrompt(prompt.primaryAgent, prompt.system);
      await this.agent.sendMessage(prompt.sessionId, prompt.text, {
        model: prompt.model,
        files: prompt.files,
        agent: prompt.agent,
        primaryAgent: prompt.primaryAgent,
        skill: prompt.skill,
        ...(prompt.bundledCommand ? { bundledCommand: prompt.bundledCommand } : {}),
        system: assist ? appendReasoningAssistBrief(baseSystem, assist.brief) : baseSystem,
        ...(prompt.effort !== undefined && { effort: prompt.effort }),
      });
      if (assist && this.promptQueues.get(prompt.sessionId) === state) {
        this.postMessage({
          type: "reasoningAssistProgress",
          sessionId: prompt.sessionId,
          promptToken: assist.promptToken,
          stage: "applied",
        });
      }
    } catch (err) {
      if (this.promptQueues.get(prompt.sessionId) === state) {
        state.active = false;
        state.waitingForBusy = false;
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
      locked: [],
    });
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
