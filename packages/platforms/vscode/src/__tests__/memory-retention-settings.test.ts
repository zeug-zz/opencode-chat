import type { MemoryRetentionPolicy } from "@opencode-chat/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  loadMemoryRetentionSettings,
  MEMORY_RETENTION_SETTING_KEYS,
  resolveMemoryRetentionStatus,
  updateMemoryRetentionSettings,
} from "../memory-retention-settings";

describe("memory retention workspace settings", () => {
  const workspaceTarget = { fsPath: "/workspace/project", scheme: "file" };
  const update = vi.fn().mockResolvedValue(undefined);
  let values: Record<string, unknown>;
  let managedKeys: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    values = {};
    managedKeys = new Set();
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation(() => {
      return {
        get: vi.fn((key: string) => values[key]),
        inspect: vi.fn((key: string) => (managedKeys.has(key) ? { managedValue: values[key] } : undefined)),
        update,
      } as never;
    });
  });

  it("uses disabled, confirmation-required, automatic-retention-on defaults", () => {
    expect(loadMemoryRetentionSettings(workspaceTarget)).toEqual({
      policy: { enabled: false, requireConfirmation: true, automaticSessionRetention: true },
      managed: false,
      invalid: false,
    });
  });

  it("fails closed for malformed values", () => {
    values = {
      [MEMORY_RETENTION_SETTING_KEYS.enabled]: "yes",
      [MEMORY_RETENTION_SETTING_KEYS.requireConfirmation]: 0,
      [MEMORY_RETENTION_SETTING_KEYS.automaticSessionRetention]: "yes",
    };

    expect(loadMemoryRetentionSettings(workspaceTarget)).toEqual({
      policy: { enabled: false, requireConfirmation: true, automaticSessionRetention: false },
      managed: false,
      invalid: true,
    });
  });

  it("loads and persists values through the workspace configuration boundary", async () => {
    values = {
      [MEMORY_RETENTION_SETTING_KEYS.enabled]: true,
      [MEMORY_RETENTION_SETTING_KEYS.requireConfirmation]: false,
      [MEMORY_RETENTION_SETTING_KEYS.automaticSessionRetention]: false,
    };

    expect(loadMemoryRetentionSettings(workspaceTarget).policy).toEqual({
      enabled: true,
      requireConfirmation: false,
      automaticSessionRetention: false,
    });

    const policy: MemoryRetentionPolicy = {
      enabled: true,
      requireConfirmation: true,
      automaticSessionRetention: false,
    };
    await updateMemoryRetentionSettings(policy, workspaceTarget);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("opencode-chat", workspaceTarget);
    expect(update).toHaveBeenNthCalledWith(
      1,
      MEMORY_RETENTION_SETTING_KEYS.enabled,
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      MEMORY_RETENTION_SETTING_KEYS.requireConfirmation,
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    expect(update).toHaveBeenNthCalledWith(
      3,
      MEMORY_RETENTION_SETTING_KEYS.automaticSessionRetention,
      false,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  it("fails closed and never writes organization-managed settings", async () => {
    values[MEMORY_RETENTION_SETTING_KEYS.enabled] = true;
    values[MEMORY_RETENTION_SETTING_KEYS.automaticSessionRetention] = false;
    managedKeys.add(MEMORY_RETENTION_SETTING_KEYS.enabled);
    managedKeys.add(MEMORY_RETENTION_SETTING_KEYS.automaticSessionRetention);

    const result = loadMemoryRetentionSettings(workspaceTarget);
    expect(result.managed).toBe(true);
    expect(result.policy).toEqual({ enabled: true, requireConfirmation: true, automaticSessionRetention: false });

    await expect(
      updateMemoryRetentionSettings(
        { enabled: true, requireConfirmation: true, automaticSessionRetention: true },
        workspaceTarget,
      ),
    ).rejects.toThrow(/managed.*cannot be changed/i);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", "unavailable"],
    ["configured", "unavailable"],
    ["available", "active"],
    ["partial", "active"],
    ["blocked", "blocked"],
    ["error", "error"],
  ] as const)("resolves automatic session retention independently for %s provider status", (state, automaticState) => {
    const status = resolveMemoryRetentionStatus(
      {
        policy: { enabled: false, requireConfirmation: true, automaticSessionRetention: true },
        managed: false,
        invalid: false,
      },
      {
        id: "hindsight",
        displayName: "Hindsight",
        state,
        capabilities: { retain: true, recall: true, reflect: true, automaticSessionRetention: true },
      },
    );

    expect(status.policy.automaticSessionRetention).toBe(true);
    expect(status.state).toBe("disabled");
    expect(status.automaticSessionRetention?.state).toBe(automaticState);
  });
});
