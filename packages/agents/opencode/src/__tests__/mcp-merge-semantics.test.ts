import { describe, expect, it } from "vitest";

type McpEntry = Record<string, unknown>;

function mergeConfig(lower: { mcp?: Record<string, McpEntry> }, overlay: { mcp?: Record<string, McpEntry> }) {
  const mcp: Record<string, McpEntry> = {};
  for (const [name, entry] of Object.entries(lower.mcp ?? {})) mcp[name] = { ...entry };
  for (const [name, entry] of Object.entries(overlay.mcp ?? {})) {
    mcp[name] = { ...mcp[name], ...entry };
  }
  return { ...lower, ...overlay, mcp };
}

function loaderStartsServer(config: { mcp?: Record<string, McpEntry> }, name: string): boolean {
  const entry = config.mcp?.[name];
  return Boolean(entry?.type && entry.enabled !== false);
}

describe("OpenCode 1.18.18 MCP config merge contract", () => {
  it("deep-merges an enabled overlay flag and preserves the inherited server definition", () => {
    const lower = {
      mcp: {
        selected: {
          type: "local",
          command: ["node", "server.js"],
          environment: { API_TOKEN: "redacted-fixture" },
          headers: { Authorization: "Bearer redacted-fixture" },
          enabled: false,
        },
      },
    };
    const overlay = { mcp: { selected: { enabled: true } } };
    const merged = mergeConfig(lower, overlay);

    expect(merged.mcp?.selected).toMatchObject({
      type: lower.mcp.selected.type,
      command: lower.mcp.selected.command,
      environment: lower.mcp.selected.environment,
      headers: lower.mcp.selected.headers,
    });
    expect(merged.mcp?.selected.enabled).toBe(true);
    expect(loaderStartsServer(merged, "selected")).toBe(true);
  });

  it("keeps an unselected inherited server disabled", () => {
    const merged = mergeConfig(
      { mcp: { unselected: { type: "local", command: ["node", "server.js"], enabled: false } } },
      { mcp: { unselected: { enabled: false } } },
    );

    expect(merged.mcp?.unselected.enabled).toBe(false);
    expect(loaderStartsServer(merged, "unselected")).toBe(false);
  });

  it("does not invent an overlay-only server without an inherited type", () => {
    const merged = mergeConfig({}, { mcp: { invented: { enabled: true } } });

    expect(merged.mcp?.invented).toEqual({ enabled: true });
    expect(loaderStartsServer(merged, "invented")).toBe(false);
  });

  it("serializes the overlay alone as server names and enabled booleans", () => {
    const lower = {
      mcp: {
        selected: {
          type: "local",
          command: ["node", "server.js"],
          environment: { API_TOKEN: "redacted-fixture" },
          headers: { Authorization: "Bearer redacted-fixture" },
        },
      },
    };
    const overlay = { mcp: { selected: { enabled: true }, unselected: { enabled: false } } };
    const serializedOverlay = JSON.stringify(overlay);

    expect(Object.keys(overlay.mcp)).toEqual(["selected", "unselected"]);
    for (const entry of Object.values(overlay.mcp)) expect(Object.keys(entry)).toEqual(["enabled"]);
    expect(serializedOverlay).not.toContain("server.js");
    expect(serializedOverlay).not.toContain("API_TOKEN");
    expect(serializedOverlay).not.toContain("Authorization");
    expect(mergeConfig(lower, overlay).mcp?.selected).toHaveProperty("command");
  });
});
