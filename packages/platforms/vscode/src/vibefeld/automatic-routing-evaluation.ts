/**
 * Private, aggregate-only evidence for automatic routing qualification.
 *
 * This module intentionally has no corpus or case representation beyond the
 * bounded measurement input used by fixture tests. Its output is an
 * attestation-shaped aggregate, not production evidence by itself.
 */

export const AUTOMATIC_ROUTING_EVALUATION_TARGETS = Object.freeze({
  minimumCaseCount: 100,
  maximumCaseCount: 10_000,
  maximumP95LatencyMs: 2_000,
  maximumExpectedCalibrationError: 0.1,
  maximumFalseChallengeRate: 0.05,
} as const);

const MAX_VERSION_LENGTH = 64;
const MAX_CORPUS_ID_LENGTH = 128;
const MAX_LATENCY_MS = 86_400_000;
const VERSION = /^automatic-routing-evaluation-[1-9][0-9]*$/u;
const CORPUS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type AutomaticRoutingEvaluation = Readonly<{
  version: string;
  corpusId: string;
  caseCount: number;
  p95LatencyMs: number;
  expectedCalibrationError: number;
  falseChallengeRate: number;
  qualified: boolean;
}>;

export type AutomaticRoutingMeasurementCase = Readonly<{
  latencyMs: number;
  confidence: number;
  correct: boolean;
  challenged: boolean;
  falseChallenge: boolean;
}>;

export type AutomaticRoutingEvaluationErrorCode =
  | "malformed"
  | "unknown-field"
  | "stale-version"
  | "unsafe-value"
  | "non-finite"
  | "negative"
  | "over-limit"
  | "inconsistent-qualification";

export type AutomaticRoutingEvaluationValidation =
  | Readonly<{ ok: true; value: AutomaticRoutingEvaluation }>
  | Readonly<{ ok: false; code: AutomaticRoutingEvaluationErrorCode }>;

export const AUTOMATIC_ROUTING_EVALUATION_VERSION = "automatic-routing-evaluation-1" as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function fail(code: AutomaticRoutingEvaluationErrorCode): AutomaticRoutingEvaluationValidation {
  return { ok: false, code };
}

function targetQualified(value: Omit<AutomaticRoutingEvaluation, "qualified">): boolean {
  return (
    value.caseCount >= AUTOMATIC_ROUTING_EVALUATION_TARGETS.minimumCaseCount &&
    value.p95LatencyMs <= AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumP95LatencyMs &&
    value.expectedCalibrationError <= AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumExpectedCalibrationError &&
    value.falseChallengeRate <= AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumFalseChallengeRate
  );
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Validate aggregate evidence without returning any input content. */
export function validateAutomaticRoutingEvaluation(value: unknown): AutomaticRoutingEvaluationValidation {
  const keys = [
    "version",
    "corpusId",
    "caseCount",
    "p95LatencyMs",
    "expectedCalibrationError",
    "falseChallengeRate",
    "qualified",
  ] as const;
  if (!record(value)) return fail("malformed");
  if (!exact(value, keys)) return fail("unknown-field");
  if (
    typeof value.version !== "string" ||
    value.version.length === 0 ||
    value.version.length > MAX_VERSION_LENGTH ||
    !VERSION.test(value.version) ||
    typeof value.corpusId !== "string" ||
    value.corpusId.length === 0 ||
    value.corpusId.length > MAX_CORPUS_ID_LENGTH ||
    !CORPUS_ID.test(value.corpusId)
  )
    return fail("unsafe-value");
  if (value.version !== AUTOMATIC_ROUTING_EVALUATION_VERSION) return fail("stale-version");
  if (!Number.isSafeInteger(value.caseCount) || value.caseCount < 0) return fail("negative");
  if (value.caseCount > AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount) return fail("over-limit");
  if (![value.p95LatencyMs, value.expectedCalibrationError, value.falseChallengeRate].every(finiteNonNegative))
    return fail("non-finite");
  if (value.p95LatencyMs > MAX_LATENCY_MS || value.expectedCalibrationError > 1 || value.falseChallengeRate > 1)
    return fail("over-limit");
  if (typeof value.qualified !== "boolean") return fail("malformed");

  const aggregate = {
    version: value.version,
    corpusId: value.corpusId,
    caseCount: value.caseCount,
    p95LatencyMs: value.p95LatencyMs,
    expectedCalibrationError: value.expectedCalibrationError,
    falseChallengeRate: value.falseChallengeRate,
  };
  if (value.qualified !== targetQualified(aggregate)) return fail("inconsistent-qualification");
  return { ok: true, value: Object.freeze({ ...aggregate, qualified: value.qualified }) };
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

/**
 * Measure bounded fixture cases in memory. The returned value contains only
 * aggregate fields; callers must not treat fixture output as production evidence.
 */
export function measureAutomaticRoutingFixture(
  corpusId: string,
  cases: readonly AutomaticRoutingMeasurementCase[],
): AutomaticRoutingEvaluationValidation {
  if (
    typeof corpusId !== "string" ||
    corpusId.length === 0 ||
    corpusId.length > MAX_CORPUS_ID_LENGTH ||
    !CORPUS_ID.test(corpusId) ||
    !Array.isArray(cases) ||
    cases.length > AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount
  )
    return fail("malformed");

  const latencies: number[] = [];
  const bins = Array.from({ length: 10 }, () => ({ confidence: 0, correct: 0, count: 0 }));
  let falseChallenges = 0;
  for (const measurement of cases) {
    if (
      !record(measurement) ||
      !exact(measurement, ["latencyMs", "confidence", "correct", "challenged", "falseChallenge"])
    )
      return fail("unknown-field");
    if (!finiteNonNegative(measurement.latencyMs) || measurement.latencyMs > MAX_LATENCY_MS) return fail("over-limit");
    if (!finiteNonNegative(measurement.confidence) || measurement.confidence > 1) return fail("over-limit");
    if (
      typeof measurement.correct !== "boolean" ||
      typeof measurement.challenged !== "boolean" ||
      typeof measurement.falseChallenge !== "boolean"
    )
      return fail("malformed");
    if (measurement.falseChallenge && !measurement.challenged) return fail("malformed");
    latencies.push(measurement.latencyMs);
    const bin = bins[Math.min(9, Math.floor(measurement.confidence * 10))];
    bin.confidence += measurement.confidence;
    bin.correct += measurement.correct ? 1 : 0;
    bin.count += 1;
    if (measurement.falseChallenge) falseChallenges += 1;
  }
  const expectedCalibrationError = bins.reduce(
    (total, bin) =>
      total +
      (bin.count === 0
        ? 0
        : (bin.count / cases.length) * Math.abs(bin.confidence / bin.count - bin.correct / bin.count)),
    0,
  );
  const aggregate = {
    version: AUTOMATIC_ROUTING_EVALUATION_VERSION,
    corpusId,
    caseCount: cases.length,
    p95LatencyMs: percentile95(latencies),
    expectedCalibrationError,
    falseChallengeRate: cases.length === 0 ? 0 : falseChallenges / cases.length,
  };
  return validateAutomaticRoutingEvaluation({ ...aggregate, qualified: targetQualified(aggregate) });
}
