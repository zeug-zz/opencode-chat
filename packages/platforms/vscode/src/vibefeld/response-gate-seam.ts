import {
  applyCalibratedDecision,
  beginResponseGateReview,
  type CalibratedReviewDecision,
  cancelResponseGate,
  createResponseGateCapability,
  createResponseGateDraft,
  createResponseGateToken,
  type ResponseGateBinding,
  type ResponseGateCapability,
  type ResponseGateDraft,
  type ResponseGateTransaction,
  releaseResponseGate,
  type SafePublicationResult,
} from "./response-gate-contract";
import { mapResponseGateReviewOutcome } from "./response-gate-review-adapter";
import {
  validateCalibratedReviewDecision,
  validateResponseGateBinding,
  validateResponseGateCapability,
  validateResponseGateEligibility,
  validateResponseGateToken,
} from "./response-gate-validation";

type ActiveResponseGateTransaction = Extract<ResponseGateTransaction, { state: "draft" | "reviewing" | "approved" }>;
type ResponseGateTimer = unknown;
const timerRuntime = globalThis as unknown as {
  setTimeout: (callback: () => void, delay: number) => ResponseGateTimer;
  clearTimeout: (timer: ResponseGateTimer) => void;
};

export type ResponseGatePublication = (candidate: string) => void;
export type ResponseGateTokenSource = () => string;

export type ResponseGateOperationFailure = Readonly<{
  ok: false;
  code:
    | "unavailable"
    | "incompatible"
    | "ineligible"
    | "malformed"
    | "stale"
    | "terminal"
    | "not_approved"
    | "publication_failed";
}>;

export type ResponseGateOperationResult<T> = Readonly<{ ok: true; value: T }> | ResponseGateOperationFailure;

export type ResponseGateBeginInput = Readonly<{
  eligibility: unknown;
  binding: unknown;
  candidateText: unknown;
  sourceText: unknown;
}>;

export type ResponseGateReviewInput = Readonly<{
  token: unknown;
  binding: unknown;
  decision: unknown;
}>;

export type ResponseGateReviewSummaryInput = Readonly<{
  token: unknown;
  binding: unknown;
  summary: unknown;
}>;

export type ResponseGateReleaseInput = Readonly<{
  token: unknown;
  binding: unknown;
}>;

export type ResponseGateInvalidationInput = Readonly<{
  sessionId: ResponseGateBinding["sessionId"];
  assistantMessageId?: ResponseGateBinding["assistantMessageId"];
  generation?: ResponseGateBinding["generation"];
}>;

export interface ResponseGateSeam {
  getCapability(): ResponseGateCapability;
  begin(input: ResponseGateBeginInput): ResponseGateOperationResult<ResponseGateDraft>;
  review(input: ResponseGateReviewInput): ResponseGateOperationResult<ResponseGateTransaction>;
  reviewSummary(input: ResponseGateReviewSummaryInput): ResponseGateOperationResult<ResponseGateTransaction>;
  release(input: ResponseGateReleaseInput): ResponseGateOperationResult<SafePublicationResult>;
  cancel(input: ResponseGateReleaseInput): ResponseGateOperationResult<ResponseGateTransaction>;
  timeout(input: ResponseGateReleaseInput): ResponseGateOperationResult<ResponseGateTransaction>;
  invalidateSession(sessionId: ResponseGateBinding["sessionId"]): void;
  invalidateMessage(input: ResponseGateInvalidationInput): void;
  invalidateGeneration(input: Required<ResponseGateInvalidationInput>): void;
  dispose(): void;
}

export type ResponseGateInsertionPoint =
  | "host-publication"
  | "observer"
  | "post-stream"
  | "promptAsync"
  | "direct-send";

/** Only a host publication boundary can be reported as a response gate. */
export function classifyResponseGateInsertionPoint(point: ResponseGateInsertionPoint): ResponseGateCapability {
  return point === "host-publication"
    ? createResponseGateCapability({
        explicitlyOptedIn: true,
        createsDraftBeforeRelease: true,
        hostOwnsRelease: true,
      })
    : Object.freeze({ kind: "incompatible", reason: "not_transactional" });
}

const failure = (code: ResponseGateOperationFailure["code"]): ResponseGateOperationFailure => ({ ok: false, code });

function binding(value: unknown): ResponseGateBinding | undefined {
  const result = validateResponseGateBinding(value, value as ResponseGateBinding);
  return result.ok ? (value as ResponseGateBinding) : undefined;
}

function capability(proof: unknown): ResponseGateCapability {
  const result = validateResponseGateCapability(proof);
  return result.ok ? result.value : createResponseGateCapability(proof);
}

/**
 * Creates the private host-owned transaction boundary. The callback is kept
 * inside the seam and cannot be reached by begin/review or by an invalid
 * lifecycle operation.
 */
export function createResponseGateSeam(
  input: Readonly<{
    owner: ResponseGateBinding["owner"];
    capability: unknown;
    publish: ResponseGatePublication;
    tokenSource?: ResponseGateTokenSource;
    timeoutMs?: number;
  }>,
): ResponseGateSeam {
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new Error("invalid response-gate timeout");
  const resolvedCapability = capability(input.capability);
  const transactions = new Map<string, ResponseGateTransaction>();
  const consumed = new Set<string>();
  const timers = new Map<string, ResponseGateTimer>();
  let disposed = false;
  let tokenSequence = 0;
  const tokenSource =
    input.tokenSource ??
    (() => {
      tokenSequence += 1;
      return `response-gate-${tokenSequence.toString(36)}`;
    });

  const current = (token: unknown, expectedBinding: unknown): ResponseGateTransaction | undefined => {
    if (disposed) return undefined;
    const checkedToken = validateResponseGateToken(token);
    if (!checkedToken.ok || consumed.has(checkedToken.value)) return undefined;
    const transaction = transactions.get(checkedToken.value);
    if (!transaction || !validateResponseGateBinding(expectedBinding, transaction.binding).ok) return undefined;
    return transaction;
  };

  const terminalize = (transaction: ActiveResponseGateTransaction, value: ResponseGateTransaction): void => {
    if (consumed.has(transaction.token)) return;
    const timer = timers.get(transaction.token);
    if (timer !== undefined) timerRuntime.clearTimeout(timer);
    timers.delete(transaction.token);
    transactions.set(transaction.token, value);
    consumed.add(transaction.token);
  };

  const terminalizeReviewFailure = (transaction: ActiveResponseGateTransaction, code: string): void => {
    const reason = code === "unsafe-value" ? "unsafe" : code === "stale" ? "stale" : "review_failed";
    terminalize(transaction, Object.freeze({ state: "failed", binding: transaction.binding, reason }));
  };

  const invalidate = (matches: (transaction: ResponseGateTransaction) => boolean): void => {
    for (const transaction of transactions.values()) {
      if (!matches(transaction) || !["draft", "reviewing", "approved"].includes(transaction.state)) continue;
      terminalize(
        transaction as ActiveResponseGateTransaction,
        Object.freeze({ state: "failed", binding: transaction.binding, reason: "stale" }),
      );
    }
  };

  return {
    getCapability: () => resolvedCapability,
    begin(inputValue) {
      if (disposed) return failure("unavailable");
      if (resolvedCapability.kind !== "compatible") return failure("unavailable");
      if (!validateResponseGateEligibility(inputValue.eligibility).ok) return failure("ineligible");
      const checkedBinding = binding(inputValue.binding);
      if (!checkedBinding || checkedBinding.owner !== input.owner) return failure("incompatible");
      if (typeof inputValue.candidateText !== "string" || typeof inputValue.sourceText !== "string")
        return failure("malformed");
      let draft: ResponseGateDraft;
      try {
        draft = createResponseGateDraft({
          token: createResponseGateToken(tokenSource()),
          binding: checkedBinding,
          candidateText: inputValue.candidateText,
          sourceText: inputValue.sourceText,
        });
      } catch {
        return failure("malformed");
      }
      invalidate(
        (transaction) =>
          transaction.binding.sessionId === draft.binding.sessionId &&
          transaction.binding.assistantMessageId === draft.binding.assistantMessageId &&
          transaction.binding.generation < draft.binding.generation,
      );
      transactions.set(draft.token, draft);
      timers.set(
        draft.token,
        timerRuntime.setTimeout(() => {
          const currentTransaction = transactions.get(draft.token);
          if (
            currentTransaction &&
            !consumed.has(draft.token) &&
            ["draft", "reviewing", "approved"].includes(currentTransaction.state)
          )
            terminalize(
              currentTransaction as ActiveResponseGateTransaction,
              Object.freeze({ state: "timed_out", binding: currentTransaction.binding }),
            );
        }, timeoutMs),
      );
      return { ok: true, value: draft };
    },
    review(inputValue) {
      const transaction = current(inputValue.token, inputValue.binding);
      if (!transaction) return failure(consumed.has(String(inputValue.token)) ? "terminal" : "stale");
      if (transaction.state !== "draft") return failure("terminal");
      const reviewing = beginResponseGateReview(transaction);
      if (!reviewing.ok) return failure("terminal");
      const checkedDecision = validateCalibratedReviewDecision(inputValue.decision);
      if (!checkedDecision.ok) {
        terminalizeReviewFailure(transaction as ActiveResponseGateTransaction, checkedDecision.code);
        return failure(checkedDecision.code === "ambiguous" ? "malformed" : "incompatible");
      }
      if (checkedDecision.value.kind !== "approved") return failure("incompatible");
      if (checkedDecision.value.summary.reviewedMessageId !== transaction.binding.assistantMessageId) {
        terminalizeReviewFailure(transaction as ActiveResponseGateTransaction, "stale");
        return failure("stale");
      }
      const approved = applyCalibratedDecision(reviewing.value, checkedDecision.value as CalibratedReviewDecision);
      if (!approved.ok) return failure("terminal");
      transactions.set(transaction.token, approved.value);
      return { ok: true, value: approved.value };
    },
    reviewSummary(inputValue) {
      const outcome = mapResponseGateReviewOutcome(
        inputValue.summary,
        String(
          inputValue.binding && typeof inputValue.binding === "object"
            ? (inputValue.binding as Record<string, unknown>).assistantMessageId
            : "",
        ),
      );
      const transaction = current(inputValue.token, inputValue.binding);
      if (!transaction) return failure(outcome.kind === "invalid" && outcome.code === "stale" ? "stale" : "terminal");
      if (outcome.kind === "invalid") {
        terminalizeReviewFailure(transaction as ActiveResponseGateTransaction, outcome.code);
        return failure(
          outcome.code === "stale" ? "stale" : outcome.code === "ambiguous" ? "malformed" : "incompatible",
        );
      }
      if (outcome.kind === "terminal") {
        if (outcome.state === "audit_failed")
          terminalize(
            transaction as ActiveResponseGateTransaction,
            Object.freeze({
              state: "audit_failed",
              binding: transaction.binding,
              reason: outcome.reason === "provenance" ? "provenance" : "audit",
            }),
          );
        else terminalizeReviewFailure(transaction as ActiveResponseGateTransaction, outcome.reason);
        return failure("incompatible");
      }
      return this.review({ token: inputValue.token, binding: inputValue.binding, decision: outcome.decision });
    },
    release(inputValue) {
      const transaction = current(inputValue.token, inputValue.binding);
      if (!transaction) return failure(consumed.has(String(inputValue.token)) ? "terminal" : "stale");
      if (transaction.state !== "approved") return failure("not_approved");
      const publication: SafePublicationResult = {
        kind: "published",
        assistantMessageId: transaction.binding.assistantMessageId,
      };
      const released = releaseResponseGate(transaction, publication);
      if (!released.ok) return failure("stale");
      try {
        // Reserve the token before entering user code so reentrant/concurrent
        // release calls cannot publish a second time.
        consumed.add(transaction.token);
        const timer = timers.get(transaction.token);
        if (timer !== undefined) timerRuntime.clearTimeout(timer);
        timers.delete(transaction.token);
        transactions.set(
          transaction.token,
          Object.freeze({ state: "failed", binding: transaction.binding, reason: "publication_failed" }),
        );
        input.publish(transaction.candidate.text);
      } catch {
        return failure("publication_failed");
      }
      transactions.set(transaction.token, released.value);
      return { ok: true, value: publication };
    },
    cancel(inputValue) {
      const transaction = current(inputValue.token, inputValue.binding);
      if (!transaction) return failure(consumed.has(String(inputValue.token)) ? "terminal" : "stale");
      if (transaction.state !== "draft" && transaction.state !== "reviewing" && transaction.state !== "approved")
        return failure("terminal");
      const cancelled = cancelResponseGate(transaction);
      if (!cancelled.ok) return failure("terminal");
      terminalize(transaction as ActiveResponseGateTransaction, cancelled.value);
      return { ok: true, value: cancelled.value };
    },
    timeout(inputValue) {
      const transaction = current(inputValue.token, inputValue.binding);
      if (!transaction) return failure(consumed.has(String(inputValue.token)) ? "terminal" : "stale");
      if (!["draft", "reviewing", "approved"].includes(transaction.state)) return failure("terminal");
      const timedOut = Object.freeze({ state: "timed_out", binding: transaction.binding }) as ResponseGateTransaction;
      terminalize(transaction as ActiveResponseGateTransaction, timedOut);
      return { ok: true, value: timedOut };
    },
    invalidateSession(sessionId) {
      invalidate((transaction) => transaction.binding.sessionId === sessionId);
    },
    invalidateMessage(invalidation) {
      invalidate(
        (transaction) =>
          transaction.binding.sessionId === invalidation.sessionId &&
          transaction.binding.assistantMessageId === invalidation.assistantMessageId,
      );
    },
    invalidateGeneration(invalidation) {
      invalidate(
        (transaction) =>
          transaction.binding.sessionId === invalidation.sessionId &&
          transaction.binding.assistantMessageId === invalidation.assistantMessageId &&
          transaction.binding.generation < invalidation.generation,
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of timers.values()) timerRuntime.clearTimeout(timer);
      timers.clear();
      for (const transaction of transactions.values()) {
        if (!["draft", "reviewing", "approved"].includes(transaction.state)) continue;
        terminalize(
          transaction as ActiveResponseGateTransaction,
          Object.freeze({ state: "cancelled", binding: transaction.binding }),
        );
      }
    },
  };
}
