import type { ReasoningReviewSummary } from "@opencode-chat/core";
import type { CalibratedReviewDecision } from "./response-gate-contract";
import {
  type ResponseGateValidationCode,
  validateBoundedReviewSummary,
  validateCalibratedReviewDecision,
} from "./response-gate-validation";

export type ResponseGateReviewAdapterResult =
  | Readonly<{ ok: true; value: CalibratedReviewDecision }>
  | Readonly<{ ok: false; code: ResponseGateValidationCode | "stale" }>;

export type ResponseGateReviewOutcome =
  | Readonly<{ kind: "approved"; decision: Extract<CalibratedReviewDecision, { kind: "approved" }> }>
  | Readonly<{
      kind: "terminal";
      state: "failed" | "audit_failed";
      reason: "review_failed" | "provenance" | "audit";
    }>;

const SUMMARY_KEYS = [
  "reviewedMessageId",
  "status",
  "invocation",
  "conclusion",
  "assumptions",
  "evidenceStatus",
  "openChallenges",
  "interpretiveBoundary",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adapts only the existing bounded review vocabulary into the gate decision.
 * Provider artifacts and unknown fields are intentionally not copied across.
 */
export function adaptReasoningReviewSummaryToDecision(
  value: unknown,
  expectedMessageId: string,
): ResponseGateReviewAdapterResult {
  if (!isRecord(value)) return { ok: false, code: "malformed" };
  if (Object.keys(value).length !== SUMMARY_KEYS.length || SUMMARY_KEYS.some((key) => !Object.hasOwn(value, key)))
    return { ok: false, code: "unknown-field" };
  if (value.reviewedMessageId !== expectedMessageId) return { ok: false, code: "stale" };

  const decision = validateCalibratedReviewDecision({
    kind: "approved",
    calibration: "conditional",
    // The gate's review handoff is automatic even when the originating
    // reasoning-review card was manually requested. All other bounded summary
    // vocabulary remains unchanged.
    summary: { ...(value as unknown as ReasoningReviewSummary), invocation: "automatic" },
  });
  return decision.ok ? decision : { ok: false, code: decision.code };
}

/**
 * Maps only normalized, bounded review vocabulary to a gate outcome. In
 * particular, a summary status is never treated as approval merely because it
 * is well-shaped; conditional with no open challenges is the sole releasable
 * outcome.
 */
export function mapResponseGateReviewOutcome(
  value: unknown,
  expectedMessageId: string,
): ResponseGateReviewOutcome | Readonly<{ kind: "invalid"; code: ResponseGateValidationCode | "stale" }> {
  if (!isRecord(value)) return { kind: "invalid", code: "malformed" };
  if (value.reviewedMessageId !== expectedMessageId) return { kind: "invalid", code: "stale" };
  const summary = validateBoundedReviewSummary(value);
  if (!summary.ok) return { kind: "invalid", code: summary.code };

  if (
    summary.value.status === "conditional" &&
    summary.value.evidenceStatus !== "conflicted" &&
    summary.value.openChallenges.length === 0
  ) {
    const decision = adaptReasoningReviewSummaryToDecision(value, expectedMessageId);
    return decision.ok && decision.value.kind === "approved"
      ? { kind: "approved", decision: decision.value }
      : { kind: "invalid", code: decision.ok ? "incompatible" : decision.code };
  }

  if (summary.value.status === "audit_failed") return { kind: "terminal", state: "audit_failed", reason: "audit" };
  if (summary.value.evidenceStatus === "conflicted")
    return { kind: "terminal", state: "audit_failed", reason: "provenance" };
  return { kind: "terminal", state: "failed", reason: "review_failed" };
}
