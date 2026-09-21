import { type ClaimProjectionSeam, createUnsupportedClaimProjectionSeam } from "./claim-projection-seam";
import type { VibefeldRuntimeBridge } from "./vibefeld-runtime";

/**
 * The current runtime is a compatibility bridge only. Its operation boundary
 * must remain visible here so a future claim-capable bridge cannot be inferred
 * from compatibility, initialization, or status support.
 */
export type CurrentVibefeldRuntimeBoundary = Pick<VibefeldRuntimeBridge, "preflight" | "run" | "teardown">;

export const CURRENT_VIBEFELD_CLAIM_CAPABILITY = Object.freeze({ supported: false as const });

/**
 * Creates the current bridge's claim seam without touching the bridge. In
 * particular, capability discovery does not preflight, initialize, query
 * status, or allocate a proof workspace.
 */
export function createCurrentVibefeldClaimProjectionSeam(
  _runtime: CurrentVibefeldRuntimeBoundary,
): ClaimProjectionSeam {
  return createUnsupportedClaimProjectionSeam();
}
