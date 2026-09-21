import type {
  BoundedAdversarialReviewFailure,
  ObjectionProposal,
  ReviewContextMetadata,
  ReviewPacket,
  VerifierResult,
} from "./adversarial-review-contract";
import type { AdversarialReviewSeam, RestrictedReviewOperationResult } from "./adversarial-review-seam";
import { validateReviewPacket } from "./adversarial-review-validation";
import { compileClaimGraph } from "./claim-graph";
import { assessClaimGraphEvidence } from "./evidence-metadata";

const PACKET_LIMITS = Object.freeze({
  maxClaims: 64,
  maxAssumptions: 128,
  maxDependencies: 128,
  maxEvidenceReferences: 128,
  maxStatementLength: 512,
  maxReasonLength: 256,
});

export type AdversarialReviewOrchestrationSuccess = Readonly<{
  packet: ReviewPacket;
  prover: Readonly<{ context: ReviewContextMetadata; proposal: ObjectionProposal }>;
  verifier: Readonly<{ context: ReviewContextMetadata; result: VerifierResult }>;
}>;

export type AdversarialReviewOrchestrationResult =
  | Readonly<{ ok: true; value: AdversarialReviewOrchestrationSuccess }>
  | Readonly<{ ok: false; failure: BoundedAdversarialReviewFailure }>;

export type AdversarialReviewOrchestratorOptions = Readonly<{
  timeoutMs?: number;
}>;

const failure = (
  phase: BoundedAdversarialReviewFailure["phase"],
  reason: BoundedAdversarialReviewFailure["reason"],
  status: BoundedAdversarialReviewFailure["status"] = "audit_failed",
): AdversarialReviewOrchestrationResult => ({
  ok: false,
  failure: Object.freeze({ status, phase, reason }),
});

function operationFailure<T>(
  result: RestrictedReviewOperationResult<T>,
): AdversarialReviewOrchestrationResult | undefined {
  return result.ok ? undefined : result;
}

/**
 * Runs the two restricted stages only after local packet compilation. This is
 * deliberately a seam consumer: no provider-shaped input crosses this layer.
 */
export class AdversarialReviewOrchestrator {
  private readonly timeoutMs: number;

  constructor(
    private readonly seam: AdversarialReviewSeam,
    options: AdversarialReviewOrchestratorOptions = {},
  ) {
    this.timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 5_000;
  }

  async review(sourceText: string, signal?: AbortSignal): Promise<AdversarialReviewOrchestrationResult> {
    if (signal?.aborted) return failure("host", "cancelled", "unavailable");

    const graph = compileClaimGraph(sourceText);
    if (!graph.ok) return failure("host", "malformed", "unavailable");
    const evidence = assessClaimGraphEvidence(graph.graph);
    if (!evidence.ok) return failure("host", "malformed", "unavailable");

    const packet: ReviewPacket = Object.freeze({
      packetId: "review-packet",
      conclusionId: graph.graph.conclusionId,
      claims: graph.graph.nodes,
      assumptions: graph.graph.assumptions,
      logicalDependencies: graph.graph.logicalDependencies,
      evidenceReferences: graph.graph.evidenceReferences,
      evidenceStatus: evidence.assessment.status,
      limits: PACKET_LIMITS,
    });
    if (!validateReviewPacket(packet).ok) return failure("host", "malformed", "unavailable");

    const capability = this.seam.getCapability();
    if (!capability.supported) return failure("host", "unsupported", "unavailable");

    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    let proverContext: ReviewContextMetadata | undefined;
    let verifierContext: ReviewContextMetadata | undefined;
    let completed = false;
    let outcome: AdversarialReviewOrchestrationResult | undefined;

    const cleanup = async (): Promise<BoundedAdversarialReviewFailure | undefined> => {
      const contexts = [verifierContext, proverContext].filter(
        (context): context is ReviewContextMetadata => context !== undefined,
      );
      const failures = await Promise.all(
        contexts.map(async (context) => {
          try {
            return await this.seam.cancelContext(context);
          } catch {
            return Object.freeze({
              status: "audit_failed" as const,
              phase: context.provenance.role,
              reason: "cleanup" as const,
            });
          }
        }),
      );
      return failures.find((value): value is BoundedAdversarialReviewFailure => value !== undefined);
    };

    for (;;) {
      try {
        const createdProver = await this.runBounded(
          () => this.seam.createContext("prover", controller.signal),
          controller,
          () => timedOut,
          "prover",
          (value) => (value.ok ? this.seam.cancelContext(value.value) : undefined),
        );
        if (!createdProver.ok) {
          outcome = createdProver;
          break;
        }
        proverContext = createdProver.value;

        const proposed = await this.runBounded(
          () => this.seam.runProver(proverContext as ReviewContextMetadata, packet, controller.signal),
          controller,
          () => timedOut,
          "prover",
        );
        if (!proposed.ok) {
          outcome = proposed;
          break;
        }

        const createdVerifier = await this.runBounded(
          () => this.seam.createContext("verifier", controller.signal),
          controller,
          () => timedOut,
          "verifier",
          (value) => (value.ok ? this.seam.cancelContext(value.value) : undefined),
        );
        if (!createdVerifier.ok) {
          outcome = createdVerifier;
          break;
        }
        verifierContext = createdVerifier.value;

        if (
          verifierContext.handle === proverContext.handle ||
          verifierContext.provenance.identity === proverContext.provenance.identity ||
          verifierContext.provenance.role !== "verifier" ||
          proposed.value.prover.identity !== proverContext.provenance.identity ||
          proposed.value.prover.identity === verifierContext.provenance.identity
        ) {
          outcome = failure("verifier", "provenance");
          break;
        }

        const verified = await this.runBounded(
          () =>
            this.seam.runVerifier(verifierContext as ReviewContextMetadata, packet, proposed.value, controller.signal),
          controller,
          () => timedOut,
          "verifier",
        );
        if (!verified.ok) {
          outcome = verified;
          break;
        }
        if (
          verified.value.verifier.identity !== verifierContext.provenance.identity ||
          verified.value.verifier.identity === proposed.value.prover.identity
        ) {
          outcome = failure("verifier", "provenance");
          break;
        }

        completed = true;
        outcome = {
          ok: true,
          value: {
            packet,
            prover: { context: proverContext, proposal: proposed.value },
            verifier: { context: verifierContext, result: verified.value },
          },
        };
        break;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
        if (controller.signal.aborted || !completed) {
          const cleanupFailure = await cleanup();
          if (cleanupFailure) outcome = failure(cleanupFailure.phase, "cleanup", "audit_failed");
        }
      }
    }
    return outcome ?? failure("host", "model_failure");
  }

  private async runBounded<T>(
    operation: () => Promise<RestrictedReviewOperationResult<T>>,
    controller: AbortController,
    timedOut: () => boolean,
    phase: BoundedAdversarialReviewFailure["phase"],
    onLateResult?: (result: RestrictedReviewOperationResult<T>) => void | Promise<void>,
  ): Promise<RestrictedReviewOperationResult<T> | AdversarialReviewOrchestrationResult> {
    const abort = new Promise<AdversarialReviewOrchestrationResult>((resolve) => {
      const onAbort = () => resolve(failure("host", timedOut() ? "timeout" : "cancelled", "unavailable"));
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const result = Promise.resolve()
      .then(operation)
      .catch(() => failure(phase, timedOut() ? "timeout" : controller.signal.aborted ? "cancelled" : "model_failure"));
    if (onLateResult) {
      void result.then(async (late) => {
        if (controller.signal.aborted) {
          try {
            await onLateResult(late);
          } catch {
            // Late cleanup is bounded and cannot publish provider details.
          }
        }
      });
    }
    const completed = await Promise.race([result, abort]);
    if ("failure" in completed) return completed;
    const propagated = operationFailure(completed);
    return propagated ?? completed;
  }
}

export const createAdversarialReviewOrchestrator = (
  seam: AdversarialReviewSeam,
  options?: AdversarialReviewOrchestratorOptions,
): AdversarialReviewOrchestrator => new AdversarialReviewOrchestrator(seam, options);
