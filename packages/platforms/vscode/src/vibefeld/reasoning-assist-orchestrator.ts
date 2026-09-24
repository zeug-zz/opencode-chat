/**
 * Host-private reasoning-assist preflight orchestrator.
 *
 * For one eligible Scribe text prompt this module runs exactly one bounded
 * architect preflight, then optional AF structure recording and one optional
 * critic stage concurrently, and publishes ordered, prompt-scoped progress. It
 * owns no AF, critic, provider, VS Code, or webview dependency beyond the
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
  parseArchitectResult,
} from "./reasoning-assist-architect";
import { buildCriticPacket, type CriticObjection, parseCriticResult } from "./reasoning-assist-critic";
import type { ReasoningAssistStructureRecorder } from "./reasoning-assist-structure-recorder";
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
  "createReasoningAssistContext" | "runReasoningAssistStage" | "cancelReasoningAssistContext" | "supportedStages"
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
      objections: readonly CriticObjection[];
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
    now?: () => number;
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

/**
 * One self-contained critic chain: build the fixed packet from the validated
 * graph, run one restricted critic stage, and normalize at most two bounded
 * objections. A non-eligible packet, a missing context, a failed or throwing
 * stage, and a malformed or empty result all yield no objections. The critic
 * context is always disposed here and raw critic text never leaves this
 * helper.
 */
async function runCriticEnrichment(
  adapter: ReasoningAssistPreflightAdapter,
  graph: ClaimGraph,
  signal: AbortSignal,
): Promise<readonly CriticObjection[]> {
  let criticContext: ReasoningAssistContextMetadata | undefined;
  try {
    const packet = buildCriticPacket({ graph });
    if (packet.kind !== "packet") return [];

    try {
      criticContext = await adapter.createReasoningAssistContext("critic");
    } catch {
      return [];
    }
    if (!criticContext) return [];

    let result: Awaited<ReturnType<ReasoningAssistPreflightAdapter["runReasoningAssistStage"]>>;
    try {
      result = await adapter.runReasoningAssistStage(criticContext, packet.packet, "critic", signal);
    } catch {
      return [];
    }
    if (!result?.ok) return [];

    const criticResult = parseCriticResult(result.text, packet.targets);
    return criticResult.kind === "objections" ? criticResult.objections : [];
  } catch {
    return [];
  } finally {
    if (criticContext) {
      try {
        await adapter.cancelReasoningAssistContext(criticContext);
      } catch {
        // Disposal is best-effort; its failure must not change the outcome.
      }
    }
  }
}

export async function runReasoningAssistPreflight(
  input: ReasoningAssistPreflightRun,
): Promise<ReasoningAssistPreflightOutcome> {
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) return { kind: "not-eligible" };
  if (typeof input.userText !== "string") return { kind: "not-eligible" };

  const promptToken = mintPromptToken();
  const now = input.now ?? Date.now;
  const startedAt = now();
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
    return { kind: "stale", promptToken };
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
    return {
      kind: "dispatch-unchanged",
      promptToken,
      reason,
      ...(stageTextLength === undefined ? {} : { stageTextLength }),
      // The parse sub-reason belongs to the invalid-result diagnostic contract
      // only; no other unchanged reason carries one.
      ...(reason === "invalid-result" && parseReason !== undefined ? { parseReason } : {}),
      ...(stageElapsedMs === undefined ? {} : { stageElapsedMs }),
    };
  };

  // Invalidation (a superseded or cancelled prompt) is stale and publishes
  // nothing. A merely elapsed deadline is not invalidation: the ordinary prompt
  // must still dispatch, so the pending assist row is always resolved. When
  // both hold, invalidation wins.
  if (invalidated()) return stale();
  if (deadlineExceeded()) return unchanged("deadline");

  input.publishProgress("assessing", promptToken);

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

  try {
    context = await input.adapter.createReasoningAssistContext("architect");
  } catch {
    return unchanged("stage-unavailable");
  }
  if (!context) return unchanged("stage-unavailable");

  if (invalidated()) return stale();
  if (deadlineExceeded()) return unchanged("deadline");

  let result: Awaited<ReturnType<ReasoningAssistPreflightAdapter["runReasoningAssistStage"]>>;
  try {
    result = await input.adapter.runReasoningAssistStage(context, packet.packet, "architect", input.signal);
  } catch {
    return unchanged("stage-failed");
  }
  if (!result) return unchanged("stage-failed");
  if (!result.ok) return unchanged(STAGE_FAILURE_UNCHANGED_REASONS[result.reason]);

  if (invalidated()) return stale();
  if (deadlineExceeded()) return unchanged("deadline");

  const parsed = parseArchitectResult(result.text);
  if (parsed.kind === "ordinary") return unchanged("ordinary");
  // The only other non-argument parse result is `no-assist`; its bounded
  // diagnostic facts are the numeric stage text length and the schema
  // validation sub-reason.
  if (parsed.kind !== "argument") return unchanged("invalid-result", result.text.length, parsed.reason);

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
  const criticRequested =
    Array.isArray(input.adapter.supportedStages) && input.adapter.supportedStages.includes("critic");

  let afState: "recorded" | "not_available" = "not_available";
  let objections: readonly CriticObjection[] = [];

  // Optional enrichment runs only inside the remaining preflight budget. No
  // budget means no labels and no work, and a deadline expiry during enrichment
  // omits only its facts: an elapsed deadline still returns the argument.
  const remainingBudget = REASONING_ASSIST_PREFLIGHT_DEADLINE_MS - (now() - startedAt);
  let enrichmentController: AbortController | undefined;
  if (remainingBudget > 0 && (afRequested || criticRequested)) {
    if (afRequested) input.publishProgress("recording", promptToken);
    if (criticRequested) input.publishProgress("critiquing", promptToken);

    const controller = new AbortController();
    enrichmentController = controller;
    const relayAbort = (): void => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      input.signal?.addEventListener("abort", relayAbort, { once: true });
      timer = setTimeout(() => controller.abort(), remainingBudget);

      // Both optional chains start before either is awaited so AF recording and
      // the restricted critic share the remaining budget concurrently.
      const afTask: Promise<"recorded" | "not_available"> | undefined =
        afRequested && recorder ? startAfRecording(recorder, parsed.graph, controller.signal) : undefined;
      const criticTask: Promise<readonly CriticObjection[]> | undefined = criticRequested
        ? runCriticEnrichment(input.adapter, parsed.graph, controller.signal)
        : undefined;
      const started: Array<Promise<unknown>> = [];
      if (afTask) started.push(afTask);
      if (criticTask) started.push(criticTask);
      if (started.length > 0) await Promise.allSettled(started);
      if (afTask) afState = await afTask;
      if (criticTask) objections = await criticTask;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      input.signal?.removeEventListener("abort", relayAbort);
    }
  }

  if (invalidated()) {
    enrichmentController?.abort();
    return stale();
  }

  return { kind: "argument", graph: parsed.graph, facts: parsed.facts, afState, objections, promptToken };
}
