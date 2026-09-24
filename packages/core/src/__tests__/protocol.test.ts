import { describe, expect, it } from "vitest";
import type {
  HostToUIMessage,
  MemoryCapabilities,
  MemoryOperation,
  MemoryProviderDescriptor,
  MemoryProviderState,
  MemoryProviderStatus,
  ReasoningAssistSummary,
  ReasoningReviewRuntime,
  UIToHostMessage,
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

describe("reasoning review protocol", () => {
  const runtime: ReasoningReviewRuntime = {
    state: "unavailable",
    reason: "No compatible review runtime is available",
  };

  it("serializes the retained runtime status with only its bounded two fields", () => {
    const messages: HostToUIMessage[] = [{ type: "reasoningRuntime", runtime }];

    expect(messages.map((message) => JSON.parse(JSON.stringify(message)))).toEqual(messages);
    expect(messages).toEqual([{ type: "reasoningRuntime", runtime }]);
    expect(messages.map((message) => Object.keys(message).sort())).toEqual([["runtime", "type"]]);
    expect(Object.keys(runtime).sort()).toEqual(["reason", "state"]);
  });

  it("serializes bounded preference discriminants without runtime metadata", () => {
    const hostPreference = {
      type: "reasoningReviewPreference",
      preference: { userEnabled: true, workspaceOptOut: false, effective: true },
    } satisfies HostToUIMessage;
    const partialPreference = {
      type: "setReasoningReviewPreference",
      preference: { userEnabled: false },
    } satisfies UIToHostMessage;
    const optOutPreference = {
      type: "setReasoningReviewPreference",
      preference: { workspaceOptOut: true },
    } satisfies UIToHostMessage;

    expect(JSON.parse(JSON.stringify([hostPreference, partialPreference, optOutPreference]))).toEqual([
      hostPreference,
      partialPreference,
      optOutPreference,
    ]);
    expect(Object.keys(hostPreference).sort()).toEqual(["preference", "type"]);
    expect(Object.keys(hostPreference.preference).sort()).toEqual(["effective", "userEnabled", "workspaceOptOut"]);
    expect(Object.keys(partialPreference.preference)).toEqual(["userEnabled"]);
    expect(Object.keys(optOutPreference.preference)).toEqual(["workspaceOptOut"]);
    expect(JSON.stringify([hostPreference, partialPreference, optOutPreference])).not.toMatch(
      /executablePath|workspacePath|command|flags|ledger|prompt|sourcePacket|runtime/i,
    );
  });

  it("keeps provider-private fields and source content out of the public messages", () => {
    const forbiddenFields = [
      "afNodeId",
      "executablePath",
      "workspacePath",
      "command",
      "flags",
      "ledger",
      "prompt",
      "reasoningTrace",
      "sourcePacket",
    ];
    const forbiddenContent = "private-provider-ledger-and-source-packet-content";
    const publicMessages: HostToUIMessage[] = [
      {
        type: "reasoningRuntime",
        runtime: { state: "available", reason: "Ready" },
      },
      {
        type: "reasoningReviewPreference",
        preference: { userEnabled: true, workspaceOptOut: false, effective: true },
      },
    ];
    const serialized = JSON.stringify(publicMessages);

    expect(serialized).not.toContain(forbiddenContent);
    for (const field of forbiddenFields) {
      expect(serialized).not.toMatch(new RegExp(`\\"${field}\\"`));
    }
  });
});

describe("reasoning assist protocol", () => {
  const summary: ReasoningAssistSummary = {
    candidateConclusion: "The proposal is useful within its stated boundary.",
    assumptions: ["The stated input remains in scope."],
    evidenceBoundary: "No external evidence is established.",
    criticObjections: [{ target: "assumption", objection: "The assumption may not hold universally." }],
    afFact: "absent",
  };

  it("serializes progress, summary, and clear messages with prompt association", () => {
    const messages: HostToUIMessage[] = [
      { type: "reasoningAssistProgress", sessionId: "session-1", promptToken: "token-1", stage: "assessing" },
      { type: "reasoningAssistSummary", sessionId: "session-1", promptToken: "token-1", summary },
      { type: "reasoningAssistCleared", sessionId: "session-1", promptToken: "token-1" },
    ];

    expect(messages.map((message) => JSON.parse(JSON.stringify(message)))).toEqual(messages);
    expect(messages.map((message) => Object.keys(message).sort())).toEqual([
      ["promptToken", "sessionId", "stage", "type"],
      ["promptToken", "sessionId", "summary", "type"],
      ["promptToken", "sessionId", "type"],
    ]);
    expect(
      messages.every(
        (message) =>
          (message.type === "reasoningAssistProgress" ||
            message.type === "reasoningAssistSummary" ||
            message.type === "reasoningAssistCleared") &&
          message.sessionId === "session-1" &&
          message.promptToken === "token-1",
      ),
    ).toBe(true);
  });

  it("keeps assist messages free of private fields and content", () => {
    const messages: HostToUIMessage[] = [
      { type: "reasoningAssistProgress", sessionId: "session-1", promptToken: "token-1", stage: "mapping" },
      { type: "reasoningAssistSummary", sessionId: "session-1", promptToken: "token-1", summary },
      { type: "reasoningAssistCleared", sessionId: "session-1", promptToken: "token-1" },
    ];
    const serialized = JSON.stringify(messages);

    for (const field of [
      "providerId",
      "provider",
      "modelId",
      "model",
      "graphId",
      "claimId",
      "packet",
      "rawOutput",
      "hiddenPrompt",
      "sessionTitle",
      "filePath",
      "path",
      "command",
      "afPath",
      "ledger",
      "toolPayload",
      "credential",
      "privateReasoning",
    ]) {
      expect(messages.some((item) => Object.hasOwn(item, field))).toBe(false);
      expect(serialized).not.toMatch(new RegExp(`\\"${field}\\"`));
    }
    expect(serialized).not.toMatch(
      /"(?:providerId|provider|modelId|model|graphId|claimId|packet|rawOutput|hiddenPrompt|sessionTitle|filePath|path|command|afPath|ledger|toolPayload|credential|privateReasoning)"/i,
    );
  });
});
