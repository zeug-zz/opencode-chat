import { execFile } from "node:child_process";
import { OpenCodeAgent } from "@opencode-chat/agent-opencode";
import * as vscode from "vscode";
import { ChatViewProvider } from "./chat-view-provider";
import { classifyConnectError } from "./connect-error";
import { DiffReviewManager } from "./diff-review-manager";
import { VscodePlatformServices } from "./vscode-platform-services";

const agent = new OpenCodeAgent();

// Extension Host プロセスが強制終了された場合でもサーバーを停止する
process.on("exit", () => agent.disconnect());

export async function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(vscode.l10n.t("OpenCode Chat requires an open workspace folder."));
    return;
  }

  // SDK の createOpencodeServer は cwd オプションを持たないため、
  // プロセスのカレントディレクトリを変更してからサーバーを起動する。
  const originalCwd = process.cwd();
  process.chdir(workspaceFolder);
  let connectFailed = false;
  try {
    agent.workspaceFolder = workspaceFolder;
    await agent.connect();
  } catch (error) {
    const kind = classifyConnectError(error);
    if (kind === "not-found") {
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          'OpenCode Chat: "opencode" command not found. Please install OpenCode first: https://github.com/anomalyco/opencode',
        ),
      );
      return;
    }
    connectFailed = true;
    if (kind === "database-locked") {
      vscode.window.showErrorMessage(
        vscode.l10n.t(
          "OpenCode Chat: Another OpenCode process may be using the project database. Please close other OpenCode instances (e.g., terminal UI) and reload the window.",
        ),
      );
    } else {
      const message = error instanceof Error ? error.message : String(error);
      const truncated = message.length > 500 ? `${message.slice(0, 500)}...` : message;
      vscode.window.showErrorMessage(vscode.l10n.t("OpenCode Chat: Failed to start companion server. {0}", truncated));
    }
  } finally {
    process.chdir(originalCwd);
  }

  const platformServices = new VscodePlatformServices();

  // PATH 上に difit が存在するか確認する。
  // 存在しない場合はレビューボタンを非表示にするだけでエラーは出さない。
  const difitAvailable = await checkDifitAvailable();

  const diffReviewManager = new DiffReviewManager();
  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    agent,
    platformServices,
    diffReviewManager,
    difitAvailable,
  );
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider));
  context.subscriptions.push(diffReviewManager);

  // diff エディタ用の仮想ドキュメントプロバイダー。
  // URI のクエリ部分にエンコードされたコンテンツを返す。
  const diffContentProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return decodeURIComponent(uri.query);
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("opencode-chat-diff-before", diffContentProvider),
    vscode.workspace.registerTextDocumentContentProvider("opencode-chat-diff-after", diffContentProvider),
  );

  context.subscriptions.push(new vscode.Disposable(() => agent.disconnect()));

  // When connectFailed is true (database-locked or other non-ENOENT), the agent
  // has no client. The webview provider is still registered so the sidebar is
  // not an infinite spinner. The ready handler will throw from agent methods
  // (getPath, listSessions, etc.) with "OpenCode client is not connected".
  // Those errors are caught by ChatViewProvider.handleWebviewMessage and
  // logged. The webview shows an error surface rather than hanging silently.
}

export function deactivate() {
  agent.disconnect();
}

/** PATH 上に difit コマンドが存在するかチェックする */
function checkDifitAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", ["difit"], (error) => {
      resolve(!error);
    });
  });
}
