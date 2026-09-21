import { describe, expect, it } from "vitest";
import {
  applyCalibratedDecision,
  auditFailResponseGate,
  beginResponseGateReview,
  cancelResponseGate,
  createResponseGateCapability,
  createResponseGateDraft,
  createResponseGateToken,
  type ResponseGateAssistantMessageId,
  type ResponseGateBinding,
  type ResponseGateGeneration,
  type ResponseGateOwner,
  type ResponseGateSessionId,
  type ResponseGateTransaction,
  releaseResponseGate,
  timeoutResponseGate,
} from "../vibefeld/response-gate-contract";
import {
  validateBoundedResponseData,
  validateCalibratedReviewDecision,
  validateFreshResponseGateToken,
  validateResponseGateBinding,
  validateResponseGateCapability,
  validateResponseGateEligibility,
  validateResponseGateIdentity,
  validateResponseGateOptIn,
  validateTerminalTransition,
} from "../vibefeld/response-gate-validation";

const binding: ResponseGateBinding = {
  owner: "owner" as ResponseGateOwner,
  sessionId: "session" as ResponseGateSessionId,
  assistantMessageId: "message" as ResponseGateAssistantMessageId,
  generation: 1 as ResponseGateGeneration,
};

const candidate = () =>
  createResponseGateDraft({
    token: createResponseGateToken("opaque-1"),
    binding,
    candidateText: "candidate",
    sourceText: "bounded visible source",
  });

describe("private response-gate contract", () => {
  it("accepts only an explicitly opted-in host-owned transactional capability", () => {
    expect(createResponseGateCapability(undefined)).toEqual({ kind: "incompatible", reason: "missing" });
    expect(createResponseGateCapability({ explicitlyOptedIn: true })).toEqual({
      kind: "incompatible",
      reason: "not_transactional",
    });
    expect(
      createResponseGateCapability({
        explicitlyOptedIn: true,
        createsDraftBeforeRelease: true,
        hostOwnsRelease: true,
      }),
    ).toEqual({
      kind: "compatible",
      schemaVersion: "1",
      explicitlyOptedIn: true,
      createsDraftBeforeRelease: true,
      hostOwnsRelease: true,
    });
  });

  it("permits exactly draft -> reviewing -> approved -> released", () => {
    const reviewing = beginResponseGateReview(candidate());
    expect(reviewing.ok).toBe(true);
    if (!reviewing.ok) return;
    const approved = applyCalibratedDecision(reviewing.value, {
      kind: "approved",
      calibration: "conditional",
      summary: {
        reviewedMessageId: "message",
        status: "conditional",
        invocation: "automatic",
        conclusion: "bounded conclusion",
        assumptions: [],
        evidenceStatus: "unverified",
        openChallenges: [],
        interpretiveBoundary: "under stated assumptions",
      },
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok || approved.value.state !== "approved") return;
    expect(
      releaseResponseGate(approved.value, {
        kind: "published",
        assistantMessageId: "message" as ResponseGateAssistantMessageId,
      }),
    ).toMatchObject({ ok: true, value: { state: "released" } });
  });

  it("rejects release before approval, after terminal cancellation, and on a second release", () => {
    const draft = candidate();
    expect(
      releaseResponseGate(draft as unknown as Extract<ResponseGateTransaction, { state: "approved" }>, {
        kind: "published",
        assistantMessageId: "message" as ResponseGateAssistantMessageId,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
    const reviewing = beginResponseGateReview(draft);
    if (!reviewing.ok) return;
    const cancelled = cancelResponseGate(reviewing.value);
    expect(cancelled).toMatchObject({ ok: true, value: { state: "cancelled" } });
    if (!cancelled.ok) return;
    expect(
      releaseResponseGate(cancelled.value as unknown as Extract<ResponseGateTransaction, { state: "approved" }>, {
        kind: "published",
        assistantMessageId: "message" as ResponseGateAssistantMessageId,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
    const approved = applyCalibratedDecision(reviewing.value, {
      kind: "approved",
      calibration: "conditional",
      summary: {
        reviewedMessageId: "message",
        status: "conditional",
        invocation: "automatic",
        conclusion: "bounded conclusion",
        assumptions: [],
        evidenceStatus: "unverified",
        openChallenges: [],
      },
    });
    if (!approved.ok || approved.value.state !== "approved") return;
    const released = releaseResponseGate(approved.value, {
      kind: "published",
      assistantMessageId: "message" as ResponseGateAssistantMessageId,
    });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(Object.keys(released.value.publication)).toEqual(["kind", "assistantMessageId"]);
    expect(
      releaseResponseGate(
        released.value as unknown as Extract<ResponseGateTransaction, { state: "approved" }>,
        released.value.publication,
      ),
    ).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("keeps publication results safe and bounds retained data", () => {
    const draft = candidate();
    expect(Object.keys(draft)).toEqual(["state", "token", "binding", "candidate", "sourcePacket"]);
    expect(Object.keys(draft.sourcePacket)).toEqual(["visibleText"]);
    expect(() =>
      createResponseGateDraft({
        token: createResponseGateToken("opaque-2"),
        binding,
        candidateText: "x".repeat(16_385),
        sourceText: "source",
      }),
    ).toThrow();
    expect(() => createResponseGateToken("token with spaces")).toThrow();
  });

  it("makes timeout, audit failure, and rejected decisions terminal", () => {
    const reviewing = beginResponseGateReview(candidate());
    if (!reviewing.ok) return;
    expect(timeoutResponseGate(reviewing.value)).toMatchObject({ ok: true, value: { state: "timed_out" } });
    expect(auditFailResponseGate(reviewing.value, "provenance")).toMatchObject({
      ok: true,
      value: { state: "audit_failed", reason: "provenance" },
    });
    const rejected = applyCalibratedDecision(reviewing.value, {
      kind: "rejected",
      reason: "objection_unresolved",
    });
    expect(rejected).toMatchObject({ ok: true, value: { state: "failed" } });
    if (!rejected.ok) return;
    expect(
      releaseResponseGate(rejected.value as unknown as Extract<ResponseGateTransaction, { state: "approved" }>, {
        kind: "published",
        assistantMessageId: "message" as ResponseGateAssistantMessageId,
      }),
    ).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("fails closed on exact capability and opt-in data", () => {
    expect(validateResponseGateOptIn({ explicitlyOptedIn: true, eligible: true })).toEqual({ ok: true, value: true });
    expect(validateResponseGateOptIn({ explicitlyOptedIn: true, eligible: true, extra: false }).ok).toBe(false);
    expect(
      validateResponseGateEligibility({ explicitlyOptedIn: true, eligible: true, responseClass: "assistant" }),
    ).toEqual({
      ok: true,
      value: true,
    });
    expect(validateResponseGateEligibility({ explicitlyOptedIn: true, eligible: true, responseClass: "all" }).ok).toBe(
      false,
    );
    expect(
      validateResponseGateCapability({
        explicitlyOptedIn: true,
        createsDraftBeforeRelease: true,
        hostOwnsRelease: true,
      }).ok,
    ).toBe(true);
    expect(
      validateResponseGateCapability({
        explicitlyOptedIn: true,
        createsDraftBeforeRelease: true,
        hostOwnsRelease: true,
        shell: true,
      }).ok,
    ).toBe(false);
    expect(validateResponseGateCapability({ kind: "incompatible", reason: "unavailable" }).ok).toBe(true);
  });

  it("validates opaque identity, token binding, and bounded data without returning input", () => {
    expect(validateResponseGateIdentity({ ...binding, extra: "secret" }).ok).toBe(false);
    expect(validateResponseGateIdentity({ ...binding, owner: "owner with spaces" }).ok).toBe(false);
    expect(validateResponseGateBinding(binding, binding)).toEqual({ ok: true, value: true });
    expect(validateResponseGateBinding({ ...binding, generation: 2 }, binding)).toEqual({
      ok: false,
      code: "mismatch",
    });
    expect(validateFreshResponseGateToken("opaque-1", "opaque-1" as never)).toEqual({ ok: true, value: true });
    expect(validateFreshResponseGateToken("opaque-2", "opaque-1" as never)).toEqual({ ok: false, code: "stale" });
    expect(validateFreshResponseGateToken("opaque-1", "opaque-1" as never, true)).toEqual({
      ok: false,
      code: "duplicate",
    });
    const unsafe = "secret: do not echo";
    const result = validateBoundedResponseData({ candidateText: unsafe, sourceText: "source" });
    expect(result).toEqual({ ok: false, code: "unsafe-value" });
    expect(JSON.stringify(result)).not.toContain(unsafe);
    expect(validateBoundedResponseData({ candidateText: "x".repeat(16_385), sourceText: "source" })).toEqual({
      ok: false,
      code: "over-limit",
    });
  });

  it("accepts only a conditional calibrated summary", () => {
    const summary = {
      reviewedMessageId: "message",
      status: "conditional",
      invocation: "automatic",
      conclusion: "bounded conclusion",
      assumptions: [],
      evidenceStatus: "unverified",
      openChallenges: [],
      interpretiveBoundary: "under stated assumptions",
    } as const;
    expect(validateCalibratedReviewDecision({ kind: "approved", calibration: "conditional", summary }).ok).toBe(true);
    expect(
      validateCalibratedReviewDecision({
        kind: "approved",
        calibration: "conditional",
        summary: { ...summary, status: "structurally_checked" },
      }).ok,
    ).toBe(false);
    expect(
      validateCalibratedReviewDecision({
        kind: "approved",
        calibration: "conditional",
        summary: { ...summary, evidenceStatus: "conflicted" },
      }).ok,
    ).toBe(false);
    expect(
      validateCalibratedReviewDecision({
        kind: "approved",
        calibration: "conditional",
        summary: { ...summary, extra: "unsafe" },
      }).ok,
    ).toBe(false);
  });

  it("rejects stale, mismatched, and terminal transition inputs", () => {
    const draft = candidate();
    expect(validateTerminalTransition(draft, { ...binding, owner: "other" }, draft.token, draft.token, false)).toEqual({
      ok: false,
      code: "mismatch",
    });
    expect(validateTerminalTransition(draft, binding, "old-token", draft.token, false)).toEqual({
      ok: false,
      code: "stale",
    });
    expect(validateTerminalTransition(draft, binding, draft.token, draft.token, true)).toEqual({
      ok: false,
      code: "duplicate",
    });
    const reviewing = beginResponseGateReview(draft);
    if (!reviewing.ok) return;
    const terminal = cancelResponseGate(reviewing.value);
    if (!terminal.ok) return;
    expect(validateTerminalTransition(terminal.value, binding, draft.token, draft.token, false)).toEqual({
      ok: false,
      code: "terminal",
    });
  });
});
