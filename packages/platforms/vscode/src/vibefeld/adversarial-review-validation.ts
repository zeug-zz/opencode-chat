import {
  type AdversarialReviewRole,
  type Objection,
  type ObjectionProposal,
  RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
  type RestrictedReviewPermissionAttestation,
  type ReviewContextMetadata,
  type ReviewContextProvenance,
  type ReviewPacket,
  type ReviewPacketLimits,
  type VerifierResult,
} from "./adversarial-review-contract";
import { type ClaimGraph, type EvidenceStatus, validateClaimGraph } from "./claim-graph";

export type AdversarialValidationErrorCode =
  | "malformed"
  | "unknown-field"
  | "unsafe-value"
  | "over-limit"
  | "duplicate-identifier"
  | "unknown-target"
  | "provenance"
  | "policy"
  | "ambiguous";

export type AdversarialValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: AdversarialValidationErrorCode }>;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/;
const UNSAFE_TEXT =
  /(?:ignore\s+(?:all|any|the)\s+(?:previous|prior|above)|\b(?:prompt|command|argv|credential|password|secret|token|private\s*reasoning|chain[- ]of[- ]thought|ledger)\s*[:=]|(?:^|\s)(?:\/?(?:Users|private|home|tmp|var)\/|[A-Za-z]:[\\/])|https?:\/\/)/i;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_STATEMENT_LENGTH = 512;
const MAX_REASON_LENGTH = 256;
const MAX_OBJECTIONS = 128;
const MAX_PACKET_LIMITS = Object.freeze({
  maxClaims: 64,
  maxAssumptions: 128,
  maxDependencies: 128,
  maxEvidenceReferences: 128,
  maxStatementLength: MAX_STATEMENT_LENGTH,
  maxReasonLength: MAX_REASON_LENGTH,
});

const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  "not_required",
  "source_recorded",
  "unverified",
  "human_verified",
  "conflicted",
];
const ROLES: readonly AdversarialReviewRole[] = ["prover", "verifier"];
const TARGET_KINDS = ["claim", "assumption", "logical_dependency", "evidence"] as const;
const SEVERITIES = ["minor", "major", "critical"] as const;
const DISPOSITIONS = ["confirmed", "rejected", "unresolved"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function fail(code: AdversarialValidationErrorCode): AdversarialValidationResult<never> {
  return { ok: false, code };
}

function identifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && IDENTIFIER.test(value)
  );
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    [...value].every((character) => character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) !== 0x7f) &&
    !UNSAFE_TEXT.test(value)
  );
}

function numberWithin(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum;
}

function normalizedProvenance(
  value: unknown,
  role?: AdversarialReviewRole,
): AdversarialValidationResult<ReviewContextProvenance> {
  if (!isRecord(value) || !exactKeys(value, ["identity", "role", "contextNumber"])) return fail("unknown-field");
  if (!identifier(value.identity)) return fail("malformed");
  if (!ROLES.includes(value.role as AdversarialReviewRole) || (role !== undefined && value.role !== role))
    return fail("provenance");
  if (value.contextNumber !== 1 && value.contextNumber !== 2) return fail("malformed");
  if (
    (value.role === "prover" && value.contextNumber !== 1) ||
    (value.role === "verifier" && value.contextNumber !== 2)
  )
    return fail("provenance");
  return {
    ok: true,
    value: Object.freeze({
      identity: value.identity,
      role: value.role as AdversarialReviewRole,
      contextNumber: value.contextNumber,
    }),
  };
}

export function validateRestrictedReviewPermissionAttestation(
  value: unknown,
): AdversarialValidationResult<RestrictedReviewPermissionAttestation> {
  const permissionKeys = [
    "repositoryRead",
    "repositoryWrite",
    "shell",
    "packageManager",
    "terminal",
    "arbitraryTaskDelegation",
    "afWorkspace",
    "plugin",
    "mcp",
    "modelVisibleTools",
  ] as const;
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "roles", "permissions", "channels"]))
    return fail("unknown-field");
  if (!isRecord(value.permissions) || !isRecord(value.channels)) return fail("policy");
  const permissions = value.permissions;
  const channels = value.channels;
  if (
    value.schemaVersion !== "1" ||
    !Array.isArray(value.roles) ||
    value.roles.length !== 2 ||
    value.roles[0] !== "prover" ||
    value.roles[1] !== "verifier" ||
    !exactKeys(permissions, permissionKeys) ||
    permissionKeys.some((key) => permissions[key] !== false) ||
    !exactKeys(channels, ["reviewPacket", "reviewResult"]) ||
    channels.reviewPacket !== "review_packet" ||
    channels.reviewResult !== "review_result"
  )
    return fail("policy");
  return { ok: true, value: RESTRICTED_REVIEW_PERMISSION_ATTESTATION };
}

export function validateReviewContextMetadata(
  value: unknown,
  role?: AdversarialReviewRole,
): AdversarialValidationResult<ReviewContextMetadata> {
  if (!isRecord(value) || !exactKeys(value, ["handle", "provenance"])) return fail("unknown-field");
  if (!identifier(value.handle)) return fail("malformed");
  const provenance = normalizedProvenance(value.provenance, role);
  if (!provenance.ok) return provenance;
  return {
    ok: true,
    value: Object.freeze({ handle: value.handle as ReviewContextMetadata["handle"], provenance: provenance.value }),
  };
}

export function validateDistinctReviewContexts(
  prover: unknown,
  verifier: unknown,
): AdversarialValidationResult<Readonly<{ prover: ReviewContextMetadata; verifier: ReviewContextMetadata }>> {
  const first = validateReviewContextMetadata(prover, "prover");
  const second = validateReviewContextMetadata(verifier, "verifier");
  if (!first.ok) return first;
  if (!second.ok) return second;
  if (
    first.value.handle === second.value.handle ||
    first.value.provenance.identity === second.value.provenance.identity
  )
    return fail("provenance");
  return { ok: true, value: Object.freeze({ prover: first.value, verifier: second.value }) };
}

function validatePacketShape(value: unknown): AdversarialValidationResult<ReviewPacket> {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "packetId",
      "conclusionId",
      "claims",
      "assumptions",
      "logicalDependencies",
      "evidenceReferences",
      "evidenceStatus",
      "limits",
    ])
  )
    return fail("unknown-field");
  if (!identifier(value.packetId) || !identifier(value.conclusionId)) return fail("malformed");
  if (
    !Array.isArray(value.claims) ||
    !Array.isArray(value.assumptions) ||
    !Array.isArray(value.logicalDependencies) ||
    !Array.isArray(value.evidenceReferences)
  )
    return fail("malformed");
  if (!EVIDENCE_STATUSES.includes(value.evidenceStatus as EvidenceStatus)) return fail("malformed");
  if (!isRecord(value.limits) || !exactKeys(value.limits, Object.keys(MAX_PACKET_LIMITS))) return fail("unknown-field");
  const limits = value.limits as ReviewPacketLimits;
  const limitKeys = Object.keys(MAX_PACKET_LIMITS) as Array<keyof ReviewPacketLimits>;
  for (const key of limitKeys) if (!numberWithin(limits[key], MAX_PACKET_LIMITS[key])) return fail("over-limit");
  if (limits.maxStatementLength > MAX_STATEMENT_LENGTH || limits.maxReasonLength > MAX_REASON_LENGTH)
    return fail("over-limit");
  return { ok: true, value: value as ReviewPacket };
}

function validatePacketNestedShape(packet: ReviewPacket): AdversarialValidationResult<true> {
  const nodeKeys = [
    "id",
    "class",
    "statement",
    "assumptionIds",
    "logicalDependencyIds",
    "evidenceReferenceIds",
  ] as const;
  for (const claim of packet.claims) {
    if (
      !isRecord(claim) ||
      !exactKeys(claim, nodeKeys) ||
      !identifier(claim.id) ||
      !safeText(claim.statement, packet.limits.maxStatementLength) ||
      !Array.isArray(claim.assumptionIds) ||
      !Array.isArray(claim.logicalDependencyIds) ||
      !Array.isArray(claim.evidenceReferenceIds)
    )
      return fail("malformed");
  }
  for (const assumption of packet.assumptions)
    if (
      !isRecord(assumption) ||
      !exactKeys(assumption, ["id", "claimId", "statement"]) ||
      !identifier(assumption.id) ||
      !identifier(assumption.claimId) ||
      !safeText(assumption.statement, packet.limits.maxStatementLength)
    )
      return fail("malformed");
  for (const dependency of packet.logicalDependencies)
    if (
      !isRecord(dependency) ||
      !exactKeys(dependency, ["id", "fromClaimId", "toClaimId"]) ||
      !identifier(dependency.id) ||
      !identifier(dependency.fromClaimId) ||
      !identifier(dependency.toClaimId)
    )
      return fail("malformed");
  for (const reference of packet.evidenceReferences)
    if (
      !isRecord(reference) ||
      !exactKeys(reference, ["id", "claimId", "metadata"]) ||
      !identifier(reference.id) ||
      !identifier(reference.claimId) ||
      !isRecord(reference.metadata) ||
      Object.keys(reference.metadata).some((key) => !["sourceKind", "status", "conflictGroup"].includes(key)) ||
      ![2, 3].includes(Object.keys(reference.metadata).length) ||
      (reference.metadata.conflictGroup !== undefined && !identifier(reference.metadata.conflictGroup))
    )
      return fail("malformed");
  const graph: ClaimGraph = {
    conclusionId: packet.conclusionId,
    nodes: packet.claims,
    assumptions: packet.assumptions,
    logicalDependencies: packet.logicalDependencies,
    evidenceReferences: packet.evidenceReferences,
  };
  const checked = validateClaimGraph(graph, {
    maxSourceTextLength: 12_000,
    maxIdentifierLength: MAX_IDENTIFIER_LENGTH,
    maxStatementLength: packet.limits.maxStatementLength,
    maxNodeCount: packet.limits.maxClaims + packet.limits.maxAssumptions,
    maxClaimCount: packet.limits.maxClaims,
    maxAssumptionCount: packet.limits.maxAssumptions,
    maxLogicalDependencyCount: packet.limits.maxDependencies,
    maxEvidenceReferenceCount: packet.limits.maxEvidenceReferences,
    maxDepth: 16,
  });
  return checked.ok ? { ok: true, value: true } : fail("malformed");
}

export function validateReviewPacket(value: unknown): AdversarialValidationResult<ReviewPacket> {
  const shape = validatePacketShape(value);
  if (!shape.ok) return shape;
  if (
    shape.value.claims.length > shape.value.limits.maxClaims ||
    shape.value.assumptions.length > shape.value.limits.maxAssumptions ||
    shape.value.logicalDependencies.length > shape.value.limits.maxDependencies ||
    shape.value.evidenceReferences.length > shape.value.limits.maxEvidenceReferences
  )
    return fail("over-limit");
  const nested = validatePacketNestedShape(shape.value);
  if (!nested.ok) return nested;
  const ids = [
    ...shape.value.claims,
    ...shape.value.assumptions,
    ...shape.value.logicalDependencies,
    ...shape.value.evidenceReferences,
  ].map((item) => item.id);
  if (new Set(ids).size !== ids.length) return fail("duplicate-identifier");
  return { ok: true, value: shape.value };
}

function targetIds(packet: ReviewPacket, kind: string): Set<string> {
  if (kind === "claim") return new Set(packet.claims.map(({ id }) => id));
  if (kind === "assumption") return new Set(packet.assumptions.map(({ id }) => id));
  if (kind === "logical_dependency") return new Set(packet.logicalDependencies.map(({ id }) => id));
  return new Set(packet.evidenceReferences.map(({ id }) => id));
}

export function validateObjectionProposal(
  value: unknown,
  packet: ReviewPacket,
): AdversarialValidationResult<ObjectionProposal> {
  if (!validateReviewPacket(packet).ok) return fail("malformed");
  if (!isRecord(value) || !exactKeys(value, ["proposalId", "prover", "objections"])) return fail("unknown-field");
  if (!identifier(value.proposalId) || !Array.isArray(value.objections)) return fail("malformed");
  const prover = normalizedProvenance(value.prover, "prover");
  if (!prover.ok) return prover;
  if (value.objections.length > MAX_OBJECTIONS) return fail("over-limit");
  const ids = new Set<string>();
  const objections: Objection[] = [];
  for (const raw of value.objections) {
    if (!isRecord(raw) || !exactKeys(raw, ["objectionId", "target", "severity", "reason"]))
      return fail("unknown-field");
    if (!identifier(raw.objectionId) || ids.has(raw.objectionId)) return fail("duplicate-identifier");
    if (
      !isRecord(raw.target) ||
      !exactKeys(raw.target, ["kind", "id"]) ||
      !TARGET_KINDS.includes(raw.target.kind as (typeof TARGET_KINDS)[number]) ||
      !identifier(raw.target.id)
    )
      return fail("unknown-target");
    const targetKind = raw.target.kind as (typeof TARGET_KINDS)[number];
    const severity = raw.severity as (typeof SEVERITIES)[number];
    if (!targetIds(packet, targetKind).has(raw.target.id)) return fail("unknown-target");
    if (!SEVERITIES.includes(severity)) return fail("malformed");
    if (!safeText(raw.reason, packet.limits.maxReasonLength))
      return fail(
        raw.reason && typeof raw.reason === "string" && raw.reason.length > packet.limits.maxReasonLength
          ? "over-limit"
          : "unsafe-value",
      );
    ids.add(raw.objectionId);
    objections.push({
      objectionId: raw.objectionId,
      target: { kind: targetKind, id: raw.target.id },
      severity,
      reason: raw.reason,
    });
  }
  return { ok: true, value: Object.freeze({ proposalId: value.proposalId, prover: prover.value, objections }) };
}

export function validateVerifierResult(
  value: unknown,
  proposal: ObjectionProposal,
): AdversarialValidationResult<VerifierResult> {
  if (!isRecord(value) || !exactKeys(value, ["verifier", "proposalId", "dispositions"])) return fail("unknown-field");
  if (!identifier(value.proposalId) || value.proposalId !== proposal.proposalId || !Array.isArray(value.dispositions))
    return fail("provenance");
  const verifier = normalizedProvenance(value.verifier, "verifier");
  if (!verifier.ok || verifier.value.identity === proposal.prover.identity) return fail("provenance");
  const proposalIds = new Set(proposal.objections.map(({ objectionId }) => objectionId));
  const seen = new Set<string>();
  if (value.dispositions.length !== proposal.objections.length) return fail("ambiguous");
  const dispositions: Array<VerifierResult["dispositions"][number]> = [];
  for (const raw of value.dispositions) {
    if (!isRecord(raw) || !exactKeys(raw, ["objectionId", "disposition", "reason"])) return fail("unknown-field");
    if (!identifier(raw.objectionId) || !proposalIds.has(raw.objectionId)) return fail("unknown-target");
    if (seen.has(raw.objectionId)) return fail("ambiguous");
    if (!DISPOSITIONS.includes(raw.disposition as (typeof DISPOSITIONS)[number])) return fail("malformed");
    if (!safeText(raw.reason, MAX_REASON_LENGTH))
      return fail(
        raw.reason && typeof raw.reason === "string" && raw.reason.length > MAX_REASON_LENGTH
          ? "over-limit"
          : "unsafe-value",
      );
    seen.add(raw.objectionId);
    dispositions.push({
      objectionId: raw.objectionId,
      disposition: raw.disposition as VerifierResult["dispositions"][number]["disposition"],
      reason: raw.reason,
    });
  }
  return { ok: true, value: Object.freeze({ verifier: verifier.value, proposalId: value.proposalId, dispositions }) };
}
