import type { ReasoningAssistStage } from "@opencode-chat/core";
import { describe, expect, it, vi } from "vitest";
import type { ClaimGraph } from "../vibefeld/claim-graph";
import { createClaimProjectionSeam, type NormalizedProjectionOutcome } from "../vibefeld/claim-projection-seam";
import {
  REASONING_ASSIST_PREFLIGHT_DEADLINE_MS,
  type ReasoningAssistPreflightOutcome,
  type ReasoningAssistPreflightRun,
  runReasoningAssistPreflight,
} from "../vibefeld/reasoning-assist-orchestrator";
import { createReasoningAssistStructureRecorder } from "../vibefeld/reasoning-assist-structure-recorder";
import type {
  ReasoningAssistContextMetadata,
  ReasoningAssistStageTextResult,
} from "../vibefeld/restricted-review-adapter";

const ORDINARY_TEXT = '{"kind":"ordinary"}';
const ARGUMENT_TEXT = JSON.stringify({
  kind: "argument",
  conclusionId: "claim-conclusion",
  claims: [
    {
      id: "claim-premise",
      class: "empirical",
      statement: "A bounded observation was recorded for this case.",
      dependsOn: [],
    },
    {
      id: "claim-conclusion",
      class: "deductive",
      statement: "The conclusion follows from the recorded premise.",
      dependsOn: ["claim-premise"],
    },
  ],
  assumptions: [{ id: "assumption-1", claimId: "claim-conclusion", statement: "The premise applies to this case." }],
  evidenceNeeds: [{ claimId: "claim-premise", sourceKind: "observation", status: "source_recorded" }],
  uncertainty: ["The observation is bounded to one case."],
});
const CRITIC_TEXT = JSON.stringify({
  objections: [
    {
      target: { kind: "assumption", id: "assumption-1" },
      severity: "material",
      reason: "The premise applies only to a narrower case.",
    },
  ],
});
const CRITIC_OBJECTIONS = [
  {
    target: { kind: "assumption", id: "assumption-1" },
    severity: "material",
    objection: "The premise applies only to a narrower case.",
  },
] as const;
const CRITIC_NO_OBJECTIONS_TEXT = JSON.stringify({ objections: [] });
const CRITIC_UNKNOWN_TARGET_TEXT = JSON.stringify({
  objections: [{ target: { kind: "claim", id: "claim-unknown" }, severity: "material", reason: "critic-raw-secret" }],
});
const CRITIC_EXTRA_ENVELOPE_TEXT = JSON.stringify({
  objections: [
    {
      target: { kind: "claim", id: "claim-conclusion" },
      severity: "material",
      reason: "critic-raw-secret",
    },
  ],
  envelope: "critic-envelope-secret",
});

function makeContext(): ReasoningAssistContextMetadata {
  return {
    handle: "handle-secret",
    provenance: { identity: "identity-secret", role: "architect", contextNumber: 1 },
  };
}

function makeCriticContext(): ReasoningAssistContextMetadata {
  return {
    handle: "handle-secret-critic",
    provenance: { identity: "identity-secret-critic", role: "critic", contextNumber: 2 },
  };
}

type AdapterOverrides = Readonly<{
  create?: (role: ReasoningAssistStage) => Promise<ReasoningAssistContextMetadata | undefined>;
  run?: (
    context: ReasoningAssistContextMetadata,
    packetText: string,
    role: ReasoningAssistStage,
    signal?: AbortSignal,
  ) => Promise<ReasoningAssistStageTextResult | undefined>;
  supportedStages?: readonly ReasoningAssistStage[];
}>;

function makeAdapter(overrides: AdapterOverrides = {}) {
  const context = makeContext();
  const criticContext = makeCriticContext();
  const cancelReasoningAssistContext = vi.fn(async (): Promise<void> => undefined);
  const createReasoningAssistContext = vi.fn(
    overrides.create ?? (async (role: ReasoningAssistStage) => (role === "critic" ? criticContext : context)),
  );
  const runReasoningAssistStage = vi.fn(
    overrides.run ??
      (async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: ORDINARY_TEXT })),
  );
  const supportedStages: readonly ReasoningAssistStage[] = overrides.supportedStages ?? ["architect"];
  return {
    context,
    criticContext,
    supportedStages,
    cancelReasoningAssistContext,
    createReasoningAssistContext,
    runReasoningAssistStage,
  };
}

type RecorderOverrides = Readonly<{
  isSupported?: () => boolean;
  record?: (graph: ClaimGraph, signal?: AbortSignal) => Promise<"recorded" | "not-available">;
}>;

function makeRecorder(overrides: RecorderOverrides = {}) {
  const isSupported = vi.fn(overrides.isSupported ?? (() => true));
  const record = vi.fn(overrides.record ?? (async (): Promise<"recorded" | "not-available"> => "recorded"));
  return { isSupported, record };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const stagesOf = (progress: ReadonlyArray<{ stage: ReasoningAssistStage }>): ReasoningAssistStage[] =>
  progress.map(({ stage }) => stage);

async function runPreflight(
  adapter: ReturnType<typeof makeAdapter>,
  overrides: Partial<ReasoningAssistPreflightRun> = {},
): Promise<{
  outcome: ReasoningAssistPreflightOutcome;
  progress: Array<{ stage: ReasoningAssistStage; promptToken: string }>;
}> {
  const progress: Array<{ stage: ReasoningAssistStage; promptToken: string }> = [];
  const outcome = await runReasoningAssistPreflight({
    sessionId: "sess-1",
    userText: "Should this bounded premise support the conclusion?",
    adapter,
    isCurrent: () => true,
    publishProgress: (stage, promptToken) => progress.push({ stage, promptToken }),
    ...overrides,
  });
  return { outcome, progress };
}

const NON_RECORDED_PROJECTIONS: readonly Readonly<{ label: string; outcome: NormalizedProjectionOutcome }>[] = [
  { label: "conditional", outcome: { status: "conditional" } },
  { label: "unresolved", outcome: { status: "unresolved" } },
  { label: "refuted", outcome: { status: "refuted" } },
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

function makeRecorderOverSeam(outcome: NormalizedProjectionOutcome) {
  return createReasoningAssistStructureRecorder(
    createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: () => outcome,
    }),
  );
}

function makeArgumentAdapter(overrides: AdapterOverrides = {}) {
  return makeAdapter({
    supportedStages: ["architect", "critic"],
    run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> =>
      role === "critic"
        ? { ok: true, role: "critic", text: CRITIC_TEXT }
        : { ok: true, role: "architect", text: ARGUMENT_TEXT },
    ...overrides,
  });
}

describe("reasoning-assist preflight orchestrator", () => {
  it("treats an ordinary architect result as dispatch-unchanged after one canceled preflight", async () => {
    const adapter = makeAdapter();
    const { outcome, progress } = await runPreflight(adapter);

    expect(outcome).toMatchObject({ kind: "dispatch-unchanged", reason: "ordinary" });
    expect(outcome).not.toHaveProperty("stageTextLength");
    expect(outcome).not.toHaveProperty("parseReason");
    expect(outcome).not.toHaveProperty("stageElapsedMs");
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.createReasoningAssistContext).toHaveBeenCalledWith("architect");
    expect(adapter.runReasoningAssistStage).toHaveBeenCalledWith(
      adapter.context,
      expect.stringContaining("Should this bounded premise support the conclusion?"),
      "architect",
      undefined,
    );
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.context);
  });

  it("publishes mapping after assessing and returns graph plus facts for a valid argument", async () => {
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: ARGUMENT_TEXT }),
    });
    const { outcome, progress } = await runPreflight(adapter);

    expect(progress.map(({ stage }) => stage)).toEqual(["assessing", "mapping"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.promptToken.length).toBeGreaterThan(0);
    expect(progress.every((entry) => entry.promptToken === outcome.promptToken)).toBe(true);
    expect(outcome.graph.conclusionId).toBe("claim-conclusion");
    expect(outcome.facts.conclusion.class).toBe("deductive");
    expect(outcome.facts.assumptions).toEqual(["The premise applies to this case."]);
    expect(outcome.afState).toBe("not_available");
    expect(outcome.objections).toEqual([]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.context);
  });

  it("never creates a context for a packet that is not eligible", async () => {
    const adapter = makeAdapter();
    const { outcome, progress } = await runPreflight(adapter, { userText: "" });

    expect(outcome).toMatchObject({ kind: "dispatch-unchanged", reason: "packet-empty-text" });
    expect(outcome).not.toHaveProperty("stageElapsedMs");
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.createReasoningAssistContext).not.toHaveBeenCalled();
    expect(adapter.runReasoningAssistStage).not.toHaveBeenCalled();
    expect(adapter.cancelReasoningAssistContext).not.toHaveBeenCalled();
  });

  it("treats a missing context as dispatch-unchanged without canceling or mapping", async () => {
    const adapter = makeAdapter({ create: async () => undefined });
    const { outcome, progress } = await runPreflight(adapter);

    expect(outcome).toMatchObject({ kind: "dispatch-unchanged", reason: "stage-unavailable" });
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.runReasoningAssistStage).not.toHaveBeenCalled();
    expect(adapter.cancelReasoningAssistContext).not.toHaveBeenCalled();
  });

  it.each<{ label: string; result: ReasoningAssistStageTextResult | undefined; reason: string }>([
    { label: "undefined", result: undefined, reason: "stage-failed" },
    {
      label: "cancelled",
      result: { ok: false, role: "architect", reason: "cancelled" },
      reason: "stage-failed-cancelled",
    },
    { label: "timeout", result: { ok: false, role: "architect", reason: "timeout" }, reason: "stage-failed-timeout" },
    {
      label: "malformed",
      result: { ok: false, role: "architect", reason: "malformed" },
      reason: "stage-failed-malformed",
    },
    {
      label: "oversized",
      result: { ok: false, role: "architect", reason: "oversized" },
      reason: "stage-failed-oversized",
    },
    {
      label: "model-failure",
      result: { ok: false, role: "architect", reason: "model-failure" },
      reason: "stage-failed-model",
    },
  ])("treats an $label stage result as dispatch-unchanged and cancels the context", async ({ result, reason }) => {
    const adapter = makeAdapter({ run: async () => result });
    const { outcome, progress } = await runPreflight(adapter);

    expect(outcome).toMatchObject({ kind: "dispatch-unchanged", reason });
    // Every `stage-failed*` outcome additionally carries the numeric elapsed
    // stage time.
    expect(outcome).toMatchObject({ kind: "dispatch-unchanged", stageElapsedMs: expect.any(Number) });
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledTimes(1);
  });

  it("exposes the exact elapsed stage time on a stage-failed-timeout outcome", async () => {
    let clock = 0;
    const adapter = makeAdapter({
      run: async () => {
        clock = 12_345;
        return { ok: false, role: "architect" as const, reason: "timeout" };
      },
    });
    const { outcome } = await runPreflight(adapter, { now: () => clock });

    expect(outcome).toMatchObject({
      kind: "dispatch-unchanged",
      reason: "stage-failed-timeout",
      stageElapsedMs: 12_345,
    });
  });

  it("exposes the parse sub-reason and numeric stage text length for an invalid architect result", async () => {
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: "not json" }),
    });
    const { outcome, progress } = await runPreflight(adapter);

    expect(outcome).toMatchObject({
      kind: "dispatch-unchanged",
      reason: "invalid-result",
      stageTextLength: "not json".length,
      parseReason: "malformed",
    });
    expect(outcome).not.toHaveProperty("stageElapsedMs");
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledTimes(1);
  });

  it("threads the architect parser's bounded sub-reason into an invalid-result outcome", async () => {
    const invalidClaimClassText = JSON.stringify({
      kind: "argument",
      conclusionId: "claim-c1",
      claims: [{ id: "claim-c1", class: "mystery", statement: "A bounded statement.", dependsOn: [] }],
      assumptions: [],
      evidenceNeeds: [],
      uncertainty: [],
    });
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({
        ok: true,
        role: "architect",
        text: invalidClaimClassText,
      }),
    });
    const { outcome } = await runPreflight(adapter);

    expect(outcome).toMatchObject({
      kind: "dispatch-unchanged",
      reason: "invalid-result",
      parseReason: "invalid-claim-class",
      stageTextLength: invalidClaimClassText.length,
    });
  });

  it("does not throw when the adapter rejects and still cancels any context", async () => {
    const adapter = makeAdapter({
      run: async () => {
        throw new Error("adapter exploded");
      },
    });
    const { outcome } = await runPreflight(adapter);

    expect(outcome).toMatchObject({ kind: "dispatch-unchanged", reason: "stage-failed" });
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledTimes(1);
  });

  it("returns stale without publishing when the signal is already aborted", async () => {
    const adapter = makeAdapter();
    const controller = new AbortController();
    controller.abort();
    const { outcome, progress } = await runPreflight(adapter, { signal: controller.signal });

    expect(outcome.kind).toBe("stale");
    expect(progress).toEqual([]);
    expect(adapter.createReasoningAssistContext).not.toHaveBeenCalled();
  });

  it("returns stale and cancels when the signal aborts mid-flight", async () => {
    const controller = new AbortController();
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => {
        controller.abort();
        return { ok: true, role: "architect", text: ARGUMENT_TEXT };
      },
    });
    const { outcome, progress } = await runPreflight(adapter, { signal: controller.signal });

    expect(outcome.kind).toBe("stale");
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledTimes(1);
  });

  it("returns stale without publishing when the prompt is no longer current at the start", async () => {
    const adapter = makeAdapter();
    const { outcome, progress } = await runPreflight(adapter, { isCurrent: () => false });

    expect(outcome.kind).toBe("stale");
    expect(progress).toEqual([]);
    expect(adapter.createReasoningAssistContext).not.toHaveBeenCalled();
  });

  it("returns stale and cancels when the prompt stops being current after the context is created", async () => {
    let current = true;
    const context = makeContext();
    const adapter = makeAdapter({
      create: async () => {
        current = false;
        return context;
      },
    });
    const { outcome, progress } = await runPreflight(adapter, { isCurrent: () => current });

    expect(outcome.kind).toBe("stale");
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(context);
  });

  it("returns dispatch-unchanged without publishing when the deadline is exceeded before the first step", async () => {
    const adapter = makeAdapter();
    let calls = 0;
    const now = () => (calls++ === 0 ? 0 : REASONING_ASSIST_PREFLIGHT_DEADLINE_MS);
    const { outcome, progress } = await runPreflight(adapter, { now });

    expect(outcome).toMatchObject({
      kind: "dispatch-unchanged",
      reason: "deadline",
      stageElapsedMs: REASONING_ASSIST_PREFLIGHT_DEADLINE_MS,
    });
    expect(progress).toEqual([]);
    expect(adapter.createReasoningAssistContext).not.toHaveBeenCalled();
    expect(adapter.cancelReasoningAssistContext).not.toHaveBeenCalled();
  });

  it("returns dispatch-unchanged and cancels when the deadline elapses during the flight", async () => {
    let clock = 0;
    const context = makeContext();
    const adapter = makeAdapter({
      create: async () => {
        clock = REASONING_ASSIST_PREFLIGHT_DEADLINE_MS;
        return context;
      },
    });
    const { outcome, progress } = await runPreflight(adapter, { now: () => clock });

    expect(outcome).toMatchObject({
      kind: "dispatch-unchanged",
      reason: "deadline",
      stageElapsedMs: REASONING_ASSIST_PREFLIGHT_DEADLINE_MS,
    });
    expect(progress.map(({ stage }) => stage)).toEqual(["assessing"]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(context);
  });

  it("prefers staleness over an elapsed deadline when both hold", async () => {
    const adapter = makeAdapter();
    const { outcome, progress } = await runPreflight(adapter, {
      now: () => REASONING_ASSIST_PREFLIGHT_DEADLINE_MS,
      isCurrent: () => false,
    });

    expect(outcome.kind).toBe("stale");
    expect(progress).toEqual([]);
    expect(adapter.createReasoningAssistContext).not.toHaveBeenCalled();
  });

  it.each<{ label: string; input: Partial<ReasoningAssistPreflightRun> }>([
    { label: "empty sessionId", input: { sessionId: "" } },
    { label: "non-string userText", input: { userText: 42 as unknown as string } },
  ])("rejects invalid input ($label) without touching the adapter", async ({ input }) => {
    const adapter = makeAdapter();
    const { outcome, progress } = await runPreflight(adapter, input);

    expect(outcome).toEqual({ kind: "not-eligible" });
    expect(progress).toEqual([]);
    expect(adapter.createReasoningAssistContext).not.toHaveBeenCalled();
    expect(adapter.runReasoningAssistStage).not.toHaveBeenCalled();
    expect(adapter.cancelReasoningAssistContext).not.toHaveBeenCalled();
  });

  it("never leaks the raw stage text, adapter handle, or failure detail across outcomes", async () => {
    const failureAdapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({
        ok: false,
        role: "architect",
        reason: "model-failure",
      }),
    });
    const failure = await runPreflight(failureAdapter);
    const failureText = JSON.stringify(failure.outcome);
    expect(failure.outcome).toMatchObject({ kind: "dispatch-unchanged", reason: "stage-failed-model" });
    expect(failureText).not.toContain("handle-secret");
    expect(failureText).not.toContain("identity-secret");
    expect(failureText).not.toContain("model-failure");
    expect(JSON.stringify(failure.progress)).not.toContain("handle-secret");

    const ordinaryAdapter = makeAdapter();
    const ordinary = await runPreflight(ordinaryAdapter);
    const ordinaryText = JSON.stringify(ordinary.outcome);
    expect(ordinaryText).not.toContain(ORDINARY_TEXT);
    expect(ordinaryText).not.toContain("handle-secret");
    expect(ordinaryText).not.toContain("identity-secret");
  });

  it("records AF structure and normalizes critic objections concurrently after a valid graph", async () => {
    const afStarted = createDeferred<void>();
    const criticStarted = createDeferred<void>();
    const afGate = createDeferred<"recorded" | "not-available">();
    const criticGate = createDeferred<void>();
    const recorder = makeRecorder({
      record: async () => {
        afStarted.resolve(undefined);
        return afGate.promise;
      },
    });
    const adapter = makeAdapter({
      supportedStages: ["architect", "critic"],
      create: async (role) => {
        if (role === "critic") {
          criticStarted.resolve(undefined);
          return makeCriticContext();
        }
        return makeContext();
      },
      run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> => {
        if (role === "critic") {
          await criticGate.promise;
          return { ok: true, role: "critic", text: CRITIC_TEXT };
        }
        return { ok: true, role: "architect", text: ARGUMENT_TEXT };
      },
    });

    const progress: Array<{ stage: ReasoningAssistStage; promptToken: string }> = [];
    const preflight = runReasoningAssistPreflight({
      sessionId: "sess-1",
      userText: "Should this bounded premise support the conclusion?",
      adapter,
      structureRecorder: recorder,
      isCurrent: () => true,
      publishProgress: (stage, promptToken) => progress.push({ stage, promptToken }),
    });

    // Both optional chains are started and still pending before either settles.
    await Promise.all([afStarted.promise, criticStarted.promise]);
    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "recording", "critiquing"]);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(adapter.runReasoningAssistStage).toHaveBeenCalledWith(
      adapter.criticContext,
      expect.any(String),
      "critic",
      expect.any(AbortSignal),
    );

    afGate.resolve("recorded");
    criticGate.resolve(undefined);
    const outcome = await preflight;

    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("recorded");
    expect(outcome.objections).toEqual(CRITIC_OBJECTIONS);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.criticContext);
  });

  it("returns the argument outcome without optional labels when no enrichment stage is enabled", async () => {
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: ARGUMENT_TEXT }),
    });
    const { outcome, progress } = await runPreflight(adapter);

    expect(stagesOf(progress)).toEqual(["assessing", "mapping"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("not_available");
    expect(outcome.objections).toEqual([]);
  });

  it("publishes recording but not critiquing when only AF recording is supported", async () => {
    const recorder = makeRecorder();
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: ARGUMENT_TEXT }),
    });
    const { outcome, progress } = await runPreflight(adapter, { structureRecorder: recorder });

    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "recording"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("recorded");
    expect(outcome.objections).toEqual([]);
  });

  it("publishes critiquing but not recording when only the critic stage is supported", async () => {
    const recorder = makeRecorder({ isSupported: () => false });
    const adapter = makeArgumentAdapter();
    const { outcome, progress } = await runPreflight(adapter, { structureRecorder: recorder });

    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "critiquing"]);
    expect(recorder.record).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("not_available");
    expect(outcome.objections).toEqual(CRITIC_OBJECTIONS);
  });

  it("treats a throwing structure-recorder capability probe as unsupported", async () => {
    const recorder = makeRecorder({
      isSupported: () => {
        throw new Error("capability probe failed");
      },
    });
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: ARGUMENT_TEXT }),
    });
    const { outcome, progress } = await runPreflight(adapter, { structureRecorder: recorder });

    expect(stagesOf(progress)).toEqual(["assessing", "mapping"]);
    expect(recorder.record).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("not_available");
  });

  it("represents a clean contracted recording only as recorded structure", async () => {
    const recorder = makeRecorderOverSeam({ status: "structurally_checked" });
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: ARGUMENT_TEXT }),
    });
    const { outcome } = await runPreflight(adapter, { structureRecorder: recorder });

    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("recorded");
    expect(JSON.stringify(outcome)).not.toContain("structurally_checked");
  });

  it.each(NON_RECORDED_PROJECTIONS)(
    "omits only the AF fact when the contracted recording is $label",
    async ({ outcome: projectionOutcome }) => {
      const recorder = makeRecorderOverSeam(projectionOutcome);
      const adapter = makeArgumentAdapter();
      const { outcome, progress } = await runPreflight(adapter, { structureRecorder: recorder });

      expect(stagesOf(progress)).toEqual(["assessing", "mapping", "recording", "critiquing"]);
      expect(outcome.kind).toBe("argument");
      if (outcome.kind !== "argument") return;
      expect(outcome.afState).toBe("not_available");
      expect(outcome.objections).toEqual(CRITIC_OBJECTIONS);
    },
  );

  it("omits the AF fact when the structure recorder rejects", async () => {
    const recorder = makeRecorder({
      record: async () => {
        throw new Error("recorder failed");
      },
    });
    const adapter = makeAdapter({
      run: async (): Promise<ReasoningAssistStageTextResult> => ({ ok: true, role: "architect", text: ARGUMENT_TEXT }),
    });
    const { outcome, progress } = await runPreflight(adapter, { structureRecorder: recorder });

    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "recording"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("not_available");
  });

  it.each<{ label: string; text: string }>([
    { label: "no objections", text: CRITIC_NO_OBJECTIONS_TEXT },
    { label: "an unknown target", text: CRITIC_UNKNOWN_TARGET_TEXT },
    { label: "a malformed payload", text: "not json" },
  ])("keeps the validated argument when the critic result is $label", async ({ text }) => {
    const adapter = makeAdapter({
      supportedStages: ["architect", "critic"],
      run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> =>
        role === "critic" ? { ok: true, role: "critic", text } : { ok: true, role: "architect", text: ARGUMENT_TEXT },
    });
    const { outcome, progress } = await runPreflight(adapter);

    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "critiquing"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("not_available");
    expect(outcome.objections).toEqual([]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.criticContext);
  });

  it("keeps the validated argument and disposes the critic context when the stage fails", async () => {
    const adapter = makeAdapter({
      supportedStages: ["architect", "critic"],
      run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> =>
        role === "critic"
          ? { ok: false, role: "critic", reason: "timeout" }
          : { ok: true, role: "architect", text: ARGUMENT_TEXT },
    });
    const { outcome, progress } = await runPreflight(adapter);

    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "critiquing"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.objections).toEqual([]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.criticContext);
  });

  it("keeps the validated argument and disposes the critic context when the stage throws", async () => {
    const adapter = makeAdapter({
      supportedStages: ["architect", "critic"],
      run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> => {
        if (role === "critic") throw new Error("critic exploded");
        return { ok: true, role: "architect", text: ARGUMENT_TEXT };
      },
    });
    const { outcome, progress } = await runPreflight(adapter);

    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "critiquing"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.objections).toEqual([]);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.criticContext);
  });

  it("keeps the validated argument when the critic context is unavailable", async () => {
    const adapter = makeAdapter({
      supportedStages: ["architect", "critic"],
      create: async (role) => (role === "critic" ? undefined : makeContext()),
      run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> =>
        role === "critic"
          ? { ok: true, role: "critic", text: CRITIC_TEXT }
          : { ok: true, role: "architect", text: ARGUMENT_TEXT },
    });
    const { outcome, progress } = await runPreflight(adapter);

    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "critiquing"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.objections).toEqual([]);
    // Only the architect context exists, so only it is disposed.
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledTimes(1);
    expect(adapter.cancelReasoningAssistContext).not.toHaveBeenCalledWith(adapter.criticContext);
  });

  it("skips optional enrichment without labels when no preflight budget remains", async () => {
    const recorder = makeRecorder();
    const adapter = makeArgumentAdapter();
    let clock = 0;
    adapter.cancelReasoningAssistContext.mockImplementation(async () => {
      // The architect context disposal happens after mapping and before the
      // enrichment budget check, so the deadline elapses exactly there.
      clock = REASONING_ASSIST_PREFLIGHT_DEADLINE_MS;
    });

    const { outcome, progress } = await runPreflight(adapter, { now: () => clock, structureRecorder: recorder });

    expect(stagesOf(progress)).toEqual(["assessing", "mapping"]);
    expect(outcome.kind).toBe("argument");
    if (outcome.kind !== "argument") return;
    expect(outcome.afState).toBe("not_available");
    expect(outcome.objections).toEqual([]);
    expect(recorder.record).not.toHaveBeenCalled();
    expect(adapter.createReasoningAssistContext).toHaveBeenCalledTimes(1);
  });

  it("cancels enrichment at the preflight deadline and still returns the validated argument", async () => {
    vi.useFakeTimers();
    try {
      const afStarted = createDeferred<void>();
      const criticStarted = createDeferred<void>();
      let afSignal: AbortSignal | undefined;
      let criticSignal: AbortSignal | undefined;
      const recorder = makeRecorder({
        record: async (_graph, signal) => {
          afSignal = signal;
          afStarted.resolve(undefined);
          return new Promise<"recorded" | "not-available">((resolve) => {
            signal?.addEventListener("abort", () => resolve("not-available"), { once: true });
          });
        },
      });
      const adapter = makeAdapter({
        supportedStages: ["architect", "critic"],
        create: async (role) => {
          if (role === "critic") {
            criticStarted.resolve(undefined);
            return makeCriticContext();
          }
          return makeContext();
        },
        run: async (_context, _packet, role, signal): Promise<ReasoningAssistStageTextResult | undefined> => {
          if (role !== "critic") return { ok: true, role: "architect", text: ARGUMENT_TEXT };
          criticSignal = signal;
          return new Promise<ReasoningAssistStageTextResult | undefined>((resolve) => {
            signal?.addEventListener("abort", () => resolve({ ok: false, role: "critic", reason: "cancelled" }), {
              once: true,
            });
          });
        },
      });

      const progress: Array<{ stage: ReasoningAssistStage; promptToken: string }> = [];
      const preflight = runReasoningAssistPreflight({
        sessionId: "sess-1",
        userText: "Should this bounded premise support the conclusion?",
        adapter,
        structureRecorder: recorder,
        isCurrent: () => true,
        publishProgress: (stage, promptToken) => progress.push({ stage, promptToken }),
      });

      await Promise.all([afStarted.promise, criticStarted.promise]);
      await vi.advanceTimersByTimeAsync(REASONING_ASSIST_PREFLIGHT_DEADLINE_MS);
      const outcome = await preflight;

      expect(outcome.kind).toBe("argument");
      if (outcome.kind !== "argument") return;
      expect(outcome.afState).toBe("not_available");
      expect(outcome.objections).toEqual([]);
      expect(stagesOf(progress)).toEqual(["assessing", "mapping", "recording", "critiquing"]);
      expect(afSignal?.aborted).toBe(true);
      expect(criticSignal?.aborted).toBe(true);
      expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.criticContext);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the enrichment deadline timer once optional work settles", async () => {
    vi.useFakeTimers();
    try {
      const afStarted = createDeferred<void>();
      const criticStarted = createDeferred<void>();
      const afGate = createDeferred<"recorded" | "not-available">();
      const criticGate = createDeferred<void>();
      const recorder = makeRecorder({
        record: async () => {
          afStarted.resolve(undefined);
          return afGate.promise;
        },
      });
      const adapter = makeAdapter({
        supportedStages: ["architect", "critic"],
        create: async (role) => {
          if (role === "critic") {
            criticStarted.resolve(undefined);
            return makeCriticContext();
          }
          return makeContext();
        },
        run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> => {
          if (role === "critic") {
            await criticGate.promise;
            return { ok: true, role: "critic", text: CRITIC_TEXT };
          }
          return { ok: true, role: "architect", text: ARGUMENT_TEXT };
        },
      });

      const preflight = runReasoningAssistPreflight({
        sessionId: "sess-1",
        userText: "Should this bounded premise support the conclusion?",
        adapter,
        structureRecorder: recorder,
        isCurrent: () => true,
        publishProgress: () => undefined,
      });

      await Promise.all([afStarted.promise, criticStarted.promise]);
      expect(vi.getTimerCount()).toBe(1);

      afGate.resolve("recorded");
      criticGate.resolve(undefined);
      const outcome = await preflight;

      expect(outcome.kind).toBe("argument");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns stale, cancels both optional chains, and publishes no further labels when invalidated mid-enrichment", async () => {
    const controller = new AbortController();
    const afStarted = createDeferred<void>();
    const criticStarted = createDeferred<void>();
    let afSignal: AbortSignal | undefined;
    let criticSignal: AbortSignal | undefined;
    const recorder = makeRecorder({
      record: async (_graph, signal) => {
        afSignal = signal;
        afStarted.resolve(undefined);
        return new Promise<"recorded" | "not-available">((resolve) => {
          signal?.addEventListener("abort", () => resolve("not-available"), { once: true });
        });
      },
    });
    const adapter = makeAdapter({
      supportedStages: ["architect", "critic"],
      create: async (role) => {
        if (role === "critic") {
          criticStarted.resolve(undefined);
          return makeCriticContext();
        }
        return makeContext();
      },
      run: async (_context, _packet, role, signal): Promise<ReasoningAssistStageTextResult | undefined> => {
        if (role !== "critic") return { ok: true, role: "architect", text: ARGUMENT_TEXT };
        criticSignal = signal;
        return new Promise<ReasoningAssistStageTextResult | undefined>((resolve) => {
          signal?.addEventListener("abort", () => resolve({ ok: false, role: "critic", reason: "cancelled" }), {
            once: true,
          });
        });
      },
    });

    const progress: Array<{ stage: ReasoningAssistStage; promptToken: string }> = [];
    const preflight = runReasoningAssistPreflight({
      sessionId: "sess-1",
      userText: "Should this bounded premise support the conclusion?",
      adapter,
      structureRecorder: recorder,
      signal: controller.signal,
      isCurrent: () => true,
      publishProgress: (stage, promptToken) => progress.push({ stage, promptToken }),
    });

    await Promise.all([afStarted.promise, criticStarted.promise]);
    controller.abort();
    const outcome = await preflight;

    expect(outcome.kind).toBe("stale");
    expect(stagesOf(progress)).toEqual(["assessing", "mapping", "recording", "critiquing"]);
    expect(afSignal?.aborted).toBe(true);
    expect(criticSignal?.aborted).toBe(true);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledWith(adapter.criticContext);
    expect(adapter.cancelReasoningAssistContext).toHaveBeenCalledTimes(2);
  });

  it("never leaks raw projection status, adapter handles, or raw critic text across argument outcomes", async () => {
    const failingRecorder = makeRecorderOverSeam({ status: "audit_failed", reason: "cleanup" });
    const failingAdapter = makeAdapter({
      supportedStages: ["architect", "critic"],
      run: async (_context, _packet, role): Promise<ReasoningAssistStageTextResult | undefined> =>
        role === "critic"
          ? { ok: true, role: "critic", text: CRITIC_EXTRA_ENVELOPE_TEXT }
          : { ok: true, role: "architect", text: ARGUMENT_TEXT },
    });
    const failure = await runPreflight(failingAdapter, { structureRecorder: failingRecorder });
    const failureText = JSON.stringify({ outcome: failure.outcome, progress: failure.progress });
    expect(failure.outcome.kind).toBe("argument");
    expect(failureText).not.toContain("audit_failed");
    expect(failureText).not.toContain("cleanup");
    expect(failureText).not.toContain("critic-raw-secret");
    expect(failureText).not.toContain("critic-envelope-secret");
    expect(failureText).not.toContain("structurally_checked");
    expect(failureText).not.toContain("handle-secret");
    expect(failureText).not.toContain("identity-secret");

    const recordedRecorder = makeRecorderOverSeam({ status: "structurally_checked" });
    const recorded = await runPreflight(makeArgumentAdapter(), { structureRecorder: recordedRecorder });
    const recordedText = JSON.stringify({ outcome: recorded.outcome, progress: recorded.progress });
    expect(recorded.outcome.kind).toBe("argument");
    if (recorded.outcome.kind !== "argument") return;
    expect(recorded.outcome.afState).toBe("recorded");
    expect(recordedText).not.toContain("structurally_checked");
    expect(recordedText).not.toContain("handle-secret");
    expect(recordedText).not.toContain("identity-secret");
  });
});
