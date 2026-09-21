import type {
  ClaimAssumption,
  ClaimClass,
  ClaimIdentifier,
  ClaimNode,
  EvidenceReference,
  EvidenceStatus,
  LogicalDependency,
} from "./claim-graph";

/** The only roles that may participate in a restricted review. */
export type AdversarialReviewRole = "prover" | "verifier";

export type AdversarialReviewChannel = "review_packet" | "review_result";

/**
 * This is an exact, deny-by-default attestation. It describes a contract a
 * future adapter must prove; it is not a sandbox or a provider capability.
 */
export type RestrictedReviewPermissionAttestation = Readonly<{
  schemaVersion: "1";
  roles: readonly ["prover", "verifier"];
  permissions: Readonly<{
    repositoryRead: false;
    repositoryWrite: false;
    shell: false;
    packageManager: false;
    terminal: false;
    arbitraryTaskDelegation: false;
    afWorkspace: false;
    plugin: false;
    mcp: false;
    modelVisibleTools: false;
  }>;
  channels: Readonly<{
    reviewPacket: "review_packet";
    reviewResult: "review_result";
  }>;
}>;

export const RESTRICTED_REVIEW_PERMISSION_ATTESTATION: RestrictedReviewPermissionAttestation = Object.freeze({
  schemaVersion: "1",
  roles: ["prover", "verifier"] as const,
  permissions: Object.freeze({
    repositoryRead: false,
    repositoryWrite: false,
    shell: false,
    packageManager: false,
    terminal: false,
    arbitraryTaskDelegation: false,
    afWorkspace: false,
    plugin: false,
    mcp: false,
    modelVisibleTools: false,
  }),
  channels: Object.freeze({
    reviewPacket: "review_packet",
    reviewResult: "review_result",
  }),
});

export type ReviewContextProvenance = Readonly<{
  identity: string;
  role: AdversarialReviewRole;
  contextNumber: 1 | 2;
}>;

/** Opaque to callers; no execution or workspace meaning is attached to it. */
export type ReviewContextHandle = string & { readonly __reviewContextHandle: unique symbol };

export type ReviewContextMetadata = Readonly<{
  handle: ReviewContextHandle;
  provenance: ReviewContextProvenance;
}>;

export type ReviewPacketLimits = Readonly<{
  maxClaims: number;
  maxAssumptions: number;
  maxDependencies: number;
  maxEvidenceReferences: number;
  maxStatementLength: number;
  maxReasonLength: number;
}>;

export type ReviewPacket = Readonly<{
  packetId: ClaimIdentifier;
  conclusionId: ClaimIdentifier;
  claims: readonly ClaimNode[];
  assumptions: readonly ClaimAssumption[];
  logicalDependencies: readonly LogicalDependency[];
  evidenceReferences: readonly EvidenceReference[];
  evidenceStatus: EvidenceStatus;
  limits: ReviewPacketLimits;
}>;

export type ObjectionTarget = Readonly<{
  kind: "claim" | "assumption" | "logical_dependency" | "evidence";
  id: ClaimIdentifier;
}>;

export type ObjectionSeverity = "minor" | "major" | "critical";

export type Objection = Readonly<{
  objectionId: ClaimIdentifier;
  target: ObjectionTarget;
  severity: ObjectionSeverity;
  reason: string;
}>;

export type ObjectionProposal = Readonly<{
  proposalId: ClaimIdentifier;
  prover: ReviewContextProvenance;
  objections: readonly Objection[];
}>;

export type VerifierDispositionKind = "confirmed" | "rejected" | "unresolved";

export type VerifierDisposition = Readonly<{
  objectionId: ClaimIdentifier;
  disposition: VerifierDispositionKind;
  reason: string;
}>;

export type VerifierResult = Readonly<{
  verifier: ReviewContextProvenance;
  proposalId: ClaimIdentifier;
  dispositions: readonly VerifierDisposition[];
}>;

export type AdversarialReviewFailureReason =
  | "unsupported"
  | "malformed"
  | "oversized"
  | "cancelled"
  | "timeout"
  | "model_failure"
  | "provenance"
  | "policy"
  | "cleanup"
  | "ambiguous";

export type BoundedAdversarialReviewFailure = Readonly<{
  status: "unavailable" | "audit_failed" | "unresolved";
  phase: AdversarialReviewRole | "host";
  reason: AdversarialReviewFailureReason;
}>;
