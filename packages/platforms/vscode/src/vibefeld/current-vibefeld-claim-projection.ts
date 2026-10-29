import { AF_MAX_REFINE_STATEMENTS } from "./af-command-schema";
import { AF_FIXTURE_LIMITS } from "./af-runtime-contract";
import type { ClaimGraph } from "./claim-graph";
import {
  CLAIM_PROJECTION_DIAGNOSTIC_FAILURE_CLASSES,
  type ClaimProjectionCapability,
  type ClaimProjectionDelegate,
  type ClaimProjectionDiagnosticFailureClass,
  type ClaimProjectionDiagnosticObserver,
  type ClaimProjectionDiagnosticOperation,
  type ClaimProjectionDiagnosticOutcome,
  type ClaimProjectionSeam,
  createClaimProjectionSeam,
  createUnsupportedClaimProjectionSeam,
  type NormalizedProjectionOutcome,
} from "./claim-projection-seam";
import type { AfBridgeOperation, AfBridgeResult, VibefeldRuntimeBridge } from "./vibefeld-runtime";

/**
 * The bridge operations the production claim seam may reach. Claim projection
 * stays gated on the bridge's explicit capability report: compatibility,
 * initialization, or status facts alone never authorize a projection, and
 * capability discovery never preflights, spawns, or allocates a workspace.
 */
export type CurrentVibefeldRuntimeBoundary = Pick<
  VibefeldRuntimeBridge,
  "preflight" | "run" | "teardown" | "beginReview" | "getClaimCapability"
>;

/** Host-fixed prover identity and review root; never graph-, model-, or caller-derived. */
const PROJECTION_AUTHOR = "scribe";
const PROJECTION_ROOT_NODE_ID = "1";
const PROJECTION_ROOT_ROLE = "prover" as const;

/**
 * Mirrors the fixed command schema's shell-token rejection so an out-of-bounds
 * statement is refused before any bridge call and is never truncated.
 */
const SHELL_TOKEN = /[;&|`$\n\r]|\$\(|\b(?:sh|bash|zsh|fish|powershell|cmd)\s+-c\b/i;

const CLAIM_CAPABILITY_KEYS = ["supported", "operation"] as const;
const DIAGNOSTIC_FAILURE_CLASSES = new Set<string>(CLAIM_PROJECTION_DIAGNOSTIC_FAILURE_CLASSES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const CANCELLED_OUTCOME: NormalizedProjectionOutcome = Object.freeze({
  status: "unavailable",
  reason: "cancelled" as const,
});
const OVERSIZED_OUTCOME: NormalizedProjectionOutcome = Object.freeze({
  status: "unavailable",
  reason: "oversized" as const,
});
const MALFORMED_OUTCOME: NormalizedProjectionOutcome = Object.freeze({
  status: "unavailable",
  reason: "malformed" as const,
});
const UNRESOLVED_OUTCOME: NormalizedProjectionOutcome = Object.freeze({ status: "unresolved" as const });
const STRUCTURALLY_CHECKED_OUTCOME: NormalizedProjectionOutcome = Object.freeze({
  status: "structurally_checked" as const,
});

/**
 * Exact-shape capability read. Only a callable report returning exactly
 * `{ supported: true, operation: "claim_projection" }` authorizes projection;
 * a missing method, a throw, or any other shape is a missing capability.
 */
function readClaimCapability(runtime: CurrentVibefeldRuntimeBoundary): ClaimProjectionCapability {
  try {
    const report = (runtime as Partial<CurrentVibefeldRuntimeBoundary>).getClaimCapability;
    if (typeof report !== "function") return Object.freeze({ supported: false });
    const value: unknown = report.call(runtime);
    const keys = isRecord(value) ? Object.keys(value) : [];
    if (
      !isRecord(value) ||
      keys.length !== CLAIM_CAPABILITY_KEYS.length ||
      !CLAIM_CAPABILITY_KEYS.every((key) => keys.includes(key)) ||
      value.supported !== true ||
      value.operation !== "claim_projection"
    )
      return Object.freeze({ supported: false });
    return Object.freeze({ supported: true, operation: "claim_projection" });
  } catch {
    return Object.freeze({ supported: false });
  }
}

/** Maps a non-ready bridge result into the bounded failure vocabulary. */
function failureOutcome(result: AfBridgeResult): NormalizedProjectionOutcome {
  switch (result.reason) {
    case "cancelled":
      return CANCELLED_OUTCOME;
    case "timeout":
      return Object.freeze({ status: "unavailable", reason: "timeout" as const });
    case "signaled":
      return Object.freeze({ status: "unavailable", reason: "signaled" as const });
    case "oversized":
      return OVERSIZED_OUTCOME;
    case "policy-unavailable":
      return Object.freeze({ status: "unavailable", reason: "policy" as const });
    case "cleanup-failure":
      return Object.freeze({ status: "audit_failed", reason: "cleanup" as const });
    case "audit-failure":
      return Object.freeze({ status: "audit_failed", reason: "audit" as const });
    default:
      return MALFORMED_OUTCOME;
  }
}

/** A ready result must not also carry a bounded failure reason. */
const isReadyResult = (result: AfBridgeResult): boolean => result.state === "ready" && result.reason === undefined;

function boundedFailureClass(reason: unknown): ClaimProjectionDiagnosticFailureClass {
  return typeof reason === "string" && DIAGNOSTIC_FAILURE_CLASSES.has(reason)
    ? (reason as ClaimProjectionDiagnosticFailureClass)
    : "other";
}

function beginFailureDiagnostic(result: AfBridgeResult): ClaimProjectionDiagnosticOutcome {
  const reason = boundedFailureClass(result.reason);
  if (reason === "cancelled") return "projection-cancelled";
  return reason === "operation-not-ready" ? "projection-begin-not-ready" : `projection-begin-${reason}`;
}

function operationFailureDiagnostic(
  operation: ClaimProjectionDiagnosticOperation,
  reason: unknown,
): ClaimProjectionDiagnosticOutcome {
  const failureClass = boundedFailureClass(reason);
  return failureClass === "cancelled" ? "projection-cancelled" : `projection-${operation}-failed-${failureClass}`;
}

function projectionStatementDiagnostic(statement: unknown): ClaimProjectionDiagnosticOutcome | undefined {
  if (typeof statement !== "string") return undefined;
  if (statement.length === 0) return "projection-statement-empty";
  if (statement.length > AF_FIXTURE_LIMITS.stringLength) return "projection-statement-too-long";
  if (SHELL_TOKEN.test(statement)) return "projection-statement-shell-token";
  return undefined;
}

function invalidGraphDiagnostic(graph: unknown): ClaimProjectionDiagnosticOutcome {
  if (isRecord(graph) && Array.isArray(graph.nodes)) {
    for (const node of graph.nodes) {
      if (!isRecord(node)) continue;
      const statementOutcome = projectionStatementDiagnostic(node.statement);
      if (statementOutcome) return statementOutcome;
    }
  }
  return "projection-graph-invalid";
}

const isBoundedStatement = (statement: unknown): statement is string =>
  typeof statement === "string" &&
  statement.length > 0 &&
  statement.length <= AF_FIXTURE_LIMITS.stringLength &&
  !SHELL_TOKEN.test(statement);

const isInitFacts = (facts: unknown): boolean => isRecord(facts) && facts.initialized === true;

const isClaimFacts = (facts: unknown): boolean =>
  isRecord(facts) && facts.nodeId === PROJECTION_ROOT_NODE_ID && facts.claimed === true;

const isRefineFacts = (facts: unknown, childCount: number): boolean =>
  isRecord(facts) &&
  facts.parentId === PROJECTION_ROOT_NODE_ID &&
  facts.childCount === childCount &&
  Array.isArray(facts.childIds) &&
  facts.childIds.length === childCount;

const isStatusFacts = (facts: unknown, totalNodes: number): boolean =>
  isRecord(facts) && isRecord(facts.statistics) && facts.statistics.totalNodes === totalNodes;

/**
 * The production delegate: one review root, `init` with the bounded conclusion,
 * `claim` of the host-fixed root, bounded `refine` chunks of every remaining
 * statement, and one `status` read-back. It returns normalized outcomes only;
 * raw bridge output, facts beyond the calibrated counts, and statement content
 * never leave this function.
 */
function createBridgeProjection(runtime: CurrentVibefeldRuntimeBoundary): ClaimProjectionDelegate {
  return async (
    graph: ClaimGraph,
    signal: AbortSignal,
    observer: ClaimProjectionDiagnosticObserver,
  ): Promise<NormalizedProjectionOutcome> => {
    const report = (outcome: ClaimProjectionDiagnosticOutcome): void => {
      try {
        observer(outcome);
      } catch {
        // Projection diagnostics are observational.
      }
    };

    if (signal.aborted) {
      report("projection-cancelled");
      return CANCELLED_OUTCOME;
    }

    const conclusion = graph.nodes.find((node) => node.id === graph.conclusionId);
    // Defensive only: the seam validates the graph before the delegate runs.
    if (!conclusion) {
      report("projection-graph-invalid");
      return MALFORMED_OUTCOME;
    }
    const statements = graph.nodes.filter((node) => node.id !== graph.conclusionId).map((node) => node.statement);
    // Bounds are checked before any bridge call; over-limit input is refused, never truncated.
    const allStatements = [conclusion.statement, ...statements];
    const statementOutcome = allStatements.map(projectionStatementDiagnostic).find(Boolean);
    if (statementOutcome) {
      report(statementOutcome);
      return OVERSIZED_OUTCOME;
    }
    if (!allStatements.every(isBoundedStatement)) {
      report("projection-graph-invalid");
      return OVERSIZED_OUTCOME;
    }

    let review: AfBridgeResult<never>;
    try {
      review = await runtime.beginReview();
    } catch (error) {
      report("projection-begin-other");
      throw error;
    }
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(review)) {
      report(beginFailureDiagnostic(review));
      return failureOutcome(review);
    }

    const run = async (operation: AfBridgeOperation): Promise<AfBridgeResult> => {
      try {
        return await runtime.run(operation, signal);
      } catch (error) {
        report(signal.aborted ? "projection-cancelled" : operationFailureDiagnostic(operation.operation, "other"));
        throw error;
      }
    };

    const initialized = await run({ operation: "init", conjecture: conclusion.statement, author: PROJECTION_AUTHOR });
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(initialized)) {
      report(operationFailureDiagnostic("init", initialized.reason));
      return failureOutcome(initialized);
    }
    if (!isInitFacts(initialized.facts)) {
      report("projection-init-facts-mismatch");
      return UNRESOLVED_OUTCOME;
    }

    const claimed = await run({ operation: "claim", nodeId: PROJECTION_ROOT_NODE_ID, role: PROJECTION_ROOT_ROLE });
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(claimed)) {
      report(operationFailureDiagnostic("claim", claimed.reason));
      return failureOutcome(claimed);
    }
    if (!isClaimFacts(claimed.facts)) {
      report("projection-claim-facts-mismatch");
      return UNRESOLVED_OUTCOME;
    }

    for (let index = 0; index < statements.length; index += AF_MAX_REFINE_STATEMENTS) {
      const chunk = statements.slice(index, index + AF_MAX_REFINE_STATEMENTS);
      const refined = await run({ operation: "refine", parentId: PROJECTION_ROOT_NODE_ID, statements: [...chunk] });
      if (signal.aborted) return CANCELLED_OUTCOME;
      if (!isReadyResult(refined)) {
        report(operationFailureDiagnostic("refine", refined.reason));
        return failureOutcome(refined);
      }
      if (!isRefineFacts(refined.facts, chunk.length)) {
        report("projection-refine-facts-mismatch");
        return UNRESOLVED_OUTCOME;
      }
    }

    const status = await run({ operation: "status" });
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(status)) {
      report(operationFailureDiagnostic("status", status.reason));
      return failureOutcome(status);
    }
    if (!isStatusFacts(status.facts, 1 + statements.length)) {
      report("projection-status-facts-mismatch");
      return UNRESOLVED_OUTCOME;
    }

    report("projection-completed");
    return STRUCTURALLY_CHECKED_OUTCOME;
  };
}

/**
 * Creates the production claim seam over the composed runtime bridge. The
 * capability is read from the bridge's explicit, side-effect-free report with
 * an exact-shape check; every other boundary keeps the unsupported seam, so a
 * dormant, incompatible, or unready runtime never projects. Construction and
 * capability reads never preflight, spawn, or allocate.
 */
export function createCurrentVibefeldClaimProjectionSeam(
  runtime: CurrentVibefeldRuntimeBoundary,
  options: Readonly<{ observer?: ClaimProjectionDiagnosticObserver }> = {},
): ClaimProjectionSeam {
  const capability = readClaimCapability(runtime);
  const seamOptions = {
    ...(options.observer ? { observer: options.observer } : {}),
    classifyInvalidGraph: invalidGraphDiagnostic,
  };
  if (!capability.supported) return createUnsupportedClaimProjectionSeam(seamOptions);
  return createClaimProjectionSeam({ capability, project: createBridgeProjection(runtime) }, seamOptions);
}
