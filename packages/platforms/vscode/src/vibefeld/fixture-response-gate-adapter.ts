import type {
  ImmutableResponseCandidate,
  ResponseGateAssistantMessageId,
  ResponseGateBinding,
  ResponseGateGeneration,
  ResponseGateOwner,
  ResponseGateSessionId,
} from "./response-gate-contract";
import {
  createHostPublicationBoundaryAdapter,
  type HostPublicationBoundaryAdapter,
  type HostPublicationCandidate,
} from "./response-gate-publication-boundary";
import type { ResponseGateOperationResult } from "./response-gate-seam";

/** TEST-ONLY: a bounded response-gate publication fixture with no external adapter. */
export type FixtureResponseGateOutcome =
  | "approved"
  | "objection_confirmed"
  | "evidence_conflict"
  | "malformed"
  | "ambiguous"
  | "audit_failed";

export type FixtureResponseGateHarness = Readonly<{
  adapter: HostPublicationBoundaryAdapter;
  begin: (
    candidate: ImmutableResponseCandidate,
    binding: ResponseGateBinding,
  ) => ReturnType<HostPublicationBoundaryAdapter["begin"]>;
  submitFixedReview: (
    token: unknown,
    binding: ResponseGateBinding,
  ) => ResponseGateOperationResult<Readonly<{ state: string }>>;
  publications: () => readonly ImmutableResponseCandidate[];
}>;

const eligibility = Object.freeze({ explicitlyOptedIn: true, eligible: true, responseClass: "assistant" });

function fixedSummary(outcome: FixtureResponseGateOutcome, messageId: ResponseGateAssistantMessageId): unknown {
  const base = {
    reviewedMessageId: messageId,
    status: "conditional" as const,
    invocation: "automatic" as const,
    conclusion: "A bounded fixture conclusion was reviewed.",
    assumptions: ["The fixture assumptions hold."],
    evidenceStatus: "unverified" as const,
    openChallenges: [] as readonly [],
    interpretiveBoundary: "This is conditional, not source verification, truth, or formal proof.",
  };

  switch (outcome) {
    case "approved":
      return Object.freeze(base);
    case "objection_confirmed":
      return Object.freeze({
        ...base,
        status: "unresolved" as const,
        openChallenges: [
          { severity: "major" as const, target: "claim-conclusion", reason: "A bounded objection remains." },
        ],
      });
    case "evidence_conflict":
      return Object.freeze({ ...base, evidenceStatus: "conflicted" as const });
    case "audit_failed":
      return Object.freeze({ ...base, status: "audit_failed" as const });
    case "ambiguous":
      return Object.freeze({
        ...base,
        openChallenges: Array.from({ length: 33 }, (_, index) => ({
          severity: "note" as const,
          target: `fixture-challenge-${index}`,
          reason: "A bounded fixture challenge.",
        })),
      });
    case "malformed":
      return Object.freeze({ reviewedMessageId: messageId, status: "conditional" });
  }
}

/**
 * Creates an entirely in-memory host publication fixture. It returns only
 * bounded lifecycle results and safe publication candidates; fixed review
 * summaries never contain provider artifacts or source data.
 */
export function createFixtureResponseGateAdapter(outcome: FixtureResponseGateOutcome): FixtureResponseGateHarness {
  const published: ImmutableResponseCandidate[] = [];
  const result = createHostPublicationBoundaryAdapter({
    insertionPoint: "host-publication",
    owner: "fixture-owner" as ResponseGateOwner,
    capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
    tokenSource: () => "fixture-response-gate-token",
    publish: (candidate) => published.push(Object.freeze({ text: candidate.text })),
  });
  if (result.kind !== "available") throw new Error("fixture response gate is unavailable");

  const adapter = result.adapter;
  return Object.freeze({
    adapter,
    begin(candidate, binding) {
      return adapter.begin({
        eligibility,
        binding,
        candidate,
        sourcePacket: Object.freeze({ visibleText: "bounded fixture source" }),
      });
    },
    submitFixedReview(token, binding) {
      const review = adapter.reviewSummary({
        token,
        binding,
        summary: fixedSummary(outcome, binding.assistantMessageId),
      });
      if (!review.ok) return review;
      return { ok: true, value: Object.freeze({ state: review.value.state }) };
    },
    publications: () => published.slice(),
  });
}

export function fixtureResponseGateBinding(): ResponseGateBinding {
  return Object.freeze({
    owner: "fixture-owner" as ResponseGateOwner,
    sessionId: "fixture-session" as ResponseGateSessionId,
    assistantMessageId: "fixture-message" as ResponseGateAssistantMessageId,
    generation: 1 as ResponseGateGeneration,
  });
}
