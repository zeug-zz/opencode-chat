import { describe, expect, it, vi } from "vitest";
import type {
  ResponseGateAssistantMessageId,
  ResponseGateGeneration,
  ResponseGateOwner,
  ResponseGateSessionId,
} from "../vibefeld/response-gate-contract";
import { createHostPublicationBoundaryAdapter } from "../vibefeld/response-gate-publication-boundary";
import { classifyResponseGateInsertionPoint, createResponseGateSeam } from "../vibefeld/response-gate-seam";

const binding = {
  owner: "host" as ResponseGateOwner,
  sessionId: "session" as ResponseGateSessionId,
  assistantMessageId: "message" as ResponseGateAssistantMessageId,
  generation: 1 as ResponseGateGeneration,
} as const;
const eligibility = { explicitlyOptedIn: true, eligible: true, responseClass: "assistant" } as const;
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
    interpretiveBoundary: "under stated assumptions",
  },
} as const;

function seam(publish = vi.fn()) {
  return {
    seam: createResponseGateSeam({
      owner: binding.owner,
      capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
      publish,
    }),
    publish,
  };
}

describe("private host-owned response-gate seam", () => {
  it("holds an immutable candidate until valid review and release", () => {
    const { seam: gate, publish } = seam();
    const begun = gate.begin({ eligibility, binding, candidateText: "held response", sourceText: "visible source" });
    expect(begun).toMatchObject({ ok: true, value: { state: "draft" } });
    if (!begun.ok) return;
    expect(Object.isFrozen(begun.value)).toBe(true);
    expect(publish).not.toHaveBeenCalled();
    const reviewed = gate.review({ token: begun.value.token, binding, decision });
    expect(reviewed).toMatchObject({ ok: true, value: { state: "approved" } });
    expect(publish).not.toHaveBeenCalled();
    const released = gate.release({ token: begun.value.token, binding });
    expect(released).toMatchObject({ ok: true, value: { kind: "published", assistantMessageId: "message" } });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith("held response");
    expect(gate.release({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
  });

  it("accepts the existing bounded reasoning-review summary through the private adapter", () => {
    const { seam: gate, publish } = seam();
    const begun = gate.begin({ eligibility, binding, candidateText: "held response", sourceText: "bounded source" });
    if (!begun.ok) return;
    expect(
      gate.reviewSummary({
        token: begun.value.token,
        binding,
        summary: { ...decision.summary, invocation: "manual" },
      }),
    ).toMatchObject({ ok: true, value: { state: "approved" } });
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects unsupported or ambiguous summaries without echoing review material", () => {
    const { seam: gate, publish } = seam();
    const begun = gate.begin({ eligibility, binding, candidateText: "held response", sourceText: "bounded source" });
    if (!begun.ok) return;
    const raw = "provider-secret";
    expect(
      gate.reviewSummary({
        token: begun.value.token,
        binding,
        summary: { ...decision.summary, status: "structurally_checked", raw },
      }),
    ).toEqual({ ok: false, code: "incompatible" });
    expect(JSON.stringify(gate.reviewSummary({ token: begun.value.token, binding, summary: { raw } }))).not.toContain(
      raw,
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["unresolved", "failed"],
    ["refuted", "failed"],
    ["blocked", "failed"],
    ["unavailable", "failed"],
    ["audit_failed", "audit_failed"],
  ] as const)("terminalizes valid %s review outcomes as %s without publication", (status, state) => {
    const { seam: gate, publish } = seam();
    const begun = gate.begin({ eligibility, binding, candidateText: "held", sourceText: "source" });
    if (!begun.ok) return;
    expect(gate.reviewSummary({ token: begun.value.token, binding, summary: { ...decision.summary, status } })).toEqual(
      { ok: false, code: "incompatible" },
    );
    expect(gate.release({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(publish).not.toHaveBeenCalled();
    expect(state).toBeDefined();
  });

  it("does not publish for cancellation, invalid review, or incompatible capability", () => {
    const { seam: gate, publish } = seam();
    const begun = gate.begin({ eligibility, binding, candidateText: "held", sourceText: "source" });
    if (!begun.ok) return;
    expect(gate.review({ token: begun.value.token, binding, decision: { kind: "approved" } })).toEqual({
      ok: false,
      code: "incompatible",
    });
    expect(gate.cancel({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(publish).not.toHaveBeenCalled();
    const incompatible = createResponseGateSeam({
      owner: binding.owner,
      capability: { kind: "incompatible", reason: "not_transactional" },
      publish,
    });
    expect(incompatible.begin({ eligibility, binding, candidateText: "held", sourceText: "source" })).toEqual({
      ok: false,
      code: "unavailable",
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("classifies observer, post-stream, promptAsync, and direct-send paths as incompatible", () => {
    for (const point of ["observer", "post-stream", "promptAsync", "direct-send"] as const)
      expect(classifyResponseGateInsertionPoint(point)).toEqual({ kind: "incompatible", reason: "not_transactional" });
    expect(classifyResponseGateInsertionPoint("host-publication")).toMatchObject({ kind: "compatible" });
  });

  it("integrates only through an injected host publication callback", () => {
    const publish = vi.fn();
    const result = createHostPublicationBoundaryAdapter({
      insertionPoint: "host-publication",
      owner: binding.owner,
      capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
      publish,
      tokenSource: () => "boundary-token",
    });
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    const begun = result.adapter.begin({
      eligibility,
      binding,
      candidate: Object.freeze({ text: "held at boundary" }),
      sourcePacket: Object.freeze({ visibleText: "bounded source" }),
    });
    expect(begun).toMatchObject({ ok: true, value: { state: "draft", token: "boundary-token" } });
    expect(publish).not.toHaveBeenCalled();
    if (!begun.ok) return;
    expect(result.adapter.review({ token: begun.value.token, binding, decision })).toMatchObject({
      ok: true,
      value: { state: "approved" },
    });
    expect(publish).not.toHaveBeenCalled();
    expect(result.adapter.release({ token: begun.value.token, binding })).toMatchObject({ ok: true });
    expect(publish).toHaveBeenCalledWith(Object.freeze({ text: "held at boundary" }));
  });

  it("does not create a transaction for missing, incompatible, or non-opted-in capability", () => {
    const publish = vi.fn();
    for (const capability of [undefined, { kind: "incompatible", reason: "unavailable" }]) {
      const result = createHostPublicationBoundaryAdapter({
        insertionPoint: "host-publication",
        owner: binding.owner,
        capability,
        publish,
      });
      expect(result.kind).toBe("unavailable");
    }
    const noOptIn = createHostPublicationBoundaryAdapter({
      insertionPoint: "host-publication",
      owner: binding.owner,
      capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
      publish,
    });
    expect(noOptIn.kind).toBe("available");
    if (noOptIn.kind === "available")
      expect(
        noOptIn.adapter.begin({
          eligibility: { explicitlyOptedIn: false, eligible: true, responseClass: "assistant" },
          binding,
          candidate: Object.freeze({ text: "ordinary" }),
          sourcePacket: Object.freeze({ visibleText: "source" }),
        }),
      ).toEqual({ ok: false, code: "ineligible" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects observer, post-stream, promptAsync, and direct-send adapters before allocation", () => {
    const publish = vi.fn();
    for (const insertionPoint of ["observer", "post-stream", "promptAsync", "direct-send"] as const)
      expect(
        createHostPublicationBoundaryAdapter({
          insertionPoint,
          owner: binding.owner,
          capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
          publish,
        }),
      ).toMatchObject({ kind: "unavailable", reason: "not_transactional" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects every mismatched binding and token as stale", () => {
    const { seam: gate, publish } = seam();
    const begun = gate.begin({ eligibility, binding, candidateText: "held", sourceText: "source" });
    if (!begun.ok) return;
    const mismatches = [
      { ...binding, owner: "other" as ResponseGateOwner },
      { ...binding, sessionId: "other" as ResponseGateSessionId },
      { ...binding, assistantMessageId: "other" as ResponseGateAssistantMessageId },
      { ...binding, generation: 2 as ResponseGateGeneration },
    ];
    for (const mismatchedBinding of mismatches) {
      expect(gate.review({ token: begun.value.token, binding: mismatchedBinding, decision })).toEqual({
        ok: false,
        code: "stale",
      });
      expect(gate.release({ token: begun.value.token, binding: mismatchedBinding })).toEqual({
        ok: false,
        code: "stale",
      });
    }
    expect(gate.review({ token: "other-token", binding, decision })).toEqual({ ok: false, code: "stale" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("invalidates switched sessions, deleted messages, and older generations", () => {
    const { seam: gate, publish } = seam();
    const sessionDraft = gate.begin({ eligibility, binding, candidateText: "session", sourceText: "source" });
    const messageDraft = gate.begin({
      eligibility,
      binding: { ...binding, assistantMessageId: "deleted" as ResponseGateAssistantMessageId },
      candidateText: "message",
      sourceText: "source",
    });
    const oldGeneration = gate.begin({
      eligibility,
      binding: { ...binding, generation: 1 as ResponseGateGeneration },
      candidateText: "old",
      sourceText: "source",
    });
    if (!sessionDraft.ok || !messageDraft.ok || !oldGeneration.ok) return;
    gate.invalidateMessage({
      sessionId: binding.sessionId,
      assistantMessageId: "deleted" as ResponseGateAssistantMessageId,
    });
    gate.invalidateGeneration({ ...binding, generation: 2 as ResponseGateGeneration });
    gate.invalidateSession(binding.sessionId);
    expect(gate.release({ token: sessionDraft.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(
      gate.release({
        token: messageDraft.value.token,
        binding: { ...binding, assistantMessageId: "deleted" as ResponseGateAssistantMessageId },
      }),
    ).toEqual({ ok: false, code: "terminal" });
    expect(gate.release({ token: oldGeneration.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("times out and disposes transactions without leaving timers or release paths", () => {
    vi.useFakeTimers();
    try {
      const { seam: gate, publish } = seam();
      const begun = gate.begin({ eligibility, binding, candidateText: "held", sourceText: "source" });
      if (!begun.ok) return;
      vi.advanceTimersByTime(30_000);
      expect(gate.release({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
      expect(publish).not.toHaveBeenCalled();
      const second = gate.begin({ eligibility, binding, candidateText: "held", sourceText: "source" });
      if (!second.ok) return;
      gate.dispose();
      expect(gate.review({ token: second.value.token, binding, decision })).toEqual({ ok: false, code: "terminal" });
      expect(gate.release({ token: second.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes before a throwing or reentrant publication callback", () => {
    const throwing = vi.fn(() => {
      throw new Error("publication failure");
    });
    const gate = createResponseGateSeam({
      owner: binding.owner,
      capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
      publish: throwing,
    });
    const failed = gate.begin({ eligibility, binding, candidateText: "held", sourceText: "source" });
    if (!failed.ok) return;
    expect(gate.review({ token: failed.value.token, binding, decision })).toMatchObject({ ok: true });
    expect(gate.release({ token: failed.value.token, binding })).toEqual({ ok: false, code: "publication_failed" });
    expect(gate.release({ token: failed.value.token, binding })).toEqual({ ok: false, code: "terminal" });

    let token = "";
    const holder: { gate?: ReturnType<typeof createResponseGateSeam> } = {};
    const publish = vi.fn(() => {
      expect(holder.gate?.release({ token, binding })).toEqual({ ok: false, code: "terminal" });
    });
    const reentrant = createResponseGateSeam({
      owner: binding.owner,
      capability: { explicitlyOptedIn: true, createsDraftBeforeRelease: true, hostOwnsRelease: true },
      publish,
    });
    holder.gate = reentrant;
    const begun = reentrant.begin({ eligibility, binding, candidateText: "held", sourceText: "source" });
    if (!begun.ok) return;
    token = begun.value.token;
    expect(reentrant.review({ token, binding, decision })).toMatchObject({ ok: true });
    expect(reentrant.release({ token, binding })).toMatchObject({ ok: true });
    expect(publish).toHaveBeenCalledOnce();
  });
});
