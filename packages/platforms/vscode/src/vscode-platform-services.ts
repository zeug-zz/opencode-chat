/**
 * VscodePlatformServices - IPlatformServices implementation for VS Code.
 *
 * Encapsulates all VS Code-specific platform operations that were previously
 * embedded in ChatViewProvider's message handlers.
 */

import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { FileAttachment, IPlatformServices } from "@opencode-chat/core";
import * as vscode from "vscode";

const HANDOFF_IMPORT_MAX_BUFFER = 1024 * 1024;
const HANDOFF_EXPORT_FILE_PATTERN = /^opencode-chat-handoff-[0-9a-f-]{36}\.json$/;

export type ResolvedTabInputFile = {
  uri: vscode.Uri;
  attachment: FileAttachment;
};

/** Resolves only file-backed text and custom tabs into the existing attachment shape. */
export function resolveTabInputFile(
  input: unknown,
  workspaceFolder: vscode.Uri | undefined,
): ResolvedTabInputFile | undefined {
  try {
    if (!(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)) return undefined;

    const uri = input.uri;
    if (uri?.scheme !== "file" || typeof uri.fsPath !== "string" || !uri.fsPath.trim()) return undefined;

    const filePath = workspaceFolder ? path.relative(workspaceFolder.fsPath, uri.fsPath) : path.basename(uri.fsPath);
    return {
      uri,
      attachment: { filePath, fileName: path.basename(uri.fsPath) },
    };
  } catch {
    return undefined;
  }
}

export function resolveOpencodeBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const executableName = platform === "win32" ? "opencode.exe" : "opencode";
  const candidates = [
    env.OPENCODE_BIN,
    ...(platform === "win32" ? [] : ["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"]),
    pathApi.join(env.HOME ?? env.USERPROFILE ?? "", ".opencode", "bin", executableName),
    ...(env.PATH ?? "")
      .split(pathDelimiter)
      .filter(Boolean)
      .map((directory) => pathApi.join(directory, executableName)),
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Deletes only the host-written handoff snapshot in the OS temp directory; any other path is left untouched. */
async function removeHandoffExport(exportFilePath: string): Promise<void> {
  const resolvedPath = path.resolve(exportFilePath);
  if (
    path.dirname(resolvedPath) !== path.resolve(os.tmpdir()) ||
    !HANDOFF_EXPORT_FILE_PATTERN.test(path.basename(resolvedPath))
  ) {
    return;
  }
  await unlink(resolvedPath).catch(() => undefined);
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
    void serverUrl;
    void sessionId;
    throw new Error("Independent TUI handoff is unavailable.");
  }

  async runHandoffTerminal(exportFilePath: string): Promise<void> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let sessionId: string;

    try {
      try {
        const raw = await readFile(exportFilePath, "utf8");
        const transfer: unknown = JSON.parse(raw);
        if (!isPlainObject(transfer) || !isPlainObject(transfer.info) || !Array.isArray(transfer.messages)) {
          throw new Error();
        }
        const info = transfer.info;
        if (
          typeof info.id !== "string" ||
          !/^ses_[A-Za-z0-9_-]+$/.test(info.id) ||
          "parentID" in info ||
          "fork" in info ||
          "agent" in info
        ) {
          throw new Error();
        }
        sessionId = info.id;
      } catch {
        throw new Error("Independent TUI handoff is unavailable. Verify the session export and try again.");
      }

      // Probe independent import while the companion stays up; fail before opening
      // an empty or broken TUI.
      await new Promise<void>((resolve, reject) => {
        execFile(
          "opencode",
          ["session", "import", "--standalone", exportFilePath],
          { cwd: wsFolder, env: process.env, timeout: 120_000, maxBuffer: HANDOFF_IMPORT_MAX_BUFFER },
          (error, stdout) => {
            if (error || typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > HANDOFF_IMPORT_MAX_BUFFER) {
              reject(new Error("Independent TUI handoff is unavailable. Verify OpenCode is installed and try again."));
              return;
            }
            const importedIds = [...stdout.matchAll(/^Imported session: (ses_[A-Za-z0-9_-]+)\r?$/gm)].map(
              (match) => match[1],
            );
            if (importedIds.length !== 1 || importedIds[0] !== sessionId) {
              reject(new Error("Independent TUI handoff is unavailable. Verify OpenCode is installed and try again."));
              return;
            }
            resolve();
          },
        );
      });
    } finally {
      // The snapshot carries the session transcript; remove it once import has settled, whatever the outcome.
      await removeHandoffExport(exportFilePath);
    }

    const command = `opencode --standalone --session ${sessionId}`;
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
      .flatMap((tab) => {
        const resolved = resolveTabInputFile(tab.input, workspaceFolder);
        return resolved ? [resolved.attachment] : [];
      })
      .filter((f, i, arr) => arr.findIndex((a) => a.filePath === f.filePath) === i);
  }
}
