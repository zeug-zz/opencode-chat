import type { MemoryProviderStatus, MemoryRetentionPolicy } from "@opencode-chat/core";
import type { HindsightPluginResolution } from "./hindsight-plugin-resolver";
import { normalizeMemoryProviderReason } from "./memory-provider-discovery";
import { normalizeMemoryRetentionPolicy } from "./memory-retention-policy";

export const HINDSIGHT_RECALL_TOOL_IDS = [
  "hindsight_search_knowledge_pages",
  "hindsight_list_knowledge_pages",
  "hindsight_read_knowledge_page",
] as const;

export const HINDSIGHT_REFLECT_TOOL_IDS = ["hindsight_reflect"] as const;
export const HINDSIGHT_RETENTION_TOOL_ID = "hindsight_ingest_document" as const;
export const HINDSIGHT_DISABLE_HOOKS_ENV = "HINDSIGHT_DISABLE_HOOKS" as const;

type HindsightCompanionIntegration = Readonly<{
  pluginReference: string;
  packageRoot?: string;
  runtimePaths: readonly string[];
  configurationPaths: readonly string[];
  toolPatterns: readonly string[];
  retentionPermission?: Readonly<Record<typeof HINDSIGHT_RETENTION_TOOL_ID, "ask" | "allow">>;
  automaticSessionRetention: boolean;
  environment: Readonly<Partial<Record<typeof HINDSIGHT_DISABLE_HOOKS_ENV, "1">>>;
}>;

export type HindsightCompanionIntegrationResult = Readonly<{
  status: MemoryProviderStatus;
  integration?: HindsightCompanionIntegration;
}>;

function sanitizedStatus(status: MemoryProviderStatus): MemoryProviderStatus {
  const reason = normalizeMemoryProviderReason(status.reason);
  return {
    id: status.id,
    displayName: status.id === "hindsight" ? "Hindsight" : "No memory provider",
    state: status.state,
    capabilities: { ...status.capabilities },
    ...(reason ? { reason } : {}),
  };
}

function automaticRetentionState(
  status: MemoryProviderStatus,
  automatic: boolean,
  hasApprovedIntegration: boolean,
): NonNullable<MemoryProviderStatus["automaticSessionRetention"]> {
  if (status.state === "blocked") return { state: "blocked" };
  if (status.state === "error") return { state: "error" };
  if (status.state === "unavailable" || status.state === "configured") return { state: "unavailable" };
  if (!hasApprovedIntegration) return { state: "unavailable" };
  return { state: automatic ? "active" : "disabled" };
}

/**
 * Builds the provider-owned companion fragment without probing or loading the
 * provider. A status is usable only after both capability detection and the
 * registered tool inventory agree on the exact operation surface.
 */
export function buildHindsightCompanionIntegration(
  status: MemoryProviderStatus,
  observedToolIds: Iterable<string>,
  resolution: HindsightPluginResolution | undefined,
  retentionPolicy?: MemoryRetentionPolicy,
): HindsightCompanionIntegrationResult {
  const policy = normalizeMemoryRetentionPolicy(retentionPolicy);
  const safeStatus = sanitizedStatus(status);
  if (status.id !== "hindsight" || (status.state !== "available" && status.state !== "partial") || !resolution) {
    return {
      status: {
        ...safeStatus,
        capabilities: { ...safeStatus.capabilities, automaticSessionRetention: false },
        automaticSessionRetention: automaticRetentionState(status, false, false),
      },
    };
  }

  const observed = new Set(observedToolIds);
  const recall = status.capabilities.recall && HINDSIGHT_RECALL_TOOL_IDS.every((toolId) => observed.has(toolId));
  const reflect = status.capabilities.reflect && observed.has(HINDSIGHT_REFLECT_TOOL_IDS[0]);
  const toolPatterns = [...(recall ? HINDSIGHT_RECALL_TOOL_IDS : []), ...(reflect ? HINDSIGHT_REFLECT_TOOL_IDS : [])];
  const retention =
    status.capabilities.retain && observed.has(HINDSIGHT_RETENTION_TOOL_ID) && policy.enabled === true
      ? { [HINDSIGHT_RETENTION_TOOL_ID]: policy.requireConfirmation ? ("ask" as const) : ("allow" as const) }
      : undefined;
  const automatic = policy.automaticSessionRetention;

  if (toolPatterns.length === 0 && !retention && !automatic) {
    return {
      status: {
        ...safeStatus,
        capabilities: { ...safeStatus.capabilities, automaticSessionRetention: false },
        automaticSessionRetention: automaticRetentionState(status, false, true),
      },
    };
  }

  return {
    status: {
      ...safeStatus,
      capabilities: {
        retain: status.capabilities.retain,
        recall,
        reflect,
        automaticSessionRetention: automatic,
      },
      automaticSessionRetention: automaticRetentionState(status, automatic, true),
    },
    integration: Object.freeze({
      pluginReference: resolution.pluginReference,
      ...(resolution.packageRoot ? { packageRoot: resolution.packageRoot } : {}),
      runtimePaths: resolution.runtimePaths,
      configurationPaths: resolution.configurationPaths,
      toolPatterns: Object.freeze(toolPatterns),
      ...(retention ? { retentionPermission: Object.freeze(retention) } : {}),
      automaticSessionRetention: automatic,
      environment: Object.freeze(automatic ? {} : { HINDSIGHT_DISABLE_HOOKS: "1" as const }),
    }),
  };
}

export type { HindsightCompanionIntegration };

// Kept as a descriptive alias for callers that treat this as an adapter.
export const adaptHindsightCompanionIntegration = buildHindsightCompanionIntegration;
