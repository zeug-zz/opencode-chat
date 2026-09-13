import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { promptForInitialNonoProfile, readSelectedNonoProfile, selectNonoProfile } from "../nono-profile-settings";

const workspaceTarget = { fsPath: "/workspace/project", scheme: "file" };

vi.mock("../nono-resolver", () => ({
  discoverNonoProfiles: vi.fn().mockResolvedValue(["opencode-local", "writing"]),
}));

describe("nono profile settings", () => {
  const update = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => "opencode-local"),
      inspect: vi.fn(() => undefined),
      update,
    } as never);
  });

  it("reads only the selected profile name from the workspace setting", () => {
    expect(readSelectedNonoProfile(workspaceTarget)).toBe("opencode-local");
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("opencode-chat", workspaceTarget);
  });

  it("persists an explicitly picked discovered name at workspace scope", async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: "writing", value: "writing" } as never);

    await selectNonoProfile(workspaceTarget);

    expect(update).toHaveBeenCalledWith("nono.profile", "writing", vscode.ConfigurationTarget.Workspace);
  });

  it("clears the workspace selection without touching nono files", async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: "None", value: "__clear__" } as never);

    await selectNonoProfile(workspaceTarget);

    expect(update).toHaveBeenCalledWith("nono.profile", undefined, vscode.ConfigurationTarget.Workspace);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not persist when the picker is cancelled", async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await selectNonoProfile(workspaceTarget);

    expect(update).not.toHaveBeenCalled();
  });

  it("does not persist a profile that was not discovered", async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: "arbitrary", value: "arbitrary" } as never);

    await selectNonoProfile(workspaceTarget);

    expect(update).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("writes only the supported workspace setting", async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: "writing", value: "writing" } as never);

    await selectNonoProfile(workspaceTarget);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("opencode-chat", workspaceTarget);
    expect(update).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.createDirectory).not.toHaveBeenCalled();
  });

  it("offers opencode before custom profiles and persists only an explicit choice", async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: "opencode", value: "opencode" } as never);

    await expect(promptForInitialNonoProfile(workspaceTarget, ["opencode-local"])).resolves.toBe("opencode");

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      [
        { label: "opencode", value: "opencode" },
        { label: "opencode-local", value: "opencode-local" },
      ],
      expect.objectContaining({ ignoreFocusOut: true }),
    );
    expect(update).toHaveBeenCalledWith("nono.profile", "opencode", vscode.ConfigurationTarget.Workspace);
  });

  it("does not prompt or persist when there are no custom profiles", async () => {
    await expect(promptForInitialNonoProfile(workspaceTarget, [])).resolves.toBeUndefined();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
