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
  ReasoningReviewStatus,
  ReasoningReviewSummary,
  UIToHostMessage,
} from "@opencode-chat/core";
import { DEFAULT_MEMORY_RETENTION_POLICY } from "@opencode-chat/core";
import * as vscode from "vscode";
import type { ChatMcpPrefs, ChatMcpPrefsStore } from "./chat-mcp-prefs";
import { validateAutomaticRoutingEvaluation } from "./vibefeld/automatic-routing-evaluation";
import { type AutomaticRoutingBinding, createAutomaticRoutingLifecycle } from "./vibefeld/automatic-routing-lifecycle";
import type {
  AutomaticRoutingEvaluation,
  AutomaticRoutingPolicyDecision,
  AutomaticRoutingPolicyInput,
  AutomaticRoutingRequestClass,
  AutomaticRoutingStructuralSignals,
  AutomaticRoutingWorkMode,
} from "./vibefeld/automatic-routing-policy";
import { hiddenSessionRegistry } from "./vibefeld/hidden-session-registry";
import type { QualificationRecorderSeam } from "./vibefeld/qualification-recorder";
import type { IReasoningReviewController } from "./vibefeld/reasoning-review-controller";
import { buildReasoningReviewSourcePacket } from "./vibefeld/reasoning-review-source-packet";
import { resolveEffectiveVibefeldEnabled, type VibefeldPreference } from "./vibefeld/vibefeld-settings";
import { resolveTabInputFile } from "./vscode-platform-services";

type NormalPrompt = Extract<UIToHostMessage, { type: "sendMessage" }>;

type PromptQueueState = {
  active: boolean;
  waitingForBusy: boolean;
  pending: NormalPrompt[];
};

type InFlightReasoningReview = {
  sessionId: string;
  messageId: string;
  token: number;
};

/** Host-private metadata retained for the next post-response routing pass. */
type LatestAutomaticRoutingMetadata = Readonly<{
  sessionId: string;
  generation: number;
  workMode: AutomaticRoutingWorkMode | "unsupported";
  requestClass: AutomaticRoutingRequestClass;
  signals: AutomaticRoutingStructuralSignals;
}>;

export type AutomaticRoutingRouter = (input: AutomaticRoutingPolicyInput) => AutomaticRoutingPolicyDecision;

export type AutomaticRoutingOptions = Readonly<{
  enabled: boolean;
  evaluation?: AutomaticRoutingEvaluation;
  /**
   * Optional dynamic evaluation source. When present it is read at selection
   * time (falling back to `evaluation` when it reports nothing), so a
   * host-private recorder can expose its aggregate as soon as the case
   * minimum is reached without re-constructing the provider.
   */
  evaluationProvider?: () => AutomaticRoutingEvaluation | undefined;
  router?: AutomaticRoutingRouter;
}>;

/** Host-private evidence retained for the bounded feedback that follows a completed review. */
type PendingQualificationEvidence = Readonly<{
  latencyMs: number;
  status: ReasoningReviewStatus;
  hasOpenChallenges: boolean;
}>;

/** Bounds the retained completion evidence; nothing here leaves the host. */
const MAX_PENDING_QUALIFICATION_EVIDENCE = 200;
const MAX_QUALIFICATION_ID_LENGTH = 256;

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
  private reasoningReviewRuntime: ReasoningReviewRuntime | undefined;
  private readonly qualificationRecorder?: QualificationRecorderSeam;
  private readonly pendingQualificationEvidence = new Map<string, PendingQualificationEvidence>();
  private readonly automaticRouting?: AutomaticRoutingOptions;
  private readonly automaticRoutingLifecycle = createAutomaticRoutingLifecycle();
  private latestAutomaticRoutingMetadata: LatestAutomaticRoutingMetadata | undefined;
  private readonly chatMcpPrefs?: ChatMcpPrefsStore;
  private readonly bundledResources: readonly BundledResourceMetadata[];
  private readonly bundledCommandNames: ReadonlySet<string>;
  private readonly promptQueues = new Map<string, PromptQueueState>();
  private readonly inFlightReasoningReviews = new Map<string, InFlightReasoningReview>();
  private readonly inFlightAutomaticReviews = new Map<
    string,
    Readonly<{ attemptId: string; binding: AutomaticRoutingBinding }>
  >();
  private reasoningReviewToken = 0;
  private readonly retentionPermissions = new Map<
    string,
    { sessionId: string; validPayload: boolean; expiresAt: number }
  >();
  private readonly invalidatedRetentionPermissions = new Set<string>();

  private clearRetentionPermissions(sessionId: string): void {
    for (const [permissionId, permission] of this.retentionPermissions) {
      if (permission.sessionId !== sessionId) continue;
      this.retentionPermissions.delete(permissionId);
      this.invalidatedRetentionPermissions.add(permissionId);
      setTimeout(() => this.invalidatedRetentionPermissions.delete(permissionId), MEMORY_RETENTION_CONFIRMATION_TTL_MS);
    }
  }

  private reasoningReviewKey(sessionId: string, messageId: string): string {
    return `${sessionId}\u0000${messageId}`;
  }

  /**
   * Retain the bounded latency/status facts for a completed review until the
   * bounded review-card feedback arrives. Only the summary status and its
   * open-challenge bit are kept; review text and the summary itself are
   * discarded. Retention is capped, so abandoned evidence can never grow.
   */
  private retainQualificationEvidence(
    sessionId: string,
    messageId: string,
    latencyMs: number,
    summary: ReasoningReviewSummary,
  ): void {
    if (!this.qualificationRecorder || !this.isQualificationCaptureEnabled()) {
      this.pendingQualificationEvidence.clear();
      return;
    }
    const key = this.reasoningReviewKey(sessionId, messageId);
    if (
      !this.pendingQualificationEvidence.has(key) &&
      this.pendingQualificationEvidence.size >= MAX_PENDING_QUALIFICATION_EVIDENCE
    ) {
      const oldest = this.pendingQualificationEvidence.keys().next().value;
      if (oldest !== undefined) this.pendingQualificationEvidence.delete(oldest);
    }
    this.pendingQualificationEvidence.set(key, {
      latencyMs,
      status: summary.status,
      hasOpenChallenges: summary.openChallenges.length > 0,
    });
  }

  /**
   * Record one bounded aggregate case. Every incoming field is re-validated at
   * runtime, the completed review must already be host-observed for this
   * session/message, and the challenge signal is normalized to a review that
   * actually raised open challenges. Nothing is stored on failure.
   */
  private recordQualificationFeedback(
    sessionId: unknown,
    messageId: unknown,
    correct: unknown,
    falseChallenge: unknown,
  ): void {
    const recorder = this.qualificationRecorder;
    if (!recorder || !this.isQualificationCaptureEnabled()) {
      this.pendingQualificationEvidence.delete(this.reasoningReviewKey(String(sessionId), String(messageId)));
      return;
    }
    if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > MAX_QUALIFICATION_ID_LENGTH) {
      return;
    }
    if (typeof messageId !== "string" || messageId.length === 0 || messageId.length > MAX_QUALIFICATION_ID_LENGTH) {
      return;
    }
    if (typeof correct !== "boolean") return;
    if (falseChallenge !== undefined && typeof falseChallenge !== "boolean") return;
    const key = this.reasoningReviewKey(sessionId, messageId);
    const pending = this.pendingQualificationEvidence.get(key);
    if (!pending) return;
    const result = recorder.record({
      latencyMs: pending.latencyMs,
      status: pending.status,
      feedback: {
        correct,
        falseChallenge: pending.hasOpenChallenges && falseChallenge === true,
      },
    });
    // Consume the evidence only after an accepted case, so duplicate feedback
    // can never double-count and a rejected tuple stores nothing.
    if (result.ok) this.pendingQualificationEvidence.delete(key);
  }

  private isQualificationCaptureEnabled(): boolean {
    if (!this.reasoningReviewPreference) return true;
    return resolveEffectiveVibefeldEnabled(this.reasoningReviewPreference.read(), this.reasoningReviewRuntime);
  }

  private invalidateReasoningReview(sessionId: string, messageId: string, cancelUnderlying: boolean): void {
    const key = this.reasoningReviewKey(sessionId, messageId);
    if (!this.inFlightReasoningReviews.delete(key)) return;
    if (cancelUnderlying) this.reasoningReviewController?.cancel(sessionId, messageId);
  }

  private invalidateAllReasoningReviews(cancelUnderlying: boolean): void {
    const reviews = [...this.inFlightReasoningReviews.values()];
    this.inFlightReasoningReviews.clear();
    const automaticReviews = [...this.inFlightAutomaticReviews.values()];
    this.inFlightAutomaticReviews.clear();
    if (!cancelUnderlying) return;
    for (const review of reviews) this.reasoningReviewController?.cancel(review.sessionId, review.messageId);
    for (const review of automaticReviews) {
      this.automaticRoutingLifecycle.cancel(review.attemptId, review.binding);
      this.reasoningReviewController?.cancel(review.binding.sessionId, review.binding.messageId);
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
      qualificationRecorder?: QualificationRecorderSeam;
      automaticRouting?: AutomaticRoutingOptions;
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
    this.qualificationRecorder = options?.qualificationRecorder;
    this.automaticRouting = options?.automaticRouting;
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
      const properties = event.properties as unknown as { sessionID?: string; info?: { id?: string; title?: string } };
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
        this.clearAutomaticRoutingMetadata(event.properties.info.id);
        this.clearPromptQueue(event.properties.info.id);
        this.clearRetentionPermissions(event.properties.info.id);
        this.invalidateReasoningReviewsForSession(event.properties.info.id, true);
        if (this.activeSession?.id === event.properties.info.id) {
          this.invalidateAutomaticRoutingReviewsForSession(event.properties.info.id);
        }
      } else if (event.type === "session.error") {
        this.clearRetentionPermissions(event.properties.sessionID);
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
      case "requestReasoningReview": {
        const controller = this.reasoningReviewController;
        if (!controller || this.activeSession?.id !== message.sessionId) break;

        const key = this.reasoningReviewKey(message.sessionId, message.messageId);
        this.invalidateReasoningReview(message.sessionId, message.messageId, true);
        const review = {
          sessionId: message.sessionId,
          messageId: message.messageId,
          token: ++this.reasoningReviewToken,
        } satisfies InFlightReasoningReview;
        this.inFlightReasoningReviews.set(key, review);
        const manualBinding = {
          sessionId: message.sessionId,
          messageId: message.messageId,
          generation: this.sessionOperationGeneration,
        };
        this.automaticRoutingLifecycle.beginManual(manualBinding);
        try {
          const messages = await this.agent.getMessages(message.sessionId);
          if (
            this.inFlightReasoningReviews.get(key)?.token !== review.token ||
            this.activeSession?.id !== message.sessionId
          ) {
            break;
          }
          const targetMessage = messages.find(
            (candidate) =>
              candidate.info.id === message.messageId &&
              candidate.info.sessionID === message.sessionId &&
              candidate.info.role === "assistant" &&
              candidate.info.time.completed !== undefined,
          );
          if (!targetMessage) break;

          const reviewStartedAt = Date.now();
          const summary = await controller.review({
            sessionId: message.sessionId,
            messageId: message.messageId,
            sourceText: buildReasoningReviewSourcePacket(targetMessage),
            invocation: "manual",
          });
          if (
            this.inFlightReasoningReviews.get(key)?.token !== review.token ||
            this.activeSession?.id !== review.sessionId ||
            summary.reviewedMessageId !== message.messageId
          ) {
            break;
          }
          this.retainQualificationEvidence(
            message.sessionId,
            message.messageId,
            Math.max(0, Date.now() - reviewStartedAt),
            summary,
          );
          this.postMessage({ type: "reasoningReview", sessionId: message.sessionId, summary });
        } finally {
          this.automaticRoutingLifecycle.endManual(manualBinding);
          if (this.inFlightReasoningReviews.get(key)?.token === review.token) {
            this.inFlightReasoningReviews.delete(key);
          }
        }
        break;
      }
      case "cancelReasoningReview": {
        if (this.activeSession?.id !== message.sessionId) break;
        this.invalidateReasoningReview(message.sessionId, message.messageId, false);
        this.reasoningReviewController?.cancel(message.sessionId, message.messageId);
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
        if (!this.isQualificationCaptureEnabled()) {
          this.pendingQualificationEvidence.clear();
          this.clearAutomaticRoutingMetadata();
          this.invalidateAllReasoningReviews(true);
        }
        this.publishReasoningReviewPreference();
        break;
      }
      case "setReasoningReviewFeedback": {
        if (this.activeSession?.id !== message.sessionId) break;
        this.recordQualificationFeedback(message.sessionId, message.messageId, message.correct, message.falseChallenge);
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
        this.clearAutomaticRoutingMetadata();
        this.invalidateAllReasoningReviews(true);
        this.automaticRoutingLifecycle.invalidateSession(message.sessionId);
        const operationGeneration = ++this.sessionOperationGeneration;
        this.automaticRoutingLifecycle.invalidateGeneration(message.sessionId, operationGeneration);
        ++this.sessionListRequestGeneration;
        const session = await this.agent.getSession(message.sessionId);
        if (operationGeneration !== this.sessionOperationGeneration || !session) break;
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "deleteSession": {
        this.clearAutomaticRoutingMetadata(message.sessionId);
        this.clearPromptQueue(message.sessionId);
        this.invalidateReasoningReviewsForSession(message.sessionId, true);
        this.invalidateAutomaticRoutingReviewsForSession(message.sessionId);
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
        const operationGeneration = ++this.sessionOperationGeneration;
        ++this.sessionListRequestGeneration;
        const session = await this.agent.revertSession(message.sessionId, message.messageId);
        await this.publishActiveSession(session, operationGeneration, message.sessionId);
        break;
      }
      case "editAndResend": {
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

    if (this.activeSession?.id !== session?.id) {
      this.clearAutomaticRoutingMetadata();
      this.invalidateAllReasoningReviews(true);
      this.automaticRoutingLifecycle.invalidateSession(session?.id ?? "");
    }
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
      const metadata = this.latestAutomaticRoutingMetadata;
      if (metadata?.sessionId === sessionId && metadata.generation === this.sessionOperationGeneration) {
        void this.routeAutomaticReviewAfterIdle(metadata);
      }
      return;
    }
    state.active = true;
    state.waitingForBusy = true;
    const prompt = state.pending.shift();
    if (!prompt) return;
    this.postQueuedPromptCount(sessionId, state.pending.length);
    const metadata = this.latestAutomaticRoutingMetadata;
    if (metadata?.sessionId === sessionId && metadata.generation === this.sessionOperationGeneration) {
      void this.routeAutomaticReviewAfterIdle(metadata);
    }
    void this.dispatchPrompt(prompt, state).catch((err) => {
      console.error("[OpenCode] Error handling message 'sendMessage':", err);
    });
  }

  private clearPromptQueue(sessionId: string): void {
    if (!this.promptQueues.delete(sessionId)) return;
    this.postQueuedPromptCount(sessionId, 0);
  }

  private invalidateReasoningReviewsForSession(sessionId: string, cancelUnderlying: boolean): void {
    const reviews = [...this.inFlightReasoningReviews.values()].filter((review) => review.sessionId === sessionId);
    for (const review of reviews) this.invalidateReasoningReview(review.sessionId, review.messageId, cancelUnderlying);
  }

  private invalidateAutomaticRoutingReviewsForSession(sessionId: string): void {
    for (const [key, review] of this.inFlightAutomaticReviews) {
      if (review.binding.sessionId !== sessionId) continue;
      this.inFlightAutomaticReviews.delete(key);
      this.automaticRoutingLifecycle.cancel(review.attemptId, review.binding);
      this.reasoningReviewController?.cancel(review.binding.sessionId, review.binding.messageId);
    }
  }

  private clearAutomaticRoutingMetadata(sessionId?: string): void {
    if (sessionId !== undefined && this.latestAutomaticRoutingMetadata?.sessionId !== sessionId) return;
    this.latestAutomaticRoutingMetadata = undefined;
  }

  private async routeAutomaticReviewAfterIdle(metadata: LatestAutomaticRoutingMetadata): Promise<void> {
    const options = this.automaticRouting;
    const controller = this.reasoningReviewController;
    if (!options?.router || !controller) return;
    // Read the evaluation at selection time so a host-private recorder can
    // report its aggregate as soon as the case minimum is reached; the static
    // field remains the fallback when no dynamic source is configured. A
    // failing source fails closed.
    let suppliedEvaluation: AutomaticRoutingEvaluation | undefined;
    try {
      suppliedEvaluation = options.evaluationProvider?.() ?? options.evaluation;
    } catch {
      return;
    }
    const evaluation = validateAutomaticRoutingEvaluation(suppliedEvaluation);
    if (!evaluation.ok || !evaluation.value.qualified) return;
    if (this.activeSession?.id !== metadata.sessionId || this.sessionOperationGeneration !== metadata.generation)
      return;

    let runtime: Awaited<ReturnType<IReasoningReviewController["getRuntime"]>>;
    try {
      runtime = await controller.getRuntime();
    } catch {
      return;
    }
    if (this.activeSession?.id !== metadata.sessionId || this.sessionOperationGeneration !== metadata.generation)
      return;

    const enabled = this.reasoningReviewPreference
      ? resolveEffectiveVibefeldEnabled(this.reasoningReviewPreference.read(), runtime)
      : options.enabled;

    let messages: Awaited<ReturnType<IAgent["getMessages"]>>;
    try {
      messages = await this.agent.getMessages(metadata.sessionId);
    } catch {
      return;
    }
    if (this.activeSession?.id !== metadata.sessionId || this.sessionOperationGeneration !== metadata.generation)
      return;
    const targetMessage = [...messages]
      .reverse()
      .find(
        (candidate) =>
          candidate.info.sessionID === metadata.sessionId &&
          candidate.info.role === "assistant" &&
          candidate.info.time.completed !== undefined,
      );
    if (!targetMessage) return;

    let selection: AutomaticRoutingPolicyDecision;
    try {
      selection = options.router({
        enabled,
        runtime: runtime.state,
        evaluation: evaluation.value,
        workMode: metadata.workMode,
        requestClass: metadata.requestClass,
        response: {
          sessionId: targetMessage.info.sessionID,
          activeSessionId: metadata.sessionId,
          role: targetMessage.info.role,
          completion: "completed",
        },
        signals: metadata.signals,
      });
    } catch {
      return;
    }
    if (!selection.selected) return;

    const binding = {
      sessionId: metadata.sessionId,
      messageId: targetMessage.info.id,
      generation: metadata.generation,
    };
    const started = this.automaticRoutingLifecycle.start({ binding, selection });
    if (started.kind !== "started") return;
    const automaticKey = this.reasoningReviewKey(binding.sessionId, binding.messageId);
    this.inFlightAutomaticReviews.set(automaticKey, { attemptId: started.attemptId, binding });

    try {
      const reviewStartedAt = Date.now();
      const summary = await controller.review({
        sessionId: binding.sessionId,
        messageId: binding.messageId,
        sourceText: buildReasoningReviewSourcePacket(targetMessage),
        invocation: "automatic",
      });
      if (this.activeSession?.id !== binding.sessionId || this.sessionOperationGeneration !== binding.generation) {
        this.automaticRoutingLifecycle.cancel(started.attemptId, binding);
        this.inFlightAutomaticReviews.delete(automaticKey);
        return;
      }
      const automaticSummary: ReasoningReviewSummary = {
        ...summary,
        invocation: "automatic",
        routing: { reasonCode: started.reasonCode, summary: started.summary },
      };
      if (this.automaticRoutingLifecycle.complete(started.attemptId, binding, automaticSummary).kind !== "completed") {
        this.inFlightAutomaticReviews.delete(automaticKey);
        return;
      }
      this.retainQualificationEvidence(
        binding.sessionId,
        binding.messageId,
        Math.max(0, Date.now() - reviewStartedAt),
        automaticSummary,
      );
      this.inFlightAutomaticReviews.delete(automaticKey);
      this.postMessage({ type: "reasoningReview", sessionId: binding.sessionId, summary: automaticSummary });
    } catch {
      this.automaticRoutingLifecycle.cancel(started.attemptId, binding);
      this.inFlightAutomaticReviews.delete(automaticKey);
    }
  }

  private async dispatchPrompt(prompt: NormalPrompt, state: PromptQueueState): Promise<void> {
    try {
      this.latestAutomaticRoutingMetadata = classifyAutomaticRoutingPrompt(
        prompt.sessionId,
        this.sessionOperationGeneration,
        prompt,
      );
      await this.agent.sendMessage(prompt.sessionId, prompt.text, {
        model: prompt.model,
        files: prompt.files,
        agent: prompt.agent,
        primaryAgent: prompt.primaryAgent,
        skill: prompt.skill,
        ...(prompt.bundledCommand ? { bundledCommand: prompt.bundledCommand } : {}),
        system: this.getSystemPrompt(prompt.primaryAgent, prompt.system),
        ...(prompt.effort !== undefined && { effort: prompt.effort }),
      });
    } catch (err) {
      if (this.promptQueues.get(prompt.sessionId) === state) {
        this.clearAutomaticRoutingMetadata(prompt.sessionId);
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

function classifyAutomaticRoutingPrompt(
  sessionId: string,
  generation: number,
  prompt: NormalPrompt,
): LatestAutomaticRoutingMetadata | undefined {
  if (sessionId.length === 0 || sessionId.length > 256 || !Number.isSafeInteger(generation) || generation < 0) return;

  // Classification is intentionally transient: the prompt is inspected here,
  // but only this small allowlisted result is retained on the host.
  const text = prompt.text.toLocaleLowerCase();
  const requestClass: AutomaticRoutingRequestClass =
    prompt.primaryAgent !== "scout"
      ? "unsupported"
      : /\btranslate|translation\b/u.test(text)
        ? "translation"
        : /\blookup|search|find|what\s+is\b/u.test(text)
          ? "lookup"
          : /\bpoem|story|creative|brainstorm\b/u.test(text)
            ? "creative"
            : /\bcode|coding|implement|debug|program\b/u.test(text)
              ? "coding"
              : /\bshell|terminal|command|run\b/u.test(text)
                ? "shell"
                : /\brecommend|recommendation|should\s+i\b/u.test(text)
                  ? "recommendation"
                  : /\bevidence|source|citation|cite\b/u.test(text)
                    ? "evidence"
                    : "argument";

  return {
    sessionId,
    generation,
    workMode: prompt.primaryAgent === "scout" ? "scout" : "unsupported",
    requestClass,
    signals: {
      evidenceDependent: /\bevidence|source|citation|cite\b/u.test(text),
      multiStepArgument: /\bwhy|compare|analy[sz]|trade-?off|step[- ]by[- ]step\b/u.test(text),
      highImpactRecommendation: /\brecommend|recommendation|should\s+i\b/u.test(text),
    },
  };
}
