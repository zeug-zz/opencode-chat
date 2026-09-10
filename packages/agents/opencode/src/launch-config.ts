import type { MemoryRetentionPolicy } from "@opencode-chat/core";
import type { HindsightCompanionIntegration } from "./hindsight-companion-integration";

export type OpenCodeEffectiveSandboxMode = "on" | "off";

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

export type OpenCodeCommandDefinition = {
  description: string;
  template: string;
};

export type OpenCodePluginEntry = string | readonly [string, ...(readonly unknown[])];

export type OpenCodeGuidanceOverlay = {
  skills?: { paths: readonly string[] };
  command?: Record<string, OpenCodeCommandDefinition>;
};

export type OpenCodeLaunchConfiguration = {
  workspacePath: string;
  sandbox: {
    mode: OpenCodeEffectiveSandboxMode;
    enabled: boolean;
    allowNetwork: boolean;
    filesystemPolicy: OpenCodeFilesystemPolicy;
    networkPolicy?: OpenCodeNetworkPolicy;
  };
  executable: OpenCodeExecutableSelection;
  pluginSources?: readonly OpenCodePluginEntry[];
  mcpOverlay?: { mcp: Record<string, { enabled: boolean }> };
  mcpTransport?: Readonly<Record<string, import("./mcp-inventory").McpTransport>>;
  guidanceOverlay?: OpenCodeGuidanceOverlay;
  hindsightCompanionIntegration?: HindsightCompanionIntegration;
  memoryRetentionPolicy?: MemoryRetentionPolicy;
};
