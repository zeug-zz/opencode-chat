import type {
  AdversarialReviewRole,
  BoundedAdversarialReviewFailure,
  ObjectionProposal,
  RestrictedReviewPermissionAttestation,
  ReviewContextMetadata,
  ReviewPacket,
  VerifierResult,
} from "./adversarial-review-contract";
import {
  type AdversarialValidationErrorCode,
  validateObjectionProposal,
  validateRestrictedReviewPermissionAttestation,
  validateReviewContextMetadata,
  validateReviewPacket,
  validateVerifierResult,
} from "./adversarial-review-validation";

export type RestrictedReviewCapability =
  | Readonly<{ supported: false }>
  | Readonly<{ supported: true; attestation: RestrictedReviewPermissionAttestation }>;

export type RestrictedReviewAdapter = Readonly<{
  attestation: unknown;
  createContext: (role: AdversarialReviewRole, signal: AbortSignal) => unknown | Promise<unknown>;
  runProver: (context: ReviewContextMetadata, packet: ReviewPacket, signal: AbortSignal) => unknown | Promise<unknown>;
  runVerifier: (
    context: ReviewContextMetadata,
    packet: ReviewPacket,
    proposal: ObjectionProposal,
    signal: AbortSignal,
  ) => unknown | Promise<unknown>;
  cancelContext: (context: ReviewContextMetadata) => void | Promise<void>;
}>;

export type RestrictedReviewOperationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: BoundedAdversarialReviewFailure }>;

export interface AdversarialReviewSeam {
  getCapability(): RestrictedReviewCapability;
  createContext(
    role: AdversarialReviewRole,
    signal?: AbortSignal,
  ): Promise<RestrictedReviewOperationResult<ReviewContextMetadata>>;
  runProver(
    context: ReviewContextMetadata,
    packet: ReviewPacket,
    signal?: AbortSignal,
  ): Promise<RestrictedReviewOperationResult<ObjectionProposal>>;
  runVerifier(
    context: ReviewContextMetadata,
    packet: ReviewPacket,
    proposal: ObjectionProposal,
    signal?: AbortSignal,
  ): Promise<RestrictedReviewOperationResult<VerifierResult>>;
  cancelContext(context: ReviewContextMetadata): Promise<BoundedAdversarialReviewFailure | undefined>;
}

const unsupported = (phase: AdversarialReviewRole | "host" = "host"): RestrictedReviewOperationResult<never> => ({
  ok: false,
  failure: Object.freeze({ status: "unavailable", phase, reason: "unsupported" }),
});

const malformed = (phase: AdversarialReviewRole | "host"): RestrictedReviewOperationResult<never> => ({
  ok: false,
  failure: Object.freeze({ status: "audit_failed", phase, reason: "malformed" }),
});

const modelFailure = (phase: AdversarialReviewRole): RestrictedReviewOperationResult<never> => ({
  ok: false,
  failure: Object.freeze({ status: "audit_failed", phase, reason: "model_failure" }),
});

const validationFailure = (
  phase: AdversarialReviewRole,
  code: AdversarialValidationErrorCode,
): RestrictedReviewOperationResult<never> => ({
  ok: false,
  failure: Object.freeze({
    status: "audit_failed",
    phase,
    reason:
      code === "over-limit"
        ? "oversized"
        : code === "provenance"
          ? "provenance"
          : code === "ambiguous"
            ? "ambiguous"
            : "malformed",
  }),
});

const providerResultFailure = (
  phase: AdversarialReviewRole,
  value: unknown,
): RestrictedReviewOperationResult<never> | undefined => {
  if (typeof value === "string" && value.length > 32_768)
    return { ok: false, failure: Object.freeze({ status: "audit_failed", phase, reason: "oversized" }) };
  if (typeof value !== "object" || value === null) return undefined;
  try {
    if (JSON.stringify(value).length > 32_768)
      return { ok: false, failure: Object.freeze({ status: "audit_failed", phase, reason: "oversized" }) };
  } catch {
    return { ok: false, failure: Object.freeze({ status: "audit_failed", phase, reason: "malformed" }) };
  }
  return undefined;
};

const signalFor = (signal?: AbortSignal): AbortSignal => signal ?? new AbortController().signal;

function validAdapter(
  adapter: RestrictedReviewAdapter | undefined,
): Readonly<{ adapter: RestrictedReviewAdapter; attestation: RestrictedReviewPermissionAttestation }> | undefined {
  if (!adapter || typeof adapter !== "object") return undefined;
  if (
    typeof adapter.createContext !== "function" ||
    typeof adapter.runProver !== "function" ||
    typeof adapter.runVerifier !== "function" ||
    typeof adapter.cancelContext !== "function"
  )
    return undefined;
  const checked = validateRestrictedReviewPermissionAttestation(adapter.attestation);
  return checked.ok ? { adapter, attestation: checked.value } : undefined;
}

function createSeam(adapter?: RestrictedReviewAdapter): AdversarialReviewSeam {
  const checked = validAdapter(adapter);
  const capability: RestrictedReviewCapability = checked
    ? Object.freeze({ supported: true as const, attestation: checked.attestation })
    : Object.freeze({ supported: false as const });

  return {
    getCapability: () => capability,
    async createContext(role, signal) {
      if (!checked || signal?.aborted) return unsupported(role);
      try {
        const value = await checked.adapter.createContext(role, signalFor(signal));
        const context = validateReviewContextMetadata(value, role);
        return context.ok ? { ok: true, value: context.value } : validationFailure(role, context.code);
      } catch {
        if (signal?.aborted)
          return { ok: false, failure: Object.freeze({ status: "unavailable", phase: role, reason: "cancelled" }) };
        return modelFailure(role);
      }
    },
    async runProver(context, packet, signal) {
      if (!checked || signal?.aborted) return unsupported("prover");
      if (!validateReviewContextMetadata(context, "prover").ok || !validateReviewPacket(packet).ok)
        return malformed("prover");
      try {
        const value = await checked.adapter.runProver(context, packet, signalFor(signal));
        const bounded = providerResultFailure("prover", value);
        if (bounded) return bounded;
        const proposal = validateObjectionProposal(value, packet);
        return proposal.ok ? { ok: true, value: proposal.value } : validationFailure("prover", proposal.code);
      } catch {
        if (signal?.aborted)
          return { ok: false, failure: Object.freeze({ status: "unavailable", phase: "prover", reason: "cancelled" }) };
        return modelFailure("prover");
      }
    },
    async runVerifier(context, packet, proposal, signal) {
      if (!checked || signal?.aborted) return unsupported("verifier");
      if (
        !validateReviewContextMetadata(context, "verifier").ok ||
        !validateReviewPacket(packet).ok ||
        !validateObjectionProposal(proposal, packet).ok
      )
        return malformed("verifier");
      try {
        const value = await checked.adapter.runVerifier(context, packet, proposal, signalFor(signal));
        const bounded = providerResultFailure("verifier", value);
        if (bounded) return bounded;
        const result = validateVerifierResult(value, proposal);
        return result.ok ? { ok: true, value: result.value } : validationFailure("verifier", result.code);
      } catch {
        if (signal?.aborted)
          return {
            ok: false,
            failure: Object.freeze({ status: "unavailable", phase: "verifier", reason: "cancelled" }),
          };
        return modelFailure("verifier");
      }
    },
    async cancelContext(context) {
      if (!checked || !validateReviewContextMetadata(context).ok) return undefined;
      try {
        await checked.adapter.cancelContext(context);
        return undefined;
      } catch {
        return Object.freeze({
          status: "audit_failed" as const,
          phase: context.provenance.role,
          reason: "cleanup" as const,
        });
      }
    },
  };
}

/** Production default: no attestation, context creation, or delegate calls. */
export const createUnsupportedAdversarialReviewSeam = (): AdversarialReviewSeam => createSeam();

/** Explicit injection point for a separately reviewed restricted adapter. */
export const createAdversarialReviewSeam = (adapter: RestrictedReviewAdapter): AdversarialReviewSeam =>
  createSeam(adapter);
