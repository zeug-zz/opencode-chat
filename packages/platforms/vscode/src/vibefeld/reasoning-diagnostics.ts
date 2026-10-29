import type { AdversarialValidationErrorCode } from "./adversarial-review-validation";
import { CLAIM_PROJECTION_DIAGNOSTIC_OUTCOMES, type ClaimProjectionDiagnosticOutcome } from "./claim-projection-seam";

export const REASONING_DIAGNOSTIC_RECORD_LIMIT = 128;
export const REASONING_DIAGNOSTIC_MAX_ELAPSED_MS = 60_000;

const REASONING_DIAGNOSTIC_STAGES = new Set([
  "pre-screen",
  "initialization",
  "runtime",
  "provider",
  "adapter",
  "architect",
  "architect-provider",
  "architect-readiness",
  "architect-context",
  "architect-instructions",
  "architect-generate",
  "architect-native-error",
  "architect-response",
  "architect-result-parse",
  "architect-cleanup",
  "review-readiness",
  "af",
  "af-projection",
  "critic",
  "total",
  "publication",
  "dispatch",
  "brief",
  "brief-confirmation",
  "manual-request",
  "manual-provider",
  "manual-mapping",
  "manual-af",
  "manual-prover",
  "manual-verifier",
  "manual-review",
  "manual-publication",
]);

const REASONING_DIAGNOSTIC_OUTCOMES = new Set([
  "not-implemented",
  "not-measured",
  "started",
  "ready",
  "unavailable",
  "missing-model",
  "af-unavailable",
  "provider-unavailable",
  "readiness-rejected",
  "precheck-not-ready",
  "postcheck-not-ready",
  "present",
  "absent",
  "not-eligible",
  "packet-invalid-input",
  "packet-empty-text",
  "packet-text-over-limit",
  "stage-unavailable",
  "stage-failed",
  "stage-failed-timeout",
  "stage-failed-cancelled",
  "stage-failed-malformed",
  "stage-failed-oversized",
  "stage-failed-model",
  "stage-failed-unknown-role",
  "context-ownership-failed",
  "provider-sdk-error",
  "provider-timeout",
  "provider-invalid-response",
  "json-parse-failed",
  "wrong-top-level-keys",
  "validator-failed",
  "thrown-exception",
  "timeout",
  "success",
  "failure",
  "registered",
  "maybe-argument",
  "pending-argued",
  "grace-waited",
  "delivered-late",
  "discarded",
  "ordinary",
  "invalid-result",
  "deadline",
  "stale",
  "cancelled",
  "failed",
  "recorded",
  "not-recorded",
  "not-requested",
  "completed",
  "skipped",
  "argument",
  "attempted",
  "publication-failed",
  "dispatched",
  "dispatch-failed",
  "delivered",
  "cleared",
  "confirmation-failed",
  "confirmation-threw",
  "turn-finished",
  "invalid-request",
  "message-missing",
  "answer-unfinished",
  "wrong-role",
  "failed-answer",
  "empty-answer",
  "source-over-limit",
  "message-load-failed",
  "duplicate-request",
  "answer-valid",
  "runtime-unready",
  "readiness-started",
  "readiness-ready",
  "lifecycle-started",
  "lifecycle-unavailable",
  "lifecycle-stale",
  "lifecycle-cleanup-failed",
  "capability-unavailable",
  "mapping-started",
  "packet-ready",
  "packet-invalid-input",
  "packet-empty-text",
  "packet-text-over-limit",
  "context-started",
  "context-ready",
  "context-unavailable",
  "context-timeout",
  "context-cancelled",
  "context-failed",
  "stage-started",
  "stage-timeout",
  "stage-cancelled",
  "stage-malformed",
  "stage-oversized",
  "parse-malformed",
  "parse-over-limit",
  "parse-unsafe",
  "parse-duplicate-identifier",
  "parse-missing-dependency",
  "parse-cycle",
  "parse-invalid-claim-class",
  "malformed",
  "duplicate-identifier",
  "missing-dependency",
  "cycle",
  "invalid-claim-class",
  "unsafe-value",
  "over-limit",
  "request-timeout",
  "request-cancelled",
  "request-failed-location-not-found",
  "request-failed-agent-not-found",
  "request-failed-unauthorized",
  "request-failed-service-unavailable",
  "request-failed-other",
  "not-current",
  "location-mismatch",
  "model-mismatch",
  "agent-mismatch-shape",
  "agent-mismatch-id",
  "agent-mismatch-model",
  "agent-mismatch-system",
  "agent-mismatch-steps",
  "agent-mismatch-mode",
  "agent-mismatch-hidden",
  "agent-mismatch-permissions",
  "agent-mismatch-tools",
  "generation-stale",
  "native-invalid-request",
  "native-authentication",
  "native-service-unavailable",
  "native-location-not-found",
  "native-agent-not-found",
  "native-session-not-found",
  "native-provider-not-found",
  "native-context-limit",
  "native-other",
  "client-transport",
  "client-protocol",
  "client-unexpected-status",
  "client-unexpected-status-4xx",
  "client-unexpected-status-5xx",
  "client-other",
  "other",
  "mapping-unavailable",
  "projection-started",
  "projection-structurally-checked",
  "projection-conditional",
  "projection-unresolved",
  "projection-refuted",
  "projection-unavailable",
  "projection-failed",
  ...CLAIM_PROJECTION_DIAGNOSTIC_OUTCOMES,
  "reviewer-started",
  "reviewer-completed",
  "reviewer-unavailable",
  "reviewer-failed",
  "reviewer-timeout",
  "reviewer-cancelled",
  "result-published",
  "cancellation-published",
]);

export type ReasoningDiagnosticStage =
  | "pre-screen"
  | "initialization"
  | "runtime"
  | "provider"
  | "adapter"
  | "architect"
  | "architect-provider"
  | "architect-readiness"
  | "architect-context"
  | "architect-instructions"
  | "architect-generate"
  | "architect-native-error"
  | "architect-response"
  | "architect-result-parse"
  | "architect-cleanup"
  | "review-readiness"
  | "af"
  | "af-projection"
  | "critic"
  | "total"
  | "publication"
  | "dispatch"
  | "brief"
  | "brief-confirmation"
  | "manual-request"
  | "manual-provider"
  | "manual-mapping"
  | "manual-af"
  | "manual-prover"
  | "manual-verifier"
  | "manual-review"
  | "manual-publication";

export type ReasoningDiagnosticOutcome =
  | "not-implemented"
  | "not-measured"
  | "started"
  | "ready"
  | "unavailable"
  | "missing-model"
  | "af-unavailable"
  | "provider-unavailable"
  | "readiness-rejected"
  | "precheck-not-ready"
  | "postcheck-not-ready"
  | "present"
  | "absent"
  | "not-eligible"
  | "packet-invalid-input"
  | "packet-empty-text"
  | "packet-text-over-limit"
  | "stage-unavailable"
  | "stage-failed"
  | "stage-failed-timeout"
  | "stage-failed-cancelled"
  | "stage-failed-malformed"
  | "stage-failed-oversized"
  | "stage-failed-model"
  | "stage-failed-unknown-role"
  | "context-ownership-failed"
  | "provider-sdk-error"
  | "provider-timeout"
  | "provider-invalid-response"
  | "json-parse-failed"
  | "wrong-top-level-keys"
  | "validator-failed"
  | "thrown-exception"
  | "timeout"
  | "success"
  | "failure"
  | "maybe-argument"
  | "pending-argued"
  | "grace-waited"
  | "delivered-late"
  | "discarded"
  | "ordinary"
  | "invalid-result"
  | "deadline"
  | "stale"
  | "cancelled"
  | "failed"
  | "recorded"
  | "not-recorded"
  | "not-requested"
  | "completed"
  | "skipped"
  | "argument"
  | "attempted"
  | "publication-failed"
  | "dispatched"
  | "dispatch-failed"
  | "delivered"
  | "cleared"
  | "invalid-request"
  | "message-missing"
  | "answer-unfinished"
  | "wrong-role"
  | "failed-answer"
  | "empty-answer"
  | "source-over-limit"
  | "message-load-failed"
  | "duplicate-request"
  | "answer-valid"
  | "runtime-unready"
  | "readiness-started"
  | "readiness-ready"
  | "lifecycle-started"
  | "lifecycle-unavailable"
  | "lifecycle-stale"
  | "lifecycle-cleanup-failed"
  | "capability-unavailable"
  | "mapping-started"
  | "packet-ready"
  | "packet-invalid-input"
  | "packet-empty-text"
  | "packet-text-over-limit"
  | "context-started"
  | "context-ready"
  | "context-unavailable"
  | "context-timeout"
  | "context-cancelled"
  | "context-failed"
  | "stage-started"
  | "stage-timeout"
  | "stage-cancelled"
  | "stage-malformed"
  | "stage-oversized"
  | "parse-malformed"
  | "parse-over-limit"
  | "parse-unsafe"
  | "parse-duplicate-identifier"
  | "parse-missing-dependency"
  | "dependency-unknown-conclusion"
  | "dependency-target-assumption"
  | "dependency-unknown-target"
  | "dependency-unknown-assumption-claim"
  | "dependency-unknown-evidence-claim"
  | "dependency-unreachable-claim"
  | "dependency-other"
  | "parse-cycle"
  | "parse-invalid-claim-class"
  | "malformed"
  | "duplicate-identifier"
  | "missing-dependency"
  | "cycle"
  | "invalid-claim-class"
  | "unsafe-value"
  | "over-limit"
  | "request-timeout"
  | "request-cancelled"
  | "request-failed-location-not-found"
  | "request-failed-agent-not-found"
  | "request-failed-unauthorized"
  | "request-failed-service-unavailable"
  | "request-failed-other"
  | "not-current"
  | "location-mismatch"
  | "model-mismatch"
  | "agent-mismatch-shape"
  | "agent-mismatch-id"
  | "agent-mismatch-model"
  | "agent-mismatch-system"
  | "agent-mismatch-steps"
  | "agent-mismatch-mode"
  | "agent-mismatch-hidden"
  | "agent-mismatch-permissions"
  | "agent-mismatch-tools"
  | "generation-stale"
  | "native-invalid-request"
  | "native-authentication"
  | "native-service-unavailable"
  | "native-location-not-found"
  | "native-agent-not-found"
  | "native-session-not-found"
  | "native-provider-not-found"
  | "native-context-limit"
  | "native-other"
  | "client-transport"
  | "client-protocol"
  | "client-unexpected-status"
  | "client-unexpected-status-4xx"
  | "client-unexpected-status-5xx"
  | "client-other"
  | "other"
  | "mapping-unavailable"
  | "projection-started"
  | "projection-structurally-checked"
  | "projection-conditional"
  | "projection-unresolved"
  | "projection-refuted"
  | "projection-unavailable"
  | "projection-failed"
  | ClaimProjectionDiagnosticOutcome
  | "reviewer-started"
  | "reviewer-completed"
  | "reviewer-unavailable"
  | "reviewer-failed"
  | "reviewer-timeout"
  | "reviewer-cancelled"
  | "result-published"
  | "cancellation-published";

export type ReasoningDiagnosticEvent = Readonly<{
  stage: ReasoningDiagnosticStage;
  outcome: ReasoningDiagnosticOutcome;
  malformedShape?: ReasoningDiagnosticShape;
  dependencySubreason?: ReasoningDiagnosticDependencySubreason;
  validationCode?: AdversarialValidationErrorCode;
  normalization?: "fenced";
  elapsedMs?: number;
}>;

export type ReasoningDiagnosticShape =
  | "shape-empty"
  | "shape-fenced"
  | "shape-prose-wrapped"
  | "shape-not-json"
  | "shape-schema-mismatch";

export type ReasoningDiagnosticDependencySubreason =
  | "dependency-unknown-conclusion"
  | "dependency-target-assumption"
  | "dependency-unknown-target"
  | "dependency-unknown-assumption-claim"
  | "dependency-unknown-evidence-claim"
  | "dependency-unreachable-claim"
  | "dependency-other";

const REASONING_DIAGNOSTIC_SHAPES = new Set<ReasoningDiagnosticShape>([
  "shape-empty",
  "shape-fenced",
  "shape-prose-wrapped",
  "shape-not-json",
  "shape-schema-mismatch",
]);

const REASONING_DIAGNOSTIC_DEPENDENCY_SUBREASONS = new Set<ReasoningDiagnosticDependencySubreason>([
  "dependency-unknown-conclusion",
  "dependency-target-assumption",
  "dependency-unknown-target",
  "dependency-unknown-assumption-claim",
  "dependency-unknown-evidence-claim",
  "dependency-unreachable-claim",
  "dependency-other",
]);

const REASONING_DIAGNOSTIC_VALIDATION_CODES = new Set<AdversarialValidationErrorCode>([
  "malformed",
  "unknown-field",
  "unsafe-value",
  "over-limit",
  "duplicate-identifier",
  "unknown-target",
  "provenance",
  "policy",
  "ambiguous",
]);

export type ReasoningDiagnosticSink = (level: "info", message: string) => void;
export type ReasoningDiagnosticReporter = (event: unknown) => void;

function fallbackMonotonicNow(): number {
  try {
    const value = globalThis.performance?.now();
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  } catch {
    // Fall through to the coarse wall clock only when the monotonic clock is unavailable.
  }
  try {
    const value = Date.now();
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** A failed or malformed injected clock falls back without throwing into host behavior. */
export function createReasoningDiagnosticClock(clock?: () => number): () => number {
  let last: number | undefined;
  return () => {
    let value: number;
    try {
      value = clock ? clock() : fallbackMonotonicNow();
    } catch {
      value = last ?? fallbackMonotonicNow();
    }
    if (!Number.isFinite(value) || value < 0) value = last ?? fallbackMonotonicNow();
    if (last !== undefined && value < last) value = last;
    last = value;
    return value;
  };
}

export function elapsedReasoningMilliseconds(now: () => number, startedAt: number): number | undefined {
  try {
    const elapsed = now() - startedAt;
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One bounded, host-private reporter for reasoning diagnostics. Event fields are
 * revalidated here because callers can receive values from runtime adapters.
 */
export function createReasoningDiagnosticReporter(sink?: ReasoningDiagnosticSink): ReasoningDiagnosticReporter {
  let emitted = 0;
  return (event: unknown) => {
    if (emitted >= REASONING_DIAGNOSTIC_RECORD_LIMIT) return;
    try {
      if (typeof event !== "object" || event === null) return;
      const candidate = event as Record<string, unknown>;
      const stage = candidate.stage;
      const outcome = candidate.outcome;
      if (typeof stage !== "string" || !REASONING_DIAGNOSTIC_STAGES.has(stage)) return;
      if (typeof outcome !== "string" || !REASONING_DIAGNOSTIC_OUTCOMES.has(outcome)) return;

      const malformedShape = candidate.malformedShape;
      if (malformedShape !== undefined && !REASONING_DIAGNOSTIC_SHAPES.has(malformedShape as ReasoningDiagnosticShape))
        return;
      const dependencySubreason = candidate.dependencySubreason;
      if (
        dependencySubreason !== undefined &&
        !REASONING_DIAGNOSTIC_DEPENDENCY_SUBREASONS.has(dependencySubreason as ReasoningDiagnosticDependencySubreason)
      )
        return;
      const validationCode = candidate.validationCode;
      if (
        validationCode !== undefined &&
        !REASONING_DIAGNOSTIC_VALIDATION_CODES.has(validationCode as AdversarialValidationErrorCode)
      )
        return;
      const normalization = candidate.normalization;
      if (normalization !== undefined && normalization !== "fenced") return;

      const hasElapsed = Object.hasOwn(candidate, "elapsedMs");
      let elapsedMs: number | undefined;
      if (hasElapsed) {
        const metric = candidate.elapsedMs;
        if (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0) return;
        elapsedMs = Math.min(metric, REASONING_DIAGNOSTIC_MAX_ELAPSED_MS);
      }

      const message = `[OpenCode Scribe reasoning] stage=${stage} outcome=${outcome}${
        malformedShape === undefined ? "" : ` shape=${malformedShape}`
      }${dependencySubreason === undefined ? "" : ` dependencySubreason=${dependencySubreason}`}${
        validationCode === undefined ? "" : ` validationCode=${validationCode}`
      }${
        normalization === undefined ? "" : ` normalization=${normalization}`
      }${elapsedMs === undefined ? "" : ` elapsedMs=${Math.round(elapsedMs * 100) / 100}`}`;
      emitted += 1;
      if (sink !== undefined) {
        if (typeof sink !== "function") return;
        try {
          sink("info", message);
        } catch {
          // A logging failure must never affect prompt admission or readiness.
        }
        return;
      }
      try {
        console.info(message);
      } catch {
        // Console diagnostics are also best effort.
      }
    } catch {
      // Proxies/getters and hostile fake runtime values are discarded opaquely.
    }
  };
}
