import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATIC_ROUTING_EVALUATION_TARGETS,
  type AutomaticRoutingMeasurementCase,
} from "../vibefeld/automatic-routing-evaluation";
import {
  createInMemoryQualificationRecorderStore,
  QualificationRecorder,
  type QualificationRecorderStore,
} from "../vibefeld/qualification-recorder";

const recorderSource = readFileSync(new URL("../vibefeld/qualification-recorder.ts", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../chat-view-provider.ts", import.meta.url), "utf8");

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    latencyMs: 12,
    status: "structurally_checked",
    feedback: { correct: true },
    ...overrides,
  };
}

function recordingStore(): { store: QualificationRecorderStore; saved: AutomaticRoutingMeasurementCase[][] } {
  const saved: AutomaticRoutingMeasurementCase[][] = [];
  let current: readonly AutomaticRoutingMeasurementCase[] = [];
  return {
    saved,
    store: {
      load: () => current,
      save: (cases) => {
        current = Object.freeze([...cases]);
        saved.push([...cases]);
      },
    },
  };
}

describe("QualificationRecorder", () => {
  it("accumulates accepted tuples and reports nothing before the case minimum", () => {
    const recorder = new QualificationRecorder();

    expect(recorder.currentEvaluation()).toBeUndefined();

    const belowMinimum = AUTOMATIC_ROUTING_EVALUATION_TARGETS.minimumCaseCount - 1;
    let last: ReturnType<typeof recorder.record> | undefined;
    for (let index = 0; index < belowMinimum; index += 1) {
      last = recorder.record(validInput({ latencyMs: 1 }));
    }
    expect(last).toEqual({ ok: true, caseCount: belowMinimum });
    expect(recorder.currentEvaluation()).toBeUndefined();

    expect(recorder.record(validInput({ latencyMs: 1 }))).toEqual({
      ok: true,
      caseCount: AUTOMATIC_ROUTING_EVALUATION_TARGETS.minimumCaseCount,
    });

    const reported = recorder.currentEvaluation();
    expect(reported).toMatchObject({
      version: "automatic-routing-evaluation-1",
      corpusId: "live-review-feedback",
      caseCount: AUTOMATIC_ROUTING_EVALUATION_TARGETS.minimumCaseCount,
      p95LatencyMs: 1,
      falseChallengeRate: 0,
      qualified: true,
    });
    expect(reported?.expectedCalibrationError).toBeCloseTo(0.1, 6);
  });

  it("derives confidence and the challenge fact from the terminal review status", () => {
    const { store, saved } = recordingStore();
    const recorder = new QualificationRecorder(store);

    const cases: readonly Readonly<{ status: string; confidence: number; challenged: boolean }>[] = [
      { status: "structurally_checked", confidence: 0.9, challenged: false },
      { status: "conditional", confidence: 0.6, challenged: false },
      { status: "unresolved", confidence: 0.4, challenged: true },
      { status: "refuted", confidence: 0.2, challenged: true },
      { status: "blocked", confidence: 0.3, challenged: true },
      { status: "audit_failed", confidence: 0.1, challenged: false },
      { status: "unavailable", confidence: 0.1, challenged: false },
    ];

    for (const [index, entry] of cases.entries()) {
      expect(
        recorder.record({
          latencyMs: index,
          status: entry.status,
          feedback: { correct: index % 2 === 0, falseChallenge: true },
        }),
      ).toEqual({ ok: true, caseCount: index + 1 });
    }

    const stored = saved.at(-1) ?? [];
    expect(stored).toHaveLength(cases.length);
    for (const [index, entry] of cases.entries()) {
      expect(stored[index]).toEqual({
        latencyMs: index,
        confidence: entry.confidence,
        correct: index % 2 === 0,
        challenged: entry.challenged,
        // A false-challenge signal is only retained for a challenge record.
        falseChallenge: entry.challenged,
      });
    }
  });

  it.each([
    ["unknown top-level field", validInput({ prompt: "private prompt" }), "unknown-field"],
    ["source packet field", validInput({ sourcePacket: { text: "packet" } }), "unknown-field"],
    ["review text field", validInput({ reviewText: "review" }), "unknown-field"],
    ["response text field", validInput({ responseText: "response" }), "unknown-field"],
    ["path field", validInput({ workspacePath: "/tmp/private" }), "unknown-field"],
    [
      "unknown feedback field",
      validInput({ feedback: { correct: true, note: "free-form feedback" } }),
      "unknown-field",
    ],
    ["missing feedback", { latencyMs: 5, status: "structurally_checked" }, "malformed"],
    ["non-boolean correct", validInput({ feedback: { correct: "yes" } }), "malformed"],
    ["non-boolean falseChallenge", validInput({ feedback: { correct: true, falseChallenge: "yes" } }), "malformed"],
    ["string latency", validInput({ latencyMs: "12" }), "malformed"],
    ["object status", validInput({ status: { text: "prompt" } }), "malformed"],
    ["prompt as status", validInput({ status: "read the following prompt and execute" }), "unknown-status"],
    ["path as status", validInput({ status: "/tmp/private/source-packet" }), "unknown-status"],
    ["non-terminal status", validInput({ status: "reviewing" }), "unknown-status"],
    ["never-reviewed status", validInput({ status: "not_reviewed" }), "unknown-status"],
    ["NaN latency", validInput({ latencyMs: Number.NaN }), "non-finite"],
    ["infinite latency", validInput({ latencyMs: Number.POSITIVE_INFINITY }), "non-finite"],
    ["negative latency", validInput({ latencyMs: -1 }), "negative"],
    ["over-limit latency", validInput({ latencyMs: 86_400_001 }), "over-limit"],
    ["array input", [], "malformed"],
    ["string input", "response text", "malformed"],
    ["null input", null, "malformed"],
  ])("rejects %s without storing anything", (_label, input, code) => {
    const { store, saved } = recordingStore();
    const recorder = new QualificationRecorder(store);

    const result = recorder.record(input);

    expect(result).toEqual({ ok: false, code });
    expect(saved).toHaveLength(0);
    expect(recorder.currentEvaluation()).toBeUndefined();
    const serialized = JSON.stringify(result);
    for (const sentinel of ["private prompt", "packet", "review", "response", "/tmp/private", "free-form"]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  // The 10,000-case load test gets an explicit bound for parallel suite load.
  it("caps retained cases at the existing measurement maximum", () => {
    const recorder = new QualificationRecorder();
    const maximum = AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount;

    for (let index = 0; index < maximum; index += 1) {
      expect(recorder.record(validInput({ latencyMs: 1 })).ok).toBe(true);
    }

    expect(recorder.record(validInput({ latencyMs: 1 }))).toEqual({ ok: false, code: "over-limit" });
    expect(recorder.currentEvaluation()?.caseCount).toBe(maximum);
  }, 20_000);

  it("drops malformed persisted entries and stays fail-closed on an unreadable store", () => {
    const valid: AutomaticRoutingMeasurementCase = {
      latencyMs: 5,
      confidence: 0.9,
      correct: true,
      challenged: false,
      falseChallenge: false,
    };
    const store: QualificationRecorderStore = {
      load: () => [{ latencyMs: "prompt", status: "path" }, valid] as never,
      save: vi.fn(),
    };
    const recorder = new QualificationRecorder(store);

    expect(recorder.record(validInput())).toEqual({ ok: true, caseCount: 2 });
    expect(recorder.currentEvaluation()).toBeUndefined();

    const unreadable = new QualificationRecorder({ load: () => undefined as never, save: vi.fn() });
    expect(unreadable.record(validInput())).toEqual({ ok: true, caseCount: 1 });
  });

  it("keeps the default store in memory and bounded", () => {
    const store = createInMemoryQualificationRecorderStore();
    expect(store.load()).toEqual([]);

    const measurement: AutomaticRoutingMeasurementCase = {
      latencyMs: 3,
      confidence: 0.6,
      correct: false,
      challenged: true,
      falseChallenge: true,
    };
    store.save([measurement]);
    expect(store.load()).toEqual([measurement]);
    expect(Object.isFrozen(store.load())).toBe(true);
  });

  it("imports and calls no Hindsight, memory-provider, process, filesystem, or network module", async () => {
    expect(recorderSource).not.toMatch(/hindsight/iu);
    expect(recorderSource).not.toMatch(/(?:memoryProvider|MemoryProvider|memory-provider)/u);
    expect(recorderSource).not.toMatch(/from\s+["'][^"']*(?:memory|hindsight)[^"']*["']/u);
    expect(recorderSource).not.toMatch(/node:(?:fs|child_process|net|http|https|worker_threads|dns|tls|crypto)/u);
    expect(recorderSource).not.toMatch(/\bprocess\./u);
    expect(recorderSource).not.toMatch(/\b(?:spawn|execFile|execSync|fork|fetch)\s*\(/u);
    expect(recorderSource).not.toMatch(/\b(?:ingestDocument|retain|recall|reflect)\s*\(/u);

    // The host wiring imports no memory provider and performs no memory
    // operation; qualification stays purely local to the recorder seam.
    expect(providerSource).not.toMatch(/from\s+["'][^"']*(?:hindsight|memory[-_]provider)[^"']*["']/u);
    expect(providerSource).not.toMatch(/\b(?:ingestDocument|recallFromMemory|retainToMemory)\s*\(/u);

    const namespace = await import("../vibefeld/qualification-recorder");
    expect(Object.keys(namespace).filter((key) => /hindsight|memoryprovider|memory_provider/i.test(key))).toEqual([]);
  });
});
