import type { ReasoningReviewRuntime } from "@opencode-chat/core";
import { compileClaimGraph } from "./claim-graph";
import { mapClaimProjectionToSummary } from "./claim-projection-mapper";
import { type ClaimProjectionSeam, createUnsupportedClaimProjectionSeam } from "./claim-projection-seam";
import { assessClaimGraphEvidence, normalizeEvidenceReferences } from "./evidence-metadata";
import type { IReasoningReviewController } from "./reasoning-review-controller";

const UNAVAILABLE_RUNTIME: ReasoningReviewRuntime = {
  state: "unavailable",
  reason: "No claim-projection capability is available.",
};

type ReviewCancellation = Readonly<{ controller: AbortController; token: number }>;

/**
 * Host-owned, post-response claim projection. The seam is deliberately
 * injected so the production default remains the current no-claim boundary.
 */
export class ClaimProjectionReasoningReviewController implements IReasoningReviewController {
  private readonly inFlight = new Map<string, ReviewCancellation>();
  private token = 0;

  constructor(private readonly seam: ClaimProjectionSeam = createUnsupportedClaimProjectionSeam()) {}

  async getRuntime(): Promise<ReasoningReviewRuntime> {
    return UNAVAILABLE_RUNTIME;
  }

  async review({ sessionId, messageId, sourceText }: { sessionId: string; messageId: string; sourceText: string }) {
    const key = this.key(sessionId, messageId);
    this.cancel(sessionId, messageId);
    const cancellation = { controller: new AbortController(), token: ++this.token };
    this.inFlight.set(key, cancellation);

    try {
      const graph = compileClaimGraph(sourceText);
      if (!graph.ok) {
        return mapClaimProjectionToSummary({
          reviewedMessageId: messageId,
          graph,
          evidence: normalizeEvidenceReferences([]),
          outcome: { status: "unavailable", reason: "malformed" },
        });
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

      // Capability is checked only after local compilation and normalization;
      // getRuntime() and construction never touch the seam.
      const capability = this.seam.getCapability();
      const outcome = capability.supported
        ? await this.seam.project(graph.graph, cancellation.controller.signal)
        : { status: "unavailable" as const, reason: "unsupported" as const };

      return mapClaimProjectionToSummary({ reviewedMessageId: messageId, graph, evidence, outcome });
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
