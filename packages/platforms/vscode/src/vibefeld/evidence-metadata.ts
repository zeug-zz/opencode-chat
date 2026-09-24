import type { ClaimGraph, EvidenceReference, EvidenceSourceKind, EvidenceStatus } from "./claim-graph";

const SOURCE_KINDS: readonly EvidenceSourceKind[] = ["citation", "observation", "calculation", "procedure", "human"];
const STATUSES: readonly EvidenceStatus[] = [
  "not_required",
  "source_recorded",
  "unverified",
  "human_verified",
  "conflicted",
];
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/;
const UNSAFE =
  /(?:prompt|command|argv|credential|password|secret|token|private\s*reasoning|chain[- ]of[- ]thought|ledger|https?:\/\/|(?:^|[\\/])(?:Users|private|home|tmp|var)(?:[\\/]|$))/i;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_REFERENCES = 128;

export type NormalizedEvidenceReference = Readonly<{
  id: string;
  claimId: string;
  metadata: Readonly<{
    sourceKind: EvidenceSourceKind;
    status: EvidenceStatus;
    conflictGroup?: string;
  }>;
}>;

export type EvidenceAssessment = Readonly<{
  references: readonly NormalizedEvidenceReference[];
  claims: Readonly<Record<string, EvidenceStatus>>;
  status: EvidenceStatus;
}>;

export type EvidenceNormalizationErrorCode = "malformed" | "unsafe-value" | "over-limit" | "duplicate-identifier";

export type EvidenceNormalizationResult =
  | Readonly<{ ok: true; assessment: EvidenceAssessment }>
  | Readonly<{ ok: false; code: EvidenceNormalizationErrorCode }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && IDENTIFIER.test(value)
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function normalizeReference(value: unknown): NormalizedEvidenceReference | EvidenceNormalizationErrorCode {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "claimId", "metadata"])) return "malformed";
  if (!isIdentifier(value.id) || !isIdentifier(value.claimId) || !isRecord(value.metadata)) return "malformed";
  const metadata = value.metadata;
  if (!hasOnlyKeys(metadata, ["sourceKind", "status", "conflictGroup"])) return "malformed";
  if (!SOURCE_KINDS.includes(metadata.sourceKind as EvidenceSourceKind)) return "malformed";
  if (!STATUSES.includes(metadata.status as EvidenceStatus)) return "malformed";
  if (metadata.conflictGroup !== undefined && !isIdentifier(metadata.conflictGroup)) return "malformed";
  if (
    UNSAFE.test(value.id) ||
    UNSAFE.test(value.claimId) ||
    UNSAFE.test(metadata.sourceKind as string) ||
    UNSAFE.test(metadata.status as string) ||
    (typeof metadata.conflictGroup === "string" && UNSAFE.test(metadata.conflictGroup))
  )
    return "unsafe-value";

  return {
    id: value.id,
    claimId: value.claimId,
    metadata: {
      sourceKind: metadata.sourceKind as EvidenceSourceKind,
      status: metadata.status as EvidenceStatus,
      ...(metadata.conflictGroup === undefined ? {} : { conflictGroup: metadata.conflictGroup }),
    },
  };
}

function rank(status: EvidenceStatus): number {
  return {
    not_required: 0,
    human_verified: 1,
    source_recorded: 2,
    unverified: 3,
    conflicted: 4,
  }[status];
}

function strongest(statuses: readonly EvidenceStatus[]): EvidenceStatus {
  return statuses.reduce<EvidenceStatus>(
    (current, status) => (rank(status) > rank(current) ? status : current),
    "not_required",
  );
}

/**
 * Normalize only bounded evidence metadata. The input is intentionally an
 * unknown seam so provider-shaped objects cannot leak into the host-private
 * representation.
 */
export function normalizeEvidenceReferences(input: unknown): EvidenceNormalizationResult {
  if (!Array.isArray(input)) return { ok: false, code: "malformed" };
  if (input.length > MAX_REFERENCES) return { ok: false, code: "over-limit" };

  const references: NormalizedEvidenceReference[] = [];
  const ids = new Set<string>();
  for (const value of input) {
    const normalized = normalizeReference(value);
    if (typeof normalized === "string") return { ok: false, code: normalized };
    if (ids.has(normalized.id)) return { ok: false, code: "duplicate-identifier" };
    ids.add(normalized.id);
    references.push(normalized);
  }

  const groups = new Map<string, NormalizedEvidenceReference[]>();
  for (const reference of references) {
    if (reference.metadata.conflictGroup === undefined) continue;
    groups.set(reference.metadata.conflictGroup, [...(groups.get(reference.metadata.conflictGroup) ?? []), reference]);
  }
  const conflictingIds = new Set(
    [...groups.values()]
      .filter((group) => new Set(group.map(({ metadata }) => metadata.status)).size > 1)
      .flatMap((group) => group.map(({ id }) => id)),
  );

  const statusesByClaim = new Map<string, EvidenceStatus[]>();
  for (const reference of references) {
    const status =
      reference.metadata.status === "conflicted" || conflictingIds.has(reference.id)
        ? "conflicted"
        : reference.metadata.status;
    statusesByClaim.set(reference.claimId, [...(statusesByClaim.get(reference.claimId) ?? []), status]);
  }
  const claims: Record<string, EvidenceStatus> = {};
  for (const [claimId, statuses] of statusesByClaim) claims[claimId] = strongest(statuses);
  const status = strongest(Object.values(claims));

  return { ok: true, assessment: { references, claims, status } };
}

/** Assess graph evidence without ever folding it into logical dependencies. */
export function assessClaimGraphEvidence(graph: ClaimGraph): EvidenceNormalizationResult {
  return normalizeEvidenceReferences(graph.evidenceReferences satisfies readonly EvidenceReference[]);
}
