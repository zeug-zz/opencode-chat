import type { ClaimGraph, ClaimValidationErrorCode } from "./claim-graph";
import { buildCompletedAnswerArchitectPacket, parseArchitectResultWithDetails } from "./reasoning-assist-architect";
import {
  createReasoningDiagnosticClock,
  elapsedReasoningMilliseconds,
  type ReasoningDiagnosticDependencySubreason,
  type ReasoningDiagnosticOutcome,
  type ReasoningDiagnosticReporter,
  type ReasoningDiagnosticShape,
} from "./reasoning-diagnostics";
import type { ReasoningAssistRestrictedReviewAdapter } from "./restricted-review-adapter";

export const MANUAL_REVIEW_MAPPING_TIMEOUT_MS = 30_000;

export type CompletedAnswerClaimMapper = (answer: string, signal: AbortSignal) => Promise<ClaimGraph | undefined>;

type MapperOptions = Readonly<{
  stageTimeoutMs?: number;
  diagnostics?: ReasoningDiagnosticReporter;
  now?: () => number;
}>;
type ArchitectAdapter = Pick<
  ReasoningAssistRestrictedReviewAdapter,
  "supportedStages" | "createManualReviewArchitectContext" | "runReasoningAssistStage" | "cancelReasoningAssistContext"
>;

const ABORTED = Symbol("manual-review-mapping-aborted");

const PARSE_DIAGNOSTIC_OUTCOMES: Readonly<Record<ClaimValidationErrorCode, ReasoningDiagnosticOutcome>> = Object.freeze(
  {
    malformed: "parse-malformed",
    "duplicate-identifier": "parse-duplicate-identifier",
    "missing-dependency": "parse-missing-dependency",
    cycle: "parse-cycle",
    "invalid-claim-class": "parse-invalid-claim-class",
    "unsafe-value": "parse-unsafe",
    "over-limit": "parse-over-limit",
  },
);

function mappingTimeoutReason(): Error {
  const error = new Error();
  error.name = "TimeoutError";
  return error;
}

function boundedStageTimeout(timeoutMs: number | undefined): number {
  return Number.isInteger(timeoutMs) && timeoutMs !== undefined && timeoutMs > 0
    ? Math.min(timeoutMs, MANUAL_REVIEW_MAPPING_TIMEOUT_MS)
    : MANUAL_REVIEW_MAPPING_TIMEOUT_MS;
}

function awaitAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<typeof ABORTED>((resolve) => {
    onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([operation, cancelled]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

/**
 * Map only the completed answer's visible prose through the already-attested,
 * generation-bound architect stage. The shared architect parser is the sole
 * source of the validated graph; no AF or reviewer output enters this mapper.
 */
export function createCompletedAnswerClaimMapper(
  adapter: ArchitectAdapter,
  options: MapperOptions = {},
): CompletedAnswerClaimMapper {
  const timeoutMs = boundedStageTimeout(options.stageTimeoutMs);
  const now = createReasoningDiagnosticClock(options.now);
  const report = (
    outcome: ReasoningDiagnosticOutcome,
    startedAt?: number,
    malformedShape?: ReasoningDiagnosticShape,
    dependencySubreason?: ReasoningDiagnosticDependencySubreason,
  ): void => {
    try {
      const elapsedMs = startedAt === undefined ? undefined : elapsedReasoningMilliseconds(now, startedAt);
      options.diagnostics?.({
        stage: "manual-mapping",
        outcome,
        ...(malformedShape === undefined ? {} : { malformedShape }),
        ...(dependencySubreason === undefined ? {} : { dependencySubreason }),
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
      });
    } catch {
      // Diagnostic sinks are optional and never affect manual-review behavior.
    }
  };
  const reportArchitectParse = (
    outcome: ReasoningDiagnosticOutcome,
    startedAt?: number,
    malformedShape?: ReasoningDiagnosticShape,
    normalizationApplied = false,
    dependencySubreason?: ReasoningDiagnosticDependencySubreason,
  ): void => {
    try {
      const elapsedMs = startedAt === undefined ? undefined : elapsedReasoningMilliseconds(now, startedAt);
      options.diagnostics?.({
        stage: "architect-result-parse",
        outcome,
        ...(malformedShape === undefined ? {} : { malformedShape }),
        ...(dependencySubreason === undefined ? {} : { dependencySubreason }),
        ...(normalizationApplied ? { normalization: "fenced" as const } : {}),
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
      });
    } catch {
      // Parsing diagnostics are optional and cannot affect manual-review behavior.
    }
  };

  return async (answer, signal) => {
    const mappingStartedAt = now();
    report("mapping-started");
    if (signal.aborted) {
      report("stage-cancelled", mappingStartedAt);
      return undefined;
    }
    if (!adapter.supportedStages.includes("architect")) {
      report("stage-unavailable", mappingStartedAt);
      return undefined;
    }
    const packet = buildCompletedAnswerArchitectPacket(answer);
    if (packet.kind !== "packet") {
      const outcome: ReasoningDiagnosticOutcome =
        packet.reason === "empty-text"
          ? "packet-empty-text"
          : packet.reason === "text-over-limit"
            ? "packet-text-over-limit"
            : "packet-invalid-input";
      report(outcome, mappingStartedAt);
      return undefined;
    }
    report("packet-ready", mappingStartedAt);

    const stageController = new AbortController();
    const forwardAbort = (): void => stageController.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => stageController.abort(mappingTimeoutReason()), timeoutMs);
    let context: Awaited<ReturnType<ArchitectAdapter["createManualReviewArchitectContext"]>> | undefined;
    let mappingClosed = false;
    let contextFailed = false;

    const dispose = async (target: NonNullable<typeof context>): Promise<void> => {
      try {
        await adapter.cancelReasoningAssistContext(target);
      } catch {
        // Hidden-context cleanup is best effort and never exposes provider detail.
      }
    };

    try {
      const contextStartedAt = now();
      report("context-started");
      const contextCreation = Promise.resolve()
        .then(() => adapter.createManualReviewArchitectContext(stageController.signal))
        .then(async (created) => {
          if (!created) return undefined;
          if (mappingClosed || stageController.signal.aborted || created.provenance.role !== "architect") {
            await dispose(created);
            return undefined;
          }
          context = created;
          return created;
        })
        .catch(() => {
          contextFailed = true;
          return undefined;
        });
      const created = await awaitAbortable(contextCreation, stageController.signal);
      if (created === ABORTED || !created) {
        const outcome: ReasoningDiagnosticOutcome = signal.aborted
          ? "context-cancelled"
          : stageController.signal.aborted
            ? "context-timeout"
            : contextFailed
              ? "context-failed"
              : "context-unavailable";
        report(outcome, contextStartedAt);
        return undefined;
      }
      report("context-ready", contextStartedAt);

      const stageStartedAt = now();
      let stageFailed = false;
      report("stage-started");
      const stage = await awaitAbortable(
        Promise.resolve()
          .then(() => adapter.runReasoningAssistStage(created, packet.packet, "architect", stageController.signal))
          .catch(() => {
            stageFailed = true;
            return undefined;
          }),
        stageController.signal,
      );
      if (stage === ABORTED || !stage || !stage.ok || stage.role !== "architect" || stageController.signal.aborted) {
        const outcome: ReasoningDiagnosticOutcome = signal.aborted
          ? "stage-cancelled"
          : stageController.signal.aborted
            ? "stage-timeout"
            : stage !== ABORTED && stage !== undefined && !stage.ok
              ? stage.reason === "cancelled"
                ? "stage-cancelled"
                : stage.reason === "timeout"
                  ? "stage-timeout"
                  : stage.reason === "malformed"
                    ? "stage-malformed"
                    : stage.reason === "oversized"
                      ? "stage-oversized"
                      : stage.reason === "model-failure"
                        ? "stage-failed-model"
                        : "stage-failed"
              : stageFailed
                ? "stage-failed"
                : "stage-unavailable";
        report(outcome, stageStartedAt);
        return undefined;
      }
      report("completed", stageStartedAt);

      const parseStartedAt = now();
      reportArchitectParse("started");
      const parseDetails = parseArchitectResultWithDetails(stage.text);
      const parsed = parseDetails.result;
      reportArchitectParse(
        parsed.kind === "no-assist" ? parsed.reason : "success",
        parseStartedAt,
        parseDetails.malformedShape,
        parseDetails.normalizationApplied,
        parseDetails.dependencySubreason,
      );
      if (parsed.kind === "argument") {
        report("argument", mappingStartedAt);
        return parsed.graph;
      }
      if (parsed.kind === "ordinary") {
        report("ordinary", mappingStartedAt);
        return undefined;
      }
      report(
        PARSE_DIAGNOSTIC_OUTCOMES[parsed.reason],
        mappingStartedAt,
        parseDetails.malformedShape,
        parseDetails.dependencySubreason,
      );
      return undefined;
    } catch {
      report("stage-failed", mappingStartedAt);
      return undefined;
    } finally {
      mappingClosed = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", forwardAbort);
      stageController.abort();
      if (context) await dispose(context);
    }
  };
}
