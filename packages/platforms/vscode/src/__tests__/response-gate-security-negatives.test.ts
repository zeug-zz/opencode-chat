import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  ResponseGateAssistantMessageId,
  ResponseGateGeneration,
  ResponseGateOwner,
  ResponseGateSessionId,
} from "../vibefeld/response-gate-contract";
import { createHostPublicationBoundaryAdapter } from "../vibefeld/response-gate-publication-boundary";
import { createResponseGateSeam } from "../vibefeld/response-gate-seam";

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const binding = {
  owner: "host" as ResponseGateOwner,
  sessionId: "session" as ResponseGateSessionId,
  assistantMessageId: "message" as ResponseGateAssistantMessageId,
  generation: 1 as ResponseGateGeneration,
} as const;
const eligibility = { explicitlyOptedIn: true, eligible: true, responseClass: "assistant" } as const;
const candidate = Object.freeze({ text: "bounded response" });
const sourcePacket = Object.freeze({ visibleText: "bounded visible source" });
const decision = {
  kind: "approved",
  calibration: "conditional",
  summary: {
    reviewedMessageId: "message",
    status: "conditional",
    invocation: "automatic",
    conclusion: "bounded conclusion",
    assumptions: [],
    evidenceStatus: "unverified",
    openChallenges: [],
    interpretiveBoundary: "conditional, not truth or formal proof",
  },
} as const;

function createGate(publish = vi.fn()) {
  return createResponseGateSeam({
    owner: binding.owner,
    capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
    publish,
    timeoutMs: 30_000,
  });
}

describe("response-gate negative boundaries", () => {
  it("keeps the fixture and unavailable adapter out of ordinary host and provider paths", () => {
    const productionSources = [
      readSource("../extension.ts"),
      readSource("../chat-view-provider.ts"),
      readSource("../../../../agents/opencode/src/opencode-agent.ts"),
      readSource("../../../../agents/opencode/src/launch-config.ts"),
      readSource("../../../../core/src/agent.interface.ts"),
      readSource("../../../../core/src/protocol.ts"),
    ];

    for (const source of productionSources) {
      expect(source).not.toContain("fixture-response-gate-adapter");
      expect(source).not.toMatch(/create(?:HostPublicationBoundary|ResponseGateSeam)/u);
      expect(source).not.toMatch(/(?:response-gate|ResponseGate)/u);
    }

    const extensionSource = productionSources[0];
    expect(extensionSource).toContain("UnavailableReasoningReviewController");
    expect(extensionSource).not.toMatch(/new\s+(?:Fixture|Unavailable).*ResponseGate/u);
  });

  it("rejects every unsupported insertion point before capability or token allocation", () => {
    const tokenSource = vi.fn(() => "must-not-be-allocated");
    const publish = vi.fn();
    for (const insertionPoint of ["observer", "post-stream", "promptAsync", "direct-send"] as const) {
      expect(
        createHostPublicationBoundaryAdapter({
          insertionPoint,
          owner: binding.owner,
          capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
          publish,
          tokenSource,
        }),
      ).toMatchObject({ kind: "unavailable", reason: "not_transactional" });
    }
    expect(tokenSource).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["unavailable", { kind: "incompatible", reason: "unavailable" }],
    ["unsupported", { kind: "incompatible", reason: "unsupported" }],
    ["not opted in", { explicitlyOptedIn: false, createsDraftBeforeRelease: true, hostOwnsRelease: true }],
  ] as const)("leaves ordinary publication untouched for %s capability", (_label, capability) => {
    const publish = vi.fn();
    const result = createHostPublicationBoundaryAdapter({
      insertionPoint: "host-publication",
      owner: binding.owner,
      capability,
      publish,
    });
    expect(result).toMatchObject({ kind: "unavailable" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not allocate or publish for non-opted-in or ineligible responses", () => {
    const tokenSource = vi.fn(() => "must-not-be-allocated");
    const publish = vi.fn();
    const gate = createResponseGateSeam({
      owner: binding.owner,
      capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
      publish,
      tokenSource,
    });

    for (const value of [
      { explicitlyOptedIn: false, eligible: true, responseClass: "assistant" },
      { explicitlyOptedIn: true, eligible: false, responseClass: "assistant" },
      { explicitlyOptedIn: true, eligible: true, responseClass: "tool" },
    ]) {
      expect(
        gate.begin({
          eligibility: value,
          binding,
          candidateText: candidate.text,
          sourceText: sourcePacket.visibleText,
        }),
      ).toEqual({ ok: false, code: "ineligible" });
    }
    expect(tokenSource).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects stale identity, token, generation, timeout, cancellation, disposal, and repeated release", () => {
    const publish = vi.fn();
    const gate = createGate(publish);
    const begun = gate.begin({
      eligibility,
      binding,
      candidateText: candidate.text,
      sourceText: sourcePacket.visibleText,
    });
    if (!begun.ok) return;

    for (const staleBinding of [
      { ...binding, owner: "other" as ResponseGateOwner },
      { ...binding, sessionId: "other" as ResponseGateSessionId },
      { ...binding, assistantMessageId: "other" as ResponseGateAssistantMessageId },
      { ...binding, generation: 2 as ResponseGateGeneration },
    ]) {
      expect(gate.release({ token: begun.value.token, binding: staleBinding })).toEqual({ ok: false, code: "stale" });
    }
    expect(gate.release({ token: "other-token", binding })).toEqual({ ok: false, code: "stale" });
    expect(gate.timeout({ token: begun.value.token, binding })).toMatchObject({
      ok: true,
      value: { state: "timed_out" },
    });
    expect(gate.release({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(publish).not.toHaveBeenCalled();

    const cancelled = createGate(publish);
    const cancelledDraft = cancelled.begin({
      eligibility,
      binding,
      candidateText: candidate.text,
      sourceText: sourcePacket.visibleText,
    });
    if (!cancelledDraft.ok) return;
    expect(cancelled.cancel({ token: cancelledDraft.value.token, binding })).toMatchObject({
      ok: true,
      value: { state: "cancelled" },
    });
    expect(cancelled.release({ token: cancelledDraft.value.token, binding })).toEqual({ ok: false, code: "terminal" });

    const disposed = createGate(publish);
    const disposedDraft = disposed.begin({
      eligibility,
      binding,
      candidateText: candidate.text,
      sourceText: sourcePacket.visibleText,
    });
    if (!disposedDraft.ok) return;
    disposed.dispose();
    expect(disposed.review({ token: disposedDraft.value.token, binding, decision })).toEqual({
      ok: false,
      code: "terminal",
    });
    expect(disposed.release({ token: disposedDraft.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", { reviewedMessageId: "message", status: "conditional" }],
    ["unsafe", { ...decision.summary, conclusion: "secret: hidden" }],
    ["uncalibrated", { ...decision.summary, status: "structurally_checked" }],
    [
      "ambiguous",
      {
        ...decision.summary,
        openChallenges: Array.from({ length: 33 }, () => ({
          severity: "note",
          target: "challenge",
          reason: "bounded",
        })),
      },
    ],
    ["stale", { ...decision.summary, reviewedMessageId: "old-message" }],
  ] as const)("does not release %s review data", (_label, summary) => {
    const publish = vi.fn();
    const gate = createGate(publish);
    const begun = gate.begin({
      eligibility,
      binding,
      candidateText: candidate.text,
      sourceText: sourcePacket.visibleText,
    });
    if (!begun.ok) return;
    const result = gate.reviewSummary({ token: begun.value.token, binding, summary });
    expect(result).toMatchObject({ ok: false });
    expect(gate.release({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(publish).not.toHaveBeenCalled();
  });
});
