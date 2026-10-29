import type { McpInventory, McpServerDefinition } from "./mcp-inventory";

export type McpOverlay = {
  mcp: {
    timeout?: { startup?: number; catalog?: number; execution?: number };
    servers: Record<string, McpServerDefinition>;
  };
};

export function buildMcpOverlay(inventory: McpInventory, prefs: Record<string, boolean>): McpOverlay {
  const servers: Record<string, McpServerDefinition> = Object.create(null) as Record<string, McpServerDefinition>;
  for (const name of Object.keys(inventory.servers).sort()) {
    const selectedDefinition = structuredClone(inventory.servers[name].definition);
    // Native V2 uses `disabled`; a selected ordinary server may override that
    // field, while native system/managed configuration loads later and wins.
    selectedDefinition.disabled = prefs[name] !== true;
    servers[name] = selectedDefinition;
  }
  return { mcp: { ...(inventory.timeout ? { timeout: { ...inventory.timeout } } : {}), servers } };
}
