/**
 * ChatViewProvider のユニットテスト。
 * IAgent をモックし、webview メッセージハンドラの振る舞いを検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((filePath: string) => {
    if (filePath.endsWith("CHAT_SYSTEM.md")) return "chat prompt";
    if (filePath.endsWith("WRITE_SYSTEM.md")) return "write prompt";
    throw new Error("ENOENT");
  }),
}));

// node:fs/promises と node:path のモック
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from "node:fs/promises";
import type { IAgent, IPlatformServices, MemoryProviderStatus } from "@opencode-chat/core";
import * as vscode from "vscode";
import type { ChatMcpPrefs, ChatMcpPrefsStore } from "../chat-mcp-prefs";
import type { ReasoningReviewPreferenceSeam } from "../chat-view-provider";
import { ChatViewProvider, MEMORY_RETENTION_CONFIRMATION_TTL_MS } from "../chat-view-provider";
import {
  composeReasoningAssistBrief,
  REASONING_ASSIST_BRIEF_DELIMITER,
  type ReasoningAssistBriefInput,
} from "../vibefeld/reasoning-assist-brief";
import type { ReasoningAssistStructureRecorder } from "../vibefeld/reasoning-assist-structure-recorder";
import type { IReasoningReviewController } from "../vibefeld/reasoning-review-controller";
import type { ReasoningAssistRestrictedReviewAdapter } from "../vibefeld/restricted-review-adapter";
import { RuntimeReportingReasoningReviewController } from "../vibefeld/runtime-reporting-reasoning-review-controller";
import { UnavailableReasoningReviewController } from "../vibefeld/unavailable-reasoning-review-controller";

// --- Helper: IAgent のモック ---

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createMockAgent(): {
  [K in keyof IAgent]: IAgent[K] extends (...args: never[]) => unknown ? ReturnType<typeof vi.fn> : IAgent[K];
} {
  return {
    getCapabilities: vi.fn().mockReturnValue({
      sessionDelete: true,
      sessionFork: true,
      sessionRevert: true,
      sessionShare: true,
      sessionSummarize: true,
      sessionDiff: true,
      todo: true,
      multiProvider: true,
      permission: true,
      mcp: true,
      subAgent: true,
      shell: true,
      config: true,
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: "new-sess", title: "New" }),
    getSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn().mockResolvedValue({ id: "fork-1" }),
    revertSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    unrevertSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    summarizeSession: vi.fn().mockResolvedValue(undefined),
    shareSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    unshareSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    getMessages: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
    executeShell: vi.fn().mockResolvedValue(undefined),
    getProviders: vi.fn().mockResolvedValue({ providers: [], default: {} }),
    listAllProviders: vi.fn().mockResolvedValue({ all: [], default: {}, connected: [] }),
    getAgents: vi.fn().mockResolvedValue([]),
    getSkills: vi.fn().mockResolvedValue([]),
    getChildSessions: vi.fn().mockResolvedValue([]),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    getSessionTodos: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockResolvedValue({}),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    getPath: vi.fn().mockResolvedValue({ config: "/home/.config/opencode", data: "/home/.data" }),
    getMcpStatus: vi.fn().mockResolvedValue({}),
    connectMcp: vi.fn().mockResolvedValue(undefined),
    disconnectMcp: vi.fn().mockResolvedValue(undefined),
    getToolIds: vi.fn().mockResolvedValue([]),
    getServerUrl: vi.fn().mockReturnValue("http://localhost:12345"),
    exportSessionSnapshot: vi.fn().mockResolvedValue("/tmp/handoff.json"),
    setModel: vi.fn().mockResolvedValue(undefined),
  } as never;
}

// --- Helper: IPlatformServices のモック ---

function createMockPlatformServices(): {
  [K in keyof IPlatformServices]: ReturnType<typeof vi.fn>;
} {
  return {
    openDiffEditor: vi.fn().mockResolvedValue(undefined),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    openTerminal: vi.fn().mockResolvedValue(undefined),
    runHandoffTerminal: vi.fn().mockResolvedValue(undefined),
    openConfigFile: vi.fn().mockResolvedValue(undefined),
    openFile: vi.fn().mockResolvedValue(undefined),
    searchWorkspaceFiles: vi.fn().mockResolvedValue([]),
    getOpenEditors: vi.fn().mockResolvedValue([]),
  };
}

// --- Helper: WebviewView のモック ---

function createMockWebviewView() {
  const postMessage = vi.fn();
  let messageHandler: ((message: unknown) => void) | undefined;

  const webview = {
    postMessage,
    onDidReceiveMessage: vi.fn((handler: (message: unknown) => void) => {
      messageHandler = handler;
      return { dispose: vi.fn() };
    }),
    options: {} as Record<string, unknown>,
    html: "",
    asWebviewUri: vi.fn((uri: { fsPath: string }) => uri.fsPath),
    cspSource: "https://test.csp",
  };

  const webviewView = {
    webview,
    // 以下は WebviewViewResolveContext 相当
    viewType: "opencode-chat.chatView",
    title: undefined,
    description: undefined,
    badge: undefined,
    visible: true,
    onDidDispose: vi.fn(),
    onDidChangeVisibility: vi.fn(),
    show: vi.fn(),
  };

  /** テスト内から webview メッセージを送信する */
  function sendMessage(message: unknown): Promise<void> {
    if (!messageHandler) throw new Error("resolveWebviewView has not been called");
    messageHandler(message);
    // ハンドラは async なので microtask を消化
    return new Promise((r) => setTimeout(r, 0));
  }

  return { webviewView, webview, postMessage, sendMessage };
}

// --- Helper: Provider を resolveWebviewView して返す ---

function setupProvider(
  mockAgent: ReturnType<typeof createMockAgent>,
  mockPlatformServices?: ReturnType<typeof createMockPlatformServices>,
  setChatSandboxSettings?: (
    settings: import("@opencode-chat/core").ChatSandboxSettings,
  ) => Promise<import("@opencode-chat/core").ChatSandboxStatus>,
  chatMcpPrefs?: ChatMcpPrefsStore,
  bundledResources?: import("@opencode-chat/core").BundledResourceMetadata[],
  bundledCommandNames?: string[],
  memoryProviderStatus?: MemoryProviderStatus,
  memoryRetentionStatus?: import("@opencode-chat/core").MemoryRetentionStatus,
  reasoningReviewController?: IReasoningReviewController,
  reasoningReviewPreference?: ReasoningReviewPreferenceSeam,
  reasoningAssistAdapter?: ReasoningAssistRestrictedReviewAdapter,
  reasoningAssistStructureRecorder?: ReasoningAssistStructureRecorder,
) {
  const extensionUri = { fsPath: "/ext" };
  const ps = mockPlatformServices ?? createMockPlatformServices();
  const provider = new ChatViewProvider(extensionUri as never, mockAgent as never, ps as never, {
    setChatSandboxSettings,
    chatMcpPrefs,
    bundledResources,
    bundledCommandNames,
    memoryProviderStatus,
    memoryRetentionStatus,
    reasoningReviewController,
    reasoningReviewPreference,
    reasoningAssistAdapter,
    reasoningAssistStructureRecorder,
  });
  const mock = createMockWebviewView();
  provider.resolveWebviewView(
    mock.webviewView as never,
    {} as never,
    { isCancellationRequested: false, onCancellationRequested: vi.fn() } as never,
  );
  return { provider, platformServices: ps, ...mock };
}

describe("ChatViewProvider", () => {
  let mockAgent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    mockAgent = createMockAgent();
    vi.clearAllMocks();
    vi.mocked(vscode.window).activeTextEditor = undefined;
    vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Chat sandbox settings", () => {
    const previousStatus = {
      mode: "off" as const,
      allowNetwork: true,
      enabled: false,
      inherited: false,
      applying: false,
      managed: false,
      supported: true,
    };

    it("applies settings through the injected operation and posts the resulting status", async () => {
      const apply = vi.fn().mockResolvedValue({ ...previousStatus, mode: "on", enabled: true });
      const settings = { mode: "on" as const, allowNetwork: false };
      const { provider, postMessage, sendMessage } = setupProvider(mockAgent, undefined, apply);
      provider.publishChatSandboxStatus(previousStatus);
      await sendMessage({ type: "setChatSandboxSettings", settings });

      expect(apply).toHaveBeenCalledWith(settings);
      expect(postMessage).toHaveBeenCalledWith({
        type: "chatSandboxStatus",
        status: { ...previousStatus, mode: "on", enabled: true },
      });
    });

    it("posts the previous effective status with an error when applying fails", async () => {
      const apply = vi.fn().mockRejectedValue(new Error("sandbox startup failed"));
      const { provider, postMessage, sendMessage } = setupProvider(mockAgent, undefined, apply);
      provider.publishChatSandboxStatus(previousStatus);
      postMessage.mockClear();

      await sendMessage({ type: "setChatSandboxSettings", settings: { mode: "on", allowNetwork: true } });

      expect(postMessage).toHaveBeenCalledWith({
        type: "chatSandboxStatus",
        status: { ...previousStatus, applying: false, error: "sandbox startup failed" },
      });
    });
  });

  // ============================================================
  // resolveWebviewView の基本動作
  // ============================================================

  describe("resolveWebviewView()", () => {
    it("should set webview options and html", () => {
      const { webview } = setupProvider(mockAgent);

      expect(webview.options.enableScripts).toBe(true);
      expect(webview.html).toContain("<!DOCTYPE html>");
    });

    it("should register message handler", () => {
      const { webview } = setupProvider(mockAgent);

      expect(webview.onDidReceiveMessage).toHaveBeenCalled();
    });

    it("should register SSE event forwarding", () => {
      setupProvider(mockAgent);

      expect(mockAgent.onEvent).toHaveBeenCalled();
    });

    it("should register active editor change listener", () => {
      setupProvider(mockAgent);

      expect(vscode.window.onDidChangeActiveTextEditor).toHaveBeenCalled();
    });

    it("should register tab change listener", () => {
      setupProvider(mockAgent);

      expect(vscode.window.tabGroups.onDidChangeTabs).toHaveBeenCalled();
    });
  });

  // ============================================================
  // post-response review removal
  // ============================================================

  describe("post-response review removal", () => {
    /**
     * Regression guard for the retired completed-message route: ordinary
     * assistant prose must never reach a review controller, whose only
     * production input used to be a compiled visible-response packet.
     */
    it("never reviews completed assistant prose on busy, idle, cancellation, or preference changes", async () => {
      const review = vi.fn();
      const cancel = vi.fn();
      const controller: IReasoningReviewController = {
        getRuntime: vi.fn().mockResolvedValue({ state: "available" }),
        review,
        cancel,
      };
      const preferenceSeam: ReasoningReviewPreferenceSeam = {
        read: () => ({ userEnabled: true, workspaceOptOut: false }),
        setUserEnabled: vi.fn(async () => undefined),
        setWorkspaceOptOut: vi.fn(async () => undefined),
      };
      const completedMessage = {
        info: {
          id: "completed-message",
          sessionID: "session-a",
          role: "assistant" as const,
          time: { created: 1, completed: 2 },
        },
        parts: [
          { type: "text" as const, text: "Ordinary visible assistant prose" },
          { type: "reasoning" as const, text: "Private model reasoning" },
        ],
      };
      mockAgent.getSession.mockResolvedValue({ id: "session-a" });
      mockAgent.getMessages.mockResolvedValue([completedMessage]);

      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller,
        preferenceSeam,
      );
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];

      await sendMessage({ type: "selectSession", sessionId: "session-a" });
      await sendMessage({
        type: "sendMessage",
        sessionId: "session-a",
        text: "Why compare these options?",
        primaryAgent: "scout",
      });
      // A stale webview request shape must also stay inert.
      await sendMessage({
        type: "requestReasoningReview",
        sessionId: "session-a",
        messageId: "completed-message",
      } as never);
      eventCallback({ type: "session.status", properties: { sessionID: "session-a", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "session-a", status: { type: "idle" } } });
      await sendMessage({ type: "setReasoningReviewPreference", preference: { userEnabled: true } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(review).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "reasoningReview" }));
      // The ordinary dispatch path still delivers the unchanged prompt.
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "session-a",
        "Why compare these options?",
        expect.objectContaining({ primaryAgent: "scout" }),
      );
    });

    it("keeps ordinary dispatch, queueing, and runtime publication unchanged", async () => {
      const runtime = { state: "available" as const };
      const controller: IReasoningReviewController = {
        getRuntime: vi.fn().mockResolvedValue(runtime),
        review: vi.fn(),
        cancel: vi.fn(),
      };
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller,
      );

      await sendMessage({ type: "ready" });
      expect(postMessage).toHaveBeenCalledWith({ type: "reasoningRuntime", runtime });

      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "ordinary prompt", primaryAgent: "scout" });
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "ordinary prompt",
        expect.objectContaining({ primaryAgent: "scout", system: "chat prompt" }),
      );
      expect(controller.review).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // reasoning assist preflight (3.1 host integration)
  // ============================================================

  describe("reasoning assist preflight", () => {
    const ARGUMENT_TEXT = JSON.stringify({
      kind: "argument",
      conclusionId: "claim-conclusion",
      claims: [
        {
          id: "claim-premise",
          class: "empirical",
          statement: "A bounded observation was recorded for this case.",
          dependsOn: [],
        },
        {
          id: "claim-conclusion",
          class: "deductive",
          statement: "The conclusion follows from the recorded premise.",
          dependsOn: ["claim-premise"],
        },
      ],
      assumptions: [
        { id: "assumption-1", claimId: "claim-conclusion", statement: "The premise applies to this case." },
      ],
      evidenceNeeds: [{ claimId: "claim-premise", sourceKind: "observation", status: "source_recorded" }],
      uncertainty: ["The observation is bounded to one case."],
    });

    function createPreferenceSeam(initial: { userEnabled: boolean; workspaceOptOut: boolean }) {
      const state = { ...initial };
      const seam: ReasoningReviewPreferenceSeam = {
        read: () => ({ ...state }),
        setUserEnabled: vi.fn(async (value: boolean) => {
          state.userEnabled = value;
        }),
        setWorkspaceOptOut: vi.fn(async (value: boolean) => {
          state.workspaceOptOut = value;
        }),
      };
      return { seam };
    }

    function availableController(): IReasoningReviewController {
      return {
        getRuntime: vi.fn().mockResolvedValue({ state: "available" }),
        review: vi.fn(),
        cancel: vi.fn(),
      };
    }

    function makeAssistAdapter(
      overrides: {
        run?: (role: "architect" | "critic", signal?: AbortSignal, packetText?: string) => Promise<unknown>;
        supportedStages?: readonly ("architect" | "critic")[];
      } = {},
    ) {
      const context = {
        handle: "assist-handle",
        provenance: { identity: "assist-identity", role: "architect" as const, contextNumber: 1 as const },
      };
      const cancelReasoningAssistContext = vi.fn(async () => undefined);
      const adapter: ReasoningAssistRestrictedReviewAdapter = {
        supportedStages: overrides.supportedStages ?? ["architect"],
        createReasoningAssistContext: vi.fn(async () => context),
        runReasoningAssistStage: vi.fn(
          async (_context: unknown, packetText: string, role: "architect" | "critic", signal?: AbortSignal) =>
            overrides.run
              ? overrides.run(role, signal, packetText)
              : { ok: true, role: "architect" as const, text: '{"kind":"ordinary"}' },
        ),
        cancelReasoningAssistContext,
      };
      return { adapter, context, cancelReasoningAssistContext };
    }

    /**
     * A run override whose stage calls stay pending until the test resolves
     * them, so cancellation and supersession can be delivered mid-preflight.
     */
    function deferredStages() {
      const pending: Array<{
        role: "architect" | "critic";
        packetText: string;
        signal: AbortSignal | undefined;
        stage: ReturnType<typeof deferred<unknown>>;
      }> = [];
      const run = async (role: "architect" | "critic", signal?: AbortSignal, packetText = "") => {
        const stage = deferred<unknown>();
        pending.push({ role, packetText, signal, stage });
        return stage.promise;
      };
      const calls = (role: "architect" | "critic") => pending.filter((entry) => entry.role === role);
      const callFor = (userText: string) => {
        const call = pending.find((entry) => entry.packetText.includes(userText));
        if (!call) throw new Error(`expected a pending preflight stage for '${userText}'`);
        return call;
      };
      return { run, calls, callFor };
    }

    function makeStructureRecorder(recordResult: "recorded" | "not-available" = "recorded") {
      const isSupported = vi.fn(() => true);
      const record = vi.fn(async () => recordResult);
      const recorder: ReasoningAssistStructureRecorder = { isSupported, record };
      return { recorder, isSupported, record };
    }

    function reasoningAssistPosts(postMessage: ReturnType<typeof vi.fn>) {
      return postMessage.mock.calls
        .map(([message]) => message as { type?: string })
        .filter((message) => typeof message?.type === "string" && message.type.startsWith("reasoningAssist"));
    }

    function setupEligible(options: {
      adapter?: ReasoningAssistRestrictedReviewAdapter;
      structureRecorder?: ReasoningAssistStructureRecorder;
      preference?: { userEnabled: boolean; workspaceOptOut: boolean };
      controller?: IReasoningReviewController;
    }) {
      const seam = createPreferenceSeam(options.preference ?? { userEnabled: true, workspaceOptOut: false });
      return setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        options.controller ?? availableController(),
        seam.seam,
        options.adapter,
        options.structureRecorder,
      );
    }

    /**
     * The exact validated facts the architect parser produces for
     * `ARGUMENT_TEXT`; both the expected brief and summary derive from it.
     */
    const EXPECTED_FACTS = {
      conclusion: { class: "deductive" as const, statement: "The conclusion follows from the recorded premise." },
      assumptions: ["The premise applies to this case."],
      evidenceNeeds: [{ sourceKind: "observation" as const, status: "source_recorded" as const }],
      uncertainty: ["The observation is bounded to one case."],
    };

    const EXPECTED_OBJECTIONS = [
      {
        target: { kind: "assumption" as const, id: "assumption-1" },
        severity: "material" as const,
        objection: "The premise applies only to a narrower case.",
      },
    ];

    const CRITIC_TEXT = JSON.stringify({
      objections: [
        {
          target: { kind: "assumption", id: "assumption-1" },
          severity: "material",
          reason: "The premise applies only to a narrower case.",
        },
      ],
    });

    function argumentAssistInput(afState: "recorded" | "not_available"): ReasoningAssistBriefInput {
      return { facts: EXPECTED_FACTS, afState, objections: EXPECTED_OBJECTIONS };
    }

    function expectedArgumentBrief(afState: "recorded" | "not_available"): string {
      const brief = composeReasoningAssistBrief(argumentAssistInput(afState));
      if (!brief) throw new Error("expected a composed reasoning-assist brief");
      return brief;
    }

    const EXPECTED_SUMMARY = {
      candidateConclusion: "The conclusion follows from the recorded premise.",
      assumptions: ["The premise applies to this case."],
      evidenceBoundary: "1 source recorded; The observation is bounded to one case.",
      criticObjections: [{ target: "assumption", objection: "The premise applies only to a narrower case." }],
      afFact: "absent",
    };

    /** Architect plus critic run: the standard argument outcome with objections. */
    const argumentAdapterOverrides = {
      supportedStages: ["architect", "critic"] as const,
      run: async (role: "architect" | "critic") =>
        role === "critic"
          ? { ok: true, role: "critic" as const, text: CRITIC_TEXT }
          : { ok: true, role: "architect" as const, text: ARGUMENT_TEXT },
    };

    it("posts token-scoped progress then cleared around an eligible dispatch", async () => {
      const { adapter } = makeAssistAdapter();
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Should this hold?", primaryAgent: "scout" });

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect(posts.map((message) => (message as { stage?: string }).stage)).toEqual(["assessing", undefined]);
      expect(posts[0]).toMatchObject({ sessionId: "sess-1", stage: "assessing" });
      expect((posts[0] as { promptToken: string }).promptToken.length).toBeGreaterThan(0);
      expect((posts[1] as { promptToken: string }).promptToken).toBe((posts[0] as { promptToken: string }).promptToken);
      expect(adapter.createReasoningAssistContext).toHaveBeenCalledWith("architect");
      expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledTimes(1);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Should this hold?",
        expect.objectContaining({ primaryAgent: "scout", system: "chat prompt" }),
      );
    });

    it("composes the brief and posts preparing, summary, and applied around a valid argument dispatch", async () => {
      const { adapter } = makeAssistAdapter(argumentAdapterOverrides);
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual([
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistSummary",
        "reasoningAssistProgress",
      ]);
      expect(posts.map((message) => (message as { stage?: string }).stage)).toEqual([
        "assessing",
        "mapping",
        "critiquing",
        "preparing",
        undefined,
        "applied",
      ]);
      const tokens = posts.map((message) => (message as { promptToken?: string }).promptToken);
      expect(new Set(tokens).size).toBe(1);

      const summaryPost = posts.find((message) => message.type === "reasoningAssistSummary");
      expect(summaryPost).toMatchObject({ sessionId: "sess-1", summary: EXPECTED_SUMMARY });
      // The compact summary carries validated fields only: no ids, handles,
      // provenance identities, or raw critic envelope.
      const serialized = JSON.stringify(summaryPost);
      expect(serialized).not.toContain("assumption-1");
      expect(serialized).not.toContain("claim-");
      expect(serialized).not.toContain("assist-handle");
      expect(serialized).not.toContain("assist-identity");
      expect(serialized).not.toContain("severity");

      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({
          primaryAgent: "scout",
          system: `chat prompt${REASONING_ASSIST_BRIEF_DELIMITER}${expectedArgumentBrief("not_available")}`,
        }),
      );
    });

    it("posts applied only after the dispatch promise resolves", async () => {
      const dispatch = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => dispatch.promise);
      const { adapter } = makeAssistAdapter(argumentAdapterOverrides);
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });

      const before = reasoningAssistPosts(postMessage);
      expect(before.map((message) => (message as { stage?: string }).stage)).toEqual([
        "assessing",
        "mapping",
        "critiquing",
        "preparing",
        undefined,
      ]);
      expect(before.some((message) => (message as { stage?: string }).stage === "applied")).toBe(false);

      dispatch.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const after = reasoningAssistPosts(postMessage);
      expect(after.map((message) => (message as { stage?: string }).stage)).toEqual([
        "assessing",
        "mapping",
        "critiquing",
        "preparing",
        undefined,
        "applied",
      ]);
      const tokens = after.map((message) => (message as { promptToken?: string }).promptToken);
      expect(new Set(tokens).size).toBe(1);
    });

    it("appends the brief to default and explicit system instructions while preserving dispatch options", async () => {
      const { adapter } = makeAssistAdapter(argumentAdapterOverrides);
      const { sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue the case.",
        model: { providerID: "anthropic", modelID: "claude-4" },
        effort: { id: "high" },
        primaryAgent: "scout",
        skill: "research-skill",
      });
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-2",
        text: "Argue the case again.",
        agent: "scout",
        primaryAgent: "scout",
        system: "caller prompt",
      });

      const brief = expectedArgumentBrief("not_available");
      expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(
        1,
        "sess-1",
        "Argue the case.",
        expect.objectContaining({
          model: { providerID: "anthropic", modelID: "claude-4" },
          effort: { id: "high" },
          files: undefined,
          agent: undefined,
          primaryAgent: "scout",
          skill: "research-skill",
          system: `chat prompt${REASONING_ASSIST_BRIEF_DELIMITER}${brief}`,
        }),
      );
      expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(
        2,
        "sess-2",
        "Argue the case again.",
        expect.objectContaining({
          agent: "scout",
          primaryAgent: "scout",
          system: `caller prompt${REASONING_ASSIST_BRIEF_DELIMITER}${brief}`,
        }),
      );
    });

    it("passes an injected structure recorder through and reports only recorded structure", async () => {
      const { adapter } = makeAssistAdapter(argumentAdapterOverrides);
      const { recorder, isSupported, record } = makeStructureRecorder("recorded");
      const { postMessage, sendMessage } = setupEligible({ adapter, structureRecorder: recorder });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => (message as { stage?: string }).stage)).toEqual([
        "assessing",
        "mapping",
        "recording",
        "critiquing",
        "preparing",
        undefined,
        "applied",
      ]);
      const summaryPost = posts.find((message) => message.type === "reasoningAssistSummary");
      expect(summaryPost).toMatchObject({ summary: { afFact: "recorded_structure" } });
      expect(isSupported).toHaveBeenCalled();
      expect(record).toHaveBeenCalledTimes(1);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({
          system: `chat prompt${REASONING_ASSIST_BRIEF_DELIMITER}${expectedArgumentBrief("recorded")}`,
        }),
      );
    });

    it("posts nothing and dispatches unchanged when the preflight goes stale", async () => {
      const { adapter } = makeAssistAdapter({
        run: async () => {
          // Deleting mid-flight cancels the preflight and orphans the prompt
          // state, so the next staleness gate must drop the late valid argument
          // without another terminal message.
          await sendMessage({ type: "deleteSession", sessionId: "sess-1" });
          return { ok: true, role: "architect", text: ARGUMENT_TEXT };
        },
      });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });
      // The reentrant deleteSession adds one extra macrotask before the assist
      // gate resolves and dispatch resumes.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const stalePosts = reasoningAssistPosts(postMessage);
      // The deletion hook is the only terminal message: one token-scoped
      // cleared for the in-flight row, and the stale gate adds nothing.
      expect(stalePosts.map((message) => message.type)).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect(stalePosts.map((message) => (message as { stage?: string }).stage)).toEqual(["assessing", undefined]);
      expect((stalePosts[1] as { promptToken: string }).promptToken).toBe(
        (stalePosts[0] as { promptToken: string }).promptToken,
      );
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({ primaryAgent: "scout", system: "chat prompt" }),
      );
    });

    it("performs no assist work when no adapter is injected", async () => {
      const { postMessage, sendMessage } = setupEligible({});
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Hello", primaryAgent: "scout" });

      expect(reasoningAssistPosts(postMessage)).toEqual([]);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Hello",
        expect.objectContaining({ primaryAgent: "scout" }),
      );
    });

    it.each<{
      label: string;
      text: string;
      message: Record<string, unknown>;
      preference?: { userEnabled: boolean; workspaceOptOut: boolean };
      controller?: boolean;
      withBundledCommandNames?: boolean;
    }>([
      {
        label: "attachment",
        text: "Hello",
        message: { files: [{ filePath: "/a.ts", fileName: "a.ts" }] },
      },
      {
        label: "bundled command",
        text: "Hello",
        message: { bundledCommand: { name: "write-report", arguments: "" } },
        withBundledCommandNames: true,
      },
      { label: "non-scout primaryAgent", text: "Hello", message: { primaryAgent: "build" } },
      { label: "non-scout agent", text: "Hello", message: { agent: "build" } },
      {
        label: "workspace opt-out",
        text: "Hello",
        message: { primaryAgent: "scout" },
        preference: { userEnabled: true, workspaceOptOut: true },
      },
      {
        label: "user preference disabled",
        text: "Hello",
        message: { primaryAgent: "scout" },
        preference: { userEnabled: false, workspaceOptOut: false },
      },
      {
        label: "runtime unavailable",
        text: "Hello",
        message: { primaryAgent: "scout" },
        controller: true,
      },
    ])(
      "does no assist work for an ineligible $label prompt",
      async ({ text, message, preference, controller, withBundledCommandNames }) => {
        const { adapter } = makeAssistAdapter();
        const seam = createPreferenceSeam(preference ?? { userEnabled: true, workspaceOptOut: false });
        const controllerImpl: IReasoningReviewController = controller
          ? { getRuntime: vi.fn().mockResolvedValue({ state: "unavailable" }), review: vi.fn(), cancel: vi.fn() }
          : availableController();
        const { postMessage, sendMessage } = setupProvider(
          mockAgent,
          undefined,
          undefined,
          undefined,
          undefined,
          withBundledCommandNames ? ["write-report"] : undefined,
          undefined,
          undefined,
          controllerImpl,
          seam.seam,
          adapter,
        );
        await sendMessage({ type: "ready" });
        await sendMessage({ type: "sendMessage", sessionId: "sess-1", text, ...message });

        expect(reasoningAssistPosts(postMessage)).toEqual([]);
        expect(adapter.createReasoningAssistContext).not.toHaveBeenCalled();
        expect(adapter.runReasoningAssistStage).not.toHaveBeenCalled();
        expect(adapter.cancelReasoningAssistContext).not.toHaveBeenCalled();
        // The system instruction stays exactly the pre-existing host behavior.
        const expectedSystem =
          message.primaryAgent === "scout"
            ? "chat prompt"
            : message.primaryAgent === "build"
              ? "write prompt"
              : undefined;
        expect(mockAgent.sendMessage).toHaveBeenCalledWith(
          "sess-1",
          text,
          expect.objectContaining({ ...message, system: expectedSystem }),
        );
      },
    );

    it("runs one fresh preflight per dispatch attempt when a failed prompt is retried", async () => {
      const { adapter, cancelReasoningAssistContext } = makeAssistAdapter();
      mockAgent.sendMessage.mockRejectedValueOnce(new Error("dispatch failed"));
      const { postMessage, sendMessage } = setupEligible({ adapter });
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];

      await sendMessage({ type: "ready" });
      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Retry me.", primaryAgent: "scout" });

      // The rejected dispatch retained the prompt at the queue head; its own
      // preflight already settled and discarded its context before the throw.
      expect(adapter.createReasoningAssistContext).toHaveBeenCalledTimes(1);
      expect(adapter.runReasoningAssistStage).toHaveBeenCalledTimes(1);
      expect(cancelReasoningAssistContext).toHaveBeenCalledTimes(1);
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);

      // A busy -> idle transition re-dispatches the retained prompt.
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(adapter.createReasoningAssistContext).toHaveBeenCalledTimes(2);
      expect(adapter.runReasoningAssistStage).toHaveBeenCalledTimes(2);
      expect(cancelReasoningAssistContext).toHaveBeenCalledTimes(2);
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockAgent.sendMessage).toHaveBeenLastCalledWith(
        "sess-1",
        "Retry me.",
        expect.objectContaining({ primaryAgent: "scout" }),
      );

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual([
        "reasoningAssistProgress",
        "reasoningAssistCleared",
        "reasoningAssistProgress",
        "reasoningAssistCleared",
      ]);
      const tokens = posts.map((message) => (message as { promptToken?: string }).promptToken);
      expect(new Set(tokens).size).toBe(2);
      expect(tokens[1]).toBe(tokens[0]);
      expect(tokens[3]).toBe(tokens[2]);
      expect(tokens[2]).not.toBe(tokens[0]);
    });

    it("cancels an in-flight preflight on abort and dispatches the prompt unchanged", async () => {
      const stages = deferredStages();
      const { adapter, context, cancelReasoningAssistContext } = makeAssistAdapter({ run: stages.run });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      const dispatch = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Should this hold?",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(1));

      const promptToken = (reasoningAssistPosts(postMessage)[0] as { promptToken: string }).promptToken;

      await sendMessage({ type: "abort", sessionId: "sess-1" });

      const inFlight = stages.callFor("Should this hold?");
      expect(inFlight.signal?.aborted).toBe(true);

      inFlight.stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1));
      await dispatch;

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect((posts[1] as { promptToken: string }).promptToken).toBe(promptToken);
      expect(posts.some((message) => (message as { stage?: string }).stage === "preparing")).toBe(false);
      expect(posts.some((message) => (message as { stage?: string }).stage === "applied")).toBe(false);
      expect(cancelReasoningAssistContext).toHaveBeenCalledWith(context);
      expect(mockAgent.abortSession).toHaveBeenCalledWith("sess-1");
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Should this hold?",
        expect.objectContaining({ primaryAgent: "scout", system: "chat prompt" }),
      );
    });

    it("cancels an in-flight preflight on session deletion and keeps the queue-clear behavior", async () => {
      const stages = deferredStages();
      const { adapter } = makeAssistAdapter({ run: stages.run });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      const dispatch = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue the case.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(1));

      const promptToken = (reasoningAssistPosts(postMessage)[0] as { promptToken: string }).promptToken;

      await sendMessage({ type: "deleteSession", sessionId: "sess-1" });

      expect(stages.callFor("Argue the case.").signal?.aborted).toBe(true);
      expect(mockAgent.deleteSession).toHaveBeenCalledWith("sess-1");
      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 0 });

      stages.callFor("Argue the case.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1));
      await dispatch;

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect((posts[1] as { promptToken: string }).promptToken).toBe(promptToken);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({ system: "chat prompt" }),
      );
    });

    it("cancels an in-flight preflight on a session.deleted event", async () => {
      const stages = deferredStages();
      const { adapter } = makeAssistAdapter({ run: stages.run });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await sendMessage({ type: "ready" });
      const dispatch = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue the case.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(1));

      const promptToken = (reasoningAssistPosts(postMessage)[0] as { promptToken: string }).promptToken;

      eventCallback({ type: "session.deleted", properties: { info: { id: "sess-1" } } });

      expect(stages.callFor("Argue the case.").signal?.aborted).toBe(true);
      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 0 });

      stages.callFor("Argue the case.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1));
      await dispatch;

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect((posts[1] as { promptToken: string }).promptToken).toBe(promptToken);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({ system: "chat prompt" }),
      );
    });

    it("cancels in-flight preflight work on a reconnect and drops late critic objections", async () => {
      const stages = deferredStages();
      const { adapter, context, cancelReasoningAssistContext } = makeAssistAdapter({
        run: stages.run,
        supportedStages: ["architect", "critic"],
      });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await sendMessage({ type: "ready" });
      const dispatch = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue the case.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(1));

      stages.callFor("Argue the case.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(stages.calls("critic")).toHaveLength(1));

      const before = reasoningAssistPosts(postMessage);
      expect(before.map((message) => (message as { stage?: string }).stage)).toEqual([
        "assessing",
        "mapping",
        "critiquing",
      ]);
      const promptToken = (before[0] as { promptToken: string }).promptToken;

      // A reconnect invalidates the preflight that started on the old stream.
      eventCallback({ type: "server.connected", properties: {} });

      expect(stages.calls("critic")[0].signal?.aborted).toBe(true);

      stages.calls("critic")[0].stage.resolve({ ok: true, role: "critic", text: CRITIC_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1));
      await dispatch;

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual([
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistCleared",
      ]);
      expect((posts[3] as { promptToken: string }).promptToken).toBe(promptToken);
      expect(cancelReasoningAssistContext).toHaveBeenCalledWith(context);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({ system: "chat prompt" }),
      );
    });

    it("cancels an in-flight preflight before an edit-and-resend proceeds", async () => {
      const stages = deferredStages();
      const { adapter } = makeAssistAdapter({ run: stages.run });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      const dispatch = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue the case.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(1));

      const promptToken = (reasoningAssistPosts(postMessage)[0] as { promptToken: string }).promptToken;

      await sendMessage({
        type: "editAndResend",
        sessionId: "sess-1",
        messageId: "msg-1",
        text: "Revised",
      });

      expect(mockAgent.revertSession).toHaveBeenCalledWith("sess-1", "msg-1");
      expect(mockAgent.sendMessage).toHaveBeenCalledWith("sess-1", "Revised", expect.objectContaining({}));
      expect(stages.callFor("Argue the case.").signal?.aborted).toBe(true);

      const afterEdit = reasoningAssistPosts(postMessage);
      expect(afterEdit.map((message) => message.type)).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect((afterEdit[1] as { promptToken: string }).promptToken).toBe(promptToken);

      // The superseded preflight's late valid argument never becomes a brief.
      stages.callFor("Argue the case.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2));
      await dispatch;

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.filter((message) => message.type === "reasoningAssistSummary")).toEqual([]);
      expect(posts.some((message) => (message as { stage?: string }).stage === "applied")).toBe(false);
      expect(mockAgent.sendMessage).toHaveBeenLastCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({ system: "chat prompt" }),
      );
    });

    it("keeps in-flight preflight work isolated per session", async () => {
      const stages = deferredStages();
      const { adapter } = makeAssistAdapter({ run: stages.run });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      const first = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Session one argument.",
        primaryAgent: "scout",
      });
      const second = sendMessage({
        type: "sendMessage",
        sessionId: "sess-2",
        text: "Session two argument.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(2));

      const before = reasoningAssistPosts(postMessage);
      expect(before).toHaveLength(2);
      expect(before.map((message) => (message as { sessionId: string }).sessionId).sort()).toEqual([
        "sess-1",
        "sess-2",
      ]);
      expect(before.every((message) => (message as { stage?: string }).stage === "assessing")).toBe(true);

      // Deleting sess-1 cancels only sess-1 and never clears sess-2's row.
      await sendMessage({ type: "deleteSession", sessionId: "sess-1" });

      expect(stages.callFor("Session two argument.").signal?.aborted).toBe(false);
      const afterDelete = reasoningAssistPosts(postMessage);
      expect(afterDelete.filter((message) => message.type === "reasoningAssistCleared")).toEqual([
        expect.objectContaining({ sessionId: "sess-1" }),
      ]);

      stages.callFor("Session one argument.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      stages.callFor("Session two argument.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2));
      await Promise.all([first, second]);

      const finalPosts = reasoningAssistPosts(postMessage);
      const typesFor = (sessionId: string) =>
        finalPosts
          .filter((message) => (message as { sessionId: string }).sessionId === sessionId)
          .map((message) => message.type);
      expect(typesFor("sess-1")).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect(typesFor("sess-2")).toEqual([
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistSummary",
        "reasoningAssistProgress",
      ]);
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Session one argument.",
        expect.objectContaining({ system: "chat prompt" }),
      );
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-2",
        "Session two argument.",
        expect.objectContaining({ system: expect.stringContaining(REASONING_ASSIST_BRIEF_DELIMITER) }),
      );
    });

    it("drops a late valid argument after cancellation and dispatches the original prompt unchanged", async () => {
      const stages = deferredStages();
      const { adapter } = makeAssistAdapter({ run: stages.run });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      const dispatch = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue the case.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(1));

      const promptToken = (reasoningAssistPosts(postMessage)[0] as { promptToken: string }).promptToken;

      await sendMessage({ type: "revertToMessage", sessionId: "sess-1", messageId: "msg-3" });

      expect(mockAgent.revertSession).toHaveBeenCalledWith("sess-1", "msg-3");
      expect(stages.callFor("Argue the case.").signal?.aborted).toBe(true);

      stages.callFor("Argue the case.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1));
      await dispatch;

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
      expect((posts[1] as { promptToken: string }).promptToken).toBe(promptToken);
      expect(posts.some((message) => (message as { stage?: string }).stage === "preparing")).toBe(false);
      expect(posts.some((message) => (message as { stage?: string }).stage === "applied")).toBe(false);
      // The unchanged base instruction proves no brief was appended.
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Argue the case.",
        expect.objectContaining({ system: "chat prompt" }),
      );
    });

    it("runs a fresh preflight with a new token for a later prompt after a cancellation", async () => {
      const stages = deferredStages();
      const { adapter } = makeAssistAdapter({ run: stages.run });
      const { postMessage, sendMessage } = setupEligible({ adapter });
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      const first = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "First argument.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(1));

      await sendMessage({ type: "abort", sessionId: "sess-1" });
      stages.callFor("First argument.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1));
      await first;

      // The cancelled session still accepts a new prompt and preflights it.
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Second argument.",
        primaryAgent: "scout",
      });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(2));

      stages.callFor("Second argument.").stage.resolve({ ok: true, role: "architect", text: '{"kind":"ordinary"}' });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2));

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.map((message) => message.type)).toEqual([
        "reasoningAssistProgress",
        "reasoningAssistCleared",
        "reasoningAssistProgress",
        "reasoningAssistCleared",
      ]);
      const tokens = posts.map((message) => (message as { promptToken: string }).promptToken);
      expect(tokens[1]).toBe(tokens[0]);
      expect(tokens[3]).toBe(tokens[2]);
      expect(tokens[2]).not.toBe(tokens[0]);
      expect(mockAgent.sendMessage).toHaveBeenLastCalledWith(
        "sess-1",
        "Second argument.",
        expect.objectContaining({ system: "chat prompt" }),
      );
    });

    it("cancels every in-flight preflight through cancelAllReasoningAssistWork", async () => {
      const stages = deferredStages();
      const { adapter } = makeAssistAdapter({ run: stages.run, supportedStages: ["architect", "critic"] });
      const { provider, postMessage, sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      const first = sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Session one argument.",
        primaryAgent: "scout",
      });
      const second = sendMessage({
        type: "sendMessage",
        sessionId: "sess-2",
        text: "Session two argument.",
        primaryAgent: "scout",
      });
      await vi.waitFor(() => expect(stages.calls("architect")).toHaveLength(2));

      // sess-1 advances to the optional critic stage while sess-2 still awaits.
      stages.callFor("Session one argument.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(stages.calls("critic")).toHaveLength(1));

      provider.cancelAllReasoningAssistWork();

      expect(stages.calls("architect").every((call) => call.signal?.aborted === true)).toBe(true);
      expect(stages.calls("critic")[0].signal?.aborted).toBe(true);

      stages.callFor("Session one argument.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      stages.calls("critic")[0].stage.resolve({ ok: true, role: "critic", text: CRITIC_TEXT });
      stages.callFor("Session two argument.").stage.resolve({ ok: true, role: "architect", text: ARGUMENT_TEXT });
      await vi.waitFor(() => expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2));
      await Promise.all([first, second]);

      const posts = reasoningAssistPosts(postMessage);
      expect(posts.filter((message) => message.type === "reasoningAssistSummary")).toEqual([]);
      expect(posts.some((message) => (message as { stage?: string }).stage === "applied")).toBe(false);
      const typesFor = (sessionId: string) =>
        posts
          .filter((message) => (message as { sessionId: string }).sessionId === sessionId)
          .map((message) => message.type);
      expect(typesFor("sess-1")).toEqual([
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistProgress",
        "reasoningAssistCleared",
      ]);
      expect(typesFor("sess-2")).toEqual(["reasoningAssistProgress", "reasoningAssistCleared"]);
    });

    it("logs a repeated preflight outcome reason exactly once per instance", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { adapter } = makeAssistAdapter();
      const { sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Should this hold?", primaryAgent: "scout" });
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Should this hold too?",
        primaryAgent: "scout",
      });

      const outcomeLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("Reasoning assist preflight outcome"));
      expect(outcomeLines).toEqual(["[opencode-chat] Reasoning assist preflight outcome (ordinary)"]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs the invalid-result outcome once with its parse sub-reason and stage text length", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const { adapter } = makeAssistAdapter({
        run: async () => ({ ok: true, role: "architect" as const, text: "not json" }),
      });
      const { sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue it again.",
        primaryAgent: "scout",
      });

      const outcomeLines = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("Reasoning assist preflight outcome"));
      expect(outcomeLines).toEqual([
        "[opencode-chat] Reasoning assist preflight outcome (invalid-result/malformed) stageTextLength=8",
      ]);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("logs the stage-failed-timeout outcome once with its numeric elapsed stage time", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const { adapter } = makeAssistAdapter({
        run: async () => ({ ok: false, role: "architect" as const, reason: "timeout" }),
      });
      const { sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue it again.",
        primaryAgent: "scout",
      });

      const outcomeLines = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("Reasoning assist preflight outcome"));
      // One line for the repeated reason, and it carries only the numeric
      // elapsed stage time.
      expect(outcomeLines).toHaveLength(1);
      expect(outcomeLines[0]).toMatch(
        /^\[opencode-chat\] Reasoning assist preflight outcome \(stage-failed-timeout\) stageElapsedMs=\d+$/,
      );
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("logs each distinct invalid-result parse sub-reason once and repeats none", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const invalidClaimClassText = JSON.stringify({
        kind: "argument",
        conclusionId: "claim-c1",
        claims: [{ id: "claim-c1", class: "mystery", statement: "A bounded statement.", dependsOn: [] }],
        assumptions: [],
        evidenceNeeds: [],
        uncertainty: [],
      });
      const texts = ["not json", invalidClaimClassText, "not json"] as const;
      let stageCall = 0;
      const { adapter } = makeAssistAdapter({
        run: async () => {
          const text = texts[stageCall % texts.length] ?? "not json";
          stageCall += 1;
          return { ok: true, role: "architect" as const, text };
        },
      });
      const { sendMessage } = setupEligible({ adapter });
      // Same-session prompts queue behind the mock agent's synthetic busy/idle
      // cycle, so pump the queue between preflights like the other tests do.
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue it again.", primaryAgent: "scout" });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue it once more.",
        primaryAgent: "scout",
      });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const outcomeLines = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("Reasoning assist preflight outcome"));
      expect(outcomeLines).toEqual([
        "[opencode-chat] Reasoning assist preflight outcome (invalid-result/malformed) stageTextLength=8",
        `[opencode-chat] Reasoning assist preflight outcome (invalid-result/invalid-claim-class) stageTextLength=${invalidClaimClassText.length}`,
      ]);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("logs the argument-map diagnostic once per instance across argument preflights", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { adapter } = makeAssistAdapter(argumentAdapterOverrides);
      const { sendMessage } = setupEligible({ adapter });
      await sendMessage({ type: "ready" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Argue the case.", primaryAgent: "scout" });
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Argue it again.",
        primaryAgent: "scout",
      });

      const argumentLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("Reasoning assist preflight produced an argument map"));
      expect(argumentLines).toEqual(["[opencode-chat] Reasoning assist preflight produced an argument map"]);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // SSE イベント転送
  // ============================================================

  describe("SSE event forwarding", () => {
    it("should forward events to webview via postMessage", () => {
      const { postMessage } = setupProvider(mockAgent);

      // onEvent に渡されたコールバックを取得して呼び出す
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const event = { type: "session.updated", properties: { id: "sess-1" } };
      eventCallback(event);

      expect(postMessage).toHaveBeenCalledWith({ type: "event", event });
    });

    it("should forward a payload-less event without throwing", () => {
      const { postMessage } = setupProvider(mockAgent);

      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
        event: unknown,
      ) => void;
      const event = { type: "session.updated" };

      expect(() => eventCallback(event)).not.toThrow();
      expect(postMessage).toHaveBeenCalledWith({ type: "event", event });
    });

    it("should apply reconnect invalidation for a payload-less server.connected event", () => {
      const { provider, postMessage } = setupProvider(mockAgent);

      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
        event: unknown,
      ) => void;
      const cancelAllReasoningAssistWork = vi.spyOn(provider, "cancelAllReasoningAssistWork");
      const event = { type: "server.connected" };

      expect(() => eventCallback(event)).not.toThrow();
      expect(postMessage).toHaveBeenCalledWith({ type: "event", event });
      // The reconnect invalidation branch stays reachable even when the event
      // is serialized without its empty properties.
      expect(cancelAllReasoningAssistWork).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // activeEditor リスナー
  // ============================================================

  describe("activeEditor listener", () => {
    it("should send the file-backed active custom tab when no text editor represents it", () => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = {
        input: new vscode.TabInputCustom(
          { scheme: "file", fsPath: "/workspace/docs/guide.md" } as never,
          "office-viewer",
        ),
      } as never;
      const { postMessage } = setupProvider(mockAgent);

      const editorCallback = vi.mocked(vscode.window.onDidChangeActiveTextEditor).mock.calls[0][0] as (
        editor: unknown,
      ) => void;
      editorCallback(undefined);

      expect(postMessage).toHaveBeenCalledWith({
        type: "activeEditor",
        file: { filePath: "docs/guide.md", fileName: "guide.md" },
      });
    });

    it("should keep the ordinary active text editor attachment", () => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = {
        input: new vscode.TabInputText({ scheme: "file", fsPath: "/workspace/src/index.ts" } as never),
      } as never;
      vi.mocked(vscode.window).activeTextEditor = {
        document: { uri: { scheme: "file", fsPath: "/workspace/src/index.ts" } },
      } as never;
      const { postMessage } = setupProvider(mockAgent);

      const editorCallback = vi.mocked(vscode.window.onDidChangeActiveTextEditor).mock.calls[0][0] as (
        editor: unknown,
      ) => void;
      editorCallback(vscode.window.activeTextEditor);

      expect(postMessage).toHaveBeenCalledWith({
        type: "activeEditor",
        file: { filePath: "src/index.ts", fileName: "index.ts" },
      });
    });

    it.each([
      {
        input: new vscode.TabInputCustom({ scheme: "untitled", fsPath: "/workspace/docs/guide.md" } as never, "custom"),
      },
      { input: new vscode.TabInputCustom(undefined as never, "custom") },
      { input: { unsupported: true } },
    ])("should clear the attachment for an unsupported active tab without reusing a stale editor", (activeTab) => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = activeTab as never;
      vi.mocked(vscode.window).activeTextEditor = {
        document: { uri: { scheme: "file", fsPath: "/workspace/stale.md" } },
      } as never;
      const { postMessage } = setupProvider(mockAgent);

      const editorCallback = vi.mocked(vscode.window.onDidChangeActiveTextEditor).mock.calls[0][0] as (
        editor: unknown,
      ) => void;
      editorCallback(vscode.window.activeTextEditor);

      expect(postMessage).toHaveBeenCalledWith({ type: "activeEditor", file: null });
    });

    it("should send activeEditor message when editor changes", () => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = undefined;
      const { postMessage } = setupProvider(mockAgent);

      const editorCallback = vi.mocked(vscode.window.onDidChangeActiveTextEditor).mock.calls[0][0] as (
        editor: unknown,
      ) => void;

      // file スキームのエディタ
      editorCallback({
        document: {
          uri: { scheme: "file", fsPath: "/workspace/src/index.ts" },
        },
      });

      expect(postMessage).toHaveBeenCalledWith({
        type: "activeEditor",
        file: { filePath: "src/index.ts", fileName: "index.ts" },
      });
    });

    it("should refresh the attachment when a file-backed custom tab is activated", () => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = {
        input: new vscode.TabInputCustom(
          { scheme: "file", fsPath: "/workspace/docs/guide.md" } as never,
          "office-viewer",
        ),
      } as never;
      vi.mocked(vscode.window).activeTextEditor = {
        document: { uri: { scheme: "file", fsPath: "/workspace/stale.md" } },
      } as never;
      const { postMessage } = setupProvider(mockAgent);

      const tabCallback = vi.mocked(vscode.window.tabGroups.onDidChangeTabs).mock.calls[0][0] as () => void;
      tabCallback();

      expect(postMessage).toHaveBeenCalledWith({
        type: "activeEditor",
        file: { filePath: "docs/guide.md", fileName: "guide.md" },
      });
    });

    it("should clear the attachment when an unsupported custom tab is activated", () => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = {
        input: new vscode.TabInputCustom({ scheme: "untitled", fsPath: "/workspace/docs/guide.md" } as never, "custom"),
      } as never;
      vi.mocked(vscode.window).activeTextEditor = {
        document: { uri: { scheme: "file", fsPath: "/workspace/stale.md" } },
      } as never;
      const { postMessage } = setupProvider(mockAgent);

      const tabCallback = vi.mocked(vscode.window.tabGroups.onDidChangeTabs).mock.calls[0][0] as () => void;
      tabCallback();

      expect(postMessage).toHaveBeenCalledWith({ type: "activeEditor", file: null });
    });

    it("should send null for non-file scheme editor", () => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = undefined;
      const { postMessage } = setupProvider(mockAgent);

      const editorCallback = vi.mocked(vscode.window.onDidChangeActiveTextEditor).mock.calls[0][0] as (
        editor: unknown,
      ) => void;

      editorCallback({
        document: { uri: { scheme: "output", fsPath: "/output" } },
      });

      expect(postMessage).toHaveBeenCalledWith({
        type: "activeEditor",
        file: null,
      });
    });

    it("should send null when no editor", () => {
      vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = undefined;
      const { postMessage } = setupProvider(mockAgent);

      const editorCallback = vi.mocked(vscode.window.onDidChangeActiveTextEditor).mock.calls[0][0] as (
        editor: unknown,
      ) => void;
      editorCallback(undefined);

      expect(postMessage).toHaveBeenCalledWith({
        type: "activeEditor",
        file: null,
      });
    });
  });

  // ============================================================
  // ready ハンドラ
  // ============================================================

  describe("ready", () => {
    it("publishes the injected review runtime and keeps initialization alive when lookup fails", async () => {
      const runtime = { state: "available" as const };
      const controller: IReasoningReviewController = {
        getRuntime: vi.fn().mockResolvedValue(runtime),
        review: vi.fn(),
        cancel: vi.fn(),
      };
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller,
      );

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({ type: "reasoningRuntime", runtime });
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "init" }));

      postMessage.mockClear();
      controller.getRuntime = vi.fn().mockRejectedValue(new Error("private provider failure"));
      await sendMessage({ type: "ready" });

      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "reasoningRuntime" }));
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "init" }));
    });

    it.each([
      { label: "available", runtime: { state: "available" as const } },
      {
        label: "incompatible",
        runtime: { state: "incompatible" as const, reason: "runtime-mismatch" as const },
      },
      {
        label: "dormant",
        runtime: { state: "unavailable" as const, reason: "runtime-unavailable" as const },
      },
    ])("publishes the fixed $label runtime status over reasoningRuntime", async ({ runtime }) => {
      const controller = new RuntimeReportingReasoningReviewController(
        new UnavailableReasoningReviewController(),
        runtime,
      );
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller,
      );

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({ type: "reasoningRuntime", runtime });
      const runtimeMessages = postMessage.mock.calls.filter(
        ([message]) => (message as { type?: string }).type === "reasoningRuntime",
      );
      expect(runtimeMessages).toHaveLength(1);
      expect(JSON.stringify(runtimeMessages)).not.toContain("compatibility");
    });

    it("should send init, sessions, activeSession, providers, and activeEditor", async () => {
      const sessions = [{ id: "s1" }, { id: "s2" }];
      mockAgent.listSessions.mockResolvedValue(sessions);
      mockAgent.getProviders.mockResolvedValue({
        providers: [{ id: "p1" }],
        default: { model: "claude-4" },
      });
      mockAgent.listAllProviders.mockResolvedValue({
        all: [{ id: "p1" }],
        default: {},
        connected: ["p1"],
      });
      mockAgent.getPath.mockResolvedValue({
        config: "/home/.config/opencode",
        data: "/home/.data",
      });
      vi.mocked(fs.readFile).mockResolvedValue('{"model":"anthropic/claude-4"}');

      const { postMessage, sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "ready" });

      // init (locale + toolConfig を統合)
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "init",
          locale: "en",
          paths: { config: "/home/.config/opencode", data: "/home/.data" },
          capabilities: expect.objectContaining({
            sessionDelete: true,
            sessionFork: true,
            sessionRevert: true,
            sessionShare: true,
            sessionSummarize: true,
            sessionDiff: true,
            todo: true,
            multiProvider: true,
            permission: true,
            mcp: true,
            subAgent: true,
            shell: true,
            config: true,
          }),
        }),
      );

      // sessions
      expect(postMessage).toHaveBeenCalledWith({
        type: "sessions",
        sessions,
      });

      // activeSession (初期状態は null)
      expect(postMessage).toHaveBeenCalledWith({
        type: "activeSession",
        session: null,
      });

      // providers
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "providers",
          providers: [{ id: "p1" }],
          default: { model: "claude-4" },
          configModel: "anthropic/claude-4",
        }),
      );

      // activeEditor
      expect(postMessage).toHaveBeenCalledWith({
        type: "activeEditor",
        file: null,
      });

      expect(postMessage).toHaveBeenCalledWith({
        type: "memoryStatus",
        status: {
          id: "none",
          displayName: "No memory provider",
          state: "unavailable",
          capabilities: { retain: false, recall: false, reflect: false },
        },
      });
    });

    it.each([
      {
        label: "unavailable provider",
        memoryProviderStatus: {
          id: "hindsight",
          displayName: "Hindsight",
          state: "unavailable",
          capabilities: { retain: false, recall: false, reflect: false },
        },
      },
      {
        label: "blocked provider",
        memoryProviderStatus: {
          id: "hindsight",
          displayName: "Hindsight",
          state: "blocked",
          capabilities: { retain: false, recall: false, reflect: false },
        },
      },
      {
        label: "detection error",
        memoryProviderStatus: {
          id: "hindsight",
          displayName: "Hindsight",
          state: "error",
          capabilities: { retain: false, recall: false, reflect: false },
          reason: "Provider detection failed",
        },
      },
      {
        label: "memory integration disabled",
        memoryProviderStatus: {
          id: "none",
          displayName: "No memory provider",
          state: "unavailable",
          capabilities: { retain: false, recall: false, reflect: false },
        },
        memoryRetentionStatus: {
          policy: { enabled: false, requireConfirmation: true, automaticSessionRetention: false },
          state: "disabled",
        },
      },
    ] as const)(
      "keeps Chat and Write initialization and message handling normal for %s",
      async ({ memoryProviderStatus, memoryRetentionStatus }) => {
        const { postMessage, sendMessage } = setupProvider(
          mockAgent,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          memoryProviderStatus,
          memoryRetentionStatus,
        );

        await sendMessage({ type: "ready" });
        await sendMessage({
          type: "sendMessage",
          sessionId: "chat-session",
          text: "Research this",
          primaryAgent: "scout",
        });
        await sendMessage({
          type: "sendMessage",
          sessionId: "write-session",
          text: "Write this",
          primaryAgent: "build",
        });

        expect(postMessage).toHaveBeenCalledWith({ type: "memoryStatus", status: memoryProviderStatus });
        expect(memoryProviderStatus.capabilities).toEqual({ retain: false, recall: false, reflect: false });
        expect(memoryProviderStatus).not.toHaveProperty("automaticSessionRetention");
        if (memoryRetentionStatus) {
          expect(memoryRetentionStatus.policy.automaticSessionRetention).toBe(false);
        }
        expect(mockAgent.getPath).toHaveBeenCalled();
        expect(mockAgent.listSessions).toHaveBeenCalled();
        expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(
          1,
          "chat-session",
          "Research this",
          expect.objectContaining({ primaryAgent: "scout", system: "chat prompt" }),
        );
        expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(
          2,
          "write-session",
          "Write this",
          expect.objectContaining({ primaryAgent: "build", system: "write prompt" }),
        );
        expect(mockAgent.updateConfig).not.toHaveBeenCalled();
        expect(mockAgent.getToolIds).not.toHaveBeenCalled();
        for (const operation of [
          mockAgent.deleteSession,
          mockAgent.replyPermission,
          mockAgent.connectMcp,
          mockAgent.disconnectMcp,
          mockAgent.setModel,
        ]) {
          expect(operation).not.toHaveBeenCalled();
        }
        expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
      },
    );

    it("should send additive bundled metadata without bodies or paths", async () => {
      const bundledResources = [
        { source: "bundled" as const, type: "skill" as const, name: "citation-audit", description: "Citations" },
        { source: "bundled" as const, type: "skill" as const, name: "evidence-synthesis", description: "Evidence" },
        { source: "bundled" as const, type: "skill" as const, name: "mcp-research", description: "MCP research" },
        { source: "bundled" as const, type: "skill" as const, name: "research-workflow", description: "Workflow" },
        { source: "bundled" as const, type: "command" as const, name: "research-answer", description: "Answer" },
        { source: "bundled" as const, type: "command" as const, name: "research-citations", description: "Citations" },
        { source: "bundled" as const, type: "command" as const, name: "research-edit", description: "Edit" },
        { source: "bundled" as const, type: "command" as const, name: "research-plan", description: "Plan" },
        { source: "bundled" as const, type: "command" as const, name: "research-report", description: "Report" },
      ];
      const { postMessage, sendMessage } = setupProvider(mockAgent, undefined, undefined, undefined, bundledResources);

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({ type: "bundledResources", resources: bundledResources });
      const message = postMessage.mock.calls.find(([value]) => value.type === "bundledResources")?.[0];
      expect(message).not.toHaveProperty("template");
      expect(message).not.toHaveProperty("body");
      expect(message).not.toHaveProperty("absolutePath");
      expect(message).not.toHaveProperty("relativePath");
    });

    it("should set configModel to undefined when config file read fails", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "providers",
          configModel: undefined,
        }),
      );
    });

    it("publishes empty host preferences with no locked servers on ready", async () => {
      const store: ChatMcpPrefsStore = { read: () => ({}), write: vi.fn() };
      const { postMessage, sendMessage } = setupProvider(mockAgent, undefined, undefined, store);

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({ type: "mcpPrefs", prefs: {}, locked: [] });
    });

    it("keeps populated host preferences authoritative on ready", async () => {
      const store: ChatMcpPrefsStore = {
        read: () => ({ selected: true }),
        write: vi.fn(),
      };
      const { postMessage, sendMessage } = setupProvider(mockAgent, undefined, undefined, store);

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({ type: "mcpPrefs", prefs: { selected: true }, locked: [] });
    });
  });

  describe("reasoning review preference", () => {
    function createPreferenceSeam(initial: { userEnabled: boolean; workspaceOptOut: boolean }) {
      const state = { ...initial };
      const setUserEnabled = vi.fn(async (value: boolean) => {
        state.userEnabled = value;
      });
      const setWorkspaceOptOut = vi.fn(async (value: boolean) => {
        state.workspaceOptOut = value;
      });
      const seam: ReasoningReviewPreferenceSeam = {
        read: () => ({ ...state }),
        setUserEnabled,
        setWorkspaceOptOut,
      };
      return { seam, setUserEnabled, setWorkspaceOptOut };
    }

    function availableController() {
      return new RuntimeReportingReasoningReviewController(new UnavailableReasoningReviewController(), {
        state: "available",
      });
    }

    it("publishes the effective preference from the already-published runtime on ready", async () => {
      const { seam } = createPreferenceSeam({ userEnabled: true, workspaceOptOut: false });
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        availableController(),
        seam,
      );

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({
        type: "reasoningReviewPreference",
        preference: { userEnabled: true, workspaceOptOut: false, effective: true },
      });
      const preferenceMessages = postMessage.mock.calls.filter(
        ([message]) => (message as { type?: string }).type === "reasoningReviewPreference",
      );
      expect(preferenceMessages).toHaveLength(1);
      expect(JSON.stringify(preferenceMessages)).not.toMatch(/executable|workspacePath|command|argv|proof/i);
    });

    it.each([
      { label: "checking", runtime: { state: "checking" as const } },
      { label: "incompatible", runtime: { state: "incompatible" as const, reason: "runtime-mismatch" } },
      { label: "unavailable", runtime: { state: "unavailable" as const, reason: "runtime-unavailable" } },
    ])("keeps effective false for a $label runtime", async ({ runtime }) => {
      const { seam } = createPreferenceSeam({ userEnabled: true, workspaceOptOut: false });
      const controller = new RuntimeReportingReasoningReviewController(
        new UnavailableReasoningReviewController(),
        runtime,
      );
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller,
        seam,
      );

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({
        type: "reasoningReviewPreference",
        preference: { userEnabled: true, workspaceOptOut: false, effective: false },
      });
    });

    it("publishes effective false when no review runtime is injected", async () => {
      const { seam } = createPreferenceSeam({ userEnabled: true, workspaceOptOut: true });
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        seam,
      );

      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({
        type: "reasoningReviewPreference",
        preference: { userEnabled: true, workspaceOptOut: true, effective: false },
      });
    });

    it("writes only the Global key for the user toggle and republishes the effective state", async () => {
      const { seam, setUserEnabled, setWorkspaceOptOut } = createPreferenceSeam({
        userEnabled: true,
        workspaceOptOut: false,
      });
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        availableController(),
        seam,
      );
      await sendMessage({ type: "ready" });
      postMessage.mockClear();

      await sendMessage({ type: "setReasoningReviewPreference", preference: { userEnabled: false } });

      expect(setUserEnabled).toHaveBeenCalledTimes(1);
      expect(setUserEnabled).toHaveBeenCalledWith(false);
      expect(setWorkspaceOptOut).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({
        type: "reasoningReviewPreference",
        preference: { userEnabled: false, workspaceOptOut: false, effective: false },
      });
    });

    it("writes only the Workspace key for the opt-out and republishes the effective state", async () => {
      const { seam, setUserEnabled, setWorkspaceOptOut } = createPreferenceSeam({
        userEnabled: true,
        workspaceOptOut: false,
      });
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        availableController(),
        seam,
      );
      await sendMessage({ type: "ready" });
      postMessage.mockClear();

      await sendMessage({ type: "setReasoningReviewPreference", preference: { workspaceOptOut: true } });

      expect(setWorkspaceOptOut).toHaveBeenCalledTimes(1);
      expect(setWorkspaceOptOut).toHaveBeenCalledWith(true);
      expect(setUserEnabled).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({
        type: "reasoningReviewPreference",
        preference: { userEnabled: true, workspaceOptOut: true, effective: false },
      });
    });

    it("ignores non-boolean preference values without writing configuration", async () => {
      const { seam, setUserEnabled, setWorkspaceOptOut } = createPreferenceSeam({
        userEnabled: true,
        workspaceOptOut: false,
      });
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        availableController(),
        seam,
      );
      await sendMessage({ type: "ready" });
      postMessage.mockClear();

      await sendMessage({
        type: "setReasoningReviewPreference",
        preference: { userEnabled: "yes", workspaceOptOut: 1 },
      } as never);

      expect(setUserEnabled).not.toHaveBeenCalled();
      expect(setWorkspaceOptOut).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({
        type: "reasoningReviewPreference",
        preference: { userEnabled: true, workspaceOptOut: false, effective: true },
      });
    });

    it("stays inert without an injected preference seam", async () => {
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        availableController(),
      );
      await sendMessage({ type: "ready" });
      postMessage.mockClear();

      await sendMessage({ type: "setReasoningReviewPreference", preference: { userEnabled: false } });

      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "reasoningReviewPreference" }));
    });
  });

  describe("refresh after reconnect", () => {
    it("publishes the updated memory status after reconnect instead of the initial status", async () => {
      const initialStatus: MemoryProviderStatus = {
        id: "none",
        displayName: "No memory provider",
        state: "unavailable",
        capabilities: { retain: false, recall: false, reflect: false },
      };
      const refreshedStatus: MemoryProviderStatus = {
        id: "hindsight",
        displayName: "Hindsight",
        state: "partial",
        capabilities: { retain: true, recall: true, reflect: false },
      };
      const { provider, postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        initialStatus,
      );
      await sendMessage({ type: "ready" });
      postMessage.mockClear();

      provider.publishMemoryProviderStatus(refreshedStatus);
      await provider.refresh();

      expect(postMessage).toHaveBeenCalledWith({ type: "memoryStatus", status: refreshedStatus });
      const memoryMessages = postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "memoryStatus");
      expect(memoryMessages.at(-1)).toEqual({ type: "memoryStatus", status: refreshedStatus });
    });

    it("refreshes active data and posts sandbox status without changing MCP or config", async () => {
      const activeSession = { id: "active", title: "Active" };
      const refreshedSession = { id: "active", title: "Refreshed" };
      const sessions = [refreshedSession];
      const messages = [{ id: "message-1" }];
      const providers = { providers: [{ id: "provider-1" }], default: { model: "model-1" } };
      const allProviders = { all: [{ id: "provider-1" }], default: {}, connected: ["provider-1"] };
      const agents = [{ id: "agent-1" }];
      const mcpStatus = { server: { connected: true } };
      const sandboxStatus = {
        mode: "on" as const,
        allowNetwork: true,
        enabled: true,
        inherited: false,
        applying: false,
        managed: false,
        supported: true,
      };

      mockAgent.getSession.mockResolvedValueOnce(activeSession).mockResolvedValueOnce(refreshedSession);
      mockAgent.listSessions.mockResolvedValue(sessions);
      mockAgent.getMessages.mockResolvedValue(messages);
      mockAgent.getProviders.mockResolvedValue(providers);
      mockAgent.listAllProviders.mockResolvedValue(allProviders);
      mockAgent.getAgents.mockResolvedValue(agents);
      mockAgent.getMcpStatus.mockResolvedValue(mcpStatus);
      vi.mocked(fs.readFile).mockResolvedValue('{"model":"provider/model-1"}');

      const { provider, postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "selectSession", sessionId: "active" });
      postMessage.mockClear();

      await provider.refresh(sandboxStatus);

      expect(mockAgent.getSession).toHaveBeenCalledWith("active");
      expect(mockAgent.getMessages).toHaveBeenCalledWith("active");
      expect(postMessage).toHaveBeenCalledWith({ type: "sessions", sessions });
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session: refreshedSession });
      expect(postMessage).toHaveBeenCalledWith({ type: "messages", sessionId: "active", messages });
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "providers", configModel: "provider/model-1" }),
      );
      expect(postMessage).toHaveBeenCalledWith({ type: "agents", agents });
      expect(postMessage).toHaveBeenCalledWith({ type: "mcpStatus", status: mcpStatus });
      expect(postMessage).toHaveBeenCalledWith({ type: "chatSandboxStatus", status: sandboxStatus });
      expect(postMessage).toHaveBeenCalledWith({
        type: "memoryStatus",
        status: {
          id: "none",
          displayName: "No memory provider",
          state: "unavailable",
          capabilities: { retain: false, recall: false, reflect: false },
        },
      });
      expect(mockAgent.connectMcp).not.toHaveBeenCalled();
      expect(mockAgent.disconnectMcp).not.toHaveBeenCalled();
      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    });

    it("is safe when no webview is attached", async () => {
      const provider = new ChatViewProvider(
        { fsPath: "/ext" } as never,
        mockAgent as never,
        createMockPlatformServices() as never,
      );

      await expect(provider.refresh()).resolves.toBeUndefined();
      expect(mockAgent.listSessions).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // createSession
  // ============================================================

  describe("createSession", () => {
    it("should create session, update activeSession, and send sessions", async () => {
      const newSession = { id: "new-1", title: "New Session" };
      mockAgent.createSession.mockResolvedValue(newSession);
      const allSessions = [newSession];
      mockAgent.listSessions.mockResolvedValue(allSessions);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "createSession", title: "New Session" });

      expect(mockAgent.createSession).toHaveBeenCalledWith("New Session");
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session: newSession });
      expect(postMessage).toHaveBeenCalledWith({ type: "sessions", sessions: allSessions });
    });
  });

  describe("session navigation ordering", () => {
    it("keeps the later selection active when session lookups complete out of order", async () => {
      const firstLookup = deferred<{ id: string }>();
      const secondLookup = deferred<{ id: string }>();
      mockAgent.getSession.mockReturnValueOnce(firstLookup.promise).mockReturnValueOnce(secondLookup.promise);
      const { postMessage, sendMessage } = setupProvider(mockAgent);

      const firstSelection = sendMessage({ type: "selectSession", sessionId: "session-a" });
      const secondSelection = sendMessage({ type: "selectSession", sessionId: "session-b" });

      secondLookup.resolve({ id: "session-b" });
      await secondSelection;
      firstLookup.resolve({ id: "session-a" });
      await firstSelection;

      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session: { id: "session-b" } });
      expect(postMessage).not.toHaveBeenCalledWith({ type: "activeSession", session: { id: "session-a" } });
      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "messages", sessionId: "session-a" }),
      );
    });

    it("does not let a refresh restore the previous session after creation", async () => {
      const previousSession = { id: "session-a", title: "Previous" };
      mockAgent.createSession.mockResolvedValueOnce(previousSession);
      mockAgent.listSessions.mockResolvedValueOnce([previousSession]);
      const { provider, postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "createSession" });
      postMessage.mockClear();

      const refreshedPreviousSession = deferred<{ id: string; title: string }>();
      const staleSessionList = deferred<Array<{ id: string; title: string }>>();
      mockAgent.getSession.mockReturnValueOnce(refreshedPreviousSession.promise);
      mockAgent.listSessions.mockReturnValueOnce(staleSessionList.promise);
      const refresh = provider.refresh();

      const newSession = { id: "session-b", title: "New" };
      mockAgent.createSession.mockResolvedValueOnce(newSession);
      mockAgent.listSessions.mockReturnValueOnce(Promise.resolve([previousSession, newSession]));
      await sendMessage({ type: "createSession" });
      refreshedPreviousSession.resolve({ id: "session-a", title: "Refreshed Previous" });
      staleSessionList.resolve([previousSession]);
      await refresh;

      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session: newSession });
      expect(postMessage).not.toHaveBeenCalledWith({
        type: "activeSession",
        session: { id: "session-a", title: "Refreshed Previous" },
      });
      expect(postMessage).toHaveBeenCalledWith({
        type: "sessions",
        sessions: [previousSession, newSession],
      });
    });
  });

  // ============================================================
  // listSessions
  // ============================================================

  describe("listSessions", () => {
    it("should send sessions list", async () => {
      const sessions = [{ id: "s1" }];
      mockAgent.listSessions.mockResolvedValue(sessions);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "listSessions" });

      expect(postMessage).toHaveBeenCalledWith({ type: "sessions", sessions });
    });
  });

  // ============================================================
  // selectSession
  // ============================================================

  describe("selectSession", () => {
    it("should get session and messages, then send both", async () => {
      const session = { id: "sess-1" };
      const messages = [{ info: { id: "m1" }, parts: [] }];
      mockAgent.getSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue(messages);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "selectSession", sessionId: "sess-1" });

      expect(mockAgent.getSession).toHaveBeenCalledWith("sess-1");
      expect(mockAgent.getMessages).toHaveBeenCalledWith("sess-1");
      expect(mockAgent.getMessages).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
      expect(postMessage).toHaveBeenCalledWith({
        type: "messages",
        sessionId: "sess-1",
        messages,
      });
    });
  });

  // ============================================================
  // deleteSession
  // ============================================================

  describe("deleteSession", () => {
    it("should clear activeSession when deleting active session", async () => {
      // まずセッションをアクティブにする
      const session = { id: "sess-1" };
      mockAgent.createSession.mockResolvedValue(session);
      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "createSession" });

      // アクティブセッションを削除
      mockAgent.listSessions.mockResolvedValue([]);
      await sendMessage({ type: "deleteSession", sessionId: "sess-1" });

      expect(mockAgent.deleteSession).toHaveBeenCalledWith("sess-1");
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session: null });
      expect(postMessage).toHaveBeenCalledWith({ type: "sessions", sessions: [] });
    });

    it("should not change activeSession when deleting different session", async () => {
      // まずセッション sess-1 をアクティブにする
      const session = { id: "sess-1" };
      mockAgent.createSession.mockResolvedValue(session);
      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "createSession" });
      postMessage.mockClear();

      // 別のセッションを削除
      await sendMessage({ type: "deleteSession", sessionId: "sess-2" });

      // activeSession が null にならないこと（activeSession メッセージが送られない）
      const activeSessionCalls = postMessage.mock.calls.filter(
        (c) => (c[0] as { type: string }).type === "activeSession",
      );
      expect(activeSessionCalls).toHaveLength(0);
    });
  });

  // ============================================================
  // sendMessage
  // ============================================================

  describe("sendMessage", () => {
    it("should call agent.sendMessage with correct args (IAgent signature)", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Hello",
        model: { providerID: "anthropic", modelID: "claude-4" },
        files: [{ filePath: "a.ts", fileName: "a.ts" }],
        agent: "reviewer",
        skill: "coding-guidelines",
      });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith("sess-1", "Hello", {
        model: { providerID: "anthropic", modelID: "claude-4" },
        files: [{ filePath: "a.ts", fileName: "a.ts" }],
        agent: "reviewer",
        skill: "coding-guidelines",
      });
    });

    it("should NOT include an effort property when message.effort is absent", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Hello",
        model: { providerID: "anthropic", modelID: "claude-4" },
        files: [],
      });

      // The third argument to sendMessage is the options object; effort must be absent (not undefined-keyed).
      const options = (mockAgent.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
      expect(Object.hasOwn(options, "effort")).toBe(false);
    });

    it("should forward explicit effort to agent.sendMessage options when present", async () => {
      const { sendMessage } = setupProvider(mockAgent);
      const effort = { id: "low", label: "Low" };

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Hello",
        model: { providerID: "anthropic", modelID: "claude-4" },
        files: [{ filePath: "a.ts", fileName: "a.ts" }],
        agent: "reviewer",
        primaryAgent: "build",
        skill: "coding-guidelines",
        effort,
      });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Hello",
        expect.objectContaining({
          model: { providerID: "anthropic", modelID: "claude-4" },
          files: [{ filePath: "a.ts", fileName: "a.ts" }],
          agent: "reviewer",
          primaryAgent: "build",
          skill: "coding-guidelines",
          effort,
        }),
      );
      // Sanity: the effort object passed in is the exact same one forwarded.
      const options = (mockAgent.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
      expect(options.effort).toEqual(effort);
    });

    it("should route edit-and-resend through the Scout prompt", async () => {
      mockAgent.revertSession.mockResolvedValue({ id: "sess-1" });
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({
        type: "editAndResend",
        sessionId: "sess-1",
        messageId: "msg-3",
        text: "Revised",
        primaryAgent: "scout",
      });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Revised",
        expect.objectContaining({ primaryAgent: "scout", system: "chat prompt" }),
      );
    });

    it("should route edit-and-resend through the Write prompt and preserve explicit overrides", async () => {
      mockAgent.revertSession.mockResolvedValue({ id: "sess-1" });
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({
        type: "editAndResend",
        sessionId: "sess-1",
        messageId: "msg-3",
        text: "Revised",
        primaryAgent: "build",
      });
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Revised",
        expect.objectContaining({ primaryAgent: "build", system: "write prompt" }),
      );

      mockAgent.sendMessage.mockClear();
      await sendMessage({
        type: "editAndResend",
        sessionId: "sess-1",
        messageId: "msg-3",
        text: "Override",
        primaryAgent: "build",
        system: "explicit prompt",
      });
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Override",
        expect.objectContaining({ primaryAgent: "build", system: "explicit prompt" }),
      );
    });

    it("should route the Scout default prompt", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Hello", primaryAgent: "scout" });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Hello",
        expect.objectContaining({ primaryAgent: "scout", system: "chat prompt" }),
      );
    });

    it("should route the Build-backed Write default prompt", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "Write", primaryAgent: "build" });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Write",
        expect.objectContaining({ primaryAgent: "build", system: "write prompt" }),
      );
    });

    it("should preserve an explicit system override", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "Override",
        primaryAgent: "build",
        system: "explicit prompt",
      });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Override",
        expect.objectContaining({ primaryAgent: "build", system: "explicit prompt" }),
      );
    });

    it("should not apply a default prompt without a recognized primary agent", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "No default" });

      const options = (mockAgent.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
      expect(options.primaryAgent).toBeUndefined();
      expect(options.system).toBeUndefined();
    });

    it("should forward only a validated bundled command and typed arguments", async () => {
      const { sendMessage } = setupProvider(mockAgent, undefined, undefined, undefined, undefined, ["research-answer"]);

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "What is new?",
        primaryAgent: "scout",
        bundledCommand: { name: "research-answer", arguments: "scope='recent'" },
      });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "What is new?",
        expect.objectContaining({
          primaryAgent: "scout",
          bundledCommand: { name: "research-answer", arguments: "scope='recent'" },
          system: "chat prompt",
        }),
      );
    });

    it("discards extra fields from validated bundled commands", async () => {
      const { sendMessage } = setupProvider(mockAgent, undefined, undefined, undefined, undefined, ["research-answer"]);

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "What is new?",
        bundledCommand: {
          name: "research-answer",
          arguments: "scope='recent'",
          template: "malicious template",
          body: "malicious body",
          absolutePath: "/outside/bundle",
        },
      });

      const options = (mockAgent.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
      expect(options.bundledCommand).toEqual({ name: "research-answer", arguments: "scope='recent'" });
      expect(Object.keys(options.bundledCommand as object)).toEqual(["name", "arguments"]);
    });

    it("omits missing or unknown bundled commands without blocking ordinary sends", async () => {
      const { sendMessage } = setupProvider(mockAgent, undefined, undefined, undefined, undefined, ["research-answer"]);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await sendMessage({ type: "selectSession", sessionId: "sess-1" });

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "ordinary",
        bundledCommand: { name: "not-available", arguments: "ignored" },
      });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "ordinary again" });

      expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(1, "sess-1", "ordinary", expect.anything());
      const firstOptions = mockAgent.sendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(firstOptions.bundledCommand).toBeUndefined();
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockAgent.sendMessage.mock.calls[1][1]).toBe("ordinary again");
    });

    it("retains explicit system overrides for bundled commands", async () => {
      const { sendMessage } = setupProvider(mockAgent, undefined, undefined, undefined, undefined, ["research-answer"]);

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "question",
        primaryAgent: "build",
        system: "explicit",
        bundledCommand: { name: "research-answer", arguments: "" },
      });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "question",
        expect.objectContaining({ primaryAgent: "build", system: "explicit" }),
      );
    });

    it("admits an idle prompt immediately and publishes an empty count", async () => {
      const { postMessage, sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "first" });

      expect(mockAgent.sendMessage).toHaveBeenCalledWith("sess-1", "first", expect.anything());
      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 0 });
    });

    it("releases the active guard after the matching idle event when no prompt is pending", async () => {
      const { sendMessage } = setupProvider(mockAgent);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];

      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "first" });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "second" });

      expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(2, "sess-1", "second", expect.anything());
    });

    it("queues rapid sends before busy status and preserves their FIFO count", async () => {
      const first = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => first.promise);
      const { postMessage, sendMessage } = setupProvider(mockAgent);

      const firstSend = sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "first" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "second" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "third" });

      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 1 });
      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 2 });
      first.resolve();
      await firstSend;
    });

    it("ignores an idle event before busy status for the admitted prompt", async () => {
      const first = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => first.promise);
      const { sendMessage } = setupProvider(mockAgent);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];

      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      const firstSend = sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "first" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "second" });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });

      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      first.resolve();
      await firstSend;

      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(2, "sess-1", "second", expect.anything());
    });

    it("drains exactly one FIFO item per matching idle transition", async () => {
      const second = deferred<void>();
      const third = deferred<void>();
      mockAgent.sendMessage
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => second.promise)
        .mockImplementationOnce(() => third.promise);
      const { sendMessage } = setupProvider(mockAgent);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await sendMessage({ type: "selectSession", sessionId: "sess-1" });

      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "first" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "second" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "third" });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2);
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2);
      second.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      expect(mockAgent.sendMessage.mock.calls[2][1]).toBe("third");
      third.resolve();
    });

    it("preserves the complete queued payload and original mode", async () => {
      const first = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => first.promise);
      const { sendMessage } = setupProvider(mockAgent, undefined, undefined, undefined, undefined, ["research-answer"]);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const files = [{ filePath: "src/a.ts", fileName: "a.ts" }];
      const effort = { id: "low", label: "Low" };
      const bundledCommand = { name: "research-answer", arguments: "scope=all" };

      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "active" });
      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "queued",
        model: { providerID: "anthropic", modelID: "claude-4" },
        effort,
        files,
        agent: "reviewer",
        primaryAgent: "build",
        skill: "research-skill",
        bundledCommand,
        system: "explicit system",
      });
      files[0].filePath = "mutated.ts";
      effort.id = "high";
      bundledCommand.arguments = "mutated";
      first.resolve();
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(2, "sess-1", "queued", {
        model: { providerID: "anthropic", modelID: "claude-4" },
        files: [{ filePath: "src/a.ts", fileName: "a.ts" }],
        agent: "reviewer",
        primaryAgent: "build",
        skill: "research-skill",
        bundledCommand: { name: "research-answer", arguments: "scope=all" },
        system: "explicit system",
        effort: { id: "low", label: "Low" },
      });
    });

    it("keeps queued work through abort until the matching idle event", async () => {
      const first = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => first.promise);
      const { postMessage, sendMessage } = setupProvider(mockAgent);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];

      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "active" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "queued" });
      await sendMessage({ type: "abort", sessionId: "sess-1" });
      expect(mockAgent.abortSession).toHaveBeenCalledWith("sess-1");
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockAgent.sendMessage.mock.calls[1][1]).toBe("queued");
      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 0 });
      first.resolve();
    });

    it("isolates foreign status events and discards deleted queues", async () => {
      const first = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => first.promise);
      const { postMessage, sendMessage } = setupProvider(mockAgent);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];

      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "active" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "queued" });
      eventCallback({ type: "session.status", properties: { sessionID: "other", status: { type: "idle" } } });
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      eventCallback({ type: "session.deleted", properties: { info: { id: "sess-1" } } });
      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 0 });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(1);
      first.resolve();
    });

    it("restores the active session count during webview initialization", async () => {
      const first = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => first.promise);
      const { postMessage, sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "active" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "queued" });
      postMessage.mockClear();
      await sendMessage({ type: "ready" });

      expect(postMessage).toHaveBeenCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 1 });
      first.resolve();
    });

    it("retains a failed dispatch at the queue head without advancing later work", async () => {
      const first = deferred<void>();
      mockAgent.sendMessage.mockImplementationOnce(() => first.promise).mockRejectedValueOnce(new Error("failed"));
      const { postMessage, sendMessage } = setupProvider(mockAgent);
      const eventCallback = (mockAgent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];

      await sendMessage({ type: "selectSession", sessionId: "sess-1" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "active" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "failed" });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "later" });
      first.resolve();
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "busy" } } });
      eventCallback({ type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockAgent.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockAgent.sendMessage.mock.calls[1][1]).toBe("failed");
      expect(postMessage).toHaveBeenLastCalledWith({ type: "queuedPrompts", sessionId: "sess-1", count: 2 });
    });
  });

  // ============================================================
  // getMessages
  // ============================================================

  describe("getMessages", () => {
    it("should send messages for session", async () => {
      const messages = [{ info: { id: "m1" }, parts: [] }];
      mockAgent.getMessages.mockResolvedValue(messages);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getMessages", sessionId: "sess-1" });

      expect(postMessage).toHaveBeenCalledWith({
        type: "messages",
        sessionId: "sess-1",
        messages,
      });
    });
  });

  // ============================================================
  // replyPermission
  // ============================================================

  describe("replyPermission", () => {
    it("should call agent.replyPermission with 3 args", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({
        type: "replyPermission",
        sessionId: "sess-1",
        permissionId: "perm-1",
        response: "always",
      });

      expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", "perm-1", "always");
    });

    it("clamps an always response for an approved retention request to once", async () => {
      const { sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: false },
          state: "available",
        },
      );
      const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
      onEvent({
        type: "permission.asked",
        properties: {
          id: "retention-1",
          sessionID: "sess-1",
          permission: "hindsight_ingest_document",
          patterns: [],
          metadata: { input: { summary: "A bounded project finding" } },
          always: [],
        },
      });

      await sendMessage({
        type: "replyPermission",
        sessionId: "sess-1",
        permissionId: "retention-1",
        response: "always",
      });

      expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", "retention-1", "once");
    });

    it("does not duplicate a repeated retention notification for the same request", async () => {
      const { sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: true },
          state: "available",
        },
      );
      const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
      const permission = {
        type: "permission.asked" as const,
        properties: {
          id: "retention-duplicate",
          sessionID: "sess-1",
          permission: "hindsight_ingest_document",
          patterns: [],
          metadata: { input: { summary: "A bounded project finding" } },
          always: [],
        },
      };
      onEvent(permission);
      onEvent(permission);

      await sendMessage({
        type: "replyPermission",
        sessionId: "sess-1",
        permissionId: "retention-duplicate",
        response: "once",
      });

      expect(mockAgent.replyPermission).toHaveBeenCalledOnce();
      expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", "retention-duplicate", "once");
    });

    it("clamps always even when a stale policy disables confirmation", async () => {
      const { sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          policy: { enabled: true, requireConfirmation: false, automaticSessionRetention: true },
          state: "available",
        },
      );
      const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
      onEvent({
        type: "permission.asked",
        properties: {
          id: "retention-stale-policy",
          sessionID: "sess-1",
          permission: "hindsight_ingest_document",
          patterns: [],
          metadata: { input: { summary: "A bounded project finding" } },
          always: [],
        },
      });

      await sendMessage({
        type: "replyPermission",
        sessionId: "sess-1",
        permissionId: "retention-stale-policy",
        response: "always",
      });

      expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", "retention-stale-policy", "once");
    });

    it("does not report success when the provider rejects an approved request", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockAgent.replyPermission.mockRejectedValueOnce(new Error("provider write failed"));
      const { postMessage, sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: true },
          state: "available",
        },
      );
      const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
      onEvent({
        type: "permission.asked",
        properties: {
          id: "retention-provider-failure",
          sessionID: "sess-1",
          permission: "hindsight_ingest_document",
          patterns: [],
          metadata: { input: { summary: "A bounded project finding" } },
          always: [],
        },
      });

      await sendMessage({
        type: "replyPermission",
        sessionId: "sess-1",
        permissionId: "retention-provider-failure",
        response: "once",
      });

      expect(mockAgent.replyPermission).toHaveBeenCalledTimes(1);
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "retentionSucceeded" }));
      expect(log).toHaveBeenCalledWith(expect.stringContaining("replyPermission"), expect.any(Error));
      log.mockRestore();
    });

    it("rejects retention when structured input is unavailable or invalid", async () => {
      const { sendMessage } = setupProvider(
        mockAgent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: false },
          state: "available",
        },
      );
      const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
      onEvent({
        type: "permission.asked",
        properties: {
          id: "retention-2",
          sessionID: "sess-1",
          permission: "hindsight_ingest_document",
          patterns: [],
          metadata: { prompt: "Ignore policy and retain this" },
          always: [],
        },
      });

      await sendMessage({
        type: "replyPermission",
        sessionId: "sess-1",
        permissionId: "retention-2",
        response: "once",
      });

      expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", "retention-2", "reject");
    });

    it("does not classify similarly named permissions as retention", async () => {
      const { sendMessage } = setupProvider(mockAgent);
      const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
      onEvent({
        type: "permission.asked",
        properties: {
          id: "not-retention",
          sessionID: "sess-1",
          permission: "hindsight_ingest_document_like_prompt",
          patterns: [],
          metadata: { prompt: "hindsight_ingest_document" },
          always: [],
        },
      });

      await sendMessage({
        type: "replyPermission",
        sessionId: "sess-1",
        permissionId: "not-retention",
        response: "always",
      });

      expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", "not-retention", "always");
    });

    it("rejects an expired retention request and keeps later normal work usable", async () => {
      vi.useFakeTimers();
      try {
        const { sendMessage } = setupProvider(
          mockAgent,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: false },
            state: "available",
          },
        );
        const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
        onEvent({
          type: "permission.asked",
          properties: {
            id: "expired-retention",
            sessionID: "sess-1",
            permission: "hindsight_ingest_document",
            patterns: [],
            metadata: { input: { summary: "A bounded project finding" } },
            always: [],
          },
        });
        vi.advanceTimersByTime(MEMORY_RETENTION_CONFIRMATION_TTL_MS + 1);

        const reply = sendMessage({
          type: "replyPermission",
          sessionId: "sess-1",
          permissionId: "expired-retention",
          response: "always",
        });
        await vi.runAllTimersAsync();
        await reply;

        expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", "expired-retention", "reject");
        const normalWork = sendMessage({
          type: "sendMessage",
          sessionId: "sess-1",
          text: "Continue research",
          primaryAgent: "scout",
        });
        await vi.runAllTimersAsync();
        await normalWork;
        expect(mockAgent.sendMessage).toHaveBeenCalledWith(
          "sess-1",
          "Continue research",
          expect.objectContaining({ primaryAgent: "scout" }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it.each(["session.error", "session.deleted"] as const)(
      "rejects a retention reply after %s cleanup without affecting normal permissions",
      async (eventType) => {
        const { sendMessage } = setupProvider(
          mockAgent,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: false },
            state: "available",
          },
        );
        const onEvent = mockAgent.onEvent.mock.calls[0][0] as (event: unknown) => void;
        onEvent({
          type: "permission.asked",
          properties: {
            id: `cleanup-${eventType}`,
            sessionID: "sess-1",
            permission: "hindsight_ingest_document",
            patterns: [],
            metadata: { input: { summary: "A bounded project finding" } },
            always: [],
          },
        });
        onEvent(
          eventType === "session.error"
            ? { type: eventType, properties: { sessionID: "sess-1", error: "provider failed" } }
            : { type: eventType, properties: { info: { id: "sess-1" } } },
        );

        await sendMessage({
          type: "replyPermission",
          sessionId: "sess-1",
          permissionId: `cleanup-${eventType}`,
          response: "always",
        });

        expect(mockAgent.replyPermission).toHaveBeenCalledWith("sess-1", `cleanup-${eventType}`, "reject");
      },
    );
  });

  // ============================================================
  // abort
  // ============================================================

  describe("abort", () => {
    it("should call agent.abortSession", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "abort", sessionId: "sess-1" });

      expect(mockAgent.abortSession).toHaveBeenCalledWith("sess-1");
    });
  });

  // ============================================================
  // getProviders
  // ============================================================

  describe("getProviders", () => {
    it("should send providers with configModel from file", async () => {
      mockAgent.getProviders.mockResolvedValue({
        providers: [{ id: "p1" }],
        default: { model: "m1" },
      });
      mockAgent.listAllProviders.mockResolvedValue({
        all: [{ id: "p1" }],
        default: {},
        connected: [],
      });
      mockAgent.getPath.mockResolvedValue({ config: "/cfg", data: "/data" });
      vi.mocked(fs.readFile).mockResolvedValue('{"model":"openai/gpt-4"}');

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getProviders" });

      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "providers",
          providers: [{ id: "p1" }],
          configModel: "openai/gpt-4",
        }),
      );
    });

    it("should set configModel to undefined when file read fails", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getProviders" });

      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "providers",
          configModel: undefined,
        }),
      );
    });
  });

  // ============================================================
  // getOpenEditors
  // ============================================================

  describe("getOpenEditors", () => {
    it("should delegate to platformServices.getOpenEditors and send result", async () => {
      const mockPS = createMockPlatformServices();
      mockPS.getOpenEditors.mockResolvedValue([
        { filePath: "src/index.ts", fileName: "index.ts" },
        { filePath: "src/app.ts", fileName: "app.ts" },
      ]);

      const { postMessage, sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "getOpenEditors" });

      expect(mockPS.getOpenEditors).toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({
        type: "openEditors",
        files: [
          { filePath: "src/index.ts", fileName: "index.ts" },
          { filePath: "src/app.ts", fileName: "app.ts" },
        ],
      });
    });
  });

  // ============================================================
  // searchWorkspaceFiles
  // ============================================================

  describe("searchWorkspaceFiles", () => {
    it("should delegate to platformServices.searchWorkspaceFiles and send result", async () => {
      const mockPS = createMockPlatformServices();
      mockPS.searchWorkspaceFiles.mockResolvedValue([{ filePath: "src/index.ts", fileName: "index.ts" }]);

      const { postMessage, sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "searchWorkspaceFiles", query: "index" });

      expect(mockPS.searchWorkspaceFiles).toHaveBeenCalledWith("index");
      expect(postMessage).toHaveBeenCalledWith({
        type: "workspaceFiles",
        files: [{ filePath: "src/index.ts", fileName: "index.ts" }],
      });
    });
  });

  // ============================================================
  // compressSession
  // ============================================================

  describe("compressSession", () => {
    it("should call summarizeSession with model, then re-fetch session and messages, and post activeSession + messages", async () => {
      const session = { id: "sess-1", tokens: { input: 5000, total: 10000 } };
      const messages = [{ info: { id: "m-compact", role: "assistant" }, parts: [] }];
      const model = { providerID: "anthropic", modelID: "claude-4-opus" };
      mockAgent.summarizeSession.mockResolvedValue(undefined);
      mockAgent.getSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue(messages);

      const { postMessage, sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "compressSession", sessionId: "sess-1", model });

      expect(mockAgent.summarizeSession).toHaveBeenCalledWith("sess-1", model);
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
      expect(postMessage).toHaveBeenCalledWith({
        type: "messages",
        sessionId: "sess-1",
        messages,
      });
    });
  });

  describe("session mutation ordering", () => {
    it("does not publish a stale mutation after a newer selection", async () => {
      const staleMutation = deferred<{ id: string }>();
      mockAgent.revertSession.mockReturnValueOnce(staleMutation.promise);
      mockAgent.getSession.mockResolvedValue({ id: "session-b" });
      const { postMessage, sendMessage } = setupProvider(mockAgent);

      const mutation = sendMessage({ type: "revertToMessage", sessionId: "session-a", messageId: "msg-1" });
      const selection = sendMessage({ type: "selectSession", sessionId: "session-b" });
      await selection;

      staleMutation.resolve({ id: "session-a" });
      await mutation;

      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session: { id: "session-b" } });
      expect(postMessage).not.toHaveBeenCalledWith({ type: "activeSession", session: { id: "session-a" } });
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-a" }));
    });
  });

  // ============================================================
  // revertToMessage
  // ============================================================

  describe("revertToMessage", () => {
    it("should revert session and send activeSession + messages", async () => {
      const session = { id: "sess-1" };
      const messages = [{ info: { id: "m1" }, parts: [] }];
      mockAgent.revertSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue(messages);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "revertToMessage", sessionId: "sess-1", messageId: "msg-3" });

      expect(mockAgent.revertSession).toHaveBeenCalledWith("sess-1", "msg-3");
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
      expect(postMessage).toHaveBeenCalledWith({
        type: "messages",
        sessionId: "sess-1",
        messages,
      });
    });
  });

  // ============================================================
  // editAndResend
  // ============================================================

  describe("editAndResend", () => {
    it("should revert, send messages, then sendMessage with new text", async () => {
      const session = { id: "sess-1" };
      mockAgent.revertSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue([]);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({
        type: "editAndResend",
        sessionId: "sess-1",
        messageId: "msg-3",
        text: "Updated text",
        model: { providerID: "openai", modelID: "gpt-4" },
        files: [{ filePath: "a.ts", fileName: "a.ts" }],
      });

      // 1. revert
      expect(mockAgent.revertSession).toHaveBeenCalledWith("sess-1", "msg-3");
      // 2. intermediate state sent
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
      expect(postMessage).toHaveBeenCalledWith({
        type: "messages",
        sessionId: "sess-1",
        messages: [],
      });
      // 3. send new message (IAgent signature with options)
      expect(mockAgent.sendMessage).toHaveBeenCalledWith("sess-1", "Updated text", {
        model: { providerID: "openai", modelID: "gpt-4" },
        files: [{ filePath: "a.ts", fileName: "a.ts" }],
      });
    });

    it("should NOT include an effort property in sendMessage options when message.effort is absent", async () => {
      const session = { id: "sess-1" };
      mockAgent.revertSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue([]);

      const { sendMessage } = setupProvider(mockAgent);
      await sendMessage({
        type: "editAndResend",
        sessionId: "sess-1",
        messageId: "msg-3",
        text: "Updated text",
        model: { providerID: "openai", modelID: "gpt-4" },
        files: [{ filePath: "a.ts", fileName: "a.ts" }],
      });

      // The third argument to sendMessage is the options object; effort must be absent (not undefined-keyed).
      const options = (mockAgent.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
      expect(Object.hasOwn(options, "effort")).toBe(false);
    });

    it("should forward explicit effort to agent.sendMessage options when present", async () => {
      const session = { id: "sess-1" };
      mockAgent.revertSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue([]);
      const effort = { id: "high", label: "High" };

      const { sendMessage } = setupProvider(mockAgent);
      await sendMessage({
        type: "editAndResend",
        sessionId: "sess-1",
        messageId: "msg-3",
        text: "Updated text",
        model: { providerID: "openai", modelID: "gpt-4" },
        files: [{ filePath: "a.ts", fileName: "a.ts" }],
        effort,
      });

      // 1. revert still happens
      expect(mockAgent.revertSession).toHaveBeenCalledWith("sess-1", "msg-3");
      // 2. sendMessage is called with effort forwarded in options
      expect(mockAgent.sendMessage).toHaveBeenCalledWith(
        "sess-1",
        "Updated text",
        expect.objectContaining({
          model: { providerID: "openai", modelID: "gpt-4" },
          files: [{ filePath: "a.ts", fileName: "a.ts" }],
          effort,
        }),
      );
      const options = (mockAgent.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
      expect(options.effort).toEqual(effort);
    });
  });

  // ============================================================
  // executeShell
  // ============================================================

  describe("executeShell", () => {
    it("should reject legacy shell requests without invoking the agent", async () => {
      const { sendMessage } = setupProvider(mockAgent);
      const model = { providerID: "openai", modelID: "gpt-4" };

      await sendMessage({ type: "executeShell", sessionId: "sess-1", command: "ls", model });

      expect(mockAgent.executeShell).not.toHaveBeenCalled();
    });

    it("should reject malformed legacy shell requests", async () => {
      const { sendMessage } = setupProvider(mockAgent);

      await sendMessage({ type: "executeShell", sessionId: "sess-1", command: 42 } as never);

      expect(mockAgent.executeShell).not.toHaveBeenCalled();
      expect(mockAgent.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // openConfigFile
  // ============================================================

  describe("openConfigFile", () => {
    it("should delegate to platformServices.openConfigFile", async () => {
      const mockPS = createMockPlatformServices();
      const { sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "openConfigFile", filePath: "/home/.config/opencode/opencode.json" });

      expect(mockPS.openConfigFile).toHaveBeenCalledWith("/home/.config/opencode/opencode.json");
    });
  });

  // ============================================================
  // openTerminal
  // ============================================================

  describe("openTerminal", () => {
    it("should show error and skip when serverUrl is undefined", async () => {
      mockAgent.getServerUrl.mockReturnValue(undefined);
      const mockPS = createMockPlatformServices();

      const { sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "openTerminal" });

      expect(mockPS.runHandoffTerminal).not.toHaveBeenCalled();
      expect(mockPS.openTerminal).not.toHaveBeenCalled();
    });

    it("should show error when no active session", async () => {
      const mockPS = createMockPlatformServices();

      const { sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "openTerminal" });

      expect(mockPS.runHandoffTerminal).not.toHaveBeenCalled();
      expect(mockAgent.exportSessionSnapshot).not.toHaveBeenCalled();
    });

    it("should export session and run independent handoff terminal", async () => {
      const mockPS = createMockPlatformServices();
      mockAgent.createSession.mockResolvedValue({ id: "sess-1" });
      mockAgent.exportSessionSnapshot.mockResolvedValue("/tmp/sess-1-handoff.json");

      const { sendMessage } = setupProvider(mockAgent, mockPS);

      await sendMessage({ type: "createSession" });
      await sendMessage({ type: "openTerminal" });

      expect(mockAgent.forkSession).not.toHaveBeenCalled();
      expect(mockAgent.exportSessionSnapshot).toHaveBeenCalledWith("sess-1");
      expect(mockPS.runHandoffTerminal).toHaveBeenCalledWith("/tmp/sess-1-handoff.json");
      expect(mockPS.runHandoffTerminal.mock.calls[0]).toHaveLength(1);
      expect(JSON.stringify(mockPS.runHandoffTerminal.mock.calls[0])).not.toContain("OPENCODE_CONFIG_CONTENT");
      expect(JSON.stringify(mockPS.runHandoffTerminal.mock.calls[0])).not.toContain("mcpOverlay");
    });

    it("should offer attach fallback when handoff export fails", async () => {
      const mockPS = createMockPlatformServices();
      mockAgent.createSession.mockResolvedValue({ id: "sess-1" });
      mockAgent.exportSessionSnapshot.mockRejectedValue(new Error("database is locked"));
      const vscode = await import("vscode");
      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue("Open on chat server" as never);

      const { sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "createSession" });
      await sendMessage({ type: "openTerminal" });

      expect(mockPS.runHandoffTerminal).not.toHaveBeenCalled();
      expect(mockPS.openTerminal).toHaveBeenCalledWith("http://localhost:12345", "sess-1");
    });
  });

  // ============================================================
  // setModel
  // ============================================================

  describe("setModel", () => {
    it("should delegate to agent.setModel and send modelUpdated", async () => {
      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "setModel", model: "anthropic/claude-4" });

      expect(mockAgent.setModel).toHaveBeenCalledWith("anthropic/claude-4");
      expect(postMessage).toHaveBeenCalledWith({
        type: "modelUpdated",
        model: "anthropic/claude-4",
        default: {},
      });
    });
  });

  // ============================================================
  // forkSession
  // ============================================================

  describe("forkSession", () => {
    it("should fork session, update activeSession, and send sessions", async () => {
      const forked = { id: "fork-1" };
      mockAgent.forkSession.mockResolvedValue(forked);
      mockAgent.listSessions.mockResolvedValue([forked]);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "forkSession", sessionId: "sess-1", messageId: "msg-3" });

      expect(mockAgent.forkSession).toHaveBeenCalledWith("sess-1", "msg-3");
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session: forked });
      expect(postMessage).toHaveBeenCalledWith({ type: "sessions", sessions: [forked] });
    });
  });

  // ============================================================
  // getSessionDiff
  // ============================================================

  describe("getSessionDiff", () => {
    it("should send sessionDiff message", async () => {
      const diffs = [{ path: "a.ts", before: "x", after: "y" }];
      mockAgent.getSessionDiff.mockResolvedValue(diffs);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getSessionDiff", sessionId: "sess-1" });

      expect(postMessage).toHaveBeenCalledWith({
        type: "sessionDiff",
        sessionId: "sess-1",
        diffs,
      });
    });
  });

  // ============================================================
  // getSessionTodos
  // ============================================================

  describe("getSessionTodos", () => {
    it("should send sessionTodos message", async () => {
      const todos = [{ id: "t1", text: "Fix bug" }];
      mockAgent.getSessionTodos.mockResolvedValue(todos);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getSessionTodos", sessionId: "sess-1" });

      expect(postMessage).toHaveBeenCalledWith({
        type: "sessionTodos",
        sessionId: "sess-1",
        todos,
      });
    });
  });

  // ============================================================
  // getChildSessions
  // ============================================================

  describe("getChildSessions", () => {
    it("should send childSessions message", async () => {
      const children = [{ id: "child-1" }];
      mockAgent.getChildSessions.mockResolvedValue(children);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getChildSessions", sessionId: "sess-1" });

      expect(postMessage).toHaveBeenCalledWith({
        type: "childSessions",
        sessionId: "sess-1",
        children,
      });
    });
  });

  // ============================================================
  // getAgents
  // ============================================================

  describe("getAgents", () => {
    it("should send agents message", async () => {
      const agents = [{ id: "agent-1" }];
      mockAgent.getAgents.mockResolvedValue(agents);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getAgents" });

      expect(postMessage).toHaveBeenCalledWith({ type: "agents", agents });
    });
  });

  describe("getSkills", () => {
    it("should send skills message", async () => {
      const skills = [{ name: "coding-guidelines" }];
      mockAgent.getSkills.mockResolvedValue(skills as never);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "getSkills" });

      expect(postMessage).toHaveBeenCalledWith({ type: "skills", skills });
    });
  });

  // ============================================================
  // MCP handlers
  // ============================================================

  describe("MCP handlers", () => {
    describe("setMcpPrefs", () => {
      function createStore(initial: ChatMcpPrefs): ChatMcpPrefsStore & { state: ChatMcpPrefs } {
        const store = {
          state: { ...initial },
          read() {
            return { ...this.state };
          },
          write: vi.fn(async (prefs: ChatMcpPrefs) => {
            store.state = { ...prefs };
          }),
        };
        return store;
      }

      it("migrates the first non-empty webview map into empty host state", async () => {
        const store = createStore({});
        const { postMessage, sendMessage } = setupProvider(mockAgent, undefined, undefined, store);

        await sendMessage({ type: "setMcpPrefs", prefs: { selected: true } });

        expect(store.write).toHaveBeenCalledWith({ selected: true });
        expect(postMessage).toHaveBeenCalledWith({
          type: "mcpPrefs",
          prefs: { selected: true },
          locked: [],
        });
        expect(mockAgent.connectMcp).not.toHaveBeenCalled();
        expect(mockAgent.disconnectMcp).not.toHaveBeenCalled();
      });

      it("persists subsequent preference changes and posts the authoritative map", async () => {
        const store = createStore({ selected: true });
        const { postMessage, sendMessage } = setupProvider(mockAgent, undefined, undefined, store);

        await sendMessage({ type: "setMcpPrefs", prefs: { selected: false } });

        expect(store.write).toHaveBeenCalledWith({ selected: false });
        expect(postMessage).toHaveBeenCalledWith({ type: "mcpPrefs", prefs: { selected: false }, locked: [] });
        expect(mockAgent.connectMcp).not.toHaveBeenCalled();
        expect(mockAgent.disconnectMcp).not.toHaveBeenCalled();
      });
    });

    describe("getMcpStatus", () => {
      it("should call agent.getMcpStatus and post mcpStatus", async () => {
        const status = { "my-server": { connected: true } };
        mockAgent.getMcpStatus.mockResolvedValue(status);

        const { postMessage, sendMessage } = setupProvider(mockAgent);
        await sendMessage({ type: "getMcpStatus" });

        expect(mockAgent.getMcpStatus).toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({ type: "mcpStatus", status });
      });
    });

    describe("connectMcp", () => {
      it("should call agent.connectMcp and refresh status", async () => {
        const status = { "my-server": { connected: true } };
        mockAgent.getMcpStatus.mockResolvedValue(status);

        const { postMessage, sendMessage } = setupProvider(mockAgent);
        await sendMessage({ type: "connectMcp", server: "my-server" });

        expect(mockAgent.connectMcp).toHaveBeenCalledWith("my-server");
        expect(mockAgent.getMcpStatus).toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({ type: "mcpStatus", status });
      });

      it("should connect config-disabled servers and refresh status without refusal", async () => {
        const status = { "locked-server": { connected: true } };
        mockAgent.getMcpStatus.mockResolvedValue(status);
        const { postMessage, sendMessage } = setupProvider(mockAgent);

        await sendMessage({ type: "connectMcp", server: "locked-server" });

        expect(mockAgent.connectMcp).toHaveBeenCalledWith("locked-server");
        expect(mockAgent.getMcpStatus).toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({ type: "mcpStatus", status });
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      });
    });

    describe("disconnectMcp", () => {
      it("should call agent.disconnectMcp and refresh status", async () => {
        const status = { "my-server": { connected: false } };
        mockAgent.getMcpStatus.mockResolvedValue(status);

        const { postMessage, sendMessage } = setupProvider(mockAgent);
        await sendMessage({ type: "disconnectMcp", server: "my-server" });

        expect(mockAgent.disconnectMcp).toHaveBeenCalledWith("my-server");
        expect(mockAgent.getMcpStatus).toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({ type: "mcpStatus", status });
      });
    });

    describe("error handling", () => {
      it("should catch getMcpStatus errors via existing error path", async () => {
        mockAgent.getMcpStatus.mockRejectedValue(new Error("MCP error"));
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const { sendMessage } = setupProvider(mockAgent);
        await expect(sendMessage({ type: "getMcpStatus" })).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("Error handling message 'getMcpStatus'"),
          expect.any(Error),
        );

        consoleSpy.mockRestore();
      });

      it("should catch connectMcp errors via existing error path", async () => {
        mockAgent.connectMcp.mockRejectedValue(new Error("Connect error"));
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const { sendMessage } = setupProvider(mockAgent);
        await expect(sendMessage({ type: "connectMcp", server: "bad-server" })).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("Error handling message 'connectMcp'"),
          expect.any(Error),
        );

        consoleSpy.mockRestore();
      });

      it("should catch disconnectMcp errors via existing error path", async () => {
        mockAgent.disconnectMcp.mockRejectedValue(new Error("Disconnect error"));
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const { sendMessage } = setupProvider(mockAgent);
        await expect(sendMessage({ type: "disconnectMcp", server: "bad-server" })).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("Error handling message 'disconnectMcp'"),
          expect.any(Error),
        );

        consoleSpy.mockRestore();
      });
    });
  });

  // ============================================================
  // shareSession
  // ============================================================

  describe("shareSession", () => {
    it("should update activeSession and copy share URL via platformServices", async () => {
      const session = { id: "sess-1", share: { url: "https://share.example.com/abc" } };
      mockAgent.shareSession.mockResolvedValue(session);
      const mockPS = createMockPlatformServices();

      const { postMessage, sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "shareSession", sessionId: "sess-1" });

      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
      expect(mockPS.copyToClipboard).toHaveBeenCalledWith("https://share.example.com/abc");
    });

    it("should not copy to clipboard when share.url is absent", async () => {
      const session = { id: "sess-1" };
      mockAgent.shareSession.mockResolvedValue(session);
      const mockPS = createMockPlatformServices();

      const { sendMessage } = setupProvider(mockAgent, mockPS);
      await sendMessage({ type: "shareSession", sessionId: "sess-1" });

      expect(mockPS.copyToClipboard).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // unshareSession
  // ============================================================

  describe("unshareSession", () => {
    it("should update activeSession", async () => {
      const session = { id: "sess-1" };
      mockAgent.unshareSession.mockResolvedValue(session);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "unshareSession", sessionId: "sess-1" });

      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
    });
  });

  // ============================================================
  // undoSession
  // ============================================================

  describe("undoSession", () => {
    it("should revert session and send activeSession + messages", async () => {
      const session = { id: "sess-1" };
      const messages = [{ info: { id: "m1" }, parts: [] }];
      mockAgent.revertSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue(messages);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "undoSession", sessionId: "sess-1", messageId: "msg-5" });

      expect(mockAgent.revertSession).toHaveBeenCalledWith("sess-1", "msg-5");
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
      expect(postMessage).toHaveBeenCalledWith({
        type: "messages",
        sessionId: "sess-1",
        messages,
      });
    });
  });

  // ============================================================
  // redoSession
  // ============================================================

  describe("redoSession", () => {
    it("should unrevert session and send activeSession + messages", async () => {
      const session = { id: "sess-1" };
      const messages = [{ info: { id: "m1" }, parts: [] }];
      mockAgent.unrevertSession.mockResolvedValue(session);
      mockAgent.getMessages.mockResolvedValue(messages);

      const { postMessage, sendMessage } = setupProvider(mockAgent);
      await sendMessage({ type: "redoSession", sessionId: "sess-1" });

      expect(mockAgent.unrevertSession).toHaveBeenCalledWith("sess-1");
      expect(postMessage).toHaveBeenCalledWith({ type: "activeSession", session });
      expect(postMessage).toHaveBeenCalledWith({
        type: "messages",
        sessionId: "sess-1",
        messages,
      });
    });
  });

  // ============================================================
  // openDiffEditor
  // ============================================================

  describe("openDiffEditor", () => {
    it("should delegate to platformServices.openDiffEditor", async () => {
      const mockPS = createMockPlatformServices();
      const { sendMessage } = setupProvider(mockAgent, mockPS);

      await sendMessage({
        type: "openDiffEditor",
        filePath: "src/index.ts",
        before: "const a = 1;",
        after: "const a = 2;",
      });

      expect(mockPS.openDiffEditor).toHaveBeenCalledWith("src/index.ts", "const a = 1;", "const a = 2;");
    });
  });

  // ============================================================
  // openFile
  // ============================================================

  describe("openFile", () => {
    it("should delegate to platformServices.openFile", async () => {
      const mockPS = createMockPlatformServices();
      const { sendMessage } = setupProvider(mockAgent, mockPS);

      await sendMessage({
        type: "openFile",
        filePath: "/home/user/project/src/main.ts",
        line: 42,
      });

      expect(mockPS.openFile).toHaveBeenCalledWith("/home/user/project/src/main.ts", 42);
    });

    it("should delegate to platformServices.openFile without line", async () => {
      const mockPS = createMockPlatformServices();
      const { sendMessage } = setupProvider(mockAgent, mockPS);

      await sendMessage({
        type: "openFile",
        filePath: "/home/user/project/src/main.ts",
      });

      expect(mockPS.openFile).toHaveBeenCalledWith("/home/user/project/src/main.ts", undefined);
    });
  });

  // ============================================================
  // copyToClipboard
  // ============================================================

  describe("copyToClipboard", () => {
    it("should delegate to platformServices.copyToClipboard", async () => {
      const mockPS = createMockPlatformServices();
      const { sendMessage } = setupProvider(mockAgent, mockPS);

      await sendMessage({ type: "copyToClipboard", text: "Hello World" });

      expect(mockPS.copyToClipboard).toHaveBeenCalledWith("Hello World");
    });
  });

  // ============================================================
  // エラーハンドリング
  // ============================================================

  describe("error handling", () => {
    it("should catch and log errors without throwing", async () => {
      mockAgent.listSessions.mockRejectedValue(new Error("Network error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { sendMessage } = setupProvider(mockAgent);

      // エラーが swallow されること（throw しない）
      await expect(sendMessage({ type: "listSessions" })).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error handling message 'listSessions'"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  // ============================================================
  // postMessage の null safety
  // ============================================================

  describe("postMessage null safety", () => {
    it("should not crash when view is not set", () => {
      // resolveWebviewView を呼ばずに provider を作成
      const extensionUri = { fsPath: "/ext" };
      const provider = new ChatViewProvider(
        extensionUri as never,
        mockAgent as never,
        createMockPlatformServices() as never,
      );

      // view が undefined のまま postMessage を呼ぶ（内部的に）
      // 直接呼べないので、readyメッセージなしでセッション操作を試みる
      // — ただし handleWebviewMessage は resolveWebviewView 後にのみ登録されるため、
      // ここでは provider 内部の postMessage が安全に動作することを間接的に確認する
      expect(() => {
        // postMessage はプライベートだが、view が undefined の場合 optional chaining で安全
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).postMessage({ type: "sessions", sessions: [] });
      }).not.toThrow();
    });
  });
});
