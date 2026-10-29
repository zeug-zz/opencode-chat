import type { SessionTransferData } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copySessionTransferData } from "../native-session-transfer.js";
import {
  abortTransportProven,
  assertPromiseClient,
  boundedFetch,
  confirmsInterrupt,
  evaluateEvidence,
  hasExpectedMessages,
  hasHermeticInventories,
  hasInterruptedOutcome,
  isExpectedClientPackage,
  isRuntimeSpikeEnabled,
  isSessionExecutionSucceeded,
  matchesExpectedCliVersion,
  matchesSelectedStep,
  promiseClientFactory,
  readInventoryStage,
  readMessageStage,
  runV2ContractSpike,
  waitForStalledMockClose,
} from "./v2-contract-spike.js";

const clientSurface = () => ({
  server: { info: vi.fn() },
  location: { get: vi.fn() },
  event: { subscribe: vi.fn() },
  session: {
    create: vi.fn(),
    get: vi.fn(),
    prompt: vi.fn(),
    switchModel: vi.fn(),
    switchAgent: vi.fn(),
    interrupt: vi.fn(),
    export: vi.fn(),
    import: vi.fn(),
    update: vi.fn(),
  },
  message: { list: vi.fn() },
  plugin: { list: vi.fn() },
  mcp: { list: vi.fn() },
});

const transferFixture: SessionTransferData = {
  info: {
    id: "ses_original",
    parentID: "ses_parent",
    projectID: "prj_fixture",
    fork: { sessionID: "ses_parent", boundary: { type: "through", messageID: "msg_user" } },
    agent: "private-fixture-agent",
    cost: 0.25,
    tokens: { input: 3, output: 2, reasoning: 1, cache: { read: 4, write: 5 } },
    time: { created: 10, updated: 20 },
    title: "completed fixture",
    metadata: { label: "preserve-me", nested: { value: 7 } },
    permissions: [{ action: "read", resource: "**", effect: "allow" }],
    location: { directory: "/owned/workspace" },
  },
  messages: [
    {
      id: "msg_user",
      type: "user",
      text: "history stays unchanged",
      time: { created: 11 },
      metadata: { opaque: { marker: "msg_original" } },
    },
    {
      id: "msg_answer",
      type: "system",
      text: "completed answer",
      description: "fixture answer",
      time: { created: 12 },
      metadata: { preserve: true },
    },
  ],
};

describe("disposable authenticated V2 contract spike", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("makes a private candidate transfer copy by replacing only typed IDs and root controls", () => {
    const original = structuredClone(transferFixture);
    const generated = ["ses_copy", "msg_copy_user", "msg_copy_answer"];
    const copied = copySessionTransferData(transferFixture, () => generated.shift() ?? "");

    expect(transferFixture).toEqual(original);
    expect(copied.info).toMatchObject({
      id: "ses_copy",
      parentID: undefined,
      fork: undefined,
      agent: undefined,
      title: transferFixture.info.title,
      permissions: transferFixture.info.permissions,
      metadata: transferFixture.info.metadata,
    });
    expect(copied.messages.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: "msg_copy_user", type: "user" },
      { id: "msg_copy_answer", type: "system" },
    ]);
    expect(copied.messages.map((message) => ("text" in message ? message.text : undefined))).toEqual(
      transferFixture.messages.map((message) => ("text" in message ? message.text : undefined)),
    );
    expect(copied.messages.map(({ metadata }) => metadata)).toEqual(
      transferFixture.messages.map(({ metadata }) => metadata),
    );
    expect(copied.messages[0]).not.toBe(transferFixture.messages[0]);
    expect(copied.messages[0].metadata).toBe(transferFixture.messages[0].metadata);
    const originalIDs = [transferFixture.info.id, ...transferFixture.messages.map(({ id }) => id)];
    const copiedIDs = [copied.info.id, ...copied.messages.map(({ id }) => id)];
    expect(copiedIDs.every((id) => !originalIDs.includes(id))).toBe(true);
  });

  it("preserves every native outer message variant and switch payloads without semantic rewriting", () => {
    const messages = [
      { id: "msg_agent", type: "agent-switched", agent: "scout", previous: "build", time: { created: 1 } },
      {
        id: "msg_model",
        type: "model-switched",
        model: { providerID: "p", id: "m" },
        previous: { providerID: "q", id: "n" },
        time: { created: 2 },
      },
      {
        id: "msg_location",
        type: "location-switched",
        location: { directory: "/workspace" },
        previous: { location: { directory: "/old" } },
        time: { created: 3 },
      },
      ...(["user", "synthetic", "system", "skill", "shell", "assistant", "compaction", "idle"] as const).map(
        (type, i) => ({ id: `msg_${type}`, type, time: { created: i + 4 } }),
      ),
    ] as unknown as SessionTransferData["messages"];
    const source = { ...transferFixture, messages };
    const original = structuredClone(source);
    let messageIndex = 0;
    const copied = copySessionTransferData(source, (kind) =>
      kind === "session" ? "ses_copy_switches" : `msg_copy_${messageIndex++}`,
    );
    expect(copied.messages.map((message) => message.type)).toEqual(messages.map((message) => message.type));
    expect(copied.messages.slice(0, 3).map(({ id: _id, type, ...payload }) => payload)).toEqual(
      messages.slice(0, 3).map(({ id: _id, type, ...payload }) => payload),
    );
    expect(source).toEqual(original);
  });

  it("rejects an unknown native outer message type", () => {
    const invalid = {
      ...transferFixture,
      messages: [{ ...transferFixture.messages[0], type: "unknown-native-kind" }],
    } as unknown as SessionTransferData;
    expect(() => copySessionTransferData(invalid)).toThrow("Invalid native session export.");
  });

  it("rejects malformed source and generated transfer IDs", () => {
    expect(() => copySessionTransferData({ ...transferFixture, info: { ...transferFixture.info, id: "bad" } })).toThrow(
      "Invalid native session export.",
    );
    expect(() =>
      copySessionTransferData({
        ...transferFixture,
        messages: [{ ...transferFixture.messages[0], id: "bad" }, transferFixture.messages[1]],
      }),
    ).toThrow("Invalid native session export.");
    expect(() => copySessionTransferData(transferFixture, () => "bad")).toThrow("Invalid native session export.");
    const invalidMessageID = (kind: "session" | "message") => (kind === "session" ? "ses_copy" : "bad");
    expect(() => copySessionTransferData(transferFixture, invalidMessageID)).toThrow("Invalid native session export.");
  });

  it("keeps the runtime runner opt-in by default", () => {
    vi.stubEnv("OPENCODE_CHAT_RUN_V2_SPIKE", "");
    vi.stubEnv("OPENCODE_CHAT_V2_SPIKE_EXECUTABLE", "");
    vi.stubEnv("OPENCODE_CHAT_V2_CLIENT_MODULE", "");
    expect(isRuntimeSpikeEnabled()).toBe(false);
  });

  it("selects the native built-in HTTP mock lane by default and keeps the custom fixture explicit", () => {
    vi.stubEnv("OPENCODE_CHAT_RUN_V2_SPIKE", "1");
    vi.stubEnv("OPENCODE_CHAT_V2_SPIKE_EXECUTABLE", "/owned/opencode");
    vi.stubEnv("OPENCODE_CHAT_V2_CLIENT_MODULE", "/owned/client.js");
    vi.stubEnv("OPENCODE_CHAT_V2_SPIKE_PROVIDER_LANE", "");
    expect(isRuntimeSpikeEnabled()).toBe(true);
    vi.stubEnv("OPENCODE_CHAT_V2_SPIKE_PROVIDER_LANE", "aisdk-fixture");
    expect(isRuntimeSpikeEnabled()).toBe(true);
  });

  it("fails closed when runtime opt-in lacks explicit executable/client inputs", async () => {
    vi.stubEnv("OPENCODE_CHAT_RUN_V2_SPIKE", "1");
    vi.stubEnv("OPENCODE_CHAT_V2_SPIKE_EXECUTABLE", "");
    vi.stubEnv("OPENCODE_CHAT_V2_CLIENT_MODULE", "");
    await expect(runV2ContractSpike()).rejects.toThrow(/absolute executable and pinned Promise-client module/);
  });

  it("matches the exact CLI version line with an optional v prefix", () => {
    expect(matchesExpectedCliVersion("opencode v2.2.0\n")).toBe(true);
    expect(matchesExpectedCliVersion("opencode 2.2.0\r\n")).toBe(true);
    expect(matchesExpectedCliVersion("opencode v2.0.32\n")).toBe(false);
    expect(matchesExpectedCliVersion("opencode v2.1.1\n")).toBe(false);
    expect(matchesExpectedCliVersion("opencode 2.1.40\n")).toBe(false);
    expect(matchesExpectedCliVersion("build opencode v2.1.4\n")).toBe(false);
    expect(matchesExpectedCliVersion("opencode v2.1.4\nextra\n")).toBe(false);
    expect(matchesExpectedCliVersion("opencode v2.1.4\n\n")).toBe(false);
    expect(matchesExpectedCliVersion(" opencode v2.1.4\n")).toBe(false);
  });

  it("accepts only the exact approved Promise-client package identity", () => {
    expect(isExpectedClientPackage({ name: "@opencode/client", version: "2.1.0" })).toBe(true);
    expect(isExpectedClientPackage({ name: "@opencode/client", version: "2.1.2" })).toBe(false);
    expect(isExpectedClientPackage({ name: "@other/client", version: "2.1.0" })).toBe(false);
    expect(isExpectedClientPackage(null)).toBe(false);
    expect(isExpectedClientPackage([])).toBe(false);
    expect(isExpectedClientPackage({ name: "@opencode/client" })).toBe(false);
    expect(isExpectedClientPackage({ name: "@opencode/client", version: 2.1 })).toBe(false);
  });

  it("resolves both supported Promise-client module entry shapes and rejects wrong method paths", () => {
    const make = vi.fn();
    expect(promiseClientFactory({ make })).toBe(make);
    expect(promiseClientFactory({ OpenCode: { make } })).toBe(make);
    expect(promiseClientFactory({})).toBeUndefined();

    expect(assertPromiseClient(clientSurface())).toBeDefined();
    const wrongPath = clientSurface() as ReturnType<typeof clientSurface> & { session: { message?: unknown } };
    delete (wrongPath as { message?: unknown }).message;
    expect(() => assertPromiseClient(wrongPath)).toThrow("Promise client surface is malformed");
  });

  it("validates generated message and wrapped inventory response shapes", () => {
    expect(
      hasExpectedMessages({ data: [{ type: "assistant", content: [{ type: "text", text: "done" }] }] }, "done"),
    ).toBe(true);
    expect(hasExpectedMessages({ data: [{ info: { role: "assistant" }, parts: [{ text: "done" }] }] }, "done")).toBe(
      false,
    );
    const builtin = {
      id: "builtin-task",
      source: { type: "builtin" },
      features: { server: true },
      state: { status: "active" },
    };
    expect(
      hasHermeticInventories(
        { location: { directory: "/owned" }, data: [builtin] },
        { location: { directory: "/owned" }, data: [] },
      ),
    ).toBe(true);
    expect(
      hasHermeticInventories(
        { location: { directory: "/owned" }, data: [{ ...builtin, state: { status: "failed", error: "redacted" } }] },
        { data: [] },
      ),
    ).toBe(false);
    expect(
      hasHermeticInventories(
        { location: { directory: "/owned" }, data: [{ ...builtin, source: { type: "package", target: "external" } }] },
        { data: [] },
      ),
    ).toBe(false);
    expect(
      hasHermeticInventories(
        { location: { directory: "/owned" }, data: [{ ...builtin, features: { unexpected: true } }] },
        { data: [] },
      ),
    ).toBe(false);
    expect(hasHermeticInventories([], {})).toBe(false);
  });

  it("runs inventory, message, step-event, and interrupt client stages against fakes", async () => {
    const fake = clientSurface();
    fake.plugin.list.mockResolvedValue({ location: { directory: "/owned" }, data: [] });
    fake.mcp.list.mockResolvedValue({ location: { directory: "/owned" }, data: [] });
    fake.message.list.mockResolvedValue({
      data: [{ type: "assistant", content: [{ type: "text", text: "spike complete" }] }],
      cursor: { previous: null, next: null },
    });
    const client = assertPromiseClient(fake);

    expect(await readInventoryStage(client)).toBe(true);
    expect(fake.plugin.list).toHaveBeenCalledOnce();
    expect(fake.mcp.list).toHaveBeenCalledOnce();
    expect(await readMessageStage(client, "session-1", "spike complete")).toBe(true);
    expect(fake.message.list).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(
      matchesSelectedStep(
        {
          type: "session.step.started",
          data: {
            sessionID: "session-1",
            agent: "spike-deny-all",
            model: { providerID: "spike-mock", id: "mock-model" },
          },
        },
        "session-1",
      ),
    ).toBe(true);
    expect(matchesSelectedStep({ type: "session.step.started", data: { sessionID: "session-1" } }, "session-1")).toBe(
      false,
    );
    expect(
      isSessionExecutionSucceeded(
        { type: "session.execution.succeeded", data: { sessionID: "session-2" } },
        "session-1",
      ),
    ).toBe(false);
    expect(
      isSessionExecutionSucceeded(
        { type: "session.execution.succeeded", data: { sessionID: "session-1" } },
        "session-1",
      ),
    ).toBe(true);
    expect(confirmsInterrupt({ interrupted: true })).toBe(true);
    expect(confirmsInterrupt({ interrupted: false })).toBe(false);
    expect(hasInterruptedOutcome({ outcome: "interrupted" })).toBe(true);
    expect(hasInterruptedOutcome({ outcome: "failed" })).toBe(false);
  });

  it("counts requests before dispatch, aborts them, and fails a bounded response overflow", async () => {
    const abort = new AbortController();
    const delegate = vi.fn(async () => new Response("ok"));
    const budget = boundedFetch(delegate as typeof fetch, abort.signal, 1);
    await budget.fetch("http://127.0.0.1/");
    await expect(budget.fetch("http://127.0.0.1/")).rejects.toThrow(/request limit/);
    expect(budget.requests).toBe(1);
    expect(budget.boundsHeld).toBe(false);
    expect(delegate).toHaveBeenCalledTimes(1);

    const overall = new AbortController();
    const abortingDelegate = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const abortBudget = boundedFetch(abortingDelegate as typeof fetch, overall.signal, 1);
    const pending = abortBudget.fetch("http://127.0.0.1/");
    overall.abort(new Error("overall limit"));
    await expect(pending).rejects.toThrow("overall limit");
    expect(abortBudget.requests).toBe(1);

    const overflow = boundedFetch(async () => new Response("x".repeat(32_769)), new AbortController().signal, 1);
    const response = await overflow.fetch("http://127.0.0.1/");
    await expect(response.text()).rejects.toThrow(/response byte limit/);
    expect(overflow.boundsHeld).toBe(false);
  });

  it("waits briefly for an observed stalled transport to close and fails if it never closes", async () => {
    let elapsed = 0;
    const delayed: { closedAt?: number } = {};
    const delayedClosed = await waitForStalledMockClose(delayed, 500, 0, {
      now: () => elapsed,
      sleep: async (milliseconds) => {
        elapsed += milliseconds;
        if (elapsed >= 40) delayed.closedAt = elapsed;
      },
    });
    expect(delayedClosed).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThanOrEqual(40);
    expect(await waitForStalledMockClose({ closedAt: 10 }, 500, 11)).toBe(false);

    elapsed = 0;
    const neverClosed = await waitForStalledMockClose({}, 60, 0, {
      now: () => elapsed,
      sleep: async (milliseconds) => {
        elapsed += milliseconds;
      },
    });
    expect(neverClosed).toBe(false);
    expect(elapsed).toBe(60);
    expect(
      abortTransportProven({
        interruptAcknowledged: true,
        stalledMockObserved: true,
        stalledMockClosedAfterInterrupt: true,
      }),
    ).toBe(true);
    expect(
      abortTransportProven({
        interruptAcknowledged: true,
        stalledMockObserved: true,
        stalledMockClosedAfterInterrupt: false,
      }),
    ).toBe(false);
    expect(
      abortTransportProven({
        interruptAcknowledged: false,
        stalledMockObserved: false,
        stalledMockClosedAfterInterrupt: false,
      }),
    ).toBe(false);
  });

  it("cannot classify an exception with partial checks or failed cleanup as PASS", () => {
    expect(
      evaluateEvidence({
        checks: { authenticatedReadiness: true },
        failed: true,
        cleanupSucceeded: true,
        boundsHeld: true,
      }),
    ).toBe("FAIL");
    expect(
      evaluateEvidence({
        checks: { authenticatedReadiness: true },
        failed: false,
        cleanupSucceeded: false,
        boundsHeld: true,
      }),
    ).toBe("FAIL");
  });

  it.skipIf(!isRuntimeSpikeEnabled())(
    "runs the bounded disposable contract only after explicit primary opt-in",
    async () => {
      await expect(runV2ContractSpike()).resolves.toMatchObject({
        status: "PASS",
        qualification: "BUILTIN_HTTP_MOCK_PROVIDER_API_SPIKE_ONLY",
        expectedVersion: "2.1.4",
        sourceCommit: "bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1",
        sourceCommitMeaning: "inspected-release-tag",
      });
    },
    100_000,
  );
});
