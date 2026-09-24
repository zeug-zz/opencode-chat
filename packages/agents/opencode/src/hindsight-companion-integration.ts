import type { MemoryProviderStatus, MemoryRetentionPolicy } from "@opencode-chat/core";
import { APPROVED_HINDSIGHT_PACKAGE, type HindsightPluginResolution } from "./hindsight-plugin-resolver";
import { normalizeMemoryProviderReason } from "./memory-provider-discovery";
import { normalizeMemoryRetentionPolicy } from "./memory-retention-policy";

export type HindsightLaunchBackend = "nono" | "vscode" | "sdk";

export const HINDSIGHT_RECALL_TOOL_IDS = [
  "hindsight_search_knowledge_pages",
  "hindsight_list_knowledge_pages",
  "hindsight_read_knowledge_page",
] as const;

export const HINDSIGHT_REFLECT_TOOL_IDS = ["hindsight_reflect"] as const;
export const HINDSIGHT_RETENTION_TOOL_ID = "hindsight_ingest_document" as const;
export const HINDSIGHT_DISABLE_HOOKS_ENV = "HINDSIGHT_DISABLE_HOOKS" as const;
export const HINDSIGHT_APPROVED_TOOL_IDS = [
  ...HINDSIGHT_RECALL_TOOL_IDS,
  ...HINDSIGHT_REFLECT_TOOL_IDS,
  "hindsight_ingest_document",
  "hindsight_capture_initiative",
  "hindsight_diagnose",
  "hindsight_sync_status",
] as const;
export const HINDSIGHT_CONFIRMATION_TOOL_IDS = [
  "hindsight_ingest_document",
  "hindsight_capture_initiative",
  "hindsight_diagnose",
  "hindsight_sync_status",
] as const;

type HindsightCompanionIntegration = Readonly<{
  packageName: typeof APPROVED_HINDSIGHT_PACKAGE;
  pluginReference: string;
  packageRoot?: string;
  runtimePaths: readonly string[];
  configurationPaths: readonly string[];
  toolPatterns: readonly string[];
  nativeToolPatterns?: readonly string[];
  retentionPermission?: Readonly<Record<typeof HINDSIGHT_RETENTION_TOOL_ID, "ask" | "allow">>;
  confirmationPermissions?: Readonly<Partial<Record<(typeof HINDSIGHT_CONFIRMATION_TOOL_IDS)[number], "ask">>>;
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
  backend: HindsightLaunchBackend,
  retentionReady = true,
): NonNullable<MemoryProviderStatus["automaticSessionRetention"]> {
  if (status.state === "blocked") return { state: "blocked" };
  if (status.state === "error") return { state: "error" };
  if (status.state === "unavailable" || status.state === "configured") return { state: "unavailable" };
  if (backend !== "nono") return { state: "unavailable" };
  if (!hasApprovedIntegration) return { state: "unavailable" };
  if (!retentionReady) return { state: "unavailable" };
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
  backend: HindsightLaunchBackend = "vscode",
): HindsightCompanionIntegrationResult {
  const policy = normalizeMemoryRetentionPolicy(retentionPolicy);
  const safeStatus = sanitizedStatus(status);
  if (
    status.id !== "hindsight" ||
    (status.state !== "available" && status.state !== "partial") ||
    !resolution ||
    resolution.packageName !== APPROVED_HINDSIGHT_PACKAGE
  ) {
    return {
      status: {
        ...safeStatus,
        capabilities: { ...safeStatus.capabilities, automaticSessionRetention: false },
        automaticSessionRetention: automaticRetentionState(status, false, false, backend),
      },
    };
  }

  const observed = new Set(observedToolIds);
  const recall = status.capabilities.recall && HINDSIGHT_RECALL_TOOL_IDS.every((toolId) => observed.has(toolId));
  const nativeBackend = backend === "nono";
  const reflect = nativeBackend && status.capabilities.reflect && observed.has(HINDSIGHT_REFLECT_TOOL_IDS[0]);
  const nativeToolPatterns = nativeBackend
    ? [
        ...(recall ? HINDSIGHT_RECALL_TOOL_IDS : []),
        ...(reflect ? HINDSIGHT_REFLECT_TOOL_IDS : []),
        ...HINDSIGHT_APPROVED_TOOL_IDS.filter(
          (toolId) =>
            !HINDSIGHT_RECALL_TOOL_IDS.includes(toolId as (typeof HINDSIGHT_RECALL_TOOL_IDS)[number]) &&
            !HINDSIGHT_REFLECT_TOOL_IDS.includes(toolId as (typeof HINDSIGHT_REFLECT_TOOL_IDS)[number]) &&
            observed.has(toolId),
        ),
      ]
    : [];
  const toolPatterns = recall ? [...HINDSIGHT_RECALL_TOOL_IDS] : [];
  const retention =
    nativeBackend && status.capabilities.retain && observed.has(HINDSIGHT_RETENTION_TOOL_ID) && policy.enabled === true
      ? { [HINDSIGHT_RETENTION_TOOL_ID]: "ask" as const }
      : undefined;
  const retentionReady =
    nativeBackend &&
    status.capabilities.retain === true &&
    status.capabilities.automaticSessionRetention === true &&
    observed.has(HINDSIGHT_RETENTION_TOOL_ID);
  const confirmationPermissions = nativeBackend
    ? (Object.fromEntries(
        HINDSIGHT_CONFIRMATION_TOOL_IDS.filter(
          (toolId) =>
            observed.has(toolId) &&
            ((toolId !== HINDSIGHT_RETENTION_TOOL_ID && toolId !== "hindsight_capture_initiative") ||
              policy.enabled === true),
        ).map((toolId) => [toolId, "ask"]),
      ) as Readonly<Record<(typeof HINDSIGHT_CONFIRMATION_TOOL_IDS)[number], "ask">>)
    : {};
  const automatic =
    nativeBackend &&
    policy.automaticSessionRetention &&
    status.capabilities.automaticSessionRetention === true &&
    status.capabilities.retain === true &&
    observed.has(HINDSIGHT_RETENTION_TOOL_ID);

  if (nativeToolPatterns.length === 0 && toolPatterns.length === 0 && !retention && !automatic) {
    return {
      status: {
        ...safeStatus,
        capabilities: {
          ...safeStatus.capabilities,
          retain: nativeBackend && safeStatus.capabilities.retain,
          reflect,
          automaticSessionRetention: false,
        },
        automaticSessionRetention: automaticRetentionState(
          status,
          false,
          true,
          backend,
          retentionReady || !policy.automaticSessionRetention,
        ),
      },
    };
  }

  return {
    status: {
      ...safeStatus,
      capabilities: {
        retain: nativeBackend && status.capabilities.retain,
        recall,
        reflect,
        automaticSessionRetention: automatic,
      },
      automaticSessionRetention: automaticRetentionState(
        status,
        automatic,
        true,
        backend,
        retentionReady || !policy.automaticSessionRetention,
      ),
    },
    integration: Object.freeze({
      packageName: APPROVED_HINDSIGHT_PACKAGE,
      pluginReference: resolution.pluginReference,
      ...(resolution.packageRoot ? { packageRoot: resolution.packageRoot } : {}),
      runtimePaths: resolution.runtimePaths,
      configurationPaths: resolution.configurationPaths,
      toolPatterns: Object.freeze(toolPatterns),
      nativeToolPatterns: Object.freeze(nativeToolPatterns),
      ...(retention ? { retentionPermission: Object.freeze(retention) } : {}),
      ...(Object.keys(confirmationPermissions).length
        ? { confirmationPermissions: Object.freeze(confirmationPermissions) }
        : {}),
      automaticSessionRetention: automatic,
      environment: Object.freeze(automatic ? {} : { HINDSIGHT_DISABLE_HOOKS: "1" as const }),
    }),
  };
}

export type { HindsightCompanionIntegration };

// Kept as a descriptive alias for callers that treat this as an adapter.
export const adaptHindsightCompanionIntegration = buildHindsightCompanionIntegration;
