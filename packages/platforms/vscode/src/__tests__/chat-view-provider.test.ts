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
import type { IAgent, IPlatformServices } from "@opencode-chat/core";
import * as vscode from "vscode";
import type { ChatMcpPrefs, ChatMcpPrefsStore } from "../chat-mcp-prefs";
import { ChatViewProvider } from "../chat-view-provider";

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
) {
  const extensionUri = { fsPath: "/ext" };
  const ps = mockPlatformServices ?? createMockPlatformServices();
  const provider = new ChatViewProvider(extensionUri as never, mockAgent as never, ps as never, {
    setChatSandboxSettings,
    chatMcpPrefs,
    bundledResources,
    bundledCommandNames,
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
  });

  // ============================================================
  // activeEditor リスナー
  // ============================================================

  describe("activeEditor listener", () => {
    it("should send activeEditor message when editor changes", () => {
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

    it("should send null for non-file scheme editor", () => {
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
    });

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

  describe("refresh after reconnect", () => {
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

      await sendMessage({
        type: "sendMessage",
        sessionId: "sess-1",
        text: "ordinary",
        bundledCommand: { name: "not-available", arguments: "ignored" },
      });
      await sendMessage({ type: "sendMessage", sessionId: "sess-1", text: "ordinary again" });

      expect(mockAgent.sendMessage).toHaveBeenNthCalledWith(1, "sess-1", "ordinary", expect.anything());
      const firstOptions = mockAgent.sendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(firstOptions.bundledCommand).toBeUndefined();
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
