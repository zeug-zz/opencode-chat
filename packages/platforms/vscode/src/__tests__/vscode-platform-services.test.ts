import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { accessSyncMock, execFileMock, readFileMock, unlinkMock } = vi.hoisted(() => ({
  accessSyncMock: vi.fn(),
  execFileMock: vi.fn(),
  readFileMock: vi.fn(),
  unlinkMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  accessSync: accessSyncMock,
  constants: { X_OK: 1 },
}));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));
vi.mock("node:fs/promises", () => ({ readFile: readFileMock, unlink: unlinkMock }));

import * as vscode from "vscode";
import { resolveTabInputFile, VscodePlatformServices } from "../vscode-platform-services";
import * as vscodeMock from "./mocks/vscode";

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
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      value: [{ uri: fileUri("/workspace"), name: "workspace", index: 0 }],
    });
    Object.defineProperty(vscode.window.tabGroups, "all", { configurable: true, value: [] });
  });

  it("includes file-backed custom Markdown tabs and ordinary text tabs once", async () => {
    Object.defineProperty(vscode.window.tabGroups, "all", {
      configurable: true,
      value: [
        {
          tabs: [
            { input: new vscode.TabInputCustom(fileUri("/workspace/docs/guide.md"), "office-viewer") },
            { input: new vscode.TabInputText(fileUri("/workspace/src/main.ts")) },
            { input: new vscode.TabInputText(fileUri("/workspace/docs/guide.md")) },
          ],
        },
      ],
    });

    await expect(new VscodePlatformServices().getOpenEditors()).resolves.toEqual([
      { filePath: "docs/guide.md", fileName: "guide.md" },
      { filePath: "src/main.ts", fileName: "main.ts" },
    ]);
  });

  it("omits non-file and missing-URI custom tabs without inspecting their content", async () => {
    Object.defineProperty(vscode.window.tabGroups, "all", {
      configurable: true,
      value: [
        {
          tabs: [
            { input: new vscode.TabInputCustom(fileUri("/workspace/docs/guide.md", "untitled"), "custom-webview") },
            { input: new vscode.TabInputCustom(undefined as never, "custom-webview") },
          ],
        },
      ],
    });

    await expect(new VscodePlatformServices().getOpenEditors()).resolves.toEqual([]);
  });
});

describe("VscodePlatformServices terminal handoff", () => {
  const resolvedBinary = "/Users/test/.opencode/bin/opencode";
  const exportPath = "/workspace/export snapshot;safe.json";
  const transfer = { info: { id: "ses_copy-123", title: "copy" }, messages: [] };

  const setExport = (value: unknown) => {
    readFileMock.mockResolvedValue(JSON.stringify(value));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENCODE_BIN", resolvedBinary);
    setExport(transfer);
    unlinkMock.mockResolvedValue(undefined);
    accessSyncMock.mockImplementation((filePath: string) => {
      if (filePath === resolvedBinary) return;
      throw new Error("not executable");
    });
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      callback(null, "Imported session: ses_copy-123\n", "");
    });
  });

  it("fails closed for attach requests without exposing dynamic inputs or creating a terminal", async () => {
    const maliciousUrl = "https://user:secret@localhost/token?auth=sentinel";
    const maliciousSessionId = "session-secret-$(touch-pwned)";

    await expect(new VscodePlatformServices().openTerminal(maliciousUrl, maliciousSessionId)).rejects.toThrow(
      "Independent TUI handoff is unavailable.",
    );

    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(JSON.stringify(vscodeMock.window.createTerminal.mock.calls)).not.toContain(maliciousUrl);
    expect(JSON.stringify(vscodeMock.window.createTerminal.mock.calls)).not.toContain(maliciousSessionId);
    expect(JSON.stringify(execFileMock.mock.calls)).not.toContain(maliciousUrl);
    expect(JSON.stringify(execFileMock.mock.calls)).not.toContain(maliciousSessionId);
  });

  it("imports with literal PATH-resolved opencode and starts the verified session", async () => {
    const terminal = { shellIntegration: {}, show: vi.fn(), sendText: vi.fn() };
    vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      callback(null, "Import complete\r\nImported session: ses_copy-123\r\n", "");
    });

    await new VscodePlatformServices().runHandoffTerminal(exportPath);

    expect(execFileMock).toHaveBeenCalledWith(
      "opencode",
      ["session", "import", "--standalone", exportPath],
      expect.objectContaining({ cwd: "/workspace", env: process.env, timeout: 120_000, maxBuffer: 1024 * 1024 }),
      expect.any(Function),
    );
    expect(terminal.show).toHaveBeenCalledOnce();
    expect(terminal.sendText).toHaveBeenCalledWith("opencode --standalone --session ses_copy-123");
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

    const handoff = new VscodePlatformServices().runHandoffTerminal(exportPath);
    await Promise.resolve();
    expect(terminal.sendText).not.toHaveBeenCalled();

    shellReady?.({ terminal });
    await handoff;

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ name: "OpenCode TUI" }));
    expect(terminal.sendText).toHaveBeenCalledWith("opencode --standalone --session ses_copy-123");
  });

  it("does not expose CLI stderr or errors when import fails", async () => {
    const error = new Error("database is locked");
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
      callback(error, "", "private-token-sentinel import failed");
    });

    await expect(new VscodePlatformServices().runHandoffTerminal(exportPath)).rejects.toMatchObject({
      message: "Independent TUI handoff is unavailable. Verify OpenCode is installed and try again.",
    });
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });

  it.each([
    ["zero-exit without an import marker", "Session already exists\n"],
    ["a mismatched imported ID", "Imported session: ses_other\n"],
    [
      "duplicate markers despite stdout noise",
      "noise\nImported session: ses_copy-123\nImported session: ses_copy-123\n",
    ],
  ])("fails closed for %s", async (_name, stdout) => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: null, output: string, stderr: string) => void;
      callback(null, stdout, "");
    });

    await expect(new VscodePlatformServices().runHandoffTerminal(exportPath)).rejects.toThrow(
      "Independent TUI handoff is unavailable.",
    );
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });

  it("rejects oversized CLI output", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      callback(null, `Imported session: ses_copy-123\n${"x".repeat(1024 * 1024)}`, "");
    });

    await expect(new VscodePlatformServices().runHandoffTerminal(exportPath)).rejects.toThrow(
      "Independent TUI handoff is unavailable.",
    );
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });

  it.each([
    ["malicious session ID", { info: { id: "ses_$(touch-pwned)" }, messages: [] }],
    ["session with a parent", { info: { id: "ses_parent", parentID: "ses_source" }, messages: [] }],
    ["session with fork control", { info: { id: "ses_fork", fork: true }, messages: [] }],
    ["session with agent control", { info: { id: "ses_agent", agent: "private-agent" }, messages: [] }],
    ["malformed payload", { info: { id: "ses_valid" }, messages: "not-an-array" }],
  ])("rejects %s before invoking the CLI", async (_name, data) => {
    setExport(data);

    await expect(new VscodePlatformServices().runHandoffTerminal(exportPath)).rejects.toThrow(
      "Independent TUI handoff is unavailable.",
    );
    expect(execFileMock).not.toHaveBeenCalled();
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });

  it("does not invoke the CLI when reading the host export fails", async () => {
    readFileMock.mockRejectedValue(new Error("private file detail"));

    await expect(new VscodePlatformServices().runHandoffTerminal(exportPath)).rejects.toThrow(
      "Independent TUI handoff is unavailable.",
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("does not use an absolute binary, continuation, attach, or credential arguments", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      callback(null, "Imported session: ses_copy-123\n", "");
    });
    const terminal = { shellIntegration: {}, show: vi.fn(), sendText: vi.fn() };
    vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);

    await new VscodePlatformServices().runHandoffTerminal(exportPath);

    const [bin, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe("opencode");
    expect(args).toEqual(["session", "import", "--standalone", exportPath]);
    expect(args.join(" ")).not.toMatch(/attach|continue|password|token|https?:\/\//i);
    expect(terminal.sendText.mock.calls[0][0]).toBe("opencode --standalone --session ses_copy-123");
  });

  describe("export file cleanup", () => {
    const handoffPath = path.join(os.tmpdir(), "opencode-chat-handoff-3f2c9a1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b.json");

    it("deletes the snapshot once before starting the TUI after a successful import", async () => {
      const terminal = { shellIntegration: {}, show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);

      await new VscodePlatformServices().runHandoffTerminal(handoffPath);

      expect(unlinkMock).toHaveBeenCalledOnce();
      expect(unlinkMock).toHaveBeenCalledWith(handoffPath);
      expect(unlinkMock.mock.invocationCallOrder[0]).toBeLessThan(terminal.sendText.mock.invocationCallOrder[0]);
      expect(terminal.sendText).toHaveBeenCalledWith("opencode --standalone --session ses_copy-123");
    });

    it("deletes the snapshot and keeps the import error when the CLI import fails", async () => {
      execFileMock.mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
        callback(new Error("database is locked"), "", "private-token-sentinel import failed");
      });

      await expect(new VscodePlatformServices().runHandoffTerminal(handoffPath)).rejects.toMatchObject({
        message: "Independent TUI handoff is unavailable. Verify OpenCode is installed and try again.",
      });
      expect(unlinkMock).toHaveBeenCalledOnce();
      expect(unlinkMock).toHaveBeenCalledWith(handoffPath);
      expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    });

    it("deletes the snapshot and keeps the validation error when the export is malformed", async () => {
      readFileMock.mockResolvedValue("{not json");

      await expect(new VscodePlatformServices().runHandoffTerminal(handoffPath)).rejects.toMatchObject({
        message: "Independent TUI handoff is unavailable. Verify the session export and try again.",
      });
      expect(unlinkMock).toHaveBeenCalledOnce();
      expect(unlinkMock).toHaveBeenCalledWith(handoffPath);
      expect(execFileMock).not.toHaveBeenCalled();
      expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    });

    it.each([
      [
        "outside the OS temp directory",
        path.join("/workspace", "opencode-chat-handoff-3f2c9a1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b.json"),
      ],
      ["with a non-matching basename", path.join(os.tmpdir(), "handoff.json")],
      ["with a malformed UUID", path.join(os.tmpdir(), "opencode-chat-handoff-not-a-uuid.json")],
      [
        "in a nested temp subdirectory",
        path.join(os.tmpdir(), "nested", "opencode-chat-handoff-3f2c9a1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b.json"),
      ],
    ])("never deletes a path %s", async (_name, filePath) => {
      const terminal = { shellIntegration: {}, show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);

      await new VscodePlatformServices().runHandoffTerminal(filePath);

      expect(unlinkMock).not.toHaveBeenCalled();
      expect(terminal.sendText).toHaveBeenCalledWith("opencode --standalone --session ses_copy-123");
    });

    it("keeps a successful handoff when cleanup rejects", async () => {
      unlinkMock.mockRejectedValue(new Error("EBUSY private path detail"));
      const terminal = { shellIntegration: {}, show: vi.fn(), sendText: vi.fn() };
      vi.mocked(vscode.window.createTerminal).mockReturnValue(terminal as never);

      await expect(new VscodePlatformServices().runHandoffTerminal(handoffPath)).resolves.toBeUndefined();
      expect(unlinkMock).toHaveBeenCalledOnce();
      expect(terminal.sendText).toHaveBeenCalledWith("opencode --standalone --session ses_copy-123");
    });

    it("keeps the import failure unchanged when cleanup rejects", async () => {
      unlinkMock.mockRejectedValue(new Error("EBUSY private path detail"));
      execFileMock.mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
        callback(new Error("database is locked"), "", "");
      });

      await expect(new VscodePlatformServices().runHandoffTerminal(handoffPath)).rejects.toMatchObject({
        message: "Independent TUI handoff is unavailable. Verify OpenCode is installed and try again.",
      });
      expect(unlinkMock).toHaveBeenCalledOnce();
      expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    });
  });
});
