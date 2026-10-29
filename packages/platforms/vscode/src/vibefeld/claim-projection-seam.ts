import { type ClaimGraph, validateClaimGraph } from "./claim-graph";
import type { AfBridgeFailureReason } from "./vibefeld-runtime";

export type { ClaimGraph } from "./claim-graph";

export type ClaimProjectionStructuralStatus = "structurally_checked" | "conditional" | "unresolved" | "refuted";

export type ClaimProjectionFailureReason =
  | "unsupported"
  | "malformed"
  | "oversized"
  | "timeout"
  | "cancelled"
  | "signaled"
  | "policy"
  | "cleanup"
  | "audit";

export const CLAIM_PROJECTION_DIAGNOSTIC_FAILURE_CLASSES = [
  "unsupported-platform",
  "missing-executable",
  "policy-unavailable",
  "preflight-failed",
  "runtime-mismatch",
  "operation-not-ready",
  "cancelled",
  "timeout",
  "malformed",
  "oversized",
  "non-zero",
  "signaled",
  "cleanup-failure",
  "audit-failure",
  "other",
] as const satisfies readonly (AfBridgeFailureReason | "other")[];

export const CLAIM_PROJECTION_DIAGNOSTIC_OPERATIONS = ["init", "claim", "refine", "status"] as const;

export type ClaimProjectionDiagnosticFailureClass = (typeof CLAIM_PROJECTION_DIAGNOSTIC_FAILURE_CLASSES)[number];
export type ClaimProjectionDiagnosticOperation = (typeof CLAIM_PROJECTION_DIAGNOSTIC_OPERATIONS)[number];
export type ClaimProjectionDiagnosticOutcome =
  | "projection-unsupported"
  | "projection-graph-invalid"
  | "projection-statement-empty"
  | "projection-statement-too-long"
  | "projection-statement-shell-token"
  | "projection-begin-not-ready"
  | `projection-begin-${Exclude<ClaimProjectionDiagnosticFailureClass, "operation-not-ready" | "cancelled">}`
  | `projection-${ClaimProjectionDiagnosticOperation}-failed-${Exclude<ClaimProjectionDiagnosticFailureClass, "cancelled">}`
  | `projection-${ClaimProjectionDiagnosticOperation}-facts-mismatch`
  | "projection-cancelled"
  | "projection-completed"
  | "projection-unresolved"
  | "projection-result-invalid"
  | "projection-result-failed";

export type ClaimProjectionDiagnosticObserver = (outcome: ClaimProjectionDiagnosticOutcome) => void;

export type ClaimProjectionSeamOptions = Readonly<{
  observer?: ClaimProjectionDiagnosticObserver;
  classifyInvalidGraph?: (graph: unknown) => ClaimProjectionDiagnosticOutcome;
}>;

const PROJECTION_OPERATION_FAILURE_OUTCOMES = CLAIM_PROJECTION_DIAGNOSTIC_OPERATIONS.flatMap((operation) =>
  CLAIM_PROJECTION_DIAGNOSTIC_FAILURE_CLASSES.filter((reasonClass) => reasonClass !== "cancelled").map(
    (reasonClass) => `projection-${operation}-failed-${reasonClass}` as const,
  ),
);
const PROJECTION_BEGIN_FAILURE_OUTCOMES = CLAIM_PROJECTION_DIAGNOSTIC_FAILURE_CLASSES.filter(
  (reasonClass) => reasonClass !== "operation-not-ready" && reasonClass !== "cancelled",
).map((reasonClass) => `projection-begin-${reasonClass}` as const);

/** The fixed labels the extension diagnostic reporter may accept for claim projection. */
export const CLAIM_PROJECTION_DIAGNOSTIC_OUTCOMES: readonly ClaimProjectionDiagnosticOutcome[] = Object.freeze([
  "projection-unsupported",
  "projection-graph-invalid",
  "projection-statement-empty",
  "projection-statement-too-long",
  "projection-statement-shell-token",
  "projection-begin-not-ready",
  ...PROJECTION_BEGIN_FAILURE_OUTCOMES,
  ...PROJECTION_OPERATION_FAILURE_OUTCOMES,
  ...CLAIM_PROJECTION_DIAGNOSTIC_OPERATIONS.map((operation) => `projection-${operation}-facts-mismatch` as const),
  "projection-cancelled",
  "projection-completed",
  "projection-unresolved",
  "projection-result-invalid",
  "projection-result-failed",
]);

export type NormalizedProjectionOutcome =
  | Readonly<{ status: ClaimProjectionStructuralStatus }>
  | Readonly<{ status: "unavailable" | "audit_failed"; reason: ClaimProjectionFailureReason }>;

export type ClaimProjectionCapability =
  | Readonly<{ supported: false }>
  | Readonly<{ supported: true; operation: "claim_projection" }>;

/** The only delegate input is a validated, host-private graph and cancellation signal. */
export type ClaimProjectionDelegate = (
  graph: ClaimGraph,
  signal: AbortSignal,
  observer: ClaimProjectionDiagnosticObserver,
) => unknown | Promise<unknown>;

export type ClaimProjectionDelegateAdapter = Readonly<{
  capability: ClaimProjectionCapability;
  project: ClaimProjectionDelegate;
}>;

export interface ClaimProjectionSeam {
  getCapability(): ClaimProjectionCapability;
  project(graph: ClaimGraph, signal?: AbortSignal): Promise<NormalizedProjectionOutcome>;
}

const STRUCTURAL_STATUSES: readonly ClaimProjectionStructuralStatus[] = [
  "structurally_checked",
  "conditional",
  "unresolved",
  "refuted",
];
const FAILURE_STATUSES = ["unavailable", "audit_failed"] as const;
const FAILURE_REASONS: readonly ClaimProjectionFailureReason[] = [
  "unsupported",
  "malformed",
  "oversized",
  "timeout",
  "cancelled",
  "signaled",
  "policy",
  "cleanup",
  "audit",
];
const GRAPH_KEYS = ["conclusionId", "nodes", "assumptions", "logicalDependencies", "evidenceReferences"] as const;
const NODE_KEYS = [
  "id",
  "class",
  "statement",
  "assumptionIds",
  "logicalDependencyIds",
  "evidenceReferenceIds",
] as const;
const ASSUMPTION_KEYS = ["id", "claimId", "statement"] as const;
const DEPENDENCY_KEYS = ["id", "fromClaimId", "toClaimId"] as const;
const EVIDENCE_KEYS = ["id", "claimId", "metadata"] as const;
const METADATA_KEYS = ["sourceKind", "status", "conflictGroup"] as const;
const MAX_RESULT_KEYS = 2;
const MAX_RESULT_TEXT = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

/**
 * The graph validator intentionally reports domain errors. This stricter shape
 * check additionally prevents a future/private caller from smuggling provider
 * fields through an object that otherwise resembles a ClaimGraph.
 */
function hasPrivateGraphShape(value: unknown): value is ClaimGraph {
  if (!isRecord(value) || !hasOnlyKeys(value, GRAPH_KEYS)) return false;
  if (
    typeof value.conclusionId !== "string" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.assumptions) ||
    !Array.isArray(value.logicalDependencies) ||
    !Array.isArray(value.evidenceReferences)
  )
    return false;
  if (
    !value.nodes.every(
      (node) =>
        isRecord(node) &&
        hasOnlyKeys(node, NODE_KEYS) &&
        Array.isArray(node.assumptionIds) &&
        Array.isArray(node.logicalDependencyIds) &&
        Array.isArray(node.evidenceReferenceIds),
    )
  )
    return false;
  if (!value.assumptions.every((assumption) => isRecord(assumption) && hasOnlyKeys(assumption, ASSUMPTION_KEYS)))
    return false;
  if (
    !value.logicalDependencies.every((dependency) => isRecord(dependency) && hasOnlyKeys(dependency, DEPENDENCY_KEYS))
  )
    return false;
  return value.evidenceReferences.every(
    (reference) =>
      isRecord(reference) &&
      hasOnlyKeys(reference, EVIDENCE_KEYS) &&
      isRecord(reference.metadata) &&
      hasOnlyKeys(reference.metadata, METADATA_KEYS),
  );
}

function unsupported(): NormalizedProjectionOutcome {
  return Object.freeze({ status: "unavailable", reason: "unsupported" as const });
}

function cancelled(): NormalizedProjectionOutcome {
  return Object.freeze({ status: "unavailable", reason: "cancelled" as const });
}

function normalizedResult(value: unknown): NormalizedProjectionOutcome {
  if (!isRecord(value)) return Object.freeze({ status: "unavailable", reason: "malformed" as const });
  const keys = Object.keys(value);
  if (keys.length > MAX_RESULT_KEYS) return Object.freeze({ status: "unavailable", reason: "malformed" as const });
  if (typeof value.status !== "string" || value.status.length > MAX_RESULT_TEXT)
    return Object.freeze({ status: "unavailable", reason: "oversized" as const });
  if (STRUCTURAL_STATUSES.includes(value.status as ClaimProjectionStructuralStatus)) {
    return keys.length === 1
      ? Object.freeze({ status: value.status as ClaimProjectionStructuralStatus })
      : Object.freeze({ status: "unavailable", reason: "malformed" as const });
  }
  if (!FAILURE_STATUSES.includes(value.status as (typeof FAILURE_STATUSES)[number]))
    return Object.freeze({ status: "unavailable", reason: "malformed" as const });
  if (
    keys.length !== 2 ||
    typeof value.reason !== "string" ||
    !FAILURE_REASONS.includes(value.reason as ClaimProjectionFailureReason)
  )
    return Object.freeze({ status: "unavailable", reason: "malformed" as const });
  return Object.freeze({
    status: value.status as "unavailable" | "audit_failed",
    reason: value.reason as ClaimProjectionFailureReason,
  });
}

function createSeam(
  adapter?: ClaimProjectionDelegateAdapter,
  options: ClaimProjectionSeamOptions = {},
): ClaimProjectionSeam {
  const capability: ClaimProjectionCapability =
    adapter &&
    isRecord(adapter) &&
    isRecord(adapter.capability) &&
    ((adapter.capability.supported === false && Object.keys(adapter.capability).length === 1) ||
      (adapter.capability.supported === true &&
        adapter.capability.operation === "claim_projection" &&
        Object.keys(adapter.capability).length === 2))
      ? Object.freeze(
          adapter.capability.supported
            ? { supported: true as const, operation: "claim_projection" as const }
            : { supported: false as const },
        )
      : Object.freeze({ supported: false as const });
  const delegate =
    capability.supported && adapter && typeof adapter.project === "function" ? adapter.project : undefined;

  return {
    getCapability: () => capability,
    async project(graph: ClaimGraph, signal?: AbortSignal): Promise<NormalizedProjectionOutcome> {
      let diagnosticReported = false;
      const report = (outcome: ClaimProjectionDiagnosticOutcome): void => {
        if (diagnosticReported) return;
        diagnosticReported = true;
        try {
          options.observer?.(outcome);
        } catch {
          // Diagnostics are observational and must not change the projection result.
        }
      };

      if (signal?.aborted) {
        report("projection-cancelled");
        return cancelled();
      }
      if (!capability.supported || !delegate) {
        report("projection-unsupported");
        return unsupported();
      }
      if (!hasPrivateGraphShape(graph) || !validateClaimGraph(graph).ok) {
        let diagnostic: ClaimProjectionDiagnosticOutcome = "projection-graph-invalid";
        try {
          const classified = options.classifyInvalidGraph?.(graph);
          if (classified && CLAIM_PROJECTION_DIAGNOSTIC_OUTCOMES.includes(classified)) diagnostic = classified;
        } catch {
          // Invalid graph classification is best effort and never receives graph content in output.
        }
        report(diagnostic);
        return Object.freeze({ status: "unavailable", reason: "malformed" as const });
      }

      let onAbort: (() => void) | undefined;
      try {
        const result = Promise.resolve().then(() => delegate(graph, signal ?? new AbortController().signal, report));
        const cancellation = signal
          ? new Promise<NormalizedProjectionOutcome>((resolve) => {
              onAbort = () => resolve(cancelled());
              signal.addEventListener("abort", onAbort, { once: true });
            })
          : undefined;
        const value = cancellation ? await Promise.race([result, cancellation]) : await result;
        if (signal?.aborted) {
          report("projection-cancelled");
          return cancelled();
        }
        const normalized = normalizedResult(value);
        if (!diagnosticReported) {
          if ("reason" in normalized) {
            report(normalized.reason === "malformed" ? "projection-result-invalid" : "projection-result-failed");
          } else if (normalized.status === "unresolved") {
            report("projection-unresolved");
          } else {
            report("projection-completed");
          }
        }
        return normalized;
      } catch {
        report("projection-result-failed");
        return Object.freeze({ status: "audit_failed", reason: "audit" as const });
      } finally {
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Default production seam: capability is absent and no delegate is invoked. */
export const createUnsupportedClaimProjectionSeam = (options?: ClaimProjectionSeamOptions): ClaimProjectionSeam =>
  createSeam(undefined, options);

/** Narrow injected seam for a later fixture-derived capability or focused tests. */
export const createClaimProjectionSeam = (
  adapter: ClaimProjectionDelegateAdapter,
  options?: ClaimProjectionSeamOptions,
): ClaimProjectionSeam => createSeam(adapter, options);
