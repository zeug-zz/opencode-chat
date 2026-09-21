import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  DEFAULT_VIBEFELD_PREFERENCE,
  readVibefeldPreference,
  resolveEffectiveVibefeldEnabled,
  updateVibefeldEnabled,
  updateVibefeldWorkspaceOptOut,
  VIBEFELD_CONFIGURATION,
  VIBEFELD_ENABLED_SETTING,
  VIBEFELD_WORKSPACE_OPT_OUT_SETTING,
} from "../vibefeld/vibefeld-settings";

const workspaceTarget = { fsPath: "/workspace/project", scheme: "file" } as vscode.ConfigurationScope;

/**
 * Minimal effective-scope stand-in: a scope-less read sees the Global value,
 * and a scoped read sees the nearer workspace value when one exists.
 */
const mockConfiguration = (values: { global?: Record<string, unknown>; workspace?: Record<string, unknown> } = {}) => {
  const update = vi.fn().mockResolvedValue(undefined);
  vi.mocked(vscode.workspace.getConfiguration).mockImplementation(((
    _section: string,
    scope?: vscode.ConfigurationScope,
  ) => ({
    get: vi.fn((key: string) =>
      scope === undefined ? values.global?.[key] : (values.workspace?.[key] ?? values.global?.[key]),
    ),
    inspect: vi.fn(() => undefined),
    update,
  })) as never);
  return update;
};

describe("vibefeld-settings preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfiguration();
  });

  it("pins the configuration section and the two preference keys", () => {
    expect(VIBEFELD_CONFIGURATION).toBe("opencode-chat");
    expect(VIBEFELD_ENABLED_SETTING).toBe("vibefeld.enabled");
    expect(VIBEFELD_WORKSPACE_OPT_OUT_SETTING).toBe("vibefeld.workspaceOptOut");
  });

  it("defaults to enabled without a workspace opt-out when nothing is stored", () => {
    expect(readVibefeldPreference()).toEqual(DEFAULT_VIBEFELD_PREFERENCE);
    expect(DEFAULT_VIBEFELD_PREFERENCE).toEqual({ userEnabled: true, workspaceOptOut: false });
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(VIBEFELD_CONFIGURATION, undefined);
  });

  it("reads explicit stored booleans", () => {
    mockConfiguration({
      global: { [VIBEFELD_ENABLED_SETTING]: false },
      workspace: { [VIBEFELD_WORKSPACE_OPT_OUT_SETTING]: true },
    });

    expect(readVibefeldPreference(workspaceTarget)).toEqual({ userEnabled: false, workspaceOptOut: true });
  });

  it.each([
    ["a string", "true", "false"],
    ["a number", 1, 0],
    ["null", null, null],
    ["absent", undefined, undefined],
  ])("falls back to the availability-gated defaults when a stored value is %s", (_label, enabled, optOut) => {
    mockConfiguration({
      global: { [VIBEFELD_ENABLED_SETTING]: enabled },
      workspace: { [VIBEFELD_WORKSPACE_OPT_OUT_SETTING]: optOut },
    });

    expect(readVibefeldPreference()).toEqual({ userEnabled: true, workspaceOptOut: false });
  });
});

describe("vibefeld-settings Global inheritance and workspace opt-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfiguration();
  });

  it("inherits an enabled Global preference at a workspace scope", () => {
    mockConfiguration({ global: { [VIBEFELD_ENABLED_SETTING]: true } });

    const preference = readVibefeldPreference(workspaceTarget);

    expect(preference).toEqual({ userEnabled: true, workspaceOptOut: false });
    expect(resolveEffectiveVibefeldEnabled(preference, { state: "available" })).toBe(true);
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(VIBEFELD_CONFIGURATION, workspaceTarget);
  });

  it("inherits a disabled Global preference instead of defaulting to enabled", () => {
    mockConfiguration({ global: { [VIBEFELD_ENABLED_SETTING]: false } });

    const preference = readVibefeldPreference(workspaceTarget);

    expect(preference.userEnabled).toBe(false);
    expect(resolveEffectiveVibefeldEnabled(preference, { state: "available" })).toBe(false);
  });

  it("forces the effective state off for a workspace opt-out without changing the Global preference", () => {
    mockConfiguration({
      global: { [VIBEFELD_ENABLED_SETTING]: true },
      workspace: { [VIBEFELD_WORKSPACE_OPT_OUT_SETTING]: true },
    });

    const preference = readVibefeldPreference(workspaceTarget);

    expect(preference).toEqual({ userEnabled: true, workspaceOptOut: true });
    expect(resolveEffectiveVibefeldEnabled(preference, { state: "available" })).toBe(false);
  });
});

describe("resolveEffectiveVibefeldEnabled", () => {
  const enabledPreference = { userEnabled: true, workspaceOptOut: false };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfiguration();
  });

  it("enables an available runtime, which already implies a ready policy", () => {
    expect(resolveEffectiveVibefeldEnabled(enabledPreference, { state: "available" })).toBe(true);
  });

  it.each(["unavailable", "checking", "incompatible"] as const)("stays disabled for a %s runtime", (state) => {
    expect(resolveEffectiveVibefeldEnabled(enabledPreference, { state })).toBe(false);
  });

  it("stays disabled without a preflight result", () => {
    expect(resolveEffectiveVibefeldEnabled(enabledPreference, undefined)).toBe(false);
  });

  it("stays disabled when the preference is off or the workspace opted out", () => {
    expect(
      resolveEffectiveVibefeldEnabled({ userEnabled: false, workspaceOptOut: false }, { state: "available" }),
    ).toBe(false);
    expect(resolveEffectiveVibefeldEnabled({ userEnabled: true, workspaceOptOut: true }, { state: "available" })).toBe(
      false,
    );
  });

  it("resolves without reading configuration or consulting the runtime", () => {
    expect(resolveEffectiveVibefeldEnabled(enabledPreference, { state: "available" })).toBe(true);
    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
  });
});

describe("vibefeld-settings persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfiguration();
  });

  it("writes the Global preference key at the Global target and nothing else", async () => {
    const update = mockConfiguration();

    await updateVibefeldEnabled(false);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(VIBEFELD_CONFIGURATION, undefined);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(VIBEFELD_ENABLED_SETTING, false, vscode.ConfigurationTarget.Global);
    expect(update.mock.calls.map(([key]) => key)).toEqual([VIBEFELD_ENABLED_SETTING]);
  });

  it("writes the workspace opt-out key at the Workspace target and nothing else", async () => {
    const update = mockConfiguration();

    await updateVibefeldWorkspaceOptOut(true, workspaceTarget);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(VIBEFELD_CONFIGURATION, workspaceTarget);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(VIBEFELD_WORKSPACE_OPT_OUT_SETTING, true, vscode.ConfigurationTarget.Workspace);
    expect(update.mock.calls.map(([key]) => key)).toEqual([VIBEFELD_WORKSPACE_OPT_OUT_SETTING]);
  });

  it("never writes unrelated configuration or files", async () => {
    const update = mockConfiguration();

    await updateVibefeldEnabled(true);
    await updateVibefeldWorkspaceOptOut(false, workspaceTarget);

    expect(update.mock.calls.map(([key]) => key)).toEqual([
      VIBEFELD_ENABLED_SETTING,
      VIBEFELD_WORKSPACE_OPT_OUT_SETTING,
    ]);
    expect(update).not.toHaveBeenCalledWith("nono.profile", expect.anything(), expect.anything());
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("vibefeld-settings host-private boundary", () => {
  const source = readFileSync(new URL("../vibefeld/vibefeld-settings.ts", import.meta.url), "utf8");

  it("imports only the vscode API and the bounded core runtime type", () => {
    const imports = source.split("\n").filter((line) => line.trim().startsWith("import"));

    expect(imports).toHaveLength(2);
    for (const line of imports) {
      expect(line).toMatch(/from "(vscode|@opencode-chat\/core)";/);
    }
  });

  it("performs no executable, profile, process, or file access", () => {
    expect(source).not.toMatch(/\baf\b/i);
    expect(source).not.toMatch(/nono/i);
    expect(source).not.toMatch(/\bprocess\b/);
    expect(source).not.toMatch(/child_process|node:fs|node:os|node:path/);
    expect(source).not.toMatch(/spawn|execFile|execSync|readFile|writeFile/);
  });
});
