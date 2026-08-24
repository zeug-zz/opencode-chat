import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { vi } from "vitest";

const harness = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  stopForReconnect: vi.fn().mockResolvedValue(undefined),
  updateLaunchConfiguration: vi.fn(),
  launchConfigurations: [] as unknown[],
}));

vi.mock("@opencode-chat/agent-opencode", async () => {
  const actual = await vi.importActual<typeof import("@opencode-chat/agent-opencode")>("@opencode-chat/agent-opencode");
  return {
    ...actual,
    OpenCodeAgent: class MockOpenCodeAgent {
      workspaceFolder: string | undefined;
      onAvailabilityError: ((error: unknown) => void) | undefined;

      constructor(configuration: unknown) {
        harness.launchConfigurations.push(configuration);
      }

      connect = harness.connect;
      disconnect = harness.disconnect;
      stopForReconnect = harness.stopForReconnect;
      updateLaunchConfiguration = harness.updateLaunchConfiguration;
      onEvent = vi.fn(() => ({ dispose: vi.fn() }));
      getPath = vi.fn().mockResolvedValue({ config: "tmp", data: "tmp" });
      listSessions = vi.fn().mockResolvedValue([]);
      getSession = vi.fn().mockResolvedValue(null);
      getProviders = vi.fn().mockResolvedValue({ providers: [], default: {} });
      listAllProviders = vi.fn().mockResolvedValue({ all: [], default: {}, connected: [] });
      getAgents = vi.fn().mockResolvedValue([]);
      getMcpStatus = vi.fn().mockResolvedValue({});
    },
  };
});

import * as vscode from "vscode";

type FileSnapshot = {
  exists: boolean;
  content?: string;
  mtimeMs?: number;
  ctimeMs?: number;
};

async function snapshot(filePath: string): Promise<FileSnapshot> {
  try {
    const [metadata, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    return { exists: true, content, mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs };
  } catch {
    return { exists: false };
  }
}

function createWebview() {
  let handler: ((message: unknown) => void) | undefined;
  const webview = {
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((nextHandler: (message: unknown) => void) => {
      handler = nextHandler;
      return { dispose: vi.fn() };
    }),
    asWebviewUri: vi.fn((uri: { fsPath: string }) => uri.fsPath),
    cspSource: "https://test.csp",
    options: {},
    html: "",
  };
  return {
    webview,
    send: async (message: unknown) => {
      handler?.(message);
      await new Promise((resolveMessage) => setTimeout(resolveMessage, 0));
    },
  };
}

describe("Chat MCP config ownership", () => {
  it("does not write config files across a toggle and companion restart", async () => {
    await mkdir("tmp", { recursive: true });
    const fixtureRoot = await mkdtemp("tmp/chat-mcp-no-write-");
    const previousEnvironment = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
      TMPDIR: process.env.TMPDIR,
    };
    const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    const originalRegisterWebviewViewProvider = vscode.window.registerWebviewViewProvider;
    let mode: "inherit" | "on" = "inherit";
    let extension: typeof import("../extension") | undefined;

    try {
      const workspaceRoot = resolve(join(fixtureRoot, "workspace"));
      const globalConfigHome = resolve(join(fixtureRoot, "global-config-home"));
      const globalConfigDir = join(globalConfigHome, "opencode");
      await Promise.all([
        mkdir(join(workspaceRoot, ".git"), { recursive: true }),
        mkdir(globalConfigDir, { recursive: true }),
        mkdir(join(fixtureRoot, "data"), { recursive: true }),
        mkdir(join(fixtureRoot, "cache"), { recursive: true }),
        mkdir(join(fixtureRoot, "temp"), { recursive: true }),
      ]);

      const configFiles = [
        join(globalConfigDir, "opencode.json"),
        join(globalConfigDir, "opencode.jsonc"),
        join(workspaceRoot, "opencode.json"),
        join(workspaceRoot, "opencode.jsonc"),
        join(workspaceRoot, ".mcp.json"),
      ];
      await writeFile(
        configFiles[0],
        JSON.stringify({ mcp: { globalServer: { command: "global-command" } } }, null, 2),
      );
      await writeFile(
        configFiles[2],
        JSON.stringify({ mcp: { workspaceServer: { command: "workspace-command", enabled: false } } }, null, 2),
      );
      await writeFile(
        configFiles[4],
        JSON.stringify({ mcpServers: { dotMcpServer: { command: "dot-mcp-command" } } }, null, 2),
      );

      process.env.XDG_CONFIG_HOME = globalConfigHome;
      process.env.XDG_DATA_HOME = resolve(join(fixtureRoot, "data"));
      process.env.XDG_CACHE_HOME = resolve(join(fixtureRoot, "cache"));
      process.env.TMPDIR = resolve(join(fixtureRoot, "temp"));
      vscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot, scheme: "file" } }] as never;
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

      const before = await Promise.all(configFiles.map((filePath) => snapshot(filePath)));
      const beforeConfigEntries = await Promise.all(
        [globalConfigDir, workspaceRoot].map(
          async (directory) => [directory, (await readdir(directory)).sort()] as const,
        ),
      );
      const webview = createWebview();
      vi.mocked(vscode.window.registerWebviewViewProvider).mockImplementation(((
        _viewType: string,
        provider: { resolveWebviewView: (view: unknown, context: unknown, token: unknown) => void },
      ) => {
        provider.resolveWebviewView({ webview: webview.webview }, {}, { isCancellationRequested: false });
        return { dispose: vi.fn() } as never;
      }) as never);

      vi.resetModules();
      extension = await import("../extension");
      const workspaceState = new Map<string, unknown>();
      const context = {
        extensionUri: { fsPath: join(fixtureRoot, "extension") },
        subscriptions: [],
        workspaceState: {
          get: <T>(key: string) => workspaceState.get(key) as T | undefined,
          update: async (key: string, value: unknown) => {
            workspaceState.set(key, value);
          },
        },
      };
      await context.workspaceState.update("chatMcpPrefsByServer", { workspaceServer: true });

      await extension.activate(context as never);
      expect(harness.connect).toHaveBeenCalledTimes(1);

      await webview.send({ type: "setMcpPrefs", prefs: { workspaceServer: true } });
      expect(workspaceState.get("chatMcpPrefsByServer")).toEqual({ workspaceServer: true });

      const configurationListener = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)?.[0] as
        | ((event: { affectsConfiguration: (section: string, scope?: unknown) => boolean }) => void)
        | undefined;
      expect(configurationListener).toBeDefined();
      mode = "on";
      configurationListener?.({
        affectsConfiguration: (section) => section === "opencode-chat.chatSandbox.mode",
      });

      await vi.waitFor(() => expect(harness.connect).toHaveBeenCalledTimes(2));
      expect(harness.stopForReconnect).toHaveBeenCalledTimes(1);
      expect(harness.updateLaunchConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpOverlay: {
            mcp: {
              globalServer: { enabled: false },
              workspaceServer: { enabled: true },
              dotMcpServer: { enabled: false },
            },
          },
        }),
      );
      expect(harness.launchConfigurations.at(-1)).toEqual(
        expect.objectContaining({
          mcpOverlay: {
            mcp: {
              globalServer: { enabled: false },
              workspaceServer: { enabled: true },
              dotMcpServer: { enabled: false },
            },
          },
        }),
      );

      const after = await Promise.all(configFiles.map((filePath) => snapshot(filePath)));
      expect(after).toEqual(before);
      const afterConfigEntries = await Promise.all(
        [globalConfigDir, workspaceRoot].map(
          async (directory) => [directory, (await readdir(directory)).sort()] as const,
        ),
      );
      expect(afterConfigEntries).toEqual(beforeConfigEntries);
      for (const [index, filePath] of configFiles.entries()) {
        expect((await snapshot(filePath)).exists).toBe(before[index].exists);
      }
    } finally {
      extension?.deactivate();
      vscode.workspace.workspaceFolders = originalWorkspaceFolders;
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation(originalGetConfiguration);
      vi.mocked(vscode.window.registerWebviewViewProvider).mockImplementation(originalRegisterWebviewViewProvider);
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
