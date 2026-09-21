import { describe, expect, it } from "vitest";
import type {
  HostToUIMessage,
  MemoryCapabilities,
  MemoryOperation,
  MemoryProviderDescriptor,
  MemoryProviderState,
  MemoryProviderStatus,
  ReasoningReviewRuntime,
  ReasoningReviewSummary,
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
  const summary: ReasoningReviewSummary = {
    reviewedMessageId: "message-1",
    status: "unavailable",
    invocation: "manual",
    conclusion: "Review is unavailable.",
    assumptions: [],
    evidenceStatus: "not_assessed",
    openChallenges: [],
  };

  it("serializes every UI-to-host review discriminant with only its association", () => {
    const messages: UIToHostMessage[] = [
      { type: "requestReasoningReview", sessionId: "session-1", messageId: "message-1" },
      { type: "cancelReasoningReview", sessionId: "session-1", messageId: "message-1" },
    ];

    expect(messages.map((message) => JSON.parse(JSON.stringify(message)))).toEqual(messages);
    expect(messages).toEqual([
      { type: "requestReasoningReview", sessionId: "session-1", messageId: "message-1" },
      { type: "cancelReasoningReview", sessionId: "session-1", messageId: "message-1" },
    ]);
    expect(messages.every((message) => Object.keys(message).sort().join(",") === "messageId,sessionId,type")).toBe(
      true,
    );
  });

  it("serializes every host-to-UI review discriminant with the required association", () => {
    const messages: HostToUIMessage[] = [
      { type: "reasoningRuntime", runtime },
      { type: "reasoningReview", sessionId: "session-1", summary },
    ];

    expect(messages.map((message) => JSON.parse(JSON.stringify(message)))).toEqual(messages);
    expect(messages).toEqual([
      { type: "reasoningRuntime", runtime },
      { type: "reasoningReview", sessionId: "session-1", summary },
    ]);
    expect(messages.map((message) => Object.keys(message).sort())).toEqual([
      ["runtime", "type"],
      ["sessionId", "summary", "type"],
    ]);
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

  it("carries bounded local review feedback without content or paths", () => {
    const feedback: UIToHostMessage = {
      type: "setReasoningReviewFeedback",
      sessionId: "session-1",
      messageId: "message-1",
      correct: false,
      falseChallenge: true,
    };
    const minimalFeedback: UIToHostMessage = {
      type: "setReasoningReviewFeedback",
      sessionId: "session-1",
      messageId: "message-1",
      correct: true,
    };

    expect(JSON.parse(JSON.stringify([feedback, minimalFeedback]))).toEqual([feedback, minimalFeedback]);
    expect(Object.keys(feedback).sort()).toEqual(["correct", "falseChallenge", "messageId", "sessionId", "type"]);
    expect(Object.keys(minimalFeedback).sort()).toEqual(["correct", "messageId", "sessionId", "type"]);
    expect(JSON.stringify([feedback, minimalFeedback])).not.toMatch(
      /prompt|sourcePacket|responseText|reviewText|workspacePath|reasoningTrace|executable/i,
    );
  });

  it("carries bounded automatic routing metadata without requiring it for manual summaries", () => {
    const automaticSummary: ReasoningReviewSummary = {
      ...summary,
      invocation: "automatic",
      status: "conditional",
      conclusion: "The response depends on supporting evidence.",
      routing: {
        reasonCode: "evidence_dependent",
        summary: "Evidence-dependent response",
      },
    };
    const automaticMessage: HostToUIMessage = {
      type: "reasoningReview",
      sessionId: "session-1",
      summary: automaticSummary,
    };

    expect(JSON.parse(JSON.stringify(automaticMessage))).toEqual(automaticMessage);
    expect(automaticMessage.summary.invocation).toBe("automatic");
    expect(automaticMessage.summary.routing).toEqual({
      reasonCode: "evidence_dependent",
      summary: "Evidence-dependent response",
    });
    expect(summary).not.toHaveProperty("routing");
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
        runtime: { state: "available", reason: "Ready for a manual review" },
      },
      {
        type: "reasoningReview",
        sessionId: "session-1",
        summary: {
          ...summary,
          status: "structurally_checked",
          conclusion: "The recorded structure is consistent.",
          assumptions: ["The stated premise holds"],
          openChallenges: [],
          artifactHandle: "opaque-provider-artifact",
        },
      },
    ];
    const serialized = JSON.stringify(publicMessages);

    expect(serialized).not.toContain(forbiddenContent);
    for (const field of forbiddenFields) {
      expect(serialized).not.toMatch(new RegExp(`\\"${field}\\"`));
    }
    expect(serialized).toContain("opaque-provider-artifact");
  });
});
