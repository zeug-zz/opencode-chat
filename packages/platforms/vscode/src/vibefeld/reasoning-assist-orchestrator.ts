/**
 * Host-private reasoning-assist preflight orchestrator.
 *
 * For one eligible Scribe text prompt this module runs exactly one bounded
 * architect preflight, then optional AF structure recording, and publishes
 * prompt-scoped progress only after a valid argument map exists. It owns no AF,
 * provider, VS Code, or webview dependency beyond the
 * injected adapter, recorder, and progress sink, and performs no I/O.
 *
 * An elapsed deadline is not staleness: only an aborted signal or a superseded
 * prompt invalidates a preflight, so an ordinary or failed preflight always
 * resolves its pending activity. Every outcome other than a fully valid
 * argument is "dispatch-unchanged": the ordinary prompt path proceeds
 * untouched, and cancellation, deadline expiry, abort, staleness, and adapter
 * failures are all bounded and never thrown. Each such outcome carries one
 * bounded reason token (plus only the numeric stage text length and the
 * bounded schema-validation parse sub-reason for an invalid stage result, and
 * only the numeric elapsed stage time for a stage failure or a deadline);
 * raw stage text, adapter handles, projection status, and failure detail never
 * leave this module.
 */

import type { ReasoningAssistStage } from "@opencode-chat/core";
import type { ClaimGraph } from "./claim-graph";
import {
  type ArchitectAssistFacts,
  type ArchitectNoAssistReason,
  type ArchitectPacketIneligibleReason,
  type ArchitectRecentTurn,
  buildArchitectPacket,
  parseArchitectResultWithDetails,
} from "./reasoning-assist-architect";
import type { ReasoningAssistStructureRecorder } from "./reasoning-assist-structure-recorder";
import {
  createReasoningDiagnosticClock,
  elapsedReasoningMilliseconds,
  type ReasoningDiagnosticEvent,
  type ReasoningDiagnosticOutcome,
} from "./reasoning-diagnostics";
import type {
  ReasoningAssistContextMetadata,
  ReasoningAssistRestrictedReviewAdapter,
  ReasoningAssistStageFailureReason,
} from "./restricted-review-adapter";

/** Bounded wall-clock budget for one complete preflight. */
export const REASONING_ASSIST_PREFLIGHT_DEADLINE_MS = 45_000;

/**
 * The bounded, self-explaining outcome reason published with every
 * `dispatch-unchanged` preflight. It names only eligibility, stage
 * unavailability, the bounded stage-failure class, an ordinary result, an
 * invalid stage result, or a deadline — never raw stage text, packet content,
 * graph identifiers, or failure payloads.
 */
export type ReasoningAssistUnchangedReason =
  | "packet-invalid-input"
  | "packet-empty-text"
  | "packet-text-over-limit"
  | "stage-unavailable"
  | "stage-failed"
  | "stage-failed-timeout"
  | "stage-failed-cancelled"
  | "stage-failed-malformed"
  | "stage-failed-oversized"
  | "stage-failed-model"
  | "stage-failed-unknown-role"
  | "ordinary"
  | "invalid-result"
  | "deadline";

const PACKET_UNCHANGED_REASONS: Readonly<Record<ArchitectPacketIneligibleReason, ReasoningAssistUnchangedReason>> =
  Object.freeze({
    "invalid-input": "packet-invalid-input",
    "empty-text": "packet-empty-text",
    "text-over-limit": "packet-text-over-limit",
  });

const STAGE_FAILURE_UNCHANGED_REASONS: Readonly<
  Record<ReasoningAssistStageFailureReason, ReasoningAssistUnchangedReason>
> = Object.freeze({
  "unknown-role": "stage-failed-unknown-role",
  cancelled: "stage-failed-cancelled",
  timeout: "stage-failed-timeout",
  malformed: "stage-failed-malformed",
  oversized: "stage-failed-oversized",
  "model-failure": "stage-failed-model",
});

/**
 * The narrow adapter surface the orchestrator needs. The full
 * `ReasoningAssistRestrictedReviewAdapter` structurally satisfies this view.
 */
export type ReasoningAssistPreflightAdapter = Pick<
  ReasoningAssistRestrictedReviewAdapter,
  "createReasoningAssistContext" | "runReasoningAssistStage" | "cancelReasoningAssistContext"
>;

/** The bounded preflight inputs; nothing else is accepted. */
export type ReasoningAssistPreflightInput = Readonly<{
  sessionId: string;
  userText: string;
  recentTurns?: readonly ArchitectRecentTurn[];
  priorSummary?: string;
}>;

export type ReasoningAssistPreflightOutcome =
  | Readonly<{ kind: "not-eligible" }>
  | Readonly<{
      kind: "dispatch-unchanged";
      promptToken: string;
      reason: ReasoningAssistUnchangedReason;
      /** Present only for `invalid-result`: the architect stage text length. */
      stageTextLength?: number;
      /**
       * Present only for `invalid-result`: the bounded schema-validation
       * sub-reason reported by the architect parser's `no-assist` result.
       */
      parseReason?: ArchitectNoAssistReason;
      /**
       * Present only for a `stage-failed*` reason or `deadline`: the numeric
       * elapsed stage time, so a timed-out stage or expired preflight is
       * self-explaining without any failure payload.
       */
      stageElapsedMs?: number;
    }>
  | Readonly<{ kind: "stale"; promptToken: string }>
  | Readonly<{
      kind: "argument";
      graph: ClaimGraph;
      facts: ArchitectAssistFacts;
      afState: "recorded" | "not_available";
      promptToken: string;
    }>;

/**
 * Full preflight request. `publishProgress` receives the orchestrator-minted
 * prompt token alongside the stage so a live progress message and the terminal
 * cleared message always carry the same token.
 */
export type ReasoningAssistPreflightRun = ReasoningAssistPreflightInput &
  Readonly<{
    adapter: ReasoningAssistPreflightAdapter;
    structureRecorder?: ReasoningAssistStructureRecorder;
    signal?: AbortSignal;
    isCurrent: () => boolean;
    publishProgress: (stage: ReasoningAssistStage, promptToken: string) => void;
    /**
     * Called only after the architect has returned a fully validated argument
     * map. `turn-finished` preserves the valid result for the host to discard
     * explicitly without starting AF work or publishing progress.
     */
    onArgumentConfirmed?: (promptToken: string) => boolean | "turn-finished" | Promise<boolean | "turn-finished">;
    now?: () => number;
    onDiagnostic?: (event: ReasoningDiagnosticEvent) => void;
  }>;

let promptTokenCounter = 0;

function mintPromptToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  promptTokenCounter += 1;
  return `assist-${promptTokenCounter}`;
}

/**
 * The AF chain reports recorded structure only for the exact `"recorded"`
 * result; a rejection, an unsupported recorder, or any omitted fact is
 * `"not_available"`. It never rejects, so optional work cannot fail dispatch.
 */
function startAfRecording(
  recorder: ReasoningAssistStructureRecorder,
  graph: ClaimGraph,
  signal: AbortSignal,
): Promise<"recorded" | "not_available"> {
  try {
    return Promise.resolve(recorder.record(graph, signal)).then(
      (state) => (state === "recorded" ? "recorded" : "not_available"),
      () => "not_available",
    );
  } catch {
    return Promise.resolve("not_available");
  }
}

export async function runReasoningAssistPreflight(
  input: ReasoningAssistPreflightRun,
): Promise<ReasoningAssistPreflightOutcome> {
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) return { kind: "not-eligible" };
  if (typeof input.userText !== "string") return { kind: "not-eligible" };

  const promptToken = mintPromptToken();
  const now = createReasoningDiagnosticClock(input.now);
  const startedAt = now();
  let architectStartedAt: number | undefined;
  let architectReported = false;
  const report = (
    stage: ReasoningDiagnosticEvent["stage"],
    outcome: ReasoningDiagnosticOutcome,
    stageStartedAt?: number,
    details?: Pick<ReasoningDiagnosticEvent, "malformedShape" | "dependencySubreason" | "normalization">,
  ): void => {
    const elapsedMs = stageStartedAt === undefined ? undefined : elapsedReasoningMilliseconds(now, stageStartedAt);
    try {
      input.onDiagnostic?.({
        stage,
        outcome,
        ...(details ?? {}),
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
      });
    } catch {
      // Diagnostics are optional and cannot change preflight or dispatch behavior.
    }
  };
  const reportArchitect = (outcome: ReasoningDiagnosticOutcome): void => {
    if (architectReported) return;
    architectReported = true;
    report("architect", outcome, architectStartedAt);
  };
  const finish = <T extends ReasoningAssistPreflightOutcome>(outcome: T): T => {
    const label: ReasoningDiagnosticOutcome =
      outcome.kind === "dispatch-unchanged"
        ? outcome.reason
        : outcome.kind === "argument"
          ? "argument"
          : outcome.kind === "stale"
            ? "stale"
            : "not-eligible";
    report("total", label, startedAt);
    return outcome;
  };
  const invalidated = (): boolean => input.signal?.aborted === true || !input.isCurrent();
  const deadlineExceeded = (): boolean => now() - startedAt >= REASONING_ASSIST_PREFLIGHT_DEADLINE_MS;

  let context: ReasoningAssistContextMetadata | undefined;

  const discardContext = async (): Promise<void> => {
    const active = context;
    context = undefined;
    if (!active) return;
    try {
      await input.adapter.cancelReasoningAssistContext(active);
    } catch {
      // Disposal is best-effort; its failure must not change the outcome.
    }
  };

  const stale = async (): Promise<ReasoningAssistPreflightOutcome> => {
    await discardContext();
    if (architectStartedAt !== undefined) reportArchitect("stale");
    return finish({ kind: "stale", promptToken });
  };

  /**
   * One bounded dispatch-unchanged outcome. The stage text length and parse
   * sub-reason stay strictly on `invalid-result`; only a stage failure or a
   * deadline additionally carries the numeric elapsed stage time, computed as
   * `now() - startedAt` at this return point.
   */
  const unchanged = async (
    reason: ReasoningAssistUnchangedReason,
    stageTextLength?: number,
    parseReason?: ArchitectNoAssistReason,
  ): Promise<ReasoningAssistPreflightOutcome> => {
    const stageElapsedMs = reason.startsWith("stage-failed") || reason === "deadline" ? now() - startedAt : undefined;
    await discardContext();
    reportArchitect(reason);
    return finish({
      kind: "dispatch-unchanged",
      promptToken,
      reason,
      ...(stageTextLength === undefined ? {} : { stageTextLength }),
      // The parse sub-reason belongs to the invalid-result diagnostic contract
      // only; no other unchanged reason carries one.
      ...(reason === "invalid-result" && parseReason !== undefined ? { parseReason } : {}),
      ...(stageElapsedMs === undefined ? {} : { stageElapsedMs }),
    });
  };

  // Invalidation (a superseded or cancelled prompt) is stale and publishes
  // nothing. A merely elapsed deadline is not invalidation: the ordinary prompt
  // must still dispatch, so the pending assist row is always resolved. When
  // both hold, invalidation wins.
  if (invalidated()) return stale();
  if (deadlineExceeded()) return unchanged("deadline");

  const packet = buildArchitectPacket({
    userText: input.userText,
    // The packet builder requires a concrete turn array; an omitted context is
    // an empty one, never a malformed input.
    recentTurns: input.recentTurns ?? [],
    ...(input.priorSummary !== undefined ? { priorSummary: input.priorSummary } : {}),
  });
  if (packet.kind === "not-eligible") return unchanged(PACKET_UNCHANGED_REASONS[packet.reason]);

  if (invalidated()) return stale();
  if (deadlineExceeded()) return unchanged("deadline");

  architectStartedAt = now();
  try {
    context = input.signal
      ? await input.adapter.createReasoningAssistContext("architect", input.signal)
      : await input.adapter.createReasoningAssistContext("architect");
  } catch {
    if (invalidated()) return stale();
    return unchanged("stage-unavailable");
  }
  if (invalidated()) return stale();
  if (!context) return unchanged("stage-unavailable");

  if (deadlineExceeded()) return unchanged("deadline");

  let result: Awaited<ReturnType<ReasoningAssistPreflightAdapter["runReasoningAssistStage"]>>;
  try {
    result = await input.adapter.runReasoningAssistStage(context, packet.packet, "architect", input.signal);
  } catch {
    if (invalidated()) return stale();
    return unchanged("stage-failed");
  }
  if (invalidated()) return stale();
  if (!result) return unchanged("stage-failed");
  if (!result.ok) return unchanged(STAGE_FAILURE_UNCHANGED_REASONS[result.reason] ?? "stage-failed");

  if (invalidated()) return stale();
  if (deadlineExceeded()) return unchanged("deadline");

  const parseStartedAt = now();
  report("architect-result-parse", "started");
  const parseDetails = parseArchitectResultWithDetails(result.text);
  const parsed = parseDetails.result;
  report("architect-result-parse", parsed.kind === "no-assist" ? parsed.reason : "success", parseStartedAt, {
    ...(parseDetails.malformedShape ? { malformedShape: parseDetails.malformedShape } : {}),
    ...(parseDetails.dependencySubreason ? { dependencySubreason: parseDetails.dependencySubreason } : {}),
    ...(parseDetails.normalizationApplied ? { normalization: "fenced" as const } : {}),
  });
  if (parsed.kind === "ordinary") return unchanged("ordinary");
  // The only other non-argument parse result is `no-assist`; its bounded
  // diagnostic facts are the numeric stage text length and the schema
  // validation sub-reason.
  if (parsed.kind !== "argument") return unchanged("invalid-result", result.text.length, parsed.reason);

  reportArchitect("argument");

  if (input.onArgumentConfirmed) {
    let confirmation: boolean | "turn-finished" = false;
    try {
      confirmation = await input.onArgumentConfirmed(promptToken);
    } catch {
      confirmation = false;
    }
    if (invalidated()) return stale();
    if (confirmation === "turn-finished") {
      await discardContext();
      return finish({
        kind: "argument",
        graph: parsed.graph,
        facts: parsed.facts,
        afState: "not_available",
        promptToken,
      });
    }
    if (!confirmation) return unchanged("stage-unavailable");
  }

  input.publishProgress("mapping", promptToken);
  await discardContext();

  if (invalidated()) return stale();

  const recorder = input.structureRecorder;
  let afRequested = false;
  if (recorder && typeof recorder.isSupported === "function") {
    try {
      afRequested = recorder.isSupported() === true;
    } catch {
      afRequested = false;
    }
  }
  let afState: "recorded" | "not_available" = "not_available";
  let afOutcome: "recorded" | "not-recorded" | "not-requested" | "deadline" | "cancelled" = afRequested
    ? "not-recorded"
    : "not-requested";

  // Optional enrichment runs only inside the remaining preflight budget. No
  // budget means no labels and no work, and a deadline expiry during enrichment
  // omits only its facts: an elapsed deadline still returns the argument.
  const remainingBudget = REASONING_ASSIST_PREFLIGHT_DEADLINE_MS - (now() - startedAt);
  let enrichmentController: AbortController | undefined;
  if (remainingBudget > 0 && afRequested) {
    if (afRequested) input.publishProgress("recording", promptToken);

    const controller = new AbortController();
    enrichmentController = controller;
    const relayAbort = (): void => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      input.signal?.addEventListener("abort", relayAbort, { once: true });
      timer = setTimeout(() => controller.abort(), remainingBudget);

      // AF recording is the only optional enrichment in the assist path; the
      // architect remains the sole semantic classifier.
      const afStartedAt = afRequested ? now() : undefined;
      const afTask: Promise<"recorded" | "not_available"> | undefined =
        afRequested && recorder ? startAfRecording(recorder, parsed.graph, controller.signal) : undefined;
      const timedAfTask = afTask?.then((state) => {
        afState = state;
        afOutcome =
          state === "recorded"
            ? "recorded"
            : controller.signal.aborted
              ? input.signal?.aborted
                ? "cancelled"
                : "deadline"
              : "not-recorded";
        report("af", afOutcome, afStartedAt);
        return state;
      });
      const started: Array<Promise<unknown>> = [];
      if (timedAfTask) started.push(timedAfTask);
      if (started.length > 0) await Promise.allSettled(started);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      input.signal?.removeEventListener("abort", relayAbort);
    }
  } else {
    if (afRequested) afOutcome = "deadline";
  }

  if (!afRequested) report("af", "not-requested");
  else if (afOutcome === "deadline") report("af", afOutcome);

  if (invalidated()) {
    enrichmentController?.abort();
    return stale();
  }

  return finish({ kind: "argument", graph: parsed.graph, facts: parsed.facts, afState, promptToken });
}
