/**
 * OpenCodeAgent のユニットテスト。
 * @opencode-ai/sdk/v2 をモックし、各パブリックメソッドが正しいパラメータで SDK を呼び出し、
 * mapper を通してドメイン型に変換されることを検証する。
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeAgent } from "../opencode-agent";

const mockSandboxManager = vi.hoisted(() => ({
  isSupportedPlatform: vi.fn().mockReturnValue(true),
  initialize: vi.fn().mockResolvedValue(undefined),
  wrapWithSandbox: vi.fn().mockResolvedValue("sandboxed-command"),
  reset: vi.fn().mockResolvedValue(undefined),
  getSandboxViolationStore: vi.fn(),
  annotateStderrWithSandboxFailures: vi.fn((_command: string, stderr: string) => stderr),
}));
const mockViolationStore = vi.hoisted(() => ({
  clear: vi.fn(),
  getViolations: vi.fn().mockReturnValue([]),
  getViolationsForCommand: vi.fn().mockReturnValue([]),
}));
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("@vscode/sandbox-runtime", () => ({ SandboxManager: mockSandboxManager }));
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

// --- SDK モック ---

/** SDK クライアントのモックを生成する */
function createMockSdkClient() {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ data: { id: "sess-1", title: "Test" } }),
      get: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      delete: vi.fn().mockResolvedValue(undefined),
      fork: vi.fn().mockResolvedValue({ data: { id: "sess-2" } }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      promptAsync: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      shell: vi.fn().mockResolvedValue(undefined),
      children: vi.fn().mockResolvedValue({ data: [] }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      share: vi.fn().mockResolvedValue({ data: { id: "sess-1", share: { url: "https://example.com" } } }),
      unshare: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      diff: vi.fn().mockResolvedValue({ data: [] }),
      revert: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      unrevert: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      summarize: vi.fn().mockResolvedValue(undefined),
    },
    config: {
      providers: vi.fn().mockResolvedValue({ data: { providers: [], default: {} } }),
      get: vi.fn().mockResolvedValue({ data: {} }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    provider: {
      list: vi.fn().mockResolvedValue({ data: { all: [], default: {}, connected: [] } }),
    },
    permission: {
      reply: vi.fn().mockResolvedValue(undefined),
    },
    question: {
      reply: vi.fn().mockResolvedValue(undefined),
      reject: vi.fn().mockResolvedValue(undefined),
    },
    app: {
      agents: vi.fn().mockResolvedValue({ data: [] }),
      skills: vi.fn().mockResolvedValue({ data: [] }),
    },
    mcp: {
      status: vi.fn().mockResolvedValue({ data: {} }),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    },
    tool: {
      ids: vi.fn().mockResolvedValue({ data: ["tool-1", "tool-2"] }),
    },
    path: {
      get: vi
        .fn()
        .mockResolvedValue({ data: { config: "/home/.config/opencode", data: "/home/.local/share/opencode" } }),
    },
    global: {
      event: vi.fn().mockResolvedValue({
        stream: (async function* () {
          // デフォルトは空ストリーム
        })(),
      }),
    },
  };
}

let mockClient: ReturnType<typeof createMockSdkClient>;
const mockServerClose = vi.fn();

function createSandboxChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const handlers: Record<string, (...args: never[]) => void> = {};
  const child = {
    stdout,
    stderr,
    kill: vi.fn(),
    once: (event: string, handler: (...args: never[]) => void) => {
      handlers[event] = handler;
      return child;
    },
  };
  return { child, stdout, stderr, handlers };
}

function createControlledStream() {
  let resolveNext: ((result: IteratorResult<unknown>) => void) | undefined;
  let stopped = false;
  const stream = {
    next: () => {
      if (stopped) return Promise.resolve({ done: true, value: undefined });
      return new Promise<IteratorResult<unknown>>((resolve) => {
        resolveNext = resolve;
      });
    },
    return: () => {
      stopped = true;
      resolveNext?.({ done: true, value: undefined });
      return Promise.resolve({ done: true, value: undefined });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    push(value: unknown) {
      resolveNext?.({ done: false, value });
      resolveNext = undefined;
    },
    isStopped: () => stopped,
  };
  return stream;
}

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeServer: vi.fn().mockImplementation(() =>
    Promise.resolve({
      url: "http://localhost:12345",
      close: mockServerClose,
    }),
  ),
  createOpencodeClient: vi.fn().mockImplementation(() => mockClient),
}));

describe("OpenCodeAgent", () => {
  let agent: OpenCodeAgent;

  beforeEach(() => {
    mockClient = createMockSdkClient();
    mockSandboxManager.isSupportedPlatform.mockReturnValue(true);
    mockSandboxManager.getSandboxViolationStore.mockReturnValue(mockViolationStore);
    mockViolationStore.getViolations.mockReturnValue([]);
    mockViolationStore.getViolationsForCommand.mockReturnValue([]);
    // createOpencodeClient のモック実装を更新
    vi.mocked(createOpencodeClient).mockReturnValue(mockClient as never);
    agent = new OpenCodeAgent();
  });

  afterEach(() => {
    agent.disconnect();
    vi.clearAllMocks();
  });

  // ============================================================
  // getCapabilities
  // ============================================================

  describe("getCapabilities()", () => {
    it("should return all capabilities as true", () => {
      const caps = agent.getCapabilities();

      expect(caps.sessionDelete).toBe(true);
      expect(caps.sessionFork).toBe(true);
      expect(caps.sessionRevert).toBe(true);
      expect(caps.sessionShare).toBe(true);
      expect(caps.sessionSummarize).toBe(true);
      expect(caps.sessionDiff).toBe(true);
      expect(caps.todo).toBe(true);
      expect(caps.multiProvider).toBe(true);
      expect(caps.permission).toBe(true);
      expect(caps.mcp).toBe(true);
      expect(caps.subAgent).toBe(true);
      expect(caps.shell).toBe(true);
      expect(caps.config).toBe(true);
    });
  });

  // ============================================================
  // connect / disconnect / lifecycle
  // ============================================================

  describe("connect()", () => {
    it("keeps Chat unsandboxed without initializing the runtime on unsupported platforms", async () => {
      mockSandboxManager.isSupportedPlatform.mockReturnValue(false);
      const unsupportedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: ["/workspace/project"], readOnlyPaths: [], denyReadPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await unsupportedAgent.connect();

      expect(createOpencodeServer).toHaveBeenCalled();
      expect(mockSandboxManager.initialize).not.toHaveBeenCalled();
      expect(mockSandboxManager.wrapWithSandbox).not.toHaveBeenCalled();
      expect(mockSandboxManager.reset).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      unsupportedAgent.disconnect();
    });

    it("surfaces supported-platform sandbox construction failures without fallback", async () => {
      const failure = new Error("sandbox policy construction failed");
      mockSandboxManager.initialize.mockRejectedValueOnce(failure);
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: ["/workspace/project"], readOnlyPaths: [], denyReadPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await expect(sandboxedAgent.connect()).rejects.toThrow(
        "Sandboxed OpenCode startup failed; no unsandboxed fallback was started",
      );
      expect(createOpencodeServer).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
    });

    it("should keep the default startup path unsandboxed", async () => {
      await agent.connect();

      expect(createOpencodeServer).toHaveBeenCalledWith({
        port: 0,
        config: expect.any(Object),
      });
      expect(createOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://localhost:12345" });
      expect(mockClient.global.event).toHaveBeenCalledTimes(1);
      expect(mockSandboxManager.initialize).not.toHaveBeenCalled();
      expect(mockSandboxManager.wrapWithSandbox).not.toHaveBeenCalled();
      expect(mockSandboxManager.reset).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it("should create server with port 0 and Scout config overlay", async () => {
      await agent.connect();

      const options = vi.mocked(createOpencodeServer).mock.calls[0]?.[0];
      expect(options).toBeDefined();
      if (!options) throw new Error("Expected companion server options");
      expect(options).toEqual({
        port: 0,
        config: {
          agent: {
            scout: {
              mode: "all",
              description: "Read-only chat and research companion.",
              permission: {
                edit: "deny",
                bash: "deny",
                task: "deny",
                read: "allow",
                glob: "allow",
                grep: "allow",
                list: "allow",
                webfetch: "allow",
                websearch: "allow",
                question: "allow",
              },
            },
            build: {
              permission: {
                "*": "deny",
                read: "allow",
                glob: "allow",
                grep: "allow",
                list: "allow",
                webfetch: "allow",
                websearch: "allow",
                edit: "allow",
              },
            },
          },
        },
      });
      expect(options.config).not.toHaveProperty("mcp");
      expect(createOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://localhost:12345" });
    });

    it("should pass the same MCP overlay to sandboxed and unsandboxed children", async () => {
      const mcpOverlay = {
        mcp: {
          localMcp: { enabled: true },
          remoteMcp: { enabled: false },
        },
      };
      const launchConfiguration = {
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "off" as const,
          enabled: false,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: ["/workspace/project"], readOnlyPaths: [] },
        },
        executable: { path: "/usr/local/bin/opencode" },
        mcpOverlay,
      };

      const unsandboxedAgent = new OpenCodeAgent(launchConfiguration);
      await unsandboxedAgent.connect();
      const unsandboxedOptions = vi.mocked(createOpencodeServer).mock.calls[0]?.[0];
      expect(unsandboxedOptions?.config?.mcp).toEqual(mcpOverlay.mcp);
      unsandboxedAgent.disconnect();

      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        ...launchConfiguration,
        sandbox: { ...launchConfiguration.sandbox, mode: "on", enabled: true },
      });

      await sandboxedAgent.connect();

      const options = vi.mocked(spawn).mock.calls[0]?.[1];
      if (!options) throw new Error("Expected sandboxed child spawn options");
      const sandboxedOverlay = JSON.parse((options.env as Record<string, string>).OPENCODE_CONFIG_CONTENT);
      expect(sandboxedOverlay.mcp).toEqual(unsandboxedOptions?.config?.mcp);
      expect(sandboxedOverlay.mcp).toEqual(mcpOverlay.mcp);
      sandboxedAgent.disconnect();
    });

    it("should constrain Build-backed Write to the effective report tools", async () => {
      await agent.connect();

      const options = vi.mocked(createOpencodeServer).mock.calls[0]?.[0];
      expect(options).toBeDefined();
      if (!options) throw new Error("Expected companion server options");
      const config = options.config;
      const agents = config?.agent as Record<string, { permission?: Record<string, string> }>;
      const writePermission = agents.build.permission;
      const allowedTools = ["read", "glob", "grep", "list", "webfetch", "websearch", "edit"];
      const deniedTools = ["bash", "task", "question", "todowrite", "skill"];

      expect(writePermission?.["*"]).toBe("deny");
      expect(Object.keys(writePermission ?? {}).filter((key) => key !== "*")).toEqual(allowedTools);
      expect(allowedTools.every((tool) => writePermission?.[tool] === "allow")).toBe(true);
      expect(deniedTools.every((tool) => (writePermission?.[tool] ?? writePermission?.["*"]) === "deny")).toBe(true);
      expect(agents.build).not.toHaveProperty("prompt");
      expect(agents.scout.permission).toEqual({
        edit: "deny",
        bash: "deny",
        task: "deny",
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        webfetch: "allow",
        websearch: "allow",
        question: "allow",
      });
    });

    it("should not write config files during connect", async () => {
      await agent.connect();

      expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
      expect(vi.mocked(fs.mkdir)).not.toHaveBeenCalled();
    });

    it("should pass the merged agent and MCP overlay to a sandboxed child", async () => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const discoveredUrl = "http://127.0.0.1:4567";
      const child = {
        stdout,
        stderr,
        kill: vi.fn(),
        once: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === "error" || event === "exit") {
            childHandlers[event] = handler;
          }
          return child;
        },
      };
      const childHandlers: Record<string, (...args: unknown[]) => void> = {};
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", `OpenCode server listening at ${discoveredUrl}\n`));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: ["/workspace/project"], readOnlyPaths: [] },
        },
        executable: { path: "/usr/local/bin/opencode" },
        mcpOverlay: {
          mcp: {
            localMcp: { enabled: true },
            remoteMcp: { enabled: false },
          },
        },
      });

      await sandboxedAgent.connect();

      expect(createOpencodeClient).toHaveBeenCalledWith({ baseUrl: discoveredUrl });
      expect(mockClient.global.event).toHaveBeenCalled();
      expect(sandboxedAgent.getServerUrl()).toBe(discoveredUrl);
      const options = vi.mocked(spawn).mock.calls[0]?.[1];
      expect(options).toMatchObject({
        cwd: "/workspace/project",
        shell: true,
        env: expect.objectContaining({
          OPENCODE_CONFIG_CONTENT: expect.any(String),
        }),
      });
      if (!options) throw new Error("Expected sandboxed child spawn options");
      const overlay = JSON.parse((options.env as Record<string, string>).OPENCODE_CONFIG_CONTENT);
      expect(overlay).toEqual({
        agent: {
          scout: {
            mode: "all",
            description: "Read-only chat and research companion.",
            permission: {
              edit: "deny",
              bash: "deny",
              task: "deny",
              read: "allow",
              glob: "allow",
              grep: "allow",
              list: "allow",
              webfetch: "allow",
              websearch: "allow",
              question: "allow",
            },
          },
          build: {
            permission: {
              "*": "deny",
              read: "allow",
              glob: "allow",
              grep: "allow",
              list: "allow",
              webfetch: "allow",
              websearch: "allow",
              edit: "allow",
            },
          },
        },
        mcp: {
          localMcp: { enabled: true },
          remoteMcp: { enabled: false },
        },
      });
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledWith(expect.any(String));

      sandboxedAgent.disconnect();
    });

    it.each([
      {
        allowNetwork: true,
        expectedNetwork: {
          enabled: false,
          allowedDomains: [],
          deniedDomains: [],
          allowLocalBinding: true,
        },
      },
      {
        allowNetwork: false,
        expectedNetwork: {
          enabled: true,
          allowedDomains: ["localhost", "127.0.0.1"],
          deniedDomains: [],
          allowLocalBinding: true,
        },
      },
    ])("should map allowNetwork=$allowNetwork independently of the filesystem policy", async ({
      allowNetwork,
      expectedNetwork,
    }) => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const filesystemPolicy = {
        readWritePaths: ["/workspace/project", "/workspace/state"],
        readOnlyPaths: ["/workspace/config"],
      };
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork,
          filesystemPolicy,
        },
        executable: { path: "/usr/local/bin/opencode" },
      });

      await sandboxedAgent.connect();

      expect(mockSandboxManager.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          network: expectedNetwork,
          filesystem: {
            denyRead: [],
            allowRead: ["/workspace/config", "/workspace/project", "/workspace/state"],
            allowWrite: ["/workspace/project", "/workspace/state"],
            denyWrite: [],
          },
        }),
        undefined,
        true,
      );
      sandboxedAgent.disconnect();
    });

    it("passes the computed deny-read baseline unchanged to the inherited sandbox runtime", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const denyReadPaths = [
        "/Users/test/.ssh",
        "/Users/test/.config/gh/hosts.yml",
        "/Users/test/Library/Application Support/Google/Chrome",
        "/Users/test/Library/Calendars",
      ];
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: {
            readWritePaths: ["/workspace/project", "/workspace/state"],
            readOnlyPaths: ["/workspace/config"],
            denyReadPaths,
          },
        },
        executable: { path: "/usr/local/bin/opencode" },
      });

      await sandboxedAgent.connect();

      expect(mockSandboxManager.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          filesystem: {
            denyRead: denyReadPaths,
            allowRead: ["/workspace/config", "/workspace/project", "/workspace/state"],
            allowWrite: ["/workspace/project", "/workspace/state"],
            denyWrite: [],
          },
        }),
        undefined,
        true,
      );
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledTimes(1);
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledWith(expect.stringContaining("'serve'"));
      expect(spawn).toHaveBeenCalledWith(
        "sandboxed-command",
        expect.objectContaining({
          cwd: "/workspace/project",
          detached: true,
          shell: true,
        }),
      );
      sandboxedAgent.disconnect();
    });

    it("uses one inherited unrestricted network policy for the companion tree when enabled", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: ["/workspace/project"], readOnlyPaths: [] },
        },
        executable: { path: "/usr/local/bin/opencode" },
      });

      await sandboxedAgent.connect();

      expect(mockSandboxManager.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          network: {
            enabled: false,
            allowedDomains: [],
            deniedDomains: [],
            allowLocalBinding: true,
          },
        }),
        undefined,
        true,
      );
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledTimes(1);
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledWith(
        expect.stringContaining("'--hostname' '127.0.0.1'"),
      );
      sandboxedAgent.disconnect();
    });

    it.each([
      { allowNetwork: false, outcome: "denies provider and MCP requests inside the sandbox" },
      { allowNetwork: true, outcome: "allows provider and MCP requests inside the sandbox" },
    ])("applies one inherited policy to providers, remote MCPs, local MCPs, and descendants when network is $allowNetwork ($outcome)", async ({
      allowNetwork,
    }) => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const networkError = new Error("network request denied by sandbox");
      if (!allowNetwork) {
        mockClient.config.providers.mockRejectedValue(networkError);
        mockClient.mcp.status.mockResolvedValue({
          data: {
            remoteMcp: { status: "failed", error: networkError.message },
            localMcp: { status: "failed", error: networkError.message },
          },
        });
        mockClient.mcp.connect.mockRejectedValue(networkError);
      }
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork,
          filesystemPolicy: { readWritePaths: ["/workspace/project"], readOnlyPaths: [] },
        },
        executable: { path: "/usr/local/bin/opencode" },
      });

      await sandboxedAgent.connect();

      const runtimeConfig = vi.mocked(mockSandboxManager.initialize).mock.calls[0]?.[0];
      expect(runtimeConfig?.network).toEqual(
        allowNetwork
          ? { enabled: false, allowedDomains: [], deniedDomains: [], allowLocalBinding: true }
          : { enabled: true, allowedDomains: ["localhost", "127.0.0.1"], deniedDomains: [], allowLocalBinding: true },
      );
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledTimes(1);
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledWith(
        expect.stringContaining("'serve' '--hostname' '127.0.0.1'"),
      );

      if (allowNetwork) {
        await expect(sandboxedAgent.getProviders()).resolves.toEqual({ providers: [], default: {} });
        await expect(sandboxedAgent.connectMcp("remoteMcp")).resolves.toBeUndefined();
        await expect(sandboxedAgent.connectMcp("localMcp")).resolves.toBeUndefined();
        await expect(sandboxedAgent.getMcpStatus()).resolves.toEqual({});
      } else {
        await expect(sandboxedAgent.getProviders()).rejects.toThrow(networkError);
        await expect(sandboxedAgent.connectMcp("remoteMcp")).rejects.toThrow(networkError);
        await expect(sandboxedAgent.connectMcp("localMcp")).rejects.toThrow(networkError);
        const mcpStatus = await sandboxedAgent.getMcpStatus();
        expect(mcpStatus.remoteMcp.error).toContain("network request/startup");
        expect(mcpStatus.localMcp.error).toContain("network request/startup");
      }

      expect(createOpencodeServer).not.toHaveBeenCalled();
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledTimes(1);
      sandboxedAgent.disconnect();
    });

    it("passes the platform adapter Mach lookup policy through to the runtime", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: false,
          networkPolicy: {
            enabled: true,
            allowedDomains: ["localhost", "127.0.0.1"],
            deniedDomains: [],
            allowLocalBinding: true,
            allowMachLookup: ["com.apple.SystemConfiguration.DNSConfiguration", "com.apple.trustd.agent"],
          },
          filesystemPolicy: { readWritePaths: ["/workspace/project"], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await sandboxedAgent.connect();

      expect(mockSandboxManager.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          network: expect.objectContaining({
            allowMachLookup: ["com.apple.SystemConfiguration.DNSConfiguration", "com.apple.trustd.agent"],
          }),
        }),
        undefined,
        true,
      );
      sandboxedAgent.disconnect();
    });

    it("should quote the selected executable, pass serve arguments, workspace cwd, and stdio options", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "OpenCode server listening at http://127.0.0.1:4567\n"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "/Applications/Open Code/op'en", args: ["--config", "/workspace/config.json"] },
      });

      await sandboxedAgent.connect();

      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledWith(
        "'/Applications/Open Code/op'\\''en' '--config' '/workspace/config.json' 'serve' '--hostname' '127.0.0.1' '--port' '0'",
      );
      expect(spawn).toHaveBeenCalledWith("sandboxed-command", {
        cwd: "/workspace/project",
        env: expect.objectContaining({ OPENCODE_CONFIG_CONTENT: expect.any(String) }),
        detached: true,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      sandboxedAgent.disconnect();
    });

    it("should discover the loopback URL before creating the SDK client and subscribing to global events", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "server ready at http://127.0.0.1:9876\n"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await sandboxedAgent.connect();

      expect(mockViolationStore.clear).toHaveBeenCalled();
      expect(mockSandboxManager.initialize).toHaveBeenCalledWith(expect.any(Object), undefined, true);
      expect(createOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:9876" });
      expect(mockClient.global.event).toHaveBeenCalledTimes(1);
      sandboxedAgent.disconnect();
    });

    it("bounds and redacts diagnostics when a ready companion exits", async () => {
      const { child, stdout, handlers } = createSandboxChild();
      const availabilityError = vi.fn();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => {
          stdout.emit("data", "http://127.0.0.1:4567\n");
          stdout.emit(
            "data",
            `${"x".repeat(10_000)} CONTEXT7_API_KEY=prefixed-secret-value token=secret-value authorization=Bearer abc123\n`,
          );
        });
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });
      sandboxedAgent.onAvailabilityError = availabilityError;

      await sandboxedAgent.connect();
      handlers.exit?.(23, "SIGTERM");
      await new Promise((resolve) => setImmediate(resolve));

      const error = availabilityError.mock.calls[0]?.[0] as Error;
      expect(error.message).toContain("code=23, signal=SIGTERM");
      expect(error.message).toContain("readiness");
      expect(error.message).not.toContain("prefixed-secret-value");
      expect(error.message).not.toContain("secret-value");
      expect(error.message).not.toContain("abc123");
      expect(error.message.length).toBeLessThan(5_500);
      sandboxedAgent.disconnect();
    });

    it("should include stdout and stderr in sandboxed startup failures", async () => {
      const { child, stdout, stderr, handlers } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => {
          stdout.emit("data", "binding failed\n");
          stderr.emit("data", "permission denied\n");
          handlers.exit?.(1, null);
        });
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await expect(sandboxedAgent.connect()).rejects.toThrow(
        /Sandboxed OpenCode startup failed.*stdout:\n(?:binding failed).*stderr:\n(?:permission denied)/s,
      );
      expect(createOpencodeServer).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalled();
    });

    it("redacts the MCP overlay and its definition values from sandbox startup diagnostics", async () => {
      const { child, stderr, handlers } = createSandboxChild();
      const mcpOverlay = {
        mcp: {
          privateMcp: { enabled: false },
        },
      };
      const overlayPayload = JSON.stringify(mcpOverlay);
      const diagnosticPayload =
        `${"x".repeat(10_000)} failure OPENCODE_CONFIG_CONTENT=${overlayPayload} ` +
        'command="node private-mcp.js" env="MCP_TOKEN=overlay-token" ' +
        'headers="x-api-key: overlay-header" apiKey="overlay-api-key"';
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => {
          stderr.emit("data", `${diagnosticPayload}\n`);
          handlers.exit?.(1, null);
        });
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
        mcpOverlay,
      });

      const failure = await sandboxedAgent.connect().catch((error) => error as Error);
      const diagnostic = failure.message;
      const options = vi.mocked(spawn).mock.calls[0]?.[1];

      if (!options) throw new Error("Expected sandboxed child spawn options");
      const launchOverlay = JSON.parse((options.env as Record<string, string>).OPENCODE_CONFIG_CONTENT);
      expect(launchOverlay.mcp).toEqual(mcpOverlay.mcp);
      expect(diagnostic).toContain("OPENCODE_CONFIG_CONTENT=[redacted]");
      expect(diagnostic).not.toContain(overlayPayload);
      expect(diagnostic).not.toContain("privateMcp");
      expect(diagnostic).not.toContain("private-mcp.js");
      expect(diagnostic).not.toContain("MCP_TOKEN=overlay-token");
      expect(diagnostic).not.toContain("overlay-header");
      expect(diagnostic).not.toContain("overlay-api-key");
      expect(diagnostic.length).toBeLessThan(5_500);
    });

    it("includes bounded violation-store details in sandbox startup failures", async () => {
      const { child, handlers } = createSandboxChild();
      mockViolationStore.getViolationsForCommand.mockReturnValue([
        { line: "deny network api_key=hidden-value", timestamp: new Date("2026-01-01T00:00:00.000Z") },
      ]);
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => handlers.exit?.(13, null));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: false,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      const failure = await sandboxedAgent.connect().catch((error) => error as Error);
      expect(failure.message).toContain("Sandbox violations");
      expect(failure.message).toContain("deny network");
      expect(failure.message).not.toContain("hidden-value");
    });

    it("should report a sandboxed child startup error without falling back", async () => {
      const { child, stderr, handlers } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => {
          stderr.emit("data", "cannot execute\n");
          handlers.error?.(new Error("ENOENT"));
        });
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await expect(sandboxedAgent.connect()).rejects.toThrow(/child error: ENOENT.*cannot execute/s);
      expect(createOpencodeServer).not.toHaveBeenCalled();
      expect(mockSandboxManager.reset).toHaveBeenCalled();
    });

    it("should preserve the startup failure when runtime reset rejects", async () => {
      const { child, handlers } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => handlers.error?.(new Error("cannot execute")));
        return child as never;
      });
      mockSandboxManager.reset.mockRejectedValueOnce(new Error("reset failed"));
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await expect(sandboxedAgent.connect()).rejects.toThrow(/child error: cannot execute/);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(createOpencodeServer).not.toHaveBeenCalled();
    });

    it("should report a sandboxed child early exit with connection details", async () => {
      const { child, handlers } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => handlers.exit?.(2, "SIGTERM"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await expect(sandboxedAgent.connect()).rejects.toThrow(
        /Sandboxed OpenCode startup failed.*127\.0\.0\.1.*child exited before readiness.*code=2.*SIGTERM/s,
      );
      expect(createOpencodeServer).not.toHaveBeenCalled();
    });

    it("should fail deterministically when sandboxed readiness times out", async () => {
      vi.useFakeTimers();
      try {
        const { child } = createSandboxChild();
        vi.mocked(spawn).mockImplementationOnce(() => child as never);
        const sandboxedAgent = new OpenCodeAgent({
          workspacePath: "/workspace/project",
          sandbox: {
            mode: "on",
            enabled: true,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
          },
          executable: { path: "opencode" },
        });
        const connection = sandboxedAgent.connect();
        const failure = expect(connection).rejects.toThrow(
          /Sandboxed OpenCode startup failed.*timed out after 10000ms/s,
        );
        await vi.advanceTimersByTimeAsync(10_000);

        await failure;
        expect(createOpencodeServer).not.toHaveBeenCalled();
        expect(child.kill).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should subscribe to SSE events after connecting", async () => {
      await agent.connect();

      expect(mockClient.global.event).toHaveBeenCalled();
    });

    it("should expose serverUrl via getServerUrl() after connecting", async () => {
      expect(agent.getServerUrl()).toBeUndefined();
      await agent.connect();
      expect(agent.getServerUrl()).toBe("http://localhost:12345");
    });
  });

  describe("disconnect()", () => {
    it("should abort SSE, close server, and clear state", async () => {
      await agent.connect();

      agent.disconnect();

      expect(mockServerClose).toHaveBeenCalled();
      expect(agent.getServerUrl()).toBeUndefined();
    });

    it("should be idempotent (no crash when called without connect)", () => {
      expect(() => agent.disconnect()).not.toThrow();
    });

    it("should reset the sandbox runtime after the child is stopped", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });
      await sandboxedAgent.connect();

      let resolveReset!: () => void;
      mockSandboxManager.reset.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveReset = resolve)));
      sandboxedAgent.disconnect();
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
      expect(sandboxedAgent.getServerUrl()).toBeUndefined();
      resolveReset();
      await Promise.resolve();
      sandboxedAgent.disconnect();
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
    });

    it("terminates a valid sandbox process group gracefully before escalating and resetting", async () => {
      vi.useFakeTimers();
      const processKill = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        const { child, stdout } = createSandboxChild();
        Object.assign(child, { pid: 4242, exitCode: null });
        vi.mocked(spawn).mockImplementationOnce(() => {
          queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
          return child as never;
        });
        const sandboxedAgent = new OpenCodeAgent({
          workspacePath: "/workspace/project",
          sandbox: {
            mode: "on",
            enabled: true,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
          },
          executable: { path: "opencode" },
        });
        await sandboxedAgent.connect();

        sandboxedAgent.disconnect();
        expect(processKill).toHaveBeenCalledWith(-4242, "SIGTERM");
        expect(mockSandboxManager.reset).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(processKill).toHaveBeenCalledWith(-4242, "SIGKILL");
        expect(mockSandboxManager.reset).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
      } finally {
        processKill.mockRestore();
        vi.useRealTimers();
      }
    });

    it("defers reconnect spawn until sandbox process-group cleanup resolves", async () => {
      vi.useFakeTimers();
      const processKill = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        const first = createSandboxChild();
        Object.assign(first.child, { pid: 4242, exitCode: null });
        const replacement = createSandboxChild();
        Object.assign(replacement.child, { pid: 4343, exitCode: 0 });
        let spawnCount = 0;
        vi.mocked(spawn).mockImplementation(() => {
          const child = spawnCount++ === 0 ? first : replacement;
          queueMicrotask(() => child.stdout.emit("data", "http://127.0.0.1:4567\n"));
          return child.child as never;
        });
        const sandboxedAgent = new OpenCodeAgent({
          workspacePath: "/workspace/project",
          sandbox: {
            mode: "on",
            enabled: true,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
          },
          executable: { path: "opencode" },
        });
        await sandboxedAgent.connect();
        expect(spawnCount).toBe(1);

        let resolveReset!: () => void;
        mockSandboxManager.reset.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveReset = resolve)));
        const reconnect = sandboxedAgent.reconnect();
        expect(processKill).toHaveBeenCalledWith(-4242, "SIGTERM");
        expect(spawnCount).toBe(1);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(processKill).toHaveBeenCalledWith(-4242, "SIGKILL");
        expect(spawnCount).toBe(1);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
        expect(spawnCount).toBe(1);

        resolveReset();
        await reconnect;
        expect(spawnCount).toBe(2);
        sandboxedAgent.disconnect();
      } finally {
        processKill.mockRestore();
        vi.useRealTimers();
      }
    });

    it("treats an exited child or ESRCH process group as completed teardown", async () => {
      const processKill = vi.spyOn(process, "kill").mockImplementation(() => {
        const error = new Error("gone") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      });
      try {
        const { child, stdout } = createSandboxChild();
        Object.assign(child, { pid: 4242, exitCode: null });
        vi.mocked(spawn).mockImplementationOnce(() => {
          queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
          return child as never;
        });
        const sandboxedAgent = new OpenCodeAgent({
          workspacePath: "/workspace/project",
          sandbox: {
            mode: "on",
            enabled: true,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
          },
          executable: { path: "opencode" },
        });
        await sandboxedAgent.connect();
        sandboxedAgent.disconnect();
        await Promise.resolve();
        expect(processKill).toHaveBeenCalledWith(-4242, "SIGTERM");
        expect(processKill).toHaveBeenCalledTimes(1);
        expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
      } finally {
        processKill.mockRestore();
      }
    });

    it("does not signal an already-exited valid sandbox child", async () => {
      const processKill = vi.spyOn(process, "kill");
      try {
        const { child, stdout } = createSandboxChild();
        Object.assign(child, { pid: 4242, exitCode: 0 });
        vi.mocked(spawn).mockImplementationOnce(() => {
          queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
          return child as never;
        });
        const sandboxedAgent = new OpenCodeAgent({
          workspacePath: "/workspace/project",
          sandbox: {
            mode: "on",
            enabled: true,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
          },
          executable: { path: "opencode" },
        });
        await sandboxedAgent.connect();
        sandboxedAgent.disconnect();
        expect(processKill).not.toHaveBeenCalled();
        expect(child.kill).not.toHaveBeenCalled();
        expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
      } finally {
        processKill.mockRestore();
      }
    });

    it("does not escalate when the group leader exits during the grace period", async () => {
      vi.useFakeTimers();
      const processKill = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        const { child, stdout, handlers } = createSandboxChild();
        Object.assign(child, { pid: 4242, exitCode: null });
        vi.mocked(spawn).mockImplementationOnce(() => {
          queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
          return child as never;
        });
        const sandboxedAgent = new OpenCodeAgent({
          workspacePath: "/workspace/project",
          sandbox: {
            mode: "on",
            enabled: true,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
          },
          executable: { path: "opencode" },
        });
        await sandboxedAgent.connect();
        sandboxedAgent.disconnect();
        handlers.exit?.(0, "SIGTERM");
        await vi.advanceTimersByTimeAsync(1_000);
        expect(processKill).toHaveBeenCalledTimes(1);
        expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
      } finally {
        processKill.mockRestore();
        vi.useRealTimers();
      }
    });

    it("uses direct child termination for pid-less sandbox test doubles", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const processKill = vi.spyOn(process, "kill");
      try {
        const sandboxedAgent = new OpenCodeAgent({
          workspacePath: "/workspace/project",
          sandbox: {
            mode: "on",
            enabled: true,
            allowNetwork: true,
            filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
          },
          executable: { path: "opencode" },
        });
        await sandboxedAgent.connect();
        sandboxedAgent.disconnect();
        expect(child.kill).toHaveBeenCalledTimes(1);
        expect(processKill).not.toHaveBeenCalled();
      } finally {
        processKill.mockRestore();
      }
    });

    it("should invalidate availability and reset after an unexpected ready-child exit", async () => {
      const { child, stdout, handlers } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "http://127.0.0.1:4567\n"));
        return child as never;
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });
      await sandboxedAgent.connect();

      handlers.exit?.(1, "SIGTERM");
      await Promise.resolve();
      await Promise.resolve();

      expect(sandboxedAgent.getServerUrl()).toBeUndefined();
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(mockSandboxManager.reset).toHaveBeenCalledTimes(1);
      expect(createOpencodeServer).not.toHaveBeenCalled();
      await expect(sandboxedAgent.listSessions()).rejects.toThrow("not connected");
    });

    it("should clear event listeners", async () => {
      await agent.connect();
      const listener = vi.fn();
      agent.onEvent(listener);

      agent.disconnect();

      // After disconnect, listeners should be cleared.
      // Reconnect and fire events — old listener should NOT be called.
      await agent.connect();
      // 新しいストリームからイベントを流しても、旧リスナーは呼ばれない
      // （disconnect で listeners.clear() されているため）
    });

    it("should preserve listeners across reconnect and clear them on final disconnect", async () => {
      const streams = [createControlledStream(), createControlledStream(), createControlledStream()];
      const [firstStream, secondStream, thirdStream] = streams;
      mockClient.global.event.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        const stream = streams.shift();
        if (!stream) throw new Error("No stream available");
        signal.addEventListener("abort", () => void stream.return?.());
        return Promise.resolve({ stream });
      });
      const listener = vi.fn();
      agent.onEvent(listener);

      await agent.connect();
      await agent.reconnect();

      expect(firstStream.isStopped()).toBe(true);
      secondStream.push({ payload: { type: "session.updated", properties: { id: "after-reconnect" } } });
      await vi.waitFor(() =>
        expect(listener).toHaveBeenCalledWith({ type: "session.updated", properties: { id: "after-reconnect" } }),
      );

      agent.disconnect();
      await agent.connect();
      thirdStream.push({ payload: { type: "session.updated", properties: { id: "after-disposal" } } });
      await Promise.resolve();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("requireClient() (via public methods)", () => {
    it("should throw when not connected", async () => {
      await expect(agent.listSessions()).rejects.toThrow("OpenCode client is not connected. Call connect() first.");
    });
  });

  // ============================================================
  // Session API
  // ============================================================

  describe("listSessions()", () => {
    it("should call client.session.list() and return mapped data", async () => {
      const sessions = [{ id: "s1" }, { id: "s2" }];
      mockClient.session.list.mockResolvedValue({ data: sessions });
      await agent.connect();

      const result = await agent.listSessions();

      expect(mockClient.session.list).toHaveBeenCalled();
      expect(result).toEqual(sessions);
    });
  });

  describe("createSession()", () => {
    it("should call client.session.create() with title", async () => {
      await agent.connect();

      await agent.createSession("My Session");

      expect(mockClient.session.create).toHaveBeenCalledWith({
        title: "My Session",
      });
    });

    it("should pass undefined title when not provided", async () => {
      await agent.connect();

      await agent.createSession();

      expect(mockClient.session.create).toHaveBeenCalledWith({
        title: undefined,
      });
    });
  });

  describe("getSession()", () => {
    it("should call client.session.get() with correct sessionID", async () => {
      await agent.connect();

      await agent.getSession("sess-1");

      expect(mockClient.session.get).toHaveBeenCalledWith({
        sessionID: "sess-1",
      });
    });
  });

  describe("deleteSession()", () => {
    it("should call client.session.delete() with correct sessionID", async () => {
      await agent.connect();

      await agent.deleteSession("sess-1");

      expect(mockClient.session.delete).toHaveBeenCalledWith({
        sessionID: "sess-1",
      });
    });
  });

  describe("forkSession()", () => {
    it("should call with messageId when provided", async () => {
      await agent.connect();

      await agent.forkSession("sess-1", "msg-5");

      expect(mockClient.session.fork).toHaveBeenCalledWith({
        sessionID: "sess-1",
        messageID: "msg-5",
      });
    });

    it("should call with undefined messageID when not provided", async () => {
      await agent.connect();

      await agent.forkSession("sess-1");

      expect(mockClient.session.fork).toHaveBeenCalledWith({
        sessionID: "sess-1",
        messageID: undefined,
      });
    });
  });

  // ============================================================
  // Message API
  // ============================================================

  describe("getMessages()", () => {
    it("should call with correct sessionId", async () => {
      await agent.connect();

      await agent.getMessages("sess-1");

      expect(mockClient.session.messages).toHaveBeenCalledWith({
        sessionID: "sess-1",
      });
    });
  });

  describe("sendMessage()", () => {
    it("should send text-only message", async () => {
      await agent.connect();

      await agent.sendMessage("sess-1", "Hello");

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        sessionID: "sess-1",
        parts: [{ type: "text", text: "Hello" }],
        model: undefined,
        agent: undefined,
      });
      // Default (no explicit effort) must NOT include a `variant` key
      // so the opencode server applies its own default behavior.
      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(Object.hasOwn(call, "variant")).toBe(false);
    });

    it("should send message with model via options", async () => {
      await agent.connect();
      const model = { providerID: "anthropic", modelID: "claude-4" };

      await agent.sendMessage("sess-1", "Hello", { model });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        sessionID: "sess-1",
        parts: [{ type: "text", text: "Hello" }],
        model,
        agent: undefined,
      });
      // Model set without explicit effort must NOT include a `variant` key.
      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(Object.hasOwn(call, "variant")).toBe(false);
    });

    it("should forward explicit effort as top-level variant sibling of model", async () => {
      await agent.connect();
      const model = { providerID: "openai", modelID: "gpt-5.4" };
      const effort = { id: "low" };

      await agent.sendMessage("sess-1", "Hello", { model, effort });

      expect(mockClient.session.promptAsync).toHaveBeenCalledWith({
        sessionID: "sess-1",
        parts: [{ type: "text", text: "Hello" }],
        model,
        agent: undefined,
        variant: "low",
      });
      // variant lives at the top level — never inside model
      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(call.variant).toBe("low");
      expect((call.model as { variant?: unknown })?.variant).toBeUndefined();
    });

    it("should drop variant when effort is null or has empty id", async () => {
      await agent.connect();
      const model = { providerID: "openai", modelID: "gpt-5.4" };

      await agent.sendMessage("sess-1", "Hello", { model, effort: { id: "" } });

      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(Object.hasOwn(call, "variant")).toBe(false);
    });

    it("should keep explicit effort alongside files/agent/skill parts", async () => {
      await agent.connect();
      agent.workspaceFolder = "/ws";
      const model = { providerID: "openai", modelID: "gpt-5.4" };
      const effort = { id: "high" };
      const files = [{ filePath: "a.ts", fileName: "a.ts" }];

      await agent.sendMessage("sess-1", "Review", {
        model,
        effort,
        files,
        agent: "reviewer",
        skill: "coding-guidelines",
      });

      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(call.model).toEqual(model);
      expect(call.variant).toBe("high");
      expect(call.parts).toHaveLength(4);
      expect(call.parts[0]).toEqual({ type: "text", text: "/coding-guidelines", synthetic: true });
      expect(call.parts[1]).toEqual({ type: "text", text: "Review" });
      expect(call.parts[2].type).toBe("file");
      expect(call.parts[3]).toEqual({ type: "agent", name: "reviewer" });
    });

    it("should convert relative file paths to absolute using workspaceFolder", async () => {
      await agent.connect();
      agent.workspaceFolder = "/workspace/project";
      const files = [{ filePath: "src/index.ts", fileName: "index.ts" }];

      await agent.sendMessage("sess-1", "Check this", { files });

      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(call.parts).toHaveLength(2);
      expect(call.parts[1]).toEqual({
        type: "file",
        mime: "text/plain",
        url: "file:///workspace/project/src/index.ts",
        filename: "index.ts",
      });
    });

    it("should not modify absolute file paths", async () => {
      await agent.connect();
      const files = [{ filePath: "/absolute/path/file.ts", fileName: "file.ts" }];

      await agent.sendMessage("sess-1", "Check", { files });

      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(call.parts[1]).toEqual({
        type: "file",
        mime: "text/plain",
        url: "file:///absolute/path/file.ts",
        filename: "file.ts",
      });
    });

    it("should add agent part when agent is provided via options", async () => {
      await agent.connect();

      await agent.sendMessage("sess-1", "Hello", { agent: "code-reviewer" });

      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(call.parts).toHaveLength(2);
      expect(call.parts[1]).toEqual({ type: "agent", name: "code-reviewer" });
    });

    it("should prepend synthetic skill command when skill is provided", async () => {
      await agent.connect();

      await agent.sendMessage("sess-1", "Hello", { skill: "coding-guidelines" } as never);

      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(call.parts).toHaveLength(2);
      expect(call.parts[0]).toEqual({ type: "text", text: "/coding-guidelines", synthetic: true });
      expect(call.parts[1]).toEqual({ type: "text", text: "Hello" });
    });

    it("should include all parts when files and agent are provided", async () => {
      await agent.connect();
      agent.workspaceFolder = "/ws";
      const model = { providerID: "openai", modelID: "gpt-4" };
      const files = [{ filePath: "a.ts", fileName: "a.ts" }];

      await agent.sendMessage("sess-1", "Review", { model, files, agent: "reviewer" });

      const call = mockClient.session.promptAsync.mock.calls[0][0];
      expect(call.parts).toHaveLength(3);
      expect(call.parts[0]).toEqual({ type: "text", text: "Review" });
      expect(call.parts[1].type).toBe("file");
      expect(call.parts[2]).toEqual({ type: "agent", name: "reviewer" });
      expect(call.model).toEqual(model);
    });
  });

  describe("abortSession()", () => {
    it("should call client.session.abort()", async () => {
      await agent.connect();

      await agent.abortSession("sess-1");

      expect(mockClient.session.abort).toHaveBeenCalledWith({
        sessionID: "sess-1",
      });
    });
  });

  // ============================================================
  // Shell API
  // ============================================================

  describe("executeShell()", () => {
    it("should call client.session.shell() with correct args", async () => {
      await agent.connect();
      const model = { providerID: "openai", modelID: "gpt-4" };

      await agent.executeShell("sess-1", "ls -la", model);

      expect(mockClient.session.shell).toHaveBeenCalledWith({
        sessionID: "sess-1",
        agent: "default",
        command: "ls -la",
        model,
      });
      // SDK 1.2.17 shell body has no `variant` — must stay absent.
      const call = mockClient.session.shell.mock.calls[0][0];
      expect(Object.hasOwn(call, "variant")).toBe(false);
    });

    it("should pass undefined model when not provided", async () => {
      await agent.connect();

      await agent.executeShell("sess-1", "pwd");

      expect(mockClient.session.shell).toHaveBeenCalledWith({
        sessionID: "sess-1",
        agent: "default",
        command: "pwd",
        model: undefined,
      });
      // Defensive: no variant key on shell request, even when no model is set.
      const call = mockClient.session.shell.mock.calls[0][0];
      expect(Object.hasOwn(call, "variant")).toBe(false);
    });
  });

  // ============================================================
  // Provider API
  // ============================================================

  describe("getProviders()", () => {
    it("should return providers and default from config.providers()", async () => {
      const data = { providers: [{ id: "p1" }], default: { model: "claude-4" } };
      mockClient.config.providers.mockResolvedValue({ data });
      await agent.connect();

      const result = await agent.getProviders();

      expect(result).toEqual(data);
    });
  });

  describe("listAllProviders()", () => {
    it("should return provider list from provider.list()", async () => {
      const data = { all: [{ id: "p1" }], default: {}, connected: ["p1"] };
      mockClient.provider.list.mockResolvedValue({ data });
      await agent.connect();

      const result = await agent.listAllProviders();

      expect(result).toEqual(data);
    });
  });

  // ============================================================
  // Permission API
  // ============================================================

  describe("replyPermission()", () => {
    it("should call permission.reply with correct requestID and reply", async () => {
      await agent.connect();

      await agent.replyPermission("sess-1", "perm-1", "always");

      expect(mockClient.permission.reply).toHaveBeenCalledWith({
        requestID: "perm-1",
        reply: "always",
      });
    });
  });

  // ============================================================
  // Session Children API
  // ============================================================

  describe("getChildSessions()", () => {
    it("should call client.session.children()", async () => {
      const children = [{ id: "child-1" }];
      mockClient.session.children.mockResolvedValue({ data: children });
      await agent.connect();

      const result = await agent.getChildSessions("sess-1");

      expect(mockClient.session.children).toHaveBeenCalledWith({ sessionID: "sess-1" });
      expect(result).toEqual(children);
    });
  });

  // ============================================================
  // Session Todo API
  // ============================================================

  describe("getSessionTodos()", () => {
    it("should call client.session.todo()", async () => {
      const todos = [{ id: "t1", text: "Fix bug" }];
      mockClient.session.todo.mockResolvedValue({ data: todos });
      await agent.connect();

      const result = await agent.getSessionTodos("sess-1");

      expect(mockClient.session.todo).toHaveBeenCalledWith({ sessionID: "sess-1" });
      expect(result).toEqual(todos);
    });
  });

  // ============================================================
  // Session Share API
  // ============================================================

  describe("shareSession()", () => {
    it("should call client.session.share() and return session", async () => {
      const session = { id: "sess-1", share: { url: "https://share.example.com" } };
      mockClient.session.share.mockResolvedValue({ data: session });
      await agent.connect();

      const result = await agent.shareSession("sess-1");

      expect(mockClient.session.share).toHaveBeenCalledWith({ sessionID: "sess-1" });
      expect(result).toEqual(session);
    });
  });

  describe("unshareSession()", () => {
    it("should call client.session.unshare() and return session", async () => {
      const session = { id: "sess-1" };
      mockClient.session.unshare.mockResolvedValue({ data: session });
      await agent.connect();

      const result = await agent.unshareSession("sess-1");

      expect(mockClient.session.unshare).toHaveBeenCalledWith({ sessionID: "sess-1" });
      expect(result).toEqual(session);
    });
  });

  // ============================================================
  // Agent API
  // ============================================================

  describe("getAgents()", () => {
    it("should call app.agents()", async () => {
      const agents = [{ id: "agent-1" }];
      mockClient.app.agents.mockResolvedValue({ data: agents });
      await agent.connect();

      const result = await agent.getAgents();

      expect(mockClient.app.agents).toHaveBeenCalled();
      expect(result).toEqual(agents);
    });
  });

  // ============================================================
  // Session Diff API
  // ============================================================

  describe("getSessionDiff()", () => {
    it("should call client.session.diff()", async () => {
      const diffs = [{ path: "file.ts", before: "a", after: "b" }];
      mockClient.session.diff.mockResolvedValue({ data: diffs });
      await agent.connect();

      const result = await agent.getSessionDiff("sess-1");

      expect(mockClient.session.diff).toHaveBeenCalledWith({ sessionID: "sess-1" });
      expect(result).toEqual(diffs);
    });
  });

  // ============================================================
  // Revert / Unrevert API
  // ============================================================

  describe("revertSession()", () => {
    it("should call client.session.revert() with sessionId and messageID", async () => {
      await agent.connect();

      await agent.revertSession("sess-1", "msg-3");

      expect(mockClient.session.revert).toHaveBeenCalledWith({
        sessionID: "sess-1",
        messageID: "msg-3",
      });
    });
  });

  describe("unrevertSession()", () => {
    it("should call client.session.unrevert()", async () => {
      await agent.connect();

      await agent.unrevertSession("sess-1");

      expect(mockClient.session.unrevert).toHaveBeenCalledWith({
        sessionID: "sess-1",
      });
    });
  });

  // ============================================================
  // Summarize API
  // ============================================================

  describe("summarizeSession()", () => {
    it("should call with model when provided", async () => {
      await agent.connect();
      const model = { providerID: "openai", modelID: "gpt-4" };

      await agent.summarizeSession("sess-1", model);

      expect(mockClient.session.summarize).toHaveBeenCalledWith({
        sessionID: "sess-1",
        providerID: "openai",
        modelID: "gpt-4",
      });
    });

    it("should pass undefined model when not provided", async () => {
      await agent.connect();

      await agent.summarizeSession("sess-1");

      expect(mockClient.session.summarize).toHaveBeenCalledWith({
        sessionID: "sess-1",
        providerID: undefined,
        modelID: undefined,
      });
    });
  });

  // ============================================================
  // MCP API
  // ============================================================

  describe("getMcpStatus()", () => {
    it("should call mcp.status() and normalize via mapMcpStatus", async () => {
      const sdkData = { server1: { status: "connected" } };
      mockClient.mcp.status.mockResolvedValue({ data: sdkData });
      await agent.connect();

      const result = await agent.getMcpStatus();

      expect(mockClient.mcp.status).toHaveBeenCalled();
      expect(result).toEqual({
        server1: { connected: true, status: "connected" },
      });
    });

    it("adds recent sandbox violations to failed local MCP diagnostics", async () => {
      mockClient.mcp.status.mockResolvedValue({ data: { localMcp: { status: "failed", error: "connection closed" } } });
      mockViolationStore.getViolations.mockReturnValue([
        { line: "Sandbox: deny file-read /private/token", timestamp: new Date("2026-01-01T00:00:00.000Z") },
      ]);
      await agent.connect();
      agent.updateLaunchConfiguration({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
        mcpTransport: { localMcp: "stdio" },
      });

      const result = await agent.getMcpStatus();

      expect(result.localMcp.error).toContain('MCP server "localMcp"');
      expect(result.localMcp.error).toContain("Sandbox violations");
      expect(result.localMcp.error).toContain("deny file-read");
    });

    it("retains bounded, redacted companion output after readiness for MCP failures", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "ready at http://127.0.0.1:4567\n"));
        return child as never;
      });
      mockClient.mcp.status.mockResolvedValue({
        data: { localMcp: { status: "failed", error: "connection closed" } },
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await sandboxedAgent.connect();
      stdout.emit(
        "data",
        `${"x".repeat(10_000)} config={"mcp":{"localMcp":{"env":{"API_KEY":"config-secret"}}}} token=runtime-secret authorization=Bearer bearer-secret\n`,
      );

      const result = await sandboxedAgent.getMcpStatus();

      expect(result.localMcp.error).toContain("Captured sandboxed OpenCode output");
      expect(result.localMcp.error).toContain("[redacted]");
      expect(result.localMcp.error).not.toContain("config-secret");
      expect(result.localMcp.error).not.toContain("bearer-secret");
      expect(result.localMcp.error).not.toContain('"mcp"');
      expect(result.localMcp.error?.length).toBeLessThan(5_500);
      sandboxedAgent.disconnect();
    });

    it("reports MCP child identity, operation, readiness, exit context, and preserves SDK errors", async () => {
      const { child, stdout, handlers } = createSandboxChild();
      const availabilityError = vi.fn();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "ready at http://127.0.0.1:4567\n"));
        return child as never;
      });
      mockClient.mcp.status.mockResolvedValue({
        data: { localMcp: { status: "failed", error: "connection closed during network request" } },
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: false,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
        mcpTransport: { localMcp: "stdio" },
      });
      sandboxedAgent.onAvailabilityError = availabilityError;

      await sandboxedAgent.connect();
      const result = await sandboxedAgent.getMcpStatus();
      const diagnostic = result.localMcp.error ?? "";

      expect(diagnostic).toContain('MCP child="localMcp"');
      expect(diagnostic).toContain("operation=network request/startup");
      expect(diagnostic).toContain("readiness=ready");
      expect(diagnostic).toContain("companion-exit=not-observed");
      expect(diagnostic).toContain("SDK error: connection closed during network request");
      handlers.exit?.(17, "SIGTERM");
      expect(availabilityError.mock.calls[0]?.[0].message).toContain("code=17, signal=SIGTERM");
      expect(mockSandboxManager.wrapWithSandbox).toHaveBeenCalledTimes(1);
      expect(createOpencodeServer).not.toHaveBeenCalled();
      sandboxedAgent.disconnect();
    });

    it("falls back to recent violations when the wrapper command has no exact matches", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "ready at http://127.0.0.1:4567\n"));
        return child as never;
      });
      mockClient.mcp.status.mockResolvedValue({
        data: { localMcp: { status: "failed", error: "connection closed" } },
      });
      mockViolationStore.getViolationsForCommand.mockReturnValue([]);
      mockViolationStore.getViolations.mockReturnValue([
        { line: "child deny write token=secret-value", timestamp: new Date("2026-01-01T00:00:00.000Z") },
      ]);
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
        mcpTransport: { localMcp: "stdio" },
      });

      await sandboxedAgent.connect();
      const diagnostic = (await sandboxedAgent.getMcpStatus()).localMcp.error ?? "";

      expect(mockViolationStore.getViolationsForCommand).toHaveBeenCalled();
      expect(mockViolationStore.getViolations).toHaveBeenCalledWith(8);
      expect(diagnostic).toContain("child deny write");
      expect(diagnostic).not.toContain("secret-value");
      sandboxedAgent.disconnect();
    });

    it("uses at most eight bounded fallback violation records", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "ready at http://127.0.0.1:4567\n"));
        return child as never;
      });
      mockClient.mcp.status.mockResolvedValue({ data: { localMcp: { status: "failed", error: "failed" } } });
      mockViolationStore.getViolationsForCommand.mockReturnValue([]);
      mockViolationStore.getViolations.mockReturnValue(
        Array.from({ length: 20 }, (_, index) => ({
          line: `violation-${index}`,
          timestamp: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
        })),
      );
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
        mcpTransport: { localMcp: "stdio" },
      });

      await sandboxedAgent.connect();
      const diagnostic = (await sandboxedAgent.getMcpStatus()).localMcp.error ?? "";
      expect((diagnostic.match(/violation-\d+/g) ?? []).length).toBeLessThanOrEqual(8);
      sandboxedAgent.disconnect();
    });

    it.each([
      ["http", "MCP remote HTTP operation"],
      ["sdk", "MCP in-process SDK operation"],
      ["unknown", "MCP transport=unknown (not attributed to a child)"],
    ] as const)("labels %s failures without child attribution", async (transport, label) => {
      mockClient.mcp.status.mockResolvedValue({ data: { server: { status: "failed", error: "connection closed" } } });
      mockViolationStore.getViolations.mockReturnValue([
        { line: "deny network", timestamp: new Date("2026-01-01T00:00:00.000Z") },
      ]);
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
        mcpTransport: { server: transport },
      });
      await sandboxedAgent.connect();
      const diagnostic = (await sandboxedAgent.getMcpStatus()).server.error ?? "";
      expect(diagnostic).toContain(label);
      expect(diagnostic).not.toContain('MCP child="server"');
      expect(diagnostic).not.toContain("Sandbox violation context");
      sandboxedAgent.disconnect();
    });

    it("labels aggregate companion diagnostics instead of attributing them to another MCP", async () => {
      const { child, stdout } = createSandboxChild();
      vi.mocked(spawn).mockImplementationOnce(() => {
        queueMicrotask(() => stdout.emit("data", "ready at http://127.0.0.1:4567\n"));
        return child as never;
      });
      mockClient.mcp.status.mockResolvedValue({
        data: {
          firstMcp: { status: "failed", error: "connection closed" },
          secondMcp: { status: "failed", error: "write permission denied" },
        },
      });
      const sandboxedAgent = new OpenCodeAgent({
        workspacePath: "/workspace/project",
        sandbox: {
          mode: "on",
          enabled: true,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [], readOnlyPaths: [] },
        },
        executable: { path: "opencode" },
      });

      await sandboxedAgent.connect();
      stdout.emit("data", "localMcp-a: write denied\n");
      const result = await sandboxedAgent.getMcpStatus();

      expect(result.firstMcp.error).toContain("Companion process context (aggregate; server attribution unavailable)");
      expect(result.secondMcp.error).toContain("Companion process context (aggregate; server attribution unavailable)");
      expect(result.firstMcp.error).not.toContain("secondMcp");
      expect(result.secondMcp.error).not.toContain("firstMcp");
      sandboxedAgent.disconnect();
    });
  });

  describe("connectMcp()", () => {
    it("should call mcp.connect() with name", async () => {
      await agent.connect();

      await agent.connectMcp("my-server");

      expect(mockClient.mcp.connect).toHaveBeenCalledWith({ name: "my-server" });
    });
  });

  describe("disconnectMcp()", () => {
    it("should call mcp.disconnect() with name", async () => {
      await agent.connect();

      await agent.disconnectMcp("my-server");

      expect(mockClient.mcp.disconnect).toHaveBeenCalledWith({ name: "my-server" });
    });
  });

  // ============================================================
  // Tool API
  // ============================================================

  describe("getToolIds()", () => {
    it("should call tool.ids() and return ToolListItem[] via mapper", async () => {
      await agent.connect();

      const result = await agent.getToolIds();

      expect(mockClient.tool.ids).toHaveBeenCalled();
      // mapToolIds wraps each string into { id }
      expect(result).toEqual([{ id: "tool-1" }, { id: "tool-2" }]);
    });
  });

  describe("getSkills()", () => {
    it("should call app.skills() and return mapped skills", async () => {
      mockClient.app.skills.mockResolvedValue({
        data: [{ name: "coding-guidelines", description: "desc", location: "/skills/coding-guidelines" }],
      });
      await agent.connect();

      const result = await agent.getSkills();

      expect(mockClient.app.skills).toHaveBeenCalled();
      expect(result).toEqual([
        { name: "coding-guidelines", description: "desc", location: "/skills/coding-guidelines" },
      ]);
    });
  });

  // ============================================================
  // Config API
  // ============================================================

  describe("getConfig()", () => {
    it("should call config.get()", async () => {
      const config = { model: "claude-4" };
      mockClient.config.get.mockResolvedValue({ data: config });
      await agent.connect();

      const result = await agent.getConfig();

      expect(mockClient.config.get).toHaveBeenCalled();
      expect(result).toEqual(config);
    });
  });

  describe("updateConfig()", () => {
    it("should call config.update() with config param", async () => {
      await agent.connect();

      await agent.updateConfig({ model: "gpt-4" } as never);

      expect(mockClient.config.update).toHaveBeenCalledWith({
        config: { model: "gpt-4" },
      });
    });
  });

  // ============================================================
  // Path API
  // ============================================================

  describe("getPath()", () => {
    it("should call path.get() and return mapped data", async () => {
      await agent.connect();

      const result = await agent.getPath();

      expect(mockClient.path.get).toHaveBeenCalled();
      expect(result).toEqual({
        config: "/home/.config/opencode",
        data: "/home/.local/share/opencode",
      });
    });
  });

  // ============================================================
  // Event System
  // ============================================================

  describe("onEvent()", () => {
    it("should register listener and return Disposable", async () => {
      await agent.connect();
      const listener = vi.fn();

      const disposable = agent.onEvent(listener);

      expect(disposable).toBeDefined();
      expect(typeof disposable.dispose).toBe("function");
    });

    it("should deliver events from SSE stream to listeners", async () => {
      // Stream yields { payload: Event } — production code extracts .payload
      const rawEvents = [
        { type: "session.updated", properties: { id: "sess-1" } },
        { type: "message.created", properties: { id: "msg-1" } },
      ];
      const streamEvents = rawEvents.map((payload) => ({ payload }));
      let resolveStream!: () => void;
      const streamDone = new Promise<void>((r) => {
        resolveStream = r;
      });

      mockClient.global.event.mockResolvedValue({
        stream: (async function* () {
          for (const event of streamEvents) {
            yield event;
          }
          resolveStream();
        })(),
      });

      const listener = vi.fn();
      agent.onEvent(listener);
      await agent.connect();

      // ストリームの消費は非同期なので少し待つ
      await streamDone;
      // microtask を消化
      await new Promise((r) => setTimeout(r, 0));

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(rawEvents[0]);
      expect(listener).toHaveBeenCalledWith(rawEvents[1]);
    });

    it("should remove listener when Disposable is disposed", async () => {
      // ストリームを手動制御するためのセットアップ
      let emitEvent: ((event: unknown) => void) | undefined;
      let endStream: (() => void) | undefined;

      mockClient.global.event.mockResolvedValue({
        stream: (async function* () {
          const queue: unknown[] = [];
          let resolve: (() => void) | undefined;
          let done = false;

          emitEvent = (event: unknown) => {
            queue.push(event);
            resolve?.();
          };
          endStream = () => {
            done = true;
            resolve?.();
          };

          while (!done) {
            if (queue.length > 0) {
              yield queue.shift()!;
            } else {
              await new Promise<void>((r) => {
                resolve = r;
              });
            }
          }
        })(),
      });

      await agent.connect();
      const listener = vi.fn();
      const disposable = agent.onEvent(listener);

      // Stream yields { payload: Event } — wrap events in payload
      emitEvent?.({ payload: { type: "test-event-1" } });
      await new Promise((r) => setTimeout(r, 10));
      expect(listener).toHaveBeenCalledTimes(1);

      // Dispose してからイベントを送信 — 呼ばれないはず
      disposable.dispose();
      emitEvent?.({ payload: { type: "test-event-2" } });
      await new Promise((r) => setTimeout(r, 10));
      expect(listener).toHaveBeenCalledTimes(1);

      endStream?.();
    });
  });

  describe("resubscribeEvents()", () => {
    it("should abort old stream and create new subscription", async () => {
      await agent.connect();

      // 初回の subscribe 呼び出しを確認
      expect(mockClient.global.event).toHaveBeenCalledTimes(1);

      await agent.resubscribeEvents();

      // 2回目の subscribe 呼び出し（旧ストリームの abort + 新ストリーム開始）
      expect(mockClient.global.event).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // workspaceFolder
  // ============================================================

  describe("workspaceFolder", () => {
    it("should be settable and readable", () => {
      agent.workspaceFolder = "/my/workspace";
      expect(agent.workspaceFolder).toBe("/my/workspace");
    });
  });

  // ============================================================
  // getServerUrl
  // ============================================================

  describe("getServerUrl()", () => {
    it("should return undefined before connect", () => {
      expect(agent.getServerUrl()).toBeUndefined();
    });

    it("should return server URL after connect", async () => {
      await agent.connect();
      expect(agent.getServerUrl()).toBe("http://localhost:12345");
    });

    it("should return undefined after disconnect", async () => {
      await agent.connect();
      agent.disconnect();
      expect(agent.getServerUrl()).toBeUndefined();
    });
  });

  // ============================================================
  // setModel
  // ============================================================

  describe("setModel()", () => {
    beforeEach(async () => {
      // Connect so that getPath() (requireClient) works
      await agent.connect();
    });

    it("should read existing config, set model, and write back", async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{"theme":"dark"}');

      await agent.setModel!("anthropic/claude-4");

      expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining("opencode.json"), "utf-8");
      expect(fs.mkdir).toHaveBeenCalled();
      // Verify the written JSON contains both the existing key and the new model
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const written = JSON.parse((writeCall[1] as string).trim());
      expect(written).toEqual({ theme: "dark", model: "anthropic/claude-4" });
    });

    it("should create config from empty object when file does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      await agent.setModel!("openai/gpt-4");

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const written = JSON.parse((writeCall[1] as string).trim());
      expect(written).toEqual({ model: "openai/gpt-4" });
    });

    it("should throw if agent is not connected", async () => {
      agent.disconnect();
      await expect(agent.setModel!("some-model")).rejects.toThrow("OpenCode client is not connected");
    });
  });

  describe("exportSessionSnapshot()", () => {
    it("writes {info,messages} JSON via companion client", async () => {
      const info = { id: "sess-1", title: "T" };
      const messages = [{ info: { id: "m1" }, parts: [] }];
      mockClient.session.get.mockResolvedValue({ data: info });
      mockClient.session.messages.mockResolvedValue({ data: messages });
      await agent.connect();
      const filePath = await agent.exportSessionSnapshot("sess-1");
      expect(filePath).toContain("sess-1");
      expect(mockClient.session.get).toHaveBeenCalledWith({ sessionID: "sess-1" });
      expect(mockClient.session.messages).toHaveBeenCalledWith({ sessionID: "sess-1" });
      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFile).mock.calls.at(-1)!;
      expect(writeCall[0]).toBe(filePath);
      const parsed = JSON.parse((writeCall[1] as string).trim());
      expect(parsed).toEqual({ info, messages });
    });
  });
});
