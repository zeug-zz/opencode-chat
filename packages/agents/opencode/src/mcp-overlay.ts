import type { McpInventory } from "./mcp-inventory";

export type McpOverlay = {
  mcp: Record<string, { enabled: boolean }>;
  locked: string[];
};

export function buildMcpOverlay(inventory: McpInventory, prefs: Record<string, boolean>): McpOverlay {
  const mcp: Record<string, { enabled: boolean }> = {};

  for (const name of Object.keys(inventory.servers).sort()) {
    mcp[name] = { enabled: prefs[name] === true };
  }

  return { mcp, locked: [] };
}
