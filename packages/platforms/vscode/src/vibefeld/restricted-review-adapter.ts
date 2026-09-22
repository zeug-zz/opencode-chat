import { randomUUID } from "node:crypto";
import {
  MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS,
  MAX_RESTRICTED_REVIEW_TEXT_LENGTH,
  mintRestrictedReviewProvenance,
  type RestrictedReviewProvider,
  type RestrictedReviewRole,
} from "@opencode-chat/agent-opencode";
import type {
  ObjectionProposal,
  ReviewContextMetadata,
  ReviewPacket,
  VerifierResult,
} from "./adversarial-review-contract";
import { RESTRICTED_REVIEW_PERMISSION_ATTESTATION } from "./adversarial-review-contract";
import type { RestrictedReviewAdapter } from "./adversarial-review-seam";
import { HIDDEN_SESSION_MARKER_PREFIX, hiddenSessionRegistry } from "./hidden-session-registry";

type AdapterOptions = Readonly<{
  provider: RestrictedReviewProvider;
  stageTimeoutMs?: number;
}>;

type SessionRecord = Readonly<{ sessionId: string; role: RestrictedReviewRole; registration: string }>;
const DISPOSAL_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseStageText(text: string, keys: readonly string[]): Record<string, unknown> | undefined {
  if (text.length > MAX_RESTRICTED_REVIEW_TEXT_LENGTH) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && exactKeys(value, keys) ? value : undefined;
  } catch {
    return undefined;
  }
}

function boundedError(): Error {
  return new Error("Restricted review cleanup failed.");
}

async function disposeSession(provider: RestrictedReviewProvider, sessionId: string): Promise<void> {
  let cancel: Promise<unknown>;
  try {
    cancel = provider.cancel(sessionId);
  } catch {
    cancel = Promise.resolve();
  }
  try {
    await cancel;
  } catch {
    // Deletion is attempted even when cancellation fails.
  }
  try {
    await provider.delete(sessionId);
  } catch {
    // Deactivation is best effort and must not reject.
  }
}

/** Bridges the agent-package provider to the provider-neutral host seam. */
export function createRestrictedReviewAdapter({
  provider,
  stageTimeoutMs,
}: AdapterOptions): RestrictedReviewAdapter & { dispose: () => Promise<void> } {
  const sessions = new Map<string, SessionRecord>();
  const timeoutMs = stageTimeoutMs ?? MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS;

  const contextFor = (
    role: RestrictedReviewRole,
    sessionId: string,
    registration: string,
    provenance: ReturnType<typeof mintRestrictedReviewProvenance>,
  ): ReviewContextMetadata => {
    sessions.set(provenance.handle, { sessionId, role, registration });
    return {
      handle: provenance.handle as ReviewContextMetadata["handle"],
      provenance: {
        identity: provenance.identity,
        role: provenance.role,
        contextNumber: provenance.contextNumber,
      },
    };
  };

  const run = async (
    context: ReviewContextMetadata,
    packetText: string,
    role: RestrictedReviewRole,
    extraText = "",
  ): Promise<Record<string, unknown> | undefined> => {
    const session = sessions.get(context.handle);
    if (!session || session.role !== role) return undefined;
    const result = await provider.runStage(session.sessionId, `${packetText}${extraText}`, timeoutMs, role);
    if (!result.ok) return undefined;
    return parseStageText(
      result.text,
      role === "prover" ? ["proposalId", "objections"] : ["proposalId", "dispositions"],
    );
  };

  return {
    attestation: RESTRICTED_REVIEW_PERMISSION_ATTESTATION,

    async createContext(role) {
      const provenance = mintRestrictedReviewProvenance(role);
      const marker = `${HIDDEN_SESSION_MARKER_PREFIX}${randomUUID()}`;
      const registration = hiddenSessionRegistry.beginHiddenSession(marker);
      if (!registration) return undefined;
      try {
        const created = await provider.createSession(marker);
        if (!created.ok) {
          hiddenSessionRegistry.releaseHiddenSession(registration);
          return undefined;
        }
        if (!hiddenSessionRegistry.confirmHiddenSession(registration, created.sessionId)) {
          hiddenSessionRegistry.releaseHiddenSession(registration);
          await disposeSession(provider, created.sessionId);
          return undefined;
        }
        return contextFor(role, created.sessionId, registration, provenance);
      } catch {
        hiddenSessionRegistry.releaseHiddenSession(registration);
        return undefined;
      }
    },

    async runProver(context, packet) {
      try {
        const text = JSON.stringify(packet);
        const child = await run(context, text, "prover");
        if (!child) return undefined;
        return {
          proposalId: child.proposalId,
          prover: context.provenance,
          objections: child.objections,
        } satisfies ObjectionProposal;
      } catch {
        return undefined;
      }
    },

    async runVerifier(context, packet, proposal) {
      try {
        const packetText = JSON.stringify(packet);
        const proposalText = JSON.stringify({
          proposalId: proposal.proposalId,
          objections: proposal.objections,
        });
        const child = await run(context, `${packetText}\n${proposalText}`, "verifier");
        if (!child) return undefined;
        return {
          verifier: context.provenance,
          proposalId: child.proposalId,
          dispositions: child.dispositions,
        } satisfies VerifierResult;
      } catch {
        return undefined;
      }
    },

    async cancelContext(context) {
      const session = sessions.get(context.handle);
      if (!session) throw boundedError();
      let failed = false;
      try {
        const cancelled = await provider.cancel(session.sessionId);
        failed = !cancelled.ok;
      } catch {
        failed = true;
      }
      try {
        const deleted = await provider.delete(session.sessionId);
        failed ||= !deleted.ok;
      } catch {
        failed = true;
      } finally {
        sessions.delete(context.handle);
        hiddenSessionRegistry.forgetHiddenSession(session.sessionId);
      }
      if (failed) throw boundedError();
    },

    async dispose() {
      const records = [...sessions.values()];
      sessions.clear();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(records.map(({ sessionId }) => disposeSession(provider, sessionId))),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, DISPOSAL_TIMEOUT_MS);
          }),
        ]);
      } catch {
        // Cleanup is deliberately non-throwing.
      } finally {
        for (const { sessionId } of records) hiddenSessionRegistry.forgetHiddenSession(sessionId);
        if (timer) clearTimeout(timer);
        sessions.clear();
      }
    },
  };
}
