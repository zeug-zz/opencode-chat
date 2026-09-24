import type { OpencodeClient } from "@opencode-ai/sdk/v2";
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
export const MAX_RESTRICTED_REVIEW_TEXT_LENGTH = 8_192;
export const MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS = 35_000;
const RESTRICTED_REVIEW_POLL_INTERVAL_MS = 50;
const MAX_FAILURE_MESSAGE_LENGTH = 256;
/**
 * Marker-less-server compatibility: identical non-empty reply text observed on
 * this many consecutive polls is treated as complete. A server that reports
 * message- or part-level completion never needs it.
 */
const RETRIEVAL_STABILITY_POLLS = 6;

export type RestrictedReviewModel = {
  providerID: string;
  modelID: string;
};

export type RestrictedReviewFailure = {
  ok: false;
  code: "sdk-error" | "timeout" | "invalid-response";
  message: string;
};

export type RestrictedReviewOperationResult = { ok: true } | RestrictedReviewFailure;

export type RestrictedReviewSessionResult = { ok: true; sessionId: string } | RestrictedReviewFailure;

export type RestrictedReviewTextResult = { ok: true; text: string } | RestrictedReviewFailure;

type RestrictedReviewSdkClient = Pick<OpencodeClient, "session" | "config">;

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
  /** Resolved by the host; never read from a packet, request, or child result. */
  hostPinnedModel: RestrictedReviewModel;
  /** Opaque generation of the host-composed overlay/server connection. */
  generation?: RestrictedReviewGeneration;
  /** Returns the generation currently owned by the host. */
  currentGeneration?: () => RestrictedReviewGeneration;
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

function boundedFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Restricted review SDK operation failed.";
  return message.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

function failure(code: RestrictedReviewFailure["code"], error?: unknown): RestrictedReviewFailure {
  return { ok: false, code, message: error === undefined ? code : boundedFailureMessage(error) };
}

function buildDeniedTools(dynamicToolNames: readonly string[] | undefined): Record<string, false> {
  const names = new Set<string>(["*", ...RESTRICTED_REVIEW_AUTHORITIES, ...(dynamicToolNames ?? [])]);
  return Object.fromEntries([...names].map((name) => [name, false]));
}

function hasExpectedRestrictedAgent(
  value: unknown,
  restrictedReview: OpenCodeRestrictedReviewConfiguration,
  expectedTools: Record<string, false>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as { agent?: unknown };
  if (!config.agent || typeof config.agent !== "object" || Array.isArray(config.agent)) return false;
  const agent = (config.agent as Record<string, unknown>)[RESTRICTED_REVIEW_AGENT_NAME];
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return false;
  const entry = agent as { model?: unknown; prompt?: unknown; permission?: unknown };
  if (entry.model !== restrictedReview.model || entry.prompt !== restrictedReview.prompt) return false;
  if (!entry.permission || typeof entry.permission !== "object" || Array.isArray(entry.permission)) return false;
  const permission = entry.permission as Record<string, unknown>;
  const expectedAuthorities = Object.keys(expectedTools);
  return (
    Object.keys(permission).length === expectedAuthorities.length &&
    expectedAuthorities.every((authority) => permission[authority] === "deny")
  );
}

function boundedPacketText(packetText: string): string {
  return packetText.slice(0, MAX_PACKET_TEXT_LENGTH);
}

type StageReplyCandidate = Readonly<{ text: string; complete: boolean }>;

/**
 * The LAST assistant message with at least one text part is the only stage
 * reply candidate; user messages and text-less assistant messages are ignored.
 * Its bounded text counts as complete only when the message reports a
 * completion timestamp or every one of its text parts reports an end
 * timestamp, so partial streamed text can never be returned for validation.
 */
function lastStageReplyCandidate(value: unknown): StageReplyCandidate | undefined {
  if (!Array.isArray(value)) return undefined;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const message = value[index];
    if (!message || typeof message !== "object") continue;
    const record = message as { info?: { role?: unknown; time?: { completed?: unknown } }; parts?: unknown };
    if (record.info?.role !== "assistant" || !Array.isArray(record.parts)) continue;
    const text: string[] = [];
    let allPartsEnded = true;
    for (const part of record.parts) {
      if (!part || typeof part !== "object") continue;
      const candidate = part as { type?: unknown; text?: unknown; time?: { end?: unknown } };
      if (candidate.type !== "text" || typeof candidate.text !== "string") continue;
      text.push(candidate.text);
      if (typeof candidate.time?.end !== "number") allPartsEnded = false;
    }
    if (text.length === 0) return undefined;
    const complete = typeof record.info.time?.completed === "number" || allPartsEnded;
    return { text: text.join("\n").slice(0, MAX_RESTRICTED_REVIEW_TEXT_LENGTH), complete };
  }
  return undefined;
}

async function boundedAwait<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  const timerHost = globalThis as unknown as {
    setTimeout(callback: () => void, delay: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  let timer: unknown;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = timerHost.setTimeout(() => reject(new Error("Restricted review stage timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) timerHost.clearTimeout(timer);
  }
}

function boundedTimeout(timeoutMs: number): number {
  return Math.min(Math.max(0, timeoutMs), MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS);
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
  hostPinnedModel,
  generation,
  currentGeneration = () => generation,
}: CreateRestrictedReviewProviderOptions): RestrictedReviewProvider {
  const tools = buildDeniedTools(restrictedReview.dynamicToolNames);
  const recordedGeneration = generation;
  let invalidated = false;
  let ready = false;
  let nextReviewToken = 0;
  let currentReviewToken: RestrictedReviewToken | undefined;
  let cleanup: Promise<RestrictedReviewOperationResult> = Promise.resolve({ ok: true });
  const sessionsByReview = new Map<RestrictedReviewToken, Set<string>>();

  return {
    async createSession(title) {
      try {
        const response = await client.session.create({ title });
        const sessionId = (response.data as { id?: unknown } | undefined)?.id;
        if (typeof sessionId !== "string" || sessionId.length === 0) return failure("invalid-response");
        if (currentReviewToken !== undefined) sessionsByReview.get(currentReviewToken)?.add(sessionId);
        return { ok: true, sessionId };
      } catch (error) {
        return failure("sdk-error", error);
      }
    },

    async promptStage(sessionId, packetText, role) {
      const instruction = RESTRICTED_REVIEW_STAGE_INSTRUCTIONS[role];
      if (typeof instruction !== "string")
        return failure("invalid-response", new Error("Unknown restricted review role."));
      try {
        await client.session.promptAsync({
          sessionID: sessionId,
          agent: RESTRICTED_REVIEW_AGENT_NAME,
          model: hostPinnedModel,
          system: instruction,
          tools,
          parts: [{ type: "text", text: boundedPacketText(packetText) }],
        });
        return { ok: true };
      } catch (error) {
        return failure("sdk-error", error);
      }
    },

    async retrieveStageText(sessionId, timeoutMs) {
      const deadline = boundedTimeout(timeoutMs);
      if (!Number.isFinite(timeoutMs) || deadline <= 0) return failure("timeout");
      try {
        const startedAt = Date.now();
        let stableText: string | undefined;
        let stablePolls = 0;
        while (Date.now() - startedAt < deadline) {
          const remaining = deadline - (Date.now() - startedAt);
          const response = await boundedAwait(client.session.messages({ sessionID: sessionId, limit: 20 }), remaining);
          const candidate = lastStageReplyCandidate(response.data);
          if (candidate) {
            if (candidate.text.length > 0) {
              if (stableText === candidate.text) stablePolls += 1;
              else {
                stableText = candidate.text;
                stablePolls = 1;
              }
            } else {
              // Only completion markers may report an empty reply; a stability
              // streak never carries empty text.
              stableText = undefined;
              stablePolls = 0;
            }
            if (candidate.complete || stablePolls >= RETRIEVAL_STABILITY_POLLS)
              return { ok: true, text: candidate.text };
          }
          const wait = Math.min(RESTRICTED_REVIEW_POLL_INTERVAL_MS, deadline - (Date.now() - startedAt));
          if (wait <= 0) break;
          await waitForPollInterval(wait);
        }
        return failure("timeout");
      } catch (error) {
        return failure(error instanceof Error && error.message.includes("timed out") ? "timeout" : "sdk-error", error);
      }
    },

    async runStage(sessionId, packetText, timeoutMs, role) {
      const promptResult = await this.promptStage(sessionId, packetText, role);
      if (!promptResult.ok) return promptResult;
      return this.retrieveStageText(sessionId, timeoutMs);
    },

    async beginReview() {
      if (currentReviewToken !== undefined) await this.cancelReview(currentReviewToken);
      else await cleanup;
      const token = ++nextReviewToken;
      currentReviewToken = token;
      sessionsByReview.set(token, new Set());
      return token;
    },

    async cancelReview(token) {
      const sessionIds = sessionsByReview.get(token);
      if (!sessionIds) return { ok: true as const };
      if (currentReviewToken === token) currentReviewToken = undefined;
      const operation = cleanup.then(async () => {
        let firstFailure: RestrictedReviewFailure | undefined;
        for (const sessionId of sessionIds) {
          const cancelResult = await this.cancel(sessionId);
          if (!cancelResult.ok && !firstFailure) firstFailure = cancelResult;
          const deleteResult = await this.delete(sessionId);
          if (!deleteResult.ok && !firstFailure) firstFailure = deleteResult;
        }
        sessionsByReview.delete(token);
        return firstFailure ?? { ok: true as const };
      });
      cleanup = operation;
      return operation;
    },

    isReviewCurrent(token) {
      return currentReviewToken === token;
    },

    async cancel(sessionId) {
      try {
        await client.session.abort({ sessionID: sessionId });
        return { ok: true };
      } catch (error) {
        return failure("sdk-error", error);
      }
    },

    async delete(sessionId) {
      try {
        await client.session.delete({ sessionID: sessionId });
        return { ok: true };
      } catch (error) {
        return failure("sdk-error", error);
      }
    },

    async checkReadiness() {
      ready = false;
      if (invalidated || !Object.is(recordedGeneration, currentGeneration())) return false;
      try {
        const response = await client.config.get();
        ready = hasExpectedRestrictedAgent(response.data, restrictedReview, tools);
      } catch {
        ready = false;
      }
      return ready && !invalidated && Object.is(recordedGeneration, currentGeneration());
    },

    isReady() {
      return ready && !invalidated && Object.is(recordedGeneration, currentGeneration());
    },

    invalidate() {
      invalidated = true;
      ready = false;
    },
  };
}
