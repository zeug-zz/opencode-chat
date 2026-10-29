import type { OpenCodeClient } from "@opencode/client";
import type { OpenCodeRestrictedReviewConfiguration } from "./launch-config";
import {
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
} from "./restricted-review-overlay";

const MAX_PACKET_TEXT_LENGTH = 16_384;
const MAX_SESSION_ID_LENGTH = 512;
export const MAX_RESTRICTED_REVIEW_TEXT_LENGTH = 8_192;
export const MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS = 35_000;
const RESTRICTED_REVIEW_POLL_INTERVAL_MS = 50;
const FAILURE_MESSAGE = "Restricted review is unavailable.";
const INSTRUCTION_KEY = "scribe.restricted-review-role";

export type RestrictedReviewModel = {
  providerID: string;
  modelID: string;
};

export type RestrictedReviewProviderResolution =
  | Readonly<{ ok: true; provider: RestrictedReviewProvider }>
  | Readonly<{
      ok: false;
      reason:
        | "model-unavailable"
        | "model-invalid"
        | "model-resolution-failed"
        | "connection-changed"
        | "provider-unavailable";
    }>;

export type RestrictedReviewFailure = {
  ok: false;
  code: "sdk-error" | "timeout" | "invalid-response";
  message: string;
};

export type RestrictedReviewOperationResult = { ok: true } | RestrictedReviewFailure;

export type RestrictedReviewSessionResult = { ok: true; sessionId: string } | RestrictedReviewFailure;

export type RestrictedReviewTextResult = { ok: true; text: string } | RestrictedReviewFailure;

export type RestrictedReviewObservationStage =
  | "architect-instructions"
  | "architect-generate"
  | "architect-native-error"
  | "architect-response"
  | "review-readiness";

export type RestrictedReviewObservationOutcome =
  | "started"
  | "completed"
  | "timeout"
  | "cancelled"
  | "failed"
  | "success"
  | "failure"
  | "ready"
  | "not-current"
  | "request-timeout"
  | "request-cancelled"
  | "request-failed-location-not-found"
  | "request-failed-agent-not-found"
  | "request-failed-unauthorized"
  | "request-failed-service-unavailable"
  | "request-failed-other"
  | "location-mismatch"
  | "model-mismatch"
  | "agent-mismatch-shape"
  | "agent-mismatch-id"
  | "agent-mismatch-model"
  | "agent-mismatch-system"
  | "agent-mismatch-steps"
  | "agent-mismatch-mode"
  | "agent-mismatch-hidden"
  | "agent-mismatch-permissions"
  | "agent-mismatch-tools"
  | "generation-stale"
  | "native-invalid-request"
  | "native-authentication"
  | "native-service-unavailable"
  | "native-location-not-found"
  | "native-agent-not-found"
  | "native-session-not-found"
  | "native-provider-not-found"
  | "native-context-limit"
  | "native-other"
  | "client-transport"
  | "client-protocol"
  | "client-unexpected-status"
  | "client-unexpected-status-4xx"
  | "client-unexpected-status-5xx"
  | "client-other"
  | "other";

export type RestrictedReviewObservation = Readonly<{
  stage: RestrictedReviewObservationStage;
  outcome: RestrictedReviewObservationOutcome;
  elapsedMs?: number;
}>;

export type RestrictedReviewObserver = (observation: RestrictedReviewObservation) => void;

type RestrictedReviewSdkClient = Pick<OpenCodeClient, "agent" | "session" | "message">;

export type RestrictedReviewRole = "prover" | "verifier" | "architect" | "critic";

export type RestrictedReviewProvenance = Readonly<{
  identity: string;
  handle: string;
  role: RestrictedReviewRole;
  contextNumber: 1 | 2;
}>;

export type RestrictedReviewGeneration = unknown;
export type RestrictedReviewToken = number;

export type CreateRestrictedReviewProviderOptions = {
  client: RestrictedReviewSdkClient;
  restrictedReview: OpenCodeRestrictedReviewConfiguration;
  directory: string;
  /** Resolved by the host; never read from a packet, request, or child result. */
  hostPinnedModel: RestrictedReviewModel;
  /** Opaque generation of the host-composed overlay/server connection. */
  generation?: RestrictedReviewGeneration;
  /** Returns the generation currently owned by the host. */
  currentGeneration?: () => RestrictedReviewGeneration;
  /** Best-effort, label-only telemetry; callback and clock failures are ignored. */
  observe?: RestrictedReviewObserver;
  /** Monotonic clock used only by optional observations. */
  now?: () => number;
};

export type RestrictedReviewProvider = {
  createSession(title: string): Promise<RestrictedReviewSessionResult>;
  promptStage(
    sessionId: string,
    packetText: string,
    role: RestrictedReviewRole,
  ): Promise<RestrictedReviewOperationResult>;
  retrieveStageText(sessionId: string, timeoutMs: number): Promise<RestrictedReviewTextResult>;
  runStage(
    sessionId: string,
    packetText: string,
    timeoutMs: number,
    role: RestrictedReviewRole,
    signal?: AbortSignal,
  ): Promise<RestrictedReviewTextResult>;
  beginReview(): Promise<RestrictedReviewToken>;
  cancelReview(token: RestrictedReviewToken): Promise<RestrictedReviewOperationResult>;
  isReviewCurrent(token: RestrictedReviewToken): boolean;
  cancel(sessionId: string): Promise<RestrictedReviewOperationResult>;
  delete(sessionId: string): Promise<RestrictedReviewOperationResult>;
  checkReadiness(): Promise<boolean>;
  isReady(): boolean;
  invalidate(): void;
};

const PROVENANCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const RESTRICTED_REVIEW_CONTEXT_NUMBERS: Readonly<Record<RestrictedReviewRole, 1 | 2>> = Object.freeze({
  prover: 1,
  verifier: 2,
  architect: 1,
  critic: 2,
});
// The instruction is a function of the host-owned role only: no packet, caller,
// or model channel may supply or override it.
const RESTRICTED_REVIEW_STAGE_INSTRUCTIONS: Readonly<Record<RestrictedReviewRole, string>> = Object.freeze({
  prover: RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
  verifier: RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
  architect: RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
  critic: RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION,
});

function randomToken(): string {
  const tokenLength = 24;
  const values = new Uint32Array(tokenLength);
  const cryptoSource = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: (values: Uint32Array) => Uint32Array };
    }
  ).crypto;
  if (cryptoSource?.getRandomValues) cryptoSource.getRandomValues(values);
  else for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 2 ** 32);
  return [...values].map((value) => PROVENANCE_ALPHABET[value % PROVENANCE_ALPHABET.length]).join("");
}

export function mintRestrictedReviewProvenance(role: RestrictedReviewRole): RestrictedReviewProvenance {
  const contextNumber = RESTRICTED_REVIEW_CONTEXT_NUMBERS[role];
  const token = randomToken();
  return Object.freeze({
    identity: `${role}-${token}`,
    handle: `${role}-${token}`,
    role,
    contextNumber,
  });
}

function failure(code: RestrictedReviewFailure["code"]): RestrictedReviewFailure {
  return { ok: false, code, message: FAILURE_MESSAGE };
}

function buildDeniedTools(dynamicToolNames: readonly string[] | undefined): Record<string, false> {
  const names = new Set<string>(["*", ...RESTRICTED_REVIEW_AUTHORITIES, ...(dynamicToolNames ?? [])]);
  return Object.fromEntries([...names].map((name) => [name, false]));
}

function nativeModel(model: RestrictedReviewModel) {
  return { providerID: model.providerID, id: model.modelID };
}

function nativeSessionModelMatches(value: unknown, model: RestrictedReviewModel): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as { providerID?: unknown; id?: unknown; variant?: unknown };
  return (
    identity.providerID === model.providerID &&
    identity.id === model.modelID &&
    (identity.variant === undefined || identity.variant === "default")
  );
}

function configuredModelMatches(value: unknown, configured: string): boolean {
  if (!value || typeof value !== "object") return false;
  const model = value as { providerID?: unknown; id?: unknown; variant?: unknown };
  return (
    typeof model.providerID === "string" &&
    typeof model.id === "string" &&
    model.variant === undefined &&
    `${model.providerID}/${model.id}` === configured
  );
}

type RestrictedAgentMismatchField =
  | "shape"
  | "id"
  | "model"
  | "system"
  | "steps"
  | "mode"
  | "hidden"
  | "permissions"
  | "tools";

function hasExpectedRestrictedAgent(
  value: unknown,
  restrictedReview: OpenCodeRestrictedReviewConfiguration,
  expectedTools: Record<string, false>,
): RestrictedAgentMismatchField | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "shape";
  const agent = (value as { data?: unknown }).data;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return "shape";
  const entry = agent as {
    id?: unknown;
    model?: unknown;
    system?: unknown;
    steps?: unknown;
    mode?: unknown;
    hidden?: unknown;
    permissions?: unknown;
  };
  const expectedModelMatches =
    restrictedReview.modelResolution === "native-default"
      ? entry.model === undefined && restrictedReview.model === undefined
      : typeof restrictedReview.model === "string" && configuredModelMatches(entry.model, restrictedReview.model);
  if (entry.id !== RESTRICTED_REVIEW_AGENT_NAME) return "id";
  if (!expectedModelMatches) return "model";
  if (entry.system !== restrictedReview.prompt) return "system";
  if (entry.steps !== restrictedReview.maxSteps) return "steps";
  if (entry.mode !== "subagent") return "mode";
  if (entry.hidden !== true) return "hidden";
  if (!Array.isArray(entry.permissions)) return "permissions";
  const permissions = entry.permissions;
  if (
    permissions.some(
      (rule) =>
        !rule || typeof rule !== "object" || Array.isArray(rule) || Object.getPrototypeOf(rule) !== Object.prototype,
    )
  ) {
    return "permissions";
  }
  const records = permissions as Array<Record<string, unknown>>;
  if (
    records.some(
      (rule) =>
        typeof rule.action !== "string" ||
        rule.action.length === 0 ||
        typeof rule.resource !== "string" ||
        rule.resource.length === 0 ||
        !["allow", "ask", "deny"].includes(String(rule.effect)),
    )
  )
    return "permissions";
  let wildcardDenyIndex = -1;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const rule = records[index];
    if (rule?.action === "*" && rule.resource === "*" && rule.effect === "deny") {
      wildcardDenyIndex = index;
      break;
    }
  }
  if (wildcardDenyIndex < 0 || records.slice(wildcardDenyIndex).some((rule) => rule.effect !== "deny"))
    return "permissions";
  const effectiveDenyRules = records.slice(wildcardDenyIndex);
  return Object.keys(expectedTools).every((action) =>
    effectiveDenyRules.some((rule) => rule.action === action && rule.resource === "*" && rule.effect === "deny"),
  )
    ? undefined
    : "tools";
}

const AGENT_MISMATCH_OUTCOMES: Readonly<Record<RestrictedAgentMismatchField, RestrictedReviewObservationOutcome>> =
  Object.freeze({
    shape: "agent-mismatch-shape",
    id: "agent-mismatch-id",
    model: "agent-mismatch-model",
    system: "agent-mismatch-system",
    steps: "agent-mismatch-steps",
    mode: "agent-mismatch-mode",
    hidden: "agent-mismatch-hidden",
    permissions: "agent-mismatch-permissions",
    tools: "agent-mismatch-tools",
  });

function boundedPacketText(packetText: string): string {
  return packetText.slice(0, MAX_PACKET_TEXT_LENGTH);
}

type StageReplyCandidate = Readonly<{ text: string; complete: boolean }>;

/** Skip control records but never fall back past the newest assistant snapshot. */
function lastStageReplyCandidate(
  value: unknown,
  boundary: string | undefined,
  model: RestrictedReviewModel,
): StageReplyCandidate | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const record = value.find(
    (item) => item && typeof item === "object" && (item as { type?: unknown }).type === "assistant",
  ) as {
    id?: unknown;
    type?: unknown;
    agent?: unknown;
    model?: unknown;
    content?: unknown;
    time?: unknown;
    finish?: unknown;
    error?: unknown;
  };
  if (!record || !validMessageID(record.id) || record.id === boundary) return undefined;
  if (record.agent !== RESTRICTED_REVIEW_AGENT_NAME || !nativeSessionModelMatches(record.model, model) || record.error)
    return undefined;
  if (
    !record.time ||
    typeof record.time !== "object" ||
    typeof (record.time as { completed?: unknown }).completed !== "number" ||
    !Number.isFinite((record.time as { completed: number }).completed)
  )
    return undefined;
  if (record.finish !== "stop" || !Array.isArray(record.content)) return undefined;
  if (
    record.content.length === 0 ||
    record.content.some(
      (part) =>
        !part ||
        typeof part !== "object" ||
        !["text", "reasoning"].includes(String((part as { type?: unknown }).type)) ||
        typeof (part as { text?: unknown }).text !== "string",
    )
  )
    return undefined;
  const text = record.content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      ),
    )
    .map((part) => part.text)
    .join("\n")
    .slice(0, MAX_RESTRICTED_REVIEW_TEXT_LENGTH);
  if (!record.content.some((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text"))
    return undefined;
  return { text, complete: true };
}

function validSessionID(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SESSION_ID_LENGTH && /^ses_[A-Za-z0-9_-]{1,507}$/.test(value);
}

function validMessageID(value: unknown): value is string {
  return typeof value === "string" && /^msg_[A-Za-z0-9_-]{1,507}$/.test(value);
}

function validPromptAdmission(value: unknown, sessionID: string, text: string): boolean {
  if (!value || typeof value !== "object") return false;
  const admission = value as { id?: unknown; sessionID?: unknown; type?: unknown; payload?: unknown };
  return (
    typeof admission.id === "string" &&
    admission.id.length > 0 &&
    admission.id.length <= MAX_SESSION_ID_LENGTH &&
    admission.sessionID === sessionID &&
    admission.type === "user" &&
    Boolean(
      admission.payload &&
        typeof admission.payload === "object" &&
        (admission.payload as { text?: unknown }).text === text,
    )
  );
}

function generatedText(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "text")) return undefined;
  return typeof record.text === "string" && record.text.length > 0 ? record.text : undefined;
}

async function boundedAwait<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timerHost = globalThis as unknown as {
    setTimeout(callback: () => void, delay: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  let timer: unknown;
  let abortHandler: (() => void) | undefined;
  try {
    const races: Promise<T>[] = [
      operation,
      new Promise<T>((_, reject) => {
        timer = timerHost.setTimeout(
          () => reject(Object.assign(new Error("Restricted review stage timed out."), { name: "TimeoutError" })),
          timeoutMs,
        );
      }),
    ];
    if (signal) {
      races.push(
        new Promise<T>((_, reject) => {
          abortHandler = () => reject(signal.reason ?? new Error("Restricted review stage cancelled."));
          if (signal.aborted) abortHandler();
          else signal.addEventListener("abort", abortHandler, { once: true });
        }),
      );
    }
    return await Promise.race(races);
  } finally {
    if (timer !== undefined) timerHost.clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function boundedTimeout(timeoutMs: number): number {
  return Math.min(Math.max(0, timeoutMs), MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS);
}

function createObservationClock(clock?: () => number): () => number {
  let last: number | undefined;
  return () => {
    let value: number | undefined;
    try {
      value = clock ? clock() : globalThis.performance?.now();
    } catch {
      value = undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      try {
        value = Date.now();
      } catch {
        value = last ?? 0;
      }
    }
    if (!Number.isFinite(value) || value < 0) value = last ?? 0;
    if (last !== undefined && value < last) value = last;
    last = value;
    return value;
  };
}

function operationObservationOutcome(error: unknown, signal: AbortSignal): "timeout" | "cancelled" | "failed" {
  let name: unknown;
  try {
    if (signal.aborted && signal.reason && typeof signal.reason === "object" && "name" in signal.reason) {
      name = signal.reason.name;
    } else if (error && typeof error === "object" && "name" in error) {
      name = error.name;
    }
  } catch {
    // Error objects and injected signals are never diagnostic data.
  }
  if (name === "TimeoutError") return "timeout";
  if (signal.aborted || name === "AbortError") return "cancelled";
  return "failed";
}

type ArchitectNativeErrorOutcome = Extract<
  RestrictedReviewObservationOutcome,
  | "native-invalid-request"
  | "native-authentication"
  | "native-service-unavailable"
  | "native-location-not-found"
  | "native-agent-not-found"
  | "native-session-not-found"
  | "native-provider-not-found"
  | "native-context-limit"
  | "native-other"
  | "client-transport"
  | "client-protocol"
  | "client-unexpected-status"
  | "client-unexpected-status-4xx"
  | "client-unexpected-status-5xx"
  | "client-other"
  | "other"
>;

const NATIVE_ERROR_OUTCOMES: ReadonlyMap<string, ArchitectNativeErrorOutcome> = new Map([
  ["InvalidRequestError", "native-invalid-request"],
  ["UnauthorizedError", "native-authentication"],
  ["ServiceUnavailableError", "native-service-unavailable"],
  ["LocationNotFoundError", "native-location-not-found"],
  ["AgentNotFoundError", "native-agent-not-found"],
  ["SessionNotFoundError", "native-session-not-found"],
  ["ProviderNotFoundError", "native-provider-not-found"],
  ["InstructionEntryValueTooLargeError", "native-context-limit"],
]);

const CLIENT_ERROR_OUTCOMES: ReadonlyMap<string, ArchitectNativeErrorOutcome> = new Map([
  ["Transport", "client-transport"],
  ["UnexpectedStatus", "client-unexpected-status"],
  ["UnsupportedContentType", "client-protocol"],
  ["MalformedResponse", "client-protocol"],
  ["SseEventTooLarge", "client-protocol"],
]);

/** Read only own data fields so injected errors cannot run diagnostic getters. */
function ownErrorData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classify only the installed Promise client's declared wrappers and native
 * error tags. Its `cause` is the only traversed wrapper link; arbitrary fields,
 * response bodies, status metadata, and messages are never inspected.
 */
function architectNativeErrorOutcome(error: unknown): ArchitectNativeErrorOutcome {
  const visited = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) break;
    visited.add(current);

    const nativeTag = ownErrorData(current, "_tag");
    if (typeof nativeTag === "string") return NATIVE_ERROR_OUTCOMES.get(nativeTag) ?? "native-other";

    const name = ownErrorData(current, "name");
    const reason = ownErrorData(current, "reason");
    if (name === "ClientError") {
      if (reason === "UnexpectedStatus") {
        const status = ownErrorData(ownErrorData(current, "cause"), "status");
        if (Number.isInteger(status) && typeof status === "number" && status >= 400 && status <= 499) {
          return "client-unexpected-status-4xx";
        }
        if (Number.isInteger(status) && typeof status === "number" && status >= 500 && status <= 599) {
          return "client-unexpected-status-5xx";
        }
      }
      return (typeof reason === "string" ? CLIENT_ERROR_OUTCOMES.get(reason) : undefined) ?? "client-other";
    }
    if (typeof name === "string") {
      const nativeNameOutcome = NATIVE_ERROR_OUTCOMES.get(name);
      if (nativeNameOutcome !== undefined) return nativeNameOutcome;
    }

    const cause = ownErrorData(current, "cause");
    if (cause === undefined) break;
    current = cause;
  }
  return "other";
}

type ReadinessFailureClass =
  | "location-not-found"
  | "agent-not-found"
  | "unauthorized"
  | "service-unavailable"
  | "other";

const READINESS_ERROR_CLASSES: Readonly<Record<string, ReadinessFailureClass>> = Object.freeze({
  LocationNotFound: "location-not-found",
  LocationNotFoundError: "location-not-found",
  "location-not-found": "location-not-found",
  AgentNotFound: "agent-not-found",
  AgentNotFoundError: "agent-not-found",
  NotFound: "agent-not-found",
  NotFoundError: "agent-not-found",
  "agent-not-found": "agent-not-found",
  Unauthorized: "unauthorized",
  UnauthorizedError: "unauthorized",
  AuthenticationError: "unauthorized",
  unauthorized: "unauthorized",
  ServiceUnavailable: "service-unavailable",
  ServiceUnavailableError: "service-unavailable",
  "service-unavailable": "service-unavailable",
});

function errorStringField(error: unknown, field: "_tag" | "name"): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  try {
    const value = (error as Record<string, unknown>)[field];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function readinessFailureClass(error: unknown): ReadinessFailureClass {
  for (const tag of [errorStringField(error, "_tag"), errorStringField(error, "name")]) {
    if (tag !== undefined && Object.hasOwn(READINESS_ERROR_CLASSES, tag))
      return READINESS_ERROR_CLASSES[tag] ?? "other";
  }
  return "other";
}

function readinessRequestFailureOutcome(
  error: unknown,
  controller: AbortController,
  timeoutSignal: AbortSignal,
  requestSignal: AbortSignal,
): RestrictedReviewObservationOutcome {
  const errorName = errorStringField(error, "name");
  const errorTag = errorStringField(error, "_tag");
  const abortName = errorStringField(requestSignal.reason, "name");
  if (
    timeoutSignal.aborted ||
    errorName === "TimeoutError" ||
    errorTag === "TimeoutError" ||
    abortName === "TimeoutError"
  )
    return "request-timeout";
  if (
    controller.signal.aborted ||
    errorName === "AbortError" ||
    errorTag === "AbortError" ||
    abortName === "AbortError"
  )
    return "request-cancelled";
  const failureOutcomes: Readonly<Record<ReadinessFailureClass, RestrictedReviewObservationOutcome>> = {
    "location-not-found": "request-failed-location-not-found",
    "agent-not-found": "request-failed-agent-not-found",
    unauthorized: "request-failed-unauthorized",
    "service-unavailable": "request-failed-service-unavailable",
    other: "request-failed-other",
  };
  return failureOutcomes[readinessFailureClass(error)];
}

function waitForPollInterval(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timerHost = globalThis as unknown as { setTimeout(callback: () => void, delay: number): unknown };
    timerHost.setTimeout(resolve, timeoutMs);
  });
}

export function createRestrictedReviewProvider({
  client,
  restrictedReview,
  directory,
  hostPinnedModel,
  generation,
  currentGeneration = () => generation,
  observe,
  now,
}: CreateRestrictedReviewProviderOptions): RestrictedReviewProvider {
  const tools = buildDeniedTools(restrictedReview.dynamicToolNames);
  const recordedGeneration = generation;
  let invalidated = false;
  let ready = false;
  let nextReviewToken = 0;
  let currentReviewToken: RestrictedReviewToken | undefined;
  let cleanup: Promise<RestrictedReviewOperationResult> = Promise.resolve({ ok: true });
  const sessionsByReview = new Map<RestrictedReviewToken, Set<string>>();
  const ownedSessions = new Map<string, RestrictedReviewToken>();
  const reviewControllers = new Map<RestrictedReviewToken, AbortController>();
  const sessionControllers = new Map<string, AbortController>();
  const cancellationBySession = new Map<string, Promise<RestrictedReviewOperationResult>>();
  const deletionBySession = new Map<string, Promise<RestrictedReviewOperationResult>>();
  const readinessControllers = new Set<AbortController>();
  const pendingCreates = new Map<RestrictedReviewToken, Set<Promise<unknown>>>();
  const cleanupByReview = new Map<RestrictedReviewToken, Promise<RestrictedReviewOperationResult>>();
  const failedCleanupSessions = new Set<string>();
  const boundaries = new Map<string, string | undefined>();
  const admittedBoundaries = new Map<string, string | undefined>();
  const observationNow = createObservationClock(now);
  const reportObservation = (
    stage: RestrictedReviewObservationStage,
    outcome: RestrictedReviewObservationOutcome,
    startedAt?: number,
  ): void => {
    if (!observe) return;
    try {
      const elapsedMs = startedAt === undefined ? undefined : Math.max(0, observationNow() - startedAt);
      observe({ stage, outcome, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
    } catch {
      // Optional diagnostics never alter native operations or their outcomes.
    }
  };
  const startObservation = (stage: RestrictedReviewObservationStage): number | undefined => {
    if (!observe) return undefined;
    const startedAt = observationNow();
    reportObservation(stage, "started");
    return startedAt;
  };
  const isCurrent = () => !invalidated && Object.is(recordedGeneration, currentGeneration());
  const assertCurrent = () => {
    if (isCurrent()) return true;
    ready = false;
    for (const controller of reviewControllers.values()) controller.abort();
    for (const controller of sessionControllers.values()) controller.abort();
    for (const controller of readinessControllers) controller.abort();
    return false;
  };
  // Controller lifecycle cancellation and adapter context disposal can race.
  // Share each native operation until its review lifecycle is finalized so a
  // second cleanup path cannot turn an already-removed child into a failure.
  const cancelOwnedSession = (sessionId: string): Promise<RestrictedReviewOperationResult> => {
    const existing = cancellationBySession.get(sessionId);
    if (existing) return existing;
    if (!ownedSessions.has(sessionId)) return Promise.resolve(failure("invalid-response"));
    const operation = (async (): Promise<RestrictedReviewOperationResult> => {
      try {
        sessionControllers.get(sessionId)?.abort();
        await client.session.interrupt({ sessionID: sessionId }, { signal: AbortSignal.timeout(5_000) });
        return { ok: true };
      } catch {
        return failure("sdk-error");
      }
    })();
    cancellationBySession.set(sessionId, operation);
    return operation;
  };
  const deleteOwnedSession = (sessionId: string): Promise<RestrictedReviewOperationResult> => {
    const existing = deletionBySession.get(sessionId);
    if (existing) return existing;
    if (!ownedSessions.has(sessionId)) return Promise.resolve(failure("invalid-response"));
    const operation = (async (): Promise<RestrictedReviewOperationResult> => {
      try {
        sessionControllers.get(sessionId)?.abort();
        await client.session.remove({ sessionID: sessionId }, { signal: AbortSignal.timeout(5_000) });
        ownedSessions.delete(sessionId);
        sessionControllers.delete(sessionId);
        boundaries.delete(sessionId);
        admittedBoundaries.delete(sessionId);
        failedCleanupSessions.delete(sessionId);
        return { ok: true };
      } catch {
        return failure("sdk-error");
      }
    })();
    deletionBySession.set(sessionId, operation);
    return operation;
  };
  const requestSignal = (timeout = 35_000, sessionID?: string, operationSignal?: AbortSignal) => {
    const reviewSignal =
      currentReviewToken === undefined ? undefined : reviewControllers.get(currentReviewToken)?.signal;
    const sessionSignal = sessionID ? sessionControllers.get(sessionID)?.signal : undefined;
    return AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(reviewSignal ? [reviewSignal] : []),
      ...(sessionSignal ? [sessionSignal] : []),
      ...(operationSignal ? [operationSignal] : []),
    ]);
  };

  const generateArchitectStage = async (
    sessionId: string,
    packetText: string,
    timeoutMs: number,
    operationSignal?: AbortSignal,
  ): Promise<RestrictedReviewTextResult> => {
    const deadline = boundedTimeout(timeoutMs);
    if (!Number.isFinite(timeoutMs) || deadline <= 0) return failure("timeout");
    if (!assertCurrent() || ownedSessions.get(sessionId) !== currentReviewToken || currentReviewToken === undefined)
      return failure("invalid-response");

    const token = currentReviewToken;
    const signal = requestSignal(deadline, sessionId, operationSignal);
    const abortedFailure = () =>
      signal.reason instanceof Error && signal.reason.name === "TimeoutError"
        ? failure("timeout")
        : failure("invalid-response");
    try {
      const instructionStartedAt = startObservation("architect-instructions");
      try {
        await boundedAwait(
          client.session.instructions.entry.put(
            {
              sessionID: sessionId,
              key: INSTRUCTION_KEY,
              value: RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
            },
            { signal },
          ),
          deadline,
          signal,
        );
        reportObservation("architect-instructions", "completed", instructionStartedAt);
      } catch (error) {
        const outcome = operationObservationOutcome(error, signal);
        reportObservation("architect-instructions", outcome, instructionStartedAt);
        if (observe && outcome === "failed") {
          reportObservation("architect-native-error", architectNativeErrorOutcome(error));
        }
        throw error;
      }
      if (!assertCurrent() || token !== currentReviewToken || ownedSessions.get(sessionId) !== token)
        return failure("invalid-response");
      if (signal.aborted) return abortedFailure();

      const generateStartedAt = startObservation("architect-generate");
      let response: unknown;
      try {
        response = await boundedAwait(
          client.session.generate({ sessionID: sessionId, prompt: boundedPacketText(packetText) }, { signal }),
          deadline,
          signal,
        );
        reportObservation("architect-generate", "completed", generateStartedAt);
      } catch (error) {
        const outcome = operationObservationOutcome(error, signal);
        reportObservation("architect-generate", outcome, generateStartedAt);
        if (observe && outcome === "failed") {
          reportObservation("architect-native-error", architectNativeErrorOutcome(error));
        }
        throw error;
      }
      if (!assertCurrent() || token !== currentReviewToken || ownedSessions.get(sessionId) !== token)
        return failure("invalid-response");
      if (signal.aborted) return abortedFailure();

      const validationStartedAt = startObservation("architect-response");
      const text = generatedText(response);
      if (text === undefined || text.length > MAX_RESTRICTED_REVIEW_TEXT_LENGTH) {
        reportObservation("architect-response", "failure", validationStartedAt);
        return failure("invalid-response");
      }
      reportObservation("architect-response", "success", validationStartedAt);
      return { ok: true, text };
    } catch (error) {
      if (!assertCurrent() || token !== currentReviewToken || ownedSessions.get(sessionId) !== token)
        return failure("invalid-response");
      if (signal.aborted) return abortedFailure();
      const reason = ownErrorData(error, "name");
      return failure(reason === "TimeoutError" ? "timeout" : "sdk-error");
    }
  };

  return {
    async createSession(title) {
      if (!assertCurrent()) return failure("invalid-response");
      const token = currentReviewToken;
      if (token === undefined) return failure("invalid-response");
      const signal = requestSignal();
      const operation = (async (): Promise<RestrictedReviewSessionResult> => {
        try {
          const response = await client.session.create(
            {
              title,
              agent: RESTRICTED_REVIEW_AGENT_NAME,
              model: nativeModel(hostPinnedModel),
              location: { directory },
              permissions: Object.keys(tools).map((action) => ({ action, resource: "*", effect: "deny" as const })),
            },
            { signal },
          );
          const sessionId = response.id;
          // Never mutate an ID returned with an invalid identity or placement.
          if (
            !validSessionID(sessionId) ||
            response.agent !== RESTRICTED_REVIEW_AGENT_NAME ||
            !nativeSessionModelMatches(response.model, hostPinnedModel) ||
            response.location.directory !== directory
          )
            return failure("invalid-response");
          ownedSessions.set(sessionId, token);
          sessionControllers.set(sessionId, new AbortController());
          sessionsByReview.get(token)?.add(sessionId);
          if (!assertCurrent() || token !== currentReviewToken || signal.aborted) {
            let interruptFailed = false;
            try {
              await client.session.interrupt({ sessionID: sessionId }, { signal: AbortSignal.timeout(5_000) });
            } catch {
              interruptFailed = true;
            }
            try {
              await client.session.remove({ sessionID: sessionId }, { signal: AbortSignal.timeout(5_000) });
            } catch {
              failedCleanupSessions.add(sessionId);
              return failure("sdk-error");
            }
            ownedSessions.delete(sessionId);
            sessionControllers.delete(sessionId);
            boundaries.delete(sessionId);
            admittedBoundaries.delete(sessionId);
            sessionsByReview.get(token)?.delete(sessionId);
            return interruptFailed ? failure("sdk-error") : failure("invalid-response");
          }
          return { ok: true, sessionId };
        } catch (error) {
          if (!assertCurrent() || token !== currentReviewToken) return failure("invalid-response");
          const reason = error && typeof error === "object" && "name" in error ? error.name : undefined;
          return failure(reason === "TimeoutError" ? "timeout" : "sdk-error");
        }
      })();
      const pending = pendingCreates.get(token) ?? new Set<Promise<unknown>>();
      pending.add(operation);
      pendingCreates.set(token, pending);
      try {
        return await operation;
      } finally {
        pending.delete(operation);
      }
    },

    async promptStage(sessionId, packetText, role) {
      admittedBoundaries.delete(sessionId);
      if (!assertCurrent() || ownedSessions.get(sessionId) !== currentReviewToken || currentReviewToken === undefined)
        return failure("invalid-response");
      const instruction = RESTRICTED_REVIEW_STAGE_INSTRUCTIONS[role];
      if (typeof instruction !== "string") return failure("invalid-response");
      try {
        const token = currentReviewToken;
        const signal = requestSignal(35_000, sessionId);
        await client.session.wait({ sessionID: sessionId }, { signal });
        if (
          !assertCurrent() ||
          token !== currentReviewToken ||
          ownedSessions.get(sessionId) !== token ||
          signal.aborted
        )
          return failure("invalid-response");
        const before = await client.message.list({ sessionID: sessionId, order: "desc", limit: 20 }, { signal });
        if (
          !assertCurrent() ||
          token !== currentReviewToken ||
          ownedSessions.get(sessionId) !== token ||
          signal.aborted
        )
          return failure("invalid-response");
        const previousAssistant = before.data.find((message) => message.type === "assistant");
        if (previousAssistant && !validMessageID(previousAssistant.id)) return failure("invalid-response");
        if (!previousAssistant && before.data.length >= 20) return failure("invalid-response");
        boundaries.set(sessionId, previousAssistant?.id);
        await client.session.instructions.entry.put(
          { sessionID: sessionId, key: INSTRUCTION_KEY, value: instruction },
          { signal },
        );
        if (
          !assertCurrent() ||
          token !== currentReviewToken ||
          ownedSessions.get(sessionId) !== token ||
          signal.aborted
        )
          return failure("invalid-response");
        const text = boundedPacketText(packetText);
        const admission = await client.session.prompt({ sessionID: sessionId, text }, { signal });
        if (
          !assertCurrent() ||
          token !== currentReviewToken ||
          ownedSessions.get(sessionId) !== token ||
          signal.aborted ||
          !validPromptAdmission(admission, sessionId, text)
        )
          return failure("invalid-response");
        admittedBoundaries.set(sessionId, boundaries.get(sessionId));
        return { ok: true };
      } catch (error) {
        if (!assertCurrent() || currentReviewToken !== ownedSessions.get(sessionId)) return failure("invalid-response");
        const reason = error && typeof error === "object" && "name" in error ? error.name : undefined;
        return failure(reason === "TimeoutError" ? "timeout" : "sdk-error");
      }
    },

    async retrieveStageText(sessionId, timeoutMs) {
      const deadline = boundedTimeout(timeoutMs);
      if (!Number.isFinite(timeoutMs) || deadline <= 0) return failure("timeout");
      if (
        !assertCurrent() ||
        ownedSessions.get(sessionId) !== currentReviewToken ||
        currentReviewToken === undefined ||
        !admittedBoundaries.has(sessionId)
      )
        return failure("invalid-response");
      const token = currentReviewToken;
      try {
        const startedAt = Date.now();
        const signal = requestSignal(deadline, sessionId);
        while (Date.now() - startedAt < deadline) {
          if (!assertCurrent() || token !== currentReviewToken || ownedSessions.get(sessionId) !== token)
            return failure("invalid-response");
          if (signal.aborted)
            return signal.reason instanceof Error && signal.reason.name === "TimeoutError"
              ? failure("timeout")
              : failure("invalid-response");
          const remaining = deadline - (Date.now() - startedAt);
          const response = await boundedAwait(
            client.message.list({ sessionID: sessionId, order: "desc", limit: 20 }, { signal }),
            remaining,
            signal,
          );
          if (!assertCurrent() || token !== currentReviewToken || ownedSessions.get(sessionId) !== token)
            return failure("invalid-response");
          if (signal.aborted)
            return signal.reason instanceof Error && signal.reason.name === "TimeoutError"
              ? failure("timeout")
              : failure("invalid-response");
          const candidate = lastStageReplyCandidate(response.data, admittedBoundaries.get(sessionId), hostPinnedModel);
          if (candidate?.complete) {
            if (
              !assertCurrent() ||
              token !== currentReviewToken ||
              ownedSessions.get(sessionId) !== token ||
              signal.aborted
            )
              return failure("invalid-response");
            return { ok: true, text: candidate.text };
          }
          const wait = Math.min(RESTRICTED_REVIEW_POLL_INTERVAL_MS, deadline - (Date.now() - startedAt));
          if (wait <= 0) break;
          await waitForPollInterval(wait);
          if (!assertCurrent() || token !== currentReviewToken || ownedSessions.get(sessionId) !== token)
            return failure("invalid-response");
          if (signal.aborted)
            return signal.reason instanceof Error && signal.reason.name === "TimeoutError"
              ? failure("timeout")
              : failure("invalid-response");
        }
        return failure("timeout");
      } catch (error) {
        if (!assertCurrent() || currentReviewToken !== token || ownedSessions.get(sessionId) !== token)
          return failure("invalid-response");
        const reason = error && typeof error === "object" && "name" in error ? error.name : undefined;
        return failure(reason === "TimeoutError" ? "timeout" : "sdk-error");
      }
    },

    async runStage(sessionId, packetText, timeoutMs, role, signal) {
      if (role === "architect") return generateArchitectStage(sessionId, packetText, timeoutMs, signal);
      const promptResult = await this.promptStage(sessionId, packetText, role);
      if (!promptResult.ok) return promptResult;
      return this.retrieveStageText(sessionId, timeoutMs);
    },

    async beginReview() {
      if (!isCurrent() || [...failedCleanupSessions].some((sessionId) => ownedSessions.has(sessionId))) {
        if (currentReviewToken !== undefined) await this.cancelReview(currentReviewToken);
        assertCurrent();
        return 0;
      }
      const previousCleanup =
        currentReviewToken !== undefined ? await this.cancelReview(currentReviewToken) : await cleanup;
      if (!previousCleanup.ok) return 0;
      if (!assertCurrent()) return 0;
      const token = ++nextReviewToken;
      currentReviewToken = token;
      sessionsByReview.set(token, new Set());
      reviewControllers.set(token, new AbortController());
      return token;
    },

    async cancelReview(token) {
      const existingCleanup = cleanupByReview.get(token);
      if (existingCleanup) return existingCleanup;
      const sessionIds = sessionsByReview.get(token);
      if (!sessionIds) return { ok: true as const };
      if (currentReviewToken === token) currentReviewToken = undefined;
      reviewControllers.get(token)?.abort();
      const operation = cleanup.then(async () => {
        await Promise.all(pendingCreates.get(token) ?? []);
        let firstFailure: RestrictedReviewFailure | undefined;
        for (const sessionId of sessionIds) {
          // The adapter may already have completed this owned session's
          // cleanup while this lifecycle pass was waiting to run.
          if (!ownedSessions.has(sessionId)) continue;
          if (failedCleanupSessions.has(sessionId)) {
            if (!firstFailure) firstFailure = failure("sdk-error");
            continue;
          }
          const cancelResult = await cancelOwnedSession(sessionId);
          if (!cancelResult.ok && !firstFailure) firstFailure = cancelResult;
          const deleteResult = await deleteOwnedSession(sessionId);
          if (!deleteResult.ok && !firstFailure) firstFailure = deleteResult;
        }
        if (firstFailure) return firstFailure;
        for (const sessionId of sessionIds) {
          cancellationBySession.delete(sessionId);
          deletionBySession.delete(sessionId);
        }
        sessionsByReview.delete(token);
        pendingCreates.delete(token);
        reviewControllers.delete(token);
        cleanupByReview.delete(token);
        return firstFailure ?? { ok: true as const };
      });
      cleanup = operation;
      cleanupByReview.set(token, operation);
      return operation;
    },

    isReviewCurrent(token) {
      return currentReviewToken === token && isCurrent();
    },

    cancel: cancelOwnedSession,

    delete: deleteOwnedSession,

    async checkReadiness() {
      ready = false;
      const readinessStartedAt = observe ? observationNow() : undefined;
      const reportReadiness = (outcome: RestrictedReviewObservationOutcome): boolean => {
        ready = outcome === "ready";
        reportObservation("review-readiness", outcome, readinessStartedAt);
        return ready;
      };
      if (!assertCurrent()) return reportReadiness("not-current");
      const controller = new AbortController();
      readinessControllers.add(controller);
      const timeoutSignal = AbortSignal.timeout(5_000);
      const requestSignal = AbortSignal.any([controller.signal, timeoutSignal]);
      let response: unknown;
      try {
        response = await client.agent.get(
          { agentID: RESTRICTED_REVIEW_AGENT_NAME, location: { directory } },
          { signal: requestSignal },
        );
      } catch (error) {
        return reportReadiness(readinessRequestFailureOutcome(error, controller, timeoutSignal, requestSignal));
      } finally {
        readinessControllers.delete(controller);
      }
      if (!assertCurrent()) return reportReadiness("generation-stale");

      let locationMatches = false;
      try {
        if (response && typeof response === "object" && !Array.isArray(response)) {
          const location = (response as { location?: unknown }).location;
          locationMatches =
            Boolean(location) &&
            typeof location === "object" &&
            !Array.isArray(location) &&
            (location as { directory?: unknown }).directory === directory;
        }
      } catch {
        locationMatches = false;
      }
      if (!locationMatches) return reportReadiness("location-mismatch");

      const expectedModelMatches =
        restrictedReview.modelResolution === "native-default"
          ? restrictedReview.model === undefined
          : typeof restrictedReview.model === "string" &&
            configuredModelMatches(nativeModel(hostPinnedModel), restrictedReview.model);
      if (!expectedModelMatches) return reportReadiness("model-mismatch");

      let agentMismatch: RestrictedAgentMismatchField | undefined;
      try {
        agentMismatch = hasExpectedRestrictedAgent(response, restrictedReview, tools);
      } catch {
        agentMismatch = "shape";
      }
      if (agentMismatch !== undefined) return reportReadiness(AGENT_MISMATCH_OUTCOMES[agentMismatch]);
      return reportReadiness("ready");
    },

    isReady() {
      return ready && !invalidated && Object.is(recordedGeneration, currentGeneration());
    },

    invalidate() {
      invalidated = true;
      ready = false;
      for (const controller of reviewControllers.values()) controller.abort();
      for (const controller of sessionControllers.values()) controller.abort();
      for (const controller of readinessControllers) controller.abort();
    },
  };
}
