import type { MemoryRetentionPolicy } from "@opencode-chat/core";
import type { HindsightCompanionIntegration } from "./hindsight-companion-integration";

export type OpenCodeEffectiveSandboxMode = "on" | "off";

/** The enforcement boundary selected for the extension-owned companion. */
export type OpenCodeLaunchBackend = "nono" | "vscode" | "sdk";

export type OpenCodeFilesystemPolicy = {
  readWritePaths: readonly string[];
  readOnlyPaths: readonly string[];
  denyReadPaths?: readonly string[];
};

export type OpenCodeNetworkPolicy = {
  enabled: boolean;
  allowedDomains: readonly string[];
  deniedDomains: readonly string[];
  allowLocalBinding: true;
  allowMachLookup?: readonly string[];
};

export type OpenCodeExecutableSelection = {
  path: string;
  args?: readonly string[];
};

export type OpenCodeNonoLaunch = {
  executablePath: string;
  profile: string;
};

export type OpenCodeCommandDefinition = {
  description: string;
  template: string;
};

export type OpenCodePluginEntry = string | Readonly<{ package: string; options?: Readonly<Record<string, unknown>> }>;

export type OpenCodeGuidanceOverlay = {
  skills?: { paths: readonly string[] };
  command?: Record<string, OpenCodeCommandDefinition>;
};

type OpenCodeRestrictedReviewConfigurationBase = {
  prompt: string;
  maxSteps: number;
  dynamicToolNames?: readonly string[];
};

/**
 * Existing callers may pin a reviewed model explicitly. Production V2 launch
 * configuration instead uses the deliberate native-default mode, which
 * leaves the model absent from the hidden agent entry until the host resolves
 * and pins the active workspace's OpenCode default for a review session.
 */
export type OpenCodeRestrictedReviewConfiguration = OpenCodeRestrictedReviewConfigurationBase &
  ({ model: string; modelResolution?: "pinned" } | { model?: never; modelResolution: "native-default" });

export type OpenCodeLaunchConfiguration = {
  workspacePath: string;
  /** Host-resolved path facts; these are not reported by the V2 API. */
  hostPaths?: Readonly<{ config: string; state: string }>;
  /** Set by the extension host for every new companion connection. */
  backend?: OpenCodeLaunchBackend;
  sandbox: {
    mode: OpenCodeEffectiveSandboxMode;
    enabled: boolean;
    allowNetwork: boolean;
    filesystemPolicy: OpenCodeFilesystemPolicy;
    networkPolicy?: OpenCodeNetworkPolicy;
  };
  executable: OpenCodeExecutableSelection;
  /** Resolved nono executable and trusted profile, required when backend is nono. */
  nono?: OpenCodeNonoLaunch;
  /** Native sources for the private child overlay only; never persisted to user/project configuration. */
  pluginSources?: readonly OpenCodePluginEntry[];
  /** Host-composed native MCP config fragment, serialized only for the child. */
  mcpOverlay?: { mcp: Record<string, unknown> };
  mcpTransport?: Readonly<Record<string, import("./mcp-inventory").McpTransport>>;
  guidanceOverlay?: OpenCodeGuidanceOverlay;
  hindsightCompanionIntegration?: HindsightCompanionIntegration;
  memoryRetentionPolicy?: MemoryRetentionPolicy;
  /** Host-composed, in-memory-only restricted review agent configuration. */
  restrictedReview?: OpenCodeRestrictedReviewConfiguration;
};
