// @opencode-chat/agent-opencode - OpenCode agent implementation

export type {
  HindsightCompanionIntegration,
  HindsightCompanionIntegrationResult,
} from "./hindsight-companion-integration";
export {
  adaptHindsightCompanionIntegration,
  buildHindsightCompanionIntegration,
  HINDSIGHT_DISABLE_HOOKS_ENV,
  HINDSIGHT_RECALL_TOOL_IDS,
  HINDSIGHT_REFLECT_TOOL_IDS,
  HINDSIGHT_RETENTION_TOOL_ID,
} from "./hindsight-companion-integration";
export type {
  EffectiveOpenCodeConfiguration,
  HindsightPackageMetadata,
  HindsightPackageMetadataReader,
  HindsightPluginEntry,
  HindsightPluginResolution,
} from "./hindsight-plugin-resolver";
export {
  APPROVED_HINDSIGHT_PACKAGE,
  readEffectiveOpenCodeConfiguration,
  readHindsightPackageMetadata,
  resolveHindsightPlugin,
} from "./hindsight-plugin-resolver";
export type {
  OpenCodeCommandDefinition,
  OpenCodeEffectiveSandboxMode,
  OpenCodeExecutableSelection,
  OpenCodeFilesystemPolicy,
  OpenCodeGuidanceOverlay,
  OpenCodeLaunchConfiguration,
  OpenCodePluginEntry,
} from "./launch-config";
export * from "./mappers";
export type { McpInventory, McpTransport } from "./mcp-inventory";
export { resolveMcpInventory } from "./mcp-inventory";
export { buildMcpOverlay } from "./mcp-overlay";
export type {
  HindsightDetectionInput,
  MemoryDetectionContext,
  MemoryProviderDetector,
  MemoryProviderFactory,
  MemoryProviderFactoryContext,
  MemoryProviderProbe,
  MemoryProviderProbeResult,
  MemoryProviderSelection,
} from "./memory-provider-discovery";
export {
  adaptHindsightProviderStatus,
  detectMemoryProvider,
  HindsightProviderDetector,
  MemoryProviderDiscovery,
  NONE_MEMORY_PROVIDER_DESCRIPTOR,
  normalizeMemoryProviderReason,
  selectMemoryProvider,
} from "./memory-provider-discovery";
export type {
  MemoryProviderAdapter,
  MemoryProviderRegistryContext,
  MemoryProviderRegistrySelection,
  MemoryProviderSelectionRequest,
} from "./memory-provider-registry";
export { createMemoryProviderRegistry, MemoryProviderRegistry } from "./memory-provider-registry";
export type {
  MemoryRetentionSummary,
  MemoryRetentionValidation,
  MemoryRetentionValidationReason,
} from "./memory-retention-policy";
export {
  MAX_MEMORY_RETENTION_SUMMARY_LENGTH,
  MAX_MEMORY_RETENTION_TAG_LENGTH,
  MAX_MEMORY_RETENTION_TAGS,
  MAX_MEMORY_RETENTION_TITLE_LENGTH,
  normalizeMemoryRetentionPolicy,
  validateMemoryRetentionSummary,
} from "./memory-retention-policy";
export { OpenCodeAgent } from "./opencode-agent";
