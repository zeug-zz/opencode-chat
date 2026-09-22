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

export type OpenCodePluginEntry = string | readonly [string, ...(readonly unknown[])];

export type OpenCodeGuidanceOverlay = {
  skills?: { paths: readonly string[] };
  command?: Record<string, OpenCodeCommandDefinition>;
};

export type OpenCodeRestrictedReviewConfiguration = {
  model: string;
  prompt: string;
  maxSteps: number;
  dynamicToolNames?: readonly string[];
};

export type OpenCodeLaunchConfiguration = {
  workspacePath: string;
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
  pluginSources?: readonly OpenCodePluginEntry[];
  mcpOverlay?: { mcp: Record<string, { enabled: boolean }> };
  mcpTransport?: Readonly<Record<string, import("./mcp-inventory").McpTransport>>;
  guidanceOverlay?: OpenCodeGuidanceOverlay;
  hindsightCompanionIntegration?: HindsightCompanionIntegration;
  memoryRetentionPolicy?: MemoryRetentionPolicy;
  /** Host-composed, in-memory-only restricted review agent configuration. */
  restrictedReview?: OpenCodeRestrictedReviewConfiguration;
};
