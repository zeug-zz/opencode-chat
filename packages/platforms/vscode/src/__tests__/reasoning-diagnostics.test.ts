import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAIM_PROJECTION_DIAGNOSTIC_OUTCOMES } from "../vibefeld/claim-projection-seam";
import {
  createReasoningDiagnosticClock,
  createReasoningDiagnosticReporter,
  REASONING_DIAGNOSTIC_MAX_ELAPSED_MS,
  REASONING_DIAGNOSTIC_RECORD_LIMIT,
} from "../vibefeld/reasoning-diagnostics";

describe("reasoning diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("formats only fixed labels and numeric timings, ignoring sensitive extra fields", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);

    report({
      stage: "architect",
      outcome: "argument",
      elapsedMs: 12.345,
      prompt: "private prompt text",
      model: "provider/private-model",
      output: "private model output",
      path: "/private/workspace/file",
      sessionId: "private-session-id",
      credential: "private-token",
      configuration: { model: "secret" },
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const message = sink.mock.calls[0]?.[1];
    expect(message).toBe("[OpenCode Scribe reasoning] stage=architect outcome=argument elapsedMs=12.35");
    expect(message).not.toMatch(/private|provider\/|secret/u);
  });

  it("accepts fixed pending-confirmation outcomes and ignores arbitrary error details", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);
    const errorGetter = vi.fn(() => "UNIQUE_PENDING_DIAGNOSTIC_SECRET");
    const error = Object.defineProperty({}, "message", { get: errorGetter });

    for (const outcome of [
      "registered",
      "confirmation-failed",
      "confirmation-threw",
      "stale",
      "turn-finished",
    ] as const) {
      report({ stage: "brief-confirmation", outcome, elapsedMs: 4.5, error, sessionId: "private-session" });
    }
    report({ stage: "brief-confirmation", outcome: "UNIQUE_PENDING_DIAGNOSTIC_SECRET" });

    expect(sink.mock.calls.map(([, message]) => message)).toEqual([
      "[OpenCode Scribe reasoning] stage=brief-confirmation outcome=registered elapsedMs=4.5",
      "[OpenCode Scribe reasoning] stage=brief-confirmation outcome=confirmation-failed elapsedMs=4.5",
      "[OpenCode Scribe reasoning] stage=brief-confirmation outcome=confirmation-threw elapsedMs=4.5",
      "[OpenCode Scribe reasoning] stage=brief-confirmation outcome=stale elapsedMs=4.5",
      "[OpenCode Scribe reasoning] stage=brief-confirmation outcome=turn-finished elapsedMs=4.5",
    ]);
    expect(errorGetter).not.toHaveBeenCalled();
    expect(sink.mock.calls.flat().join(" ")).not.toMatch(/UNIQUE_PENDING_DIAGNOSTIC_SECRET|private-session/u);
  });

  it("formats manual-review phases without IDs, request data, or arbitrary error details", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);

    report({
      stage: "manual-request",
      outcome: "source-over-limit",
      elapsedMs: 19,
      sessionId: "private-session-id",
      messageId: "private-message-id",
      answer: "private answer text",
      error: "private native failure",
    });

    expect(sink).toHaveBeenCalledWith(
      "info",
      "[OpenCode Scribe reasoning] stage=manual-request outcome=source-over-limit elapsedMs=19",
    );
    expect(sink.mock.calls.flat().join(" ")).not.toMatch(/private|session-id|message-id|answer text|native failure/u);
  });

  it("formats shared architect native substage outcomes without forwarding observation extras", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);

    report({
      stage: "architect-instructions",
      outcome: "timeout",
      elapsedMs: 30_000.125,
      sessionId: "private-session-id",
      error: "private native error",
      packet: "private packet",
    });
    report({ stage: "architect-generate", outcome: "started", path: "/private/workspace" });
    report({ stage: "architect-response", outcome: "success", elapsedMs: 0.4, output: "private model output" });

    expect(sink.mock.calls.map(([, message]) => message)).toEqual([
      "[OpenCode Scribe reasoning] stage=architect-instructions outcome=timeout elapsedMs=30000.13",
      "[OpenCode Scribe reasoning] stage=architect-generate outcome=started",
      "[OpenCode Scribe reasoning] stage=architect-response outcome=success elapsedMs=0.4",
    ]);
    expect(sink.mock.calls.flat().join(" ")).not.toMatch(/private|session-id|native error|workspace|model output/u);
  });

  it("accepts only fixed parser sub-reasons, shapes, normalization, and readiness outcomes", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);
    const parseOutcomes = [
      "malformed",
      "duplicate-identifier",
      "missing-dependency",
      "cycle",
      "invalid-claim-class",
      "unsafe-value",
      "over-limit",
    ] as const;
    const dependencySubreasons = [
      "dependency-unknown-conclusion",
      "dependency-target-assumption",
      "dependency-unknown-target",
      "dependency-unknown-assumption-claim",
      "dependency-unknown-evidence-claim",
      "dependency-unreachable-claim",
      "dependency-other",
    ] as const;
    for (const outcome of parseOutcomes) {
      report({
        stage: "architect-result-parse",
        outcome,
        ...(outcome === "malformed" ? { malformedShape: "shape-prose-wrapped" } : {}),
        normalization: "fenced",
        text: "UNIQUE_DIAGNOSTIC_SENTINEL",
      });
    }
    for (const dependencySubreason of dependencySubreasons) {
      report({ stage: "architect-result-parse", outcome: "missing-dependency", dependencySubreason });
    }
    report({
      stage: "architect-result-parse",
      outcome: "malformed",
      malformedShape: "UNIQUE_DIAGNOSTIC_SENTINEL",
    });
    report({
      stage: "architect-result-parse",
      outcome: "missing-dependency",
      dependencySubreason: "UNIQUE_DIAGNOSTIC_SENTINEL",
    });
    report({ stage: "architect-result-parse", outcome: "malformed", normalization: "UNIQUE_DIAGNOSTIC_SENTINEL" });

    const readinessOutcomes = [
      "ready",
      "not-current",
      "request-timeout",
      "request-cancelled",
      "request-failed-location-not-found",
      "request-failed-agent-not-found",
      "request-failed-unauthorized",
      "request-failed-service-unavailable",
      "request-failed-other",
      "location-mismatch",
      "model-mismatch",
      "agent-mismatch-shape",
      "agent-mismatch-id",
      "agent-mismatch-model",
      "agent-mismatch-system",
      "agent-mismatch-steps",
      "agent-mismatch-mode",
      "agent-mismatch-hidden",
      "agent-mismatch-permissions",
      "agent-mismatch-tools",
      "generation-stale",
    ] as const;
    for (const outcome of readinessOutcomes) {
      report({ stage: "review-readiness", outcome, elapsedMs: 1 });
    }

    const nativeErrorOutcomes = [
      "native-invalid-request",
      "native-authentication",
      "native-service-unavailable",
      "native-location-not-found",
      "native-agent-not-found",
      "native-session-not-found",
      "native-provider-not-found",
      "native-context-limit",
      "native-other",
      "client-transport",
      "client-protocol",
      "client-unexpected-status",
      "client-unexpected-status-4xx",
      "client-unexpected-status-5xx",
      "client-other",
      "other",
    ] as const;
    for (const outcome of nativeErrorOutcomes) {
      report({ stage: "architect-native-error", outcome });
    }
    report({ stage: "architect-native-error", outcome: "UNIQUE_NATIVE_TYPE_SENTINEL" });

    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toHaveLength(
      parseOutcomes.length + dependencySubreasons.length + readinessOutcomes.length + nativeErrorOutcomes.length,
    );
    expect(messages[0]).toBe(
      "[OpenCode Scribe reasoning] stage=architect-result-parse outcome=malformed shape=shape-prose-wrapped normalization=fenced",
    );
    expect(messages[parseOutcomes.length]).toBe(
      "[OpenCode Scribe reasoning] stage=architect-result-parse outcome=missing-dependency dependencySubreason=dependency-unknown-conclusion",
    );
    expect(
      messages
        .slice(parseOutcomes.length, parseOutcomes.length + dependencySubreasons.length)
        .map((message) => message.split("dependencySubreason=")[1]),
    ).toEqual(dependencySubreasons);
    expect(
      messages
        .slice(parseOutcomes.length + dependencySubreasons.length)
        .slice(0, readinessOutcomes.length)
        .every((message) => message.startsWith("[OpenCode Scribe reasoning] stage=review-readiness outcome=")),
    ).toBe(true);
    expect(
      messages
        .slice(parseOutcomes.length + dependencySubreasons.length + readinessOutcomes.length)
        .every((message) => message.startsWith("[OpenCode Scribe reasoning] stage=architect-native-error outcome=")),
    ).toBe(true);
    expect(messages.join(" ")).not.toMatch(/UNIQUE_DIAGNOSTIC_SENTINEL|UNIQUE_NATIVE_TYPE_SENTINEL/u);
  });

  it("accepts and formats manual provider readiness precheck outcomes", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);

    report({ stage: "manual-provider", outcome: "precheck-not-ready" });
    report({ stage: "manual-provider", outcome: "postcheck-not-ready" });

    expect(sink.mock.calls.map(([, message]) => message)).toEqual([
      "[OpenCode Scribe reasoning] stage=manual-provider outcome=precheck-not-ready",
      "[OpenCode Scribe reasoning] stage=manual-provider outcome=postcheck-not-ready",
    ]);
  });

  it("accepts only bounded reviewer failure classifications and validator codes", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);
    const reviewerOutcomes = [
      "context-ownership-failed",
      "provider-sdk-error",
      "provider-timeout",
      "provider-invalid-response",
      "json-parse-failed",
      "wrong-top-level-keys",
      "validator-failed",
      "thrown-exception",
      "stage-cancelled",
      "success",
    ] as const;
    const validationCodes = [
      "malformed",
      "unknown-field",
      "unsafe-value",
      "over-limit",
      "duplicate-identifier",
      "unknown-target",
      "provenance",
      "policy",
      "ambiguous",
    ] as const;

    for (const stage of ["manual-prover", "manual-verifier"] as const) {
      for (const outcome of reviewerOutcomes) report({ stage, outcome, elapsedMs: 1 });
      for (const validationCode of validationCodes)
        report({ stage, outcome: "validator-failed", validationCode, elapsedMs: 1, error: "PRIVATE_ERROR_SENTINEL" });
    }
    report({
      stage: "manual-prover",
      outcome: "validator-failed",
      validationCode: "PRIVATE_VALIDATION_SENTINEL",
    });

    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toHaveLength(2 * (reviewerOutcomes.length + validationCodes.length));
    expect(messages, messages.join("\n")).toContain(
      "[OpenCode Scribe reasoning] stage=manual-prover outcome=validator-failed validationCode=unknown-target elapsedMs=1",
    );
    expect(messages).toContain(
      "[OpenCode Scribe reasoning] stage=manual-verifier outcome=provider-invalid-response elapsedMs=1",
    );
    expect(messages.join(" ")).not.toMatch(/PRIVATE_ERROR_SENTINEL|PRIVATE_VALIDATION_SENTINEL/u);
  });

  it("accepts only the fixed AF projection detail outcomes", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);

    for (const outcome of CLAIM_PROJECTION_DIAGNOSTIC_OUTCOMES) {
      report({ stage: "af-projection", outcome, statement: "UNIQUE_PROJECTION_STATEMENT_SENTINEL" });
    }
    report({ stage: "af-projection", outcome: "UNIQUE_PROJECTION_OUTCOME_SENTINEL" });

    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toHaveLength(CLAIM_PROJECTION_DIAGNOSTIC_OUTCOMES.length);
    expect(messages).toContain(
      "[OpenCode Scribe reasoning] stage=af-projection outcome=projection-statement-shell-token",
    );
    expect(messages).toContain("[OpenCode Scribe reasoning] stage=af-projection outcome=projection-begin-not-ready");
    expect(messages.join(" ")).not.toMatch(/UNIQUE_PROJECTION_(?:STATEMENT|OUTCOME)_SENTINEL/u);
  });

  it("rejects hostile labels and invalid metrics while clamping oversized latency", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);

    report({ stage: "architect", outcome: "malicious prompt/model text" });
    report({ stage: "architect", outcome: "argument", elapsedMs: Number.NaN });
    report({ stage: "architect", outcome: "argument", elapsedMs: Number.POSITIVE_INFINITY });
    report({ stage: "architect", outcome: "argument", elapsedMs: -1 });
    report({ stage: "architect", outcome: "argument", elapsedMs: Number.MAX_SAFE_INTEGER });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[1]).toBe(
      `[OpenCode Scribe reasoning] stage=architect outcome=argument elapsedMs=${REASONING_DIAGNOSTIC_MAX_ELAPSED_MS}`,
    );
  });

  it("enforces one total per-instance cap across repeated and distinct outcomes", () => {
    const sink = vi.fn();
    const report = createReasoningDiagnosticReporter(sink);

    const stages = ["total", "architect-instructions", "architect-generate", "architect-cleanup"] as const;
    const outcomes = ["ordinary", "timeout", "success", "failed"] as const;
    for (let index = 0; index < REASONING_DIAGNOSTIC_RECORD_LIMIT * 2; index++) {
      report({ stage: stages[index % stages.length], outcome: outcomes[index % outcomes.length], elapsedMs: index });
    }

    expect(sink).toHaveBeenCalledTimes(REASONING_DIAGNOSTIC_RECORD_LIMIT);
  });

  it("does not throw or fall back to console when the configured sink fails", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const report = createReasoningDiagnosticReporter(() => {
      throw new Error("private sink failure");
    });

    expect(() => report({ stage: "dispatch", outcome: "dispatch-failed", elapsedMs: 2 })).not.toThrow();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("provides a non-throwing monotonic clock when the injected clock is hostile", () => {
    const clock = createReasoningDiagnosticClock(() => {
      throw new Error("private clock failure");
    });
    const first = clock();
    const second = clock();

    expect(Number.isFinite(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it("uses console only when no sink was configured", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const report = createReasoningDiagnosticReporter();

    report({ stage: "runtime", outcome: "af-unavailable" });

    expect(consoleSpy).toHaveBeenCalledWith("[OpenCode Scribe reasoning] stage=runtime outcome=af-unavailable");
  });
});
