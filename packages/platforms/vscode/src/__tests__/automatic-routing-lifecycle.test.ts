import { describe, expect, it } from "vitest";
import { type AutomaticRoutingBinding, createAutomaticRoutingLifecycle } from "../vibefeld/automatic-routing-lifecycle";

const binding: AutomaticRoutingBinding = { sessionId: "session", messageId: "message", generation: 4 };
const selection = {
  selected: true as const,
  reasonCode: "evidence_dependent" as const,
  summary: "Evidence-dependent response" as const,
};

const summary = (overrides: Record<string, unknown> = {}) => ({
  reviewedMessageId: "message",
  status: "structurally_checked",
  invocation: "automatic",
  conclusion: "Bounded conclusion",
  assumptions: ["Bounded assumption"],
  evidenceStatus: "source_recorded",
  openChallenges: [],
  routing: { reasonCode: "evidence_dependent", summary: "Evidence-dependent response" },
  ...overrides,
});

function start(lifecycle = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 })) {
  return lifecycle.start({ binding, selection });
}

describe("automatic-routing lifecycle", () => {
  it("starts at most one attempt per session/message/generation and never exposes a gate action", () => {
    const lifecycle = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    const first = start(lifecycle);
    expect(first).toMatchObject({ kind: "started", reasonCode: "evidence_dependent" });
    expect(start(lifecycle)).toEqual({ kind: "skipped", reason: "duplicate" });
    expect(lifecycle).not.toHaveProperty("release");
    expect(lifecycle).not.toHaveProperty("publish");
  });

  it("gives an in-flight manual review precedence without replacing it", () => {
    const lifecycle = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    expect(lifecycle.beginManual(binding)).toBe(true);
    expect(start(lifecycle)).toEqual({ kind: "skipped", reason: "manual_in_flight" });
    expect(lifecycle.beginManual(binding)).toBe(false);
    lifecycle.endManual(binding);
    expect(start(lifecycle)).toMatchObject({ kind: "started" });
  });

  it.each([
    ["wrong session", { ...binding, sessionId: "other" }, "session_mismatch"],
    ["wrong generation", { ...binding, generation: 5 }, "generation_mismatch"],
    ["malformed binding", { sessionId: "session", messageId: "message" }, "malformed"],
    ["unknown reason", binding, "malformed"],
  ] as const)("rejects %s without retaining input", (_, target, reason) => {
    const lifecycle = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    const value =
      reason === "malformed" && target === binding
        ? { selected: true, reasonCode: "unknown", summary: "unsafe" }
        : selection;
    expect(lifecycle.start({ binding: target, selection: value })).toEqual({ kind: "skipped", reason });
    expect(JSON.stringify(lifecycle)).not.toContain("unsafe");
  });

  it("invalidates cancellation, timeout, stale generations, and session switches", () => {
    const cancelled = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    const cancelledStart = start(cancelled);
    expect(cancelled.cancel((cancelledStart as { attemptId: string }).attemptId, binding)).toEqual({
      kind: "invalidated",
      reason: "cancelled",
    });
    expect(start(cancelled)).toEqual({ kind: "skipped", reason: "cancelled" });

    const timedOut = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    const timedOutStart = start(timedOut) as { attemptId: string };
    expect(timedOut.timeout(timedOutStart.attemptId, binding)).toEqual({ kind: "invalidated", reason: "timed_out" });
    expect(timedOut.complete(timedOutStart.attemptId, binding, summary())).toEqual({
      kind: "skipped",
      reason: "timed_out",
    });

    const stale = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    const staleStart = start(stale) as { attemptId: string };
    stale.invalidateGeneration("session", 5);
    expect(stale.cancel(staleStart.attemptId, binding)).toEqual({ kind: "skipped", reason: "stale" });
    expect(start(stale)).toEqual({ kind: "skipped", reason: "generation_mismatch" });

    const switched = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    start(switched);
    switched.invalidateSession("new-session");
    expect(start(switched)).toEqual({ kind: "skipped", reason: "session_mismatch" });
  });

  it("rejects unsafe or malformed terminal results and accepts only the bound summary", () => {
    const lifecycle = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    const result = start(lifecycle) as { attemptId: string };
    expect(lifecycle.complete(result.attemptId, { ...binding, messageId: "other-message" }, summary())).toEqual({
      kind: "skipped",
      reason: "stale",
    });
    expect(lifecycle.complete(result.attemptId, binding, summary({ conclusion: "https://unsafe.example" }))).toEqual({
      kind: "skipped",
      reason: "unsafe",
    });
    expect(lifecycle.complete(result.attemptId, binding, summary())).toEqual({ kind: "skipped", reason: "terminal" });

    const completed = createAutomaticRoutingLifecycle({ sessionId: "session", generation: 4 });
    const completedStart = start(completed) as { attemptId: string };
    expect(completed.complete(completedStart.attemptId, binding, summary())).toEqual({
      kind: "completed",
      attemptId: completedStart.attemptId,
    });
    expect(completed.complete(completedStart.attemptId, binding, summary())).toEqual({
      kind: "skipped",
      reason: "terminal",
    });
  });
});
