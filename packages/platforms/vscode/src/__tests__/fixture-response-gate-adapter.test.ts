import { describe, expect, it } from "vitest";
import {
  createFixtureResponseGateAdapter,
  fixtureResponseGateBinding,
} from "../vibefeld/fixture-response-gate-adapter";

const candidate = Object.freeze({ text: "The bounded fixture response." });

describe("test-only response-gate fixture adapter", () => {
  it("holds an immutable draft, consumes a bounded review, and releases once through the host callback", () => {
    const fixture = createFixtureResponseGateAdapter("approved");
    const binding = fixtureResponseGateBinding();
    const begun = fixture.begin(candidate, binding);

    expect(begun).toMatchObject({ ok: true, value: { state: "draft" } });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(fixture.publications()).toEqual([]);
    if (!begun.ok) return;

    expect(fixture.submitFixedReview(begun.value.token, binding)).toMatchObject({
      ok: true,
      value: { state: "approved" },
    });
    expect(fixture.publications()).toEqual([]);
    expect(fixture.adapter.release({ token: begun.value.token, binding })).toMatchObject({ ok: true });
    expect(fixture.publications()).toEqual([candidate]);
    expect(fixture.adapter.release({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
    expect(fixture.publications()).toHaveLength(1);
  });

  it.each(["objection_confirmed", "evidence_conflict", "malformed", "ambiguous", "audit_failed"] as const)(
    "does not publish a %s review outcome",
    (outcome) => {
      const fixture = createFixtureResponseGateAdapter(outcome);
      const binding = fixtureResponseGateBinding();
      const begun = fixture.begin(candidate, binding);
      if (!begun.ok) return;

      expect(fixture.submitFixedReview(begun.value.token, binding)).toMatchObject({ ok: false });
      expect(fixture.adapter.release({ token: begun.value.token, binding })).toEqual({ ok: false, code: "terminal" });
      expect(fixture.publications()).toEqual([]);
    },
  );

  it("does not publish before approval or after cancellation, timeout, or stale isolation", () => {
    const cancelled = createFixtureResponseGateAdapter("approved");
    const cancelledBinding = fixtureResponseGateBinding();
    const cancelledDraft = cancelled.begin(candidate, cancelledBinding);
    if (!cancelledDraft.ok) return;
    expect(cancelled.adapter.cancel({ token: cancelledDraft.value.token, binding: cancelledBinding })).toMatchObject({
      ok: true,
      value: { state: "cancelled" },
    });
    expect(cancelled.adapter.release({ token: cancelledDraft.value.token, binding: cancelledBinding })).toEqual({
      ok: false,
      code: "terminal",
    });
    expect(cancelled.publications()).toEqual([]);

    const timedOut = createFixtureResponseGateAdapter("approved");
    const timeoutBinding = fixtureResponseGateBinding();
    const timeoutDraft = timedOut.begin(candidate, timeoutBinding);
    if (!timeoutDraft.ok) return;
    expect(timedOut.adapter.timeout({ token: timeoutDraft.value.token, binding: timeoutBinding })).toMatchObject({
      ok: true,
      value: { state: "timed_out" },
    });
    expect(timedOut.publications()).toEqual([]);

    const stale = createFixtureResponseGateAdapter("approved");
    const staleBinding = fixtureResponseGateBinding();
    const staleDraft = stale.begin(candidate, staleBinding);
    if (!staleDraft.ok) return;
    stale.adapter.invalidateSession(staleBinding.sessionId);
    expect(stale.submitFixedReview(staleDraft.value.token, staleBinding)).toEqual({ ok: false, code: "terminal" });
    expect(stale.publications()).toEqual([]);
  });
});
