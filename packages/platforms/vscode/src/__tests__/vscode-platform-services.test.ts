import { beforeEach, describe, expect, it, vi } from "vitest";

const { accessSyncMock, execFileMock } = vi.hoisted(() => ({
  accessSyncMock: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  accessSync: accessSyncMock,
  constants: { X_OK: 1 },
}));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import * as vscode from "vscode";
import { resolveTabInputFile, VscodePlatformServices } from "../vscode-platform-services";

describe("resolveTabInputFile", () => {
  const workspaceFolder = { fsPath: "/workspace", scheme: "file" } as vscode.Uri;
  const fileUri = (fsPath: string, scheme = "file") => ({ fsPath, scheme }) as vscode.Uri;

  it.each([
    ["text", new vscode.TabInputText(fileUri("/workspace/src/main.ts"))],
    ["custom", new vscode.TabInputCustom(fileUri("/workspace/docs/guide.md"), "office-viewer")],
  ])("resolves a file-backed %s tab", (_kind, input) => {
    const resolved = resolveTabInputFile(input, workspaceFolder);

    expect(resolved).toEqual({
      uri: input.uri,
      attachment: {
        filePath: input.uri.fsPath.endsWith("main.ts") ? "src/main.ts" : "docs/guide.md",
        fileName: input.uri.fsPath.endsWith("main.ts") ? "main.ts" : "guide.md",
      },
    });
  });

  it.each([
    undefined,
    {},
    { uri: undefined },
    { uri: fileUri("/workspace/docs/guide.md", "untitled") },
    { uri: fileUri("") },
    { uri: fileUri("   ") },
  ])("rejects unusable tab input %# without throwing", (input) => {
    expect(() => resolveTabInputFile(input as never, workspaceFolder)).not.toThrow();
    expect(resolveTabInputFile(input as never, workspaceFolder)).toBeUndefined();
  });
});

describe("VscodePlatformServices open editors", () => {
  const fileUri = (fsPath: string, scheme = "file") => ({ fsPath, scheme }) as vscode.Uri;

  beforeEach(() => {
    vi.mocked(vscode.workspace).workspaceFolders = [{ uri: fileUri("/workspace") }];
    vi.mocked(vscode.window).tabGroups.all = [];
  });

  it("includes file-backed custom Markdown tabs and ordinary text tabs once", async () => {
    vi.mocked(vscode.window).tabGroups.all = [
      {
        tabs: [
          { input: new vscode.TabInputCustom(fileUri("/workspace/docs/guide.md"), "office-viewer") },
          { input: new vscode.TabInputText(fileUri("/workspace/src/main.ts")) },
          { input: new vscode.TabInputText(fileUri("/workspace/docs/guide.md")) },
        ],
      },
    ];

    await expect(new VscodePlatformServices().getOpenEditors()).resolves.toEqual([
      { filePath: "docs/guide.md", fileName: "guide.md" },
      { filePath: "src/main.ts", fileName: "main.ts" },
    ]);
  });

  it("omits non-file and missing-URI custom tabs without inspecting their content", async () => {
    vi.mocked(vscode.window).tabGroups.all = [
      {
        tabs: [
          { input: new vscode.TabInputCustom(fileUri("/workspace/docs/guide.md", "untitled"), "custom-webview") },
          { input: new vscode.TabInputCustom(undefined as never, "custom-webview") },
        ],
      },
    ];

    await expect(new VscodePlatformServices().getOpenEditors()).resolves.toEqual([]);
  });
});

describe("VscodePlatformServices terminal handoff", () => {
  const resolvedBinary = "/Users/test/.opencode/bin/opencode";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENCODE_BIN", resolvedBinary);
    accessSyncMock.mockImplementation((filePath: string) => {
      if (filePath === resolvedBinary) return;
      throw new Error("not executable");
    });
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      callback(null, "", "");
    });
  });

  it("sends a shell-resolved attach command with safely quoted dynamic arguments", async () => {
    const terminal = { shellIntegration: {}, show: vi.fn(), sendText: vi.fn() };
    vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);

    await new VscodePlatformServices().openTerminal(
      "https://localhost:12345/path with '$HOME' `whoami` \\safe",
      "session;$(touch pwned)'value",
    );

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: "OpenCode (chat server)" }),
    );
    expect(terminal.sendText).toHaveBeenCalledWith(
      "opencode 'attach' 'https://localhost:12345/path with '\\''$HOME'\\'' `whoami` \\safe' '--session' 'session;$(touch pwned)'\\''value'",
    );
    expect(terminal.sendText.mock.calls[0][0]).not.toContain(resolvedBinary);
  });

  it("keeps the direct import preflight on the resolved binary and sends shell opencode continuation", async () => {
    const terminal = { shellIntegration: {}, show: vi.fn(), sendText: vi.fn() };
    vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);

    await new VscodePlatformServices().runHandoffTerminal("/workspace/export snapshot;safe.json");

    expect(execFileMock).toHaveBeenCalledWith(
      resolvedBinary,
      ["import", "/workspace/export snapshot;safe.json"],
      expect.objectContaining({ cwd: "/workspace", timeout: 120_000 }),
      expect.any(Function),
    );
    expect(terminal.show).toHaveBeenCalledOnce();
    expect(terminal.sendText).toHaveBeenCalledWith("opencode --continue");
    expect(terminal.sendText.mock.calls[0][0]).not.toContain(resolvedBinary);
  });

  it("waits for shell readiness before sending and preserves the handoff terminal label", async () => {
    let shellReady: ((event: { terminal: unknown }) => void) | undefined;
    const terminal = { shellIntegration: undefined, show: vi.fn(), sendText: vi.fn() };
    vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);
    vi.mocked(vscode.window.onDidChangeTerminalShellIntegration).mockImplementation((handler) => {
      shellReady = handler as typeof shellReady;
      return { dispose: vi.fn() };
    });

    const handoff = new VscodePlatformServices().runHandoffTerminal("/workspace/export.json");
    await Promise.resolve();
    expect(terminal.sendText).not.toHaveBeenCalled();

    shellReady?.({ terminal });
    await handoff;

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ name: "OpenCode TUI" }));
    expect(terminal.sendText).toHaveBeenCalledWith("opencode --continue");
  });

  it("preserves import preflight errors without opening a terminal", async () => {
    const error = new Error("database is locked");
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
      callback(error, "", "import failed");
    });

    await expect(new VscodePlatformServices().runHandoffTerminal("/workspace/export.json")).rejects.toThrow(
      "import failed",
    );
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });
});
