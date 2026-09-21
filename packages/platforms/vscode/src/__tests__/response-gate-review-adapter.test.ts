import { describe, expect, it } from "vitest";
import {
  adaptReasoningReviewSummaryToDecision,
  mapResponseGateReviewOutcome,
} from "../vibefeld/response-gate-review-adapter";

const summary = {
  reviewedMessageId: "message",
  status: "conditional" as const,
  invocation: "manual" as const,
  conclusion: "No bounded objection was confirmed.",
  assumptions: ["The stated assumptions hold."],
  evidenceStatus: "unverified" as const,
  openChallenges: [],
  interpretiveBoundary: "This is not source verification, truth, or formal proof.",
};

describe("private response-gate review adapter", () => {
  it("accepts an existing bounded reasoning-review summary", () => {
    expect(adaptReasoningReviewSummaryToDecision(summary, "message")).toEqual({
      ok: true,
      value: {
        kind: "approved",
        calibration: "conditional",
        summary: { ...summary, invocation: "automatic" },
      },
    });
  });

  it.each([
    ["malformed", null, "malformed", ""],
    ["provider artifact", { ...summary, artifactHandle: "provider-artifact" }, "unknown-field", "provider-artifact"],
    ["unsafe", { ...summary, conclusion: "secret: provider output" }, "malformed", "provider output"],
  ] as const)("rejects %s review material without echoing it", (_label, value, code, forbidden) => {
    const result = adaptReasoningReviewSummaryToDecision(value, "message");
    expect(result).toEqual({ ok: false, code });
    if (forbidden) expect(JSON.stringify(result)).not.toContain(forbidden);
  });

  it("rejects an ambiguous summary without guessing at its meaning", () => {
    const result = adaptReasoningReviewSummaryToDecision(
      {
        ...summary,
        openChallenges: Array.from({ length: 33 }, (_, index) => ({
          severity: "note" as const,
          target: `challenge-${index}`,
          reason: "bounded reason",
        })),
      },
      "message",
    );

    expect(result).toEqual({ ok: false, code: "ambiguous" });
  });

  it.each([
    ["unresolved", "failed"],
    ["refuted", "failed"],
    ["blocked", "failed"],
    ["unavailable", "failed"],
    ["structurally_checked", "failed"],
    ["audit_failed", "audit_failed"],
  ] as const)("maps valid %s outcomes to terminal %s", (status, state) => {
    const result = mapResponseGateReviewOutcome({ ...summary, status }, "message");
    expect(result).toMatchObject({ kind: "terminal", state });
  });

  it("maps evidence conflicts and bounded objections to non-releasable outcomes", () => {
    expect(mapResponseGateReviewOutcome({ ...summary, evidenceStatus: "conflicted" }, "message")).toMatchObject({
      kind: "terminal",
      state: "audit_failed",
    });
    expect(
      mapResponseGateReviewOutcome(
        {
          ...summary,
          status: "unresolved",
          openChallenges: [{ severity: "major", target: "claim-one", reason: "bounded objection" }],
        },
        "message",
      ),
    ).toMatchObject({ kind: "terminal", state: "failed" });
  });

  it.each([
    ["missing", null],
    ["malformed", { ...summary, assumptions: "not-an-array" }],
    ["unsafe", { ...summary, conclusion: "secret: do not expose" }],
    ["stale", { ...summary, reviewedMessageId: "old-message" }],
  ] as const)("rejects %s review data without producing a release outcome", (_label, value) => {
    const result = mapResponseGateReviewOutcome(value, "message");
    expect(result.kind).toBe("invalid");
    expect(JSON.stringify(result)).not.toContain("secret: do not expose");
  });
});
