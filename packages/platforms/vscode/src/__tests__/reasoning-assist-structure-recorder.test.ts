import { describe, expect, it, vi } from "vitest";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import {
  type ClaimGraph,
  type ClaimProjectionSeam,
  createClaimProjectionSeam,
  createUnsupportedClaimProjectionSeam,
  type NormalizedProjectionOutcome,
} from "../vibefeld/claim-projection-seam";
import { createReasoningAssistStructureRecorder } from "../vibefeld/reasoning-assist-structure-recorder";

const compiled = compileClaimGraph("CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.");

function validGraph(): ClaimGraph {
  if (!compiled.ok) throw new Error("test graph must be valid");
  return compiled.graph;
}

function recorderFor(outcome: NormalizedProjectionOutcome) {
  const projectSpy = vi.fn(async () => outcome);
  const seam = createClaimProjectionSeam({
    capability: { supported: true, operation: "claim_projection" },
    project: projectSpy,
  });
  return { recorder: createReasoningAssistStructureRecorder(seam), projectSpy };
}

const NON_CLEAN_STRUCTURAL_STATUSES = ["conditional", "unresolved", "refuted"] as const;

const FAILURE_OUTCOMES: readonly Readonly<{ label: string; outcome: NormalizedProjectionOutcome }>[] = [
  { label: "unavailable/unsupported", outcome: { status: "unavailable", reason: "unsupported" } },
  { label: "unavailable/malformed", outcome: { status: "unavailable", reason: "malformed" } },
  { label: "unavailable/oversized", outcome: { status: "unavailable", reason: "oversized" } },
  { label: "unavailable/timeout", outcome: { status: "unavailable", reason: "timeout" } },
  { label: "unavailable/cancelled", outcome: { status: "unavailable", reason: "cancelled" } },
  { label: "unavailable/signaled", outcome: { status: "unavailable", reason: "signaled" } },
  { label: "unavailable/policy", outcome: { status: "unavailable", reason: "policy" } },
  { label: "unavailable/cleanup", outcome: { status: "unavailable", reason: "cleanup" } },
  { label: "unavailable/audit", outcome: { status: "unavailable", reason: "audit" } },
  { label: "audit_failed/audit", outcome: { status: "audit_failed", reason: "audit" } },
  { label: "audit_failed/cleanup", outcome: { status: "audit_failed", reason: "cleanup" } },
  { label: "audit_failed/timeout", outcome: { status: "audit_failed", reason: "timeout" } },
];

const MALFORMED_RESULTS: readonly Readonly<{ label: string; value: unknown }>[] = [
  { label: "null", value: null },
  { label: "empty object", value: {} },
  { label: "non-string status", value: { status: 42 } },
  { label: "structural status with an extra key", value: { status: "structurally_checked", reason: "audit" } },
  { label: "array", value: ["structurally_checked"] },
  { label: "raw string", value: "structurally_checked" },
];

describe("reasoning-assist structure recorder", () => {
  it("reports unsupported capability without invoking the projection", async () => {
    const seam = createUnsupportedClaimProjectionSeam();
    const recorder = createReasoningAssistStructureRecorder(seam);

    expect(recorder.isSupported()).toBe(false);
    expect(await recorder.record(validGraph())).toBe("not-available");
  });

  it("does not project through an unsupported seam even when a delegate exists", async () => {
    const project = vi.fn(async (): Promise<NormalizedProjectionOutcome> => ({ status: "structurally_checked" }));
    const seam: ClaimProjectionSeam = { getCapability: () => ({ supported: false }), project };
    const recorder = createReasoningAssistStructureRecorder(seam);

    expect(recorder.isSupported()).toBe(false);
    expect(await recorder.record(validGraph())).toBe("not-available");
    expect(project).not.toHaveBeenCalled();
  });

  it("treats a throwing capability probe as unsupported and does not project", async () => {
    const project = vi.fn(async (): Promise<NormalizedProjectionOutcome> => ({ status: "structurally_checked" }));
    const seam: ClaimProjectionSeam = {
      getCapability: () => {
        throw new Error("capability probe failed");
      },
      project,
    };
    const recorder = createReasoningAssistStructureRecorder(seam);

    expect(recorder.isSupported()).toBe(false);
    expect(await recorder.record(validGraph())).toBe("not-available");
    expect(project).not.toHaveBeenCalled();
  });

  it("reports only an exact clean contracted recording as recorded structure", async () => {
    const { recorder, projectSpy } = recorderFor({ status: "structurally_checked" });

    expect(recorder.isSupported()).toBe(true);
    expect(await recorder.record(validGraph())).toBe("recorded");
    expect(projectSpy).toHaveBeenCalledTimes(1);
  });

  it.each(NON_CLEAN_STRUCTURAL_STATUSES)("omits the AF fact for the structural status %s", async (status) => {
    const { recorder, projectSpy } = recorderFor({ status });

    expect(await recorder.record(validGraph())).toBe("not-available");
    expect(projectSpy).toHaveBeenCalledTimes(1);
  });

  it.each(FAILURE_OUTCOMES)("omits the AF fact for $label", async ({ outcome }) => {
    const { recorder, projectSpy } = recorderFor(outcome);

    expect(await recorder.record(validGraph())).toBe("not-available");
    expect(projectSpy).toHaveBeenCalledTimes(1);
  });

  it("omits the AF fact when the contracted projection throws", async () => {
    const seam: ClaimProjectionSeam = {
      getCapability: () => ({ supported: true, operation: "claim_projection" }),
      project: async () => {
        throw new Error("projection exploded");
      },
    };
    const recorder = createReasoningAssistStructureRecorder(seam);

    expect(await recorder.record(validGraph())).toBe("not-available");
  });

  it("does not project when the signal is already aborted", async () => {
    const { recorder, projectSpy } = recorderFor({ status: "structurally_checked" });
    const controller = new AbortController();
    controller.abort();

    expect(await recorder.record(validGraph(), controller.signal)).toBe("not-available");
    expect(projectSpy).not.toHaveBeenCalled();
  });

  it.each(MALFORMED_RESULTS)("omits the AF fact for a malformed projection result ($label)", async ({ value }) => {
    const seam: ClaimProjectionSeam = {
      getCapability: () => ({ supported: true, operation: "claim_projection" }),
      project: () => value as unknown as NormalizedProjectionOutcome,
    };
    const recorder = createReasoningAssistStructureRecorder(seam);

    expect(await recorder.record(validGraph())).toBe("not-available");
  });

  it("never exposes a raw projection status or failure reason in its result", async () => {
    const failure = recorderFor({ status: "audit_failed", reason: "cleanup" });
    const failureResult = await failure.recorder.record(validGraph());
    expect(failureResult).toBe("not-available");
    expect(JSON.stringify(failureResult)).not.toContain("audit_failed");
    expect(JSON.stringify(failureResult)).not.toContain("cleanup");
    expect(JSON.stringify(failureResult)).not.toContain("structurally_checked");

    const clean = recorderFor({ status: "structurally_checked" });
    const cleanResult = await clean.recorder.record(validGraph());
    expect(cleanResult).toBe("recorded");
    expect(JSON.stringify(cleanResult)).not.toContain("structurally_checked");

    const refuted = recorderFor({ status: "refuted" });
    const refutedResult = await refuted.recorder.record(validGraph());
    expect(refutedResult).toBe("not-available");
    expect(JSON.stringify(refutedResult)).not.toContain("refuted");
  });
});
