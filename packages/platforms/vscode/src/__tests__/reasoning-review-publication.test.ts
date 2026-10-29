import { describe, expect, it } from "vitest";
import {
  normalizeReasoningReviewSummary,
  unavailableReasoningReviewSummary,
} from "../vibefeld/reasoning-review-publication";

describe("reasoning-review public summary boundary", () => {
  it("uses a calibrated conclusion for structurally checked results", () => {
    const result = normalizeReasoningReviewSummary({ status: "structurally_checked" }, "answer-1");
    expect(result.conclusion).toBe(
      "The argument structure was recorded; this does not establish that the conclusion follows or is true.",
    );
    expect(result.interpretiveBoundary).toContain(
      "Reviewers assessed a compressed argument map, not the full answer or cited sources; missing packet detail is not proof of an omission in the answer.",
    );
  });

  it("rebuilds summaries from bounded allowlisted fields and redacts reviewer wording", () => {
    const result = normalizeReasoningReviewSummary(
      {
        reviewedMessageId: "attacker-selected-id",
        status: "conditional",
        invocation: "automatic",
        conclusion: "raw model conclusion",
        assumptions: Array.from({ length: 10 }, (_, index) => `assumption ${index}`),
        evidenceStatus: "source_recorded",
        openChallenges: [
          {
            severity: "major",
            target: "claim:claim-1",
            reason: "See /Users/alice/private.txt at https://example.com and Bearer abcdefghijk.",
          },
          { severity: "critical", target: "/private/secret", reason: "bounded fallback target" },
          { severity: "note", target: "assumption:case_2", reason: "challenge three" },
          { severity: "minor", target: "claim:claim-4", reason: "challenge four" },
          { severity: "invalid", target: "claim:claim-5", reason: "discarded severity" },
        ],
        interpretiveBoundary: "provider text must not reach the webview",
        artifactHandle: "private-artifact-path",
        routing: { reasonCode: "model-internal" },
        prompt: "private child prompt",
      },
      "trusted-answer-id",
    );

    expect(result).toMatchObject({
      reviewedMessageId: "trusted-answer-id",
      status: "conditional",
      invocation: "manual",
      conclusion: "This conclusion depends on the stated assumption or unverified evidence.",
      evidenceStatus: "source_recorded",
      assumptions: [
        "assumption 0",
        "assumption 1",
        "assumption 2",
        "assumption 3",
        "assumption 4",
        "assumption 5",
        "assumption 6",
        "assumption 7",
      ],
    });
    expect(result.openChallenges).toHaveLength(3);
    expect(result.openChallenges.map(({ target }) => target)).toEqual([
      "claim:claim-1",
      "argument",
      "assumption:case_2",
    ]);
    expect(result.openChallenges[0]?.reason).not.toMatch(/\/Users\/alice|https?:\/\/|Bearer abcdefghijk/u);
    expect(result.openChallenges[0]?.reason).toContain("[redacted-path]");
    expect(result.openChallenges[0]?.reason).toContain("[redacted-url]");
    expect(result.openChallenges[0]?.reason).toContain("[redacted-secret]");
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
    expect(JSON.stringify(result)).not.toMatch(/provider text|private-artifact|private child prompt|raw model/u);
  });

  it("maps malformed summaries to a bounded unavailable result", () => {
    expect(normalizeReasoningReviewSummary({ status: "invented", evidenceStatus: "proven" }, "answer-1")).toEqual(
      unavailableReasoningReviewSummary("answer-1"),
    );
  });
});
