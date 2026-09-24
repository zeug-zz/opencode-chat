/**
 * Host-private AF structure-recording adapter for the reasoning-assist preflight.
 *
 * This module owns exactly one fixed, contracted operation over an injected
 * claim-projection seam: record a validated host-private graph. It never passes
 * a raw prompt or model-controlled argv, never performs I/O of its own, and
 * bounds every failure - unsupported capability, non-structural status,
 * malformed shape, cancellation, or throw - to `"not-available"`. Success is
 * reported only as recorded structure: no raw projection status, failure
 * reason, or graph text ever leaves this module.
 */

import type { ClaimGraph } from "./claim-graph";
import type { ClaimProjectionSeam } from "./claim-projection-seam";

export type ReasoningAssistStructureRecorder = Readonly<{
  isSupported: () => boolean;
  record: (graph: ClaimGraph, signal?: AbortSignal) => Promise<"recorded" | "not-available">;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Only the exact clean recording shape counts as recorded structure. A single
 * `structurally_checked` key is the contracted clean result; an extra key, a
 * non-structural status, a failure status, or any non-record value is absent.
 */
function isCleanRecording(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.status === "structurally_checked";
}

export function createReasoningAssistStructureRecorder(seam: ClaimProjectionSeam): ReasoningAssistStructureRecorder {
  const isSupported = (): boolean => {
    try {
      return seam.getCapability().supported === true;
    } catch {
      return false;
    }
  };

  return {
    isSupported,
    async record(graph: ClaimGraph, signal?: AbortSignal): Promise<"recorded" | "not-available"> {
      if (signal?.aborted === true) return "not-available";
      // An unsupported or unreadable capability is never projected, even if the
      // caller raced a stale support probe.
      if (!isSupported()) return "not-available";
      try {
        const outcome: unknown = await seam.project(graph, signal);
        return isCleanRecording(outcome) ? "recorded" : "not-available";
      } catch {
        return "not-available";
      }
    },
  };
}
