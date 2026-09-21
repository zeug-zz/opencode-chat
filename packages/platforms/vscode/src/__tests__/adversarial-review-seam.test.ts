import { describe, expect, it, vi } from "vitest";
import { RESTRICTED_REVIEW_PERMISSION_ATTESTATION } from "../vibefeld/adversarial-review-contract";
import {
  createAdversarialReviewSeam,
  createUnsupportedAdversarialReviewSeam,
  type RestrictedReviewAdapter,
} from "../vibefeld/adversarial-review-seam";

const context = (role: "prover" | "verifier", identity: string, handle: string) => ({
  handle,
  provenance: { identity, role, contextNumber: role === "prover" ? 1 : 2 },
});

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

describe("adversarial review seam", () => {
  it("keeps the default unsupported without creating contexts or invoking delegates", async () => {
    const createContext = vi.fn();
    const seam = createUnsupportedAdversarialReviewSeam();

    expect(seam.getCapability()).toEqual({ supported: false });
    expect(await seam.createContext("prover")).toEqual({
      ok: false,
      failure: { status: "unavailable", phase: "prover", reason: "unsupported" },
    });
    expect(createContext).not.toHaveBeenCalled();
  });

  it("requires the exact attestation before exposing an injected adapter", async () => {
    const createContext = vi.fn(async (role: "prover" | "verifier") => context(role, `${role}-1`, `${role}-handle`));
    const adapter = {
      attestation: { ...RESTRICTED_REVIEW_PERMISSION_ATTESTATION, extra: true },
      createContext,
      runProver: vi.fn(),
      runVerifier: vi.fn(),
      cancelContext: vi.fn(),
    } satisfies RestrictedReviewAdapter;
    const seam = createAdversarialReviewSeam(adapter);

    expect(seam.getCapability()).toEqual({ supported: false });
    expect((await seam.createContext("prover")).ok).toBe(false);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("runs an explicitly attested role through typed private data only", async () => {
    const adapter: RestrictedReviewAdapter = {
      attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
      createContext: vi.fn(async (role) => context(role, `${role}-1`, `${role}-handle`)),
      runProver: vi.fn(async () => ({
        proposalId: "proposal-1",
        prover: context("prover", "prover-1", "prover-handle").provenance,
        objections: [],
      })),
      runVerifier: vi.fn(async () => ({
        verifier: context("verifier", "verifier-1", "verifier-handle").provenance,
        proposalId: "proposal-1",
        dispositions: [],
      })),
      cancelContext: vi.fn(),
    };
    const seam = createAdversarialReviewSeam(adapter);

    expect(seam.getCapability()).toMatchObject({ supported: true });
    expect((await seam.createContext("prover")).ok).toBe(true);
    expect((await seam.runProver(context("prover", "prover-1", "prover-handle"), packet)).ok).toBe(true);
    expect(adapter.runVerifier).not.toHaveBeenCalled();
  });

  it("normalizes unsafe, oversized, and ambiguous provider results without echoing them", async () => {
    const adapter: RestrictedReviewAdapter = {
      attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
      createContext: vi.fn(async (role) => context(role, `${role}-1`, `${role}-handle`)),
      runProver: vi.fn(async () => ({
        command: "do not expose",
        path: "private/path",
        prompt: "hidden prompt",
        prover: context("prover", "prover-1", "prover-handle").provenance,
        proposalId: "proposal-1",
        objections: [
          {
            objectionId: "objection-1",
            target: { kind: "claim", id: "claim-1" },
            severity: "major",
            reason: "x".repeat(257),
          },
        ],
      })),
      runVerifier: vi.fn(),
      cancelContext: vi.fn(),
    };
    const result = await createAdversarialReviewSeam(adapter).runProver(
      context("prover", "prover-1", "prover-handle"),
      packet,
    );

    expect(result).toEqual({ ok: false, failure: { status: "audit_failed", phase: "prover", reason: "malformed" } });
    expect(JSON.stringify(result)).not.toMatch(/command|path|prompt|private|hidden/);
  });

  it("normalizes provider exceptions and cleanup exceptions to bounded facts", async () => {
    const adapter: RestrictedReviewAdapter = {
      attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
      createContext: vi.fn(async (role) => context(role, `${role}-1`, `${role}-handle`)),
      runProver: vi.fn(async () => {
        throw new Error("provider payload, /private/path, hidden reasoning");
      }),
      runVerifier: vi.fn(),
      cancelContext: vi.fn(async () => {
        throw new Error("cleanup command /private/path");
      }),
    };
    const seam = createAdversarialReviewSeam(adapter);
    expect(await seam.runProver(context("prover", "prover-1", "prover-handle"), packet)).toEqual({
      ok: false,
      failure: { status: "audit_failed", phase: "prover", reason: "model_failure" },
    });
    expect(await seam.cancelContext(context("prover", "prover-1", "prover-handle"))).toEqual({
      status: "audit_failed",
      phase: "prover",
      reason: "cleanup",
    });
    expect(JSON.stringify(await seam.cancelContext(context("prover", "prover-1", "prover-handle")))).not.toMatch(
      /command|private|reasoning/,
    );
  });
});
