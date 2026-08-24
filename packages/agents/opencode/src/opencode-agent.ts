/**
 * @opencode-chat/agent-opencode - OpenCodeAgent
 *
 * Implements the IAgent interface from @opencode-chat/core, wrapping the
 * @opencode-ai/sdk to communicate with an OpenCode server.
 *
 * This is a direct port of the original `opencode-client.ts` (OpenCodeConnection),
 * adapted to the IAgent contract with SDK→domain type conversion via mappers.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createOpencodeClient, createOpencodeServer, type Event, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type {
  AgentCapabilities,
  AgentEvent,
  AgentInfo,
  AllProvidersData,
  AppConfig,
  AppPaths,
  ChatMessageWithParts,
  ChatSession,
  Disposable,
  FileDiff,
  IAgent,
  McpStatus,
  ModelRef,
  PermissionResponse,
  ProviderInfo,
  QuestionAnswer,
  SendMessageOptions,
  SkillInfo,
  TodoItem,
  ToolListItem,
} from "@opencode-chat/core";
import { SandboxManager, type SandboxRuntimeConfig } from "@vscode/sandbox-runtime";
import type { OpenCodeLaunchConfiguration } from "./launch-config";
import {
  mapAgents,
  mapAllProvidersData,
  mapConfig,
  mapEvent,
  mapFileDiffs,
  mapMcpStatus,
  mapMessagesWithParts,
  mapPath,
  mapProviders,
  mapSession,
  mapSessions,
  mapSkills,
  mapTodos,
  mapToolIds,
} from "./mappers";

type EventHandler = (event: AgentEvent) => void;

const SANDBOX_STARTUP_TIMEOUT_MS = 10_000;
const DIAGNOSTIC_TAIL_LENGTH = 4_096;
const SANDBOX_TERMINATION_GRACE_MS = 1_000;
const SANDBOX_TERMINATION_ESCALATION_MS = 1_000;

const CHAT_AGENT_OVERLAY = {
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
} as const;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

type BoundedOutput = {
  stdout: string;
  stderr: string;
};

type SandboxChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

function appendDiagnosticTail(current: string, chunk: string): string {
  const value = current + chunk;
  return value.length > DIAGNOSTIC_TAIL_LENGTH ? value.slice(-DIAGNOSTIC_TAIL_LENGTH) : value;
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/(\b(?:config|configuration|settings|payload)\b\s*[:=]\s*)\{[^\r\n]*/gi, "$1{[redacted]}")
    .replace(/OPENCODE_CONFIG_CONTENT\b[^\r\n]*/gi, "OPENCODE_CONFIG_CONTENT=[redacted]")
    .replace(
      /(["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret)["']\s*:\s*)["'][^"']*["']/gi,
      '$1"[redacted]"',
    )
    .replace(
      /((?:[A-Za-z_][A-Za-z0-9_]*_)?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|bearer))\b(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|bearer\s+\S+|[^\s,;}"']+)/gi,
      "$1$2[redacted]",
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret)\b\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:authorization|bearer)\s*[:=]?\s*(?:bearer\s+)?[^\s,;]+/gi, "authorization=[redacted]")
    .replace(/([?&](?:token|key|password|secret|api[_-]?key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s]+@/gi, "$1[redacted]@");
}

function formatOutput(output: BoundedOutput, command?: string): string {
  const stderr = command ? SandboxManager.annotateStderrWithSandboxFailures(command, output.stderr) : output.stderr;
  const parts = [
    output.stdout && `stdout:\n${redactDiagnostic(output.stdout)}`,
    stderr && `stderr:\n${redactDiagnostic(stderr)}`,
  ].filter(Boolean);
  return parts.length ? `\nCaptured sandboxed OpenCode output:\n${parts.join("\n")}` : "";
}

function formatSandboxViolations(command?: string): string {
  const store = SandboxManager.getSandboxViolationStore();
  const exactViolations = command ? store.getViolationsForCommand(command) : [];
  const violations = exactViolations.length ? exactViolations : store.getViolations(8);
  if (!violations.length) return "";
  const details = violations
    .slice(-8)
    .map((violation) => `${violation.timestamp.toISOString()}: ${redactDiagnostic(violation.line)}`)
    .join("\n");
  return `\nSandbox violations (recent):\n${details}`;
}

function sandboxChildHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null && child.exitCode !== undefined;
}

function waitForSandboxChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (sandboxChildHasExited(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener?.("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(sandboxChildHasExited(child)), timeoutMs);
    child.once("exit", onExit);
  });
}

function isSafeSandboxProcessGroupPid(pid: number | undefined): pid is number {
  return process.platform !== "win32" && Number.isInteger(pid) && pid > 1 && pid !== process.pid;
}

async function terminateSandboxChild(child: ChildProcess | undefined): Promise<void> {
  if (!child) return;

  if (!isSafeSandboxProcessGroupPid(child.pid)) {
    child.kill();
    return;
  }

  if (sandboxChildHasExited(child)) return;

  let termDelivered = false;
  try {
    process.kill(-child.pid, "SIGTERM");
    termDelivered = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
  }

  if (!termDelivered || (await waitForSandboxChildExit(child, SANDBOX_TERMINATION_GRACE_MS))) return;
  if (sandboxChildHasExited(child)) return;

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
  }
  await waitForSandboxChildExit(child, SANDBOX_TERMINATION_ESCALATION_MS);
}

function inferMcpOperation(error?: string): string {
  if (!error) return "startup/readiness";
  if (/network|connect|dns|tls|http|fetch|socket|timeout/i.test(error)) return "network request/startup";
  if (/write|mkdir|rename|unlink|permission denied|read-only/i.test(error)) return "write operation";
  return "startup/readiness";
}

function formatMcpDiagnostic(
  server: string,
  error: string | undefined,
  readiness: "ready" | "not-ready",
  exit: SandboxChildExit | undefined,
  output: string,
  violations: string,
  transport: "stdio" | "http" | "sdk" | "unknown" = "unknown",
): string {
  const attribution =
    transport === "stdio"
      ? `MCP child="${server}"`
      : transport === "http"
        ? "MCP remote HTTP operation"
        : transport === "sdk"
          ? "MCP in-process SDK operation"
          : "MCP transport=unknown (not attributed to a child)";
  const context = [
    attribution,
    `operation=${inferMcpOperation(error)}`,
    `readiness=${readiness}`,
    exit ? `companion-exit=code=${exit.code}, signal=${exit.signal ?? "none"}` : "companion-exit=not-observed",
  ].join(", ");
  const details = [
    error && `SDK error: ${redactDiagnostic(error)}`,
    output && `Companion process context (aggregate; server attribution unavailable):${output}`,
    transport === "stdio" && violations && `Sandbox violation context (recent child/companion records):${violations}`,
  ].filter(Boolean);
  return `MCP server "${server}" failed (${context}).${details.length ? `\n${details.join("\n")}` : ""}`;
}

function waitForLoopbackUrl(
  child: ChildProcess,
  workspacePath: string,
  output: BoundedOutput,
  command: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const startupError = (reason: string) =>
      new Error(
        `Sandboxed OpenCode startup failed while waiting for loopback readiness at 127.0.0.1 ` +
          `(workspace=${workspacePath}, readiness=not-ready): ${reason}${formatOutput(output, command)}${formatSandboxViolations(command)}`,
      );
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const onStdout = (chunk: Buffer) => {
      output.stdout = appendDiagnosticTail(output.stdout, redactDiagnostic(chunk.toString()));
      const match = `${output.stdout}\n${output.stderr}`.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/);
      if (match) finish(() => resolve(match[0]));
    };
    const onStderr = (chunk: Buffer) => {
      output.stderr = appendDiagnosticTail(output.stderr, redactDiagnostic(chunk.toString()));
      const match = `${output.stdout}\n${output.stderr}`.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/);
      if (match) finish(() => resolve(match[0]));
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", (error) => finish(() => reject(startupError(`child error: ${error.message}`))));
    child.once("exit", (code, signal) => {
      finish(() => reject(startupError(`child exited before readiness (code=${code}, signal=${signal})`)));
    });
    const timeout = setTimeout(
      () => finish(() => reject(startupError(`timed out after ${SANDBOX_STARTUP_TIMEOUT_MS}ms`))),
      SANDBOX_STARTUP_TIMEOUT_MS,
    );
  });
}

export class OpenCodeAgent implements IAgent {
  public launchConfiguration: OpenCodeLaunchConfiguration | undefined;
  private client: OpencodeClient | undefined;
  private server: { url: string; close(): void } | undefined;
  private sandboxedChild: ChildProcess | undefined;
  private sandboxRuntimeInitialized = false;
  private cleanupPromise: Promise<void> | undefined;
  private sseAbortController: AbortController | undefined;
  private listeners: Set<EventHandler> = new Set();
  public workspaceFolder: string | undefined;
  public onAvailabilityError: ((error: Error) => void) | undefined;
  private sandboxedChildStopping = false;
  private sandboxDiagnosticOutput: BoundedOutput = { stdout: "", stderr: "" };
  private sandboxCommand: string | undefined;
  private sandboxChildReady = false;
  private sandboxChildExit: SandboxChildExit | undefined;

  constructor(launchConfiguration?: OpenCodeLaunchConfiguration) {
    this.launchConfiguration = launchConfiguration;
  }

  updateLaunchConfiguration(launchConfiguration: OpenCodeLaunchConfiguration): void {
    this.launchConfiguration = launchConfiguration;
  }

  // --- Capability declaration ---

  getCapabilities(): AgentCapabilities {
    return {
      sessionDelete: true,
      sessionFork: true,
      sessionRevert: true,
      sessionShare: true,
      sessionSummarize: true,
      sessionDiff: true,
      todo: true,
      multiProvider: true,
      permission: true,
      question: true,
      mcp: true,
      subAgent: true,
      shell: true,
      config: true,
    };
  }

  // --- Lifecycle ---

  async connect(): Promise<void> {
    if (this.launchConfiguration?.sandbox.enabled && SandboxManager.isSupportedPlatform()) {
      await this.connectSandboxed();
      return;
    }
    // Port 0: let OS assign a free port to avoid conflicts
    // In-memory Scout overlay scoped to this child process via OPENCODE_CONFIG_CONTENT.
    const server = await createOpencodeServer({
      port: 0,
      config: {
        ...CHAT_AGENT_OVERLAY,
        ...this.launchConfiguration?.mcpOverlay,
      },
    });
    this.server = server;
    this.client = createOpencodeClient({
      baseUrl: server.url,
    });
    this.subscribeToEvents();
  }

  private async connectSandboxed(): Promise<void> {
    const configuration = this.launchConfiguration;
    if (!configuration) {
      throw new Error("Sandboxed OpenCode launch requires a launch configuration.");
    }

    const networkPolicy = configuration.sandbox.networkPolicy;
    const runtimeConfig: SandboxRuntimeConfig = {
      network: {
        enabled: networkPolicy?.enabled ?? !configuration.sandbox.allowNetwork,
        allowedDomains: [
          ...(networkPolicy?.allowedDomains ?? (configuration.sandbox.allowNetwork ? [] : ["localhost", "127.0.0.1"])),
        ],
        deniedDomains: [...(networkPolicy?.deniedDomains ?? [])],
        allowLocalBinding: true,
        ...(networkPolicy?.allowMachLookup ? { allowMachLookup: [...networkPolicy.allowMachLookup] } : {}),
      },
      filesystem: {
        denyRead: [...(configuration.sandbox.filesystemPolicy.denyReadPaths ?? [])],
        allowRead: [
          ...configuration.sandbox.filesystemPolicy.readOnlyPaths,
          ...configuration.sandbox.filesystemPolicy.readWritePaths,
        ],
        allowWrite: [...configuration.sandbox.filesystemPolicy.readWritePaths],
        denyWrite: [],
      },
    };

    try {
      this.sandboxRuntimeInitialized = true;
      const violationStore = SandboxManager.getSandboxViolationStore();
      violationStore.clear();
      await SandboxManager.initialize(runtimeConfig, undefined, true);
      const command = [
        configuration.executable.path,
        ...(configuration.executable.args ?? []),
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
      ]
        .map(shellQuote)
        .join(" ");
      const wrappedCommand = await SandboxManager.wrapWithSandbox(command);
      const output: BoundedOutput = { stdout: "", stderr: "" };
      this.sandboxDiagnosticOutput = output;
      this.sandboxCommand = command;
      this.sandboxChildReady = false;
      this.sandboxChildExit = undefined;
      const child = spawn(wrappedCommand, {
        cwd: configuration.workspacePath,
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            ...CHAT_AGENT_OVERLAY,
            ...configuration.mcpOverlay,
          }),
        },
        detached: true,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.sandboxedChild = child;
      this.sandboxedChildStopping = false;
      const url = await waitForLoopbackUrl(child, configuration.workspacePath, output, command);
      this.sandboxChildReady = true;
      this.server = {
        url,
        close: () => undefined,
      };
      this.client = createOpencodeClient({ baseUrl: url });
      this.subscribeToEvents();
      child.once("exit", (code, signal) => {
        if (this.sandboxedChild !== child) return;
        this.sandboxChildExit = { code, signal };
        const expected = this.sandboxedChildStopping;
        this.client = undefined;
        this.server = undefined;
        this.sseAbortController?.abort();
        this.sseAbortController = undefined;
        if (!expected) {
          this.onAvailabilityError?.(
            new Error(
              `Sandboxed OpenCode companion exited unexpectedly after readiness (companion, code=${code}, signal=${signal ?? "none"}); ` +
                `Chat is unavailable.${formatOutput(output, command)}${formatSandboxViolations(command)}`,
            ),
          );
        }
        void this.cleanupSandboxResources(child);
      });
    } catch (error) {
      await this.cleanupSandboxResources();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Sandboxed OpenCode startup failed; no unsandboxed fallback was started: ${redactDiagnostic(message)}`,
      );
    }
  }

  disconnect(): void {
    this.stopConnection(true);
  }

  async reconnect(): Promise<void> {
    await this.stopForReconnect();
    await this.connect();
  }

  async stopForReconnect(): Promise<void> {
    this.stopConnection(false);
    await this.cleanupPromise;
  }

  private stopConnection(clearListeners: boolean): void {
    this.sseAbortController?.abort();
    this.sseAbortController = undefined;
    const server = this.server;
    this.server = undefined;
    this.client = undefined;
    if (!this.sandboxedChild) server?.close();
    void this.cleanupSandboxResources();
    if (clearListeners) this.listeners.clear();
  }

  private cleanupSandboxResources(child?: ChildProcess): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;

    const childToKill = child ?? this.sandboxedChild;
    const childAlreadyExited =
      childToKill !== undefined && (sandboxChildHasExited(childToKill) || this.sandboxChildExit !== undefined);
    if (childToKill === this.sandboxedChild) this.sandboxedChildStopping = true;
    this.sandboxedChild = undefined;
    const shouldResetRuntime = this.sandboxRuntimeInitialized;
    this.sandboxRuntimeInitialized = false;
    this.cleanupPromise = (async () => {
      try {
        if (childToKill && isSafeSandboxProcessGroupPid(childToKill.pid) && !childAlreadyExited) {
          await terminateSandboxChild(childToKill);
        } else if (childToKill && !isSafeSandboxProcessGroupPid(childToKill.pid)) {
          childToKill?.kill();
        }
      } finally {
        if (shouldResetRuntime) {
          try {
            await SandboxManager.reset();
          } catch {}
        }
      }
    })().finally(() => {
      this.cleanupPromise = undefined;
    });
    return this.cleanupPromise;
  }

  // --- Event subscription ---

  onEvent(handler: (event: AgentEvent) => void): Disposable {
    this.listeners.add(handler);
    return {
      dispose: () => {
        this.listeners.delete(handler);
      },
    };
  }

  /** Resubscribe to SSE stream (e.g. after config change) */
  async resubscribeEvents(): Promise<void> {
    await this.subscribeToEvents();
  }

  private async subscribeToEvents(): Promise<void> {
    const client = this.requireClient();
    // Abort existing stream before resubscribing
    this.sseAbortController?.abort();
    this.sseAbortController = new AbortController();
    const result = await client.global.event({
      signal: this.sseAbortController.signal,
    });
    // Read SSE stream and dispatch to listeners
    (async () => {
      try {
        for await (const globalEvent of result.stream) {
          const event = (globalEvent as { payload: Event }).payload;
          if (!event) continue;
          const mapped = mapEvent(event);
          for (const listener of this.listeners) {
            listener(mapped);
          }
        }
      } catch (error) {
        // AbortError is normal stream termination
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        throw error;
      }
    })();
  }

  // --- Sessions (common) ---

  async listSessions(): Promise<ChatSession[]> {
    const client = this.requireClient();
    const response = await client.session.list();
    return mapSessions(response.data!);
  }

  async createSession(title?: string): Promise<ChatSession> {
    const client = this.requireClient();
    const response = await client.session.create({
      title,
    });
    return mapSession(response.data!);
  }

  async getSession(id: string): Promise<ChatSession> {
    const client = this.requireClient();
    const response = await client.session.get({
      sessionID: id,
    });
    return mapSession(response.data!);
  }

  // --- Sessions (capabilities-dependent) ---

  async deleteSession(id: string): Promise<void> {
    const client = this.requireClient();
    await client.session.delete({
      sessionID: id,
    });
  }

  async forkSession(sessionId: string, messageId?: string): Promise<ChatSession> {
    const client = this.requireClient();
    const response = await client.session.fork({
      sessionID: sessionId,
      messageID: messageId,
    });
    return mapSession(response.data!);
  }

  async revertSession(sessionId: string, messageId: string): Promise<ChatSession> {
    const client = this.requireClient();
    const response = await client.session.revert({
      sessionID: sessionId,
      messageID: messageId,
    });
    return mapSession(response.data!);
  }

  async unrevertSession(sessionId: string): Promise<ChatSession> {
    const client = this.requireClient();
    const response = await client.session.unrevert({
      sessionID: sessionId,
    });
    return mapSession(response.data!);
  }

  async summarizeSession(sessionId: string, model?: ModelRef): Promise<void> {
    const client = this.requireClient();
    await client.session.summarize({
      sessionID: sessionId,
      providerID: model?.providerID,
      modelID: model?.modelID,
    });
  }

  async shareSession(sessionId: string): Promise<ChatSession> {
    const client = this.requireClient();
    const response = await client.session.share({
      sessionID: sessionId,
    });
    return mapSession(response.data!);
  }

  async unshareSession(sessionId: string): Promise<ChatSession> {
    const client = this.requireClient();
    const response = await client.session.unshare({
      sessionID: sessionId,
    });
    return mapSession(response.data!);
  }

  // --- Messages ---

  async getMessages(sessionId: string): Promise<ChatMessageWithParts[]> {
    const client = this.requireClient();
    const response = await client.session.messages({
      sessionID: sessionId,
    });
    return mapMessagesWithParts(response.data!);
  }

  async sendMessage(sessionId: string, text: string, options?: SendMessageOptions): Promise<void> {
    const client = this.requireClient();
    const parts: Array<
      | { type: "text"; text: string; synthetic?: boolean }
      | { type: "file"; mime: string; url: string; filename: string }
      | { type: "agent"; name: string }
    > = [];

    if (options?.skill) {
      parts.push({ type: "text", text: `/${options.skill}`, synthetic: true });
    }

    parts.push({ type: "text", text });

    if (options?.files) {
      for (const file of options.files) {
        // filePath is workspace-relative; resolve to absolute via cwd
        const absPath = path.isAbsolute(file.filePath)
          ? file.filePath
          : path.resolve(this.workspaceFolder ?? ".", file.filePath);
        parts.push({
          type: "file",
          mime: "text/plain",
          url: `file://${absPath}`,
          filename: file.fileName,
        });
      }
    }

    // @agent mention triggers sub-agent invocation via AgentPartInput
    if (options?.agent) {
      parts.push({ type: "agent", name: options.agent });
    }

    // SDK 1.2.17 `client.session.promptAsync` exposes `variant?: string` as a
    // top-level sibling of `model` (verified in design.md Discovery Findings §1).
    // Omit the key entirely when no explicit effort is selected so the opencode
    // server applies its own default rather than a GUI-injected override.
    const effortId = options?.effort?.id;
    await client.session.promptAsync({
      sessionID: sessionId,
      parts,
      model: options?.model,
      agent: options?.primaryAgent,
      system: options?.system,
      ...(effortId ? { variant: effortId } : {}),
    });
  }

  async abortSession(sessionId: string): Promise<void> {
    const client = this.requireClient();
    await client.session.abort({
      sessionID: sessionId,
    });
  }

  // --- Shell ---

  async executeShell(sessionId: string, command: string, model?: ModelRef): Promise<void> {
    const client = this.requireClient();
    await client.session.shell({
      sessionID: sessionId,
      agent: "default",
      command,
      model,
    });
  }

  // --- Providers & models ---

  async getProviders(): Promise<{
    providers: ProviderInfo[];
    default: Record<string, string>;
  }> {
    const client = this.requireClient();
    const response = await client.config.providers();
    const data = response.data!;
    return {
      providers: mapProviders(data.providers),
      default: data.default,
    };
  }

  async listAllProviders(): Promise<AllProvidersData> {
    const client = this.requireClient();
    const response = await client.provider.list();
    return mapAllProvidersData(response.data!);
  }

  // --- Agent list ---

  async getAgents(): Promise<AgentInfo[]> {
    const client = this.requireClient();
    const response = await client.app.agents();
    return mapAgents(response.data!);
  }

  async getSkills(): Promise<SkillInfo[]> {
    const client = this.requireClient();
    const response = await client.app.skills();
    return mapSkills(response.data!);
  }

  async getChildSessions(sessionId: string): Promise<ChatSession[]> {
    const client = this.requireClient();
    const response = await client.session.children({
      sessionID: sessionId,
    });
    return mapSessions(response.data!);
  }

  // --- Permissions ---

  async replyPermission(_sessionId: string, permissionId: string, response: PermissionResponse): Promise<void> {
    const client = this.requireClient();
    await client.permission.reply({
      requestID: permissionId,
      reply: response as "once" | "always" | "reject",
    });
  }

  // --- Questions ---

  async replyQuestion(requestId: string, answers: QuestionAnswer[]): Promise<void> {
    const client = this.requireClient();
    await client.question.reply({
      requestID: requestId,
      answers,
    });
  }

  async rejectQuestion(requestId: string): Promise<void> {
    const client = this.requireClient();
    await client.question.reject({
      requestID: requestId,
    });
  }

  // --- Session metadata ---

  async getSessionDiff(sessionId: string): Promise<FileDiff[]> {
    const client = this.requireClient();
    const response = await client.session.diff({
      sessionID: sessionId,
    });
    return mapFileDiffs(response.data!);
  }

  async getSessionTodos(sessionId: string): Promise<TodoItem[]> {
    const client = this.requireClient();
    const response = await client.session.todo({
      sessionID: sessionId,
    });
    return mapTodos(response.data!);
  }

  // --- Config ---

  async getConfig(): Promise<AppConfig> {
    const client = this.requireClient();
    const response = await client.config.get();
    return mapConfig(response.data!);
  }

  async updateConfig(config: Partial<AppConfig>): Promise<void> {
    const client = this.requireClient();
    await client.config.update({ config: config as Record<string, unknown> });
  }

  async getPath(): Promise<AppPaths> {
    const client = this.requireClient();
    const response = await client.path.get();
    return mapPath(response.data!);
  }

  // --- MCP ---

  async getMcpStatus(): Promise<McpStatus> {
    const client = this.requireClient();
    const response = await client.mcp.status();
    const mapped = mapMcpStatus(response.data!);
    if (!this.launchConfiguration?.sandbox.enabled || !SandboxManager.isSupportedPlatform()) return mapped;
    const output = formatOutput(this.sandboxDiagnosticOutput, this.sandboxCommand);
    const violations = formatSandboxViolations(this.sandboxCommand);
    const transports = this.launchConfiguration?.mcpTransport ?? {};
    for (const [server, status] of Object.entries(mapped)) {
      if (!status.connected && status.status !== "disabled") {
        status.error = formatMcpDiagnostic(
          server,
          status.error,
          this.sandboxChildReady ? "ready" : "not-ready",
          this.sandboxChildExit,
          output,
          transports[server] === "stdio" ? violations : "",
          transports[server] ?? "unknown",
        );
      }
    }
    return mapped;
  }

  async connectMcp(server: string): Promise<void> {
    const client = this.requireClient();
    await client.mcp.connect({ name: server });
  }

  async disconnectMcp(server: string): Promise<void> {
    const client = this.requireClient();
    await client.mcp.disconnect({ name: server });
  }

  // --- Tools ---

  async getToolIds(): Promise<ToolListItem[]> {
    const client = this.requireClient();
    const response = await client.tool.ids();
    return mapToolIds(response.data!);
  }

  // --- Server URL ---

  getServerUrl(): string | undefined {
    return this.server?.url;
  }

  /**
   * Export raw session snapshot for `opencode import`.
   * Uses companion client so the extension does not open the project DB as a second writer for reads.
   */
  async exportSessionSnapshot(sessionId: string): Promise<string> {
    const client = this.requireClient();
    const infoRes = await client.session.get({ sessionID: sessionId });
    const messagesRes = await client.session.messages({ sessionID: sessionId });
    const exportData = {
      info: infoRes.data,
      messages: messagesRes.data,
    };
    const filePath = path.join(
      os.tmpdir(),
      `opencode-chat-handoff-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.json`,
    );
    await fs.writeFile(filePath, `${JSON.stringify(exportData, null, 2)}\n`, "utf-8");
    return filePath;
  }

  // --- Model management (setModel) ---

  /**
   * setModel is an OpenCode-specific workaround: the config.update API doesn't
   * persist model changes, so we edit the opencode.json config file directly.
   */
  async setModel(model: string): Promise<void> {
    const paths = await this.getPath();
    const configFilePath = path.join(paths.config, "opencode.json");
    let configJson: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(configFilePath, "utf-8");
      configJson = JSON.parse(raw);
    } catch {
      // File may not exist yet — start from empty object
    }
    configJson.model = model;
    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.writeFile(configFilePath, `${JSON.stringify(configJson, null, 2)}\n`);
  }

  // --- Private ---

  private requireClient(): OpencodeClient {
    if (!this.client) {
      throw new Error("OpenCode client is not connected. Call connect() first.");
    }
    return this.client;
  }
}
