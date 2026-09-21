import { readFile } from "node:fs/promises";
import type { IAgent, IPlatformServices } from "@opencode-chat/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { ChatViewProvider } from "../chat-view-provider";
import { resolveAutomaticRoutingActivation } from "../vibefeld/automatic-routing-activation";
import type { AutomaticRoutingEvaluation } from "../vibefeld/automatic-routing-evaluation";
import { selectAutomaticRouting } from "../vibefeld/automatic-routing-policy";
import { QualificationRecorder } from "../vibefeld/qualification-recorder";
import type { IReasoningReviewController } from "../vibefeld/reasoning-review-controller";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((filePath: string | URL) => {
    const path = String(filePath);
    if (path.endsWith("CHAT_SYSTEM.md")) return "chat prompt";
    if (path.endsWith("WRITE_SYSTEM.md")) return "write prompt";
    throw new Error("ENOENT");
  }),
}));

function createAgent() {
  return {
    getCapabilities: vi.fn().mockReturnValue({}),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: "session-a", title: "Session" }),
    getSession: vi.fn().mockResolvedValue({ id: "session-a" }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn().mockResolvedValue({ id: "fork" }),
    revertSession: vi.fn().mockResolvedValue({ id: "session-a" }),
    unrevertSession: vi.fn().mockResolvedValue({ id: "session-a" }),
    summarizeSession: vi.fn().mockResolvedValue(undefined),
    shareSession: vi.fn().mockResolvedValue(undefined),
    unshareSession: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    abortSession: vi.fn().mockResolvedValue(undefined),
    executeShell: vi.fn().mockResolvedValue(undefined),
    getProviders: vi.fn().mockResolvedValue({ providers: [], default: {} }),
    listAllProviders: vi.fn().mockResolvedValue({ all: [], default: {}, connected: [] }),
    getAgents: vi.fn().mockResolvedValue([]),
    getSkills: vi.fn().mockResolvedValue([]),
    getChildSessions: vi.fn().mockResolvedValue([]),
    replyPermission: vi.fn().mockResolvedValue(undefined),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    getSessionTodos: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockResolvedValue({}),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    getPath: vi.fn().mockResolvedValue({ config: "/config", data: "/data" }),
    getMcpStatus: vi.fn().mockResolvedValue({}),
    connectMcp: vi.fn().mockResolvedValue(undefined),
    disconnectMcp: vi.fn().mockResolvedValue(undefined),
    getToolIds: vi.fn().mockResolvedValue([]),
    getServerUrl: vi.fn().mockReturnValue("http://localhost"),
    exportSessionSnapshot: vi.fn().mockResolvedValue("snapshot.json"),
    setModel: vi.fn().mockResolvedValue(undefined),
  } as unknown as {
    [K in keyof IAgent]: IAgent[K] extends (...args: never[]) => unknown ? ReturnType<typeof vi.fn> : IAgent[K];
  };
}

function createWebview() {
  const postMessage = vi.fn();
  let handler: ((message: unknown) => void) | undefined;
  const webview = {
    postMessage,
    onDidReceiveMessage: vi.fn((callback: (message: unknown) => void) => {
      handler = callback;
      return { dispose: vi.fn() };
    }),
    options: {},
    html: "",
    asWebviewUri: vi.fn((uri: { fsPath: string }) => uri.fsPath),
    cspSource: "https://test.csp",
  };
  const webviewView = {
    webview,
    viewType: "opencode-chat.chatView",
    visible: true,
    onDidDispose: vi.fn(),
    onDidChangeVisibility: vi.fn(),
    show: vi.fn(),
  };
  return {
    postMessage,
    webviewView,
    send: async (message: unknown) => {
      if (!handler) throw new Error("webview has not been resolved");
      handler(message);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function createController(state: "unavailable" | "checking" | "incompatible" | "available") {
  return {
    getRuntime: vi.fn().mockResolvedValue({ state }),
    review: vi.fn().mockResolvedValue({
      reviewedMessageId: "message-1",
      status: "structurally_checked" as const,
      invocation: "manual" as const,
      conclusion: "checked",
      assumptions: [],
      evidenceStatus: "source_recorded" as const,
      openChallenges: [],
    }),
    cancel: vi.fn(),
  } satisfies IReasoningReviewController;
}

const qualifiedEvaluation: AutomaticRoutingEvaluation = {
  version: "automatic-routing-evaluation-1",
  corpusId: "fixture-corpus",
  caseCount: 100,
  p95LatencyMs: 1_000,
  expectedCalibrationError: 0.05,
  falseChallengeRate: 0.02,
  qualified: true,
};

function evaluationWith(overrides: Partial<AutomaticRoutingEvaluation> = {}): unknown {
  return { ...qualifiedEvaluation, ...overrides };
}

function setup(
  evaluation: unknown,
  runtime: "unavailable" | "checking" | "incompatible" | "available" = "available",
  preference = { userEnabled: true, workspaceOptOut: false },
) {
  const agent = createAgent();
  const controller = createController(runtime);
  const view = createWebview();
  const activation = resolveAutomaticRoutingActivation({ preference, runtime: { state: runtime }, evaluation });
  const provider = new ChatViewProvider({ fsPath: "/extension" } as never, agent as never, {} as IPlatformServices, {
    reasoningReviewController: controller,
    automaticRouting: { ...activation, router: selectAutomaticRouting },
    reasoningReviewPreference: { read: () => preference, setUserEnabled: vi.fn(), setWorkspaceOptOut: vi.fn() },
  });
  provider.resolveWebviewView(
    view.webviewView as never,
    {} as never,
    { isCancellationRequested: false, onCancellationRequested: vi.fn() } as never,
  );
  return { agent, controller, provider, ...view };
}

async function runAutomaticTurn(
  setupResult: ReturnType<typeof setup>,
  text = "why compare these evidence sources",
): Promise<void> {
  const { agent, send } = setupResult;
  agent.getMessages.mockResolvedValue([
    {
      info: { id: "message-1", sessionID: "session-a", role: "assistant" as const, time: { created: 1, completed: 2 } },
      parts: [{ type: "text" as const, text: "visible response" }],
    },
  ]);
  await send({ type: "selectSession", sessionId: "session-a" });
  await send({ type: "sendMessage", sessionId: "session-a", text, primaryAgent: "scout" });
  const event = (agent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as (value: unknown) => void;
  event({ type: "session.status", properties: { sessionID: "session-a", status: { type: "busy" } } });
  event({ type: "session.status", properties: { sessionID: "session-a", status: { type: "idle" } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("automatic routing activation end to end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.window).activeTextEditor = undefined;
    vi.mocked(vscode.window).tabGroups.activeTabGroup.activeTab = undefined;
  });

  it.each([
    { label: "missing evaluation", evaluation: undefined },
    { label: "malformed evaluation", evaluation: { version: "wrong" } },
    { label: "stale evaluation", evaluation: evaluationWith({ version: "automatic-routing-evaluation-2" }) },
    { label: "below minimum case count", evaluation: evaluationWith({ caseCount: 99, qualified: false }) },
    { label: "over-target latency", evaluation: evaluationWith({ p95LatencyMs: 2_001, qualified: false }) },
    {
      label: "over-target calibration",
      evaluation: evaluationWith({ expectedCalibrationError: 0.101, qualified: false }),
    },
    {
      label: "over-target false challenge",
      evaluation: evaluationWith({ falseChallengeRate: 0.051, qualified: false }),
    },
  ])("does not select or invoke a controller for $label", async ({ evaluation }) => {
    const result = setup(evaluation);
    await runAutomaticTurn(result);
    expect(result.controller.review).not.toHaveBeenCalled();
    expect(result.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "reasoningReview" }));
  });

  it.each([
    { label: "disabled flag", preference: { userEnabled: false, workspaceOptOut: false } },
    { label: "workspace opt-out", preference: { userEnabled: true, workspaceOptOut: true } },
  ])("does not select when $label", async ({ preference }) => {
    const result = setup(qualifiedEvaluation, "available", preference);
    await runAutomaticTurn(result);
    expect(result.controller.review).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "checking", "incompatible"] as const)("does not select for %s runtime", async (runtime) => {
    const result = setup(qualifiedEvaluation, runtime);
    await runAutomaticTurn(result);
    expect(result.controller.review).not.toHaveBeenCalled();
  });

  it.each([
    { label: "below threshold", text: "what is the weather today" },
    { label: "work-mode exclusion", text: "why compare these options", primaryAgent: "write" },
    { label: "wrong request class", text: "lookup the answer" },
  ])("does not select on signal failure: $label", async ({ text, primaryAgent }) => {
    const result = setup(qualifiedEvaluation);
    result.agent.getMessages.mockResolvedValue([
      {
        info: { id: "message-1", sessionID: "session-a", role: "assistant" as const, time: { completed: 2 } },
        parts: [{ type: "text" as const, text: "visible response" }],
      },
    ]);
    await result.send({ type: "selectSession", sessionId: "session-a" });
    await result.send({ type: "sendMessage", sessionId: "session-a", text, primaryAgent: primaryAgent ?? "scout" });
    const event = (result.agent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as (value: unknown) => void;
    event({ type: "session.status", properties: { sessionID: "session-a", status: { type: "idle" } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.controller.review).not.toHaveBeenCalled();
  });

  it("selects once and publishes only bounded routing metadata", async () => {
    const result = setup(qualifiedEvaluation);
    await runAutomaticTurn(result);
    expect(result.controller.review).toHaveBeenCalledTimes(1);
    expect(result.postMessage).toHaveBeenCalledWith({
      type: "reasoningReview",
      sessionId: "session-a",
      summary: expect.objectContaining({
        invocation: "automatic",
        routing: { reasonCode: "evidence_dependent", summary: "Evidence-dependent response" },
      }),
    });
    const reviewMessages = result.postMessage.mock.calls.filter(
      ([message]) => (message as { type?: string }).type === "reasoningReview",
    );
    const serialized = JSON.stringify(reviewMessages);
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("/extension");
    expect(serialized).not.toContain("visible response");
  });

  it("preserves manual precedence and duplicate suppression", async () => {
    const result = setup(qualifiedEvaluation);
    const pending = new Promise<never>(() => undefined);
    result.controller.review.mockReturnValueOnce(pending);
    result.agent.getMessages.mockResolvedValue([
      {
        info: { id: "message-1", sessionID: "session-a", role: "assistant" as const, time: { completed: 2 } },
        parts: [{ type: "text" as const, text: "visible response" }],
      },
    ]);
    await result.send({ type: "selectSession", sessionId: "session-a" });
    const manual = result.send({ type: "requestReasoningReview", sessionId: "session-a", messageId: "message-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await result.send({
      type: "sendMessage",
      sessionId: "session-a",
      text: "why compare these evidence sources",
      primaryAgent: "scout",
    });
    const event = (result.agent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as (value: unknown) => void;
    event({ type: "session.status", properties: { sessionID: "session-a", status: { type: "idle" } } });
    event({ type: "session.status", properties: { sessionID: "session-a", status: { type: "idle" } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.controller.review).toHaveBeenCalledTimes(1);
    expect(result.controller.review).toHaveBeenCalledWith(expect.objectContaining({ messageId: "message-1" }));
    await manual;
  });

  it("keeps response publication independent from post-response review", async () => {
    const result = setup(qualifiedEvaluation);
    const review = new Promise<never>(() => undefined);
    result.controller.review.mockReturnValue(review);
    await result.send({ type: "selectSession", sessionId: "session-a" });
    await result.send({
      type: "sendMessage",
      sessionId: "session-a",
      text: "why compare these evidence sources",
      primaryAgent: "scout",
    });
    const event = (result.agent.onEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as (value: unknown) => void;
    const responseEvent = {
      type: "message.updated",
      properties: { info: { id: "message-1" }, content: "original response" },
    };
    event(responseEvent);
    expect(result.postMessage).toHaveBeenCalledWith({ type: "event", event: responseEvent });
    expect(result.controller.review).not.toHaveBeenCalled();
  });

  it("retains no response-gate or publication-hold seam in production routing", async () => {
    const readSource = (relativePath: string) => readFile(new URL(relativePath, import.meta.url), "utf8");
    for (const source of await Promise.all([readSource("../chat-view-provider.ts"), readSource("../extension.ts")])) {
      expect(source).not.toMatch(/response-gate|publication-hold/iu);
      expect(source).not.toMatch(/(?:bufferResponse|holdResponse|releaseResponse|withholdResponse|rewriteResponse)/u);
    }
  });

  it("reads the host-private recorder dynamically and stays inert below the case minimum", async () => {
    const agent = createAgent();
    const controller = createController("available");
    const view = createWebview();
    const recorder = new QualificationRecorder();
    const preference = { userEnabled: true, workspaceOptOut: false };
    const provider = new ChatViewProvider({ fsPath: "/extension" } as never, agent as never, {} as IPlatformServices, {
      reasoningReviewController: controller,
      automaticRouting: {
        enabled: true,
        evaluationProvider: () => recorder.currentEvaluation(),
        router: selectAutomaticRouting,
      },
      reasoningReviewPreference: { read: () => preference, setUserEnabled: vi.fn(), setWorkspaceOptOut: vi.fn() },
    });
    provider.resolveWebviewView(
      view.webviewView as never,
      {} as never,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() } as never,
    );
    const result = { agent, controller, provider, ...view };

    await runAutomaticTurn(result);
    expect(controller.review).not.toHaveBeenCalled();
    expect(recorder.currentEvaluation()).toBeUndefined();

    for (let index = 0; index < 100; index += 1) {
      expect(recorder.record({ latencyMs: 5, status: "structurally_checked", feedback: { correct: true } }).ok).toBe(
        true,
      );
    }

    await runAutomaticTurn(result);
    expect(controller.review).toHaveBeenCalledTimes(1);
    expect(recorder.currentEvaluation()?.qualified).toBe(true);
    expect(JSON.stringify(recorder.currentEvaluation())).not.toMatch(
      /prompt|source|response|path|workspace|review text/iu,
    );
  });
});
