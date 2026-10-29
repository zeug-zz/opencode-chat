import { describe, expect, it } from "vitest";
import { formatReviewMarkdown } from "../../utils/format-review-markdown";

describe("formatReviewMarkdown", () => {
  it("formats only the supplied public fields and omits empty optional sections", () => {
    const review = {
      conclusion: "Conclusion",
      status: "Unresolved",
      evidence: "Unverified",
      assumptions: [],
      challenges: [],
      reviewedMessageId: "SECRET_MESSAGE_ID",
      rawAf: "SECRET_AF",
      modelContext: "SECRET_CONTEXT",
    };
    const markdown = formatReviewMarkdown(review, {
      title: "Argument review",
      status: "Status",
      evidence: "Evidence",
      assumptions: "Assumptions",
      challenges: "Open challenges",
      limits: "Review limits",
    });
    expect(markdown).toBe("## Argument review\n\nConclusion\n\n**Status:** Unresolved\n\n**Evidence:** Unverified");
    expect(markdown).not.toContain("SECRET");
  });

  it("includes assumptions, challenges, and limits", () => {
    expect(
      formatReviewMarkdown(
        {
          conclusion: "C",
          status: "Blocked",
          evidence: "Conflicted",
          assumptions: ["A"],
          challenges: [{ severity: "Major", target: "claim:c1", reason: "R" }],
          limits: "Review failed",
        },
        {
          title: "Review",
          status: "Status",
          evidence: "Evidence",
          assumptions: "Assumptions",
          challenges: "Open challenges",
          limits: "Review limits",
        },
      ),
    ).toContain("### Review limits\nReview failed");
  });
});
