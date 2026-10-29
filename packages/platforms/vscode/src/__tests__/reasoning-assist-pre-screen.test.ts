import { describe, expect, it } from "vitest";
import { classifyReasoningAssistPreScreen } from "../vibefeld/reasoning-assist-pre-screen";

describe("reasoning-assist deterministic pre-screen", () => {
  it.each([
    "",
    "   \n\t",
    "...!?",
    "😀",
    "🙏🏽",
    "👋🏻!!!",
    "hello",
    "Hi there!",
    "GOOD MORNING",
    "thanks!",
    "Thank you.",
    "ok",
    "Got it!",
    "I see.",
    "nope",
  ])("classifies an obvious conversational turn as ordinary: %j", (text) => {
    expect(classifyReasoningAssistPreScreen(text)).toBe("ordinary");
  });

  it.each([
    "Is √2 rational?",
    "Prove 0.999… = 1",
    "√",
    "42",
    "?x",
    "Hi, can you explain why this works?",
    "Thanks, now prove the claim.",
    "Explain",
    "hi hi hi hi hi hi hi hi hi hi",
  ])("passes substantive or ambiguous text to the architect: %j", (text) => {
    expect(classifyReasoningAssistPreScreen(text)).toBe("maybe-argument");
  });

  it("does not use a length threshold", () => {
    const shortQuestion = "Is √2 rational?";
    const longQuestion = `${shortQuestion} ${"Please justify each step. ".repeat(100)}`;

    expect(classifyReasoningAssistPreScreen(shortQuestion)).toBe("maybe-argument");
    expect(classifyReasoningAssistPreScreen(longQuestion)).toBe("maybe-argument");
  });
});
