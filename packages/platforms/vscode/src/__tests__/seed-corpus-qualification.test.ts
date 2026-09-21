import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_ROUTING_EVALUATION_TARGETS,
  type AutomaticRoutingMeasurementCase,
  measureAutomaticRoutingFixture,
  validateAutomaticRoutingEvaluation,
} from "../vibefeld/automatic-routing-evaluation";

type SeedCorpus = {
  version: string;
  corpusId: string;
  cases: Array<AutomaticRoutingMeasurementCase>;
};

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/vibefeld/qualification/seed-corpus-1.json", import.meta.url), "utf8"),
) as unknown;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));

describe("Vibefeld qualification seed corpus", () => {
  it("measures the bounded, versioned corpus through the qualification path", () => {
    expect(record(corpus)).toBe(true);
    if (!record(corpus)) return;

    expect(exactKeys(corpus, ["version", "corpusId", "cases"])).toBe(true);
    expect(corpus.version).toBe("seed-corpus-1");
    expect(corpus.corpusId).toBe("seed-corpus-1");
    expect(Array.isArray(corpus.cases)).toBe(true);
    if (!Array.isArray(corpus.cases)) return;
    expect(corpus.cases.length).toBeGreaterThanOrEqual(30);
    expect(corpus.cases.length).toBeLessThanOrEqual(50);

    const strings: string[] = [];
    const collectStrings = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(collectStrings);
      else if (record(value)) Object.values(value).forEach(collectStrings);
    };
    collectStrings(corpus);
    expect(strings).toEqual(["seed-corpus-1", "seed-corpus-1"]);
    expect(JSON.stringify(corpus)).not.toMatch(
      /(?:^|[\\/])(?:Users|home|workspace|prompt|response|source|review|path)(?:[\\/]|\b)/iu,
    );

    for (const measurement of corpus.cases) {
      expect(record(measurement)).toBe(true);
      if (!record(measurement)) continue;
      expect(exactKeys(measurement, ["latencyMs", "confidence", "correct", "challenged", "falseChallenge"])).toBe(true);
      expect(typeof measurement.latencyMs).toBe("number");
      expect(Number.isFinite(measurement.latencyMs)).toBe(true);
      expect(measurement.latencyMs).toBeGreaterThanOrEqual(0);
      expect(measurement.latencyMs).toBeLessThanOrEqual(86_400_000);
      expect(typeof measurement.confidence).toBe("number");
      expect(measurement.confidence).toBeGreaterThanOrEqual(0);
      expect(measurement.confidence).toBeLessThanOrEqual(1);
      expect(typeof measurement.correct).toBe("boolean");
      expect(typeof measurement.challenged).toBe("boolean");
      expect(typeof measurement.falseChallenge).toBe("boolean");
      expect(measurement.falseChallenge === false || measurement.challenged).toBe(true);
    }

    const measured = corpus.cases as SeedCorpus["cases"];
    const result = measureAutomaticRoutingFixture(corpus.corpusId as string, measured);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(validateAutomaticRoutingEvaluation(result.value)).toEqual(result);
    expect(result.value.caseCount).toBe(corpus.cases.length);
    expect(result.value.p95LatencyMs).toBeLessThanOrEqual(AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumP95LatencyMs);
    expect(result.value.expectedCalibrationError).toBeLessThanOrEqual(
      AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumExpectedCalibrationError,
    );
    expect(result.value.falseChallengeRate).toBeLessThanOrEqual(
      AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumFalseChallengeRate,
    );
    expect(result.value.qualified).toBe(false);
    expect(result.value.caseCount).toBeLessThan(AUTOMATIC_ROUTING_EVALUATION_TARGETS.minimumCaseCount);
  });
});
