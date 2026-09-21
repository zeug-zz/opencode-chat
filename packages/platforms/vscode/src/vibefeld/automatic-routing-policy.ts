import type {
  ReasoningReviewRoutingReasonCode,
  ReasoningReviewRoutingSummary,
  ReasoningReviewRuntimeState,
} from "@opencode-chat/core";
import { type AutomaticRoutingEvaluation, validateAutomaticRoutingEvaluation } from "./automatic-routing-evaluation";

export type AutomaticRoutingWorkMode = "scout";
export type AutomaticRoutingRequestClass =
  | "argument"
  | "evidence"
  | "recommendation"
  | "lookup"
  | "translation"
  | "creative"
  | "coding"
  | "shell"
  | "worker"
  | "unsupported";

export type AutomaticRoutingStructuralSignals = Readonly<{
  evidenceDependent: boolean;
  multiStepArgument: boolean;
  highImpactRecommendation: boolean;
}>;

export type AutomaticRoutingPolicyInput = Readonly<{
  enabled: boolean;
  runtime: ReasoningReviewRuntimeState;
  evaluation: unknown;
  workMode: AutomaticRoutingWorkMode | string;
  requestClass: AutomaticRoutingRequestClass | string;
  response: Readonly<{
    sessionId: string;
    activeSessionId: string;
    role: "assistant" | string;
    completion: "completed" | string;
  }>;
  signals: AutomaticRoutingStructuralSignals;
}>;

export type AutomaticRoutingNonSelectionReason =
  | "disabled"
  | "runtime_unavailable"
  | "evaluation_unqualified"
  | "malformed_input"
  | "unsupported_work_mode"
  | "ordinary_work"
  | "incomplete_response"
  | "inactive_session"
  | "insufficient_signals";

export type AutomaticRoutingSelection = Readonly<{
  selected: true;
  reasonCode: ReasoningReviewRoutingReasonCode;
  summary: ReasoningReviewRoutingSummary;
}>;

export type AutomaticRoutingNonSelection = Readonly<{
  selected: false;
  reason: AutomaticRoutingNonSelectionReason;
}>;

export type AutomaticRoutingPolicyDecision = AutomaticRoutingSelection | AutomaticRoutingNonSelection;

const APPROVED_KEYS = ["evidenceDependent", "multiStepArgument", "highImpactRecommendation"] as const;
const MAX_STRUCTURAL_ID_LENGTH = 256;
const SUPPORTED_WORK_MODE = "scout";
const ORDINARY_REQUESTS = new Set(["lookup", "translation", "creative", "coding", "shell", "worker", "unsupported"]);

const REASONS: readonly Readonly<{
  signal: keyof AutomaticRoutingStructuralSignals;
  code: ReasoningReviewRoutingReasonCode;
  summary: ReasoningReviewRoutingSummary;
}>[] = [
  { signal: "evidenceDependent", code: "evidence_dependent", summary: "Evidence-dependent response" },
  { signal: "multiStepArgument", code: "multi_step_argument", summary: "Multi-step argument" },
  { signal: "highImpactRecommendation", code: "high_impact_recommendation", summary: "High-impact recommendation" },
];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRUCTURAL_ID_LENGTH;
}

function validInput(value: unknown): value is AutomaticRoutingPolicyInput {
  if (
    !record(value) ||
    !exactKeys(value, ["enabled", "runtime", "evaluation", "workMode", "requestClass", "response", "signals"])
  )
    return false;
  if (typeof value.enabled !== "boolean" || typeof value.runtime !== "string") return false;
  if (!record(value.response) || !exactKeys(value.response, ["sessionId", "activeSessionId", "role", "completion"]))
    return false;
  if (!boundedId(value.response.sessionId) || !boundedId(value.response.activeSessionId)) return false;
  if (typeof value.response.role !== "string" || typeof value.response.completion !== "string") return false;
  if (!record(value.signals) || !exactKeys(value.signals, APPROVED_KEYS)) return false;
  return APPROVED_KEYS.every((key) => typeof value.signals[key] === "boolean");
}

function nonSelection(reason: AutomaticRoutingNonSelectionReason): AutomaticRoutingNonSelection {
  return { selected: false, reason };
}

/**
 * Apply the host-private, fail-closed automatic-selection policy. Only
 * structural classifications enter this function; no request or response
 * text is accepted or copied into the result.
 */
export function selectAutomaticRouting(value: unknown): AutomaticRoutingPolicyDecision {
  if (!validInput(value)) return nonSelection("malformed_input");
  if (!value.enabled) return nonSelection("disabled");
  if (value.runtime !== "available") return nonSelection("runtime_unavailable");

  const evaluation = validateAutomaticRoutingEvaluation(value.evaluation);
  if (!evaluation.ok || !evaluation.value.qualified) return nonSelection("evaluation_unqualified");
  if (value.workMode !== SUPPORTED_WORK_MODE) return nonSelection("unsupported_work_mode");
  if (ORDINARY_REQUESTS.has(value.requestClass)) return nonSelection("ordinary_work");
  if (value.response.role !== "assistant" || value.response.completion !== "completed")
    return nonSelection("incomplete_response");
  if (value.response.sessionId !== value.response.activeSessionId) return nonSelection("inactive_session");

  const applicable = REASONS.filter(({ signal }) => value.signals[signal]);
  if (applicable.length < 2) return nonSelection("insufficient_signals");
  const reason = applicable[0];
  return { selected: true, reasonCode: reason.code, summary: reason.summary };
}

export const evaluateAutomaticRoutingPolicy = selectAutomaticRouting;

export type { AutomaticRoutingEvaluation };
