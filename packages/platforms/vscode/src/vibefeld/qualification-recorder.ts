/**
 * Host-private aggregate live recorder for automatic-routing qualification.
 *
 * The recorder stores only bounded measurement tuples assembled from three
 * bounded inputs: the latency the host measured around one completed review,
 * the terminal review status, and bounded local review-card feedback.
 * `confidence` and `challenged` are derived from the status through the fixed
 * host-private mapping below. Prompts, source packets, review text, response
 * text, paths, and session or message identifiers never reach this module.
 *
 * The status mapping mirrors the review-summary semantics the card uses: a
 * terminal status that records an objection (`unresolved`, `refuted`,
 * `blocked`) corresponds to a summary with open challenges, while the other
 * terminal statuses record none. The host additionally gates the
 * `falseChallenge` feedback on the review summary's `openChallenges`, so a
 * challenge signal is only collected for a review that raised one, and the
 * recorder normalizes it away for unchallenged statuses.
 *
 * Persistence is delegated to an injected seam whose default is in memory.
 * The module performs no process, filesystem, or network work, and it never
 * imports or calls a memory provider.
 */

import type { ReasoningReviewStatus } from "@opencode-chat/core";
import {
  AUTOMATIC_ROUTING_EVALUATION_TARGETS,
  type AutomaticRoutingEvaluation,
  type AutomaticRoutingMeasurementCase,
  measureAutomaticRoutingFixture,
} from "./automatic-routing-evaluation";

/** Matches the existing measurement bound so every live tuple stays measurable. */
const MAX_LATENCY_MS = 86_400_000;

const LIVE_CORPUS_ID = "live-review-feedback";

const RECORD_KEYS: readonly string[] = ["latencyMs", "status", "feedback"];
const FEEDBACK_KEYS: readonly string[] = ["correct", "falseChallenge"];
const MEASUREMENT_KEYS = ["latencyMs", "confidence", "correct", "challenged", "falseChallenge"] as const;

type TerminalReviewStatus = Exclude<ReasoningReviewStatus, "not_reviewed" | "reviewing">;

/**
 * Fixed host-private mapping of a terminal review status to its confidence
 * prior and challenge fact. The confidence value is a documented host prior;
 * it never comes from model output, provider metadata, or review text.
 */
const TERMINAL_REVIEW_STATUS: Readonly<
  Record<TerminalReviewStatus, Readonly<{ confidence: number; challenged: boolean }>>
> = {
  structurally_checked: { confidence: 0.9, challenged: false },
  conditional: { confidence: 0.6, challenged: false },
  unresolved: { confidence: 0.4, challenged: true },
  refuted: { confidence: 0.2, challenged: true },
  blocked: { confidence: 0.3, challenged: true },
  audit_failed: { confidence: 0.1, challenged: false },
  unavailable: { confidence: 0.1, challenged: false },
};

/** Bounded local review-card feedback. Only the two booleans are accepted. */
export type QualificationReviewFeedback = Readonly<{
  correct: boolean;
  falseChallenge?: boolean;
}>;

export type QualificationRecorderErrorCode =
  | "malformed"
  | "unknown-field"
  | "unknown-status"
  | "non-finite"
  | "negative"
  | "over-limit";

export type QualificationRecordResult =
  | Readonly<{ ok: true; caseCount: number }>
  | Readonly<{ ok: false; code: QualificationRecorderErrorCode }>;

/** Injected persistence/retention seam; the default implementation is in memory. */
export type QualificationRecorderStore = Readonly<{
  load: () => readonly AutomaticRoutingMeasurementCase[];
  save: (cases: readonly AutomaticRoutingMeasurementCase[]) => void;
}>;

export function createInMemoryQualificationRecorderStore(): QualificationRecorderStore {
  let cases: readonly AutomaticRoutingMeasurementCase[] = Object.freeze([]);
  return {
    load: () => cases,
    save: (next) => {
      cases = Object.freeze([...next]);
    },
  };
}

/** The narrow read/record surface the host depends on. */
export type QualificationRecorderSeam = Readonly<{
  record: (input: unknown) => QualificationRecordResult;
  currentEvaluation: () => AutomaticRoutingEvaluation | undefined;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMeasurementCase(value: unknown): value is AutomaticRoutingMeasurementCase {
  if (!isRecord(value) || !exactKeys(value, MEASUREMENT_KEYS)) return false;
  if (!finiteNonNegative(value.latencyMs) || value.latencyMs > MAX_LATENCY_MS) return false;
  if (!finiteNonNegative(value.confidence) || value.confidence > 1) return false;
  if (
    typeof value.correct !== "boolean" ||
    typeof value.challenged !== "boolean" ||
    typeof value.falseChallenge !== "boolean"
  )
    return false;
  return !(value.falseChallenge && !value.challenged);
}

function terminalStatusFacts(status: unknown): Readonly<{ confidence: number; challenged: boolean }> | undefined {
  if (typeof status !== "string") return undefined;
  if (!Object.hasOwn(TERMINAL_REVIEW_STATUS, status)) return undefined;
  return TERMINAL_REVIEW_STATUS[status as TerminalReviewStatus];
}

function fail(code: QualificationRecorderErrorCode): QualificationRecordResult {
  return { ok: false, code };
}

export class QualificationRecorder implements QualificationRecorderSeam {
  private readonly store: QualificationRecorderStore;

  constructor(store: QualificationRecorderStore = createInMemoryQualificationRecorderStore()) {
    this.store = store;
  }

  /**
   * Accept exactly `{ latencyMs, status, feedback }`. Any other field — a
   * prompt, source packet, review or response text, path, identifier, or any
   * unknown key — fails closed and stores nothing.
   */
  record(input: unknown): QualificationRecordResult {
    if (!isRecord(input)) return fail("malformed");
    if (Object.keys(input).some((key) => !RECORD_KEYS.includes(key))) return fail("unknown-field");

    const { latencyMs, status, feedback } = input;
    if (typeof latencyMs !== "number") return fail("malformed");
    if (!Number.isFinite(latencyMs)) return fail("non-finite");
    if (latencyMs < 0) return fail("negative");
    if (latencyMs > MAX_LATENCY_MS) return fail("over-limit");

    const facts = terminalStatusFacts(status);
    if (!facts) return fail(status === undefined || typeof status !== "string" ? "malformed" : "unknown-status");

    if (!isRecord(feedback)) return fail("malformed");
    if (Object.keys(feedback).some((key) => !FEEDBACK_KEYS.includes(key))) return fail("unknown-field");
    if (typeof feedback.correct !== "boolean") return fail("malformed");
    if ("falseChallenge" in feedback && typeof feedback.falseChallenge !== "boolean") return fail("malformed");

    const cases = this.readValidCases();
    if (cases.length >= AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount) return fail("over-limit");

    const measurement: AutomaticRoutingMeasurementCase = Object.freeze({
      latencyMs,
      confidence: facts.confidence,
      correct: feedback.correct,
      // A challenge signal is only meaningful where the status records one.
      challenged: facts.challenged,
      falseChallenge: facts.challenged && feedback.falseChallenge === true,
    });
    const next = [...cases, measurement];
    this.store.save(next);
    return { ok: true, caseCount: next.length };
  }

  /**
   * The measured, validated aggregate, or `undefined`. Nothing is reported
   * until the live capture reaches the existing case minimum, and the
   * qualified flag is only ever produced by the existing validator.
   */
  currentEvaluation(): AutomaticRoutingEvaluation | undefined {
    const cases = this.readValidCases();
    if (cases.length < AUTOMATIC_ROUTING_EVALUATION_TARGETS.minimumCaseCount) return undefined;
    const measured = measureAutomaticRoutingFixture(LIVE_CORPUS_ID, cases);
    return measured.ok ? measured.value : undefined;
  }

  /**
   * Read only well-formed bounded tuples: malformed persisted entries are
   * dropped and the corpus is capped, so corrupt or oversized state can never
   * produce a report or grow the retained aggregate.
   */
  private readValidCases(): readonly AutomaticRoutingMeasurementCase[] {
    const loaded = this.store.load();
    if (!Array.isArray(loaded)) return Object.freeze([]);
    const valid: AutomaticRoutingMeasurementCase[] = [];
    for (const candidate of loaded) {
      if (valid.length >= AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount) break;
      if (isMeasurementCase(candidate)) valid.push(candidate);
    }
    return valid;
  }
}
