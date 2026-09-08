import { describe, expect, it } from "vitest";
import type {
  HostToUIMessage,
  MemoryAutomaticRetentionState,
  MemoryCapabilities,
  MemoryOperation,
  MemoryProviderDescriptor,
  MemoryProviderState,
  MemoryProviderStatus,
  MemoryRetentionPolicy,
  MemoryRetentionStatus,
  UIToHostMessage,
} from "..";
import { DEFAULT_MEMORY_RETENTION_POLICY } from "..";

const states: MemoryProviderState[] = ["unavailable", "configured", "available", "partial", "blocked", "error"];

function status(state: MemoryProviderState): MemoryProviderStatus {
  return {
    id: "hindsight",
    displayName: "Hindsight",
    state,
    capabilities: {
      retain: state === "available",
      recall: state === "available" || state === "partial",
      reflect: false,
      automaticSessionRetention: false,
    },
    automaticSessionRetention: { state: "unavailable" },
  };
}

describe("memory provider protocol", () => {
  it("supports every normalized provider state", () => {
    const messages: HostToUIMessage[] = states.map((state) => ({
      type: "memoryStatus",
      status: status(state),
    }));

    expect(messages).toHaveLength(states.length);
    expect(
      messages.map((message) => {
        if (message.type !== "memoryStatus") throw new Error("unexpected message type");
        return message.status.state;
      }),
    ).toEqual(states);
  });

  it("preserves independent capability flags and a bounded reason field", () => {
    const message: HostToUIMessage = {
      type: "memoryStatus",
      status: {
        id: "hindsight",
        displayName: "Hindsight",
        state: "partial",
        capabilities: { retain: false, recall: true, reflect: false },
        reason: "Recall is available",
      },
    };

    expect(message.status.capabilities).toEqual({ retain: false, recall: true, reflect: false });
    expect(message.status.reason).toBe("Recall is available");
  });

  it("serializes only bounded provider-neutral automatic status", () => {
    const message: HostToUIMessage = {
      type: "memoryStatus",
      status: {
        id: "hindsight",
        displayName: "Hindsight",
        state: "available",
        capabilities: { retain: true, recall: true, reflect: true, automaticSessionRetention: true },
        automaticSessionRetention: { state: "active", reason: "Lifecycle retention is active" },
      },
    };

    expect(message).toEqual({
      type: "memoryStatus",
      status: {
        id: "hindsight",
        displayName: "Hindsight",
        state: "available",
        capabilities: { retain: true, recall: true, reflect: true, automaticSessionRetention: true },
        automaticSessionRetention: { state: "active", reason: "Lifecycle retention is active" },
      },
    });
    expect(message.status.automaticSessionRetention).toEqual({
      state: "active",
      reason: "Lifecycle retention is active",
    });
    expect(message.status).not.toHaveProperty("toolNames");
  });

  it.each([
    ["no provider", "none", "unavailable", "OpenCode context (AGENTS.md fallback)"],
    ["unavailable", "none", "unavailable", "OpenCode context (AGENTS.md fallback)"],
    ["blocked", "hindsight", "blocked", "Hindsight"],
    ["detection error", "hindsight", "error", "Hindsight"],
    ["memory integration disabled", "none", "unavailable", "OpenCode context (AGENTS.md fallback)"],
  ] as const)("keeps %s fallback status context-only and sanitized", (_label, id, state, displayName) => {
    const message: HostToUIMessage = {
      type: "memoryStatus",
      status: {
        id,
        displayName,
        state,
        capabilities: { retain: false, recall: false, reflect: false, automaticSessionRetention: false },
        automaticSessionRetention: { state: "unavailable" },
        ...(state === "error" ? { reason: "Provider detection failed" } : {}),
      },
    };

    expect(message.status.capabilities).toEqual({
      retain: false,
      recall: false,
      reflect: false,
      automaticSessionRetention: false,
    });
    expect(message.status.automaticSessionRetention).toEqual({ state: "unavailable" });
    expect(JSON.stringify(message)).not.toMatch(/credential|password|token|path|rawError/i);
  });
});

describe("memory provider contract", () => {
  it("models provider-neutral operations and independent capabilities", () => {
    const operations: MemoryOperation[] = ["retain", "recall", "reflect"];
    const capabilities: MemoryCapabilities = {
      retain: true,
      recall: true,
      reflect: false,
      automaticSessionRetention: true,
    };
    const descriptor: MemoryProviderDescriptor = {
      id: "provider.example",
      displayName: "Example Memory",
      capabilities,
      requiresNetwork: true,
      requiresLocalRuntime: false,
    };

    expect(operations).toEqual(["retain", "recall", "reflect"]);
    expect(descriptor).toEqual({
      id: "provider.example",
      displayName: "Example Memory",
      capabilities,
      requiresNetwork: true,
      requiresLocalRuntime: false,
    });
  });
});

describe("memory retention protocol", () => {
  const policy: MemoryRetentionPolicy = {
    enabled: false,
    requireConfirmation: true,
    automaticSessionRetention: false,
  };

  it("supports normalized policy updates and retention status", () => {
    const update: UIToHostMessage = {
      type: "setMemoryRetentionPolicy",
      policy,
    };
    const status: MemoryRetentionStatus = {
      policy,
      state: "disabled",
      reason: "Explicit retention is disabled",
    };
    const message: HostToUIMessage = {
      type: "memoryRetentionStatus",
      status,
    };

    expect(update).toEqual({ type: "setMemoryRetentionPolicy", policy });
    expect(message).toEqual({ type: "memoryRetentionStatus", status });
  });

  it("defaults automatic retention on without enabling explicit retention", () => {
    expect(DEFAULT_MEMORY_RETENTION_POLICY).toEqual({
      enabled: false,
      requireConfirmation: true,
      automaticSessionRetention: true,
    });
  });

  it("keeps explicit retention separate from automatic lifecycle status", () => {
    const message: HostToUIMessage = {
      type: "memoryRetentionStatus",
      status: { policy, state: "unavailable", automaticSessionRetention: { state: "unavailable" } },
    };

    expect(message.status.policy.automaticSessionRetention).toBe(false);
    expect(message.status.automaticSessionRetention?.state).toBe("unavailable");
    expect(message.status).not.toHaveProperty("providerOutput");
    expect(message.status).not.toHaveProperty("toolNames");
    expect(message.status).not.toHaveProperty("path");
    expect(message.status).not.toHaveProperty("credentials");
    expect(message.status).not.toHaveProperty("rawPayload");
  });

  it("does not permit sensitive provider metadata or lifecycle state on the wire", () => {
    const status: MemoryRetentionStatus = {
      policy,
      state: "blocked",
      reason: "Provider is blocked by sandbox policy",
    };
    const serialized = JSON.stringify({ type: "memoryRetentionStatus", status });

    expect(serialized).not.toMatch(/credential|password|token|providerOutput|rawPayload|toolNames|path/i);
    expect(status.policy.automaticSessionRetention).toBe(false);
  });

  it("limits automatic retention reporting to provider-neutral bounded states", () => {
    const states: MemoryAutomaticRetentionState[] = ["active", "disabled", "unavailable", "blocked", "error"];
    for (const state of states) {
      const serialized = JSON.stringify({
        type: "memoryRetentionStatus",
        status: { policy, state: "disabled", automaticSessionRetention: { state } },
      });
      expect(serialized).not.toMatch(/hindsight|credential|password|token|path|payload|hook/i);
    }
  });
});
