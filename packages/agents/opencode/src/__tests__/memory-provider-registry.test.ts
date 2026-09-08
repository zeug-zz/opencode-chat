import type { HostToUIMessage, MemoryProviderDescriptor, MemoryProviderStatus } from "@opencode-chat/core";
import { describe, expect, it, vi } from "vitest";
import { NONE_MEMORY_PROVIDER_DESCRIPTOR } from "../memory-provider-discovery";
import { createMemoryProviderRegistry, type MemoryProviderAdapter } from "../memory-provider-registry";

const descriptor = (
  id: string,
  capabilities = { retain: true, recall: true, reflect: false, automaticSessionRetention: true },
): MemoryProviderDescriptor => ({
  id,
  displayName: `${id} memory`,
  capabilities: { ...capabilities, automaticSessionRetention: true },
  requiresNetwork: false,
  requiresLocalRuntime: true,
});

const adapter = (id: string, state: MemoryProviderStatus["state"], priority = 0): MemoryProviderAdapter => ({
  id,
  displayName: `${id} memory`,
  descriptor: descriptor(id),
  priority,
  detect: vi.fn(() => ({
    id,
    displayName: `${id} implementation`,
    state,
    capabilities: { retain: true, recall: true, reflect: false, automaticSessionRetention: true },
  })),
});

describe("memory provider registry", () => {
  it("selects the first usable adapter in deterministic priority order", async () => {
    const unavailable = adapter("first", "configured", 1);
    const usable = adapter("second", "partial", 2);
    const registry = createMemoryProviderRegistry([usable, unavailable]);

    const result = await registry.select("automatic");

    expect(result.descriptor.id).toBe("second");
    expect(unavailable.detect).toHaveBeenCalledOnce();
    expect(usable.detect).toHaveBeenCalledOnce();
  });

  it("selects an explicitly registered provider without trying another provider", async () => {
    const requested = adapter("requested", "available");
    const other = adapter("other", "available");
    const result = await createMemoryProviderRegistry([other, requested]).select({ providerId: "requested" });

    expect(result.descriptor.id).toBe("requested");
    expect(requested.detect).toHaveBeenCalledOnce();
    expect(other.detect).not.toHaveBeenCalled();
  });

  it("returns the immutable none descriptor for explicit none", async () => {
    const provider = adapter("provider", "available");
    const result = await createMemoryProviderRegistry([provider]).select("none");

    expect(result.descriptor).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(result.descriptor.capabilities).toEqual({
      retain: false,
      recall: false,
      reflect: false,
      automaticSessionRetention: false,
    });
    expect(provider.detect).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown explicit provider without probing registered providers", async () => {
    const provider = adapter("registered", "available");

    const result = await createMemoryProviderRegistry([provider]).select({ providerId: "missing" });

    expect(result.descriptor).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(result.status).toEqual({
      id: "none",
      displayName: "No memory provider",
      state: "unavailable",
      capabilities: { retain: false, recall: false, reflect: false },
      reason: "Provider unavailable",
    });
    expect(provider.detect).not.toHaveBeenCalled();
  });

  it("rejects malformed and duplicate registrations without replacing a valid entry", async () => {
    const first = adapter("stable", "available");
    const duplicate = adapter("stable", "configured");
    const malformed = { ...adapter("bad", "available"), descriptor: { ...descriptor("bad"), id: "" } };
    const registry = createMemoryProviderRegistry([first, malformed, duplicate]);

    expect(registry.adapters.map(({ id }) => id)).toEqual(["stable"]);
    expect((await registry.select({ providerId: "stable" })).status.state).toBe("available");
    expect(first.detect).toHaveBeenCalledOnce();
    expect(duplicate.detect).not.toHaveBeenCalled();
  });

  it("converts thrown or unsafe detection to the none fallback", async () => {
    const thrown = adapter("thrown", "available");
    vi.mocked(thrown.detect).mockImplementation(() => {
      throw { secret: "must not escape" };
    });
    const unsafe = adapter("unsafe", "available");
    vi.mocked(unsafe.detect).mockImplementation(
      () => ({ id: "unsafe", state: "available" }) as unknown as MemoryProviderStatus,
    );

    const explicit = await createMemoryProviderRegistry([thrown]).select({ providerId: "thrown" });
    const automatic = await createMemoryProviderRegistry([unsafe]).select("automatic");

    expect(explicit.descriptor).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(explicit.status.reason).toBe("Provider detection failed");
    expect(automatic.descriptor).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
  });

  it("keeps an unusable detected status separate from descriptor fallback", async () => {
    const blocked = adapter("blocked", "blocked");

    const result = await createMemoryProviderRegistry([blocked]).select("automatic");

    expect(result.descriptor).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(result.status).toMatchObject({ id: "blocked", state: "blocked" });
  });

  it("selects a replacement-shaped adapter through the neutral boundary without provider side effects", async () => {
    const sideEffects = {
      retain: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      enableLifecycleRetention: vi.fn(),
      loadPlugin: vi.fn(),
      writeConfig: vi.fn(),
    };
    const replacement = {
      id: "atlas-memory",
      displayName: "Atlas Vault",
      descriptor: {
        id: "atlas-memory",
        displayName: "Atlas Vault",
        capabilities: { retain: false, recall: true, reflect: true, automaticSessionRetention: true },
        requiresNetwork: true,
        requiresLocalRuntime: false,
        toolIds: ["atlas.search", "atlas.reflect"],
        providerPath: "/private/provider/atlas",
        credentials: "secret",
        rawPayload: { untrusted: true },
        pluginReference: "plugin:atlas",
        lifecycleOperations: ["retainTranscript"],
        configurationWriter: sideEffects.writeConfig,
      },
      priority: 3,
      detect: vi.fn(() => ({
        id: "atlas-memory",
        displayName: "Atlas Vault implementation",
        state: "partial" as const,
        capabilities: { retain: false, recall: true, reflect: true, automaticSessionRetention: true },
        toolIds: ["atlas.search", "atlas.reflect"],
        providerPath: "/private/provider/atlas",
        credentials: "secret",
        rawPayload: { untrusted: true },
        pluginReference: "plugin:atlas",
        lifecycleOperations: ["retainTranscript"],
        configurationWriter: sideEffects.writeConfig,
      })),
      permissions: { "*": "allow" },
      inheritedPlugins: ["unrelated-plugin"],
      ...sideEffects,
    };

    const registry = createMemoryProviderRegistry([replacement]);
    expect(replacement.detect).not.toHaveBeenCalled();
    expect(registry.adapters).toEqual([
      expect.objectContaining({ id: "atlas-memory", displayName: "Atlas Vault", priority: 3 }),
    ]);
    expect(registry.adapters[0]).not.toHaveProperty("permissions");
    expect(registry.adapters[0]).not.toHaveProperty("inheritedPlugins");
    expect(registry.adapters[0].descriptor).toEqual({
      id: "atlas-memory",
      displayName: "Atlas Vault",
      capabilities: { retain: false, recall: true, reflect: true, automaticSessionRetention: true },
      requiresNetwork: true,
      requiresLocalRuntime: false,
    });

    const result = await registry.select(
      { providerId: "atlas-memory" },
      {
        permissionOverlay: { "*": "allow" },
        pluginList: ["unrelated-plugin"],
        configurationWriter: sideEffects.writeConfig,
      },
    );

    expect(result).toEqual({
      descriptor: {
        id: "atlas-memory",
        displayName: "Atlas Vault",
        capabilities: { retain: false, recall: true, reflect: true, automaticSessionRetention: true },
        requiresNetwork: true,
        requiresLocalRuntime: false,
      },
      status: {
        id: "atlas-memory",
        displayName: "Atlas Vault",
        state: "partial",
        capabilities: { retain: false, recall: true, reflect: true, automaticSessionRetention: true },
      },
    });

    const protocolResult: HostToUIMessage = { type: "memoryStatus", status: result.status };
    expect(protocolResult).toEqual({ type: "memoryStatus", status: result.status });
    expect(JSON.stringify(protocolResult)).not.toMatch(
      /atlas\.search|atlas\.reflect|private\/provider|secret|untrusted|plugin:|retainTranscript|configurationWriter|permissionOverlay|unrelated-plugin/,
    );
    expect(result.descriptor.capabilities.automaticSessionRetention).toBe(true);
    for (const operation of Object.values(sideEffects)) expect(operation).not.toHaveBeenCalled();
  });
});
