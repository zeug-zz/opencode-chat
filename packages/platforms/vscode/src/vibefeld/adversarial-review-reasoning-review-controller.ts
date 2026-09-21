import type { ReasoningReviewRuntime, ReasoningReviewSummary } from "@opencode-chat/core";
import { mapAdversarialReviewToSummary } from "./adversarial-review-mapper";
import { createAdversarialReviewOrchestrator } from "./adversarial-review-orchestrator";
import type { AdversarialReviewSeam } from "./adversarial-review-seam";
import { createUnsupportedAdversarialReviewSeam } from "./adversarial-review-seam";
import { compileClaimGraph } from "./claim-graph";
import { assessClaimGraphEvidence, normalizeEvidenceReferences } from "./evidence-metadata";
import type { IReasoningReviewController } from "./reasoning-review-controller";

const UNAVAILABLE_RUNTIME: ReasoningReviewRuntime = {
  state: "unavailable",
  reason: "No adversarial-review capability is available.",
};

type ReviewCancellation = Readonly<{ controller: AbortController; token: number }>;

/**
 * Host-private manual adversarial review. The injected seam is dormant unless
 * a caller explicitly supplies a restricted, validated adapter.
 */
export class AdversarialReviewReasoningReviewController implements IReasoningReviewController {
  private readonly inFlight = new Map<string, ReviewCancellation>();
  private token = 0;
  private readonly orchestrator: ReturnType<typeof createAdversarialReviewOrchestrator>;

  constructor(private readonly seam: AdversarialReviewSeam = createUnsupportedAdversarialReviewSeam()) {
    this.orchestrator = createAdversarialReviewOrchestrator(seam);
  }

  async getRuntime(): Promise<ReasoningReviewRuntime> {
    return this.seam.getCapability().supported ? { state: "available" } : UNAVAILABLE_RUNTIME;
  }

  async review({
    sessionId,
    messageId,
    sourceText,
  }: {
    sessionId: string;
    messageId: string;
    sourceText: string;
  }): Promise<ReasoningReviewSummary> {
    const key = this.key(sessionId, messageId);
    this.cancel(sessionId, messageId);
    const cancellation = { controller: new AbortController(), token: ++this.token };
    this.inFlight.set(key, cancellation);

    try {
      const graph = compileClaimGraph(sourceText);
      if (!graph.ok) {
        return mapAdversarialReviewToSummary({
          reviewedMessageId: messageId,
          evidence: normalizeEvidenceReferences([]),
          outcome: { ok: false, failure: { status: "unavailable", phase: "host", reason: "malformed" } },
        });
      }

      const evidence = assessClaimGraphEvidence(graph.graph);
      if (!evidence.ok) {
        return mapAdversarialReviewToSummary({
          reviewedMessageId: messageId,
          evidence,
          outcome: { ok: false, failure: { status: "unavailable", phase: "host", reason: "malformed" } },
        });
      }

      const outcome = await this.orchestrator.review(sourceText, cancellation.controller.signal);
      return mapAdversarialReviewToSummary({ reviewedMessageId: messageId, evidence, outcome });
    } finally {
      if (this.inFlight.get(key)?.token === cancellation.token) this.inFlight.delete(key);
    }
  }

  cancel(sessionId: string, messageId: string): void {
    const key = this.key(sessionId, messageId);
    const cancellation = this.inFlight.get(key);
    if (!cancellation) return;
    this.inFlight.delete(key);
    cancellation.controller.abort();
  }

  private key(sessionId: string, messageId: string): string {
    return `${sessionId}\u0000${messageId}`;
  }
}
