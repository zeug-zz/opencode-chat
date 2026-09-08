import type { MemoryProviderDescriptor, MemoryProviderStatus } from "@opencode-chat/core";
import { describe, expect, it, vi } from "vitest";
import {
  adaptHindsightProviderStatus,
  detectMemoryProvider,
  HindsightProviderDetector,
  MemoryProviderDiscovery,
  type MemoryProviderFactory,
  type MemoryProviderProbe,
  NONE_MEMORY_PROVIDER_DESCRIPTOR,
  normalizeMemoryProviderReason,
  selectMemoryProvider,
} from "../memory-provider-discovery";

const allCapabilities = { retain: true, recall: true, reflect: true, automaticSessionRetention: true };

describe("memory provider discovery", () => {
  it.each([
    [
      "available",
      { retain: true, recall: true, reflect: true, automaticSessionRetention: true },
      { retain: true, recall: true, reflect: true, automaticSessionRetention: true },
    ],
    [
      "partial",
      { retain: true, recall: false, reflect: true, automaticSessionRetention: true },
      { retain: true, recall: false, reflect: true, automaticSessionRetention: true },
    ],
    [
      "configured",
      { retain: true, recall: true, reflect: true },
      { retain: false, recall: false, reflect: false, automaticSessionRetention: false },
    ],
    [
      "blocked",
      { retain: true, recall: true, reflect: true },
      { retain: false, recall: false, reflect: false, automaticSessionRetention: false },
    ],
    [
      "error",
      { retain: true, recall: true, reflect: true },
      { retain: false, recall: false, reflect: false, automaticSessionRetention: false },
    ],
  ] as const)("maps Hindsight %s status to conservative metadata", (state, detected, expected) => {
    const status: MemoryProviderStatus = {
      id: "hindsight",
      displayName: "provider detail must not cross the boundary",
      state,
      capabilities: detected,
      reason: "secret provider error details",
    };

    expect(adaptHindsightProviderStatus(status)).toEqual({
      id: "hindsight",
      displayName: "Hindsight",
      capabilities: expected,
      requiresNetwork: true,
      requiresLocalRuntime: true,
    });
  });

  it("maps unavailable status to the immutable context-only fallback without invoking a provider", () => {
    const status: MemoryProviderStatus = {
      id: "hindsight",
      displayName: "Hindsight",
      state: "unavailable",
      capabilities: { retain: true, recall: true, reflect: true },
      reason: "provider operation must not be invoked",
    };

    expect(adaptHindsightProviderStatus(status)).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
  });

  it("exposes an immutable AGENTS.md/context-only fallback descriptor", () => {
    expect(NONE_MEMORY_PROVIDER_DESCRIPTOR).toEqual({
      id: "none",
      displayName: "OpenCode context (AGENTS.md fallback)",
      capabilities: {
        retain: false,
        recall: false,
        reflect: false,
        automaticSessionRetention: false,
      },
      requiresNetwork: false,
      requiresLocalRuntime: false,
    });
    expect(Object.isFrozen(NONE_MEMORY_PROVIDER_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(NONE_MEMORY_PROVIDER_DESCRIPTOR.capabilities)).toBe(true);
    expect(Reflect.set(NONE_MEMORY_PROVIDER_DESCRIPTOR, "id", "unexpected")).toBe(false);
    expect(Reflect.set(NONE_MEMORY_PROVIDER_DESCRIPTOR.capabilities, "recall", true)).toBe(false);
  });

  it("returns a safe no-provider result without probing", async () => {
    const probe = vi.fn<MemoryProviderProbe>();

    await expect(detectMemoryProvider({})).resolves.toEqual({
      id: "none",
      displayName: "No memory provider",
      state: "unavailable",
      capabilities: { retain: false, recall: false, reflect: false },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("routes default Hindsight detection through the registry while preserving fallback status", async () => {
    const probe: MemoryProviderProbe = vi.fn(async () => ({
      reachable: true,
      capabilities: { retain: true, recall: false, reflect: true, automaticSessionRetention: true },
    }));

    const detected = await detectMemoryProvider({ hindsight: { configured: true, probe } });
    expect(detected).toMatchObject({
      id: "hindsight",
      state: "partial",
      capabilities: { retain: true, recall: false, reflect: true },
    });
    expect(detected.capabilities.automaticSessionRetention).toBe(true);

    await expect(detectMemoryProvider({ hindsight: { configured: true, blocked: true } })).resolves.toMatchObject({
      id: "hindsight",
      state: "blocked",
      reason: "Provider blocked by companion policy",
    });
  });

  it("uses automatic registry selection without initializing an unconfigured provider", async () => {
    const probe = vi.fn<MemoryProviderProbe>();

    await expect(detectMemoryProvider({})).resolves.toMatchObject({
      id: "none",
      state: "unavailable",
      capabilities: { retain: false, recall: false, reflect: false },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    ["no provider", undefined],
    ["unavailable provider", { id: "hindsight", state: "unavailable" as const }],
    ["blocked provider", { id: "hindsight", state: "blocked" as const }],
    ["detection error", { id: "hindsight", state: "error" as const }],
    ["memory integration disabled", undefined],
  ])("normalizes the %s path to the provider-neutral context fallback", async (_label, diagnostic) => {
    const factory: MemoryProviderFactory = { id: "fallback", create: vi.fn(async () => undefined) };

    const selected = await selectMemoryProvider([factory]);

    expect(selected).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(selected.id).toBe("none");
    expect(selected.displayName).toContain("AGENTS.md");
    expect(selected.displayName).toContain("context");
    expect(selected.capabilities).toEqual({
      retain: false,
      recall: false,
      reflect: false,
      automaticSessionRetention: false,
    });
    expect(selected.requiresNetwork).toBe(false);
    expect(selected.requiresLocalRuntime).toBe(false);
    expect(diagnostic === undefined || diagnostic.id === "hindsight").toBe(true);
  });

  it("reports a configured provider that has no safe probe", async () => {
    await expect(detectMemoryProvider({ hindsight: { configured: true } })).resolves.toMatchObject({
      id: "hindsight",
      state: "configured",
      capabilities: { retain: false, recall: false, reflect: false },
    });
  });

  it("reports a configured provider that does not respond", async () => {
    const probe: MemoryProviderProbe = vi.fn(async () => ({ reachable: false, capabilities: allCapabilities }));

    await expect(detectMemoryProvider({ hindsight: { configured: true, probe } })).resolves.toMatchObject({
      id: "hindsight",
      state: "configured",
      capabilities: { retain: false, recall: false, reflect: false },
    });
    expect(probe).toHaveBeenCalledOnce();
  });

  it("reports all independently confirmed capabilities as available", async () => {
    const probe: MemoryProviderProbe = vi.fn(async () => ({ reachable: true, capabilities: allCapabilities }));

    await expect(detectMemoryProvider({ hindsight: { configured: true, probe } })).resolves.toMatchObject({
      id: "hindsight",
      state: "available",
      capabilities: allCapabilities,
    });
  });

  it("reports only confirmed capabilities as partial", async () => {
    const capabilities = { retain: false, recall: true, reflect: false, automaticSessionRetention: true };
    const probe: MemoryProviderProbe = vi.fn(async () => ({ reachable: true, capabilities }));

    await expect(detectMemoryProvider({ hindsight: { configured: true, probe } })).resolves.toMatchObject({
      id: "hindsight",
      state: "partial",
      capabilities,
    });
  });

  it("reports policy-blocked providers without probing or broadening access", async () => {
    const probe = vi.fn<MemoryProviderProbe>();

    await expect(
      detectMemoryProvider({ hindsight: { configured: true, blocked: true, probe } }),
    ).resolves.toMatchObject({
      id: "hindsight",
      state: "blocked",
      capabilities: { retain: false, recall: false, reflect: false },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("converts probe failures into a nonfatal error status", async () => {
    const probe: MemoryProviderProbe = vi.fn(async () => {
      throw new Error("credentials and network must not escape the detector");
    });

    await expect(detectMemoryProvider({ hindsight: { configured: true, probe } })).resolves.toEqual({
      id: "hindsight",
      displayName: "Hindsight",
      state: "error",
      capabilities: { retain: false, recall: false, reflect: false, automaticSessionRetention: false },
      reason: "Provider detection failed",
    });
  });

  it("supports injected detector fakes without loading providers", async () => {
    const detector = new HindsightProviderDetector();
    const detect = vi.spyOn(detector, "detect").mockResolvedValue({
      id: "hindsight",
      displayName: "Hindsight",
      state: "blocked",
      capabilities: { retain: false, recall: false, reflect: false },
      reason: "Provider blocked by companion policy",
    });

    await expect(
      new MemoryProviderDiscovery([detector]).detect({ hindsight: { configured: true } }),
    ).resolves.toMatchObject({
      state: "blocked",
    });
    expect(detect).toHaveBeenCalledOnce();
  });

  it("bounds and redacts arbitrary provider reasons", () => {
    const reason = normalizeMemoryProviderReason(
      `Provider failed at /Users/alice/.config/hindsight with token=super-secret https://example.test?key=private ${"x".repeat(400)}`,
    );

    expect(reason).toHaveLength(160);
    expect(reason).not.toContain("super-secret");
    expect(reason).not.toContain("https://example.test");
    expect(reason).not.toContain("/Users/alice");
  });

  it("does not serialize unknown thrown values into a status reason", async () => {
    const probe: MemoryProviderProbe = vi.fn(async () => {
      throw { payload: { token: "secret" }, path: "/Users/alice/private" };
    });

    await expect(detectMemoryProvider({ hindsight: { configured: true, probe } })).resolves.toMatchObject({
      state: "error",
      reason: "Provider detection failed",
    });
  });

  it("preserves stable safe reason categories", () => {
    expect(normalizeMemoryProviderReason("Provider blocked by companion policy")).toBe(
      "Provider blocked by companion policy",
    );
    expect(normalizeMemoryProviderReason("Provider is configured but not probeable")).toBe(
      "Provider is configured but not probeable",
    );
    expect(normalizeMemoryProviderReason("Provider did not respond to the safe probe")).toBe(
      "Provider did not respond to the safe probe",
    );
  });

  it("selects the first usable provider and does not invoke later factories", async () => {
    const selected = {
      id: "local",
      displayName: "Local memory",
      capabilities: { retain: true, recall: true, reflect: false, automaticSessionRetention: false },
      requiresNetwork: false,
      requiresLocalRuntime: true,
    };
    const first: MemoryProviderFactory = { id: "local", create: vi.fn(async () => selected) };
    const later: MemoryProviderFactory = { id: "later", create: vi.fn(async () => selected) };

    await expect(selectMemoryProvider([first, later])).resolves.toEqual(selected);
    expect(first.create).toHaveBeenCalledOnce();
    expect(later.create).not.toHaveBeenCalled();
  });

  it("continues past unavailable and blocked factories", async () => {
    const selected = {
      id: "replacement",
      displayName: "Replacement memory",
      capabilities: { retain: false, recall: true, reflect: true, automaticSessionRetention: false },
      requiresNetwork: true,
      requiresLocalRuntime: false,
    };
    const unavailable: MemoryProviderFactory = { id: "unavailable", create: vi.fn(async () => undefined) };
    const blocked: MemoryProviderFactory = { id: "blocked", create: vi.fn(async () => null) };
    const replacement: MemoryProviderFactory = { id: "replacement", create: vi.fn(async () => selected) };

    await expect(selectMemoryProvider([unavailable, blocked, replacement])).resolves.toEqual(selected);
    expect(unavailable.create).toHaveBeenCalledOnce();
    expect(blocked.create).toHaveBeenCalledOnce();
    expect(replacement.create).toHaveBeenCalledOnce();
  });

  it("catches thrown factories and returns the immutable none fallback when all fail", async () => {
    const thrown: MemoryProviderFactory = {
      id: "thrown",
      create: vi.fn(async () => {
        throw new Error("provider credentials must not escape selection");
      }),
    };
    const blocked: MemoryProviderFactory = { id: "blocked", create: vi.fn(async () => undefined) };

    const result = await selectMemoryProvider([thrown, blocked]);

    expect(result).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.capabilities)).toBe(true);
    expect(thrown.create).toHaveBeenCalledOnce();
    expect(blocked.create).toHaveBeenCalledOnce();
  });

  it("returns only normalized descriptor metadata", async () => {
    const candidate = {
      id: "fake",
      displayName: "Fake memory",
      capabilities: { retain: true, recall: false, reflect: false, automaticSessionRetention: false },
      requiresNetwork: false,
      requiresLocalRuntime: false,
      toolNames: ["provider_secret_tool"],
      credentials: "secret",
    } as MemoryProviderDescriptor & { credentials: string; toolNames: string[] };

    const result = await selectMemoryProvider([{ id: "fake", create: async () => candidate }]);

    expect(result).toEqual({
      id: "fake",
      displayName: "Fake memory",
      capabilities: { retain: true, recall: false, reflect: false, automaticSessionRetention: false },
      requiresNetwork: false,
      requiresLocalRuntime: false,
    });
    expect(result).not.toHaveProperty("credentials");
    expect(result).not.toHaveProperty("toolNames");
  });

  it("keeps contract selection and adaptation construction-only", async () => {
    const operations = {
      retain: vi.fn(),
      recall: vi.fn(),
      reflect: vi.fn(),
      delete: vi.fn(),
      automaticSessionRetention: vi.fn(),
      loadPlugin: vi.fn(),
      writeConfig: vi.fn(),
    };
    const candidate = {
      ...NONE_MEMORY_PROVIDER_DESCRIPTOR,
      retain: operations.retain,
      recall: operations.recall,
      reflect: operations.reflect,
      delete: operations.delete,
      automaticSessionRetention: operations.automaticSessionRetention,
      loadPlugin: operations.loadPlugin,
      writeConfig: operations.writeConfig,
    } as MemoryProviderDescriptor & typeof operations;
    const factory: MemoryProviderFactory = {
      id: "none",
      create: vi.fn(() => candidate),
    };
    const status: MemoryProviderStatus = {
      id: "hindsight",
      displayName: "Hindsight",
      state: "unavailable",
      capabilities: { retain: false, recall: false, reflect: false },
    };

    const selected = await selectMemoryProvider([factory]);
    const adapted = adaptHindsightProviderStatus(status);

    expect(selected).toEqual(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(adapted).toBe(NONE_MEMORY_PROVIDER_DESCRIPTOR);
    expect(factory.create).toHaveBeenCalledOnce();
    for (const operation of Object.values(operations)) {
      expect(operation).not.toHaveBeenCalled();
    }
  });
});
