import { describe, expect, it } from "vitest";
import { resolveAutomaticRoutingActivation } from "../vibefeld/automatic-routing-activation";

const preference = { userEnabled: true, workspaceOptOut: false };
const qualified = {
  version: "automatic-routing-evaluation-1",
  corpusId: "fixture",
  caseCount: 100,
  p95LatencyMs: 1,
  expectedCalibrationError: 0,
  falseChallengeRate: 0,
  qualified: true,
};

describe("resolveAutomaticRoutingActivation", () => {
  it("keeps qualified evidence only when it validates", () => {
    expect(
      resolveAutomaticRoutingActivation({ preference, runtime: { state: "available" }, evaluation: qualified }),
    ).toEqual({ enabled: true, evaluation: qualified });
  });

  it.each([undefined, null, "evaluation", { ...qualified, qualified: false }, { ...qualified, caseCount: 99 }])(
    "omits unqualified or malformed evidence (%j)",
    (evaluation) => {
      expect(resolveAutomaticRoutingActivation({ preference, runtime: { state: "available" }, evaluation })).toEqual({
        enabled: true,
      });
    },
  );

  it.each([
    [{ userEnabled: false, workspaceOptOut: false }, "available"],
    [{ userEnabled: true, workspaceOptOut: true }, "available"],
    [preference, "unavailable"],
    [preference, "checking"],
    [preference, "incompatible"],
    [preference, undefined],
  ] as const)("disables routing for preference/runtime gate %j", (disabledPreference, state) => {
    expect(
      resolveAutomaticRoutingActivation({
        preference: disabledPreference,
        runtime: state && { state },
        evaluation: qualified,
      }),
    ).toEqual({
      enabled: false,
      evaluation: qualified,
    });
  });
});
