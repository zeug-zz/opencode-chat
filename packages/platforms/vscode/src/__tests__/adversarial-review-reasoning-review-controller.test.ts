import type { RestrictedReviewProvider } from "@opencode-chat/agent-opencode";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
  type ReviewContextMetadata,
} from "../vibefeld/adversarial-review-contract";
import { AdversarialReviewReasoningReviewController } from "../vibefeld/adversarial-review-reasoning-review-controller";
import type { AdversarialReviewSeam } from "../vibefeld/adversarial-review-seam";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import type { ClaimProjectionSeam } from "../vibefeld/claim-projection-seam";
import { createCompletedAnswerClaimMapper } from "../vibefeld/completed-answer-claim-mapper";
import { ComposedReasoningReviewController } from "../vibefeld/composed-reasoning-review-controller";
import { hiddenSessionRegistry } from "../vibefeld/hidden-session-registry";
import { createRestrictedReviewAdapter } from "../vibefeld/restricted-review-adapter";

const source = [
  "CONCLUSION: claim-conclusion",
  "CLAIM: claim-premise|empirical|A bounded observation is recorded.",
  "CLAIM: claim-conclusion|deductive|The conclusion follows from the premise.",
  "ASSUMPTION: assumption-1|claim-conclusion|The premise applies to this case.",
  "DEPENDS: edge-1|claim-conclusion|claim-premise",
  "EVIDENCE: evidence-1|claim-premise|observation|source_recorded",
].join("\n");

const context = (role: "prover" | "verifier", identity: string): ReviewContextMetadata => ({
  handle: `${role}-handle` as ReviewContextMetadata["handle"],
  provenance: { identity, role, contextNumber: role === "prover" ? 1 : 2 },
});

function seam(): AdversarialReviewSeam {
  const prover = context("prover", "prover-id");
  const verifier = context("verifier", "verifier-id");
  return {
    getCapability: vi.fn(() => ({ supported: true, attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION })),
    createContext: vi.fn(async (role) => ({ ok: true as const, value: role === "prover" ? prover : verifier })),
    runProver: vi.fn(async () => ({
      ok: true as const,
      value: {
        proposalId: "proposal-1",
        prover: prover.provenance,
        objections: [
          {
            objectionId: "objection-1",
            target: { kind: "claim" as const, id: "claim-conclusion" },
            severity: "major" as const,
            reason: "The conclusion depends on an assumption.",
          },
        ],
      },
    })),
    runVerifier: vi.fn(async () => ({
      ok: true as const,
      value: {
        verifier: verifier.provenance,
        proposalId: "proposal-1",
        dispositions: [
          { objectionId: "objection-1", disposition: "confirmed" as const, reason: "The objection remains open." },
        ],
      },
    })),
    cancelContext: vi.fn(async () => undefined),
  };
}

function claimProjection(status: "structurally_checked" | "conditional" | "unresolved" | "refuted") {
  const value: ClaimProjectionSeam = {
    getCapability: vi.fn(() => ({ supported: true as const, operation: "claim_projection" as const })),
    project: vi.fn(async () => ({ status })),
  };
  return value;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function testCompositionOptions() {
  let currentToken: number | undefined;
  let nextToken = 0;
  return {
    mapCompletedAnswer: async (answer: string) => {
      const result = compileClaimGraph(answer);
      return result.ok ? result.graph : undefined;
    },
    reviewLifecycle: {
      beginReview: vi.fn(async () => {
        currentToken = ++nextToken;
        return currentToken;
      }),
      cancelReview: vi.fn(async (token: number) => {
        if (currentToken === token) currentToken = undefined;
        return { ok: true as const };
      }),
      isReviewCurrent: vi.fn((token: number) => currentToken === token),
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("AdversarialReviewReasoningReviewController", () => {
  it("keeps the default capability unavailable without creating child contexts", async () => {
    const controller = new AdversarialReviewReasoningReviewController();

    await expect(controller.getRuntime()).resolves.toEqual({
      state: "unavailable",
      reason: "No adversarial-review capability is available.",
    });
    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reviewedMessageId: "message-1",
    });
  });

  it("runs valid manual work through the bounded packet and returns only the shared summary shape", async () => {
    const reviewSeam = seam();
    const controller = new AdversarialReviewReasoningReviewController(reviewSeam);
    const original = source;

    const result = await controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: original });

    expect(result).toMatchObject({ reviewedMessageId: "message-1", status: "unresolved", invocation: "manual" });
    expect(result.openChallenges).toEqual([
      { severity: "major", target: "claim:claim-conclusion", reason: "The objection remains open." },
    ]);
    expect(source).toBe(original);
    expect(Object.keys(result).sort()).toEqual([
      "assumptions",
      "conclusion",
      "evidenceStatus",
      "interpretiveBoundary",
      "invocation",
      "openChallenges",
      "reviewedMessageId",
      "status",
    ]);
    expect(reviewSeam.runProver).toHaveBeenCalledTimes(1);
    expect(reviewSeam.runVerifier).toHaveBeenCalledTimes(1);
  });

  it("rejects automatic invocation before touching the seam or readiness gate", async () => {
    const reviewSeam = seam();
    const readinessCheck = vi.fn(async () => true);
    const controller = new AdversarialReviewReasoningReviewController(reviewSeam, { readinessCheck });

    await expect(
      controller.review({
        sessionId: "session-1",
        messageId: "message-1",
        sourceText: source,
        invocation: "automatic",
      }),
    ).resolves.toMatchObject({ status: "unavailable", invocation: "automatic", reviewedMessageId: "message-1" });
    expect(readinessCheck).not.toHaveBeenCalled();
    expect(reviewSeam.getCapability).not.toHaveBeenCalled();
    expect(reviewSeam.createContext).not.toHaveBeenCalled();
    expect(reviewSeam.runProver).not.toHaveBeenCalled();
    expect(reviewSeam.runVerifier).not.toHaveBeenCalled();
  });

  it("fails a stale-generation readiness check before creating a child context", async () => {
    const reviewSeam = seam();
    const readinessCheck = vi.fn(async () => false);
    const controller = new AdversarialReviewReasoningReviewController(reviewSeam, { readinessCheck });

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source }),
    ).resolves.toMatchObject({ status: "audit_failed", reviewedMessageId: "message-1" });
    expect(readinessCheck).toHaveBeenCalledTimes(1);
    expect(reviewSeam.getCapability).not.toHaveBeenCalled();
    expect(reviewSeam.createContext).not.toHaveBeenCalled();
  });

  it("revalidates readiness once for a manual review and never from getRuntime", async () => {
    const reviewSeam = seam();
    const readinessCheck = vi.fn(async () => true);
    const controller = new AdversarialReviewReasoningReviewController(reviewSeam, { readinessCheck });

    await controller.getRuntime();
    expect(readinessCheck).not.toHaveBeenCalled();
    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source }),
    ).resolves.toMatchObject({ status: "unresolved", invocation: "manual" });
    expect(readinessCheck).toHaveBeenCalledTimes(1);
    expect(reviewSeam.createContext).toHaveBeenCalledTimes(2);
  });

  it("fails closed before invoking the injected seam for an invalid packet", async () => {
    const reviewSeam = seam();
    const controller = new AdversarialReviewReasoningReviewController(reviewSeam);

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: "not a claim packet" }),
    ).resolves.toMatchObject({
      status: "unavailable",
      evidenceStatus: "not_required",
    });
    expect(reviewSeam.getCapability).not.toHaveBeenCalled();
    expect(reviewSeam.createContext).not.toHaveBeenCalled();
  });

  it("suppresses cancelled and superseded orchestration results", async () => {
    type ProverResult = Awaited<ReturnType<AdversarialReviewSeam["runProver"]>>;
    const first = deferred<ProverResult>();
    const second = deferred<ProverResult>();
    const reviewSeam = seam();
    vi.mocked(reviewSeam.runProver)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const controller = new AdversarialReviewReasoningReviewController(reviewSeam);

    const firstReview = controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });
    await vi.waitFor(() => expect(reviewSeam.runProver).toHaveBeenCalledTimes(1));

    const secondReview = controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });
    await vi.waitFor(() => expect(reviewSeam.runProver).toHaveBeenCalledTimes(2));

    first.resolve({
      ok: true,
      value: {
        proposalId: "proposal-1",
        prover: context("prover", "prover-id").provenance,
        objections: [],
      },
    });
    second.resolve({
      ok: true,
      value: {
        proposalId: "proposal-1",
        prover: context("prover", "prover-id").provenance,
        objections: [],
      },
    });

    await expect(firstReview).resolves.toMatchObject({ status: "unavailable" });
    await expect(secondReview).resolves.toMatchObject({ status: "conditional", reviewedMessageId: "message-1" });
    expect(reviewSeam.runVerifier).toHaveBeenCalledTimes(1);
  });
});

describe("ComposedReasoningReviewController", () => {
  it("keeps AF status authoritative and adds verified objections only as open challenges", async () => {
    const projection = claimProjection("conditional");
    const reviewSeam = seam();
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, testCompositionOptions());
    const stages: string[] = [];

    const result = await controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText: source,
      invocation: "manual",
      onProgress: (stage) => stages.push(stage),
    });

    expect(result.status).toBe("conditional");
    expect(result.evidenceStatus).toBe("source_recorded");
    expect(result.openChallenges).toEqual([
      { severity: "major", target: "claim:claim-conclusion", reason: "The objection remains open." },
    ]);
    expect(stages).toEqual(["claimProjection", "adversarialReview"]);
    expect(projection.project).toHaveBeenCalledTimes(1);
    expect(reviewSeam.runProver).toHaveBeenCalledTimes(1);
    expect(reviewSeam.runVerifier).toHaveBeenCalledTimes(1);
  });

  it("retains a valid AF claim result when prover/verifier work fails", async () => {
    const projection = claimProjection("structurally_checked");
    const reviewSeam = seam();
    vi.mocked(reviewSeam.runProver).mockResolvedValue({
      ok: false,
      failure: { status: "audit_failed", phase: "prover", reason: "model_failure" },
    });
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, testCompositionOptions());

    const result = await controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });

    expect(result.status).toBe("conditional");
    expect(result.evidenceStatus).toBe("source_recorded");
    expect(result.openChallenges).toEqual([]);
    expect(result.interpretiveBoundary).toContain("prover/verifier review did not complete");
  });

  it("preserves a successful AF projection when the reviewer seam unexpectedly throws", async () => {
    const projection = claimProjection("structurally_checked");
    const reviewSeam = seam();
    vi.mocked(reviewSeam.getCapability)
      .mockReturnValueOnce({ supported: true, attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION })
      .mockImplementationOnce(() => {
        throw new Error("PRIVATE_REVIEWER_FAILURE");
      });
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, testCompositionOptions());

    const result = await controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });

    expect(result.status).toBe("conditional");
    expect(result.evidenceStatus).toBe("source_recorded");
    expect(result.openChallenges).toEqual([]);
    expect(result.interpretiveBoundary).toContain("prover/verifier review did not complete");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REVIEWER_FAILURE");
  });

  it("does not invoke AF when completed-answer mapping is ordinary or unavailable", async () => {
    const projection = claimProjection("conditional");
    const reviewSeam = seam();
    const options = { ...testCompositionOptions(), mapCompletedAnswer: vi.fn(async () => undefined) };
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, options);

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: "A routine answer." }),
    ).resolves.toMatchObject({ status: "unavailable", evidenceStatus: "not_assessed", openChallenges: [] });
    expect(options.mapCompletedAnswer).toHaveBeenCalledTimes(1);
    expect(projection.project).not.toHaveBeenCalled();
    expect(reviewSeam.createContext).not.toHaveBeenCalled();
  });

  it("counts a pending answer-mapping stage inside the 60-second total review budget", async () => {
    vi.useFakeTimers();
    const projection = claimProjection("conditional");
    const reviewSeam = seam();
    let enteredMapping!: () => void;
    const mappingEntered = new Promise<void>((resolve) => {
      enteredMapping = resolve;
    });
    const options = {
      ...testCompositionOptions(),
      totalTimeoutMs: 100,
      mapCompletedAnswer: vi.fn(
        (_answer: string, signal: AbortSignal) =>
          new Promise<undefined>((resolve) => {
            enteredMapping();
            signal.addEventListener("abort", () => resolve(undefined), { once: true });
          }),
      ),
    };
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, options);
    const pending = controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });

    await mappingEntered;
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toMatchObject({ status: "unavailable", evidenceStatus: "not_assessed" });
    expect(projection.project).not.toHaveBeenCalled();
    expect(reviewSeam.createContext).not.toHaveBeenCalled();
  });

  it("cancels and cleans the hidden architect context when mapping is cancelled", async () => {
    let resolveStage!: (value: { ok: true; text: string }) => void;
    let enteredStage!: () => void;
    const stageEntered = new Promise<void>((resolve) => {
      enteredStage = resolve;
    });
    const reviewProvider = {
      createSession: vi.fn(async () => ({ ok: true as const, sessionId: "ses_manual_mapper" })),
      runStage: vi.fn(
        () =>
          new Promise<{ ok: true; text: string }>((resolve) => {
            resolveStage = resolve;
            enteredStage();
          }),
      ),
      cancel: vi.fn(async () => ({ ok: true as const })),
      delete: vi.fn(async () => ({ ok: true as const })),
    } as unknown as RestrictedReviewProvider;
    const adapter = createRestrictedReviewAdapter({ provider: reviewProvider, stageTimeoutMs: 30_000 });
    const cancelMappingContext = vi.spyOn(adapter, "cancelReasoningAssistContext");
    const mapper = createCompletedAnswerClaimMapper(adapter);
    const projection = claimProjection("conditional");
    const reviewSeam = seam();
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, {
      ...testCompositionOptions(),
      mapCompletedAnswer: mapper,
    });

    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    const pending = controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText: "A natural-language completed answer.",
    });
    await stageEntered;
    expect(hiddenSessionRegistry.liveCount()).toBe(1);
    controller.cancel("session-1", "message-1");

    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      conclusion: "This manual review was cancelled before completion.",
    });
    expect(cancelMappingContext).toHaveBeenCalledTimes(1);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    expect(projection.project).not.toHaveBeenCalled();

    resolveStage({ ok: true, text: JSON.stringify({ kind: "ordinary" }) });
    await Promise.resolve();
    expect(projection.project).not.toHaveBeenCalled();
  });

  it("returns unavailable without inventing AF status when the required reviewer is unavailable", async () => {
    const projection = claimProjection("conditional");
    const reviewSeam = seam();
    vi.mocked(reviewSeam.getCapability).mockReturnValue({ supported: false });
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, testCompositionOptions());

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source }),
    ).resolves.toMatchObject({
      reviewedMessageId: "message-1",
      status: "unavailable",
      evidenceStatus: "not_assessed",
      openChallenges: [],
    });
    expect(projection.project).not.toHaveBeenCalled();
    expect(reviewSeam.createContext).not.toHaveBeenCalled();
  });

  it("discards a claim projection that completes after explicit cancellation", async () => {
    const projectionResult = deferred<{ status: "conditional" }>();
    const projection: ClaimProjectionSeam = {
      getCapability: vi.fn(() => ({ supported: true as const, operation: "claim_projection" as const })),
      project: vi.fn(() => projectionResult.promise),
    };
    const reviewSeam = seam();
    const controller = new ComposedReasoningReviewController(projection, reviewSeam, testCompositionOptions());

    const pending = controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });
    await vi.waitFor(() => expect(projection.project).toHaveBeenCalledTimes(1));
    controller.cancel("session-1", "message-1");
    projectionResult.resolve({ status: "conditional" });

    await expect(pending).resolves.toMatchObject({
      reviewedMessageId: "message-1",
      status: "unavailable",
      conclusion: "This manual review was cancelled before completion.",
    });
    expect(reviewSeam.createContext).not.toHaveBeenCalled();
  });
});
