import { describe, expect, it } from "vitest";
import { type AutomaticRoutingPolicyInput, selectAutomaticRouting } from "../vibefeld/automatic-routing-policy";

const evaluation = {
  version: "automatic-routing-evaluation-1",
  corpusId: "fixture-corpus",
  caseCount: 100,
  p95LatencyMs: 2_000,
  expectedCalibrationError: 0.1,
  falseChallengeRate: 0.05,
  qualified: true,
};

const input = (overrides: Partial<AutomaticRoutingPolicyInput> = {}): AutomaticRoutingPolicyInput => ({
  enabled: true,
  runtime: "available",
  evaluation,
  workMode: "scout",
  requestClass: "argument",
  response: { sessionId: "active", activeSessionId: "active", role: "assistant", completion: "completed" },
  signals: { evidenceDependent: true, multiStepArgument: true, highImpactRecommendation: false },
  ...overrides,
});

describe("automatic-routing policy", () => {
  it.each([
    [
      "argument",
      {
        requestClass: "argument",
        signals: { evidenceDependent: false, multiStepArgument: true, highImpactRecommendation: true },
      },
    ],
    [
      "evidence",
      {
        requestClass: "evidence",
        signals: { evidenceDependent: true, multiStepArgument: false, highImpactRecommendation: true },
      },
    ],
    [
      "recommendation",
      {
        requestClass: "recommendation",
        signals: { evidenceDependent: true, multiStepArgument: true, highImpactRecommendation: true },
      },
    ],
  ])("selects eligible %s fixtures", (_, overrides) => {
    expect(selectAutomaticRouting(input(overrides))).toMatchObject({ selected: true });
  });

  it("uses a stable reason priority when several signals apply", () => {
    expect(
      selectAutomaticRouting(
        input({ signals: { evidenceDependent: true, multiStepArgument: true, highImpactRecommendation: true } }),
      ),
    ).toEqual({
      selected: true,
      reasonCode: "evidence_dependent",
      summary: "Evidence-dependent response",
    });
  });

  it.each(["lookup", "translation", "creative", "coding", "shell", "worker", "unsupported"])(
    "skips ordinary request class %s",
    (requestClass) =>
      expect(selectAutomaticRouting(input({ requestClass }))).toEqual({ selected: false, reason: "ordinary_work" }),
  );

  it.each([
    ["disabled", { enabled: false }, "disabled"],
    ["unavailable runtime", { runtime: "unavailable" }, "runtime_unavailable"],
    ["incompatible runtime", { runtime: "incompatible" }, "runtime_unavailable"],
    ["unqualified evaluation", { evaluation: { ...evaluation, qualified: false } }, "evaluation_unqualified"],
    ["unsupported mode", { workMode: "write" }, "unsupported_work_mode"],
    [
      "incomplete response",
      { response: { sessionId: "active", activeSessionId: "active", role: "assistant", completion: "streaming" } },
      "incomplete_response",
    ],
    [
      "inactive session",
      { response: { sessionId: "other", activeSessionId: "active", role: "assistant", completion: "completed" } },
      "inactive_session",
    ],
    [
      "empty signals",
      { signals: { evidenceDependent: false, multiStepArgument: false, highImpactRecommendation: false } },
      "insufficient_signals",
    ],
  ] as const)("fails closed for %s", (_, overrides, reason) => {
    expect(selectAutomaticRouting(input(overrides))).toEqual({ selected: false, reason });
  });

  it("requires two independent signals and returns only bounded static data", () => {
    expect(
      selectAutomaticRouting(
        input({ signals: { evidenceDependent: true, multiStepArgument: false, highImpactRecommendation: false } }),
      ),
    ).toEqual({
      selected: false,
      reason: "insufficient_signals",
    });
    const result = selectAutomaticRouting(input());
    expect(JSON.stringify(result)).not.toContain("active");
    expect(JSON.stringify(result)).not.toContain("prompt");
    expect(JSON.stringify(result)).not.toContain("source");
  });

  it("rejects malformed and raw-data-shaped input without echoing it", () => {
    expect(selectAutomaticRouting({ ...input(), request: "private prompt" })).toEqual({
      selected: false,
      reason: "malformed_input",
    });
    expect(
      selectAutomaticRouting({
        ...input(),
        signals: { evidenceDependent: true, multiStepArgument: true, highImpactRecommendation: false, text: "raw" },
      }),
    ).toEqual({
      selected: false,
      reason: "malformed_input",
    });
  });
});
