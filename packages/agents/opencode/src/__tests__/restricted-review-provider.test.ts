import { OpenCode } from "@opencode/client";
import { describe, expect, it, vi } from "vitest";
import {
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
} from "../restricted-review-overlay";
import {
  type CreateRestrictedReviewProviderOptions,
  createRestrictedReviewProvider,
  MAX_RESTRICTED_REVIEW_TEXT_LENGTH,
  type RestrictedReviewObserver,
} from "../restricted-review-provider";

type ReadinessAgentData = Readonly<{
  id: unknown;
  model: unknown;
  system: unknown;
  steps: unknown;
  mode: unknown;
  hidden: unknown;
  permissions: unknown;
}>;

function readinessAgentData(overrides: Partial<ReadinessAgentData> = {}): ReadinessAgentData {
  return {
    id: RESTRICTED_REVIEW_AGENT_NAME,
    model: { providerID: "provider", id: "model" },
    system: "fixed",
    steps: 4,
    mode: "subagent",
    hidden: true,
    permissions: ["*", ...RESTRICTED_REVIEW_AUTHORITIES, "dynamic"].map((action) => ({
      action,
      resource: "*",
      effect: "deny",
    })),
    ...overrides,
  };
}

function readinessResponse(options: { location?: string; data?: unknown } = {}) {
  return {
    location: { directory: options.location ?? "/workspace" },
    data: options.data === undefined ? readinessAgentData() : options.data,
  };
}

function fixture(
  options: {
    generation?: unknown;
    currentGeneration?: () => unknown;
    observe?: RestrictedReviewObserver;
    now?: () => number;
    restrictedReview?: CreateRestrictedReviewProviderOptions["restrictedReview"];
  } = {},
) {
  const snapshot = (id: string, completed?: number) => ({
    id: `msg_${id}`,
    type: "assistant",
    agent: RESTRICTED_REVIEW_AGENT_NAME,
    model: { providerID: "provider", id: "model" },
    content: [{ type: "text", text: "bounded result" }],
    time: { completed },
    finish: "stop",
  });
  const client = {
    agent: {
      get: vi.fn().mockResolvedValue(readinessResponse()),
    },
    session: {
      create: vi.fn().mockResolvedValue({
        id: "ses_owned",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        model: { providerID: "provider", id: "model" },
        location: { directory: "/workspace" },
      }),
      wait: vi.fn().mockResolvedValue(undefined),
      instructions: { entry: { put: vi.fn().mockResolvedValue(undefined) } },
      generate: vi.fn().mockResolvedValue({ text: "bounded result" }),
      prompt: vi.fn(({ sessionID, text }: { sessionID: string; text: string }) =>
        Promise.resolve({ id: "inbox_1", sessionID, type: "user", payload: { text } }),
      ),
      interrupt: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    message: { list: vi.fn().mockResolvedValue({ data: [snapshot("old", 1)] }) },
  };
  const provider = createRestrictedReviewProvider({
    client: client as never,
    directory: "/workspace",
    restrictedReview: options.restrictedReview ?? {
      model: "provider/model",
      prompt: "fixed",
      maxSteps: 4,
      dynamicToolNames: ["dynamic"],
    },
    hostPinnedModel: { providerID: "provider", modelID: "model" },
    generation: options.generation,
    currentGeneration: options.currentGeneration,
    ...(options.observe ? { observe: options.observe } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { client, provider, snapshot };
}

describe("restricted review native transport", () => {
  it("observes the shared architect native stages with fixed labels and bounded timings", async () => {
    const observe = vi.fn();
    let tick = 0;
    const { client, provider } = fixture({ observe, now: () => tick++ });
    await provider.beginReview();
    await provider.createSession("role");

    await expect(provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toEqual({
      ok: true,
      text: "bounded result",
    });

    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toEqual([
      "architect-instructions:started",
      "architect-instructions:completed",
      "architect-generate:started",
      "architect-generate:completed",
      "architect-response:started",
      "architect-response:success",
    ]);
    expect(observe.mock.calls.some(([event]) => event.stage === "architect-native-error")).toBe(false);
    expect(observe.mock.calls.every(([event]) => event.elapsedMs === undefined || event.elapsedMs >= 0)).toBe(true);
    expect(client.session.generate).toHaveBeenCalledWith(
      { sessionID: "ses_owned", prompt: "packet" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps observation clock and sink failures out of the architect result", async () => {
    const { provider } = fixture({
      observe: () => {
        throw new Error("private observation failure");
      },
      now: () => {
        throw new Error("private clock failure");
      },
    });
    await provider.beginReview();
    await provider.createSession("role");

    await expect(provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toEqual({
      ok: true,
      text: "bounded result",
    });
  });

  it("reports an instruction timeout without claiming native generation started", async () => {
    const observe = vi.fn();
    const { client, provider } = fixture({ observe });
    client.session.instructions.entry.put.mockImplementationOnce(() => new Promise(() => undefined));
    await provider.beginReview();
    await provider.createSession("role");

    await expect(provider.runStage("ses_owned", "packet", 20, "architect")).resolves.toMatchObject({
      ok: false,
      code: "timeout",
    });

    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toEqual([
      "architect-instructions:started",
      "architect-instructions:timeout",
    ]);
    expect(client.session.generate).not.toHaveBeenCalled();
  });

  it("uses fixed failed outcomes for native rejection and malformed returned text", async () => {
    const instructionObserver = vi.fn();
    const instructionCase = fixture({ observe: instructionObserver });
    instructionCase.client.session.instructions.entry.put.mockRejectedValueOnce(new Error("private native error"));
    await instructionCase.provider.beginReview();
    await instructionCase.provider.createSession("role");
    await expect(instructionCase.provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });
    expect(instructionObserver.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toEqual([
      "architect-instructions:started",
      "architect-instructions:failed",
      "architect-native-error:other",
    ]);
    expect(instructionCase.client.session.generate).not.toHaveBeenCalled();

    const generateObserver = vi.fn();
    const generateCase = fixture({ observe: generateObserver });
    generateCase.client.session.generate.mockRejectedValueOnce(new Error("private native error"));
    await generateCase.provider.beginReview();
    await generateCase.provider.createSession("role");
    await expect(generateCase.provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });
    expect(generateObserver.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toEqual([
      "architect-instructions:started",
      "architect-instructions:completed",
      "architect-generate:started",
      "architect-generate:failed",
      "architect-native-error:other",
    ]);

    const validationObserver = vi.fn();
    const validationCase = fixture({ observe: validationObserver });
    validationCase.client.session.generate.mockResolvedValueOnce({ text: "" });
    await validationCase.provider.beginReview();
    await validationCase.provider.createSession("role");
    await expect(validationCase.provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "invalid-response",
    });
    expect(validationObserver.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toEqual([
      "architect-instructions:started",
      "architect-instructions:completed",
      "architect-generate:started",
      "architect-generate:completed",
      "architect-response:started",
      "architect-response:failure",
    ]);
  });

  it.each([
    ["InvalidRequestError", "native-invalid-request"],
    ["UnauthorizedError", "native-authentication"],
    ["ServiceUnavailableError", "native-service-unavailable"],
    ["LocationNotFoundError", "native-location-not-found"],
    ["AgentNotFoundError", "native-agent-not-found"],
    ["SessionNotFoundError", "native-session-not-found"],
    ["ProviderNotFoundError", "native-provider-not-found"],
    ["InstructionEntryValueTooLargeError", "native-context-limit"],
    ["UnrecognizedNativeTag", "native-other"],
  ] as const)("maps fixed native error tag %s without its contents", async (tag, outcome) => {
    const observe = vi.fn();
    const { client, provider } = fixture({ observe });
    client.session.generate.mockRejectedValueOnce(
      Object.assign(new Error("UNIQUE_NATIVE_ERROR_MESSAGE"), {
        _tag: tag,
        body: "UNIQUE_NATIVE_ERROR_BODY",
        headers: "UNIQUE_NATIVE_ERROR_HEADERS",
        url: "UNIQUE_NATIVE_ERROR_URL",
        path: "UNIQUE_NATIVE_ERROR_PATH",
        model: "UNIQUE_NATIVE_ERROR_MODEL",
        configuration: "UNIQUE_NATIVE_ERROR_CONFIG",
      }),
    );
    await provider.beginReview();
    await provider.createSession("role");

    await expect(provider.runStage("ses_owned", "UNIQUE_PROMPT", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });

    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
      `architect-native-error:${outcome}`,
    );
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(
      /UNIQUE_NATIVE_ERROR|UNIQUE_PROMPT|ses_owned|workspace|provider\/model/u,
    );
  });

  it.each([
    ["Transport", "client-transport"],
    ["UnexpectedStatus", "client-unexpected-status"],
    ["MalformedResponse", "client-protocol"],
    ["UnsupportedContentType", "client-protocol"],
    ["UnrecognizedClientReason", "client-other"],
  ] as const)("maps Promise-client failure reason %s to a fixed class", async (reason, outcome) => {
    const observe = vi.fn();
    const { client, provider } = fixture({ observe });
    client.session.generate.mockRejectedValueOnce(
      Object.assign(new Error("UNIQUE_CLIENT_ERROR_MESSAGE"), {
        name: "ClientError",
        reason,
        cause: { url: "UNIQUE_CLIENT_ERROR_URL" },
      }),
    );
    await provider.beginReview();
    await provider.createSession("role");

    await expect(provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });

    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
      `architect-native-error:${outcome}`,
    );
    expect(
      JSON.stringify(observe.mock.calls.map(([event]) => ({ stage: event.stage, outcome: event.outcome }))),
    ).not.toMatch(/UNIQUE_CLIENT_ERROR|429|ses_owned/u);
  });

  it("classifies decoded Promise-client native failures from injected fake HTTP responses", async () => {
    const sessionId = "ses_PRIVATE_ID_SENTINEL";
    const privateValues = [
      "PRIVATE_BASE_URL_SENTINEL",
      "PRIVATE_HEADER_SENTINEL",
      "PRIVATE_ERROR_MESSAGE_SENTINEL",
      "PRIVATE_ERROR_BODY_SENTINEL",
      "PRIVATE_RESPONSE_HEADER_SENTINEL",
      "PRIVATE_PATH_SENTINEL",
      "PRIVATE_MODEL_SENTINEL",
      "PRIVATE_CONFIG_SENTINEL",
      sessionId,
      "PRIVATE_PROMPT_SENTINEL",
    ];
    const statuses: Array<Readonly<{ path: string; status: number; body: Record<string, unknown> }>> = [
      {
        path: "/instructions/entries/",
        status: 413,
        body: {
          _tag: "InstructionEntryValueTooLargeError",
          actualBytes: 65_536,
          maxBytes: 1,
          message: "PRIVATE_ERROR_MESSAGE_SENTINEL",
          body: "PRIVATE_ERROR_BODY_SENTINEL",
          path: "PRIVATE_PATH_SENTINEL",
          configuration: "PRIVATE_CONFIG_SENTINEL",
        },
      },
      {
        path: "/generate",
        status: 503,
        body: {
          _tag: "ServiceUnavailableError",
          service: "PRIVATE_MODEL_SENTINEL",
          message: "PRIVATE_ERROR_MESSAGE_SENTINEL",
          body: "PRIVATE_ERROR_BODY_SENTINEL",
          path: "PRIVATE_PATH_SENTINEL",
          configuration: "PRIVATE_CONFIG_SENTINEL",
        },
      },
    ];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const response = statuses.find((item) => url.includes(item.path));
      if (response) {
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: {
            "content-type": "application/json",
            "x-private-response": "PRIVATE_RESPONSE_HEADER_SENTINEL",
          },
        });
      }
      return new Response(null, { status: 204 });
    });
    const fetcher = fetchMock as unknown as typeof globalThis.fetch;
    const nativeClient = OpenCode.make({
      baseUrl: "http://127.0.0.1/PRIVATE_BASE_URL_SENTINEL",
      headers: { authorization: "PRIVATE_HEADER_SENTINEL" },
      fetch: fetcher,
    });
    const client = {
      ...nativeClient,
      session: {
        ...nativeClient.session,
        create: vi.fn().mockResolvedValue({
          id: sessionId,
          agent: RESTRICTED_REVIEW_AGENT_NAME,
          model: { providerID: "provider", id: "model" },
          location: { directory: "/workspace" },
        }),
        interrupt: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    };
    const observe = vi.fn();
    const provider = createRestrictedReviewProvider({
      client: client as never,
      directory: "/workspace",
      restrictedReview: { model: "provider/model", prompt: "fixed", maxSteps: 4 },
      hostPinnedModel: { providerID: "provider", modelID: "model" },
      observe,
    });
    await provider.beginReview();
    await provider.createSession("role");

    await expect(provider.runStage(sessionId, "PRIVATE_PROMPT_SENTINEL", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });
    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
      "architect-native-error:native-context-limit",
    );
    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).not.toContain(
      "architect-generate:started",
    );

    await provider.cancelReview(1);
    statuses.shift();
    await provider.beginReview();
    await provider.createSession("role");
    await expect(provider.runStage(sessionId, "PRIVATE_PROMPT_SENTINEL", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });
    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
      "architect-native-error:native-service-unavailable",
    );
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/api/experimental/session/"),
        expect.stringContaining("/api/session/"),
      ]),
    );
    const observations = JSON.stringify(observe.mock.calls);
    for (const privateValue of privateValues) expect(observations).not.toContain(privateValue);
    await provider.cancelReview(2);

    statuses.shift();
    statuses.push({
      path: "/generate",
      status: 429,
      body: { message: "PRIVATE_ERROR_MESSAGE_SENTINEL", body: "PRIVATE_ERROR_BODY_SENTINEL" },
    });
    await provider.beginReview();
    await provider.createSession("role");
    await expect(provider.runStage(sessionId, "PRIVATE_PROMPT_SENTINEL", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });
    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
      "architect-native-error:client-unexpected-status-4xx",
    );
    const redactionObservations = () =>
      JSON.stringify(observe.mock.calls.map(([event]) => ({ stage: event.stage, outcome: event.outcome })));
    const expectValidObservationShape = () => {
      for (const [event] of observe.mock.calls) {
        expect(Object.keys(event).every((key) => ["stage", "outcome", "elapsedMs"].includes(key))).toBe(true);
        if (event.elapsedMs !== undefined) expect(Number.isFinite(event.elapsedMs)).toBe(true);
      }
    };
    expect(redactionObservations()).not.toMatch(/PRIVATE_ERROR|429|PRIVATE_ID_SENTINEL/u);
    expectValidObservationShape();
    await provider.cancelReview(3);

    statuses.shift();
    statuses.push({
      path: "/generate",
      status: 500,
      body: { message: "PRIVATE_ERROR_MESSAGE_SENTINEL", body: "PRIVATE_ERROR_BODY_SENTINEL" },
    });
    await provider.beginReview();
    await provider.createSession("role");
    await expect(provider.runStage(sessionId, "PRIVATE_PROMPT_SENTINEL", 100, "architect")).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
    });
    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
      "architect-native-error:client-unexpected-status-5xx",
    );
    expect(redactionObservations()).not.toMatch(/PRIVATE_ERROR|500|PRIVATE_ID_SENTINEL/u);
    expectValidObservationShape();
    await provider.cancelReview(4);
  });

  it("limits wrapper inspection and treats cyclic or hostile errors as fixed other", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.cause = cyclic;
    const hostile = Object.defineProperties(
      {},
      {
        _tag: {
          get: () => {
            throw new Error("PRIVATE_GETTER_SENTINEL");
          },
        },
        name: {
          get: () => {
            throw new Error("PRIVATE_GETTER_SENTINEL");
          },
        },
        reason: {
          get: () => {
            throw new Error("PRIVATE_GETTER_SENTINEL");
          },
        },
        cause: {
          get: () => {
            throw new Error("PRIVATE_GETTER_SENTINEL");
          },
        },
      },
    );
    for (const error of [cyclic, hostile]) {
      const observe = vi.fn();
      const { client, provider } = fixture({ observe });
      client.session.generate.mockRejectedValueOnce(error);
      await provider.beginReview();
      await provider.createSession("role");

      await expect(provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toMatchObject({
        ok: false,
        code: "sdk-error",
      });

      expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
        "architect-native-error:other",
      );
      expect(JSON.stringify(observe.mock.calls)).not.toContain("PRIVATE_GETTER_SENTINEL");
    }
  });

  it("classifies known causes within the traversal bound and ignores deeper causes", async () => {
    const knownCause = {
      cause: {
        cause: Object.assign(new Error("PRIVATE_WRAPPED_NATIVE_SENTINEL"), {
          _tag: "ServiceUnavailableError",
        }),
      },
    };
    let deepCause: Record<string, unknown> = { _tag: "ServiceUnavailableError" };
    for (let depth = 0; depth < 4; depth += 1) deepCause = { cause: deepCause };

    for (const [error, outcome] of [
      [knownCause, "native-service-unavailable"],
      [deepCause, "other"],
    ] as const) {
      const observe = vi.fn();
      const { client, provider } = fixture({ observe });
      client.session.generate.mockRejectedValueOnce(error);
      await provider.beginReview();
      await provider.createSession("role");

      await expect(provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toMatchObject({
        ok: false,
        code: "sdk-error",
      });

      expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
        `architect-native-error:${outcome}`,
      );
      expect(JSON.stringify(observe.mock.calls)).not.toContain("PRIVATE_WRAPPED_NATIVE_SENTINEL");
    }
  });

  it("keeps architect failure observation nonfatal when the observer throws", async () => {
    const { client, provider } = fixture({
      observe: () => {
        throw new Error("PRIVATE_OBSERVER_FAILURE_SENTINEL");
      },
    });
    client.session.generate.mockRejectedValueOnce(
      Object.assign(new Error("PRIVATE_NATIVE_FAILURE_SENTINEL"), { _tag: "ServiceUnavailableError" }),
    );
    await provider.beginReview();
    await provider.createSession("role");

    await expect(provider.runStage("ses_owned", "packet", 100, "architect")).resolves.toEqual({
      ok: false,
      code: "sdk-error",
      message: "Restricted review is unavailable.",
    });
  });

  it("keeps architect cancellation distinct from a native error category", async () => {
    const observe = vi.fn();
    const { client, provider } = fixture({ observe });
    const controller = new AbortController();
    client.session.generate.mockImplementationOnce(
      (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        }) as never,
    );
    await provider.beginReview();
    await provider.createSession("role");
    const stage = provider.runStage("ses_owned", "packet", 5_000, "architect", controller.signal);
    await vi.waitFor(() => expect(client.session.generate).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(stage).resolves.toMatchObject({ ok: false, code: "invalid-response" });
    expect(observe.mock.calls.map(([event]) => `${event.stage}:${event.outcome}`)).toContain(
      "architect-generate:cancelled",
    );
    expect(observe.mock.calls.some(([event]) => event.stage === "architect-native-error")).toBe(false);
  });

  it("refuses session creation without a current review token", async () => {
    const { client, provider } = fixture();

    await expect(provider.createSession("role")).resolves.toMatchObject({
      ok: false,
      code: "invalid-response",
    });
    expect(client.session.create).not.toHaveBeenCalled();
  });

  it("reads the exact native agent at the active location and fails closed on a permissive permission", async () => {
    const observe = vi.fn();
    const { client, provider } = fixture({ observe });
    await expect(provider.checkReadiness()).resolves.toBe(true);
    expect(client.agent.get).toHaveBeenCalledWith(
      { agentID: RESTRICTED_REVIEW_AGENT_NAME, location: { directory: "/workspace" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    client.agent.get.mockResolvedValueOnce({
      location: { directory: "/workspace" },
      data: {
        id: RESTRICTED_REVIEW_AGENT_NAME,
        model: { providerID: "provider", id: "model" },
        system: "fixed",
        steps: 4,
        mode: "subagent",
        hidden: true,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      },
    });
    await expect(provider.checkReadiness()).resolves.toBe(false);
    expect(observe.mock.calls.map(([event]) => event.outcome)).toEqual(["ready", "agent-mismatch-permissions"]);
  });

  it.each([
    ["LocationNotFound", "request-failed-location-not-found"],
    ["AgentNotFound", "request-failed-agent-not-found"],
    ["Unauthorized", "request-failed-unauthorized"],
    ["ServiceUnavailable", "request-failed-service-unavailable"],
    ["UnknownNativeError", "request-failed-other"],
  ] as const)("maps readiness error tag %s to a fixed class", async (tag, outcome) => {
    const observe = vi.fn();
    const { client, provider } = fixture({ observe });
    client.agent.get.mockRejectedValueOnce(Object.assign(new Error("UNIQUE_READINESS_ERROR_SENTINEL"), { _tag: tag }));

    await expect(provider.checkReadiness()).resolves.toBe(false);

    expect(observe.mock.calls.map(([event]) => [event.stage, event.outcome])).toEqual([["review-readiness", outcome]]);
    expect(JSON.stringify(observe.mock.calls)).not.toContain("UNIQUE_READINESS_ERROR_SENTINEL");
  });

  it("reports timeout and request cancellation separately", async () => {
    const timeoutObserver = vi.fn();
    const timeoutCase = fixture({ observe: timeoutObserver });
    timeoutCase.client.agent.get.mockRejectedValueOnce(
      Object.assign(new Error("UNIQUE_READINESS_ERROR_SENTINEL"), { name: "TimeoutError" }),
    );
    await expect(timeoutCase.provider.checkReadiness()).resolves.toBe(false);
    expect(timeoutObserver.mock.calls.map(([event]) => event.outcome)).toEqual(["request-timeout"]);

    const cancelObserver = vi.fn();
    const cancelCase = fixture({ observe: cancelObserver });
    let requestSignal: AbortSignal | undefined;
    cancelCase.client.agent.get.mockImplementationOnce(
      (_request: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          requestSignal = options.signal;
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        }) as never,
    );
    const pending = cancelCase.provider.checkReadiness();
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    cancelCase.provider.invalidate();
    await expect(pending).resolves.toBe(false);
    expect(cancelObserver.mock.calls.map(([event]) => event.outcome)).toEqual(["request-cancelled"]);
    expect(JSON.stringify([...timeoutObserver.mock.calls, ...cancelObserver.mock.calls])).not.toContain(
      "UNIQUE_READINESS_ERROR_SENTINEL",
    );
  });

  it.each([
    ["location", "location-mismatch", readinessResponse({ location: "/other" })],
    ["agent shape", "agent-mismatch-shape", readinessResponse({ data: null })],
    ["agent id", "agent-mismatch-id", readinessResponse({ data: readinessAgentData({ id: "other-agent" }) })],
    ["agent model", "agent-mismatch-model", readinessResponse({ data: readinessAgentData({ model: "other/model" }) })],
    ["agent system", "agent-mismatch-system", readinessResponse({ data: readinessAgentData({ system: "other" }) })],
    ["agent steps", "agent-mismatch-steps", readinessResponse({ data: readinessAgentData({ steps: 3 }) })],
    ["agent mode", "agent-mismatch-mode", readinessResponse({ data: readinessAgentData({ mode: "primary" }) })],
    ["agent hidden", "agent-mismatch-hidden", readinessResponse({ data: readinessAgentData({ hidden: false }) })],
    [
      "agent permissions",
      "agent-mismatch-permissions",
      readinessResponse({
        data: readinessAgentData({ permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
      }),
    ],
    [
      "agent tools",
      "agent-mismatch-tools",
      readinessResponse({
        data: readinessAgentData({
          permissions: ["*", ...RESTRICTED_REVIEW_AUTHORITIES].map((action) => ({
            action,
            resource: "*",
            effect: "deny",
          })),
        }),
      }),
    ],
  ] as const)("reports first readiness mismatch: %s", async (_label, outcome, response) => {
    const observe = vi.fn();
    const { client, provider } = fixture({ observe });
    client.agent.get.mockResolvedValueOnce(response);

    await expect(provider.checkReadiness()).resolves.toBe(false);

    expect(observe.mock.calls.map(([event]) => [event.stage, event.outcome])).toEqual([["review-readiness", outcome]]);
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/other-agent|other\/model|UNIQUE_READINESS/u);
  });

  it("distinguishes top-level configured-model mismatch and not-current before request", async () => {
    const modelObserver = vi.fn();
    const modelCase = fixture({
      observe: modelObserver,
      restrictedReview: { model: "provider/other", prompt: "fixed", maxSteps: 4, dynamicToolNames: ["dynamic"] },
    });
    await expect(modelCase.provider.checkReadiness()).resolves.toBe(false);
    expect(modelObserver.mock.calls.map(([event]) => event.outcome)).toEqual(["model-mismatch"]);

    const notCurrentObserver = vi.fn();
    const notCurrentCase = fixture({ generation: {}, currentGeneration: () => ({}), observe: notCurrentObserver });
    await expect(notCurrentCase.provider.checkReadiness()).resolves.toBe(false);
    expect(notCurrentCase.client.agent.get).not.toHaveBeenCalled();
    expect(notCurrentObserver.mock.calls.map(([event]) => event.outcome)).toEqual(["not-current"]);
  });

  it("reports generation drift after a completed readiness request", async () => {
    const generation = {};
    let current: unknown = generation;
    const observe = vi.fn();
    const { client, provider } = fixture({ generation, currentGeneration: () => current, observe });
    let resolveRead!: (value: ReturnType<typeof readinessResponse>) => void;
    client.agent.get.mockImplementationOnce(() => new Promise((resolve) => (resolveRead = resolve)) as never);

    const pending = provider.checkReadiness();
    await vi.waitFor(() => expect(client.agent.get).toHaveBeenCalledTimes(1));
    current = {};
    resolveRead(readinessResponse());

    await expect(pending).resolves.toBe(false);
    expect(observe.mock.calls.map(([event]) => event.outcome)).toEqual(["generation-stale"]);
  });

  it("creates a fully restricted native session, installs fixed role context, and admits only bounded packet text", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await expect(provider.createSession("role")).resolves.toMatchObject({ ok: true, sessionId: "ses_owned" });
    expect(client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "role",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        model: { providerID: "provider", id: "model" },
        location: { directory: "/workspace" },
        permissions: expect.arrayContaining([{ action: "*", resource: "*", effect: "deny" }]),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.session.create.mock.calls[0]?.[0].model).toEqual({ providerID: "provider", id: "model" });
    expect(client.session.create.mock.calls[0]?.[0].model).not.toHaveProperty("variant");
    await provider.promptStage("ses_owned", "packet", "prover");
    expect(client.session.wait).toHaveBeenCalledWith({ sessionID: "ses_owned" }, expect.anything());
    expect(client.session.instructions.entry.put).toHaveBeenCalledWith(
      {
        sessionID: "ses_owned",
        key: "scribe.restricted-review-role",
        value: RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
      },
      expect.anything(),
    );
    expect(client.session.prompt).toHaveBeenCalledWith({ sessionID: "ses_owned", text: "packet" }, expect.anything());
  });

  it("accepts native default variants for created sessions and completed assistant snapshots", async () => {
    const { client, provider, snapshot } = fixture();
    client.session.create.mockResolvedValueOnce({
      id: "ses_owned",
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      model: { id: "model", variant: "default", providerID: "provider" },
      location: { directory: "/workspace" },
    });
    await provider.beginReview();
    await expect(provider.createSession("role")).resolves.toMatchObject({ ok: true });
    await provider.promptStage("ses_owned", "packet", "prover");
    client.message.list.mockResolvedValueOnce({
      data: [{ ...snapshot("default-variant", 2), model: { id: "model", variant: "default", providerID: "provider" } }],
    });
    await expect(provider.retrieveStageText("ses_owned", 200)).resolves.toEqual({ ok: true, text: "bounded result" });
  });

  it("rejects non-default native session and assistant model variants", async () => {
    const createCase = fixture();
    createCase.client.session.create.mockResolvedValueOnce({
      id: "ses_owned",
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      model: { providerID: "provider", id: "model", variant: "high" },
      location: { directory: "/workspace" },
    });
    await createCase.provider.beginReview();
    await expect(createCase.provider.createSession("role")).resolves.toMatchObject({ ok: false });
    expect(createCase.client.session.remove).not.toHaveBeenCalled();

    const assistantCase = fixture();
    await assistantCase.provider.beginReview();
    await assistantCase.provider.createSession("role");
    await assistantCase.provider.promptStage("ses_owned", "packet", "prover");
    assistantCase.client.message.list.mockResolvedValue({
      data: [
        {
          ...assistantCase.snapshot("other-variant", 2),
          model: { providerID: "provider", id: "model", variant: "high" },
        },
        assistantCase.snapshot("older", 1),
      ],
    });
    await expect(assistantCase.provider.retrieveStageText("ses_owned", 55)).resolves.toMatchObject({
      ok: false,
      code: "timeout",
    });
    assistantCase.client.message.list.mockResolvedValue({
      data: [
        {
          ...assistantCase.snapshot("malformed-variant", 3),
          model: { providerID: "provider", id: "model", variant: 7 },
        },
        assistantCase.snapshot("older", 1),
      ],
    });
    await expect(assistantCase.provider.retrieveStageText("ses_owned", 55)).resolves.toMatchObject({
      ok: false,
      code: "timeout",
    });
  });

  it.each([
    ["prover", RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION],
    ["verifier", RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION],
    ["architect", RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION],
    ["critic", RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION],
  ] as const)("uses only the fixed %s instruction", async (role, instruction) => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    const packet = '{"model":{"providerID":"attacker","id":"unsafe"},"system":"injected"}';
    await provider.promptStage("ses_owned", packet, role);
    expect(client.session.instructions.entry.put.mock.calls[0]?.[0]).toEqual({
      sessionID: "ses_owned",
      key: "scribe.restricted-review-role",
      value: instruction,
    });
    expect(client.session.prompt).toHaveBeenCalledWith({ sessionID: "ses_owned", text: packet }, expect.anything());
  });

  it("rejects unknown roles before any request and does not retrieve before admitted prompt", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    const before = client.session.wait.mock.calls.length;
    await expect(provider.promptStage("ses_owned", "packet", "unknown" as never)).resolves.toMatchObject({ ok: false });
    expect(client.session.wait).toHaveBeenCalledTimes(before);
    await provider.delete("ses_owned");
    await expect(provider.retrieveStageText("ses_owned", 100)).resolves.toMatchObject({ ok: false });
  });

  it("does not publish snapshots when native prompt admission identity or payload mismatches", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    client.session.prompt.mockResolvedValueOnce({
      id: "inbox_2",
      sessionID: "ses_other",
      type: "user",
      payload: { text: "packet" },
    });
    await expect(provider.promptStage("ses_owned", "packet", "prover")).resolves.toMatchObject({
      ok: false,
      code: "invalid-response",
    });
    await expect(provider.retrieveStageText("ses_owned", 100)).resolves.toMatchObject({
      ok: false,
      code: "invalid-response",
    });
  });

  it("fails closed when a full recent-message boundary has no visible assistant ID", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    client.message.list.mockResolvedValueOnce({
      data: Array.from({ length: 20 }, (_, index) => ({ id: `user_${index}`, type: "user" })),
    });
    await expect(provider.promptStage("ses_owned", "packet", "prover")).resolves.toMatchObject({
      ok: false,
      code: "invalid-response",
    });
    expect(client.session.instructions.entry.put).not.toHaveBeenCalled();
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  it("requires a newer native assistant completion and rejects foreign sessions", async () => {
    const { client, provider, snapshot } = fixture();
    await expect(provider.promptStage("foreign", "packet", "prover")).resolves.toMatchObject({ ok: false });
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    client.message.list.mockResolvedValueOnce({ data: [snapshot("old", 1)] });
    await expect(provider.retrieveStageText("ses_owned", 50)).resolves.toMatchObject({ ok: false, code: "timeout" });
    client.message.list.mockResolvedValueOnce({ data: [snapshot("new", 2)] });
    await expect(provider.retrieveStageText("ses_owned", 500)).resolves.toEqual({ ok: true, text: "bounded result" });
  });

  it("skips native control records and uses the newest assistant, never an older one", async () => {
    const { client, provider, snapshot } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    client.message.list.mockResolvedValueOnce({
      data: [
        { id: "idle-1", type: "idle" },
        { ...snapshot("new", 2), model: { id: "model", providerID: "provider" } },
        { id: "user-1", type: "user" },
        snapshot("older", 1),
      ],
    });
    await expect(provider.retrieveStageText("ses_owned", 200)).resolves.toEqual({ ok: true, text: "bounded result" });
  });

  it("does not fall back past a newer textless assistant snapshot", async () => {
    const { client, provider, snapshot } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    client.message.list.mockResolvedValue({
      data: [
        {
          id: "msg_newer",
          type: "assistant",
          agent: RESTRICTED_REVIEW_AGENT_NAME,
          model: { providerID: "provider", id: "model" },
          content: [],
          time: {},
          finish: undefined,
        },
        snapshot("older", 1),
      ],
    });
    await expect(provider.retrieveStageText("ses_owned", 55)).resolves.toMatchObject({ ok: false, code: "timeout" });
  });

  it("bounds joined text, accepts explicit empty completion, and rejects tool or failed finishes", async () => {
    const { client, provider, snapshot } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    client.message.list.mockResolvedValueOnce({
      data: [
        {
          ...snapshot("joined", 2),
          content: [
            { type: "text", text: "a".repeat(MAX_RESTRICTED_REVIEW_TEXT_LENGTH) },
            { type: "text", text: "tail" },
          ],
        },
      ],
    });
    await expect(provider.retrieveStageText("ses_owned", 200)).resolves.toEqual({
      ok: true,
      text: "a".repeat(MAX_RESTRICTED_REVIEW_TEXT_LENGTH),
    });
    client.message.list.mockResolvedValueOnce({
      data: [{ ...snapshot("empty", 3), content: [{ type: "text", text: "" }] }],
    });
    await expect(provider.retrieveStageText("ses_owned", 200)).resolves.toEqual({ ok: true, text: "" });
    client.message.list.mockResolvedValueOnce({
      data: [{ ...snapshot("tool", 4), finish: "tool-calls", content: [{ type: "tool", id: "tool-1" }] }],
    });
    await expect(provider.retrieveStageText("ses_owned", 55)).resolves.toMatchObject({ ok: false, code: "timeout" });
  });

  it("joins only text around reasoning and ignores reasoning-only or textless newest replies", async () => {
    const { client, provider, snapshot } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    client.message.list.mockResolvedValueOnce({
      data: [
        {
          ...snapshot("reasoning-text", 2),
          content: [
            { type: "reasoning", text: "DO NOT LEAK THIS" },
            { type: "text", text: "answer one" },
            { type: "text", text: "answer two" },
          ],
        },
      ],
    });
    await expect(provider.retrieveStageText("ses_owned", 200)).resolves.toEqual({
      ok: true,
      text: "answer one\nanswer two",
    });

    client.message.list.mockResolvedValue({
      data: [
        { ...snapshot("reasoning-only", 3), content: [{ type: "reasoning", text: "private" }] },
        snapshot("older", 1),
      ],
    });
    await expect(provider.retrieveStageText("ses_owned", 55)).resolves.toMatchObject({ ok: false, code: "timeout" });
    client.message.list.mockResolvedValue({
      data: [{ ...snapshot("no-content", 4), content: [] }, snapshot("older", 1)],
    });
    await expect(provider.retrieveStageText("ses_owned", 55)).resolves.toMatchObject({ ok: false, code: "timeout" });
  });

  it("clears a previously admitted boundary before a second stage can fail", async () => {
    const { client, provider, snapshot } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "first", "prover");
    client.message.list.mockResolvedValueOnce({ data: [snapshot("first-reply", 1)] });
    await expect(provider.retrieveStageText("ses_owned", 200)).resolves.toMatchObject({ ok: true });
    client.session.instructions.entry.put.mockRejectedValueOnce(new Error("failure"));
    await expect(provider.promptStage("ses_owned", "second", "verifier")).resolves.toMatchObject({ ok: false });
    const readCount = client.message.list.mock.calls.length;
    await expect(provider.retrieveStageText("ses_owned", 200)).resolves.toMatchObject({ ok: false });
    expect(client.message.list).toHaveBeenCalledTimes(readCount);
  });

  it("cancels then removes owned sessions and never reveals transport errors", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    client.session.wait.mockRejectedValueOnce(new Error("private payload"));
    await expect(provider.promptStage("ses_owned", "packet", "prover")).resolves.toMatchObject({
      code: "sdk-error",
      message: "Restricted review is unavailable.",
    });
    await provider.cancelReview(1);
    await provider.cancelReview(1);
    expect(client.session.interrupt).toHaveBeenCalledWith(
      { sessionID: "ses_owned" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.session.remove).toHaveBeenCalledWith(
      { sessionID: "ses_owned" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.session.interrupt.mock.invocationCallOrder[0]).toBeLessThan(
      client.session.remove.mock.invocationCallOrder[0],
    );
    expect(client.session.interrupt).toHaveBeenCalledTimes(1);
    expect(client.session.remove).toHaveBeenCalledTimes(1);
  });

  it("shares cancellation and deletion when review lifecycle and context cleanup overlap", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    let finishInterrupt!: () => void;
    let finishRemove!: () => void;
    client.session.interrupt.mockImplementationOnce(() => new Promise<void>((resolve) => (finishInterrupt = resolve)));
    client.session.remove.mockImplementationOnce(() => new Promise<void>((resolve) => (finishRemove = resolve)));

    const lifecycleCleanup = provider.cancelReview(1);
    const contextCancellation = provider.cancel("ses_owned");
    await vi.waitFor(() => expect(client.session.interrupt).toHaveBeenCalledTimes(1));
    finishInterrupt();
    await vi.waitFor(() => expect(client.session.remove).toHaveBeenCalledTimes(1));
    const contextDeletion = provider.delete("ses_owned");
    finishRemove();

    await expect(Promise.all([lifecycleCleanup, contextCancellation, contextDeletion])).resolves.toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(client.session.interrupt).toHaveBeenCalledTimes(1);
    expect(client.session.remove).toHaveBeenCalledTimes(1);
  });

  it("aborts an owned pending retrieval on direct cancel and times out a hung native request", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    let timeoutSignal: AbortSignal | undefined;
    client.message.list.mockImplementationOnce((_input: unknown, options: { signal: AbortSignal }) => {
      timeoutSignal = options.signal;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(options.signal.reason)),
      );
    });
    const timed = provider.retrieveStageText("ses_owned", 25);
    await expect(timed).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(timeoutSignal?.aborted).toBe(true);

    let requestSignal: AbortSignal | undefined;
    client.message.list.mockImplementationOnce((_input: unknown, options: { signal: AbortSignal }) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(options.signal.reason)),
      );
    });
    const pending = provider.retrieveStageText("ses_owned", 5_000);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await provider.cancel("ses_owned");
    expect(requestSignal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: false });
  });

  it("aborts a pending retrieval before direct delete and prevents stale publication or reuse", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    let resolveList!: (value: unknown) => void;
    let requestSignal: AbortSignal | undefined;
    client.message.list.mockImplementationOnce((_input: unknown, options: { signal: AbortSignal }) => {
      requestSignal = options.signal;
      return new Promise((resolve) => (resolveList = resolve));
    });
    const pending = provider.retrieveStageText("ses_owned", 1_000);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await provider.delete("ses_owned");
    expect(requestSignal?.aborted).toBe(true);
    resolveList({
      data: [
        {
          id: "msg_stale",
          type: "assistant",
          agent: RESTRICTED_REVIEW_AGENT_NAME,
          model: { providerID: "provider", id: "model" },
          content: [{ type: "text", text: "stale" }],
          time: { completed: 3 },
          finish: "stop",
        },
      ],
    });
    await expect(pending).resolves.toMatchObject({ ok: false });
    const listCalls = client.message.list.mock.calls.length;
    await expect(provider.retrieveStageText("ses_owned", 100)).resolves.toMatchObject({ ok: false });
    await expect(provider.promptStage("ses_owned", "again", "prover")).resolves.toMatchObject({ ok: false });
    expect(client.message.list).toHaveBeenCalledTimes(listCalls);
    expect(client.session.wait).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "malformed session ID",
      {
        id: "../foreign",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        model: { providerID: "provider", id: "model" },
        location: { directory: "/workspace" },
      },
    ],
    [
      "foreign agent",
      {
        id: "ses_foreign_1",
        agent: "other-agent",
        model: { providerID: "provider", id: "model" },
        location: { directory: "/workspace" },
      },
    ],
    [
      "foreign model",
      {
        id: "ses_foreign_1",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        model: { providerID: "other", id: "model" },
        location: { directory: "/workspace" },
      },
    ],
    [
      "foreign location",
      {
        id: "ses_foreign_1",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        model: { providerID: "provider", id: "model" },
        location: { directory: "/other-workspace" },
      },
    ],
  ])("rejects create responses with %s before attempting cleanup", async (_label, response) => {
    const { client, provider } = fixture();
    await provider.beginReview();
    client.session.create.mockResolvedValueOnce(response);
    await expect(provider.createSession("role")).resolves.toMatchObject({ ok: false });
    expect(client.session.remove).not.toHaveBeenCalled();
  });

  it("cleans a valid late-created session before the next review can create its role", async () => {
    const { client, provider } = fixture();
    const firstToken = await provider.beginReview();
    let resolveCreate!: (value: unknown) => void;
    client.session.create.mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)) as never);
    const creating = provider.createSession("late");
    const replacement = provider.beginReview();
    await Promise.resolve();
    resolveCreate({
      id: "ses_late_1",
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      model: { providerID: "provider", id: "model" },
      location: { directory: "/workspace" },
    });
    await expect(creating).resolves.toMatchObject({ ok: false });
    const nextToken = await replacement;
    expect(nextToken).not.toBe(firstToken);
    expect(client.session.remove).toHaveBeenCalledWith({ sessionID: "ses_late_1" }, expect.anything());
    expect(client.session.create).toHaveBeenCalledTimes(1);
    await expect(provider.createSession("replacement")).resolves.toMatchObject({ ok: true });
    expect(client.session.remove.mock.invocationCallOrder[0]).toBeLessThan(
      client.session.create.mock.invocationCallOrder[1],
    );
  });

  it("retains failed late-create cleanup ownership and blocks replacement without retry", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    let resolveCreate!: (value: unknown) => void;
    client.session.create.mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)) as never);
    const creating = provider.createSession("late");
    const replacement = provider.beginReview();
    await Promise.resolve();
    client.session.remove.mockRejectedValueOnce(new Error("remove failure"));
    resolveCreate({
      id: "ses_cleanup_failure",
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      model: { providerID: "provider", id: "model" },
      location: { directory: "/workspace" },
    });
    await expect(creating).resolves.toMatchObject({
      ok: false,
      code: "sdk-error",
      message: "Restricted review is unavailable.",
    });
    await expect(replacement).resolves.toBe(0);
    expect(provider.isReviewCurrent(2)).toBe(false);
    expect(client.session.remove).toHaveBeenCalledTimes(1);
    expect(client.session.create).toHaveBeenCalledTimes(1);
    await expect(provider.beginReview()).resolves.toBe(0);
  });

  it("rejects readiness after generation drift during a delayed native read", async () => {
    const generation = {};
    let current: unknown = generation;
    const { client, provider } = fixture({ generation, currentGeneration: () => current });
    let resolveRead!: (value: unknown) => void;
    client.agent.get.mockImplementationOnce(() => new Promise((resolve) => (resolveRead = resolve)) as never);
    const ready = provider.checkReadiness();
    current = {};
    resolveRead({
      location: { directory: "/workspace" },
      data: {
        id: RESTRICTED_REVIEW_AGENT_NAME,
        model: { providerID: "provider", id: "model" },
        system: "fixed",
        steps: 4,
        mode: "subagent",
        hidden: true,
        permissions: ["*", ...RESTRICTED_REVIEW_AUTHORITIES, "dynamic"].map((action) => ({
          action,
          resource: "*",
          effect: "deny",
        })),
      },
    });
    await expect(ready).resolves.toBe(false);
  });

  it("rejects generation drift before work and after delayed create, prompt, and retrieval operations", async () => {
    const generation = {};
    let current: unknown = generation;
    const { client, provider } = fixture({ generation, currentGeneration: () => current });
    current = {};
    await expect(provider.checkReadiness()).resolves.toBe(false);
    expect(client.agent.get).not.toHaveBeenCalled();
    expect(await provider.beginReview()).toBe(0);
    await expect(provider.createSession("role")).resolves.toMatchObject({ ok: false });
    expect(client.session.create).not.toHaveBeenCalled();

    current = generation;
    await provider.beginReview();
    let resolveCreate!: (value: unknown) => void;
    client.session.create.mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)) as never);
    const creating = provider.createSession("role");
    current = {};
    resolveCreate({
      id: "ses_drift_1",
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      model: { providerID: "provider", id: "model" },
      location: { directory: "/workspace" },
    });
    await expect(creating).resolves.toMatchObject({ ok: false });
    expect(client.session.remove).toHaveBeenCalledWith({ sessionID: "ses_drift_1" }, expect.anything());
  });

  it("invalidates delayed prompt and retrieval snapshots on generation drift", async () => {
    const generation = {};
    let current: unknown = generation;
    const { client, provider, snapshot } = fixture({ generation, currentGeneration: () => current });
    await provider.beginReview();
    await provider.createSession("role");
    let resolveWait!: () => void;
    client.session.wait.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveWait = resolve)) as never);
    const prompting = provider.promptStage("ses_owned", "packet", "prover");
    current = {};
    resolveWait();
    await expect(prompting).resolves.toMatchObject({ ok: false });
    expect(client.session.instructions.entry.put).not.toHaveBeenCalled();

    current = generation;
    const { provider: fresh, client: freshClient } = fixture({ generation, currentGeneration: () => current });
    await fresh.beginReview();
    await fresh.createSession("role");
    await fresh.promptStage("ses_owned", "packet", "prover");
    let resolveList!: (value: unknown) => void;
    freshClient.message.list.mockImplementationOnce(() => new Promise((resolve) => (resolveList = resolve)) as never);
    const retrieving = fresh.retrieveStageText("ses_owned", 1_000);
    current = {};
    resolveList({ data: [snapshot("new", 2)] });
    await expect(retrieving).resolves.toMatchObject({ ok: false, code: "invalid-response" });
  });

  it("aborts native operations on explicit invalidation and rejects calls after invalidation", async () => {
    const { client, provider } = fixture();
    await provider.beginReview();
    await provider.createSession("role");
    await provider.promptStage("ses_owned", "packet", "prover");
    let requestSignal: AbortSignal | undefined;
    client.message.list.mockImplementationOnce((_input: unknown, options: { signal: AbortSignal }) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(options.signal.reason)),
      );
    });
    const retrieving = provider.retrieveStageText("ses_owned", 5_000);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    provider.invalidate();
    expect(requestSignal?.aborted).toBe(true);
    await expect(retrieving).resolves.toMatchObject({ ok: false });
    const reads = client.agent.get.mock.calls.length;
    await expect(provider.checkReadiness()).resolves.toBe(false);
    expect(client.agent.get).toHaveBeenCalledTimes(reads);
    await expect(provider.promptStage("ses_owned", "packet", "prover")).resolves.toMatchObject({ ok: false });
  });
});
