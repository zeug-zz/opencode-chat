import { describe, expect, it, vi } from "vitest";
import type { ReviewContextMetadata } from "../vibefeld/adversarial-review-contract";
import { RESTRICTED_REVIEW_PERMISSION_ATTESTATION } from "../vibefeld/adversarial-review-contract";
import { createAdversarialReviewOrchestrator } from "../vibefeld/adversarial-review-orchestrator";
import type { AdversarialReviewSeam } from "../vibefeld/adversarial-review-seam";

const source = "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.";

const context = (role: "prover" | "verifier", identity: string, handle: string): ReviewContextMetadata => ({
  handle: handle as ReviewContextMetadata["handle"],
  provenance: { identity, role, contextNumber: role === "prover" ? 1 : 2 },
});

function seam(overrides: Partial<AdversarialReviewSeam> = {}): AdversarialReviewSeam {
  const prover = context("prover", "prover-identity", "prover-handle");
  const verifier = context("verifier", "verifier-identity", "verifier-handle");
  return {
    getCapability: () => ({ supported: true, attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION }),
    createContext: vi.fn(async (role) => ({ ok: true as const, value: role === "prover" ? prover : verifier })),
    runProver: vi.fn(async () => ({
      ok: true as const,
      value: { proposalId: "proposal-1", prover: prover.provenance, objections: [] },
    })),
    runVerifier: vi.fn(async () => ({
      ok: true as const,
      value: { verifier: verifier.provenance, proposalId: "proposal-1", dispositions: [] },
    })),
    cancelContext: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("AdversarialReviewOrchestrator", () => {
  it("compiles first and runs prover before a distinct verifier with bounded inputs", async () => {
    const calls: string[] = [];
    const reviewSeam = seam({
      createContext: vi.fn(async (role) => {
        calls.push(`create:${role}`);
        return { ok: true as const, value: context(role, `${role}-identity`, `${role}-handle`) };
      }),
      runProver: vi.fn(async (_context, packet) => {
        calls.push("prover");
        expect(packet).toMatchObject({
          packetId: "review-packet",
          conclusionId: "claim-1",
          evidenceStatus: "not_required",
        });
        expect(packet).not.toHaveProperty("sourceText");
        return {
          ok: true as const,
          value: {
            proposalId: "proposal-1",
            prover: context("prover", "prover-identity", "prover-handle").provenance,
            objections: [],
          },
        };
      }),
      runVerifier: vi.fn(async (_context, packet, proposal) => {
        calls.push("verifier");
        expect(packet).toHaveProperty("claims");
        expect(proposal).toEqual({
          proposalId: "proposal-1",
          prover: { identity: "prover-identity", role: "prover", contextNumber: 1 },
          objections: [],
        });
        return {
          ok: true as const,
          value: {
            verifier: context("verifier", "verifier-identity", "verifier-handle").provenance,
            proposalId: "proposal-1",
            dispositions: [],
          },
        };
      }),
    });

    const result = await createAdversarialReviewOrchestrator(reviewSeam).review(source);

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["create:prover", "prover", "create:verifier", "verifier"]);
    expect(reviewSeam.cancelContext).toHaveBeenCalledTimes(2);
    expect(reviewSeam.cancelContext).toHaveBeenNthCalledWith(1, expect.objectContaining({ handle: "verifier-handle" }));
    expect(reviewSeam.cancelContext).toHaveBeenNthCalledWith(2, expect.objectContaining({ handle: "prover-handle" }));
  });

  it("rejects reused context or provenance before verifier execution", async () => {
    const runVerifier = vi.fn();
    const reviewSeam = seam({
      createContext: vi.fn(async (role) => ({
        ok: true as const,
        value: context(role, "same-identity", "same-handle"),
      })),
      runVerifier,
    });

    await expect(createAdversarialReviewOrchestrator(reviewSeam).review(source)).resolves.toEqual({
      ok: false,
      failure: { status: "audit_failed", phase: "verifier", reason: "provenance" },
    });
    expect(runVerifier).not.toHaveBeenCalled();
  });

  it("propagates cancellation and cancels the created prover context without retrying", async () => {
    const caller = new AbortController();
    let proverSignal!: AbortSignal;
    const reviewSeam = seam({
      runProver: vi.fn((_context, _packet, signal) => {
        proverSignal = signal;
        return new Promise(() => undefined);
      }),
    });
    const review = createAdversarialReviewOrchestrator(reviewSeam).review(source, caller.signal);
    await vi.waitFor(() => expect(reviewSeam.runProver).toHaveBeenCalled());
    caller.abort();

    await expect(review).resolves.toMatchObject({ ok: false, failure: { reason: "cancelled" } });
    expect(proverSignal.aborted).toBe(true);
    expect(reviewSeam.createContext).toHaveBeenCalledTimes(1);
    expect(reviewSeam.cancelContext).toHaveBeenCalledWith(expect.objectContaining({ handle: "prover-handle" }));
  });

  it("times out a stalled stage and does not retry through another authority", async () => {
    const reviewSeam = seam({
      createContext: vi.fn(async () => new Promise<never>(() => undefined)),
    });

    await expect(createAdversarialReviewOrchestrator(reviewSeam, { timeoutMs: 10 }).review(source)).resolves.toEqual({
      ok: false,
      failure: { status: "unavailable", phase: "host", reason: "timeout" },
    });
    expect(reviewSeam.createContext).toHaveBeenCalledTimes(1);
    expect(reviewSeam.runProver).not.toHaveBeenCalled();
    expect(reviewSeam.runVerifier).not.toHaveBeenCalled();
  });

  it("reports cleanup failure as audit-failed rather than accepting a cancelled review", async () => {
    const caller = new AbortController();
    let proverSignal!: AbortSignal;
    const reviewSeam = seam({
      runProver: vi.fn((_context, _packet, signal) => {
        proverSignal = signal;
        return new Promise(() => undefined);
      }),
      cancelContext: vi.fn(async () => ({
        status: "audit_failed" as const,
        phase: "prover" as const,
        reason: "cleanup" as const,
      })),
    });
    const review = createAdversarialReviewOrchestrator(reviewSeam).review(source, caller.signal);
    await vi.waitFor(() => expect(reviewSeam.runProver).toHaveBeenCalled());
    caller.abort();

    await expect(review).resolves.toEqual({
      ok: false,
      failure: { status: "audit_failed", phase: "prover", reason: "cleanup" },
    });
    expect(proverSignal.aborted).toBe(true);
  });
});
