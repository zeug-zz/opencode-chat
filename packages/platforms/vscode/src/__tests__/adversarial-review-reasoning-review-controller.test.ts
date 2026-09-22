import { describe, expect, it, vi } from "vitest";
import {
  RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
  type ReviewContextMetadata,
} from "../vibefeld/adversarial-review-contract";
import { AdversarialReviewReasoningReviewController } from "../vibefeld/adversarial-review-reasoning-review-controller";
import type { AdversarialReviewSeam } from "../vibefeld/adversarial-review-seam";

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
