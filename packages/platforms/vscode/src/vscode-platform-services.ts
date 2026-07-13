/**
 * VscodePlatformServices - IPlatformServices implementation for VS Code.
 *
 * Encapsulates all VS Code-specific platform operations that were previously
 * embedded in ChatViewProvider's message handlers.
 */

import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import * as path from "node:path";
import type { FileAttachment, IPlatformServices } from "@opencode-chat/core";
import * as vscode from "vscode";

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function resolveOpencodeBinary(): string {
  const candidates = [
    process.env.OPENCODE_BIN,
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
    path.join(process.env.HOME ?? "", ".opencode", "bin", "opencode"),
    "opencode",
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    if (candidate === "opencode") return candidate;
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return "opencode";
}

async function waitForShellReady(terminal: vscode.Terminal, timeoutMs = 2500): Promise<void> {
  if (terminal.shellIntegration) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      disposable.dispose();
      resolve();
    }, timeoutMs);

    const disposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === terminal) {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
      }
    });
  });
}

async function runInTerminal(command: string, name: string): Promise<void> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const terminal = vscode.window.createTerminal({
    name,
    cwd: wsFolder,
    location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
  });
  terminal.show();
  await waitForShellReady(terminal);
  terminal.sendText(command);
}

export class VscodePlatformServices implements IPlatformServices {
  async openDiffEditor(filePath: string, before: string, after: string): Promise<void> {
    const beforeUri = vscode.Uri.parse(`opencode-chat-diff-before:${filePath}?${encodeURIComponent(before)}`);
    const afterUri = vscode.Uri.parse(`opencode-chat-diff-after:${filePath}?${encodeURIComponent(after)}`);
    const fileName = path.basename(filePath);
    await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, `${fileName} (Changes)`);
  }

  async copyToClipboard(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
  }

  async openTerminal(serverUrl: string, sessionId?: string): Promise<void> {
    const bin = resolveOpencodeBinary();
    const args = ["attach", serverUrl];
    if (sessionId) {
      args.push("--session", sessionId);
    }
    const command = `${shellQuote(bin)} ${args.map((a) => shellQuote(a)).join(" ")}`;
    await runInTerminal(command, "OpenCode (chat server)");
  }

  async runHandoffTerminal(exportFilePath: string): Promise<void> {
    const bin = resolveOpencodeBinary();
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Probe independent import while companion stays up. If project DB is locked,
    // fail before opening an empty/broken TUI so the host can offer attach fallback.
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin,
        ["import", exportFilePath],
        { cwd: wsFolder, env: process.env, timeout: 120_000 },
        (error, _stdout, stderr) => {
          if (error) {
            const detail = [stderr, error.message].filter(Boolean).join("\n").trim();
            reject(new Error(detail || "opencode import failed"));
            return;
          }
          resolve();
        },
      );
    });

    const command = `${shellQuote(bin)} --continue`;
    await runInTerminal(command, "OpenCode TUI");
  }

  async openConfigFile(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      const dir = vscode.Uri.file(filePath.substring(0, filePath.lastIndexOf("/")));
      await vscode.workspace.fs.createDirectory(dir);
      await vscode.workspace.fs.writeFile(uri, Buffer.from('{\n  "$schema": "https://opencode.ai/config.json"\n}\n'));
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  }

  async openFile(filePath: string, line?: number): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    if (line !== undefined && line >= 1) {
      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  async searchWorkspaceFiles(query: string): Promise<FileAttachment[]> {
    const pattern = query ? `**/*${query}*` : "**/*";
    const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 20);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    return uris.map((uri) => {
      const relativePath = workspaceFolder
        ? path.relative(workspaceFolder.fsPath, uri.fsPath)
        : path.basename(uri.fsPath);
      return { filePath: relativePath, fileName: path.basename(uri.fsPath) };
    });
  }

  async getOpenEditors(): Promise<FileAttachment[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputText)
      .map((tab) => {
        const uri = (tab.input as vscode.TabInputText).uri;
        const relativePath = workspaceFolder
          ? path.relative(workspaceFolder.fsPath, uri.fsPath)
          : path.basename(uri.fsPath);
        return { filePath: relativePath, fileName: path.basename(uri.fsPath) };
      })
      .filter((f, i, arr) => arr.findIndex((a) => a.filePath === f.filePath) === i);
  }
}
