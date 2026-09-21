import { describe, expect, it } from "vitest";

import type { ReasoningReviewSourceInput } from "../vibefeld/reasoning-review-source-packet";
import {
  buildReasoningReviewSourcePacket,
  REASONING_REVIEW_SOURCE_MAX_CHARS,
} from "../vibefeld/reasoning-review-source-packet";

const assistantMessage = (
  parts: Array<{ type: string; text?: unknown; ignored?: unknown; [key: string]: unknown }>,
  role: "assistant" | "user" = "assistant",
): ReasoningReviewSourceInput => ({
  info: {
    id: "message-1",
    role,
    sessionID: "session-1",
    time: { created: 1, completed: 2 },
    tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 0, write: 0 } },
    prompt: "private prompt must never be read",
    metadata: { secret: "private message metadata" },
  },
  parts,
});

describe("buildReasoningReviewSourcePacket", () => {
  it("includes ordinary visible text parts in their original order", () => {
    const message = assistantMessage([
      { type: "text", text: "first" },
      { type: "step-start", snapshot: "private snapshot" },
      { type: "text", text: " second" },
    ]);

    expect(buildReasoningReviewSourcePacket(message)).toBe("first second");
  });

  it("excludes ignored text and non-text data without serializing parts", () => {
    const message = assistantMessage([
      { type: "text", text: "visible" },
      { type: "text", text: "hidden reasoning", ignored: true, metadata: { secret: "ignored" } },
      { type: "reasoning", text: "private reasoning" },
      {
        type: "tool",
        state: { status: "completed", input: "private input", output: "private output" },
        metadata: { secret: "tool metadata" },
      },
      { type: "file", filename: "private.txt", url: "file:///private.txt" },
      { type: "subtask", prompt: "private subtask prompt", input: { secret: "private" } },
      { type: "permission", metadata: { secret: "permission metadata" } },
    ]);

    const source = buildReasoningReviewSourcePacket(message);

    expect(source).toBe("visible");
    for (const excluded of [
      "hidden reasoning",
      "private reasoning",
      "private input",
      "private output",
      "private.txt",
      "private subtask prompt",
      "permission metadata",
      "private message metadata",
      "private prompt must never be read",
    ]) {
      expect(source).not.toContain(excluded);
    }
  });

  it("returns an exact deterministic prefix at the source boundary", () => {
    const first = "a".repeat(REASONING_REVIEW_SOURCE_MAX_CHARS - 1);
    const message = assistantMessage([
      { type: "text", text: first },
      { type: "text", text: "bc" },
    ]);

    expect(buildReasoningReviewSourcePacket(message)).toBe(`${first}b`);
    expect(buildReasoningReviewSourcePacket(message)).toHaveLength(REASONING_REVIEW_SOURCE_MAX_CHARS);
  });

  it("does not extract text from a non-assistant message", () => {
    const message = assistantMessage([{ type: "text", text: "must not be included" }], "user");

    expect(buildReasoningReviewSourcePacket(message)).toBe("");
  });
});
