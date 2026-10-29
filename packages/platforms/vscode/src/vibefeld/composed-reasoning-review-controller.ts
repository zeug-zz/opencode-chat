import type { ReasoningReviewRuntime, ReasoningReviewSummary } from "@opencode-chat/core";
import type { AdversarialReviewRole } from "./adversarial-review-contract";
import { mapAdversarialReviewToSummary } from "./adversarial-review-mapper";
import { createAdversarialReviewOrchestrator, createBoundedReviewPacket } from "./adversarial-review-orchestrator";
import type { AdversarialReviewSeam, RestrictedReviewOperationResult } from "./adversarial-review-seam";
import { validateClaimGraph } from "./claim-graph";
import { mapClaimProjectionToSummary } from "./claim-projection-mapper";
import type { ClaimProjectionSeam } from "./claim-projection-seam";
import type { CompletedAnswerClaimMapper } from "./completed-answer-claim-mapper";
import { assessClaimGraphEvidence, normalizeEvidenceReferences } from "./evidence-metadata";
import {
  createReasoningDiagnosticClock,
  elapsedReasoningMilliseconds,
  type ReasoningDiagnosticOutcome,
  type ReasoningDiagnosticReporter,
  type ReasoningDiagnosticStage,
} from "./reasoning-diagnostics";
import type { IReasoningReviewController, ReasoningReviewControllerInput } from "./reasoning-review-controller";

const TOTAL_REVIEW_TIMEOUT_MS = 60_000;
const AVAILABLE_RUNTIME: ReasoningReviewRuntime = { state: "available" };
const UNAVAILABLE_RUNTIME: ReasoningReviewRuntime = {
  state: "unavailable",
  reason: "manual-review-unavailable",
};
const UNAVAILABLE_CONCLUSION = "Manual review is unavailable for this response.";
const CANCELLED_CONCLUSION = "This manual review was cancelled before completion.";
const UNAVAILABLE_BOUNDARY = "No claim or review status was inferred because a required capability was unavailable.";
const CANCELLED_BOUNDARY = "The manual review was cancelled; no result was inferred.";
const ADVERSARIAL_FAILURE_NOTE = "The prover/verifier review did not complete; no challenges are reported.";

type ReviewEntry = {
  abort: AbortController;
  token: number;
  lifecycleToken?: number;
  lifecycleCleanup?: Promise<void>;
};

type ReviewLifecycle = Readonly<{
  beginReview: () => Promise<number>;
  cancelReview: (token: number) => Promise<unknown>;
  isReviewCurrent: (token: number) => boolean;
}>;

type ComposedReviewOptions = Readonly<{
  totalTimeoutMs?: number;
  readinessCheck?: () => boolean | Promise<boolean>;
  mapCompletedAnswer: CompletedAnswerClaimMapper;
  reviewLifecycle: ReviewLifecycle;
  diagnostics?: ReasoningDiagnosticReporter;
  now?: () => number;
}>;

const ABORTED = Symbol("manual-review-aborted");

function awaitAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<typeof ABORTED>((resolve) => {
    onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([operation, cancelled]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

function unavailableSummary(messageId: string, conclusion = UNAVAILABLE_CONCLUSION): ReasoningReviewSummary {
  return {
    reviewedMessageId: messageId,
    status: "unavailable",
    invocation: "manual",
    conclusion,
    assumptions: [],
    evidenceStatus: "not_assessed",
    openChallenges: [],
    interpretiveBoundary: conclusion === CANCELLED_CONCLUSION ? CANCELLED_BOUNDARY : UNAVAILABLE_BOUNDARY,
  };
}

function appendAdversarialFailure(summary: ReasoningReviewSummary): ReasoningReviewSummary {
  const boundary =
    summary.interpretiveBoundary ?? "Structural status is authoritative; adversarial review is supplemental.";
  return {
    ...summary,
    openChallenges: [],
    interpretiveBoundary: `${boundary} ${ADVERSARIAL_FAILURE_NOTE}`,
  };
}

/**
 * Runs AF first, then both restricted stages against one host-built packet.
 * Only AF summary fields are authoritative; adversarial success contributes
 * challenges and adversarial failure is additive metadata, never a status vote.
 */
export class ComposedReasoningReviewController implements IReasoningReviewController {
  private readonly inFlight = new Map<string, ReviewEntry>();
  private token = 0;
  private readonly timeoutMs: number;
  private readonly orchestrator: ReturnType<typeof createAdversarialReviewOrchestrator>;
  private readonly now: () => number;

  constructor(
    private readonly claimProjection: ClaimProjectionSeam,
    private readonly adversarialReview: AdversarialReviewSeam,
    private readonly options: ComposedReviewOptions,
  ) {
    this.now = createReasoningDiagnosticClock(options.now);
    const timeoutMs = options.totalTimeoutMs ?? TOTAL_REVIEW_TIMEOUT_MS;
    this.timeoutMs =
      Number.isInteger(timeoutMs) && timeoutMs > 0
        ? Math.min(timeoutMs, TOTAL_REVIEW_TIMEOUT_MS)
        : TOTAL_REVIEW_TIMEOUT_MS;
    this.orchestrator = createAdversarialReviewOrchestrator(this.withDiagnostics(adversarialReview), {
      timeoutMs: this.timeoutMs,
    });
  }

  async getRuntime(): Promise<ReasoningReviewRuntime> {
    return this.hasCapabilities() ? AVAILABLE_RUNTIME : UNAVAILABLE_RUNTIME;
  }

  async review(input: ReasoningReviewControllerInput): Promise<ReasoningReviewSummary> {
    const { sessionId, messageId, sourceText, invocation, onProgress } = input;
    const reviewStartedAt = this.now();
    this.report("manual-review", "started");
    if (invocation === "automatic") {
      this.report("manual-review", "unavailable", reviewStartedAt);
      return unavailableSummary(messageId);
    }

    const key = this.key(sessionId, messageId);
    this.cancel(sessionId, messageId);
    const abort = new AbortController();
    const entry: ReviewEntry = { abort, token: ++this.token };
    this.inFlight.set(key, entry);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
      void this.cleanupReviewLifecycle(entry);
      this.report("manual-review", "deadline", reviewStartedAt);
    }, this.timeoutMs);
    const isCurrent = () => this.inFlight.get(key)?.token === entry.token;
    let claimSummary: ReasoningReviewSummary | undefined;

    try {
      if (!this.hasCapabilities()) {
        this.report("manual-provider", "capability-unavailable");
        return unavailableSummary(messageId);
      }
      const readinessStartedAt = this.now();
      this.report("manual-provider", "readiness-started");
      const ready = await this.isReady(abort.signal);
      this.report("manual-provider", ready ? "readiness-ready" : "readiness-rejected", readinessStartedAt);
      if (!ready) {
        if (!abort.signal.aborted) this.report("manual-provider", "runtime-unready");
        return unavailableSummary(messageId);
      }
      if (!isCurrent() || abort.signal.aborted) {
        this.report("manual-review", !isCurrent() ? "stale" : "cancelled");
        return unavailableSummary(messageId, CANCELLED_CONCLUSION);
      }

      this.report("manual-provider", "lifecycle-started");
      const reviewToken = await this.beginReviewLifecycle(entry, isCurrent);
      const lifecycleCurrent = reviewToken !== undefined && this.isReviewLifecycleCurrent(entry);
      if (!reviewToken || !isCurrent() || abort.signal.aborted || !lifecycleCurrent) {
        this.report(
          "manual-provider",
          reviewToken !== undefined && !lifecycleCurrent ? "lifecycle-stale" : "lifecycle-unavailable",
        );
        if (!isCurrent()) this.report("manual-review", "stale");
        else if (abort.signal.aborted) this.report("manual-review", timedOut ? "deadline" : "cancelled");
        return abort.signal.aborted && !timedOut
          ? unavailableSummary(messageId, CANCELLED_CONCLUSION)
          : unavailableSummary(messageId);
      }

      const mapping = await awaitAbortable(
        Promise.resolve()
          .then(() => this.options.mapCompletedAnswer(sourceText, abort.signal))
          .catch(() => undefined),
        abort.signal,
      );
      if (!isCurrent() || (abort.signal.aborted && !timedOut)) {
        this.report("manual-review", !isCurrent() ? "stale" : "cancelled");
        return unavailableSummary(messageId, CANCELLED_CONCLUSION);
      }
      if (abort.signal.aborted || mapping === ABORTED || !mapping || !this.isReviewLifecycleCurrent(entry)) {
        if (!this.isReviewLifecycleCurrent(entry)) this.report("manual-provider", "lifecycle-stale");
        if (abort.signal.aborted || mapping === ABORTED)
          this.report("manual-review", timedOut ? "deadline" : "cancelled");
        else this.report("manual-mapping", "mapping-unavailable");
        return unavailableSummary(messageId);
      }

      const graph = validateClaimGraph(mapping);
      if (!graph.ok) {
        this.report("manual-mapping", "parse-malformed");
        return unavailableSummary(messageId);
      }

      const evidence = assessClaimGraphEvidence(graph.graph);
      if (!evidence.ok) {
        return mapClaimProjectionToSummary({
          reviewedMessageId: messageId,
          graph,
          evidence,
          outcome: { status: "unavailable", reason: "malformed" },
        });
      }
      const packet = createBoundedReviewPacket(graph.graph, evidence);
      if (!packet) {
        this.report("manual-mapping", "packet-invalid-input");
        return unavailableSummary(messageId);
      }

      onProgress?.("claimProjection");
      const projectionStartedAt = this.now();
      this.report("manual-af", "projection-started");
      const projectionOutcome = await this.claimProjection.project(graph.graph, abort.signal);
      this.report("manual-af", this.projectionDiagnosticOutcome(projectionOutcome.status), projectionStartedAt);
      if (!isCurrent() || (abort.signal.aborted && !timedOut)) {
        this.report("manual-review", !isCurrent() ? "stale" : "cancelled");
        return unavailableSummary(messageId, CANCELLED_CONCLUSION);
      }
      if (abort.signal.aborted && timedOut) {
        this.report("manual-review", "deadline");
        return unavailableSummary(messageId);
      }
      if (!this.isReviewLifecycleCurrent(entry)) {
        this.report("manual-provider", "lifecycle-stale");
        this.report("manual-review", "stale");
        return unavailableSummary(messageId);
      }

      claimSummary = mapClaimProjectionToSummary({
        reviewedMessageId: messageId,
        graph,
        evidence,
        outcome: projectionOutcome,
      });
      if (
        claimSummary.status === "unavailable" ||
        claimSummary.status === "audit_failed" ||
        claimSummary.status === "blocked"
      ) {
        this.report("manual-review", "unavailable");
        return claimSummary;
      }

      onProgress?.("adversarialReview");
      const adversarialOutcome = await this.orchestrator.reviewPacket(packet, abort.signal);
      if (!isCurrent() || (abort.signal.aborted && !timedOut)) {
        this.report("manual-review", !isCurrent() ? "stale" : "cancelled");
        return unavailableSummary(messageId, CANCELLED_CONCLUSION);
      }
      if (abort.signal.aborted && timedOut) {
        this.report("manual-review", "deadline");
        return appendAdversarialFailure(claimSummary);
      }
      if (!this.isReviewLifecycleCurrent(entry)) {
        this.report("manual-provider", "lifecycle-stale");
        this.report("manual-review", "stale");
        return unavailableSummary(messageId);
      }
      if (!adversarialOutcome.ok) {
        this.report("manual-review", "failed");
        return appendAdversarialFailure(claimSummary);
      }

      const adversarialSummary = mapAdversarialReviewToSummary({
        reviewedMessageId: messageId,
        evidence,
        outcome: adversarialOutcome,
      });
      this.report("manual-review", "completed", reviewStartedAt);
      return { ...claimSummary, openChallenges: adversarialSummary.openChallenges };
    } catch {
      if (!isCurrent() || (abort.signal.aborted && !timedOut)) {
        this.report("manual-review", !isCurrent() ? "stale" : "cancelled");
        return unavailableSummary(messageId, CANCELLED_CONCLUSION);
      }
      if (claimSummary) {
        this.report("manual-review", "failed");
        return appendAdversarialFailure(claimSummary);
      }
      this.report("manual-review", timedOut ? "deadline" : "failed");
      return unavailableSummary(messageId);
    } finally {
      clearTimeout(timer);
      await this.cleanupReviewLifecycle(entry);
      if (this.inFlight.get(key)?.token === entry.token) this.inFlight.delete(key);
    }
  }

  cancel(sessionId: string, messageId: string): void {
    const key = this.key(sessionId, messageId);
    const entry = this.inFlight.get(key);
    if (!entry) return;
    this.inFlight.delete(key);
    entry.abort.abort();
    this.report("manual-review", "cancelled");
    void this.cleanupReviewLifecycle(entry);
  }

  private withDiagnostics(seam: AdversarialReviewSeam): AdversarialReviewSeam {
    return {
      getCapability: () => seam.getCapability(),
      createContext: (role, signal) =>
        this.reportReviewerOperation(role, "context", () => seam.createContext(role, signal)),
      runProver: (context, packet, signal) =>
        this.reportReviewerOperation("prover", "reviewer", () => seam.runProver(context, packet, signal)),
      runVerifier: (context, packet, proposal, signal) =>
        this.reportReviewerOperation("verifier", "reviewer", () => seam.runVerifier(context, packet, proposal, signal)),
      cancelContext: (context) => seam.cancelContext(context),
    };
  }

  private async reportReviewerOperation<T>(
    role: AdversarialReviewRole,
    kind: "context" | "reviewer",
    operation: () => Promise<RestrictedReviewOperationResult<T>>,
  ): Promise<RestrictedReviewOperationResult<T>> {
    const stage: ReasoningDiagnosticStage = role === "prover" ? "manual-prover" : "manual-verifier";
    const startedAt = this.now();
    this.report(stage, kind === "context" ? "context-started" : "reviewer-started");
    try {
      const result = await operation();
      if (result.ok) {
        this.report(stage, kind === "context" ? "context-ready" : "reviewer-completed", startedAt);
      } else if (kind === "context") {
        this.report(stage, "context-unavailable", startedAt);
      } else {
        this.report(stage, this.reviewerDiagnosticOutcome(result), startedAt);
      }
      return result;
    } catch (error) {
      this.report(stage, kind === "context" ? "context-unavailable" : "reviewer-failed", startedAt);
      throw error;
    }
  }

  private reviewerDiagnosticOutcome<T>(
    result: Extract<RestrictedReviewOperationResult<T>, { ok: false }>,
  ): ReasoningDiagnosticOutcome {
    switch (result.failure.reason) {
      case "cancelled":
        return "reviewer-cancelled";
      case "timeout":
        return "reviewer-timeout";
      case "unsupported":
        return "reviewer-unavailable";
      default:
        return "reviewer-failed";
    }
  }

  private projectionDiagnosticOutcome(status: string): ReasoningDiagnosticOutcome {
    switch (status) {
      case "structurally_checked":
        return "projection-structurally-checked";
      case "conditional":
        return "projection-conditional";
      case "unresolved":
        return "projection-unresolved";
      case "refuted":
        return "projection-refuted";
      case "audit_failed":
        return "projection-failed";
      default:
        return "projection-unavailable";
    }
  }

  private report(stage: ReasoningDiagnosticStage, outcome: ReasoningDiagnosticOutcome, startedAt?: number): void {
    try {
      const elapsedMs = startedAt === undefined ? undefined : elapsedReasoningMilliseconds(this.now, startedAt);
      this.options.diagnostics?.({ stage, outcome, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
    } catch {
      // Manual-review diagnostics cannot change review behavior.
    }
  }

  private hasCapabilities(): boolean {
    try {
      return (
        this.claimProjection.getCapability().supported &&
        this.adversarialReview.getCapability().supported &&
        typeof this.options.mapCompletedAnswer === "function" &&
        typeof this.options.reviewLifecycle.beginReview === "function" &&
        typeof this.options.reviewLifecycle.cancelReview === "function" &&
        typeof this.options.reviewLifecycle.isReviewCurrent === "function"
      );
    } catch {
      return false;
    }
  }

  private async beginReviewLifecycle(entry: ReviewEntry, isCurrent: () => boolean): Promise<number | undefined> {
    const operation = Promise.resolve()
      .then(() => this.options.reviewLifecycle.beginReview())
      .then((token) => {
        if (!Number.isSafeInteger(token) || token <= 0) return undefined;
        entry.lifecycleToken = token;
        if (!isCurrent() || entry.abort.signal.aborted || !this.isReviewLifecycleCurrent(entry)) {
          void this.cleanupReviewLifecycle(entry);
          return undefined;
        }
        return token;
      })
      .catch(() => undefined);
    const result = await awaitAbortable(operation, entry.abort.signal);
    return result === ABORTED ? undefined : result;
  }

  private isReviewLifecycleCurrent(entry: ReviewEntry): boolean {
    if (entry.lifecycleToken === undefined) return false;
    try {
      return this.options.reviewLifecycle.isReviewCurrent(entry.lifecycleToken);
    } catch {
      return false;
    }
  }

  private cleanupReviewLifecycle(entry: ReviewEntry): Promise<void> {
    if (entry.lifecycleCleanup) return entry.lifecycleCleanup;
    const token = entry.lifecycleToken;
    if (token === undefined) return Promise.resolve();
    entry.lifecycleToken = undefined;
    entry.lifecycleCleanup = Promise.resolve()
      .then(() => this.options.reviewLifecycle.cancelReview(token))
      .then((result) => {
        if (typeof result === "object" && result !== null && "ok" in result && result.ok === false) {
          this.report("manual-provider", "lifecycle-cleanup-failed");
        }
      })
      .catch(() => {
        this.report("manual-provider", "lifecycle-cleanup-failed");
      });
    return entry.lifecycleCleanup;
  }

  private async isReady(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    const readinessCheck = this.options.readinessCheck;
    if (!readinessCheck) return !signal.aborted;
    let onAbort: (() => void) | undefined;
    try {
      const readiness = Promise.resolve().then(readinessCheck);
      const cancelled = new Promise<false>((resolve) => {
        onAbort = () => resolve(false);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return (await Promise.race([readiness, cancelled])) === true && !signal.aborted;
    } catch {
      return false;
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private key(sessionId: string, messageId: string): string {
    return `${sessionId}\u0000${messageId}`;
  }
}
