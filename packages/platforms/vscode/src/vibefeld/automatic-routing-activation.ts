import type { ReasoningReviewRuntime } from "@opencode-chat/core";
import { type AutomaticRoutingEvaluation, validateAutomaticRoutingEvaluation } from "./automatic-routing-evaluation";
import { resolveEffectiveVibefeldEnabled, type VibefeldPreference } from "./vibefeld-settings";

export type AutomaticRoutingActivation = Readonly<{
  enabled: boolean;
  evaluation?: AutomaticRoutingEvaluation;
}>;

/**
 * Resolve the host-private automatic-routing gate without accepting any
 * unvalidated evaluation evidence. Qualification is deliberately the only
 * evaluation state that crosses this boundary.
 */
export function resolveAutomaticRoutingActivation(input: {
  preference: VibefeldPreference;
  runtime: ReasoningReviewRuntime | { state: ReasoningReviewRuntime["state"] } | undefined;
  evaluation?: unknown;
}): AutomaticRoutingActivation {
  const validation = validateAutomaticRoutingEvaluation(input.evaluation);
  return {
    enabled: resolveEffectiveVibefeldEnabled(input.preference, input.runtime),
    ...(validation.ok && validation.value.qualified ? { evaluation: validation.value } : {}),
  };
}
