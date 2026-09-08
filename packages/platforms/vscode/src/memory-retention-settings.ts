import type { MemoryProviderStatus, MemoryRetentionPolicy, MemoryRetentionStatus } from "@opencode-chat/core";
import { DEFAULT_MEMORY_RETENTION_POLICY } from "@opencode-chat/core";
import * as vscode from "vscode";

const MEMORY_RETENTION_CONFIGURATION = "opencode-chat";

export const MEMORY_RETENTION_SETTING_KEYS = {
  enabled: "memoryRetention.enabled",
  requireConfirmation: "memoryRetention.requireConfirmation",
  automaticSessionRetention: "memoryRetention.automaticSessionRetention",
} as const;

export type MemoryRetentionSettingsResolution = {
  policy: MemoryRetentionPolicy;
  managed: boolean;
  invalid: boolean;
};

export function resolveMemoryRetentionStatus(
  settings: MemoryRetentionSettingsResolution,
  provider: MemoryProviderStatus,
  updateError?: boolean,
): MemoryRetentionStatus {
  const automaticSessionRetention = !settings.policy.automaticSessionRetention
    ? { state: "disabled" as const, ...(settings.invalid ? { reason: "Invalid settings" } : {}) }
    : updateError || provider.state === "error"
      ? { state: "error" as const, reason: "Retention status is unavailable" }
      : provider.state === "blocked"
        ? { state: "blocked" as const, reason: "Retention is blocked by companion policy" }
        : (provider.state !== "available" && provider.state !== "partial") ||
            !provider.capabilities.automaticSessionRetention
          ? { state: "unavailable" as const, reason: "No usable retention provider is available" }
          : { state: "active" as const };

  if (!settings.policy.enabled) {
    return {
      policy: settings.policy,
      state: "disabled",
      ...(settings.invalid ? { reason: "Invalid settings" } : {}),
      automaticSessionRetention,
    };
  }
  if (updateError || provider.state === "error") {
    return {
      policy: settings.policy,
      state: "error",
      reason: "Retention status is unavailable",
      automaticSessionRetention,
    };
  }
  if (provider.state === "blocked") {
    return {
      policy: settings.policy,
      state: "blocked",
      reason: "Retention is blocked by companion policy",
      automaticSessionRetention,
    };
  }
  if (provider.state === "unavailable" || !provider.capabilities.retain) {
    return {
      policy: settings.policy,
      state: "unavailable",
      reason: "No usable retention provider is available",
      automaticSessionRetention,
    };
  }
  return {
    policy: settings.policy,
    state: settings.policy.requireConfirmation ? "awaiting-confirmation" : "available",
    automaticSessionRetention,
  };
}

type ConfigurationValue = {
  value: unknown;
  managed: boolean;
};

function readConfigurationValue(key: string, scope?: vscode.ConfigurationScope): ConfigurationValue {
  const configuration = vscode.workspace.getConfiguration(MEMORY_RETENTION_CONFIGURATION, scope);
  const inspected = typeof configuration.inspect === "function" ? configuration.inspect<unknown>(key) : undefined;
  const managed = inspected !== undefined && inspected.managedValue !== undefined;

  return { value: configuration.get<unknown>(key), managed };
}

function normalizeBoolean(value: unknown, fallback: boolean): { value: boolean; valid: boolean } {
  return typeof value === "boolean" ? { value, valid: true } : { value: fallback, valid: value === undefined };
}

export function loadMemoryRetentionSettings(scope?: vscode.ConfigurationScope): MemoryRetentionSettingsResolution {
  const enabled = readConfigurationValue(MEMORY_RETENTION_SETTING_KEYS.enabled, scope);
  const confirmation = readConfigurationValue(MEMORY_RETENTION_SETTING_KEYS.requireConfirmation, scope);
  const automatic = readConfigurationValue(MEMORY_RETENTION_SETTING_KEYS.automaticSessionRetention, scope);
  const normalizedEnabled = normalizeBoolean(enabled.value, DEFAULT_MEMORY_RETENTION_POLICY.enabled);
  const normalizedConfirmation = normalizeBoolean(
    confirmation.value,
    DEFAULT_MEMORY_RETENTION_POLICY.requireConfirmation,
  );
  const normalizedAutomatic = normalizeBoolean(
    automatic.value,
    DEFAULT_MEMORY_RETENTION_POLICY.automaticSessionRetention,
  );
  const managed = enabled.managed || confirmation.managed || automatic.managed;

  return {
    policy: {
      enabled: normalizedEnabled.value,
      requireConfirmation: normalizedConfirmation.value,
      automaticSessionRetention: normalizedAutomatic.valid ? normalizedAutomatic.value : false,
    },
    managed,
    invalid: !normalizedEnabled.valid || !normalizedConfirmation.valid || !normalizedAutomatic.valid,
  };
}

export async function updateMemoryRetentionSettings(
  policy: MemoryRetentionPolicy,
  workspaceTarget: vscode.ConfigurationScope,
): Promise<void> {
  const current = loadMemoryRetentionSettings(workspaceTarget);
  if (current.managed) {
    throw new Error("Memory retention settings are managed by your organization and cannot be changed.");
  }

  const configuration = vscode.workspace.getConfiguration(MEMORY_RETENTION_CONFIGURATION, workspaceTarget);
  await configuration.update(
    MEMORY_RETENTION_SETTING_KEYS.enabled,
    policy.enabled,
    vscode.ConfigurationTarget.Workspace,
  );
  await configuration.update(
    MEMORY_RETENTION_SETTING_KEYS.requireConfirmation,
    policy.requireConfirmation,
    vscode.ConfigurationTarget.Workspace,
  );
  await configuration.update(
    MEMORY_RETENTION_SETTING_KEYS.automaticSessionRetention,
    policy.automaticSessionRetention,
    vscode.ConfigurationTarget.Workspace,
  );
}
