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
  mcpOverlay?: { mcp: Record<string, { enabled: boolean }> };
  mcpTransport?: Readonly<Record<string, import("./mcp-inventory").McpTransport>>;
  guidanceOverlay?: OpenCodeGuidanceOverlay;
};
