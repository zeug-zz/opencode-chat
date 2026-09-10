import type { MemoryProviderStatus, MemoryRetentionPolicy, MemoryRetentionStatus } from "@opencode-chat/core";

export type MemoryRetentionSettingsResolution = {
  policy: MemoryRetentionPolicy;
  managed: boolean;
  invalid: boolean;
};

export const DEFAULT_MEMORY_RETENTION_SETTINGS: MemoryRetentionSettingsResolution = {
  policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: true },
  managed: false,
  invalid: false,
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
