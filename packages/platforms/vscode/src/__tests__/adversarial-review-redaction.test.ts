import { describe, expect, it } from "vitest";
import { redactReviewReason } from "../vibefeld/adversarial-review-redaction";

describe("redactReviewReason", () => {
  it.each([
    ["/Users/zeug/Projects/opencode-chat/AGENTS.md", "[redacted-path]"],
    ["C:\\Users\\me\\.ssh\\id_rsa", "[redacted-path]"],
    ["~/secrets/token", "[redacted-path]"],
    ["../../etc/passwd", "[redacted-path]"],
    ["https://example.com/a?token=abc", "[redacted-url]"],
    ["www.example.org/x", "[redacted-url]"],
    ["sk-12345678901234567890", "[redacted-secret]"],
    ["ghp_123456789012345678901234567890", "[redacted-secret]"],
    ["Bearer abc.def.ghi", "[redacted-secret]"],
    ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "[redacted-secret]"],
    ["0123456789abcdef0123456789abcdef0123456789abcdef", "[redacted-secret]"],
  ])("redacts %s", (sample, placeholder) => {
    const result = redactReviewReason(`Reason: ${sample}`);

    expect(result).toContain(placeholder);
    expect(result).not.toContain(sample);
  });

  it("preserves benign text and is idempotent", () => {
    const benign = "The conclusion depends on the stated assumption.";

    expect(redactReviewReason(benign)).toBe(benign);
    const once = redactReviewReason("See /Users/me/file.txt and https://example.com.");
    expect(redactReviewReason(once)).toBe(once);
  });

  it("collapses control characters and bounds hostile text after redaction", () => {
    const result = redactReviewReason(`${"hostile\n\t\u0000".repeat(100)} /Users/me/secret`);

    expect(
      [...result].some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x20 || (code >= 0x7f && code <= 0x9f);
      }),
    ).toBe(false);
    expect(result.length).toBeLessThanOrEqual(256);
    expect(redactReviewReason(result)).toBe(result);
  });
});
