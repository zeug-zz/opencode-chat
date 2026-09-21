import type { ReasoningReviewSummary } from "@opencode-chat/core";

/** Bounds for data retained while a response is withheld. */
export const RESPONSE_GATE_MAX_CANDIDATE_CHARS = 16_384;
export const RESPONSE_GATE_MAX_SOURCE_CHARS = 16_384;

export type ResponseGateCapability =
  | Readonly<{
      kind: "compatible";
      schemaVersion: "1";
      explicitlyOptedIn: true;
      createsDraftBeforeRelease: true;
      hostOwnsRelease: true;
    }>
  | Readonly<{
      kind: "incompatible";
      reason: "missing" | "unavailable" | "not_transactional" | "unsupported";
    }>;

export type ResponseGateOwner = string & { readonly __responseGateOwner: unique symbol };
export type ResponseGateSessionId = string & { readonly __responseGateSessionId: unique symbol };
export type ResponseGateAssistantMessageId = string & { readonly __responseGateMessageId: unique symbol };
export type ResponseGateGeneration = number & { readonly __responseGateGeneration: unique symbol };
export type ResponseGateTransactionToken = string & { readonly __responseGateToken: unique symbol };

export type ResponseGateBinding = Readonly<{
  owner: ResponseGateOwner;
  sessionId: ResponseGateSessionId;
  assistantMessageId: ResponseGateAssistantMessageId;
  generation: ResponseGateGeneration;
}>;

/** Candidate text is retained only inside the private gate and is never a publication result. */
export type ImmutableResponseCandidate = Readonly<{
  text: string;
}>;

/** Visible source text for review; this type has no prompt, reasoning, tool, or path fields. */
export type BoundedResponseSourcePacket = Readonly<{
  visibleText: string;
}>;

export type ResponseGateDraft = Readonly<{
  state: "draft";
  token: ResponseGateTransactionToken;
  binding: ResponseGateBinding;
  candidate: ImmutableResponseCandidate;
  sourcePacket: BoundedResponseSourcePacket;
}>;

export type ResponseGateReviewing = Readonly<{
  state: "reviewing";
  token: ResponseGateTransactionToken;
  binding: ResponseGateBinding;
  candidate: ImmutableResponseCandidate;
  sourcePacket: BoundedResponseSourcePacket;
}>;

export type CalibratedReviewDecision =
  | Readonly<{
      kind: "approved";
      calibration: "conditional";
      summary: Omit<ReasoningReviewSummary, "status"> & { status: "conditional" };
    }>
  | Readonly<{
      kind: "rejected";
      reason:
        | "objection_confirmed"
        | "objection_unresolved"
        | "evidence_conflict"
        | "malformed"
        | "ambiguous"
        | "provenance_failed";
    }>;

export type ResponseGateApproved = Readonly<{
  state: "approved";
  token: ResponseGateTransactionToken;
  binding: ResponseGateBinding;
  candidate: ImmutableResponseCandidate;
  decision: Extract<CalibratedReviewDecision, { kind: "approved" }>;
}>;

export type ResponseGateTerminalFailure =
  | Readonly<{ state: "cancelled"; binding: ResponseGateBinding }>
  | Readonly<{ state: "timed_out"; binding: ResponseGateBinding }>
  | Readonly<{
      state: "failed";
      binding: ResponseGateBinding;
      reason: "malformed" | "unsafe" | "stale" | "review_failed" | "publication_failed";
    }>
  | Readonly<{ state: "audit_failed"; binding: ResponseGateBinding; reason: "provenance" | "cleanup" | "audit" }>;

export type SafePublicationResult = Readonly<{
  kind: "published";
  assistantMessageId: ResponseGateAssistantMessageId;
}>;

export type ResponseGateReleased = Readonly<{
  state: "released";
  binding: ResponseGateBinding;
  publication: SafePublicationResult;
}>;

export type ResponseGateTransaction =
  | ResponseGateDraft
  | ResponseGateReviewing
  | ResponseGateApproved
  | ResponseGateReleased
  | ResponseGateTerminalFailure;

export type ResponseGateTransitionError = Readonly<{
  ok: false;
  reason:
    | "invalid_transition"
    | "terminal_state"
    | "token_consumed"
    | "decision_not_releasable"
    | "publication_mismatch";
}>;

export type ResponseGateTransitionResult<T extends ResponseGateTransaction> =
  | Readonly<{ ok: true; value: T }>
  | ResponseGateTransitionError;

export function createResponseGateCapability(proof: unknown): ResponseGateCapability {
  if (proof === undefined) return Object.freeze({ kind: "incompatible", reason: "missing" });
  if (typeof proof !== "object" || proof === null)
    return Object.freeze({ kind: "incompatible", reason: "not_transactional" });
  const value = proof as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    value.explicitlyOptedIn !== true ||
    value.createsDraftBeforeRelease !== true ||
    value.hostOwnsRelease !== true
  )
    return Object.freeze({ kind: "incompatible", reason: "not_transactional" });
  return Object.freeze({
    kind: "compatible",
    schemaVersion: "1",
    explicitlyOptedIn: true,
    createsDraftBeforeRelease: true,
    hostOwnsRelease: true,
  });
}

export function createResponseGateToken(value: string): ResponseGateTransactionToken {
  if (value.length === 0 || value.length > 128 || /[^A-Za-z0-9_-]/.test(value))
    throw new Error("invalid response-gate token");
  return value as ResponseGateTransactionToken;
}

export function createResponseGateDraft(input: {
  token: ResponseGateTransactionToken;
  binding: ResponseGateBinding;
  candidateText: string;
  sourceText: string;
}): ResponseGateDraft {
  const safe = (value: string): boolean =>
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    }) &&
    !/(?:https?:\/\/|\b(?:password|credential|secret|private\s*reasoning|chain[- ]of[- ]thought|ledger)\s*[:=])/i.test(
      value,
    );
  if (
    input.candidateText.length > RESPONSE_GATE_MAX_CANDIDATE_CHARS ||
    input.sourceText.length > RESPONSE_GATE_MAX_SOURCE_CHARS ||
    !safe(input.candidateText) ||
    !safe(input.sourceText)
  )
    throw new Error("response-gate data exceeds safe bounds");
  return Object.freeze({
    state: "draft",
    token: input.token,
    binding: Object.freeze({ ...input.binding }),
    candidate: Object.freeze({ text: input.candidateText }),
    sourcePacket: Object.freeze({ visibleText: input.sourceText }),
  });
}

export function beginResponseGateReview(
  transaction: ResponseGateDraft,
): ResponseGateTransitionResult<ResponseGateReviewing> {
  if (transaction.state !== "draft") return { ok: false, reason: "invalid_transition" };
  return { ok: true, value: Object.freeze({ ...transaction, state: "reviewing" }) };
}

export function applyCalibratedDecision(
  transaction: ResponseGateReviewing,
  decision: CalibratedReviewDecision,
): ResponseGateTransitionResult<ResponseGateApproved> | ResponseGateTransitionResult<ResponseGateTerminalFailure> {
  if (transaction.state !== "reviewing") return { ok: false, reason: "invalid_transition" };
  if (decision.kind !== "approved")
    return {
      ok: true,
      value: Object.freeze({ state: "failed", binding: transaction.binding, reason: "review_failed" }),
    };
  return {
    ok: true,
    value: Object.freeze({
      state: "approved",
      token: transaction.token,
      binding: transaction.binding,
      candidate: transaction.candidate,
      decision: Object.freeze(decision),
    }),
  };
}

export function releaseResponseGate(
  transaction: ResponseGateApproved,
  publication: SafePublicationResult,
): ResponseGateTransitionResult<ResponseGateReleased> {
  if (transaction.state !== "approved") return { ok: false, reason: "invalid_transition" };
  if (publication.assistantMessageId !== transaction.binding.assistantMessageId)
    return { ok: false, reason: "publication_mismatch" };
  return {
    ok: true,
    value: Object.freeze({ state: "released", binding: transaction.binding, publication: Object.freeze(publication) }),
  };
}

export function cancelResponseGate(
  transaction: Extract<ResponseGateTransaction, { state: "draft" | "reviewing" | "approved" }>,
): ResponseGateTransitionResult<ResponseGateTerminalFailure> {
  if (!["draft", "reviewing", "approved"].includes(transaction.state)) return { ok: false, reason: "terminal_state" };
  return { ok: true, value: Object.freeze({ state: "cancelled", binding: transaction.binding }) };
}

export function timeoutResponseGate(
  transaction: Extract<ResponseGateTransaction, { state: "draft" | "reviewing" | "approved" }>,
): ResponseGateTransitionResult<ResponseGateTerminalFailure> {
  if (!["draft", "reviewing", "approved"].includes(transaction.state)) return { ok: false, reason: "terminal_state" };
  return { ok: true, value: Object.freeze({ state: "timed_out", binding: transaction.binding }) };
}

export function auditFailResponseGate(
  transaction: Extract<ResponseGateTransaction, { state: "draft" | "reviewing" | "approved" }>,
  reason: Extract<ResponseGateTerminalFailure, { state: "audit_failed" }>["reason"],
): ResponseGateTransitionResult<ResponseGateTerminalFailure> {
  if (!["draft", "reviewing", "approved"].includes(transaction.state)) return { ok: false, reason: "terminal_state" };
  return { ok: true, value: Object.freeze({ state: "audit_failed", binding: transaction.binding, reason }) };
}

export function failResponseGate(
  transaction: Extract<ResponseGateTransaction, { state: "draft" | "reviewing" | "approved" }>,
  failure: Extract<ResponseGateTerminalFailure, { state: "failed" | "audit_failed" }>,
): ResponseGateTransitionResult<ResponseGateTerminalFailure> {
  if (!["draft", "reviewing", "approved"].includes(transaction.state)) return { ok: false, reason: "terminal_state" };
  if (failure.binding !== transaction.binding) return { ok: false, reason: "invalid_transition" };
  return { ok: true, value: Object.freeze(failure) };
}
