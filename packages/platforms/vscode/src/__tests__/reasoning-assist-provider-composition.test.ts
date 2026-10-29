import {
  createRestrictedReviewProvider,
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
  type RestrictedReviewObservation,
  type RestrictedReviewProvider,
} from "@opencode-chat/agent-opencode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdversarialReviewSeam } from "../vibefeld/adversarial-review-seam";
import { createClaimProjectionSeam } from "../vibefeld/claim-projection-seam";
import {
  createCompletedAnswerClaimMapper,
  MANUAL_REVIEW_MAPPING_TIMEOUT_MS,
} from "../vibefeld/completed-answer-claim-mapper";
import { ComposedReasoningReviewController } from "../vibefeld/composed-reasoning-review-controller";
import { hiddenSessionRegistry } from "../vibefeld/hidden-session-registry";
import { parseArchitectResult } from "../vibefeld/reasoning-assist-architect";
import { composeReasoningAssistBrief } from "../vibefeld/reasoning-assist-brief";
import { runReasoningAssistPreflight } from "../vibefeld/reasoning-assist-orchestrator";
import type { ReasoningDiagnosticReporter } from "../vibefeld/reasoning-diagnostics";
import { createReasoningDiagnosticReporter } from "../vibefeld/reasoning-diagnostics";
import { createRestrictedReviewAdapter } from "../vibefeld/restricted-review-adapter";
import { RestrictedReviewHolder } from "../vibefeld/restricted-review-holder";

const argumentResult = JSON.stringify({
  kind: "argument",
  conclusionId: "claim-conclusion",
  claims: [
    {
      id: "claim-conclusion",
      class: "empirical",
      statement: "The observed evidence supports this bounded conclusion.",
      dependsOn: [],
    },
  ],
  assumptions: [],
  evidenceNeeds: [{ claimId: "claim-conclusion", sourceKind: "observation", status: "source_recorded" }],
  uncertainty: ["The observation may be incomplete."],
});
const ordinaryResult = JSON.stringify({ kind: "ordinary" });
const validProverResponse = JSON.stringify({
  proposalId: "proposal-1",
  objections: [
    {
      objectionId: "objection-1",
      target: { kind: "claim", id: "claim-conclusion" },
      severity: "major",
      reason: "A stated dependency may not support this claim.",
    },
  ],
});
const validVerifierResponse = JSON.stringify({
  proposalId: "proposal-1",
  dispositions: [
    {
      objectionId: "objection-1",
      disposition: "confirmed",
      reason: "The objection remains open under the supplied argument.",
    },
  ],
});

type ReviewerRole = "prover" | "verifier";
type ReviewerResponse =
  | Readonly<{ text: string }>
  | Readonly<{ errorName: string; errorMessage: string }>
  | Readonly<{ invalidAdmission: true }>;

type Deferred<T> = Readonly<{ promise: Promise<T>; resolve: (value: T) => void }>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function fakeNativeClient(resultText: string) {
  let nextSessionId = 0;
  let nextMessageId = 0;
  let currentResultText = resultText;
  let waitBeforeProverPrompt: (() => Promise<void>) | undefined;
  let waitBeforeVerifierPrompt: (() => Promise<void>) | undefined;
  const reviewerResponses: Record<ReviewerRole, ReviewerResponse> = {
    prover: { text: JSON.stringify({ proposalId: "proposal-1", objections: [] }) },
    verifier: { text: JSON.stringify({ proposalId: "proposal-1", dispositions: [] }) },
  };
  const instructions = new Map<string, string>();
  const assistantSnapshots = new Map<string, unknown>();
  const events: string[] = [];
  const client = {
    agent: {
      get: vi.fn(async () => {
        events.push("readiness");
        return {
          location: { directory: "/workspace" },
          data: {
            id: RESTRICTED_REVIEW_AGENT_NAME,
            model: undefined,
            system: "fixed review system",
            steps: 4,
            mode: "subagent",
            hidden: true,
            permissions: [...new Set(["*", ...RESTRICTED_REVIEW_AUTHORITIES])].map((action) => ({
              action,
              resource: "*",
              effect: "deny",
            })),
          },
        };
      }),
    },
    session: {
      create: vi.fn(async () => {
        events.push("createSession");
        return {
          id: `ses_review_${++nextSessionId}`,
          agent: RESTRICTED_REVIEW_AGENT_NAME,
          model: { providerID: "provider", id: "model" },
          location: { directory: "/workspace" },
        };
      }),
      instructions: {
        entry: {
          put: vi.fn(
            async ({ sessionID, value }: { sessionID: string; value: string }, _options?: { signal?: AbortSignal }) => {
              instructions.set(sessionID, value);
            },
          ),
        },
      },
      generate: vi.fn(async (_input: unknown, _options: { signal?: AbortSignal }) => {
        events.push("generate");
        return { text: currentResultText };
      }),
      wait: vi.fn(async () => undefined),
      prompt: vi.fn(async ({ sessionID, text }: { sessionID: string; text: string }) => {
        const instruction = instructions.get(sessionID);
        const reviewerRole =
          instruction === RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION
            ? "prover"
            : instruction === RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION
              ? "verifier"
              : undefined;
        if (reviewerRole) events.push(`prompt:${reviewerRole}`);
        if (reviewerRole === "prover") {
          const wait = waitBeforeProverPrompt;
          waitBeforeProverPrompt = undefined;
          await wait?.();
        }
        if (reviewerRole === "verifier") {
          const wait = waitBeforeVerifierPrompt;
          waitBeforeVerifierPrompt = undefined;
          await wait?.();
        }
        const reviewerResponse = reviewerRole ? reviewerResponses[reviewerRole] : undefined;
        if (reviewerResponse && "errorName" in reviewerResponse) {
          throw Object.assign(new Error(reviewerResponse.errorMessage), { name: reviewerResponse.errorName });
        }
        if (reviewerResponse && "invalidAdmission" in reviewerResponse) return {} as never;
        const replyText = reviewerResponse && "text" in reviewerResponse ? reviewerResponse.text : ordinaryResult;
        assistantSnapshots.set(sessionID, {
          id: `msg_review_${++nextMessageId}`,
          type: "assistant",
          agent: RESTRICTED_REVIEW_AGENT_NAME,
          model: { providerID: "provider", id: "model" },
          content: [{ type: "text", text: replyText }],
          time: { completed: nextMessageId },
          finish: "stop",
        });
        return {
          id: "inbox_review",
          sessionID,
          type: "user",
          payload: { text },
        };
      }),
      interrupt: vi.fn(async () => undefined),
      remove: vi.fn(async (_input: { sessionID: string }) => {
        events.push("remove");
      }),
    },
    message: {
      list: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
        data: assistantSnapshots.has(sessionID) ? [assistantSnapshots.get(sessionID)] : [],
      })),
    },
  };
  return {
    client,
    events,
    setResultText: (value: string) => {
      currentResultText = value;
    },
    setBeforeProverPrompt: (wait: () => Promise<void>) => {
      waitBeforeProverPrompt = wait;
    },
    setBeforeVerifierPrompt: (wait: () => Promise<void>) => {
      waitBeforeVerifierPrompt = wait;
    },
    setReviewerResponse: (role: ReviewerRole, response: ReviewerResponse) => {
      reviewerResponses[role] = response;
    },
  };
}

function makeProvider(
  client: ReturnType<typeof fakeNativeClient>["client"],
  currentGeneration: () => number = () => 1,
  observation: Readonly<{ observe?: (event: RestrictedReviewObservation) => void; now?: () => number }> = {},
): RestrictedReviewProvider {
  return createRestrictedReviewProvider({
    client: client as never,
    directory: "/workspace",
    restrictedReview: {
      modelResolution: "native-default",
      prompt: "fixed review system",
      maxSteps: 4,
    },
    hostPinnedModel: { providerID: "provider", modelID: "model" },
    generation: currentGeneration(),
    currentGeneration,
    ...observation,
  });
}

function manualReviewHarness(
  fixture: ReturnType<typeof fakeNativeClient>,
  diagnostics?: ReasoningDiagnosticReporter,
  totalTimeoutMs?: number,
) {
  const provider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
  const runStage = vi.spyOn(provider, "runStage");
  const adapter = createRestrictedReviewAdapter({ provider, stageTimeoutMs: 500, diagnostics });
  const project = vi.fn(async () => ({ status: "structurally_checked" as const }));
  const projection = createClaimProjectionSeam({
    capability: { supported: true, operation: "claim_projection" },
    project,
  });
  const controller = new ComposedReasoningReviewController(projection, createAdversarialReviewSeam(adapter), {
    readinessCheck: () => provider.checkReadiness(),
    mapCompletedAnswer: createCompletedAnswerClaimMapper(adapter, { diagnostics }),
    reviewLifecycle: provider,
    diagnostics,
    ...(totalTimeoutMs === undefined ? {} : { totalTimeoutMs }),
  });
  return { provider, runStage, adapter, projection, project, controller };
}

describe("automatic reasoning-assist provider composition", () => {
  afterEach(() => {
    hiddenSessionRegistry.reset();
  });

  it("classifies an argument through the native restricted provider, adapter, and automatic orchestrator", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const provider = makeProvider(fixture.client);
    const automaticProvider = makeProvider(fixture.client);
    const beginReview = automaticProvider.beginReview.bind(automaticProvider);
    automaticProvider.beginReview = vi.fn(async () => {
      fixture.events.push("beginReview");
      return beginReview();
    });
    const adapter = createRestrictedReviewAdapter({
      provider,
      createAutomaticProvider: async () => automaticProvider,
      stageTimeoutMs: 500,
    });
    const record = vi.fn(async () => "recorded" as const);
    const publishProgress = vi.fn();

    const outcome = await runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      structureRecorder: { isSupported: () => true, record },
      isCurrent: () => true,
      publishProgress,
    });

    expect(outcome).toMatchObject({ kind: "argument" });
    if (outcome.kind !== "argument") throw new Error("expected a validated argument result");
    expect(fixture.client.session.generate).toHaveBeenCalledTimes(1);
    expect(automaticProvider.beginReview).toHaveBeenCalledTimes(1);
    expect(fixture.events.slice(0, 3)).toEqual(["readiness", "beginReview", "createSession"]);
    expect(record).toHaveBeenCalledWith(outcome.graph, expect.any(AbortSignal));
    expect(outcome.afState).toBe("recorded");
    expect(composeReasoningAssistBrief({ facts: outcome.facts, afState: outcome.afState })).toContain(
      "AF fact: structure recorded",
    );
    expect(publishProgress).toHaveBeenCalledWith("mapping", expect.any(String));
    expect(publishProgress).toHaveBeenCalledWith("recording", expect.any(String));
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(1);

    await adapter.dispose();
  });

  it("reports the shared native architect pipeline for automatic and manual flows", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const observation = { observe: diagnostics };
    const manualProvider = makeProvider(fixture.client, () => 1, observation);
    const automaticProviders: RestrictedReviewProvider[] = [];
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => {
        const automaticProvider = makeProvider(fixture.client, () => 1, observation);
        automaticProviders.push(automaticProvider);
        return automaticProvider;
      },
      stageTimeoutMs: 500,
      diagnostics,
    });

    const automatic = await runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      isCurrent: () => true,
      publishProgress: vi.fn(),
      onDiagnostic: diagnostics,
    });
    expect(automatic.kind).toBe("argument");

    await manualProvider.checkReadiness();
    const projection = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: async () => ({ status: "structurally_checked" }),
    });
    const controller = new ComposedReasoningReviewController(projection, createAdversarialReviewSeam(adapter), {
      readinessCheck: async () => manualProvider.isReady() && (await manualProvider.checkReadiness()),
      mapCompletedAnswer: createCompletedAnswerClaimMapper(adapter, { diagnostics }),
      reviewLifecycle: manualProvider,
      diagnostics,
    });
    await expect(
      controller.review({
        sessionId: "chat-session",
        messageId: "msg_completed_answer",
        sourceText: "A completed argument to review.",
        invocation: "manual",
      }),
    ).resolves.toMatchObject({ reviewedMessageId: "msg_completed_answer" });

    const messages = sink.mock.calls.map(([, message]) => String(message));
    for (const stage of ["architect-instructions", "architect-generate"]) {
      expect(messages.filter((message) => message.includes(`stage=${stage} outcome=started`))).toHaveLength(2);
      expect(messages.filter((message) => message.includes(`stage=${stage} outcome=completed`))).toHaveLength(2);
    }
    expect(messages.filter((message) => message.includes("stage=architect-response outcome=success"))).toHaveLength(2);
    expect(messages.filter((message) => message.includes("stage=architect-result-parse outcome=success"))).toHaveLength(
      2,
    );
    expect(messages.filter((message) => message.includes("stage=architect-cleanup outcome=completed"))).toHaveLength(2);
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-provider outcome=ready"));
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-readiness outcome=ready"));
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-context outcome=ready"));
    expect(fixture.client.session.generate).toHaveBeenCalledTimes(2);
    expect(automaticProviders).toHaveLength(1);
    expect(messages.join(" ")).not.toMatch(
      /chat-session|completed_answer|provider\/model|observed evidence|private|workspace/u,
    );
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    await adapter.dispose();
  });

  it("publishes the same bounded native error category to automatic and manual consumers", async () => {
    const fixture = fakeNativeClient(argumentResult);
    fixture.client.session.generate.mockRejectedValue(
      Object.assign(new Error("PRIVATE_NATIVE_FAILURE_SENTINEL"), { _tag: "ServiceUnavailableError" }),
    );
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const manualProvider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
    const automaticProvider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => automaticProvider,
      stageTimeoutMs: 500,
      diagnostics,
    });

    await expect(
      runReasoningAssistPreflight({
        sessionId: "PRIVATE_SESSION_SENTINEL",
        userText: "PRIVATE_PROMPT_SENTINEL",
        adapter,
        isCurrent: () => true,
        publishProgress: vi.fn(),
      }),
    ).resolves.toMatchObject({ kind: "dispatch-unchanged", reason: "stage-failed-model" });

    await manualProvider.beginReview();
    const mapper = createCompletedAnswerClaimMapper(adapter, { diagnostics });
    await expect(mapper("PRIVATE_ANSWER_SENTINEL", new AbortController().signal)).resolves.toBeUndefined();

    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(
      messages.filter((message) => message.includes("stage=architect-native-error outcome=native-service-unavailable")),
    ).toHaveLength(2);
    expect(messages).toContainEqual(expect.stringContaining("stage=manual-mapping outcome=stage-failed-model"));
    expect(messages.join(" ")).not.toMatch(/PRIVATE_NATIVE_FAILURE|PRIVATE_SESSION|PRIVATE_PROMPT|PRIVATE_ANSWER/u);
    await adapter.dispose();
  });

  it("publishes provider readiness detail before the existing manual readiness-rejected line", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const provider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
    fixture.client.agent.get.mockRejectedValueOnce(new Error("UNIQUE_READINESS_FAILURE_SENTINEL"));
    const adapter = createRestrictedReviewAdapter({
      provider,
      createAutomaticProvider: async () => provider,
      stageTimeoutMs: 500,
      diagnostics,
    });
    const projection = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: async () => ({ status: "structurally_checked" }),
    });
    const controller = new ComposedReasoningReviewController(projection, createAdversarialReviewSeam(adapter), {
      readinessCheck: () => provider.checkReadiness(),
      mapCompletedAnswer: async () => undefined,
      reviewLifecycle: provider,
      diagnostics,
    });

    await expect(
      controller.review({
        sessionId: "chat-session",
        messageId: "msg_completed_answer",
        sourceText: "A completed argument to review.",
        invocation: "manual",
      }),
    ).resolves.toMatchObject({ status: "unavailable" });

    const messages = sink.mock.calls.map(([, message]) => String(message));
    const readinessIndex = messages.findIndex((message) =>
      message.includes("stage=review-readiness outcome=request-failed-other"),
    );
    const rejectedIndex = messages.findIndex((message) =>
      message.includes("stage=manual-provider outcome=readiness-rejected"),
    );
    expect(readinessIndex).toBeGreaterThanOrEqual(0);
    expect(rejectedIndex).toBeGreaterThan(readinessIndex);
    expect(messages.join(" ")).not.toContain("UNIQUE_READINESS_FAILURE_SENTINEL");
    expect(fixture.client.session.create).not.toHaveBeenCalled();
    await adapter.dispose();
  });

  it.each(["instructions", "generate"] as const)(
    "localizes a stalled architect %s operation without merging its timeout label",
    async (stalledOperation) => {
      const fixture = fakeNativeClient(argumentResult);
      const sink = vi.fn();
      const diagnostics = createReasoningDiagnosticReporter(sink);
      const manualProvider = makeProvider(fixture.client);
      const automaticProvider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
      if (stalledOperation === "instructions") {
        fixture.client.session.instructions.entry.put.mockImplementationOnce(() => new Promise(() => undefined));
      } else {
        fixture.client.session.generate.mockImplementationOnce(
          (_input, options) =>
            new Promise((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
            }),
        );
      }
      const adapter = createRestrictedReviewAdapter({
        provider: manualProvider,
        createAutomaticProvider: async () => automaticProvider,
        stageTimeoutMs: 25,
        diagnostics,
      });

      await expect(
        runReasoningAssistPreflight({
          sessionId: "chat-session",
          userText: "Should this conclusion follow from the observed evidence?",
          adapter,
          isCurrent: () => true,
          publishProgress: vi.fn(),
        }),
      ).resolves.toMatchObject({ kind: "dispatch-unchanged", reason: "stage-failed-timeout" });

      const messages = sink.mock.calls.map(([, message]) => String(message));
      expect(messages).toContainEqual(expect.stringContaining("stage=architect-instructions outcome=started"));
      if (stalledOperation === "instructions") {
        expect(messages).toContainEqual(expect.stringContaining("stage=architect-instructions outcome=timeout"));
        expect(messages.some((message) => message.includes("stage=architect-generate outcome="))).toBe(false);
        expect(fixture.client.session.generate).not.toHaveBeenCalled();
      } else {
        expect(messages).toContainEqual(expect.stringContaining("stage=architect-instructions outcome=completed"));
        expect(messages).toContainEqual(expect.stringContaining("stage=architect-generate outcome=started"));
        expect(messages).toContainEqual(expect.stringContaining("stage=architect-generate outcome=timeout"));
      }
      expect(messages).toContainEqual(expect.stringContaining("stage=architect-cleanup outcome=completed"));
      expect(messages.join(" ")).not.toMatch(/chat-session|provider\/model|observed evidence|private|workspace/u);
      await adapter.dispose();
    },
  );

  it("reports a bounded failed outcome when architect child cleanup fails", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const manualProvider = makeProvider(fixture.client);
    const automaticProvider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
    fixture.client.session.remove.mockRejectedValue(new Error("private cleanup failure"));
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => automaticProvider,
      stageTimeoutMs: 100,
      diagnostics,
    });

    await expect(
      runReasoningAssistPreflight({
        sessionId: "chat-session",
        userText: "Should this conclusion follow from the observed evidence?",
        adapter,
        isCurrent: () => true,
        publishProgress: vi.fn(),
      }),
    ).resolves.toMatchObject({ kind: "argument" });

    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-cleanup outcome=failed"));
    expect(messages.join(" ")).not.toMatch(/private cleanup failure|chat-session|provider\/model/u);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
  });

  it("propagates explicit abort into the in-flight architect native request and reports cancellation", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const manualProvider = makeProvider(fixture.client);
    const automaticProvider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
    const generateGate = deferred<{ text: string }>();
    fixture.client.session.generate.mockImplementationOnce(() => generateGate.promise);
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => automaticProvider,
      stageTimeoutMs: 500,
      diagnostics,
    });
    const controller = new AbortController();
    const preflight = runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted,
      publishProgress: vi.fn(),
    });

    await vi.waitFor(() => expect(fixture.client.session.generate).toHaveBeenCalledTimes(1));
    controller.abort();
    generateGate.resolve({ text: argumentResult });
    await expect(preflight).resolves.toMatchObject({ kind: "stale" });

    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-generate outcome=cancelled"));
    expect(messages.some((message) => message.includes("stage=architect-response outcome=success"))).toBe(false);
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-cleanup outcome=completed"));
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(1);
    await adapter.dispose();
  });

  it("shows the unchanged 30-second manual mapper budget cancelling the in-flight native instruction update", async () => {
    vi.useFakeTimers();
    try {
      expect(MANUAL_REVIEW_MAPPING_TIMEOUT_MS).toBe(30_000);
      const fixture = fakeNativeClient(argumentResult);
      const sink = vi.fn();
      const diagnostics = createReasoningDiagnosticReporter(sink);
      const provider = makeProvider(fixture.client, () => 1, { observe: diagnostics });
      await provider.checkReadiness();
      await provider.beginReview();
      const adapter = createRestrictedReviewAdapter({
        provider,
        stageTimeoutMs: 30_000,
        diagnostics,
        now: () => 0,
      });
      let instructionStarted!: () => void;
      let nativeInstructionSignal: AbortSignal | undefined;
      const started = new Promise<void>((resolve) => {
        instructionStarted = resolve;
      });
      fixture.client.session.instructions.entry.put.mockImplementationOnce((_input, options) => {
        nativeInstructionSignal = options?.signal;
        instructionStarted();
        return new Promise(() => undefined);
      });
      const mapper = createCompletedAnswerClaimMapper(adapter, {
        stageTimeoutMs: MANUAL_REVIEW_MAPPING_TIMEOUT_MS,
        diagnostics,
        now: () => 0,
      });
      const mapping = mapper("A completed argument to review.", new AbortController().signal);

      await started;
      await vi.advanceTimersByTimeAsync(MANUAL_REVIEW_MAPPING_TIMEOUT_MS);
      await expect(mapping).resolves.toBeUndefined();

      const messages = sink.mock.calls.map(([, message]) => String(message));
      expect(messages).toContainEqual(expect.stringContaining("stage=architect-instructions outcome=started"));
      expect(messages).toContainEqual(expect.stringContaining("stage=architect-instructions outcome=timeout"));
      expect(messages).toContainEqual(expect.stringContaining("stage=manual-mapping outcome=stage-timeout"));
      expect(messages.some((message) => message.includes("stage=architect-generate outcome="))).toBe(false);
      expect(nativeInstructionSignal?.aborted).toBe(true);
      expect(nativeInstructionSignal?.reason).toMatchObject({ name: "TimeoutError" });
      expect(fixture.client.session.generate).not.toHaveBeenCalled();
      expect(messages).toContainEqual(expect.stringContaining("stage=architect-cleanup outcome=completed"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps semantic ordinary turns unchanged and allocates a fresh review for the next turn", async () => {
    const fixture = fakeNativeClient(ordinaryResult);
    const manualProvider = makeProvider(fixture.client);
    const automaticProviders: RestrictedReviewProvider[] = [];
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => {
        const automaticProvider = makeProvider(fixture.client);
        automaticProviders.push(automaticProvider);
        return automaticProvider;
      },
      stageTimeoutMs: 500,
    });
    const record = vi.fn(async () => "recorded" as const);
    const ordinaryProgress = vi.fn();

    const ordinary = await runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Please summarize the possible cause and available evidence.",
      adapter,
      structureRecorder: { isSupported: () => true, record },
      isCurrent: () => true,
      publishProgress: ordinaryProgress,
    });

    expect(ordinary).toMatchObject({ kind: "dispatch-unchanged", reason: "ordinary" });
    expect(fixture.client.session.generate).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
    expect(ordinaryProgress).not.toHaveBeenCalled();
    expect(hiddenSessionRegistry.liveCount()).toBe(0);

    fixture.setResultText(argumentResult);
    const nextTurn = await runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      isCurrent: () => true,
      publishProgress: vi.fn(),
    });

    expect(nextTurn.kind).toBe("argument");
    expect(automaticProviders).toHaveLength(2);
    expect(automaticProviders[0]).not.toBe(automaticProviders[1]);
    expect(fixture.client.session.create).toHaveBeenCalledTimes(2);
    expect(fixture.client.session.generate).toHaveBeenCalledTimes(2);
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(2);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    await adapter.dispose();
  });

  it("cancels a delayed begin without creating a hidden session or retaining a late token", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const manualProvider = makeProvider(fixture.client);
    const automaticProvider = makeProvider(fixture.client);
    const beginGate = deferred<void>();
    const actualBegin = automaticProvider.beginReview.bind(automaticProvider);
    const actualInvalidate = automaticProvider.invalidate.bind(automaticProvider);
    let beginCompletion: Promise<number> | undefined;
    automaticProvider.beginReview = vi.fn(() => {
      fixture.events.push("beginReview");
      beginCompletion = beginGate.promise.then(actualBegin);
      return beginCompletion;
    });
    automaticProvider.invalidate = vi.fn(actualInvalidate);
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => automaticProvider,
      stageTimeoutMs: 500,
    });
    const abort = new AbortController();
    const preflight = runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      signal: abort.signal,
      isCurrent: () => !abort.signal.aborted,
      publishProgress: vi.fn(),
    });

    await vi.waitFor(() => expect(automaticProvider.beginReview).toHaveBeenCalledTimes(1));
    abort.abort();
    beginGate.resolve(undefined);
    await beginCompletion;
    await expect(preflight).resolves.toMatchObject({ kind: "stale" });

    expect(fixture.client.session.create).not.toHaveBeenCalled();
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    expect(automaticProvider.invalidate).toHaveBeenCalledTimes(1);
    await adapter.dispose();
  });

  it("cancels a delayed create and removes its late native child and hidden registration", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const manualProvider = makeProvider(fixture.client);
    const automaticProvider = makeProvider(fixture.client);
    const createGate = deferred<{
      id: string;
      agent: string;
      model: { providerID: string; id: string };
      location: { directory: string };
    }>();
    fixture.client.session.create.mockImplementationOnce(() => createGate.promise);
    const actualCancelReview = automaticProvider.cancelReview.bind(automaticProvider);
    automaticProvider.cancelReview = vi.fn((token: number) => {
      fixture.events.push("cancelReview");
      return actualCancelReview(token);
    });
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => automaticProvider,
      stageTimeoutMs: 500,
    });
    const abort = new AbortController();
    const preflight = runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      signal: abort.signal,
      isCurrent: () => !abort.signal.aborted,
      publishProgress: vi.fn(),
    });

    await vi.waitFor(() => expect(fixture.client.session.create).toHaveBeenCalledTimes(1));
    expect(hiddenSessionRegistry.liveCount()).toBe(1);
    abort.abort();
    await vi.waitFor(() => expect(automaticProvider.cancelReview).toHaveBeenCalledWith(1));
    createGate.resolve({
      id: "ses_delayed_create",
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      model: { providerID: "provider", id: "model" },
      location: { directory: "/workspace" },
    });

    await expect(preflight).resolves.toMatchObject({ kind: "stale" });
    expect(fixture.client.session.interrupt).toHaveBeenCalledTimes(1);
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(1);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    await adapter.dispose();
  });

  it.each(["failure", "timeout"] as const)("cleans the generation-owned child after architect %s", async (mode) => {
    const fixture = fakeNativeClient(argumentResult);
    const manualProvider = makeProvider(fixture.client);
    const automaticProvider = makeProvider(fixture.client);
    const actualCancelReview = automaticProvider.cancelReview.bind(automaticProvider);
    automaticProvider.cancelReview = vi.fn(actualCancelReview);
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => automaticProvider,
      stageTimeoutMs: mode === "timeout" ? 25 : 500,
    });
    if (mode === "failure") {
      fixture.client.session.generate.mockRejectedValueOnce(new Error("private native failure"));
    } else {
      fixture.client.session.generate.mockImplementationOnce(
        (_input, options) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
          }),
      );
    }

    const outcome = await runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      isCurrent: () => true,
      publishProgress: vi.fn(),
    });

    expect(outcome).toMatchObject({
      kind: "dispatch-unchanged",
      reason: mode === "timeout" ? "stage-failed-timeout" : "stage-failed-model",
    });
    expect(automaticProvider.cancelReview).toHaveBeenCalledWith(1);
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(1);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    await adapter.dispose();
  });

  it("suppresses a late architect completion after rebind and leaves no old-generation context", async () => {
    const fixture = fakeNativeClient(argumentResult);
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    let generation = 1;
    const generateGate = deferred<{ text: string }>();
    fixture.client.session.generate.mockImplementationOnce(() => generateGate.promise);
    const controllers = new Set<AbortController>();
    const automaticProviders: RestrictedReviewProvider[] = [];
    const holder = new RestrictedReviewHolder({
      afRuntime: { state: "available" },
      createProvider: async () => ({
        ok: true,
        provider: makeProvider(fixture.client, () => generation, { observe: diagnostics }),
      }),
      createBinding: async (reviewProvider) => {
        const automaticProvider = makeProvider(fixture.client, () => generation, { observe: diagnostics });
        automaticProviders.push(automaticProvider);
        return {
          adapter: createRestrictedReviewAdapter({
            provider: reviewProvider,
            createAutomaticProvider: async () => automaticProvider,
            stageTimeoutMs: 500,
            diagnostics,
          }),
        };
      },
      cancelWork: () => {
        for (const controller of controllers) controller.abort();
      },
    });
    await holder.rebind();
    const oldAdapter = holder.getSnapshot().adapter;
    if (!oldAdapter) throw new Error("initial holder binding was not available");
    const abort = new AbortController();
    controllers.add(abort);
    const preflight = runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter: oldAdapter,
      signal: abort.signal,
      isCurrent: () => !abort.signal.aborted,
      publishProgress: vi.fn(),
    });

    await vi.waitFor(() => expect(fixture.client.session.generate).toHaveBeenCalledTimes(1));
    generation = 2;
    await holder.rebind();
    expect(holder.getSnapshot().adapter).not.toBe(oldAdapter);
    generateGate.resolve({ text: argumentResult });

    await expect(preflight).resolves.toMatchObject({ kind: "stale" });
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(1);
    expect(automaticProviders).toHaveLength(2);
    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-generate outcome=cancelled"));
    expect(messages).toContainEqual(expect.stringContaining("stage=architect-cleanup outcome=completed"));
    expect(messages.some((message) => message.includes("stage=architect-response outcome=success"))).toBe(false);
    await holder.dispose();
  });

  it("keeps an in-flight composed manual review current while automatic ownership starts and cleans up", async () => {
    const parsed = parseArchitectResult(argumentResult);
    if (parsed.kind !== "argument") throw new Error("fixture graph is invalid");
    const fixture = fakeNativeClient(argumentResult);
    const manualProvider = makeProvider(fixture.client);
    const manualCancelReview = manualProvider.cancelReview.bind(manualProvider);
    manualProvider.cancelReview = vi.fn(manualCancelReview);
    const manualTokens: number[] = [];
    const actualBegin = manualProvider.beginReview.bind(manualProvider);
    manualProvider.beginReview = vi.fn(async () => {
      const token = await actualBegin();
      manualTokens.push(token);
      return token;
    });
    const automaticProviders: RestrictedReviewProvider[] = [];
    const adapter = createRestrictedReviewAdapter({
      provider: manualProvider,
      createAutomaticProvider: async () => {
        const automaticProvider = makeProvider(fixture.client);
        const cancelReview = automaticProvider.cancelReview.bind(automaticProvider);
        automaticProvider.cancelReview = vi.fn(cancelReview);
        automaticProviders.push(automaticProvider);
        return automaticProvider;
      },
      stageTimeoutMs: 500,
    });
    const projection = createClaimProjectionSeam({
      capability: { supported: true, operation: "claim_projection" },
      project: async () => ({ status: "structurally_checked" }),
    });
    const manual = new ComposedReasoningReviewController(projection, createAdversarialReviewSeam(adapter), {
      readinessCheck: () => true,
      mapCompletedAnswer: async () => parsed.graph,
      reviewLifecycle: manualProvider,
    });
    const proverPromptGate = deferred<void>();
    fixture.setBeforeProverPrompt(() => proverPromptGate.promise);
    await expect(
      runReasoningAssistPreflight({
        sessionId: "chat-session",
        userText: "Should this conclusion follow from the observed evidence?",
        adapter,
        isCurrent: () => true,
        publishProgress: vi.fn(),
      }),
    ).resolves.toMatchObject({ kind: "argument" });
    expect(automaticProviders).toHaveLength(1);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);

    const manualResult = manual.review({
      sessionId: "chat-session",
      messageId: "msg_completed_answer",
      sourceText: "A completed argument to review.",
      invocation: "manual",
    });

    await vi.waitFor(() => expect(fixture.client.session.prompt).toHaveBeenCalledTimes(1));
    const manualToken = manualTokens[0];
    expect(manualToken).toBeGreaterThan(0);
    expect(manualProvider.isReviewCurrent(manualToken!)).toBe(true);
    expect(hiddenSessionRegistry.liveCount()).toBe(1);

    const automatic = await runReasoningAssistPreflight({
      sessionId: "chat-session",
      userText: "Should this conclusion follow from the observed evidence?",
      adapter,
      isCurrent: () => true,
      publishProgress: vi.fn(),
    });

    expect(automatic.kind).toBe("argument");
    expect(automaticProviders).toHaveLength(2);
    expect(manualProvider.isReviewCurrent(manualToken!)).toBe(true);
    expect(manualProvider.cancelReview).not.toHaveBeenCalled();
    expect(automaticProviders[0]?.cancelReview).toHaveBeenCalledTimes(1);
    expect(automaticProviders[1]?.cancelReview).toHaveBeenCalledTimes(1);
    expect(hiddenSessionRegistry.liveCount()).toBe(1);

    proverPromptGate.resolve(undefined);
    await expect(manualResult).resolves.toMatchObject({ reviewedMessageId: "msg_completed_answer" });
    expect(manualProvider.cancelReview).toHaveBeenCalledWith(manualToken);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    expect(fixture.client.session.create).toHaveBeenCalledTimes(4);
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(4);
    await adapter.dispose();
  });
});

describe("manual reviewer provider composition", () => {
  afterEach(() => {
    hiddenSessionRegistry.reset();
  });

  it("publishes AF-authoritative results with only the validated prover/verifier challenge", async () => {
    const fixture = fakeNativeClient(argumentResult);
    fixture.setReviewerResponse("prover", { text: validProverResponse });
    fixture.setReviewerResponse("verifier", { text: validVerifierResponse });
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const harness = manualReviewHarness(fixture, diagnostics);

    const result = await harness.controller.review({
      sessionId: "PRIVATE_SESSION_SENTINEL",
      messageId: "PRIVATE_MESSAGE_SENTINEL",
      sourceText: "PRIVATE_ANSWER_SENTINEL",
      invocation: "manual",
    });

    expect(result).toMatchObject({
      reviewedMessageId: "PRIVATE_MESSAGE_SENTINEL",
      status: "conditional",
      evidenceStatus: "source_recorded",
      openChallenges: [
        {
          severity: "major",
          target: "claim:claim-conclusion",
          reason: "The objection remains open under the supplied argument.",
        },
      ],
    });
    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toContainEqual(expect.stringContaining("stage=manual-prover outcome=success"));
    expect(messages).toContainEqual(expect.stringContaining("stage=manual-verifier outcome=success"));
    expect(fixture.events.filter((event) => event.startsWith("prompt:"))).toEqual(["prompt:prover", "prompt:verifier"]);
    expect(fixture.client.session.remove).toHaveBeenCalledTimes(3);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    expect(messages.join(" ")).not.toMatch(
      /PRIVATE_SESSION_SENTINEL|PRIVATE_MESSAGE_SENTINEL|PRIVATE_ANSWER_SENTINEL|claim-conclusion|proposal-1|objection-1|provider\/model|workspace/u,
    );
    await harness.adapter.dispose();
  });

  it("shares reviewer cleanup at the total deadline without a false lifecycle-cleanup failure", async () => {
    vi.useFakeTimers();
    try {
      const fixture = fakeNativeClient(argumentResult);
      const sink = vi.fn();
      const diagnostics = createReasoningDiagnosticReporter(sink);
      const verifierGate = deferred<void>();
      let enteredVerifier!: () => void;
      const verifierEntered = new Promise<void>((resolve) => {
        enteredVerifier = resolve;
      });
      fixture.setBeforeVerifierPrompt(async () => {
        enteredVerifier();
        await verifierGate.promise;
      });
      const removedSessions = new Set<string>();
      fixture.client.session.remove.mockImplementation(async ({ sessionID }) => {
        if (removedSessions.has(sessionID)) throw new Error("session already removed");
        removedSessions.add(sessionID);
        fixture.events.push("remove");
      });
      const harness = manualReviewHarness(fixture, diagnostics, 100);

      const review = harness.controller.review({
        sessionId: "private-session",
        messageId: "private-message",
        sourceText: "A completed argument to review.",
        invocation: "manual",
      });
      await verifierEntered;
      await vi.advanceTimersByTimeAsync(100);
      const result = await review;

      expect(result.status).toBe("conditional");
      expect(result.openChallenges).toEqual([]);
      expect(result.interpretiveBoundary).toContain("prover/verifier review did not complete");
      expect(fixture.client.session.interrupt).toHaveBeenCalledTimes(3);
      expect(fixture.client.session.remove).toHaveBeenCalledTimes(3);
      expect(removedSessions.size).toBe(3);
      expect(hiddenSessionRegistry.liveCount()).toBe(0);
      const messages = sink.mock.calls.map(([, message]) => String(message));
      expect(messages).toContainEqual(expect.stringContaining("stage=manual-review outcome=deadline"));
      expect(messages).not.toContainEqual(
        expect.stringContaining("stage=manual-provider outcome=lifecycle-cleanup-failed"),
      );
      expect(messages.join(" ")).not.toContain("session already removed");

      verifierGate.resolve();
      await Promise.resolve();
      await harness.adapter.dispose();
    } finally {
      vi.useRealTimers();
      hiddenSessionRegistry.reset();
    }
  });

  const failureCases: ReadonlyArray<{
    name: string;
    role: ReviewerRole;
    response: ReviewerResponse;
    expectedDiagnostic: string;
  }> = [
    {
      name: "invalid severity",
      role: "prover",
      response: {
        text: JSON.stringify({
          proposalId: "proposal-1",
          objections: [
            {
              objectionId: "objection-1",
              target: { kind: "claim", id: "claim-conclusion" },
              severity: "fatal",
              reason: "PRIVATE_REASON_SENTINEL",
            },
          ],
        }),
      },
      expectedDiagnostic: "stage=manual-prover outcome=validator-failed validationCode=malformed",
    },
    {
      name: "unknown target",
      role: "prover",
      response: {
        text: JSON.stringify({
          proposalId: "proposal-1",
          objections: [
            {
              objectionId: "objection-1",
              target: { kind: "claim", id: "target-unknown" },
              severity: "major",
              reason: "PRIVATE_REASON_SENTINEL",
            },
          ],
        }),
      },
      expectedDiagnostic: "stage=manual-prover outcome=validator-failed validationCode=unknown-target",
    },
    {
      name: "oversized reason",
      role: "prover",
      response: {
        text: JSON.stringify({
          proposalId: "proposal-1",
          objections: [
            {
              objectionId: "objection-1",
              target: { kind: "claim", id: "claim-conclusion" },
              severity: "major",
              reason: "x".repeat(257),
            },
          ],
        }),
      },
      expectedDiagnostic: "stage=manual-prover outcome=validator-failed validationCode=over-limit",
    },
    {
      name: "wrong proposal id",
      role: "verifier",
      response: {
        text: JSON.stringify({
          proposalId: "proposal-other",
          dispositions: [{ objectionId: "objection-1", disposition: "confirmed", reason: "PRIVATE_REASON_SENTINEL" }],
        }),
      },
      expectedDiagnostic: "stage=manual-verifier outcome=validator-failed validationCode=provenance",
    },
    {
      name: "missing disposition",
      role: "verifier",
      response: { text: JSON.stringify({ proposalId: "proposal-1", dispositions: [] }) },
      expectedDiagnostic: "stage=manual-verifier outcome=validator-failed validationCode=ambiguous",
    },
    {
      name: "wrong top-level keys",
      role: "prover",
      response: { text: JSON.stringify({ proposalId: "proposal-1", objections: [], extra: "PRIVATE_SENTINEL" }) },
      expectedDiagnostic: "stage=manual-prover outcome=wrong-top-level-keys",
    },
    {
      name: "wrong nested keys",
      role: "prover",
      response: {
        text: JSON.stringify({
          proposalId: "proposal-1",
          objections: [
            {
              objectionId: "objection-1",
              target: { kind: "claim", id: "claim-conclusion" },
              severity: "major",
              reason: "PRIVATE_REASON_SENTINEL",
              extra: true,
            },
          ],
        }),
      },
      expectedDiagnostic: "stage=manual-prover outcome=validator-failed validationCode=unknown-field",
    },
    {
      name: "malformed JSON",
      role: "prover",
      response: { text: "{PRIVATE_RESPONSE_SENTINEL" },
      expectedDiagnostic: "stage=manual-prover outcome=json-parse-failed",
    },
    {
      name: "fenced JSON remains rejected",
      role: "prover",
      response: { text: `\`\`\`json\n${validProverResponse}\n\`\`\`` },
      expectedDiagnostic: "stage=manual-prover outcome=json-parse-failed",
    },
    {
      name: "provider SDK error",
      role: "prover",
      response: { errorName: "Error", errorMessage: "PRIVATE_NATIVE_FAILURE_SENTINEL" },
      expectedDiagnostic: "stage=manual-prover outcome=provider-sdk-error",
    },
    {
      name: "provider timeout",
      role: "prover",
      response: { errorName: "TimeoutError", errorMessage: "PRIVATE_TIMEOUT_SENTINEL" },
      expectedDiagnostic: "stage=manual-prover outcome=provider-timeout",
    },
    {
      name: "provider invalid response",
      role: "prover",
      response: { invalidAdmission: true },
      expectedDiagnostic: "stage=manual-prover outcome=provider-invalid-response",
    },
    {
      name: "verifier provider SDK error",
      role: "verifier",
      response: { errorName: "Error", errorMessage: "PRIVATE_VERIFIER_FAILURE_SENTINEL" },
      expectedDiagnostic: "stage=manual-verifier outcome=provider-sdk-error",
    },
  ];

  it.each(failureCases)("rejects $name while preserving AF and redacting diagnostics", async (testCase) => {
    const fixture = fakeNativeClient(argumentResult);
    if (testCase.role === "verifier") fixture.setReviewerResponse("prover", { text: validProverResponse });
    fixture.setReviewerResponse(testCase.role, testCase.response);
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const harness = manualReviewHarness(fixture, diagnostics);

    const result = await harness.controller.review({
      sessionId: "PRIVATE_SESSION_SENTINEL",
      messageId: "PRIVATE_MESSAGE_SENTINEL",
      sourceText: "PRIVATE_ANSWER_SENTINEL",
      invocation: "manual",
    });

    expect(result).toMatchObject({
      reviewedMessageId: "PRIVATE_MESSAGE_SENTINEL",
      status: "conditional",
      evidenceStatus: "source_recorded",
      openChallenges: [],
    });
    expect(result.interpretiveBoundary).toContain("prover/verifier review did not complete");
    expect(harness.project).toHaveBeenCalledTimes(1);
    const messages = sink.mock.calls.map(([, message]) => String(message));
    expect(messages).toContainEqual(expect.stringContaining(testCase.expectedDiagnostic));
    expect(fixture.events.filter((event) => event.startsWith("prompt:"))).toEqual(
      testCase.role === "prover" ? ["prompt:prover"] : ["prompt:prover", "prompt:verifier"],
    );
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_(?:ANSWER|REASON|RESPONSE|NATIVE|TIMEOUT|VERIFIER)_SENTINEL/u);
    expect(messages.join(" ")).not.toMatch(
      /PRIVATE_(?:SESSION|MESSAGE|ANSWER|REASON|RESPONSE|SENTINEL|NATIVE|TIMEOUT|VERIFIER)_SENTINEL|claim-conclusion|proposal-1|objection-1|provider\/model|workspace/u,
    );
    await harness.adapter.dispose();
  });

  it("keeps valid results when the adapter diagnostics observer throws", async () => {
    const fixture = fakeNativeClient(argumentResult);
    fixture.setReviewerResponse("prover", { text: validProverResponse });
    fixture.setReviewerResponse("verifier", { text: validVerifierResponse });
    const diagnostics: ReasoningDiagnosticReporter = () => {
      throw new Error("PRIVATE_OBSERVER_FAILURE_SENTINEL");
    };
    const harness = manualReviewHarness(fixture, diagnostics);

    await expect(
      harness.controller.review({
        sessionId: "session",
        messageId: "message",
        sourceText: "A completed argument to review.",
        invocation: "manual",
      }),
    ).resolves.toMatchObject({ status: "conditional", openChallenges: [{ target: "claim:claim-conclusion" }] });
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    await harness.adapter.dispose();
  });

  it("forwards the review abort signal and suppresses a superseded stale prover result", async () => {
    const fixture = fakeNativeClient(argumentResult);
    fixture.setReviewerResponse("prover", { text: validProverResponse });
    fixture.setReviewerResponse("verifier", { text: validVerifierResponse });
    const sink = vi.fn();
    const diagnostics = createReasoningDiagnosticReporter(sink);
    const harness = manualReviewHarness(fixture, diagnostics);
    const proverPromptGate = deferred<void>();
    fixture.setBeforeProverPrompt(() => proverPromptGate.promise);

    const firstReview = harness.controller.review({
      sessionId: "session",
      messageId: "message",
      sourceText: "A completed argument to review.",
      invocation: "manual",
    });
    await vi.waitFor(() => expect(fixture.events).toContain("prompt:prover"));
    const firstProverCall = harness.runStage.mock.calls.find(([, , , role]) => role === "prover");
    expect(firstProverCall?.[4]).toBeInstanceOf(AbortSignal);
    const firstSignal = firstProverCall?.[4];

    const secondReview = harness.controller.review({
      sessionId: "session",
      messageId: "message",
      sourceText: "A completed argument to review.",
      invocation: "manual",
    });
    await expect(firstReview).resolves.toMatchObject({
      status: "unavailable",
      conclusion: "This manual review was cancelled before completion.",
    });
    const secondResult = await secondReview;
    proverPromptGate.resolve(undefined);

    expect(secondResult).toMatchObject({
      status: "conditional",
      openChallenges: [{ target: "claim:claim-conclusion" }],
    });
    expect(firstSignal?.aborted).toBe(true);
    expect(sink.mock.calls.map(([, message]) => String(message))).toContainEqual(
      expect.stringContaining("stage=manual-review outcome=stale"),
    );
    expect(fixture.events.filter((event) => event.startsWith("prompt:"))).toEqual([
      "prompt:prover",
      "prompt:prover",
      "prompt:verifier",
    ]);
    expect(hiddenSessionRegistry.liveCount()).toBe(0);
    await harness.adapter.dispose();
  });
});
