import type { ReasoningReviewStatus, ReasoningReviewSummary } from "@opencode-chat/core";
import {
  type BoundedResponseSourcePacket,
  type CalibratedReviewDecision,
  type ImmutableResponseCandidate,
  RESPONSE_GATE_MAX_CANDIDATE_CHARS,
  RESPONSE_GATE_MAX_SOURCE_CHARS,
  type ResponseGateAssistantMessageId,
  type ResponseGateBinding,
  type ResponseGateCapability,
  type ResponseGateGeneration,
  type ResponseGateOwner,
  type ResponseGateSessionId,
  type ResponseGateTransaction,
  type ResponseGateTransactionToken,
} from "./response-gate-contract";

export type ResponseGateValidationCode =
  | "malformed"
  | "unknown-field"
  | "unsafe-value"
  | "over-limit"
  | "ineligible"
  | "incompatible"
  | "mismatch"
  | "stale"
  | "duplicate"
  | "ambiguous"
  | "terminal";

export type ResponseGateValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: ResponseGateValidationCode }>;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TOKEN = /^[A-Za-z0-9_-]+$/;
const MAX_ID = 128;
const MAX_SUMMARY_TEXT = 512;
const MAX_ASSUMPTIONS = 32;
const MAX_CHALLENGES = 32;
const SAFE_EVIDENCE = new Set([
  "not_assessed",
  "not_required",
  "source_recorded",
  "unverified",
  "human_verified",
  "conflicted",
]);
const REVIEW_STATUSES = new Set<ReasoningReviewStatus>([
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
type IncompatibleReason = Extract<ResponseGateCapability, { kind: "incompatible" }>["reason"];
type ConditionalSummary = Omit<ReasoningReviewSummary, "status"> & { status: "conditional" };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function fail<T>(code: ResponseGateValidationCode): ResponseGateValidationResult<T> {
  return { ok: false, code };
}

function safeText(value: unknown, limit: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= limit &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    }) &&
    !/(?:https?:\/\/|(?:^|\s)(?:\/?(?:Users|private|home|tmp|var)\/|[A-Za-z]:[\\/])|\b(?:password|credential|secret|private\s*reasoning|chain[- ]of[- ]thought|ledger)\s*[:=])/i.test(
      value,
    )
  );
}

function opaque(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID && pattern.test(value);
}

export function validateResponseGateOptIn(value: unknown): ResponseGateValidationResult<true> {
  if (!record(value) || !exact(value, ["explicitlyOptedIn", "eligible"])) return fail("unknown-field");
  return value.explicitlyOptedIn === true && value.eligible === true ? { ok: true, value: true } : fail("ineligible");
}

export function validateResponseGateEligibility(value: unknown): ResponseGateValidationResult<true> {
  if (!record(value) || !exact(value, ["explicitlyOptedIn", "eligible", "responseClass"])) return fail("unknown-field");
  return value.explicitlyOptedIn === true && value.eligible === true && value.responseClass === "assistant"
    ? { ok: true, value: true }
    : fail("ineligible");
}

export function validateResponseGateCapability(value: unknown): ResponseGateValidationResult<ResponseGateCapability> {
  if (!record(value)) return fail("malformed");
  if (exact(value, ["kind", "reason"])) {
    return ["missing", "unavailable", "not_transactional", "unsupported"].includes(value.reason as string)
      ? {
          ok: true,
          value: Object.freeze({
            kind: "incompatible",
            reason: value.reason as IncompatibleReason,
          }),
        }
      : fail("incompatible");
  }
  if (exact(value, ["explicitlyOptedIn", "createsDraftBeforeRelease", "hostOwnsRelease"])) {
    return value.explicitlyOptedIn === true &&
      value.createsDraftBeforeRelease === true &&
      value.hostOwnsRelease === true
      ? {
          ok: true,
          value: Object.freeze({
            kind: "compatible",
            schemaVersion: "1",
            explicitlyOptedIn: true,
            createsDraftBeforeRelease: true,
            hostOwnsRelease: true,
          }),
        }
      : fail("incompatible");
  }
  if (!exact(value, ["kind", "schemaVersion", "explicitlyOptedIn", "createsDraftBeforeRelease", "hostOwnsRelease"]))
    return fail("unknown-field");
  if (
    value.kind !== "compatible" ||
    value.schemaVersion !== "1" ||
    value.explicitlyOptedIn !== true ||
    value.createsDraftBeforeRelease !== true ||
    value.hostOwnsRelease !== true
  )
    return fail("incompatible");
  return {
    ok: true,
    value: Object.freeze({
      kind: "compatible",
      schemaVersion: "1",
      explicitlyOptedIn: true,
      createsDraftBeforeRelease: true,
      hostOwnsRelease: true,
    }),
  };
}

export function validateResponseGateIdentity(value: unknown): ResponseGateValidationResult<
  Readonly<{
    owner: ResponseGateOwner;
    sessionId: ResponseGateSessionId;
    assistantMessageId: ResponseGateAssistantMessageId;
    generation: ResponseGateGeneration;
  }>
> {
  if (!record(value) || !exact(value, ["owner", "sessionId", "assistantMessageId", "generation"]))
    return fail("unknown-field");
  if (
    !opaque(value.owner, IDENTIFIER) ||
    !opaque(value.sessionId, IDENTIFIER) ||
    !opaque(value.assistantMessageId, IDENTIFIER)
  )
    return fail("malformed");
  if (typeof value.generation !== "number" || !Number.isSafeInteger(value.generation) || value.generation < 0)
    return fail("malformed");
  return { ok: true, value: Object.freeze(value as ResponseGateBinding) };
}

export function validateResponseGateToken(value: unknown): ResponseGateValidationResult<ResponseGateTransactionToken> {
  return opaque(value, TOKEN) ? { ok: true, value: value as ResponseGateTransactionToken } : fail("malformed");
}

export function validateResponseGateBinding(
  actual: unknown,
  expected: ResponseGateBinding,
): ResponseGateValidationResult<true> {
  const checked = validateResponseGateIdentity(actual);
  if (!checked.ok) return checked;
  return checked.value.owner === expected.owner &&
    checked.value.sessionId === expected.sessionId &&
    checked.value.assistantMessageId === expected.assistantMessageId &&
    checked.value.generation === expected.generation
    ? { ok: true, value: true }
    : fail("mismatch");
}

export function validateFreshResponseGateToken(
  token: unknown,
  expected: ResponseGateTransactionToken,
  consumed = false,
): ResponseGateValidationResult<true> {
  const checked = validateResponseGateToken(token);
  if (!checked.ok) return checked;
  if (consumed) return fail("duplicate");
  return checked.value === expected ? { ok: true, value: true } : fail("stale");
}

export function validateBoundedResponseData(value: unknown): ResponseGateValidationResult<
  Readonly<{
    candidate: ImmutableResponseCandidate;
    sourcePacket: BoundedResponseSourcePacket;
  }>
> {
  if (!record(value) || !exact(value, ["candidateText", "sourceText"])) return fail("unknown-field");
  if (
    !safeText(value.candidateText, RESPONSE_GATE_MAX_CANDIDATE_CHARS) ||
    !safeText(value.sourceText, RESPONSE_GATE_MAX_SOURCE_CHARS)
  )
    return fail(
      (typeof value.candidateText === "string" && value.candidateText.length > RESPONSE_GATE_MAX_CANDIDATE_CHARS) ||
        (typeof value.sourceText === "string" && value.sourceText.length > RESPONSE_GATE_MAX_SOURCE_CHARS)
        ? "over-limit"
        : "unsafe-value",
    );
  return {
    ok: true,
    value: Object.freeze({
      candidate: Object.freeze({ text: value.candidateText }),
      sourcePacket: Object.freeze({ visibleText: value.sourceText }),
    }),
  };
}

export function validateBoundedReviewSummary(value: unknown): ResponseGateValidationResult<ReasoningReviewSummary> {
  if (
    !record(value) ||
    !exact(value, [
      "reviewedMessageId",
      "status",
      "invocation",
      "conclusion",
      "assumptions",
      "evidenceStatus",
      "openChallenges",
      "interpretiveBoundary",
    ])
  )
    return fail("unknown-field");
  if (
    !opaque(value.reviewedMessageId, IDENTIFIER) ||
    typeof value.status !== "string" ||
    !REVIEW_STATUSES.has(value.status as ReasoningReviewStatus) ||
    !["manual", "automatic"].includes(value.invocation as string)
  )
    return fail("incompatible");
  if (
    !safeText(value.conclusion, MAX_SUMMARY_TEXT) ||
    !Array.isArray(value.assumptions) ||
    value.assumptions.length > MAX_ASSUMPTIONS
  )
    return fail("malformed");
  if (!value.assumptions.every((item) => safeText(item, MAX_SUMMARY_TEXT))) return fail("unsafe-value");
  if (typeof value.evidenceStatus !== "string" || !SAFE_EVIDENCE.has(value.evidenceStatus)) return fail("incompatible");
  if (!Array.isArray(value.openChallenges) || value.openChallenges.length > MAX_CHALLENGES) return fail("ambiguous");
  for (const challenge of value.openChallenges) {
    if (
      !record(challenge) ||
      !exact(challenge, ["severity", "target", "reason"]) ||
      !["critical", "major", "minor", "note"].includes(challenge.severity as string)
    )
      return fail("incompatible");
    if (!opaque(challenge.target, IDENTIFIER) || !safeText(challenge.reason, MAX_SUMMARY_TEXT))
      return fail("unsafe-value");
  }
  if (!safeText(value.interpretiveBoundary, MAX_SUMMARY_TEXT)) return fail("malformed");
  return { ok: true, value: Object.freeze(value as ReasoningReviewSummary) };
}

function validateSummary(value: unknown): ResponseGateValidationResult<ConditionalSummary> {
  const summary = validateBoundedReviewSummary(value);
  if (!summary.ok) return summary;
  if (summary.value.status !== "conditional" || summary.value.invocation !== "automatic") return fail("incompatible");
  if (summary.value.evidenceStatus === "conflicted") return fail("incompatible");
  if (summary.value.openChallenges.length > 0) return fail("ambiguous");
  return { ok: true, value: summary.value as ConditionalSummary };
}

export function validateCalibratedReviewDecision(
  value: unknown,
): ResponseGateValidationResult<CalibratedReviewDecision> {
  if (!record(value) || !exact(value, ["kind", "calibration", "summary"])) return fail("unknown-field");
  if (value.kind !== "approved" || value.calibration !== "conditional") return fail("ambiguous");
  const summary = validateSummary(value.summary);
  return summary.ok
    ? { ok: true, value: Object.freeze({ kind: "approved", calibration: "conditional", summary: summary.value }) }
    : summary;
}

export function validateTerminalTransition(
  transaction: ResponseGateTransaction,
  binding: unknown,
  token: unknown,
  expectedToken: ResponseGateTransactionToken,
  consumed: boolean,
): ResponseGateValidationResult<true> {
  if (["released", "cancelled", "timed_out", "failed", "audit_failed"].includes(transaction.state))
    return fail("terminal");
  const identity = validateResponseGateBinding(binding, transaction.binding);
  if (!identity.ok) return identity;
  return validateFreshResponseGateToken(token, expectedToken, consumed);
}
