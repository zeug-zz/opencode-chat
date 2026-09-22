// @opencode-chat/agent-opencode - OpenCode agent implementation

export type {
  HindsightCompanionIntegration,
  HindsightCompanionIntegrationResult,
} from "./hindsight-companion-integration";
export {
  adaptHindsightCompanionIntegration,
  buildHindsightCompanionIntegration,
  HINDSIGHT_APPROVED_TOOL_IDS,
  HINDSIGHT_CONFIRMATION_TOOL_IDS,
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
  OpenCodeLaunchBackend,
  OpenCodeLaunchConfiguration,
  OpenCodeNonoLaunch,
  OpenCodePluginEntry,
  OpenCodeRestrictedReviewConfiguration,
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
export type {
  RestrictedReviewAgentEntry,
  RestrictedReviewOverlayInput,
} from "./restricted-review-overlay";
export {
  buildRestrictedReviewAgentEntry,
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_MAX_STEPS,
  RESTRICTED_REVIEW_PROMPT,
  RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
  RestrictedReviewOverlayValidationError,
  validateRestrictedReviewOverlayInput,
} from "./restricted-review-overlay";
export type {
  CreateRestrictedReviewProviderOptions,
  RestrictedReviewFailure,
  RestrictedReviewGeneration,
  RestrictedReviewModel,
  RestrictedReviewOperationResult,
  RestrictedReviewProvenance,
  RestrictedReviewProvider,
  RestrictedReviewRole,
  RestrictedReviewSessionResult,
  RestrictedReviewTextResult,
  RestrictedReviewToken,
} from "./restricted-review-provider";
export {
  createRestrictedReviewProvider,
  MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS,
  MAX_RESTRICTED_REVIEW_TEXT_LENGTH,
  mintRestrictedReviewProvenance,
} from "./restricted-review-provider";
