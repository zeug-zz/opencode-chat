import { RESTRICTED_REVIEW_PERMISSION_ATTESTATION } from "./adversarial-review-contract";
import type { RestrictedReviewAdapter } from "./adversarial-review-seam";

/**
 * TEST-ONLY: deterministic adapter declarations contain no provider, process,
 * workspace, or user configuration data. This module must stay out of
 * activation and production extension construction.
 */
export type FixtureAdversarialReviewBehavior = "confirmed" | "rejected" | "model_failure" | "timeout" | "cancelled";

export type FixtureAdversarialReviewDeclaration = Readonly<{
  fixtureId: string;
  fixtureVersion: string;
  behavior: FixtureAdversarialReviewBehavior;
}>;

const FIXTURE_MARKER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const BEHAVIORS: readonly FixtureAdversarialReviewBehavior[] = [
  "confirmed",
  "rejected",
  "model_failure",
  "timeout",
  "cancelled",
];

function isDeclaration(value: unknown): value is FixtureAdversarialReviewDeclaration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    Object.keys(record).every((key) => ["fixtureId", "fixtureVersion", "behavior"].includes(key)) &&
    typeof record.fixtureId === "string" &&
    FIXTURE_MARKER.test(record.fixtureId) &&
    typeof record.fixtureVersion === "string" &&
    FIXTURE_MARKER.test(record.fixtureVersion) &&
    BEHAVIORS.includes(record.behavior as FixtureAdversarialReviewBehavior)
  );
}

const context = (role: "prover" | "verifier") => ({
  handle: `${role}-fixture-handle`,
  provenance: { identity: `${role}-fixture-identity`, role, contextNumber: role === "prover" ? 1 : 2 },
});

const pending = (): Promise<never> => new Promise(() => undefined);

/** Returns a bounded, deterministic adapter, or undefined for unsanitized fixtures. */
export function createFixtureOnlyAdversarialReviewAdapter(declaration: unknown): RestrictedReviewAdapter | undefined {
  if (!isDeclaration(declaration)) return undefined;

  return {
    attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
    createContext: async (role) => context(role),
    runProver: async (_context, _packet, signal) => {
      if (declaration.behavior === "model_failure") throw new Error("fixture model failure");
      if (declaration.behavior === "timeout") return pending();
      if (declaration.behavior === "cancelled")
        return new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("fixture cancelled")), { once: true });
        });
      return {
        proposalId: "fixture-proposal",
        prover: context("prover").provenance,
        objections: [
          {
            objectionId: "fixture-objection",
            target: { kind: "claim" as const, id: "claim-conclusion" },
            severity: "major" as const,
            reason: "The bounded conclusion depends on an explicit assumption.",
          },
        ],
      };
    },
    runVerifier: async (_context, _packet, _proposal) => ({
      verifier: context("verifier").provenance,
      proposalId: "fixture-proposal",
      dispositions: [
        {
          objectionId: "fixture-objection",
          disposition: declaration.behavior === "confirmed" ? ("confirmed" as const) : ("rejected" as const),
          reason: "The bounded objection was evaluated under the fixture assumptions.",
        },
      ],
    }),
    cancelContext: async () => undefined,
  };
}
