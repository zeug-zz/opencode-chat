import type { ReasoningReviewRuntime } from "@opencode-chat/core";
import type { IReasoningReviewController } from "./reasoning-review-controller";
import type { AfBridgeResult } from "./vibefeld-runtime";

/**
 * Bounded runtime status for a composition that never reached a preflight.
 * Status only: never a host path, version, raw error, or compatibility fact.
 */
export const DORMANT_REASONING_REVIEW_RUNTIME: ReasoningReviewRuntime = {
  state: "unavailable",
  reason: "runtime-unavailable",
};

/** Bounded status for a preflight that rejected before producing a result. */
export const PREFLIGHT_FAILED_REASONING_REVIEW_RUNTIME: ReasoningReviewRuntime = {
  state: "unavailable",
  reason: "preflight-failed",
};

const AVAILABLE_RUNTIME: ReasoningReviewRuntime = { state: "available" };
const INCOMPATIBLE_RUNTIME: ReasoningReviewRuntime = {
  state: "incompatible",
  reason: "runtime-mismatch",
};

/**
 * Bridge failure reasons that are safe to publish: stable enum labels carrying
 * no path, version, raw error, or compatibility metadata. `runtime-mismatch`
 * is intentionally absent because it belongs only to the incompatible status.
 */
const PUBLISHABLE_FAILURE_REASONS = new Set([
  "unsupported-platform",
  "missing-executable",
  "policy-unavailable",
  "preflight-failed",
  "operation-not-ready",
  "cancelled",
  "timeout",
  "malformed",
  "oversized",
  "non-zero",
  "signaled",
  "cleanup-failure",
  "audit-failure",
]);

/**
 * Derive the single bounded status published for one activation preflight
 * outcome. Availability is reported only for a ready bridge; every other state
 * maps to a bounded dormant status, and an unrecognized reason falls back to
 * the runtime-unavailable label instead of echoing foreign detail.
 */
export const deriveReasoningReviewRuntime = (
  preflight: Pick<AfBridgeResult<never>, "state" | "reason">,
): ReasoningReviewRuntime => {
  if (preflight.state === "ready") return AVAILABLE_RUNTIME;
  if (preflight.state === "incompatible") return INCOMPATIBLE_RUNTIME;
  return {
    state: "unavailable",
    reason:
      preflight.reason && PUBLISHABLE_FAILURE_REASONS.has(preflight.reason) ? preflight.reason : "runtime-unavailable",
  };
};

/**
 * Host-private runtime reporting for the controller selected once at
 * activation. `getRuntime()` returns the fixed preflight-derived status and
 * never re-preflights, discovers, spawns, or touches the bridge; manual review
 * and cancellation delegate to the selected controller unchanged.
 */
export class RuntimeReportingReasoningReviewController implements IReasoningReviewController {
  constructor(
    private readonly delegate: IReasoningReviewController,
    private readonly runtime: ReasoningReviewRuntime,
  ) {}

  async getRuntime(): Promise<ReasoningReviewRuntime> {
    return this.runtime;
  }

  review(input: { sessionId: string; messageId: string; sourceText: string }) {
    return this.delegate.review(input);
  }

  cancel(sessionId: string, messageId: string): void {
    this.delegate.cancel(sessionId, messageId);
  }
}
