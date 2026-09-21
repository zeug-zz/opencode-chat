import type {
  ReasoningReviewRoutingReasonCode,
  ReasoningReviewRoutingSummary,
  ReasoningReviewSummary,
} from "@opencode-chat/core";
import type { AutomaticRoutingSelection } from "./automatic-routing-policy";

const MAX_ID_LENGTH = 256;
const MAX_SUMMARY_TEXT = 4_096;
const MAX_CHALLENGES = 16;
const ROUTING_SUMMARIES: Readonly<Record<ReasoningReviewRoutingReasonCode, ReasoningReviewRoutingSummary>> = {
  evidence_dependent: "Evidence-dependent response",
  multi_step_argument: "Multi-step argument",
  high_impact_recommendation: "High-impact recommendation",
};
const REVIEW_STATUSES = new Set([
  "not_reviewed",
  "reviewing",
  "structurally_checked",
  "conditional",
  "unresolved",
  "refuted",
  "blocked",
  "audit_failed",
  "unavailable",
]);
const EVIDENCE_STATUSES = new Set([
  "not_assessed",
  "not_required",
  "source_recorded",
  "unverified",
  "human_verified",
  "conflicted",
]);
const CHALLENGE_SEVERITIES = new Set(["critical", "major", "minor", "note"]);

export type AutomaticRoutingBinding = Readonly<{
  sessionId: string;
  messageId: string;
  generation: number;
}>;

export type AutomaticRoutingLifecycleReason =
  | "malformed"
  | "duplicate"
  | "manual_in_flight"
  | "stale"
  | "session_mismatch"
  | "generation_mismatch"
  | "message_mismatch"
  | "cancelled"
  | "timed_out"
  | "terminal"
  | "unsafe"
  | "invalid_rationale";

export type AutomaticRoutingLifecycleDecision =
  | Readonly<{
      kind: "started";
      attemptId: string;
      binding: AutomaticRoutingBinding;
      reasonCode: ReasoningReviewRoutingReasonCode;
      summary: ReasoningReviewRoutingSummary;
    }>
  | Readonly<{ kind: "skipped"; reason: AutomaticRoutingLifecycleReason }>
  | Readonly<{ kind: "completed"; attemptId: string }>
  | Readonly<{ kind: "invalidated"; reason: "cancelled" | "timed_out" | "stale" | "terminal" }>;

type Attempt = {
  attemptId: string;
  binding: AutomaticRoutingBinding;
  state: "active" | "completed" | "cancelled" | "timed_out" | "stale" | "terminal";
  reasonCode: ReasoningReviewRoutingReasonCode;
};

type ManualBinding = AutomaticRoutingBinding;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function safeText(value: unknown, maxLength = MAX_SUMMARY_TEXT): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    }) &&
    !/(?:https?:\/\/|(?:^|[\s])(?:\/|[A-Za-z]:\\)|\b(?:command|exec|prompt|password|credential|secret|private\s*reasoning|chain[- ]of[- ]thought|ledger)\s*[:=])/iu.test(
      value,
    )
  );
}

function binding(value: unknown): value is AutomaticRoutingBinding {
  return (
    record(value) &&
    exactKeys(value, ["sessionId", "messageId", "generation"]) &&
    safeText(value.sessionId, MAX_ID_LENGTH) &&
    safeText(value.messageId, MAX_ID_LENGTH) &&
    value.sessionId.length > 0 &&
    value.messageId.length > 0 &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0
  );
}

function selection(value: unknown): value is AutomaticRoutingSelection {
  if (!record(value) || !exactKeys(value, ["selected", "reasonCode", "summary"]) || value.selected !== true)
    return false;
  return (
    typeof value.reasonCode === "string" &&
    Object.hasOwn(ROUTING_SUMMARIES, value.reasonCode) &&
    value.summary === ROUTING_SUMMARIES[value.reasonCode as ReasoningReviewRoutingReasonCode]
  );
}

function routingMetadata(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, ["reasonCode", "summary"]) &&
    typeof value.reasonCode === "string" &&
    Object.hasOwn(ROUTING_SUMMARIES, value.reasonCode) &&
    value.summary === ROUTING_SUMMARIES[value.reasonCode as ReasoningReviewRoutingReasonCode]
  );
}

function terminalReason(state: Attempt["state"]): AutomaticRoutingLifecycleReason {
  switch (state) {
    case "completed":
      return "terminal";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    case "stale":
      return "stale";
    case "terminal":
      return "terminal";
    case "active":
      return "duplicate";
  }
}

function safeSummary(
  value: unknown,
  messageId: string,
  reasonCode: ReasoningReviewRoutingReasonCode,
): value is ReasoningReviewSummary {
  if (!record(value)) return false;
  const allowed = [
    "reviewedMessageId",
    "status",
    "invocation",
    "conclusion",
    "assumptions",
    "evidenceStatus",
    "openChallenges",
    "interpretiveBoundary",
    "artifactHandle",
    "routing",
  ] as const;
  if (!Object.keys(value).every((key) => allowed.includes(key as (typeof allowed)[number]))) return false;
  if (
    value.reviewedMessageId !== messageId ||
    value.invocation !== "automatic" ||
    !safeText(value.reviewedMessageId, MAX_ID_LENGTH) ||
    typeof value.status !== "string" ||
    !REVIEW_STATUSES.has(value.status) ||
    !safeText(value.conclusion) ||
    !Array.isArray(value.assumptions) ||
    value.assumptions.length > MAX_CHALLENGES ||
    !value.assumptions.every((item) => safeText(item)) ||
    typeof value.evidenceStatus !== "string" ||
    !EVIDENCE_STATUSES.has(value.evidenceStatus) ||
    !Array.isArray(value.openChallenges) ||
    value.openChallenges.length > MAX_CHALLENGES
  )
    return false;
  if (
    !value.openChallenges.every(
      (challenge) =>
        record(challenge) &&
        exactKeys(challenge, ["severity", "target", "reason"]) &&
        typeof challenge.severity === "string" &&
        CHALLENGE_SEVERITIES.has(challenge.severity) &&
        safeText(challenge.target) &&
        safeText(challenge.reason),
    )
  )
    return false;
  if (value.interpretiveBoundary !== undefined && !safeText(value.interpretiveBoundary)) return false;
  if (value.artifactHandle !== undefined && !safeText(value.artifactHandle, MAX_ID_LENGTH)) return false;
  if (
    !routingMetadata(value.routing) ||
    (value.routing as { reasonCode: ReasoningReviewRoutingReasonCode }).reasonCode !== reasonCode
  )
    return false;
  return true;
}

function skipped(reason: AutomaticRoutingLifecycleReason): AutomaticRoutingLifecycleDecision {
  return Object.freeze({ kind: "skipped", reason });
}

export type AutomaticRoutingLifecycle = Readonly<{
  start(input: unknown): AutomaticRoutingLifecycleDecision;
  complete(attemptId: unknown, bindingValue: unknown, summary: unknown): AutomaticRoutingLifecycleDecision;
  cancel(attemptId: unknown, bindingValue: unknown): AutomaticRoutingLifecycleDecision;
  timeout(attemptId: unknown, bindingValue: unknown): AutomaticRoutingLifecycleDecision;
  invalidateSession(sessionId: unknown): void;
  invalidateMessage(bindingValue: unknown): void;
  invalidateGeneration(sessionId: unknown, generation: unknown): void;
  beginManual(bindingValue: unknown): boolean;
  endManual(bindingValue: unknown): void;
  dispose(): void;
}>;

/**
 * Tracks automatic review intent only. It never stores request/response text,
 * invokes a controller, or references the response-gate boundary.
 */
export function createAutomaticRoutingLifecycle(
  input?: Readonly<{ sessionId?: string; generation?: number }>,
): AutomaticRoutingLifecycle {
  const attempts = new Map<string, Attempt>();
  const manual = new Map<string, ManualBinding>();
  let sequence = 0;
  let activeSession = input?.sessionId;
  let activeGeneration = input?.generation;
  let disposed = false;

  const key = (value: AutomaticRoutingBinding): string =>
    `${value.sessionId}\u0000${value.messageId}\u0000${value.generation}`;
  const invalidBinding = (): AutomaticRoutingLifecycleDecision => skipped("malformed");
  const invalidate = (
    attempt: Attempt,
    reason: "cancelled" | "timed_out" | "stale" | "terminal",
  ): AutomaticRoutingLifecycleDecision => {
    if (attempt.state !== "active") return skipped(terminalReason(attempt.state));
    attempt.state = reason;
    return Object.freeze({ kind: "invalidated", reason });
  };

  return {
    start(value) {
      if (disposed || !record(value) || !exactKeys(value, ["binding", "selection"])) return skipped("malformed");
      if (!binding(value.binding) || !selection(value.selection)) return invalidBinding();
      const target = value.binding;
      if (activeSession !== undefined && target.sessionId !== activeSession) return skipped("session_mismatch");
      if (activeGeneration !== undefined && target.generation !== activeGeneration)
        return skipped("generation_mismatch");
      const targetKey = key(target);
      if (manual.has(targetKey)) return skipped("manual_in_flight");
      const previous = attempts.get(targetKey);
      if (previous) return skipped(terminalReason(previous.state));
      sequence += 1;
      const attemptId = `automatic-routing-${sequence.toString(36)}`;
      attempts.set(targetKey, {
        attemptId,
        binding: target,
        state: "active",
        reasonCode: value.selection.reasonCode,
      });
      return Object.freeze({
        kind: "started",
        attemptId,
        binding: Object.freeze({ ...target }),
        reasonCode: value.selection.reasonCode,
        summary: value.selection.summary,
      });
    },
    complete(attemptId, bindingValue, summary) {
      if (disposed || typeof attemptId !== "string" || !binding(bindingValue)) return skipped("malformed");
      const attempt = attempts.get(key(bindingValue));
      if (!attempt || attemptId !== attempt.attemptId) return skipped("stale");
      if (attempt.state !== "active") return skipped(terminalReason(attempt.state));
      if (!safeSummary(summary, bindingValue.messageId, attempt.reasonCode)) {
        attempt.state = "terminal";
        return skipped("unsafe");
      }
      attempt.state = "completed";
      return Object.freeze({ kind: "completed", attemptId });
    },
    cancel(attemptId, bindingValue) {
      return transition(attemptId, bindingValue, "cancelled");
    },
    timeout(attemptId, bindingValue) {
      return transition(attemptId, bindingValue, "timed_out");
    },
    invalidateSession(sessionId) {
      if (typeof sessionId !== "string") return;
      activeSession = sessionId;
      for (const attempt of attempts.values()) if (attempt.binding.sessionId !== sessionId) attempt.state = "stale";
      for (const [manualKey, value] of manual) if (value.sessionId !== sessionId) manual.delete(manualKey);
    },
    invalidateMessage(bindingValue) {
      if (!binding(bindingValue)) return;
      const attempt = attempts.get(key(bindingValue));
      if (attempt) attempt.state = "stale";
      manual.delete(key(bindingValue));
    },
    invalidateGeneration(sessionId, generation) {
      if (typeof sessionId !== "string" || !Number.isSafeInteger(generation) || generation < 0) return;
      activeSession = sessionId;
      activeGeneration = generation;
      for (const attempt of attempts.values()) {
        if (attempt.binding.sessionId === sessionId && attempt.binding.generation < generation) attempt.state = "stale";
        if (attempt.binding.sessionId !== sessionId) attempt.state = "stale";
      }
    },
    beginManual(bindingValue) {
      if (disposed || !binding(bindingValue)) return false;
      const target = bindingValue;
      const targetKey = key(target);
      if (manual.has(targetKey)) return false;
      manual.set(targetKey, Object.freeze({ ...target }));
      const attempt = attempts.get(targetKey);
      if (attempt?.state === "active") attempt.state = "terminal";
      return true;
    },
    endManual(bindingValue) {
      if (binding(bindingValue)) manual.delete(key(bindingValue));
    },
    dispose() {
      disposed = true;
      for (const attempt of attempts.values()) if (attempt.state === "active") attempt.state = "terminal";
      attempts.clear();
      manual.clear();
    },
  };

  function transition(
    attemptId: unknown,
    bindingValue: unknown,
    state: "cancelled" | "timed_out",
  ): AutomaticRoutingLifecycleDecision {
    if (disposed || typeof attemptId !== "string" || !binding(bindingValue)) return skipped("malformed");
    const attempt = attempts.get(key(bindingValue));
    if (!attempt) return skipped("stale");
    if (attempt.state !== "active") return skipped(terminalReason(attempt.state));
    if (attemptId !== attempt.attemptId) return skipped("stale");
    return invalidate(attempt, state);
  }
}
