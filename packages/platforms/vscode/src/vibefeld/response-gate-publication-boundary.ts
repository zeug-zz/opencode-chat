import type {
  BoundedResponseSourcePacket,
  ImmutableResponseCandidate,
  ResponseGateBinding,
  ResponseGateCapability,
  ResponseGateDraft,
} from "./response-gate-contract";
import {
  classifyResponseGateInsertionPoint,
  createResponseGateSeam,
  type ResponseGateInsertionPoint,
  type ResponseGateOperationResult,
  type ResponseGateSeam,
  type ResponseGateTokenSource,
} from "./response-gate-seam";

/** The only callback that may publish a candidate at this boundary. */
export type HostResponsePublication = (candidate: ImmutableResponseCandidate) => void;

export type HostPublicationCandidate = Readonly<{
  eligibility: unknown;
  binding: ResponseGateBinding;
  candidate: ImmutableResponseCandidate;
  sourcePacket: BoundedResponseSourcePacket;
}>;

export type HostPublicationBoundaryAdapter = Readonly<{
  getCapability: () => ResponseGateCapability;
  begin: (input: HostPublicationCandidate) => ResponseGateOperationResult<ResponseGateDraft>;
  review: ResponseGateSeam["review"];
  reviewSummary: ResponseGateSeam["reviewSummary"];
  release: ResponseGateSeam["release"];
  cancel: ResponseGateSeam["cancel"];
  timeout: ResponseGateSeam["timeout"];
  invalidateSession: ResponseGateSeam["invalidateSession"];
  invalidateMessage: ResponseGateSeam["invalidateMessage"];
  invalidateGeneration: ResponseGateSeam["invalidateGeneration"];
  dispose: ResponseGateSeam["dispose"];
}>;

export type HostPublicationBoundaryResult =
  | Readonly<{ kind: "available"; adapter: HostPublicationBoundaryAdapter }>
  | Readonly<{
      kind: "unavailable";
      capability: ResponseGateCapability;
      reason: "missing" | "unavailable" | "not_transactional" | "unsupported";
    }>;

/**
 * Builds the private adapter only for a host-owned callback that has not yet
 * published the response. Existing streaming and send paths are deliberately
 * rejected before a seam or transaction is created.
 */
export function createHostPublicationBoundaryAdapter(
  input: Readonly<{
    insertionPoint: ResponseGateInsertionPoint;
    owner: ResponseGateBinding["owner"];
    capability: unknown;
    publish: HostResponsePublication;
    tokenSource?: ResponseGateTokenSource;
  }>,
): HostPublicationBoundaryResult {
  const insertionCapability = classifyResponseGateInsertionPoint(input.insertionPoint);
  if (insertionCapability.kind !== "compatible")
    return Object.freeze({
      kind: "unavailable",
      capability: insertionCapability,
      reason: insertionCapability.reason,
    });

  const seam = createResponseGateSeam({
    owner: input.owner,
    capability: input.capability,
    publish: (candidate) => input.publish(Object.freeze({ text: candidate })),
    tokenSource: input.tokenSource,
  });
  const capability = seam.getCapability();
  if (capability.kind !== "compatible")
    return Object.freeze({ kind: "unavailable", capability, reason: capability.reason });

  const adapter: HostPublicationBoundaryAdapter = Object.freeze({
    getCapability: () => capability,
    begin(candidate) {
      try {
        return seam.begin({
          eligibility: candidate.eligibility,
          binding: candidate.binding,
          candidateText: candidate.candidate.text,
          sourceText: candidate.sourcePacket.visibleText,
        });
      } catch {
        return { ok: false, code: "malformed" };
      }
    },
    review: seam.review,
    reviewSummary: (reviewInput) => seam.reviewSummary(reviewInput),
    release: seam.release,
    cancel: seam.cancel,
    timeout: seam.timeout,
    invalidateSession: seam.invalidateSession,
    invalidateMessage: seam.invalidateMessage,
    invalidateGeneration: seam.invalidateGeneration,
    dispose: seam.dispose,
  });
  return Object.freeze({ kind: "available", adapter });
}
