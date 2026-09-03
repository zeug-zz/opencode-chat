import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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
  UIToHostMessage,
} from "@opencode-chat/core";
import * as vscode from "vscode";
import type { ChatMcpPrefs, ChatMcpPrefsStore } from "./chat-mcp-prefs";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "opencode-chat.chatView";

  private view: vscode.WebviewView | undefined;
  // OpenCode サーバーには「現在アクティブなセッション」を保持する API がないため、
  // UI クライアント側で管理する（TUI も同様の設計）。
  private activeSession: ChatSession | null = null;
  private sessionOperationGeneration = 0;
  private sessionListRequestGeneration = 0;
  private chatSandboxStatus: ChatSandboxStatus | undefined;
  private readonly chatSystemPrompt: string | null;
  private readonly writeSystemPrompt: string | null;
  private readonly setChatSandboxSettings?: (settings: ChatSandboxSettings) => Promise<ChatSandboxStatus>;
  private readonly chatMcpPrefs?: ChatMcpPrefsStore;
  private readonly bundledResources: readonly BundledResourceMetadata[];
  private readonly bundledCommandNames: ReadonlySet<string>;

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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: IAgent,
    private readonly platformServices: IPlatformServices,
    options?: {
      setChatSandboxSettings?: (settings: ChatSandboxSettings) => Promise<ChatSandboxStatus>;
      chatMcpPrefs?: ChatMcpPrefsStore;
      bundledCommandNames?: readonly string[];
      bundledResources?: readonly BundledResourceMetadata[];
    },
  ) {
    this.chatSystemPrompt = this.loadSystemPrompt("CHAT_SYSTEM.md");
    this.writeSystemPrompt = this.loadSystemPrompt("WRITE_SYSTEM.md");
    this.setChatSandboxSettings = options?.setChatSandboxSettings;
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
      this.postMessage({ type: "event", event });

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
      this.postMessage({ type: "activeEditor", file: this.getActiveEditorFile(editor) });
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
        this.postMessage({ type: "bundledResources", resources: [...this.bundledResources] });
        this.postMcpPrefs();
        await this.refresh(undefined, paths);
        if (this.chatSandboxStatus) {
          this.postMessage({ type: "chatSandboxStatus", status: this.chatSandboxStatus });
        }
        // 初期アクティブエディタを送信する
        this.postMessage({ type: "activeEditor", file: this.getActiveEditorFile(vscode.window.activeTextEditor) });
        break;
      }
      case "sendMessage": {
        const system = this.getSystemPrompt(message.primaryAgent, message.system);
        const bundledCommand =
          message.bundledCommand &&
          this.bundledCommandNames.has(message.bundledCommand.name) &&
          typeof message.bundledCommand.arguments === "string"
            ? ({
                name: message.bundledCommand.name,
                arguments: message.bundledCommand.arguments,
              } satisfies BundledCommandInvocation)
            : undefined;
        await this.agent.sendMessage(message.sessionId, message.text, {
          model: message.model,
          files: message.files,
          agent: message.agent,
          primaryAgent: message.primaryAgent,
          skill: message.skill,
          ...(bundledCommand ? { bundledCommand } : {}),
          system,
          ...(message.effort !== undefined && { effort: message.effort }),
        });
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
        this.postMessage({ type: "sessions", sessions });
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
        this.postMessage({ type: "sessions", sessions });
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
          this.postMessage({ type: "sessions", sessions });
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
            vscode.l10n.t("OpenCode Research: OpenCode server is not connected. Reload the window and try again."),
          );
          break;
        }
        if (!this.activeSession) {
          vscode.window.showErrorMessage(
            vscode.l10n.t("OpenCode Research: select an active session before handing off to the TUI."),
          );
          break;
        }
        const sessionId = this.activeSession.id;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t("OpenCode Research: exporting session for TUI…"),
            cancellable: false,
          },
          async () => {
            try {
              const exportPath = await this.agent.exportSessionSnapshot(sessionId);
              await this.platformServices.runHandoffTerminal(exportPath);
              vscode.window.showInformationMessage(
                vscode.l10n.t(
                  "OpenCode Research: opened independent TUI with a copy of this session. Chat is still running.",
                ),
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              const choice = await vscode.window.showErrorMessage(
                vscode.l10n.t(
                  "OpenCode Research: independent TUI handoff failed ({0}). Chat is still running. Open on the OpenCode server instead?",
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
        this.postMessage({ type: "sessions", sessions: forkedSessions });
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
        this.postMessage({ type: "agents", agents });
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
      this.postMessage({ type: "sessions", sessions });
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
    this.postMessage({ type: "agents", agents });
    this.postMessage({ type: "mcpStatus", status: mcpStatus });
    if (chatSandboxStatus) {
      this.postMessage({ type: "chatSandboxStatus", status: chatSandboxStatus });
    }
  }

  publishChatSandboxStatus(status: ChatSandboxStatus): void {
    this.chatSandboxStatus = status;
    this.postMessage({ type: "chatSandboxStatus", status });
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

    this.activeSession = session;
    this.postMessage({ type: "activeSession", session });
    if (!session) return true;

    const messages = await this.agent.getMessages(session.id);
    if (operationGeneration !== this.sessionOperationGeneration || this.activeSession?.id !== session.id) {
      return false;
    }
    this.postMessage({ type: "messages", sessionId: session.id, messages });
    return true;
  }

  /** アクティブなテキストエディタから FileAttachment を生成する。エディタがない場合は null を返す。 */
  private getActiveEditorFile(
    editor: vscode.TextEditor | undefined,
  ): import("@opencode-chat/core").FileAttachment | null {
    if (!editor) return null;
    const uri = editor.document.uri;
    // 出力パネルや設定画面など、file スキーム以外は対象外
    if (uri.scheme !== "file") return null;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder.fsPath, uri.fsPath)
      : path.basename(uri.fsPath);
    return { filePath: relativePath, fileName: path.basename(uri.fsPath) };
  }

  private postMessage(message: HostToUIMessage): void {
    this.view?.webview.postMessage(message);
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
