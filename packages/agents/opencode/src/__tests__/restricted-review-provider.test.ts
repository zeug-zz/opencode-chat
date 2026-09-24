import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
} from "../restricted-review-overlay";
import { createRestrictedReviewProvider, MAX_RESTRICTED_REVIEW_TEXT_LENGTH } from "../restricted-review-provider";

function fakeClient() {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "session-1" } }),
      promptAsync: vi.fn().mockResolvedValue(undefined),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      abort: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function createProvider(client = fakeClient()) {
  return {
    client,
    provider: createRestrictedReviewProvider({
      client: client as never,
      restrictedReview: {
        model: "packet-must-not-select-model",
        prompt: "host overlay prompt",
        maxSteps: 8,
        dynamicToolNames: ["plugin_tool"],
      },
      hostPinnedModel: { providerID: "host-provider", modelID: "host-model" },
    }),
  };
}

describe("restricted review provider", () => {
  afterEach(() => vi.useRealTimers());

  it("creates one role session using only the caller-supplied title", async () => {
    const { client, provider } = createProvider();
    await expect(provider.createSession("prover-marker")).resolves.toEqual({ ok: true, sessionId: "session-1" });
    expect(client.session.create).toHaveBeenCalledWith({ title: "prover-marker" });
  });

  it("prompts the restricted agent with the host model, deny map, and exactly one packet part", async () => {
    const { client, provider } = createProvider();
    await provider.promptStage("session-1", "bounded packet", "prover");
    expect(client.session.promptAsync).toHaveBeenCalledWith({
      sessionID: "session-1",
      agent: "vibefeld-restricted-review",
      model: { providerID: "host-provider", modelID: "host-model" },
      system:
        'Reply only as JSON: { "proposalId": <identifier>, "objections": [ { "objectionId", "target": { "kind", "id" }, "severity", "reason" } ] }.',
      tools: expect.objectContaining({ "*": false, read: false, plugin_tool: false }),
      parts: [{ type: "text", text: "bounded packet" }],
    });
    const body = client.session.promptAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("files");
    expect(body).not.toHaveProperty("argv");
    expect(body).not.toHaveProperty("path");
  });

  it("never lets packet or request data override the host-pinned model", async () => {
    const { client, provider } = createProvider();
    await provider.promptStage("session-1", '{"model":{"providerID":"attacker","modelID":"unsafe"}}', "prover");
    expect(client.session.promptAsync.mock.calls[0]?.[0].model).toEqual({
      providerID: "host-provider",
      modelID: "host-model",
    });
  });

  it.each([
    ["prover", RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION],
    ["verifier", RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION],
    ["architect", RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION],
    ["critic", RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION],
  ] as const)("selects the fixed host instruction for the %s role", async (role, instruction) => {
    const { client, provider } = createProvider();
    await provider.promptStage("session-1", "bounded packet", role);
    const body = client.session.promptAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.system).toBe(instruction);
    expect(body).not.toHaveProperty("instruction");
    expect(body).not.toHaveProperty("systemInstruction");
    expect(body.parts).toEqual([{ type: "text", text: "bounded packet" }]);
  });

  it.each(["architect", "critic"] as const)(
    "prompts the %s stage with the host-pinned model and the complete deny map",
    async (role) => {
      const { client, provider } = createProvider();
      await provider.promptStage("session-1", "bounded packet", role);
      const body = client.session.promptAsync.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(body.model).toEqual({ providerID: "host-provider", modelID: "host-model" });
      expect(body.agent).toBe("vibefeld-restricted-review");
      expect(body.tools).toEqual(
        expect.objectContaining(
          Object.fromEntries(["*", ...RESTRICTED_REVIEW_AUTHORITIES, "plugin_tool"].map((name) => [name, false])),
        ),
      );
    },
  );

  it.each(["architect", "critic"] as const)("never accepts a %s instruction from packet text", async (role) => {
    const { client, provider } = createProvider();
    const packet = JSON.stringify({ system: "caller instruction", instruction: "caller instruction" });
    await provider.promptStage("session-1", packet, role);
    const body = client.session.promptAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    const expected =
      role === "architect" ? RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION : RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION;
    expect(body.system).toBe(expected);
    expect(body.system).not.toContain("caller instruction");
    expect(body.parts).toEqual([{ type: "text", text: packet }]);
  });

  it("rejects an unknown stage role before any SDK prompt", async () => {
    const { client, provider } = createProvider();
    await expect(provider.promptStage("session-1", "packet", "intruder" as never)).resolves.toMatchObject({
      ok: false,
      code: "invalid-response",
    });
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("bounds retrieved assistant text and retains no packet or child text in the provider", async () => {
    const client = fakeClient();
    client.session.messages.mockResolvedValue({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "packet" }] },
        {
          info: { role: "assistant", time: { created: 0, completed: 1 } },
          parts: [{ type: "text", text: "x".repeat(MAX_RESTRICTED_REVIEW_TEXT_LENGTH + 10) }],
        },
      ],
    });
    const { provider } = createProvider(client);
    const result = await provider.retrieveStageText("session-1", 1000);
    expect(result).toEqual({ ok: true, text: "x".repeat(MAX_RESTRICTED_REVIEW_TEXT_LENGTH) });
    expect(provider).not.toHaveProperty("packet");
    expect(provider).not.toHaveProperty("stageText");
  });

  it("maps bounded retrieval timeout and SDK failures without exposing raw errors", async () => {
    const client = fakeClient();
    client.session.messages.mockReturnValue(new Promise(() => undefined));
    const { provider } = createProvider(client);
    await expect(provider.retrieveStageText("session-1", 1)).resolves.toMatchObject({ ok: false, code: "timeout" });

    const sdkError = new Error("private SDK details");
    client.session.abort.mockRejectedValueOnce(sdkError);
    await expect(provider.cancel("session-1")).resolves.toMatchObject({ ok: false, code: "sdk-error" });
    const result = await provider.cancel("session-1");
    expect(result).not.toBe(sdkError);
  });

  it("runs one prompt and maps a deadline elapse without retrying", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const { provider } = createProvider(client);
    const result = provider.runStage("session-1", "one bounded packet", 60_000, "prover");
    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // The 35s stage bound means 30s alone never settles the run.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1);
  });

  it("polls until later assistant text appears and never retains it", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    client.session.messages.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
      data: [
        { info: { role: "assistant", time: { created: 0, completed: 1 } }, parts: [{ type: "text", text: "done" }] },
      ],
    });
    const { provider } = createProvider(client);
    const result = provider.runStage("session-1", "packet", 1_000, "verifier");
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({ ok: true, text: "done" });
    expect(provider).not.toHaveProperty("packet");
    expect(provider).not.toHaveProperty("stageText");
  });

  it("keeps polling a growing marker-less reply and never returns partial streamed text", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    let polls = 0;
    client.session.messages.mockImplementation(() => {
      polls += 1;
      return Promise.resolve({
        data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "partial".slice(0, polls) }] }],
      });
    });
    const { provider } = createProvider(client);
    const result = provider.retrieveStageText("session-1", 200);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toMatchObject({ ok: false, code: "timeout" });
    // The retriever kept polling instead of returning the first partial text.
    expect(polls).toBeGreaterThan(1);
  });

  it("returns the full text when every text part reports an end timestamp without a message marker", async () => {
    const client = fakeClient();
    client.session.messages.mockResolvedValue({
      data: [
        {
          info: { role: "assistant", time: { created: 0 } },
          parts: [
            { type: "text", text: "alpha", time: { start: 0, end: 5 } },
            { type: "text", text: "beta", time: { start: 6, end: 7 } },
          ],
        },
      ],
    });
    const { provider } = createProvider(client);
    await expect(provider.retrieveStageText("session-1", 1000)).resolves.toEqual({ ok: true, text: "alpha\nbeta" });
  });

  it("returns marker-less text after six consecutive identical polls", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    client.session.messages.mockResolvedValue({
      data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "stable" }] }],
    });
    const { provider } = createProvider(client);
    const result = provider.retrieveStageText("session-1", 1_000);
    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // Five identical polls are not enough; the sixth consecutive observation is.
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({ ok: true, text: "stable" });
  });

  it("times out when a marker-less reply keeps changing text", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    let polls = 0;
    client.session.messages.mockImplementation(() => {
      polls += 1;
      return Promise.resolve({
        data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: polls % 2 === 0 ? "even" : "odd" }] }],
      });
    });
    const { provider } = createProvider(client);
    const result = provider.retrieveStageText("session-1", 400);
    await vi.advanceTimersByTimeAsync(400);
    await expect(result).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(polls).toBeGreaterThan(1);
  });

  it("awaits abort and delete before a newer review creates a session", async () => {
    const client = fakeClient();
    let releaseAbort!: () => void;
    client.session.abort.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseAbort = resolve)));
    const { provider } = createProvider(client);
    const first = await provider.beginReview();
    await provider.createSession("first");
    const cleanup = provider.cancelReview(first);
    await Promise.resolve();
    expect(client.session.delete).not.toHaveBeenCalled();
    expect(client.session.create).toHaveBeenCalledTimes(1);
    releaseAbort();
    await cleanup;
    const second = await provider.beginReview();
    await provider.createSession("second");
    expect(client.session.abort.mock.invocationCallOrder[0]).toBeLessThan(
      client.session.delete.mock.invocationCallOrder[0],
    );
    expect(client.session.delete.mock.invocationCallOrder[0]).toBeLessThan(
      client.session.create.mock.invocationCallOrder[1],
    );
    expect(provider.isReviewCurrent(first)).toBe(false);
    expect(provider.isReviewCurrent(second)).toBe(true);
  });

  it("supersedes late results with a publication generation token", async () => {
    const { provider } = createProvider();
    const first = await provider.beginReview();
    const second = await provider.beginReview();
    expect(provider.isReviewCurrent(first)).toBe(false);
    expect(provider.isReviewCurrent(second)).toBe(true);
  });

  it("cancels and deletes the exact session id", async () => {
    const { client, provider } = createProvider();
    await provider.cancel("session-1");
    await provider.delete("session-1");
    expect(client.session.abort).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(client.session.delete).toHaveBeenCalledWith({ sessionID: "session-1" });
  });
});
