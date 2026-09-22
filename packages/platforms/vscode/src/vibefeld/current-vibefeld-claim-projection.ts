import { AF_MAX_REFINE_STATEMENTS } from "./af-command-schema";
import { AF_FIXTURE_LIMITS } from "./af-runtime-contract";
import type { ClaimGraph } from "./claim-graph";
import {
  type ClaimProjectionCapability,
  type ClaimProjectionDelegate,
  type ClaimProjectionSeam,
  createClaimProjectionSeam,
  createUnsupportedClaimProjectionSeam,
  type NormalizedProjectionOutcome,
} from "./claim-projection-seam";
import type { AfBridgeResult, VibefeldRuntimeBridge } from "./vibefeld-runtime";

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
  return async (graph: ClaimGraph, signal: AbortSignal): Promise<NormalizedProjectionOutcome> => {
    if (signal.aborted) return CANCELLED_OUTCOME;

    const conclusion = graph.nodes.find((node) => node.id === graph.conclusionId);
    // Defensive only: the seam validates the graph before the delegate runs.
    if (!conclusion) return MALFORMED_OUTCOME;
    const statements = graph.nodes.filter((node) => node.id !== graph.conclusionId).map((node) => node.statement);
    // Bounds are checked before any bridge call; over-limit input is refused, never truncated.
    if (!isBoundedStatement(conclusion.statement) || !statements.every(isBoundedStatement)) return OVERSIZED_OUTCOME;

    const review = await runtime.beginReview();
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(review)) return failureOutcome(review);

    const initialized = await runtime.run(
      { operation: "init", conjecture: conclusion.statement, author: PROJECTION_AUTHOR },
      signal,
    );
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(initialized)) return failureOutcome(initialized);
    if (!isInitFacts(initialized.facts)) return UNRESOLVED_OUTCOME;

    const claimed = await runtime.run(
      { operation: "claim", nodeId: PROJECTION_ROOT_NODE_ID, role: PROJECTION_ROOT_ROLE },
      signal,
    );
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(claimed)) return failureOutcome(claimed);
    if (!isClaimFacts(claimed.facts)) return UNRESOLVED_OUTCOME;

    for (let index = 0; index < statements.length; index += AF_MAX_REFINE_STATEMENTS) {
      const chunk = statements.slice(index, index + AF_MAX_REFINE_STATEMENTS);
      const refined = await runtime.run(
        { operation: "refine", parentId: PROJECTION_ROOT_NODE_ID, statements: [...chunk] },
        signal,
      );
      if (signal.aborted) return CANCELLED_OUTCOME;
      if (!isReadyResult(refined)) return failureOutcome(refined);
      if (!isRefineFacts(refined.facts, chunk.length)) return UNRESOLVED_OUTCOME;
    }

    const status = await runtime.run({ operation: "status" }, signal);
    if (signal.aborted) return CANCELLED_OUTCOME;
    if (!isReadyResult(status)) return failureOutcome(status);
    if (!isStatusFacts(status.facts, 1 + statements.length)) return UNRESOLVED_OUTCOME;

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
export function createCurrentVibefeldClaimProjectionSeam(runtime: CurrentVibefeldRuntimeBoundary): ClaimProjectionSeam {
  const capability = readClaimCapability(runtime);
  if (!capability.supported) return createUnsupportedClaimProjectionSeam();
  return createClaimProjectionSeam({ capability, project: createBridgeProjection(runtime) });
}
