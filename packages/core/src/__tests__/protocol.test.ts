import { describe, expect, it } from "vitest";
import type {
  HostToUIMessage,
  MemoryCapabilities,
  MemoryOperation,
  MemoryProviderDescriptor,
  MemoryProviderState,
  MemoryProviderStatus,
} from "..";

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
