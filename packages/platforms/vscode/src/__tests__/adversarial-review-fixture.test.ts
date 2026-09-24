import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapAdversarialReviewToSummary } from "../vibefeld/adversarial-review-mapper";
import { createAdversarialReviewOrchestrator } from "../vibefeld/adversarial-review-orchestrator";
import { createAdversarialReviewSeam } from "../vibefeld/adversarial-review-seam";
import { normalizeEvidenceReferences } from "../vibefeld/evidence-metadata";
import { createFixtureOnlyAdversarialReviewAdapter } from "../vibefeld/fixture-adversarial-review-seam";

const source = [
  "CONCLUSION: claim-conclusion",
  "CLAIM: claim-premise|empirical|A bounded observation is recorded.",
  "CLAIM: claim-conclusion|deductive|The conclusion follows from the premise.",
  "ASSUMPTION: assumption-1|claim-conclusion|The premise applies to this case.",
  "DEPENDS: edge-1|claim-conclusion|claim-premise",
  "EVIDENCE: evidence-1|claim-premise|observation|source_recorded",
].join("\n");

const declaration = (behavior: string): Record<string, unknown> => ({
  fixtureId: "adversarial-fixture",
  fixtureVersion: "v1",
  behavior,
});

async function review(behavior: string, signal?: AbortSignal) {
  const adapter = createFixtureOnlyAdversarialReviewAdapter(declaration(behavior));
  expect(adapter).toBeDefined();
  return createAdversarialReviewOrchestrator(createAdversarialReviewSeam(adapter as NonNullable<typeof adapter>), {
    timeoutMs: 10,
  }).review(source, signal);
}

describe("test-only adversarial review fixtures", () => {
  it("runs distinct prover and verifier roles and confirms a bounded objection", async () => {
    const result = await review("confirmed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prover.context.provenance.identity).not.toBe(result.value.verifier.context.provenance.identity);
    const summary = mapAdversarialReviewToSummary({
      reviewedMessageId: "message-1",
      evidence: normalizeEvidenceReferences([
        {
          id: "evidence-1",
          claimId: "claim-premise",
          metadata: { sourceKind: "observation", status: "source_recorded" },
        },
      ]),
      outcome: result,
    });
    expect(summary.status).toBe("unresolved");
    expect(summary.openChallenges).toHaveLength(1);
  });

  it("keeps rejected objections conditional and preserves evidence conflict", async () => {
    const result = await review("rejected");
    expect(result.ok).toBe(true);
    const summary = mapAdversarialReviewToSummary({
      reviewedMessageId: "message-1",
      evidence: normalizeEvidenceReferences([
        {
          id: "evidence-1",
          claimId: "claim-premise",
          metadata: { sourceKind: "observation", status: "source_recorded", conflictGroup: "group-1" },
        },
        {
          id: "evidence-2",
          claimId: "claim-premise",
          metadata: { sourceKind: "citation", status: "unverified", conflictGroup: "group-1" },
        },
      ]),
      outcome: result,
    });
    expect(summary.status).toBe("unresolved");
    expect(summary.evidenceStatus).toBe("conflicted");
    expect(summary.openChallenges).toEqual([]);
    expect(summary.conclusion).not.toMatch(/truth|proved/i);
  });

  it.each([
    ["model_failure", "model_failure"],
    ["timeout", "timeout"],
  ] as const)("maps fixture %s to a bounded failure", async (behavior, reason) => {
    const result = await review(behavior);
    expect(result).toEqual({
      ok: false,
      failure: {
        status: behavior === "model_failure" ? "audit_failed" : "unavailable",
        phase: behavior === "model_failure" ? "prover" : "host",
        reason,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture|payload|path|command|prompt/);
  });

  it("propagates fixture cancellation and cleans up without publishing a late result", async () => {
    const caller = new AbortController();
    const resultPromise = review("cancelled", caller.signal);
    caller.abort();
    await expect(resultPromise).resolves.toEqual({
      ok: false,
      failure: { status: "unavailable", phase: "host", reason: "cancelled" },
    });
  });

  it.each(["malformed", "oversized", "provenance"] as const)(
    "rejects fixture adapter %s output before publication",
    async (kind) => {
      const base = createFixtureOnlyAdversarialReviewAdapter(declaration("confirmed"));
      expect(base).toBeDefined();
      const adapter = {
        ...base,
        ...(kind === "provenance"
          ? {
              createContext: async () => ({
                handle: "same",
                provenance: { identity: "same", role: "prover", contextNumber: 1 },
              }),
            }
          : {
              runProver: async () =>
                kind === "oversized"
                  ? {
                      proposalId: "fixture-proposal",
                      prover: { identity: "prover-fixture-identity", role: "prover", contextNumber: 1 },
                      objections: [
                        {
                          objectionId: "fixture-objection",
                          target: { kind: "claim", id: "claim-conclusion" },
                          severity: "major",
                          reason: "x".repeat(257),
                        },
                      ],
                    }
                  : { malformed: true },
            }),
      };
      const result = await createAdversarialReviewOrchestrator(
        createAdversarialReviewSeam(adapter as NonNullable<typeof base>),
      ).review(source);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/private|payload|command|path|prompt|same|x{20}/);
    },
  );

  it("rejects unsanitized fixture declarations without echoing them", () => {
    const raw = "private fixture payload";
    expect(createFixtureOnlyAdversarialReviewAdapter({ ...declaration("confirmed"), raw })).toBeUndefined();
    expect(
      createFixtureOnlyAdversarialReviewAdapter({ ...declaration("confirmed"), fixtureVersion: raw.repeat(1000) }),
    ).toBeUndefined();
  });

  it("keeps the fixture seam dormant and free of execution or workspace dependencies", () => {
    const fixtureSource = readFileSync(
      new URL("../vibefeld/fixture-adversarial-review-seam.ts", import.meta.url),
      "utf8",
    );
    const extensionSource = readFileSync(new URL("../extension.ts", import.meta.url), "utf8");
    expect(fixtureSource).toContain("TEST-ONLY");
    expect(fixtureSource).not.toMatch(/(?:child_process|spawn\(|fetch\(|exec\(|shell)/u);
    expect(extensionSource).not.toContain("fixture-adversarial-review-seam");
    expect(extensionSource).not.toContain("createFixtureOnlyAdversarialReviewAdapter");
  });
});
