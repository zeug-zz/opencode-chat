import { describe, expect, it } from "vitest";
import type {
  ReasoningAssistAfFact,
  ReasoningAssistObjectionTarget,
  ReasoningAssistProgress,
  ReasoningAssistStage,
  ReasoningAssistSummary,
} from "..";

const forbiddenFields = [
  "providerId",
  "provider",
  "modelId",
  "model",
  "graphId",
  "claimId",
  "packet",
  "rawOutput",
  "hiddenPrompt",
  "sessionTitle",
  "filePath",
  "path",
  "command",
  "afPath",
  "ledger",
  "toolPayload",
  "credential",
  "privateReasoning",
];

describe("reasoning assist core contract", () => {
  it("accepts every dedicated lifecycle stage", () => {
    const stages: ReasoningAssistStage[] = ["assessing", "mapping", "recording", "critiquing", "preparing", "applied"];
    const progress = stages.map((stage) => ({ sessionId: "session-1", promptToken: "opaque-token", stage }));

    expect(progress.map(({ stage }) => stage)).toEqual(stages);
    expect(progress.every((item) => Object.keys(item).sort().join(",") === "promptToken,sessionId,stage")).toBe(true);
  });

  it("keeps the compact summary exact and display-safe", () => {
    const target: ReasoningAssistObjectionTarget = "assumption";
    const afFact: ReasoningAssistAfFact = "recorded_structure";
    const summary: ReasoningAssistSummary = {
      candidateConclusion: "The proposal is useful if its stated assumption holds.",
      assumptions: ["The input remains within the stated scope."],
      evidenceBoundary: "External evidence is not established here.",
      criticObjections: [{ target, objection: "The key assumption may not hold in every case." }],
      afFact,
    };

    expect(Object.keys(summary).sort()).toEqual([
      "afFact",
      "assumptions",
      "candidateConclusion",
      "criticObjections",
      "evidenceBoundary",
    ]);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    for (const field of forbiddenFields) {
      expect(summary).not.toHaveProperty(field);
    }
    expect(JSON.stringify(summary)).not.toMatch(/path|command|packet|provider|model|ledger|credential|reasoning/i);
  });

  it("keeps progress free of private or provider-specific data", () => {
    const progress: ReasoningAssistProgress = {
      sessionId: "session-1",
      promptToken: "opaque-token",
      stage: "preparing",
    };

    expect(JSON.parse(JSON.stringify(progress))).toEqual(progress);
    for (const field of forbiddenFields) {
      expect(progress).not.toHaveProperty(field);
    }
    expect(JSON.stringify(progress)).not.toMatch(/path|command|packet|provider|model|ledger|credential|reasoning/i);
  });
});
