import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_ROUTING_EVALUATION_TARGETS,
  measureAutomaticRoutingFixture,
  validateAutomaticRoutingEvaluation,
} from "../vibefeld/automatic-routing-evaluation";

const evidence = (overrides: Record<string, unknown> = {}) => ({
  version: "automatic-routing-evaluation-1",
  corpusId: "fixture-corpus",
  caseCount: 100,
  p95LatencyMs: 2_000,
  expectedCalibrationError: 0.1,
  falseChallengeRate: 0.05,
  qualified: true,
  ...overrides,
});

describe("automatic-routing evaluation", () => {
  it("qualifies exactly at every fixed target", () => {
    const result = validateAutomaticRoutingEvaluation(evidence());
    expect(result).toEqual({ ok: true, value: evidence() });
    expect(AUTOMATIC_ROUTING_EVALUATION_TARGETS.minimumCaseCount).toBe(100);
  });

  it.each([
    ["case count", { caseCount: 99 }],
    ["latency", { p95LatencyMs: 2_001 }],
    ["calibration", { expectedCalibrationError: 0.101 }],
    ["false challenges", { falseChallengeRate: 0.051 }],
  ])("fails closed when %s misses its target", (_, override) => {
    const result = validateAutomaticRoutingEvaluation({ ...evidence(override), qualified: false });
    expect(result).toEqual({ ok: true, value: { ...evidence(override), qualified: false } });
  });

  it("rejects malformed, unknown, non-finite, negative, over-limit, and inconsistent values", () => {
    expect(validateAutomaticRoutingEvaluation(null).ok).toBe(false);
    expect(validateAutomaticRoutingEvaluation({ ...evidence(), unsafe: "prompt" }).code).toBe("unknown-field");
    expect(validateAutomaticRoutingEvaluation(evidence({ p95LatencyMs: Number.NaN })).code).toBe("non-finite");
    expect(validateAutomaticRoutingEvaluation(evidence({ caseCount: -1, qualified: false })).code).toBe("negative");
    expect(validateAutomaticRoutingEvaluation(evidence({ falseChallengeRate: 2, qualified: false })).code).toBe(
      "over-limit",
    );
    expect(validateAutomaticRoutingEvaluation(evidence({ qualified: false })).code).toBe("inconsistent-qualification");
  });

  it("measures fixture cases into aggregate-only output without retaining raw content", () => {
    const cases = Array.from({ length: 100 }, () => ({
      latencyMs: 1_000,
      confidence: 1,
      correct: true,
      challenged: false,
      falseChallenge: false,
    }));
    const result = measureAutomaticRoutingFixture("fixture-corpus", cases);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.qualified).toBe(true);
      expect(Object.keys(result.value)).toEqual([
        "version",
        "corpusId",
        "caseCount",
        "p95LatencyMs",
        "expectedCalibrationError",
        "falseChallengeRate",
        "qualified",
      ]);
      expect(JSON.stringify(result)).not.toContain("prompt");
    }
  });
});
