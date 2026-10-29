import { randomUUID } from "node:crypto";
import {
  MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS,
  MAX_RESTRICTED_REVIEW_TEXT_LENGTH,
  mintRestrictedReviewProvenance,
  type RestrictedReviewFailure,
  type RestrictedReviewProvider,
  type RestrictedReviewRole,
  type RestrictedReviewTextResult,
  type RestrictedReviewToken,
} from "@opencode-chat/agent-opencode";
import type {
  AdversarialReviewRole,
  ObjectionProposal,
  ReviewContextMetadata,
  ReviewPacket,
  VerifierResult,
} from "./adversarial-review-contract";
import { RESTRICTED_REVIEW_PERMISSION_ATTESTATION } from "./adversarial-review-contract";
import type { RestrictedReviewAdapter } from "./adversarial-review-seam";
import {
  type AdversarialValidationErrorCode,
  validateObjectionProposal,
  validateVerifierResult,
} from "./adversarial-review-validation";
import { HIDDEN_SESSION_MARKER_PREFIX, hiddenSessionRegistry } from "./hidden-session-registry";
import {
  createReasoningDiagnosticClock,
  elapsedReasoningMilliseconds,
  type ReasoningDiagnosticOutcome,
  type ReasoningDiagnosticReporter,
} from "./reasoning-diagnostics";

type AdapterOptions = Readonly<{
  provider: RestrictedReviewProvider;
  /** Creates an isolated, generation-bound provider for one automatic assessment. */
  createAutomaticProvider?: () => Promise<RestrictedReviewProvider | undefined>;
  stageTimeoutMs?: number;
  diagnostics?: ReasoningDiagnosticReporter;
  now?: () => number;
}>;

type AutomaticReview = {
  controller: AbortController;
  externalSignal?: AbortSignal;
  provider?: RestrictedReviewProvider;
  token?: RestrictedReviewToken;
  sessionId?: string;
  registration?: string;
  handle?: string;
  beginning?: Promise<number>;
  cleanup?: Promise<void>;
  onExternalAbort?: () => void;
};

type SessionRecord = Readonly<{
  sessionId: string;
  role: RestrictedReviewRole;
  registration: string;
  provider: RestrictedReviewProvider;
  automaticReview?: AutomaticReview;
}>;
const DISPOSAL_TIMEOUT_MS = 5_000;
const ABORTED = Symbol("restricted-review-adapter-aborted");

/**
 * Host-private declaration of the reasoning-assist stages this adapter serves.
 * No other, extra, wildcarded, or unknown stage is accepted.
 */
export const REASONING_ASSIST_STAGES = Object.freeze(["architect", "critic"] as const);
export type ReasoningAssistStage = (typeof REASONING_ASSIST_STAGES)[number];

export type ReasoningAssistContextMetadata = Readonly<{
  handle: string;
  provenance: Readonly<{ identity: string; role: ReasoningAssistStage; contextNumber: 1 | 2 }>;
}>;

export type ReasoningAssistStageFailureReason =
  | "unknown-role"
  | "cancelled"
  | "timeout"
  | "malformed"
  | "oversized"
  | "model-failure";

export type ReasoningAssistStageTextResult =
  | Readonly<{ ok: true; role: ReasoningAssistStage; text: string }>
  | Readonly<{ ok: false; role: ReasoningAssistStage | "host"; reason: ReasoningAssistStageFailureReason }>;

/**
 * Validates a stage declaration before any context is created. Only the exact
 * supported stages pass; wildcard, duplicate, extra, unknown, empty, and
 * non-array declarations fail closed.
 */
export function validateReasoningAssistStageDeclaration(value: unknown): readonly ReasoningAssistStage[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const stages: ReasoningAssistStage[] = [];
  for (const entry of value) {
    if (entry !== "architect" && entry !== "critic") return undefined;
    if (stages.includes(entry)) return undefined;
    stages.push(entry);
  }
  return Object.freeze(stages);
}

export type ReasoningAssistRestrictedReviewAdapter = RestrictedReviewAdapter &
  Readonly<{
    supportedStages: readonly ReasoningAssistStage[];
    createReasoningAssistContext: (
      role: ReasoningAssistStage,
      signal?: AbortSignal,
    ) => Promise<ReasoningAssistContextMetadata | undefined>;
    createManualReviewArchitectContext: (signal?: AbortSignal) => Promise<ReasoningAssistContextMetadata | undefined>;
    runReasoningAssistStage: (
      context: ReasoningAssistContextMetadata,
      packetText: string,
      role: ReasoningAssistStage,
      signal?: AbortSignal,
    ) => Promise<ReasoningAssistStageTextResult | undefined>;
    cancelReasoningAssistContext: (context: ReasoningAssistContextMetadata) => Promise<void>;
    dispose: () => Promise<void>;
  }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

type ParsedStageText =
  | Readonly<{ ok: true; value: Record<string, unknown> }>
  | Readonly<{ ok: false; outcome: "stage-oversized" | "json-parse-failed" | "wrong-top-level-keys" }>;

function parseStageText(text: string, keys: readonly string[]): ParsedStageText {
  if (text.length > MAX_RESTRICTED_REVIEW_TEXT_LENGTH) return { ok: false, outcome: "stage-oversized" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, outcome: "json-parse-failed" };
  }
  return isRecord(value) && exactKeys(value, keys)
    ? { ok: true, value }
    : { ok: false, outcome: "wrong-top-level-keys" };
}

function boundedError(): Error {
  return new Error("Restricted review cleanup failed.");
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const removeAbortListener = (): void => signal.removeEventListener("abort", onAbort);
    const onAbort = (): void => {
      removeAbortListener();
      resolve(ABORTED);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        removeAbortListener();
        resolve(value);
      },
      (error: unknown) => {
        removeAbortListener();
        reject(error);
      },
    );
  });
}

function stageFailureReason(code: RestrictedReviewFailure["code"]): ReasoningAssistStageFailureReason {
  if (code === "timeout") return "timeout";
  if (code === "invalid-response") return "malformed";
  return "model-failure";
}

async function disposeSession(provider: RestrictedReviewProvider, sessionId: string): Promise<boolean> {
  let succeeded = true;
  let cancel: Promise<unknown>;
  try {
    cancel = provider.cancel(sessionId);
  } catch {
    cancel = Promise.resolve();
    succeeded = false;
  }
  try {
    const result = await cancel;
    if (typeof result === "object" && result !== null && "ok" in result && result.ok === false) succeeded = false;
  } catch {
    // Deletion is attempted even when cancellation fails.
    succeeded = false;
  }
  try {
    const result = await provider.delete(sessionId);
    if (!result.ok) succeeded = false;
  } catch {
    // Deactivation is best effort and must not reject.
    succeeded = false;
  }
  return succeeded;
}

/** Bridges the agent-package provider to the provider-neutral host seam. */
export function createRestrictedReviewAdapter({
  provider,
  createAutomaticProvider,
  stageTimeoutMs,
  diagnostics,
  now,
}: AdapterOptions): ReasoningAssistRestrictedReviewAdapter {
  const sessions = new Map<string, SessionRecord>();
  const stageSessions = new Map<string, SessionRecord>();
  const automaticReviews = new Set<AutomaticReview>();
  const timeoutMs = stageTimeoutMs ?? MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS;
  const diagnosticNow = createReasoningDiagnosticClock(now);
  const report = (
    stage: "architect-provider" | "architect-readiness" | "architect-context" | "architect-cleanup",
    outcome: ReasoningDiagnosticOutcome,
    startedAt?: number,
  ): void => {
    try {
      const elapsedMs = startedAt === undefined ? undefined : elapsedReasoningMilliseconds(diagnosticNow, startedAt);
      diagnostics?.({ stage, outcome, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
    } catch {
      // Provider/context diagnostics cannot alter review lifecycle behavior.
    }
  };
  const reportManualReviewer = (
    role: "prover" | "verifier",
    outcome: ReasoningDiagnosticOutcome,
    startedAt?: number,
    validationCode?: AdversarialValidationErrorCode,
  ): void => {
    try {
      const stage = role === "prover" ? "manual-prover" : "manual-verifier";
      const elapsedMs = startedAt === undefined ? undefined : elapsedReasoningMilliseconds(diagnosticNow, startedAt);
      diagnostics?.({
        stage,
        outcome,
        ...(validationCode === undefined ? {} : { validationCode }),
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
      });
    } catch {
      // Reviewer diagnostics are observational and cannot change review outcomes.
    }
  };
  let disposed = false;

  const createHiddenChild = async (
    childProvider: RestrictedReviewProvider,
    signal?: AbortSignal,
    automaticReview?: AutomaticReview,
  ): Promise<Readonly<{ sessionId: string; registration: string }> | undefined> => {
    if (disposed || isAborted(signal)) return undefined;
    const marker = `${HIDDEN_SESSION_MARKER_PREFIX}${randomUUID()}`;
    const registration = hiddenSessionRegistry.beginHiddenSession(marker);
    if (!registration) return undefined;
    if (automaticReview) automaticReview.registration = registration;
    try {
      const created = await childProvider.createSession(marker);
      if (!created.ok) {
        hiddenSessionRegistry.releaseHiddenSession(registration);
        if (automaticReview?.registration === registration) automaticReview.registration = undefined;
        return undefined;
      }
      if (disposed || isAborted(signal)) {
        hiddenSessionRegistry.releaseHiddenSession(registration);
        if (automaticReview?.registration === registration) automaticReview.registration = undefined;
        if (automaticReview) {
          automaticReview.sessionId = created.sessionId;
          await cleanupAutomaticReview(automaticReview);
        } else {
          await disposeSession(childProvider, created.sessionId);
        }
        return undefined;
      }
      if (!hiddenSessionRegistry.confirmHiddenSession(registration, created.sessionId)) {
        hiddenSessionRegistry.releaseHiddenSession(registration);
        if (automaticReview?.registration === registration) automaticReview.registration = undefined;
        if (automaticReview) {
          automaticReview.sessionId = created.sessionId;
          await cleanupAutomaticReview(automaticReview);
        } else {
          await disposeSession(childProvider, created.sessionId);
        }
        return undefined;
      }
      if (automaticReview) {
        automaticReview.registration = undefined;
        automaticReview.sessionId = created.sessionId;
      }
      return { sessionId: created.sessionId, registration };
    } catch {
      hiddenSessionRegistry.releaseHiddenSession(registration);
      if (automaticReview?.registration === registration) automaticReview.registration = undefined;
      return undefined;
    }
  };

  const cleanupAutomaticReview = (review: AutomaticReview): Promise<void> => {
    if (review.cleanup) return review.cleanup;
    const cleanupStartedAt = diagnosticNow();
    report("architect-cleanup", "started");
    let cleanupFailed = false;
    const cleanup = Promise.resolve()
      .then(async () => {
        if (review.beginning) await review.beginning.catch(() => 0);
        const reviewProvider = review.provider;
        if (reviewProvider) {
          if (review.token !== undefined && review.token > 0) {
            try {
              const result = await reviewProvider.cancelReview(review.token);
              if (!result.ok) {
                cleanupFailed = true;
                if (review.sessionId)
                  cleanupFailed = !(await disposeSession(reviewProvider, review.sessionId)) || cleanupFailed;
              }
            } catch {
              cleanupFailed = true;
              if (review.sessionId)
                cleanupFailed = !(await disposeSession(reviewProvider, review.sessionId)) || cleanupFailed;
            }
          } else if (review.sessionId) {
            cleanupFailed = !(await disposeSession(reviewProvider, review.sessionId)) || cleanupFailed;
          }
          reviewProvider.invalidate();
        }
        if (review.registration) hiddenSessionRegistry.releaseHiddenSession(review.registration);
        if (review.sessionId) hiddenSessionRegistry.forgetHiddenSession(review.sessionId);
        if (review.handle) stageSessions.delete(review.handle);
      })
      .catch((error: unknown) => {
        cleanupFailed = true;
        throw error;
      })
      .finally(() => {
        report("architect-cleanup", cleanupFailed ? "failed" : "completed", cleanupStartedAt);
        if (review.externalSignal && review.onExternalAbort) {
          review.externalSignal.removeEventListener("abort", review.onExternalAbort);
        }
        automaticReviews.delete(review);
      });
    review.cleanup = cleanup;
    review.controller.abort();
    return cleanup;
  };

  const contextFor = (
    role: AdversarialReviewRole,
    contextProvider: RestrictedReviewProvider,
    sessionId: string,
    registration: string,
    provenance: ReturnType<typeof mintRestrictedReviewProvenance>,
  ): ReviewContextMetadata => {
    sessions.set(provenance.handle, { sessionId, role, registration, provider: contextProvider });
    return {
      handle: provenance.handle as ReviewContextMetadata["handle"],
      provenance: {
        identity: provenance.identity,
        role,
        contextNumber: provenance.contextNumber,
      },
    };
  };

  const run = async (
    context: ReviewContextMetadata,
    packetText: string,
    role: "prover" | "verifier",
    startedAt: number,
    signal: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> => {
    let session: SessionRecord | undefined;
    try {
      session = typeof context?.handle === "string" ? sessions.get(context.handle) : undefined;
    } catch {
      reportManualReviewer(role, "thrown-exception", startedAt);
      return undefined;
    }
    if (!session || session.role !== role) {
      reportManualReviewer(role, "context-ownership-failed", startedAt);
      return undefined;
    }
    if (isAborted(signal)) {
      reportManualReviewer(role, "stage-cancelled", startedAt);
      return undefined;
    }

    let result: RestrictedReviewTextResult;
    try {
      result = await session.provider.runStage(session.sessionId, packetText, timeoutMs, role, signal);
    } catch {
      reportManualReviewer(role, isAborted(signal) ? "stage-cancelled" : "thrown-exception", startedAt);
      return undefined;
    }
    if (isAborted(signal)) {
      reportManualReviewer(role, "stage-cancelled", startedAt);
      return undefined;
    }
    if (!result.ok) {
      const outcome =
        result.code === "sdk-error"
          ? "provider-sdk-error"
          : result.code === "timeout"
            ? "provider-timeout"
            : "provider-invalid-response";
      reportManualReviewer(role, outcome, startedAt);
      return undefined;
    }
    if (typeof result.text !== "string") {
      reportManualReviewer(role, "provider-invalid-response", startedAt);
      return undefined;
    }

    const parsed = parseStageText(
      result.text,
      role === "prover" ? ["proposalId", "objections"] : ["proposalId", "dispositions"],
    );
    if (!parsed.ok) {
      reportManualReviewer(role, parsed.outcome, startedAt);
      return undefined;
    }
    return parsed.value;
  };

  return {
    attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
    supportedStages: REASONING_ASSIST_STAGES,

    async createContext(role, signal) {
      if (disposed || isAborted(signal)) return undefined;
      const provenance = mintRestrictedReviewProvenance(role);
      const hidden = await createHiddenChild(provider, signal);
      if (!hidden) return undefined;
      return contextFor(role, provider, hidden.sessionId, hidden.registration, provenance);
    },

    async createReasoningAssistContext(role, signal) {
      const stage = validateReasoningAssistStageDeclaration([role])?.[0];
      if (!stage || disposed || isAborted(signal) || !createAutomaticProvider) return undefined;
      const automaticReview: AutomaticReview = {
        controller: new AbortController(),
        ...(signal ? { externalSignal: signal } : {}),
      };
      automaticReviews.add(automaticReview);
      if (signal) {
        automaticReview.onExternalAbort = () => {
          void cleanupAutomaticReview(automaticReview);
        };
        signal.addEventListener("abort", automaticReview.onExternalAbort, { once: true });
      }

      let contextCreated = false;
      let contextStartedAt: number | undefined;
      let contextReported = false;
      const reportContext = (outcome: ReasoningDiagnosticOutcome): void => {
        if (contextStartedAt === undefined || contextReported) return;
        contextReported = true;
        report("architect-context", outcome, contextStartedAt);
      };
      try {
        const providerStartedAt = diagnosticNow();
        report("architect-provider", "started");
        const providerCreation = Promise.resolve().then(createAutomaticProvider);
        let resolvedProvider: RestrictedReviewProvider | undefined | typeof ABORTED;
        try {
          resolvedProvider = await awaitWithSignal(providerCreation, automaticReview.controller.signal);
        } catch {
          report("architect-provider", "failed", providerStartedAt);
          throw new Error("Restricted review provider unavailable.");
        }
        if (resolvedProvider === ABORTED) {
          report("architect-provider", "cancelled", providerStartedAt);
          void providerCreation.then(
            (lateProvider) => lateProvider?.invalidate(),
            () => undefined,
          );
          return undefined;
        }
        if (!resolvedProvider || resolvedProvider === provider) {
          report("architect-provider", "unavailable", providerStartedAt);
          return undefined;
        }
        report("architect-provider", "ready", providerStartedAt);
        automaticReview.provider = resolvedProvider;
        if (disposed || automaticReview.cleanup || isAborted(automaticReview.controller.signal)) return undefined;

        const readinessStartedAt = diagnosticNow();
        report("architect-readiness", "started");
        const readiness = Promise.resolve().then(
          async () => (await resolvedProvider.checkReadiness()) === true && resolvedProvider.isReady(),
        );
        let ready: boolean | typeof ABORTED;
        try {
          ready = await awaitWithSignal(readiness, automaticReview.controller.signal);
        } catch {
          report("architect-readiness", "failed", readinessStartedAt);
          throw new Error("Restricted review readiness unavailable.");
        }
        if (ready === ABORTED) {
          report("architect-readiness", "cancelled", readinessStartedAt);
          return undefined;
        }
        if (!ready) {
          report("architect-readiness", "unavailable", readinessStartedAt);
          return undefined;
        }
        report("architect-readiness", "ready", readinessStartedAt);
        if (disposed || automaticReview.cleanup || isAborted(automaticReview.controller.signal)) return undefined;

        contextStartedAt = diagnosticNow();
        report("architect-context", "started");
        const beginning = Promise.resolve()
          .then(() => resolvedProvider.beginReview())
          .then(async (token) => {
            if (!Number.isSafeInteger(token) || token <= 0) return 0;
            if (automaticReview.cleanup || isAborted(automaticReview.controller.signal) || disposed) {
              try {
                await resolvedProvider.cancelReview(token);
              } catch {
                // The provider is invalidated below; never reuse this late token.
              }
              return 0;
            }
            automaticReview.token = token;
            return token;
          });
        automaticReview.beginning = beginning;
        let token: number | typeof ABORTED;
        try {
          token = await awaitWithSignal(beginning, automaticReview.controller.signal);
        } catch {
          reportContext("failed");
          throw new Error("Restricted review context unavailable.");
        }
        if (token === ABORTED) {
          reportContext("cancelled");
          return undefined;
        }
        if (!Number.isSafeInteger(token) || token <= 0) {
          reportContext("unavailable");
          return undefined;
        }
        if (disposed || automaticReview.cleanup || isAborted(automaticReview.controller.signal)) return undefined;

        const provenance = mintRestrictedReviewProvenance(stage);
        let hidden: Readonly<{ sessionId: string; registration: string }> | undefined;
        try {
          hidden = await createHiddenChild(resolvedProvider, automaticReview.controller.signal, automaticReview);
        } catch {
          reportContext("failed");
          throw new Error("Restricted review context unavailable.");
        }
        if (!hidden) {
          reportContext(isAborted(automaticReview.controller.signal) ? "cancelled" : "unavailable");
          return undefined;
        }
        automaticReview.handle = provenance.handle;
        stageSessions.set(provenance.handle, {
          sessionId: hidden.sessionId,
          role: stage,
          registration: hidden.registration,
          provider: resolvedProvider,
          automaticReview,
        });
        if (disposed || automaticReview.cleanup || isAborted(automaticReview.controller.signal)) return undefined;
        contextCreated = true;
        reportContext("ready");
        return {
          handle: provenance.handle,
          provenance: {
            identity: provenance.identity,
            role: stage,
            contextNumber: provenance.contextNumber,
          },
        };
      } catch {
        return undefined;
      } finally {
        if (!contextCreated) await cleanupAutomaticReview(automaticReview);
        if (contextStartedAt !== undefined && !contextReported) {
          reportContext(isAborted(automaticReview.controller.signal) ? "cancelled" : "unavailable");
        }
      }
    },

    async createManualReviewArchitectContext(signal) {
      if (disposed || isAborted(signal)) return undefined;
      const contextStartedAt = diagnosticNow();
      report("architect-context", "started");
      let hidden: Readonly<{ sessionId: string; registration: string }> | undefined;
      try {
        hidden = await createHiddenChild(provider, signal);
      } catch {
        report("architect-context", "failed", contextStartedAt);
        return undefined;
      }
      if (!hidden) {
        report("architect-context", isAborted(signal) ? "cancelled" : "unavailable", contextStartedAt);
        return undefined;
      }
      const provenance = mintRestrictedReviewProvenance("architect");
      stageSessions.set(provenance.handle, {
        sessionId: hidden.sessionId,
        role: "architect",
        registration: hidden.registration,
        provider,
      });
      if (disposed || isAborted(signal)) {
        stageSessions.delete(provenance.handle);
        if (disposed) await disposeSession(provider, hidden.sessionId);
        hiddenSessionRegistry.forgetHiddenSession(hidden.sessionId);
        return undefined;
      }
      return {
        handle: provenance.handle,
        provenance: {
          identity: provenance.identity,
          role: "architect",
          contextNumber: provenance.contextNumber,
        },
      };
    },

    async runReasoningAssistStage(context, packetText, role, signal) {
      const stage = validateReasoningAssistStageDeclaration([role])?.[0];
      if (!stage) return { ok: false, role: "host", reason: "unknown-role" };
      if (isAborted(signal)) return { ok: false, role: stage, reason: "cancelled" };
      const session = typeof context?.handle === "string" ? stageSessions.get(context.handle) : undefined;
      if (!session || session.role !== stage) return undefined;
      let result: RestrictedReviewTextResult;
      try {
        result = signal
          ? await session.provider.runStage(session.sessionId, packetText, timeoutMs, stage, signal)
          : await session.provider.runStage(session.sessionId, packetText, timeoutMs, stage);
      } catch {
        return { ok: false, role: stage, reason: "model-failure" };
      }
      if (isAborted(signal) || isAborted(session.automaticReview?.controller.signal))
        return { ok: false, role: stage, reason: "cancelled" };
      if (!result.ok) return { ok: false, role: stage, reason: stageFailureReason(result.code) };
      if (result.text.length > MAX_RESTRICTED_REVIEW_TEXT_LENGTH)
        return { ok: false, role: stage, reason: "oversized" };
      return { ok: true, role: stage, text: result.text };
    },

    async cancelReasoningAssistContext(context) {
      const session = typeof context?.handle === "string" ? stageSessions.get(context.handle) : undefined;
      if (!session) return;
      stageSessions.delete(context.handle);
      if (session.automaticReview) {
        await cleanupAutomaticReview(session.automaticReview);
        return;
      }
      const cleanupStartedAt = diagnosticNow();
      report("architect-cleanup", "started");
      let cleanupFailed = false;
      try {
        cleanupFailed = !(await disposeSession(session.provider, session.sessionId));
      } catch {
        cleanupFailed = true;
        throw new Error("Restricted review cleanup failed.");
      } finally {
        hiddenSessionRegistry.forgetHiddenSession(session.sessionId);
        report("architect-cleanup", cleanupFailed ? "failed" : "completed", cleanupStartedAt);
      }
    },

    async runProver(context, packet, signal) {
      const startedAt = diagnosticNow();
      reportManualReviewer("prover", "started");
      try {
        const text = JSON.stringify(packet);
        const child = await run(context, text, "prover", startedAt, signal);
        if (!child) return undefined;
        if (isAborted(signal)) {
          reportManualReviewer("prover", "stage-cancelled", startedAt);
          return undefined;
        }
        const checked = validateObjectionProposal(
          {
            proposalId: child.proposalId,
            prover: context.provenance,
            objections: child.objections,
          },
          packet,
        );
        if (!checked.ok) {
          reportManualReviewer("prover", "validator-failed", startedAt, checked.code);
          return undefined;
        }
        reportManualReviewer("prover", "success", startedAt);
        return checked.value satisfies ObjectionProposal;
      } catch {
        reportManualReviewer("prover", isAborted(signal) ? "stage-cancelled" : "thrown-exception", startedAt);
        return undefined;
      }
    },

    async runVerifier(context, packet, proposal, signal) {
      const startedAt = diagnosticNow();
      reportManualReviewer("verifier", "started");
      try {
        const packetText = JSON.stringify(packet);
        const proposalText = JSON.stringify({
          proposalId: proposal.proposalId,
          objections: proposal.objections,
        });
        const child = await run(context, `${packetText}\n${proposalText}`, "verifier", startedAt, signal);
        if (!child) return undefined;
        if (isAborted(signal)) {
          reportManualReviewer("verifier", "stage-cancelled", startedAt);
          return undefined;
        }
        const checked = validateVerifierResult(
          {
            verifier: context.provenance,
            proposalId: child.proposalId,
            dispositions: child.dispositions,
          },
          proposal,
        );
        if (!checked.ok) {
          reportManualReviewer("verifier", "validator-failed", startedAt, checked.code);
          return undefined;
        }
        reportManualReviewer("verifier", "success", startedAt);
        return checked.value satisfies VerifierResult;
      } catch {
        reportManualReviewer("verifier", isAborted(signal) ? "stage-cancelled" : "thrown-exception", startedAt);
        return undefined;
      }
    },

    async cancelContext(context) {
      const session = sessions.get(context.handle);
      if (!session) throw boundedError();
      let failed = false;
      try {
        const cancelled = await session.provider.cancel(session.sessionId);
        failed = !cancelled.ok;
      } catch {
        failed = true;
      }
      try {
        const deleted = await session.provider.delete(session.sessionId);
        failed ||= !deleted.ok;
      } catch {
        failed = true;
      } finally {
        sessions.delete(context.handle);
        hiddenSessionRegistry.forgetHiddenSession(session.sessionId);
      }
      if (failed) throw boundedError();
    },

    async dispose() {
      disposed = true;
      const records = [...sessions.values(), ...stageSessions.values()];
      sessions.clear();
      stageSessions.clear();
      const automaticCleanup = [...automaticReviews].map((review) => cleanupAutomaticReview(review));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([
            ...automaticCleanup,
            ...records
              .filter((record) => !record.automaticReview)
              .map(({ provider: contextProvider, sessionId }) => disposeSession(contextProvider, sessionId)),
          ]),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, DISPOSAL_TIMEOUT_MS);
          }),
        ]);
      } catch {
        // Cleanup is deliberately non-throwing.
      } finally {
        for (const { sessionId } of records) hiddenSessionRegistry.forgetHiddenSession(sessionId);
        if (timer) clearTimeout(timer);
        sessions.clear();
        stageSessions.clear();
      }
    },
  };
}
