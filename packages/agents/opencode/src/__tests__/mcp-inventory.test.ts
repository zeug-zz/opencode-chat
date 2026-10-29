import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type McpInventoryOptions, resolveMcpInventory as resolveNativeInventory } from "../mcp-inventory";
import { buildMcpOverlay } from "../mcp-overlay";

const temporaryDirectories: string[] = [];

// Every call is isolated from the real platform system directory and MDM plists.
function resolveMcpInventory(global: string, workspace: string, options: McpInventoryOptions = {}) {
  return resolveNativeInventory(global, workspace, {
    systemDirectory: join(dirname(global), "system"),
    preferencePaths: [],
    explicitConfigFile: "",
    ...options,
  });
}

function systemDirectory(global: string): string {
  return join(dirname(global), "system");
}

async function createWorkspace(): Promise<{ root: string; global: string }> {
  const scratchDirectory = join(process.cwd(), "tmp");
  await mkdir(scratchDirectory, { recursive: true });
  const root = await mkdtemp(join(scratchDirectory, "opencode-mcp-inventory-"));
  temporaryDirectories.push(root);
  const global = join(root, "global");
  const workspace = join(root, "workspace", "src");
  await mkdir(global, { recursive: true });
  await mkdir(workspace, { recursive: true });
  return { root: join(root, "workspace"), global };
}

afterEach(async () => {
  while (temporaryDirectories.length) await rm(temporaryDirectories.pop() as string, { recursive: true, force: true });
});

describe("resolveMcpInventory", () => {
  it("reads native global and project server definitions in source order", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(global, "opencode.json"),
      JSON.stringify({
        mcp: {
          timeout: { startup: 1200 },
          servers: {
            shared: { type: "local", command: ["fake-global"], disabled: true },
            remote: { type: "remote", url: "https://fake.invalid/mcp", codemode: false },
          },
        },
      }),
    );
    await writeFile(
      join(root, "opencode.jsonc"),
      '{ "mcp": { "servers": { "shared": { "type": "local", "command": ["fake-project"], "environment": { "TOKEN": "fixture-secret" } }, }, }, }',
    );

    const inventory = resolveMcpInventory(global, join(root, "src"));
    expect(inventory.servers.shared).toMatchObject({
      definition: { type: "local", command: ["fake-project"], environment: { TOKEN: "fixture-secret" } },
      explicitlyDisabled: false,
      transport: "stdio",
    });
    expect(inventory.servers.remote).toMatchObject({ definition: { codemode: false }, transport: "http" });
    expect(inventory.timeout).toEqual({ startup: 1200 });
    expect(inventory.locked).toEqual([]);
    expect(inventory.qualificationGaps.some((gap) => gap.includes("System and managed-preference"))).toBe(false);
    expect(inventory.qualificationGaps.some((gap) => gap.includes("OPENCODE_CONFIG"))).toBe(true);
  });

  it("reads project .opencode config and preserves complete native transport values in memory", async () => {
    const { root, global } = await createWorkspace();
    await mkdir(join(root, ".opencode"), { recursive: true });
    const fixtures = {
      command: ["fake-command", "--opaque", "fixture-secret"],
      environment: { API_KEY: "fixture-api-key" },
      timeout: { startup: 1234, execution: 5678 },
      protocol: "auto",
    };
    await writeFile(
      join(root, ".opencode", "opencode.json"),
      JSON.stringify({
        mcp: {
          servers: {
            local: { type: "local", ...fixtures },
            remote: {
              type: "remote",
              url: "https://fixture.invalid/mcp",
              headers: { Authorization: "fixture-header" },
              oauth: {
                client_id: "fixture-client",
                client_secret: "fixture-oauth-secret",
                callback_port: 1234,
                auth_server_metadata_url: "https://fixture.invalid/.well-known/oauth",
              },
              codemode: false,
            },
          },
        },
      }),
    );

    const inventory = resolveMcpInventory(global, root);
    expect(inventory.servers.local.definition).toEqual({ type: "local", ...fixtures });
    expect(inventory.servers.remote.definition).toMatchObject({
      type: "remote",
      headers: { Authorization: "fixture-header" },
      oauth: {
        client_secret: "fixture-oauth-secret",
        auth_server_metadata_url: "https://fixture.invalid/.well-known/oauth",
      },
      codemode: false,
    });
    const overlay = buildMcpOverlay(inventory, { local: true });
    expect(overlay.mcp.servers.local).toMatchObject({ ...fixtures, disabled: false });
    expect(overlay.mcp.servers.remote).toMatchObject({ codemode: false, disabled: true });
  });

  it("does not invent Code Mode settings and retains explicit false", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          servers: {
            default: { type: "local", command: ["fixture"] },
            direct: { type: "remote", url: "https://fixture.invalid", codemode: false },
          },
        },
      }),
    );
    const overlay = buildMcpOverlay(resolveMcpInventory(global, root), { default: true, direct: true });
    expect(Object.hasOwn(overlay.mcp.servers.default, "codemode")).toBe(false);
    expect(overlay.mcp.servers.direct.codemode).toBe(false);
  });

  it("normalizes direct legacy transports without enabled and omits enabled-only records", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          remote: { type: "remote", url: "https://fixture.invalid", enabled: false },
          enabledOnly: { enabled: true },
          timeout: { type: "local", command: ["reserved-name"] },
        },
      }),
    );

    const inventory = resolveMcpInventory(global, root);
    expect(inventory.servers.remote.definition).toEqual({
      type: "remote",
      url: "https://fixture.invalid",
      disabled: true,
    });
    expect(inventory.servers.enabledOnly).toBeUndefined();
    expect(inventory.servers.timeout.definition).toEqual({ type: "local", command: ["reserved-name"] });
  });

  it("omits enabled-only records with extra fields before interpreting reserved names", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          timeout: { enabled: true, marker: "fixture" },
          servers: { enabled: false, marker: "fixture" },
        },
      }),
    );

    expect(resolveMcpInventory(global, root).servers).toEqual({});
  });

  it("keeps direct legacy and native server maps together with native same-name precedence", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          shared: { type: "local", command: ["legacy"] },
          legacyOnly: { type: "local", command: ["direct"] },
          servers: {
            shared: { type: "local", command: ["native"] },
            nativeOnly: { type: "remote", url: "https://fixture.invalid" },
          },
        },
      }),
    );

    const inventory = resolveMcpInventory(global, root);
    expect(inventory.servers.shared.definition).toEqual({ type: "local", command: ["native"] });
    expect(inventory.servers.legacyOnly.definition).toEqual({ type: "local", command: ["direct"] });
    expect(inventory.servers.nativeOnly).toBeDefined();
  });

  it("expands legacy per-server and global numeric timeouts and honors native global values", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        experimental: { mcp_timeout: 3000 },
        mcp: {
          timeout: 2000,
          local: { type: "local", command: ["fixture"], timeout: 1500 },
          servers: { native: { type: "remote", url: "https://fixture.invalid", timeout: 1000 } },
        },
      }),
    );

    const inventory = resolveMcpInventory(global, root);
    expect(inventory.timeout).toEqual({ startup: 2000, catalog: 2000, execution: 2000 });
    expect(inventory.servers.local.definition.timeout).toEqual({ startup: 1500, catalog: 1500, execution: 1500 });
    expect(inventory.servers.native.definition.timeout).toEqual({ startup: 1000, catalog: 1000, execution: 1000 });
  });

  it("maps legacy OAuth camelCase fields without dropping false or supported values", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          oauth: {
            type: "remote",
            url: "https://fixture.invalid",
            oauth: {
              clientId: "fake-client",
              clientSecret: "fake-secret",
              scope: "read",
              callbackPort: 1234,
              redirectUri: "https://fixture.invalid/callback",
            },
          },
        },
      }),
    );

    expect(resolveMcpInventory(global, root).servers.oauth.definition.oauth).toEqual({
      client_id: "fake-client",
      client_secret: "fake-secret",
      scope: "read",
      callback_port: 1234,
      redirect_uri: "https://fixture.invalid/callback",
    });
  });

  it.each([
    [{ type: "local", command: ["fixture"], enabled: "yes" }],
    [{ type: "local", command: ["fixture"], timeout: 0 }],
    [{ type: "remote", url: "https://fixture.invalid", oauth: { clientSecret: 17 } }],
    [{ type: "remote", url: "https://fixture.invalid", oauth: { apiKey: "fake-secret" } }],
    [{ type: "remote", url: "https://fixture.invalid", oauth: { authServerMetadataUrl: "https://fake.invalid" } }],
  ])("rejects malformed legacy fields with an opaque error", async (definition) => {
    const { root, global } = await createWorkspace();
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { invalid: definition } }));

    expect(() => resolveMcpInventory(global, root)).toThrow("Invalid native MCP server definition");
  });

  it("rejects non-positive or non-integer global numeric timeouts", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { timeout: 1.5 } }));

    expect(() => resolveMcpInventory(global, root)).toThrow("Invalid native MCP configuration");
  });

  it("rejects malformed or unsupported definitions without including their payload in errors", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: {
          servers: {
            invalid: { type: "local", command: "fixture-secret" },
          },
        },
      }),
    );
    expect(() => resolveMcpInventory(global, root)).toThrow("Invalid native MCP server definition");
  });

  it("keeps malformed JSONC failures bounded", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(global, "opencode.jsonc"), '{ "mcp": ');
    expect(() => resolveMcpInventory(global, root)).toThrow("Unable to read or parse native MCP config");
  });
});

describe("resolveMcpInventory managed authority", () => {
  const local = (command: string, extra: Record<string, unknown> = {}) => ({
    type: "local",
    command: [command],
    ...extra,
  });

  it("does not lock servers disabled only by ordinary user configuration", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(global, "opencode.json"),
      JSON.stringify({ mcp: { servers: { off: local("a", { disabled: true }) } } }),
    );
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({ mcp: { legacy: { ...local("b"), enabled: false } } }),
    );
    const inventory = resolveMcpInventory(global, root);
    expect(inventory.servers.off.explicitlyDisabled).toBe(true);
    expect(inventory.servers.legacy.explicitlyDisabled).toBe(true);
    expect(inventory.locked).toEqual([]);
  });

  it("locks a server a system-directory definition disables and overrides the user definition", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { servers: { corp: local("user") } } }));
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(
      join(systemDirectory(global), "opencode.jsonc"),
      '{ "mcp": { "servers": { "corp": { "type": "local", "command": ["managed"], "disabled": true }, "extra": { "type": "remote", "url": "https://fixture.invalid" } } } }',
    );
    const inventory = resolveMcpInventory(global, root);
    expect(inventory.servers.corp.definition).toEqual({ type: "local", command: ["managed"], disabled: true });
    expect(inventory.servers.corp.source).toBe(join(systemDirectory(global), "opencode.jsonc"));
    expect(inventory.servers.extra.source).toBe(join(systemDirectory(global), "opencode.jsonc"));
    expect(inventory.locked).toEqual(["corp"]);
  });

  it("unlocks a server when a later managed definition is enabled", async () => {
    const { root, global } = await createWorkspace();
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(
      join(systemDirectory(global), "opencode.json"),
      JSON.stringify({ mcp: { servers: { s: local("a", { disabled: true }) } } }),
    );
    await writeFile(
      join(systemDirectory(global), "opencode.jsonc"),
      '{ "mcp": { "servers": { "s": { "type": "local", "command": ["b"] } } } }',
    );
    expect(resolveMcpInventory(global, root).locked).toEqual([]);
  });

  it("locks a user-defined server disabled by a managed-preference plist read through the injected reader", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { servers: { mdm: local("user") } } }));
    const plist = join(dirname(global), "ai.opencode.managed.plist");
    await writeFile(plist, "placeholder");
    const reader = vi.fn(() =>
      JSON.stringify({
        PayloadType: "ai.opencode.managed",
        PayloadUUID: "fixture",
        mcp: { servers: { mdm: local("managed", { disabled: true }) } },
      }),
    );
    const inventory = resolveMcpInventory(global, root, {
      preferencePaths: [join(dirname(global), "missing.plist"), plist],
      readPreference: reader,
    });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(plist);
    expect(inventory.servers.mdm.source).toBe(plist);
    expect(inventory.locked).toEqual(["mdm"]);
  });

  it("ignores later plist candidates once the first present one wins", async () => {
    const { root, global } = await createWorkspace();
    const first = join(dirname(global), "first.plist");
    const second = join(dirname(global), "second.plist");
    await writeFile(first, "x");
    await writeFile(second, "x");
    const reader = vi.fn(() =>
      JSON.stringify({ policies: [{ action: "integration.use", resource: "mcp:*", effect: "deny" }] }),
    );
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { servers: { a: local("a") } } }));
    expect(
      resolveMcpInventory(global, root, { preferencePaths: [first, second], readPreference: reader }).locked,
    ).toEqual(["a"]);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(first);
  });

  it("skips a plist that cannot be converted, as native does, and records a gap", async () => {
    const { root, global } = await createWorkspace();
    const plist = join(dirname(global), "ai.opencode.managed.plist");
    await writeFile(plist, "x");
    await writeFile(join(root, "opencode.json"), JSON.stringify({ mcp: { servers: { a: local("a") } } }));
    const inventory = resolveMcpInventory(global, root, {
      preferencePaths: [plist],
      readPreference: () => {
        throw new Error("plutil failed with fixture-secret");
      },
    });
    expect(inventory.locked).toEqual([]);
    expect(inventory.qualificationGaps.join(" ")).toContain("plist could not be converted");
    expect(inventory.qualificationGaps.join(" ")).not.toContain("fixture-secret");
  });

  it("fails closed with an opaque error when converted plist content is malformed", async () => {
    const { root, global } = await createWorkspace();
    const plist = join(dirname(global), "ai.opencode.managed.plist");
    await writeFile(plist, "x");
    for (const output of ["{ fixture-secret", "[]"]) {
      expect(() =>
        resolveMcpInventory(global, root, { preferencePaths: [plist], readPreference: () => output }),
      ).toThrow("Unable to read or parse native MCP config");
    }
  });

  it("fails closed on malformed managed system config and malformed policies", async () => {
    const { root, global } = await createWorkspace();
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(join(systemDirectory(global), "opencode.json"), '{ "mcp": ');
    expect(() => resolveMcpInventory(global, root)).toThrow("Unable to read or parse native MCP config");
    await writeFile(
      join(systemDirectory(global), "opencode.json"),
      JSON.stringify({ mcp: { servers: { s: { type: "local", command: "x" } } } }),
    );
    expect(() => resolveMcpInventory(global, root)).toThrow("Invalid native MCP server definition");
    for (const policies of [
      "deny",
      [{ action: "integration.use", resource: "mcp:*", effect: "block" }],
      [{ action: "other", resource: "mcp:*", effect: "deny" }],
      [{ action: "integration.use", resource: 4, effect: "deny" }],
    ]) {
      await writeFile(join(systemDirectory(global), "opencode.json"), JSON.stringify({ policies }));
      expect(() => resolveMcpInventory(global, root)).toThrow("Invalid native MCP configuration");
    }
  });

  it("locks servers denied by exact and wildcard integration.use policies and ignores other actions and resources", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        mcp: { servers: { exact: local("a"), team_one: local("b"), team_two: local("c"), safe: local("d") } },
      }),
    );
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(
      join(systemDirectory(global), "opencode.json"),
      JSON.stringify({
        policies: [
          { action: "integration.use", resource: "mcp:exact", effect: "deny" },
          { action: "integration.use", resource: "mcp:team_*", effect: "deny" },
          { action: "tool.use", resource: "mcp:safe", effect: "deny" },
          { action: "integration.use", resource: "skill:safe", effect: "deny" },
          { action: "integration.use", resource: "mcp:exact2", effect: "deny" },
        ],
      }),
    );
    expect(resolveMcpInventory(global, root).locked).toEqual(["exact", "team_one", "team_two"]);
  });

  it("evaluates policies with the last matching statement winning within a document", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({ mcp: { servers: { a: local("a"), b: local("b") } } }),
    );
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(
      join(systemDirectory(global), "opencode.json"),
      JSON.stringify({
        policies: [
          { action: "integration.use", resource: "mcp:*", effect: "deny" },
          { action: "integration.use", resource: "mcp:a", effect: "allow" },
        ],
      }),
    );
    expect(resolveMcpInventory(global, root).locked).toEqual(["b"]);
  });

  it("gives managed policy final authority over global and project policy in native order", async () => {
    const { root, global } = await createWorkspace();
    const allowAll = { policies: [{ action: "integration.use", resource: "mcp:*", effect: "allow" }] };
    const denyAll = { policies: [{ action: "integration.use", resource: "mcp:*", effect: "deny" }] };
    const servers = { mcp: { servers: { a: local("a") } } };
    await writeFile(join(root, "opencode.json"), JSON.stringify({ ...servers, ...allowAll }));
    // Project policy cannot override a global denial, and cannot lift it.
    await writeFile(join(global, "opencode.json"), JSON.stringify(denyAll));
    expect(resolveMcpInventory(global, root).locked).toEqual(["a"]);
    // Global allow outranks a project deny.
    await writeFile(join(global, "opencode.json"), JSON.stringify(allowAll));
    await writeFile(join(root, "opencode.json"), JSON.stringify({ ...servers, ...denyAll }));
    expect(resolveMcpInventory(global, root).locked).toEqual([]);
    // System policy outranks global and project.
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(join(systemDirectory(global), "opencode.json"), JSON.stringify(denyAll));
    await writeFile(join(root, "opencode.json"), JSON.stringify({ ...servers, ...allowAll }));
    expect(resolveMcpInventory(global, root).locked).toEqual(["a"]);
    // MDM policy outranks system policy, and system .jsonc outranks system .json.
    const plist = join(dirname(global), "ai.opencode.managed.plist");
    await writeFile(plist, "x");
    const reader = () => JSON.stringify(allowAll);
    expect(resolveMcpInventory(global, root, { preferencePaths: [plist], readPreference: reader }).locked).toEqual([]);
    await writeFile(join(systemDirectory(global), "opencode.jsonc"), JSON.stringify(allowAll));
    expect(resolveMcpInventory(global, root).locked).toEqual([]);
  });

  it("does not lock anything on non-deny policies alone and keeps locked sorted and unique", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({ mcp: { servers: { z: local("z", { disabled: true }), a: local("a") } } }),
    );
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(
      join(systemDirectory(global), "opencode.json"),
      JSON.stringify({
        mcp: { servers: { z: local("z", { disabled: true }) } },
        policies: [
          { action: "integration.use", resource: "mcp:z", effect: "deny" },
          { action: "integration.use", resource: "mcp:a", effect: "deny" },
        ],
      }),
    );
    expect(resolveMcpInventory(global, root).locked).toEqual(["a", "z"]);
  });
});

describe("resolveMcpInventory explicit config file and project walk", () => {
  const local = (name: string) => ({ type: "local", command: [name] });
  const servers = (value: Record<string, unknown>) => JSON.stringify({ mcp: { servers: value } });

  it("loads the explicit file between global and direct project files", async () => {
    const { root, global } = await createWorkspace();
    const explicit = join(root, "..", "explicit.json");
    await writeFile(join(global, "opencode.json"), servers({ a: local("global"), b: local("global") }));
    await writeFile(explicit, servers({ a: local("explicit"), b: local("explicit"), c: local("explicit") }));
    await writeFile(join(root, "opencode.json"), servers({ b: local("project") }));
    const inventory = resolveMcpInventory(global, join(root, "src"), { explicitConfigFile: explicit });
    expect(inventory.servers.a.definition.command).toEqual(["explicit"]);
    expect(inventory.servers.a.source).toBe(explicit);
    expect(inventory.servers.b.definition.command).toEqual(["project"]);
    expect(inventory.servers.c.source).toBe(explicit);
  });

  it("resolves a relative explicit path against the workspace", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(root, "extra.json"), servers({ rel: local("rel") }));
    const inventory = resolveMcpInventory(global, root, { explicitConfigFile: "extra.json" });
    expect(inventory.servers.rel.source).toBe(join(root, "extra.json"));
  });

  it("locks servers denied by explicit-file policy, but managed policy still outranks it", async () => {
    const { root, global } = await createWorkspace();
    const explicit = join(root, "..", "explicit.json");
    await writeFile(
      explicit,
      JSON.stringify({
        mcp: { servers: { blocked: local("x"), open: local("y") } },
        policies: [{ action: "integration.use", resource: "mcp:bl*", effect: "deny" }],
      }),
    );
    expect(resolveMcpInventory(global, root, { explicitConfigFile: explicit }).locked).toEqual(["blocked"]);
    await mkdir(systemDirectory(global), { recursive: true });
    await writeFile(
      join(systemDirectory(global), "opencode.json"),
      JSON.stringify({ policies: [{ action: "integration.use", resource: "mcp:*", effect: "allow" }] }),
    );
    expect(resolveMcpInventory(global, root, { explicitConfigFile: explicit }).locked).toEqual([]);
  });

  it("does not lock a server a plain explicit-file definition disables", async () => {
    const { root, global } = await createWorkspace();
    const explicit = join(root, "..", "explicit.json");
    await writeFile(explicit, servers({ off: { ...local("x"), disabled: true } }));
    const inventory = resolveMcpInventory(global, root, { explicitConfigFile: explicit });
    expect(inventory.servers.off.explicitlyDisabled).toBe(true);
    expect(inventory.locked).toEqual([]);
  });

  it("treats a missing explicit file as absent but fails closed on malformed or unreadable-as-file input", async () => {
    const { root, global } = await createWorkspace();
    const missing = join(root, "..", "missing.json");
    expect(resolveMcpInventory(global, root, { explicitConfigFile: missing }).servers).toEqual({});
    const malformed = join(root, "..", "bad.json");
    await writeFile(malformed, '{ "mcp": ');
    expect(() => resolveMcpInventory(global, root, { explicitConfigFile: malformed })).toThrow(
      "Unable to read or parse native MCP config",
    );
    await writeFile(malformed, JSON.stringify({ policies: [{ action: "bogus", resource: "x", effect: "deny" }] }));
    expect(() => resolveMcpInventory(global, root, { explicitConfigFile: malformed })).toThrow(
      "Invalid native MCP configuration",
    );
    // A directory is neither absent nor parseable.
    expect(() => resolveMcpInventory(global, root, { explicitConfigFile: root })).toThrow(
      "Unable to read or parse native MCP config",
    );
  });

  it("falls back to OPENCODE_CONFIG only when no explicit option is injected", async () => {
    const { root, global } = await createWorkspace();
    const explicit = join(root, "..", "env.json");
    await writeFile(explicit, servers({ fromEnv: local("env") }));
    vi.stubEnv("OPENCODE_CONFIG", explicit);
    try {
      const fromEnv = resolveNativeInventory(global, root, {
        systemDirectory: systemDirectory(global),
        preferencePaths: [],
      });
      expect(Object.keys(fromEnv.servers)).toEqual(["fromEnv"]);
      expect(resolveMcpInventory(global, root).servers).toEqual({});
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("skips project files when the workspace is the global config directory", async () => {
    const { root, global } = await createWorkspace();
    await writeFile(join(root, "..", "opencode.json"), servers({ parent: local("parent") }));
    await writeFile(join(global, "opencode.json"), servers({ own: local("own") }));
    expect(Object.keys(resolveMcpInventory(global, global).servers)).toEqual(["own"]);
    // Negative control: a sibling workspace still walks upward.
    expect(Object.keys(resolveMcpInventory(global, root).servers).sort()).toEqual(["own", "parent"]);
  });

  it("skips project files when the workspace is the system config directory", async () => {
    const { root, global } = await createWorkspace();
    const system = systemDirectory(global);
    await mkdir(system, { recursive: true });
    await writeFile(join(root, "..", "opencode.json"), servers({ parent: local("parent") }));
    await writeFile(join(system, "opencode.json"), servers({ managed: local("managed") }));
    expect(Object.keys(resolveMcpInventory(global, system).servers)).toEqual(["managed"]);
  });

  it("compares real paths, so a symlinked workspace for the global directory also skips the walk", async () => {
    const { root, global } = await createWorkspace();
    const link = join(root, "..", "global-link");
    await symlink(global, link);
    await writeFile(join(root, "..", "opencode.json"), servers({ parent: local("parent") }));
    expect(resolveMcpInventory(global, link).servers).toEqual({});
  });
});
