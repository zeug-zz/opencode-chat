import { MAX_RESTRICTED_REVIEW_TEXT_LENGTH, type RestrictedReviewProvider } from "@opencode-chat/agent-opencode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RESTRICTED_REVIEW_PERMISSION_ATTESTATION } from "../vibefeld/adversarial-review-contract";
import { createAdversarialReviewOrchestrator } from "../vibefeld/adversarial-review-orchestrator";
import { createAdversarialReviewSeam } from "../vibefeld/adversarial-review-seam";
import { HIDDEN_SESSION_MARKER_PREFIX, hiddenSessionRegistry } from "../vibefeld/hidden-session-registry";
import {
  createRestrictedReviewAdapter,
  REASONING_ASSIST_STAGES,
  validateReasoningAssistStageDeclaration,
} from "../vibefeld/restricted-review-adapter";

const packet = {
  packetId: "packet-1",
  conclusionId: "claim-1",
  claims: [
    {
      id: "claim-1",
      class: "deductive",
      statement: "A bounded statement.",
      assumptionIds: [],
      logicalDependencyIds: [],
      evidenceReferenceIds: [],
    },
  ],
  assumptions: [],
  logicalDependencies: [],
  evidenceReferences: [],
  evidenceStatus: "not_required",
  limits: {
    maxClaims: 64,
    maxAssumptions: 128,
    maxDependencies: 128,
    maxEvidenceReferences: 128,
    maxStatementLength: 512,
    maxReasonLength: 256,
  },
} as const;

function provider(overrides: Partial<RestrictedReviewProvider> = {}): RestrictedReviewProvider {
  return {
    createSession: vi.fn(async () => ({ ok: true as const, sessionId: "sdk-session" })),
    promptStage: vi.fn(),
    retrieveStageText: vi.fn(),
    runStage: vi.fn(async (_session, _text, _timeout, role) =>
      role === "prover"
        ? { ok: true as const, text: JSON.stringify({ proposalId: "proposal-1", objections: [] }) }
        : { ok: true as const, text: JSON.stringify({ proposalId: "proposal-1", dispositions: [] }) },
    ),
    beginReview: vi.fn(),
    cancelReview: vi.fn(),
    isReviewCurrent: vi.fn(),
    cancel: vi.fn(async () => ({ ok: true as const })),
    delete: vi.fn(async () => ({ ok: true as const })),
    checkReadiness: vi.fn(),
    isReady: vi.fn(),
    invalidate: vi.fn(),
    ...overrides,
  };
}

describe("restricted review adapter", () => {
  afterEach(() => {
    hiddenSessionRegistry.reset();
  });

  it("registers before creation, confirms the concrete id, and uses a marker with no packet content", async () => {
    hiddenSessionRegistry.reset();
    const reviewProvider = provider({
      createSession: vi.fn(async (title: string) => {
        expect(title.startsWith(HIDDEN_SESSION_MARKER_PREFIX)).toBe(true);
        expect(title).not.toContain("claim-from-packet");
        expect(hiddenSessionRegistry.liveCount()).toBe(1);
        return { ok: true as const, sessionId: "registered-session" };
      }),
    });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const context = await adapter.createContext("prover");
    expect(context).toBeDefined();
    expect(hiddenSessionRegistry.isHiddenSessionId("registered-session")).toBe(true);
    await adapter.cancelContext(context!);
    expect(hiddenSessionRegistry.isHiddenSessionId("registered-session")).toBe(false);
  });

  it("releases a pending registration when creation fails", async () => {
    hiddenSessionRegistry.reset();
    const adapter = createRestrictedReviewAdapter({
      provider: provider({
        createSession: vi.fn(async () => ({ ok: false as const, code: "sdk-error" as const, message: "no" })),
      }),
    });
    expect(await adapter.createContext("prover")).toBeUndefined();
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
  });

  it("deletes a child when registration expires before confirmation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    hiddenSessionRegistry.reset();
    const order: string[] = [];
    const reviewProvider = provider({
      createSession: vi.fn(async () => {
        vi.setSystemTime(6_000);
        return { ok: true as const, sessionId: "expired-session" };
      }),
      cancel: vi.fn(async () => {
        order.push("cancel");
        return { ok: true as const };
      }),
      delete: vi.fn(async () => {
        order.push("delete");
        return { ok: true as const };
      }),
    });
    try {
      const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
      expect(await adapter.createContext("prover")).toBeUndefined();
      expect(order).toEqual(["cancel", "delete"]);
      expect(hiddenSessionRegistry.liveCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      hiddenSessionRegistry.reset();
    }
  });

  it("creates role-specific contexts and injects host provenance through the real seam", async () => {
    const reviewProvider = provider();
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const seam = createAdversarialReviewSeam(adapter);
    const prover = await seam.createContext("prover");
    const verifier = await seam.createContext("verifier");

    expect(seam.getCapability()).toEqual({ supported: true, attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION });
    expect(prover).toMatchObject({ ok: true, value: { provenance: { role: "prover", contextNumber: 1 } } });
    expect(verifier).toMatchObject({ ok: true, value: { provenance: { role: "verifier", contextNumber: 2 } } });
    if (!prover.ok || !verifier.ok) throw new Error("context setup failed");
    const proposal = await seam.runProver(prover.value, packet);
    const result = await seam.runVerifier(verifier.value, packet, {
      proposalId: "proposal-1",
      prover: prover.value.provenance,
      objections: [],
    });
    expect(proposal).toMatchObject({ ok: true, value: { proposalId: "proposal-1", prover: prover.value.provenance } });
    expect(result).toMatchObject({
      ok: true,
      value: { proposalId: "proposal-1", verifier: verifier.value.provenance },
    });
    expect(reviewProvider.runStage).toHaveBeenNthCalledWith(1, "sdk-session", JSON.stringify(packet), 35_000, "prover");
  });

  it("deletes both real child sessions after a clean review", async () => {
    hiddenSessionRegistry.reset();
    let nextSession = 0;
    const reviewProvider = provider({
      createSession: vi.fn(async () => ({ ok: true as const, sessionId: `sdk-session-${++nextSession}` })),
    });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const seam = createAdversarialReviewSeam(adapter);
    const orchestrator = createAdversarialReviewOrchestrator(seam);

    await expect(
      orchestrator.review("CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion."),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(reviewProvider.cancel).toHaveBeenCalledTimes(2);
    expect(reviewProvider.delete).toHaveBeenCalledTimes(2);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
  });

  it.each([
    "not-json",
    JSON.stringify({ proposalId: "proposal-1", objections: [], extra: true }),
    JSON.stringify({ proposalId: "proposal-1", objections: [] }).repeat(10_000),
  ])("fails closed for malformed or unbounded child text", async (text) => {
    const reviewProvider = provider({ runStage: vi.fn(async () => ({ ok: true as const, text })) });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const seam = createAdversarialReviewSeam(adapter);
    const context = await seam.createContext("prover");
    if (!context.ok) throw new Error("context setup failed");
    await expect(seam.runProver(context.value, packet)).resolves.toMatchObject({
      ok: false,
      failure: { status: "audit_failed" },
    });
  });

  it("awaits cancellation and deletion and maps provider failures to cleanup", async () => {
    const order: string[] = [];
    const reviewProvider = provider({
      cancel: vi.fn(async () => {
        order.push("cancel");
        return { ok: true as const };
      }),
      delete: vi.fn(async () => {
        order.push("delete");
        return { ok: false as const, code: "sdk-error" as const, message: "private" };
      }),
    });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const context = await adapter.createContext("prover");
    if (!context || typeof context !== "object") throw new Error("context setup failed");
    await expect(adapter.cancelContext(context as never)).rejects.toThrow("cleanup failed");
    expect(order).toEqual(["cancel", "delete"]);
  });
});

describe("reasoning assist stage adapter", () => {
  afterEach(() => {
    hiddenSessionRegistry.reset();
  });

  it.each([
    [["architect"], ["architect"]],
    [["critic"], ["critic"]],
    [
      ["architect", "critic"],
      ["architect", "critic"],
    ],
  ])("accepts the exact host stage declaration %j", (input, expected) => {
    expect(validateReasoningAssistStageDeclaration(input)).toEqual(expected);
  });

  it.each([
    ["wildcard", ["*"]],
    ["broader role set", ["architect", "critic", "verifier"]],
    ["dormant verifier", ["verifier"]],
    ["dormant prover", ["prover"]],
    ["duplicate stage", ["architect", "architect"]],
    ["empty declaration", []],
    ["non-array declaration", "architect"],
    ["non-string entry", ["architect", 1]],
    ["unknown stage", ["architect", "historian"]],
  ])("rejects a %s stage declaration before any context is created", (_name, input) => {
    expect(validateReasoningAssistStageDeclaration(input)).toBeUndefined();
  });

  it("declares exactly the architect and critic stages", () => {
    const adapter = createRestrictedReviewAdapter({ provider: provider() });
    expect(adapter.supportedStages).toEqual(["architect", "critic"]);
    expect(adapter.supportedStages).toBe(REASONING_ASSIST_STAGES);
    expect(Object.isFrozen(REASONING_ASSIST_STAGES)).toBe(true);
  });

  it("rejects an unknown stage before creating any hidden context", async () => {
    const reviewProvider = provider();
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    await expect(adapter.createReasoningAssistContext("verifier" as never)).resolves.toBeUndefined();
    expect(reviewProvider.createSession).not.toHaveBeenCalled();
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
  });

  it.each(["architect", "critic"] as const)(
    "creates and releases a hidden %s context with begin/confirm semantics",
    async (stage) => {
      let nextSession = 0;
      const reviewProvider = provider({
        createSession: vi.fn(async (title: string) => {
          expect(title.startsWith(HIDDEN_SESSION_MARKER_PREFIX)).toBe(true);
          return { ok: true as const, sessionId: `stage-session-${++nextSession}` };
        }),
      });
      const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
      const context = await adapter.createReasoningAssistContext(stage);
      if (!context) throw new Error("context setup failed");
      expect(context.provenance).toEqual({
        identity: expect.any(String),
        role: stage,
        contextNumber: stage === "architect" ? 1 : 2,
      });
      expect(Object.keys(context)).toEqual(["handle", "provenance"]);
      expect(hiddenSessionRegistry.isHiddenSessionId("stage-session-1")).toBe(true);
      expect(JSON.stringify(context)).not.toContain("stage-session-1");
      await adapter.cancelReasoningAssistContext(context);
      expect(hiddenSessionRegistry.isHiddenSessionId("stage-session-1")).toBe(false);
      expect(hiddenSessionRegistry.liveCount()).toBe(0);
    },
  );

  it.each(["architect", "critic"] as const)("releases a pending %s registration when creation fails", async (stage) => {
    const adapter = createRestrictedReviewAdapter({
      provider: provider({
        createSession: vi.fn(async () => ({ ok: false as const, code: "sdk-error" as const, message: "no" })),
      }),
    });
    await expect(adapter.createReasoningAssistContext(stage)).resolves.toBeUndefined();
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
  });

  it("releases a pending registration when creation rejects", async () => {
    const adapter = createRestrictedReviewAdapter({
      provider: provider({
        createSession: vi.fn(async () => {
          throw new Error("private transport failure");
        }),
      }),
    });
    await expect(adapter.createReasoningAssistContext("architect")).resolves.toBeUndefined();
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
  });

  it("returns bounded stage text only to the caller and never through other adapter values", async () => {
    const raw = JSON.stringify({ kind: "ordinary" });
    const reviewProvider = provider({ runStage: vi.fn(async () => ({ ok: true as const, text: raw })) });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const context = await adapter.createReasoningAssistContext("architect");
    if (!context) throw new Error("context setup failed");
    const result = await adapter.runReasoningAssistStage(context, "bounded packet", "architect");
    if (!result) throw new Error("stage result missing");
    expect(result).toEqual({ ok: true, role: "architect", text: raw });
    expect(Object.keys(result).sort()).toEqual(["ok", "role", "text"]);
    expect(JSON.stringify(context)).not.toContain(raw);
    expect(JSON.stringify(adapter.supportedStages)).not.toContain(raw);
    expect(JSON.stringify(adapter.attestation)).not.toContain(raw);
    expect(reviewProvider.runStage).toHaveBeenCalledWith("sdk-session", "bounded packet", 35_000, "architect");
    await adapter.cancelReasoningAssistContext(context);
  });

  it("bounds an oversized stage result instead of returning it", async () => {
    const reviewProvider = provider({
      runStage: vi.fn(async () => ({ ok: true as const, text: "x".repeat(MAX_RESTRICTED_REVIEW_TEXT_LENGTH + 1) })),
    });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const context = await adapter.createReasoningAssistContext("critic");
    if (!context) throw new Error("context setup failed");
    await expect(adapter.runReasoningAssistStage(context, "packet", "critic")).resolves.toEqual({
      ok: false,
      role: "critic",
      reason: "oversized",
    });
    await adapter.cancelReasoningAssistContext(context);
  });

  it("fails closed for mismatched, missing, unknown, and aborted stage runs", async () => {
    const reviewProvider = provider();
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const context = await adapter.createReasoningAssistContext("architect");
    if (!context) throw new Error("context setup failed");

    await expect(adapter.runReasoningAssistStage(context, "packet", "critic")).resolves.toBeUndefined();
    await expect(
      adapter.runReasoningAssistStage(
        { handle: "forged-handle", provenance: context.provenance },
        "packet",
        "architect",
      ),
    ).resolves.toBeUndefined();
    await expect(adapter.runReasoningAssistStage(context, "packet", "verifier" as never)).resolves.toEqual({
      ok: false,
      role: "host",
      reason: "unknown-role",
    });

    const controller = new AbortController();
    controller.abort();
    await expect(adapter.runReasoningAssistStage(context, "packet", "architect", controller.signal)).resolves.toEqual({
      ok: false,
      role: "architect",
      reason: "cancelled",
    });

    expect(reviewProvider.runStage).not.toHaveBeenCalled();
    await adapter.cancelReasoningAssistContext(context);
  });

  it.each([
    ["timeout", "timeout"],
    ["invalid-response", "malformed"],
    ["sdk-error", "model-failure"],
  ] as const)("maps a provider %s failure to the bounded %s reason", async (code, reason) => {
    const reviewProvider = provider({
      runStage: vi.fn(async () => ({ ok: false as const, code, message: "private SDK detail" })),
    });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const context = await adapter.createReasoningAssistContext("critic");
    if (!context) throw new Error("context setup failed");
    const result = await adapter.runReasoningAssistStage(context, "packet", "critic");
    expect(result).toEqual({ ok: false, role: "critic", reason });
    expect(JSON.stringify(result)).not.toContain("private SDK detail");
    await adapter.cancelReasoningAssistContext(context);
  });

  it("maps a thrown provider error to a bounded failure without raw error text", async () => {
    const reviewProvider = provider({
      runStage: vi.fn(async () => {
        throw new Error("private SDK stack");
      }),
    });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const context = await adapter.createReasoningAssistContext("architect");
    if (!context) throw new Error("context setup failed");
    const result = await adapter.runReasoningAssistStage(context, "packet", "architect");
    expect(result).toEqual({ ok: false, role: "architect", reason: "model-failure" });
    expect(JSON.stringify(result)).not.toContain("private SDK stack");
    await adapter.cancelReasoningAssistContext(context);
  });

  it("cancels and disposes hidden contexts for both reasoning-assist roles", async () => {
    let nextSession = 0;
    const reviewProvider = provider({
      createSession: vi.fn(async () => ({ ok: true as const, sessionId: `stage-session-${++nextSession}` })),
    });
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider });
    const architect = await adapter.createReasoningAssistContext("architect");
    const critic = await adapter.createReasoningAssistContext("critic");
    if (!architect || !critic) throw new Error("context setup failed");
    expect(hiddenSessionRegistry.liveCount()).toBe(2);

    await adapter.cancelReasoningAssistContext(architect);
    expect(hiddenSessionRegistry.isHiddenSessionId("stage-session-1")).toBe(false);
    expect(hiddenSessionRegistry.isHiddenSessionId("stage-session-2")).toBe(true);

    await adapter.dispose();
    expect(reviewProvider.cancel).toHaveBeenCalledTimes(2);
    expect(reviewProvider.delete).toHaveBeenCalledTimes(2);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    await expect(adapter.runReasoningAssistStage(critic, "packet", "critic")).resolves.toBeUndefined();
  });
});
