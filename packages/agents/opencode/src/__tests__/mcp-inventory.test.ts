import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMcpInventory } from "../mcp-inventory";
import { buildMcpOverlay } from "../mcp-overlay";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<{ root: string; global: string }> {
  const scratchDirectory = join(process.cwd(), "tmp");
  await mkdir(scratchDirectory, { recursive: true });
  const root = await mkdtemp(join(scratchDirectory, "opencode-mcp-inventory-"));
  temporaryDirectories.push(root);
  const global = join(root, "global");
  const workspace = join(root, "workspace", "src");
  await mkdir(global, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(root, "workspace", ".git"), "boundary");
  return { root: join(root, "workspace"), global };
}

afterEach(async () => {
  while (temporaryDirectories.length) await rm(temporaryDirectories.pop() as string, { recursive: true, force: true });
});

describe("resolveMcpInventory", () => {
  it("reads global-only servers and tolerates missing files", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(global, "opencode.json"), JSON.stringify({ mcp: { global: { command: "secret" } } }));

    expect(resolveMcpInventory(global, root)).toEqual({
      servers: { global: { explicitlyDisabled: false, transport: "stdio" } },
    });
  });

  it("reads project configs up to the nearest git boundary", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { project: { enabled: true } } }));
    await writeFile(join(root, "src", "opencode.json"), JSON.stringify({ mcp: { nested: {} } }));

    expect(resolveMcpInventory(global, join(root, "src"))).toEqual({
      servers: {
        nested: { explicitlyDisabled: false, transport: "unknown" },
        project: { explicitlyDisabled: false, transport: "unknown" },
      },
    });
  });

  it("uses the effective enabled state from later layers", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(global, "opencode.json"), JSON.stringify({ mcp: { shared: { enabled: false } } }));
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { shared: { enabled: true } } }));
    await writeFile(join(root, "src", "opencode.jsonc"), '{ "mcp": { "shared": { "enabled": false, }, }, }');

    expect(resolveMcpInventory(global, join(root, "src")).servers.shared).toEqual({
      explicitlyDisabled: true,
      transport: "unknown",
    });
  });

  it("parses comments and trailing commas in JSONC", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(global, "opencode.jsonc"),
      '{\n // keep this server\n "mcp": { "jsonc": { "command": "https://example.invalid", }, },\n}',
    );

    expect(resolveMcpInventory(global, root)).toEqual({
      servers: { jsonc: { explicitlyDisabled: false, transport: "stdio" } },
    });
  });

  it("classifies transports without retaining MCP definition values", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          local: { command: "node", args: ["server.js"] },
          remote: { url: "http://example.invalid/mcp" },
          sdk: { type: "sdk", package: "private-package" },
          other: { enabled: true },
        },
      }),
    );

    const inventory = resolveMcpInventory(global, root);
    expect(inventory.servers).toEqual({
      local: { explicitlyDisabled: false, transport: "stdio" },
      remote: { explicitlyDisabled: false, transport: "http" },
      sdk: { explicitlyDisabled: false, transport: "sdk" },
      other: { explicitlyDisabled: false, transport: "unknown" },
    });
    expect(JSON.stringify(inventory)).not.toContain("private-package");
  });

  it("unions .mcp.json server names without exposing definitions", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { local: { url: "https://secret.invalid" } } }),
    );

    const inventory = resolveMcpInventory(global, root);
    expect(inventory).toEqual({ servers: { local: { explicitlyDisabled: false, transport: "http" } } });
    expect(JSON.stringify(inventory)).not.toContain("secret.invalid");
  });

  it("keeps definition values out of the serialized launch overlay", async () => {
    const { root, global } = await createWorkspace();
    const fixtureValues = [
      "fake-command-vector",
      "fake-environment-value",
      "fake-header-value",
      "https://fake-mcp.invalid/endpoint",
      "fake-api-key-123",
      "fake-secret-value",
    ];
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          commandServer: {
            command: ["fake-command-vector", "--token", "fake-secret-value"],
            env: { API_KEY: "fake-api-key-123" },
            environment: { TOKEN: "fake-environment-value" },
          },
          httpServer: {
            url: "https://fake-mcp.invalid/endpoint",
            headers: { Authorization: "fake-header-value" },
          },
        },
      }),
    );

    const inventory = resolveMcpInventory(global, root);
    const result = buildMcpOverlay(inventory, { commandServer: true });
    const serializedLaunchPayload = JSON.stringify({ mcp: result.mcp });

    expect(JSON.parse(serializedLaunchPayload)).toEqual({
      mcp: {
        commandServer: { enabled: true },
        httpServer: { enabled: false },
      },
    });
    expect(Object.values(result.mcp).every((entry) => Object.keys(entry).length === 1)).toBe(true);
    expect(fixtureValues.every((value) => !serializedLaunchPayload.includes(value))).toBe(true);
  });

  it("fails when an existing contributing file is malformed", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(global, "opencode.json"), '{ "mcp": ');

    expect(() => resolveMcpInventory(global, root)).toThrow(/Unable to parse MCP config file/);
  });
});
