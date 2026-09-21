import {
  type ClaimProjectionCapability,
  type ClaimProjectionSeam,
  createClaimProjectionSeam,
  createUnsupportedClaimProjectionSeam,
  type NormalizedProjectionOutcome,
} from "./claim-projection-seam";

/**
 * TEST-ONLY: this adapter accepts sanitized fixture facts, never runtime or
 * provider output. It must not be imported by activation or production code.
 */
const FIXTURE_KEYS = ["fixtureId", "fixtureVersion", "claimCapability", "outcome"] as const;
const FIXTURE_MARKER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STRUCTURAL_STATUSES = ["structurally_checked", "conditional", "unresolved", "refuted"] as const;
const FAILURE_STATUSES = ["unavailable", "audit_failed"] as const;
const FAILURE_REASONS = [
  "unsupported",
  "malformed",
  "oversized",
  "timeout",
  "cancelled",
  "signaled",
  "policy",
  "cleanup",
  "audit",
] as const;

type FixtureClaimProjectionDeclaration = Readonly<{
  fixtureId: string;
  fixtureVersion: string;
  claimCapability: true;
  outcome: NormalizedProjectionOutcome;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>): boolean =>
  Object.keys(value).every((key) => FIXTURE_KEYS.includes(key as (typeof FIXTURE_KEYS)[number]));

function isFixtureMarker(value: unknown): value is string {
  return typeof value === "string" && FIXTURE_MARKER.test(value);
}

function isNormalizedOutcome(value: unknown): value is NormalizedProjectionOutcome {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 1 && typeof value.status === "string") {
    return STRUCTURAL_STATUSES.includes(value.status as (typeof STRUCTURAL_STATUSES)[number]);
  }
  return (
    keys.length === 2 &&
    FAILURE_STATUSES.includes(value.status as (typeof FAILURE_STATUSES)[number]) &&
    FAILURE_REASONS.includes(value.reason as (typeof FAILURE_REASONS)[number])
  );
}

function isFixtureDeclaration(value: unknown): value is FixtureClaimProjectionDeclaration {
  return (
    isRecord(value) &&
    hasOnlyKeys(value) &&
    isFixtureMarker(value.fixtureId) &&
    isFixtureMarker(value.fixtureVersion) &&
    value.claimCapability === true &&
    isNormalizedOutcome(value.outcome)
  );
}

/** A private fixture adapter; invalid or non-capable declarations stay unsupported. */
export function createFixtureOnlyClaimProjectionSeam(declaration: unknown): ClaimProjectionSeam {
  if (!isFixtureDeclaration(declaration)) return createUnsupportedClaimProjectionSeam();

  const outcome = Object.freeze({ ...declaration.outcome }) as NormalizedProjectionOutcome;
  const capability: ClaimProjectionCapability = Object.freeze({ supported: true, operation: "claim_projection" });
  return createClaimProjectionSeam({
    capability,
    project: () => outcome,
  });
}
