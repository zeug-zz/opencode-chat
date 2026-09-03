/**
 * extension.ts (activate / deactivate) のユニットテスト。
 * ChatViewProvider と OpenCodeAgent をモックし、起動・停止の振る舞いを検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOpenCodePaths, resolveRuntimeCachePaths } from "../chat-sandbox-policy";
import { classifyConnectError } from "../connect-error";

// --- モックの準備 ---

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
const mockStopForReconnect = vi.fn().mockResolvedValue(undefined);
const mockUpdateLaunchConfiguration = vi.fn();
const mockSandboxSupported = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockAgentLaunchConfigurations: unknown[] = [];
const mockPublishedSandboxStatuses: unknown[] = [];
const mockChatViewProviderOptions: unknown[] = [];
const mockResolveMcpInventory = vi.fn(() => ({
  servers: {
    selected: { explicitlyDisabled: false },
    unselected: { explicitlyDisabled: false },
    locked: { explicitlyDisabled: true },
  },
}));
const mockMcpOverlay = {
  mcp: { selected: { enabled: true }, unselected: { enabled: false }, locked: { enabled: true } },
};
const mockLoadBundledResearchResources = vi.fn().mockResolvedValue({ resources: [], diagnostics: [] });
let configurationListener:
  | ((event: { affectsConfiguration: (section: string, scope?: unknown) => boolean }) => void)
  | undefined;
const configurationListenerDispose = vi.fn();

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function latestLaunchConfiguration() {
  return mockAgentLaunchConfigurations[mockAgentLaunchConfigurations.length - 1];
}

// モジュールスコープで `new OpenCodeAgent()` が呼ばれるため、
// コンストラクタとして機能するクラスを返す必要がある。
function createMockAgentClass() {
  return class MockOpenCodeAgent {
    constructor(configuration: unknown) {
      mockAgentLaunchConfigurations.push(configuration);
    }

    connect = mockConnect;
    disconnect = mockDisconnect;
    stopForReconnect = mockStopForReconnect;
    updateLaunchConfiguration = mockUpdateLaunchConfiguration;
    workspaceFolder: string | undefined = undefined;
  };
}

// ChatViewProvider のモック — コンストラクタとして使われる
function createMockChatViewProviderClass() {
  return Object.assign(
    class MockChatViewProvider {
      constructor(_extensionUri: unknown, _agent: unknown, _platformServices: unknown, options: unknown) {
        mockChatViewProviderOptions.push(options);
      }
      refresh = vi.fn().mockResolvedValue(undefined);
      publishChatSandboxStatus = vi.fn((status: unknown) => mockPublishedSandboxStatuses.push(status));
    },
    { viewType: "opencode-chat.chatView" },
  );
}

import * as vscode from "vscode";

describe("extension", () => {
  let originalCwd: string;
  let chdirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    configurationListener = undefined;
    configurationListenerDispose.mockClear();
    mockConnect.mockResolvedValue(undefined);
    mockStopForReconnect.mockResolvedValue(undefined);
    mockSandboxSupported.mockReturnValue(true);
    mockAgentLaunchConfigurations.length = 0;
    mockPublishedSandboxStatuses.length = 0;
    mockChatViewProviderOptions.length = 0;
    mockLoadBundledResearchResources.mockResolvedValue({ resources: [], diagnostics: [] });
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation((listener) => {
      configurationListener = listener as typeof configurationListener;
      return { dispose: configurationListenerDispose } as never;
    });
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
      (section: string) =>
        ({
          get: vi.fn((key: string) => {
            if (section === "opencode-chat" && key === "chatSandbox.mode") return "inherit";
            if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return true;
            if (section === "chat.agent.sandbox" && key === "enabled") return "off";
            return undefined;
          }),
          inspect: vi.fn(() => undefined),
        }) as never,
    );
    originalCwd = process.cwd();
    // process.chdir を no-op にする（/workspace/project は実在しないため）
    chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
    // workspaceFolders をデフォルトで設定
    vi.mocked(vscode.workspace).workspaceFolders = [{ uri: { fsPath: "/workspace/project", scheme: "file" } }] as never;
  });

  afterEach(() => {
    chdirSpy.mockRestore();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  /**
   * extension.ts はモジュールスコープで `new OpenCodeAgent()` を実行する。
   * テストごとに新しいモジュールインスタンスが必要なので、毎回 resetModules して再 import する。
   */
  async function importExtension() {
    vi.resetModules();

    vi.doMock("@opencode-chat/agent-opencode", () => ({
      OpenCodeAgent: createMockAgentClass(),
      resolveMcpInventory: mockResolveMcpInventory,
      buildMcpOverlay: vi.fn(() => mockMcpOverlay),
    }));
    vi.doMock("@vscode/sandbox-runtime", () => ({
      SandboxManager: { isSupportedPlatform: mockSandboxSupported },
    }));
    vi.doMock("../chat-mcp-prefs", () => ({
      VscodeChatMcpPrefsStore: class MockChatMcpPrefsStore {
        read = vi.fn(() => ({ selected: true }));
        write = vi.fn().mockResolvedValue(undefined);
      },
    }));
    vi.doMock("../chat-view-provider", () => ({
      ChatViewProvider: createMockChatViewProviderClass(),
    }));
    vi.doMock("../bundled-research-resources", () => ({
      loadBundledResearchResources: mockLoadBundledResearchResources,
    }));

    return import("../extension");
  }

  // ============================================================
  // activate - 正常系
  // ============================================================

  describe("activate() - normal", () => {
    it("should connect, register webview provider and diff providers", async () => {
      const ext = await importExtension();
      const subscriptions: { dispose: () => void }[] = [];
      const context = {
        extensionUri: { fsPath: "/ext" },
        subscriptions,
      };

      await ext.activate(context as never);

      // connect が呼ばれた
      expect(mockConnect).toHaveBeenCalled();
      expect(latestLaunchConfiguration()).toMatchObject({
        mcpOverlay: {
          mcp: {
            selected: { enabled: true },
            unselected: { enabled: false },
            locked: { enabled: true },
          },
        },
      });

      // webview provider 登録
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
        "opencode-chat.chatView",
        expect.anything(),
      );

      // diff content provider 登録（2つ: before と after）
      expect(vscode.workspace.registerTextDocumentContentProvider).toHaveBeenCalledTimes(2);
      expect(vscode.workspace.registerTextDocumentContentProvider).toHaveBeenCalledWith(
        "opencode-chat-diff-before",
        expect.anything(),
      );
      expect(vscode.workspace.registerTextDocumentContentProvider).toHaveBeenCalledWith(
        "opencode-chat-diff-after",
        expect.anything(),
      );

      // subscriptions に push された (webview provider + 2 diff providers + Disposable for disconnect)
      expect(subscriptions.length).toBeGreaterThanOrEqual(3);
    });

    it("should build guidance overlay from the installed extension resources", async () => {
      mockLoadBundledResearchResources.mockResolvedValueOnce({
        resources: [
          {
            type: "skill",
            name: "research-workflow",
            description: "Research workflow",
            relativePath: "skills/research-workflow/SKILL.md",
            absolutePath: "/installed-extension/dist/skills-commands/skills/research-workflow/SKILL.md",
          },
          {
            type: "command",
            name: "research-answer",
            description: "Answer a research question",
            relativePath: "commands/research-answer.md",
            absolutePath: "/installed-extension/dist/skills-commands/commands/research-answer.md",
            template: "Research this question:\n$ARGUMENTS",
          },
        ],
        diagnostics: [],
      });
      const ext = await importExtension();
      await ext.activate({
        extensionPath: "/installed-extension",
        extensionUri: { fsPath: "/wrong-workspace" },
        subscriptions: [],
      } as never);

      expect(mockLoadBundledResearchResources).toHaveBeenCalledWith("/installed-extension/dist/skills-commands");
      expect(latestLaunchConfiguration()).toMatchObject({
        guidanceOverlay: {
          skills: { paths: ["/installed-extension/dist/skills-commands/skills"] },
          command: {
            "research-answer": {
              description: "Answer a research question",
              template: "Research this question:\n$ARGUMENTS",
            },
          },
        },
        sandbox: {
          filesystemPolicy: {
            readOnlyPaths: expect.arrayContaining(["/installed-extension/dist/skills-commands/skills"]),
            readWritePaths: expect.not.arrayContaining(["/installed-extension/dist/skills-commands/skills"]),
          },
        },
      });
      expect(mockChatViewProviderOptions.at(-1)).toMatchObject({
        bundledResources: [
          { source: "bundled", type: "skill", name: "research-workflow", description: "Research workflow" },
          { source: "bundled", type: "command", name: "research-answer", description: "Answer a research question" },
        ],
      });
    });

    it("passes only valid bundled metadata when a resource is unavailable", async () => {
      mockLoadBundledResearchResources.mockResolvedValueOnce({
        resources: [
          {
            type: "skill",
            name: "citation-audit",
            description: "Citations",
            relativePath: "skills/citation-audit/SKILL.md",
            absolutePath: "/installed-extension/dist/skills-commands/skills/citation-audit/SKILL.md",
          },
        ],
        diagnostics: [{ resourceId: "command:research-answer", type: "command", reason: "missing" }],
      });
      const ext = await importExtension();
      await ext.activate({
        extensionPath: "/installed-extension",
        extensionUri: { fsPath: "/ext" },
        subscriptions: [],
      } as never);

      expect(mockChatViewProviderOptions.at(-1)).toMatchObject({
        bundledResources: [{ source: "bundled", type: "skill", name: "citation-audit", description: "Citations" }],
      });
    });

    it("keeps requested sandboxing unsupported and unsandboxed without an enforcement claim", async () => {
      mockSandboxSupported.mockReturnValue(false);
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return "on";
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return true;
              if (section === "chat.agent.sandbox" && key === "enabled") return "off";
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );

      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(latestLaunchConfiguration()).toMatchObject({ sandbox: { mode: "off", enabled: false } });
      expect(latestLaunchConfiguration()).not.toMatchObject({ sandbox: { enabled: true } });
      expect(mockPublishedSandboxStatuses).toContainEqual(
        expect.objectContaining({ supported: false, enabled: false, error: expect.stringContaining("unsupported") }),
      );
    });

    it("should change cwd to workspace folder and restore it", async () => {
      const ext = await importExtension();
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] };

      await ext.activate(context as never);

      // chdir が workspaceFolder で呼ばれ、その後元に戻されること
      const chdirCalls = chdirSpy.mock.calls.map((c: string[]) => c[0]);
      expect(chdirCalls[0]).toBe("/workspace/project");
      // finally ブロックで元の cwd に戻される
      expect(chdirCalls.length).toBe(2);
    });

    it("should not change cwd for sandboxed activation and pass the workspace to the launch configuration", async () => {
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return "on";
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return true;
              if (section === "chat.agent.sandbox" && key === "enabled") return "off";
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );

      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      expect(chdirSpy).not.toHaveBeenCalled();
      const openCodePaths = resolveOpenCodePaths();
      expect(latestLaunchConfiguration()).toMatchObject({
        workspacePath: "/workspace/project",
        sandbox: {
          enabled: true,
          filesystemPolicy: {
            readOnlyPaths: expect.arrayContaining([openCodePaths.config]),
            readWritePaths: expect.arrayContaining([
              "/workspace/project",
              openCodePaths.state,
              openCodePaths.cache,
              openCodePaths.temp,
              ...resolveRuntimeCachePaths(),
            ]),
          },
          networkPolicy: {
            allowMachLookup:
              process.platform === "darwin"
                ? ["com.apple.SystemConfiguration.DNSConfiguration", "com.apple.trustd.agent"]
                : [],
          },
        },
      });
    });

    it("should resolve inherited native sandbox state before connecting", async () => {
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return "inherit";
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return true;
              if (section === "chat.agent.sandbox" && key === "enabled") return "on";
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );
      mockConnect.mockImplementationOnce(() => {
        expect(latestLaunchConfiguration()).toMatchObject({
          sandbox: { mode: "on", enabled: true, allowNetwork: true },
        });
        return Promise.resolve();
      });

      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(latestLaunchConfiguration()).toMatchObject({ sandbox: { mode: "on", enabled: true } });
    });

    it("should let an explicit Chat off mode override native sandbox state", async () => {
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return "off";
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return false;
              if (section === "chat.agent.sandbox" && key === "enabled") return "on";
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );
      mockConnect.mockImplementationOnce(() => {
        expect(latestLaunchConfiguration()).toMatchObject({
          sandbox: { mode: "off", enabled: false, allowNetwork: false },
        });
        return Promise.resolve();
      });

      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(latestLaunchConfiguration()).toMatchObject({ sandbox: { mode: "off", enabled: false } });
    });

    it("should register a workspace-scoped listener and apply one Chat transition for duplicate events", async () => {
      let mode: "inherit" | "on" | "off" = "inherit";
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return mode;
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return true;
              if (section === "chat.agent.sandbox" && key === "enabled") return "off";
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );
      const ext = await importExtension();
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] };
      await ext.activate(context as never);

      expect(configurationListener).toBeDefined();
      const event = {
        affectsConfiguration: vi.fn((section: string, scope?: unknown) => {
          expect(scope).toMatchObject({ fsPath: "/workspace/project", scheme: "file" });
          return section === "opencode-chat.chatSandbox.mode";
        }),
      };
      mode = "on";
      configurationListener!(event);
      configurationListener!(event);
      await vi.waitFor(() => expect(mockStopForReconnect).toHaveBeenCalledTimes(1));
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockUpdateLaunchConfiguration).toHaveBeenCalledTimes(1);
      expect(mockUpdateLaunchConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpOverlay: {
            mcp: {
              selected: { enabled: true },
              unselected: { enabled: false },
              locked: { enabled: true },
            },
          },
        }),
      );
      const listenerSubscription = context.subscriptions.find(
        (subscription) => subscription.dispose === configurationListenerDispose,
      );
      expect(listenerSubscription).toBeDefined();
      listenerSubscription?.dispose();
      expect(configurationListenerDispose).toHaveBeenCalledTimes(1);
    });

    it("should serialize repeated sandbox and network transitions through teardown", async () => {
      let mode: "inherit" | "on" | "off" = "inherit";
      let allowNetwork = true;
      const stopDeferreds = [deferred<void>(), deferred<void>(), deferred<void>()];
      const connectDeferreds = [deferred<void>(), deferred<void>(), deferred<void>()];
      const events: string[] = [];
      let activeConnects = 0;
      let activeStops = 0;
      let connectNumber = 0;
      let stopNumber = 0;

      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return mode;
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return allowNetwork;
              if (section === "chat.agent.sandbox" && key === "enabled") return "off";
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );

      mockConnect.mockImplementation(() => {
        const index = connectNumber++;
        expect(activeStops).toBe(0);
        activeConnects += 1;
        events.push(`connect:start:${index}`);
        if (index === 0) {
          activeConnects -= 1;
          events.push(`connect:end:${index}`);
          return Promise.resolve();
        }
        return connectDeferreds[index - 1].promise.then(() => {
          activeConnects -= 1;
          events.push(`connect:end:${index}`);
        });
      });
      mockStopForReconnect.mockImplementation(() => {
        const index = stopNumber++;
        expect(activeConnects).toBe(0);
        activeStops += 1;
        events.push(`stop:start:${index}`);
        return stopDeferreds[index].promise.then(() => {
          activeStops -= 1;
          events.push(`stop:end:${index}`);
        });
      });

      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      const modeEvent = {
        affectsConfiguration: vi.fn((section: string) => section === "opencode-chat.chatSandbox.mode"),
      };
      const networkEvent = {
        affectsConfiguration: vi.fn((section: string) => section === "opencode-chat.chatSandbox.allowNetwork"),
      };

      mode = "on";
      configurationListener!(modeEvent);
      await vi.waitFor(() => expect(mockStopForReconnect).toHaveBeenCalledTimes(1));
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["connect:start:0", "connect:end:0", "stop:start:0"]);

      stopDeferreds[0].resolve(undefined);
      await vi.waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(2));
      expect(events).toEqual(["connect:start:0", "connect:end:0", "stop:start:0", "stop:end:0", "connect:start:1"]);

      allowNetwork = false;
      configurationListener!(networkEvent);
      expect(mockStopForReconnect).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(2);
      connectDeferreds[0].resolve(undefined);
      await vi.waitFor(() => expect(mockStopForReconnect).toHaveBeenCalledTimes(2));

      mode = "off";
      configurationListener!(modeEvent);
      expect(mockStopForReconnect).toHaveBeenCalledTimes(2);
      expect(mockConnect).toHaveBeenCalledTimes(2);
      stopDeferreds[1].resolve(undefined);
      await vi.waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(3));

      connectDeferreds[1].resolve(undefined);
      await vi.waitFor(() => expect(mockStopForReconnect).toHaveBeenCalledTimes(3));
      expect(mockConnect).toHaveBeenCalledTimes(3);
      stopDeferreds[2].resolve(undefined);
      await vi.waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(4));
      connectDeferreds[2].resolve(undefined);

      await vi.waitFor(() => expect(events).toHaveLength(14));
      expect(mockStopForReconnect).toHaveBeenCalledTimes(3);
      expect(mockConnect).toHaveBeenCalledTimes(4);
      expect(activeConnects).toBe(0);
      expect(activeStops).toBe(0);
      expect(events).toEqual([
        "connect:start:0",
        "connect:end:0",
        "stop:start:0",
        "stop:end:0",
        "connect:start:1",
        "connect:end:1",
        "stop:start:1",
        "stop:end:1",
        "connect:start:2",
        "connect:end:2",
        "stop:start:2",
        "stop:end:2",
        "connect:start:3",
        "connect:end:3",
      ]);
      expect(modeEvent.affectsConfiguration).toHaveBeenCalled();
      expect(networkEvent.affectsConfiguration).toHaveBeenCalled();
    });

    it("should react to native enabled changes only while Chat mode is inherited", async () => {
      let mode: "inherit" | "on" | "off" = "inherit";
      let nativeEnabled: "on" | "off" = "off";
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return mode;
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return true;
              if (section === "chat.agent.sandbox" && key === "enabled") return nativeEnabled;
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );
      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);
      const nativeEvent = {
        affectsConfiguration: vi.fn((section: string) => section === "chat.agent.sandbox.enabled"),
      };

      nativeEnabled = "on";
      configurationListener!(nativeEvent);
      await vi.waitFor(() => expect(mockStopForReconnect).toHaveBeenCalledTimes(1));

      mode = "off";
      nativeEnabled = "off";
      configurationListener!(nativeEvent);
      await Promise.resolve();
      expect(mockStopForReconnect).toHaveBeenCalledTimes(1);
    });

    it("should show a VS Code error when a sandbox reconnect fails", async () => {
      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      mockConnect.mockRejectedValueOnce(new Error("sandbox runtime unavailable"));
      const event = {
        affectsConfiguration: vi.fn((section: string) => section === "opencode-chat.chatSandbox.mode"),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
        (section: string) =>
          ({
            get: vi.fn((key: string) => {
              if (section === "opencode-chat" && key === "chatSandbox.mode") return "on";
              if (section === "opencode-chat" && key === "chatSandbox.allowNetwork") return true;
              if (section === "chat.agent.sandbox" && key === "enabled") return "off";
              return undefined;
            }),
            inspect: vi.fn(() => undefined),
          }) as never,
      );

      configurationListener!(event);
      await vi.waitFor(() =>
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining("sandbox runtime unavailable"),
        ),
      );
    });
  });

  // ============================================================
  // activate - ワークスペースなし
  // ============================================================

  describe("activate() - no workspace", () => {
    it("should show warning and return early", async () => {
      vi.mocked(vscode.workspace).workspaceFolders = undefined as never;
      const ext = await importExtension();
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] };

      await ext.activate(context as never);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("workspace"));
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // activate - ENOENT エラー（opencode コマンドが見つからない）
  // ============================================================

  describe("activate() - ENOENT error", () => {
    it("should show warning for ENOENT code", async () => {
      const error = new Error("spawn opencode ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockConnect.mockRejectedValueOnce(error);

      const ext = await importExtension();
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] };

      await ext.activate(context as never);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("opencode"));
      // webview provider が登録されない
      expect(vscode.window.registerWebviewViewProvider).not.toHaveBeenCalled();
    });

    it("should show warning for ENOENT in message", async () => {
      const error = new Error("ENOENT: command not found");
      mockConnect.mockRejectedValueOnce(error);

      const ext = await importExtension();
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] };

      await ext.activate(context as never);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("opencode"));
    });
  });

  // ============================================================
  // activate - 非 ENOENT エラー（データベースロック / その他）
  // ============================================================

  describe("activate() - database locked error", () => {
    it("should show error message and register provider for database is locked", async () => {
      const error = new Error("database is locked");
      mockConnect.mockRejectedValueOnce(error);

      const ext = await importExtension();
      const subscriptions: { dispose: () => void }[] = [];
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions };

      await ext.activate(context as never);

      // database is locked ではエラーメッセージを表示
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("database"));
      // webview provider が登録される（サイドバーが無限ロードにならない）
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalled();
    });

    it("should restore cwd when normal activation fails", async () => {
      mockConnect.mockRejectedValueOnce(new Error("database is locked"));

      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      const chdirCalls = chdirSpy.mock.calls.map((c: string[]) => c[0]);
      expect(chdirCalls).toEqual(["/workspace/project", originalCwd]);
    });
  });

  describe("activate() - MCP inventory error", () => {
    it("does not connect, shows a concise error, and still registers the provider", async () => {
      mockResolveMcpInventory.mockImplementationOnce(() => {
        throw new Error("malformed config contains a secret");
      });

      const ext = await importExtension();
      await ext.activate({ extensionUri: { fsPath: "/ext" }, subscriptions: [] } as never);

      expect(mockConnect).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("could not resolve its MCP inventory"),
      );
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalled();
      expect(latestLaunchConfiguration()).toMatchObject({ mcpOverlay: { mcp: {} } });
    });
  });

  describe("activate() - other non-ENOENT error", () => {
    it("should show error message and register provider for other errors", async () => {
      const error = new Error("Connection refused");
      mockConnect.mockRejectedValueOnce(error);

      const ext = await importExtension();
      const subscriptions: { dispose: () => void }[] = [];
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions };

      await ext.activate(context as never);

      // エラーメッセージが表示される
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Connection refused"));
      // webview provider が登録される
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalled();
    });

    it("should truncate very long error messages", async () => {
      const longMessage = "x".repeat(1000);
      const error = new Error(longMessage);
      mockConnect.mockRejectedValueOnce(error);

      const ext = await importExtension();
      const subscriptions: { dispose: () => void }[] = [];
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions };

      await ext.activate(context as never);

      // 500 文字以上で ... がつく
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("..."));
    });
  });

  // ============================================================
  // classifyConnectError pure helper
  // ============================================================

  describe("classifyConnectError", () => {
    it("should return 'not-found' for ENOENT code", () => {
      const error = new Error("spawn opencode ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      expect(classifyConnectError(error)).toBe("not-found");
    });

    it("should return 'not-found' for ENOENT in message", () => {
      const error = new Error("ENOENT: command not found");
      expect(classifyConnectError(error)).toBe("not-found");
    });

    it("should return 'database-locked' for database is locked message", () => {
      const error = new Error("database is locked");
      expect(classifyConnectError(error)).toBe("database-locked");
    });

    it("should return 'database-locked' case-insensitively", () => {
      const error = new Error("DATABASE IS LOCKED");
      expect(classifyConnectError(error)).toBe("database-locked");
    });

    it("should return 'other' for unrelated errors", () => {
      const error = new Error("Connection refused");
      expect(classifyConnectError(error)).toBe("other");
    });

    it("should return 'other' for non-Error values", () => {
      expect(classifyConnectError("string error")).toBe("other");
      expect(classifyConnectError(42)).toBe("other");
      expect(classifyConnectError(null)).toBe("other");
    });
  });

  // ============================================================
  // deactivate
  // ============================================================

  describe("deactivate()", () => {
    it("should call agent.disconnect()", async () => {
      const ext = await importExtension();

      ext.deactivate();

      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  // ============================================================
  // diff content provider
  // ============================================================

  describe("diff content provider", () => {
    it("should decode URI query to provide document content", async () => {
      const ext = await importExtension();
      const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] };
      await ext.activate(context as never);

      // registerTextDocumentContentProvider に渡されたプロバイダーを取得
      const registerCalls = vi.mocked(vscode.workspace.registerTextDocumentContentProvider).mock.calls;
      const beforeProvider = registerCalls.find((c) => c[0] === "opencode-chat-diff-before")?.[1];

      expect(beforeProvider).toBeDefined();

      // URI query にエンコードされたコンテンツを渡す
      const content = "const a = 1;\nconst b = 2;";
      const uri = {
        scheme: "opencode-chat-diff-before",
        path: "src/index.ts",
        query: encodeURIComponent(content),
      };

      const result = beforeProvider!.provideTextDocumentContent(uri as never, undefined as never);
      expect(result).toBe(content);
    });
  });
});
