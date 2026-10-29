import type {
  BoundedAdversarialReviewFailure,
  ObjectionProposal,
  ReviewContextMetadata,
  ReviewPacket,
  VerifierResult,
} from "./adversarial-review-contract";
import type { AdversarialReviewSeam, RestrictedReviewOperationResult } from "./adversarial-review-seam";
import { validateReviewPacket } from "./adversarial-review-validation";
import { type ClaimGraph, compileClaimGraph } from "./claim-graph";
import { assessClaimGraphEvidence, type EvidenceNormalizationResult } from "./evidence-metadata";

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

type AdversarialReviewOrchestrationFailure = Extract<AdversarialReviewOrchestrationResult, { ok: false }>;

export type AdversarialReviewOrchestratorOptions = Readonly<{
  timeoutMs?: number;
}>;

const failure = (
  phase: BoundedAdversarialReviewFailure["phase"],
  reason: BoundedAdversarialReviewFailure["reason"],
  status: BoundedAdversarialReviewFailure["status"] = "audit_failed",
): AdversarialReviewOrchestrationFailure => ({
  ok: false,
  failure: Object.freeze({ status, phase, reason }),
});

/** Build the one bounded packet shared by both restricted review stages. */
export function createBoundedReviewPacket(
  graph: ClaimGraph,
  evidence: EvidenceNormalizationResult,
): ReviewPacket | undefined {
  if (!evidence.ok) return undefined;
  const packet: ReviewPacket = Object.freeze({
    packetId: "review-packet",
    conclusionId: graph.conclusionId,
    claims: graph.nodes,
    assumptions: graph.assumptions,
    logicalDependencies: graph.logicalDependencies,
    evidenceReferences: graph.evidenceReferences,
    evidenceStatus: evidence.assessment.status,
    limits: PACKET_LIMITS,
  });
  return validateReviewPacket(packet).ok ? packet : undefined;
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
    const timeoutMs = options.timeoutMs;
    this.timeoutMs = typeof timeoutMs === "number" && Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000;
  }

  async review(sourceText: string, signal?: AbortSignal): Promise<AdversarialReviewOrchestrationResult> {
    if (signal?.aborted) return failure("host", "cancelled", "unavailable");

    const graph = compileClaimGraph(sourceText);
    if (!graph.ok) return failure("host", "malformed", "unavailable");
    const evidence = assessClaimGraphEvidence(graph.graph);
    if (!evidence.ok) return failure("host", "malformed", "unavailable");
    const packet = createBoundedReviewPacket(graph.graph, evidence);
    if (!packet) return failure("host", "malformed", "unavailable");
    return this.reviewPacket(packet, signal);
  }

  async reviewPacket(packet: ReviewPacket, signal?: AbortSignal): Promise<AdversarialReviewOrchestrationResult> {
    if (signal?.aborted) return failure("host", "cancelled", "unavailable");
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
    let outcome: AdversarialReviewOrchestrationResult | undefined;

    const cleanup = async (): Promise<BoundedAdversarialReviewFailure | undefined> => {
      const contexts = [verifierContext, proverContext].filter(
        (context): context is ReviewContextMetadata => context !== undefined,
      );
      const failures = await Promise.all(
        contexts.map(async (context): Promise<BoundedAdversarialReviewFailure | undefined> => {
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
          async (value) => {
            if (value.ok) await this.seam.cancelContext(value.value);
          },
        );
        if (!createdProver.ok) {
          outcome = { ok: false, failure: createdProver.failure };
          break;
        }
        const activeProverContext = createdProver.value;
        proverContext = activeProverContext;

        const proposed = await this.runBounded(
          () => this.seam.runProver(activeProverContext, packet, controller.signal),
          controller,
          () => timedOut,
          "prover",
        );
        if (!proposed.ok) {
          outcome = { ok: false, failure: proposed.failure };
          break;
        }

        const createdVerifier = await this.runBounded(
          () => this.seam.createContext("verifier", controller.signal),
          controller,
          () => timedOut,
          "verifier",
          async (value) => {
            if (value.ok) await this.seam.cancelContext(value.value);
          },
        );
        if (!createdVerifier.ok) {
          outcome = { ok: false, failure: createdVerifier.failure };
          break;
        }
        const activeVerifierContext = createdVerifier.value;
        verifierContext = activeVerifierContext;

        if (
          activeVerifierContext.handle === activeProverContext.handle ||
          activeVerifierContext.provenance.identity === activeProverContext.provenance.identity ||
          activeVerifierContext.provenance.role !== "verifier" ||
          proposed.value.prover.identity !== activeProverContext.provenance.identity ||
          proposed.value.prover.identity === activeVerifierContext.provenance.identity
        ) {
          outcome = failure("verifier", "provenance");
          break;
        }

        const verified = await this.runBounded(
          () => this.seam.runVerifier(activeVerifierContext, packet, proposed.value, controller.signal),
          controller,
          () => timedOut,
          "verifier",
        );
        if (!verified.ok) {
          outcome = { ok: false, failure: verified.failure };
          break;
        }
        if (
          verified.value.verifier.identity !== activeVerifierContext.provenance.identity ||
          verified.value.verifier.identity === proposed.value.prover.identity
        ) {
          outcome = failure("verifier", "provenance");
          break;
        }

        outcome = {
          ok: true,
          value: {
            packet,
            prover: { context: activeProverContext, proposal: proposed.value },
            verifier: { context: activeVerifierContext, result: verified.value },
          },
        };
        break;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
        const cleanupFailure = await cleanup();
        if (cleanupFailure) outcome = failure(cleanupFailure.phase, "cleanup", "audit_failed");
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
  ): Promise<RestrictedReviewOperationResult<T>> {
    const abort = new Promise<RestrictedReviewOperationResult<never>>((resolve) => {
      const onAbort = () =>
        resolve({
          ok: false,
          failure: {
            status: "unavailable",
            phase: "host",
            reason: timedOut() ? "timeout" : "cancelled",
          },
        });
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const result: Promise<RestrictedReviewOperationResult<T>> = Promise.resolve()
      .then(operation)
      .catch(() => ({
        ok: false as const,
        failure: {
          status: "audit_failed" as const,
          phase,
          reason: timedOut() ? "timeout" : controller.signal.aborted ? "cancelled" : "model_failure",
        },
      }));
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
    return completed;
  }
}

export const createAdversarialReviewOrchestrator = (
  seam: AdversarialReviewSeam,
  options?: AdversarialReviewOrchestratorOptions,
): AdversarialReviewOrchestrator => new AdversarialReviewOrchestrator(seam, options);
