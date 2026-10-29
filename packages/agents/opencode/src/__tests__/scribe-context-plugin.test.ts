import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeTurnId,
  isNativeTurnId,
  SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS,
  SCRIBE_REASONING_CONTEXT_GRACE_MS,
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES,
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS,
  SCRIBE_REASONING_CONTEXT_RPC,
} from "../reasoning-context-plugin";
import { RESTRICTED_REVIEW_AGENT_NAME } from "../restricted-review-overlay";

type Hook = (event: unknown) => unknown;
type ToolHook = (event: unknown) => unknown;
type PermissionRule = { action: string; resource: string; effect: "allow" | "ask" | "deny" };
type AgentProfile = {
  mode: string;
  hidden?: boolean;
  model?: string;
  permissions: PermissionRule[];
};
type AgentEditor = {
  get: (name: string) => AgentProfile | undefined;
  update: (name: string, updater: (agent: AgentProfile) => void) => void;
};
type AgentTransform = (editor: AgentEditor) => void;

type PluginContext = {
  rpc: { register: ReturnType<typeof vi.fn> };
  session: { hook: ReturnType<typeof vi.fn> };
  permission: { hook: ReturnType<typeof vi.fn> };
  tool: { hook: ReturnType<typeof vi.fn> };
  agent: { transform: ReturnType<typeof vi.fn> };
};

type Plugin = {
  id: string;
  setup: (context: PluginContext) => Promise<() => Promise<void>>;
};

async function loadPlugin() {
  // @ts-expect-error The shipped plugin is deliberately plain JavaScript.
  const module = await import("../scribe-context-plugin/server.js");
  return module.default as Plugin;
}

async function createPluginHarness() {
  const handlers: Record<string, Record<string, (input: unknown) => Promise<unknown>>> = {};
  const hooks = new Map<string, Hook>();
  const permissionHooks = new Map<string, Hook>();
  const toolHooks = new Map<string, ToolHook>();
  const transforms: AgentTransform[] = [];
  const agents: Record<string, AgentProfile> = {
    scout: {
      mode: "all",
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "subagent", resource: "chat-research-worker", effect: "allow" },
      ],
    },
    "chat-research-worker": {
      mode: "subagent",
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    },
    build: {
      mode: "all",
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    },
    "chat-reasoning-critic": {
      mode: "subagent",
      hidden: true,
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "execute", resource: "*", effect: "deny" },
      ],
    },
    "chat-reasoning-verifier": {
      mode: "subagent",
      hidden: true,
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "execute", resource: "*", effect: "deny" },
      ],
    },
  };
  const disposals = Array.from({ length: 8 }, () => vi.fn());
  let disposalIndex = 0;
  const context: PluginContext = {
    rpc: {
      register: vi.fn(async (definition: { id: string; events: object; methods: Record<string, unknown> }, methods) => {
        handlers[definition.id] = methods;
        return { dispose: disposals[disposalIndex++] };
      }),
    },
    session: {
      hook: vi.fn(async (name: string, callback: Hook) => {
        hooks.set(name, callback);
        return { dispose: disposals[disposalIndex++] };
      }),
    },
    permission: {
      hook: vi.fn(async (name: string, callback: Hook) => {
        permissionHooks.set(name, callback);
        return { dispose: disposals[disposalIndex++] };
      }),
    },
    tool: {
      hook: vi.fn(async (name: string, callback: ToolHook) => {
        toolHooks.set(name, callback);
        return { dispose: disposals[disposalIndex++] };
      }),
    },
    agent: {
      transform: vi.fn(async (callback: AgentTransform) => {
        transforms.push(callback);
        return { dispose: disposals[disposalIndex++] };
      }),
    },
  };
  const plugin = await loadPlugin();
  const dispose = await plugin.setup(context);
  return { plugin, context, handlers, hooks, permissionHooks, toolHooks, transforms, agents, dispose, disposals };
}

function applyAgentTransform(harness: Awaited<ReturnType<typeof createPluginHarness>>): void {
  const transform = harness.transforms[0];
  if (!transform) throw new Error("agent transform is not registered");
  transform({
    get: (name) => harness.agents[name],
    update: (name, updater) => {
      const agent = harness.agents[name];
      if (!agent) throw new Error(`Unknown test agent: ${name}`);
      updater(agent);
    },
  });
}

describe("bundled Scribe reasoning-context plugin", () => {
  it("creates and validates native OpenCode message IDs", () => {
    const turnID = createNativeTurnId();

    expect(turnID).toMatch(/^msg_[a-f0-9]{32}$/u);
    expect(isNativeTurnId(turnID)).toBe(true);
    expect(isNativeTurnId("b4b2f0b3-0e3f-4d77-9f7b-fc2a2e37cfe1")).toBe(false);
    expect(isNativeTurnId("msg_ABCDEF0123456789ABCDEF0123456789")).toBe(false);
    expect(isNativeTurnId("msg_0123456789abcdef0123456789abcde")).toBe(false);
  });

  it("registers bounded RPC, lifecycle, permission, tool-result, and agent hooks without defining tools", async () => {
    const harness = await createPluginHarness();
    const registration = harness.context.rpc.register.mock.calls[0];
    const definition = registration?.[0] as { id: string; events: object; methods: Record<string, unknown> };

    expect(harness.plugin.id).toBe("drmrStudio.scribe-reasoning-context");
    expect(definition.id).toBe("scribe_reasoning_context");
    expect(definition.events).toEqual({});
    expect(Object.keys(definition.methods).sort()).toEqual(["clear", "pending", "put"]);
    expect([...harness.hooks.keys()].sort()).toEqual(["context", "generate", "prompt"]);
    expect([...harness.permissionHooks.keys()]).toEqual(["evaluate"]);
    expect([...harness.toolHooks.keys()].sort()).toEqual(["execute.after", "execute.before"]);
    expect(harness.context.rpc.register).toHaveBeenCalledTimes(1);
    expect(harness.context.session.hook).toHaveBeenCalledTimes(3);
    expect(harness.context.permission.hook).toHaveBeenCalledTimes(1);
    expect(harness.context.tool.hook).toHaveBeenCalledTimes(2);
    expect(harness.context.agent.transform).toHaveBeenCalledTimes(1);
    expect(Object.keys(harness.context.tool)).toEqual(["hook"]);
  });

  it("caps completed foreground reasoning-subagent output and content at 2,048 characters", async () => {
    const { toolHooks } = await createPluginHarness();
    const executeAfter = toolHooks.get("execute.after");
    if (!executeAfter) throw new Error("tool result hook is not registered");
    const longText = "🧪".repeat(1_500);
    const event = {
      tool: "subagent",
      status: "completed",
      input: { agent: "chat-reasoning-critic" },
      result: {
        output: { sessionID: "ses_reasoning", status: "completed", output: longText },
        content: `<subagent>${longText}</subagent>`,
        metadata: { sessionID: "ses_reasoning", status: "completed" },
      },
    };

    expect(() => executeAfter(event)).not.toThrow();

    const result = event.result;
    expect(result.output.output.length).toBeLessThanOrEqual(2_048);
    expect(result.output.output.endsWith("\n[truncated by OpenCode Scribe]")).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(2_048);
    expect(result.content.endsWith("\n[truncated by OpenCode Scribe]")).toBe(true);
    expect(/[\uD800-\uDBFF]$/u.test(result.output.output.slice(0, -"\n[truncated by OpenCode Scribe]".length))).toBe(
      false,
    );
    expect(result.metadata).toEqual({ sessionID: "ses_reasoning", status: "completed" });
  });

  it("does not cap unrelated tools, other agents, errors, or background launch acknowledgements", async () => {
    const { toolHooks } = await createPluginHarness();
    const executeAfter = toolHooks.get("execute.after");
    if (!executeAfter) throw new Error("tool result hook is not registered");
    const longText = "x".repeat(3_000);
    const events = [
      {
        tool: "subagent",
        status: "completed",
        input: { agent: "chat-research-worker" },
        result: { output: { sessionID: "worker", status: "completed", output: longText }, content: longText },
      },
      {
        tool: "read",
        status: "completed",
        input: { agent: "chat-reasoning-critic" },
        result: { content: longText },
      },
      {
        tool: "subagent",
        status: "error",
        input: { agent: "chat-reasoning-verifier" },
        error: { message: longText },
      },
      {
        tool: "subagent",
        status: "completed",
        input: { agent: "chat-reasoning-critic", background: true },
        result: { output: { sessionID: "background", status: "running", output: longText }, content: longText },
      },
    ];
    const before = structuredClone(events);

    for (const event of events) expect(() => executeAfter(event)).not.toThrow();

    expect(events).toEqual(before);
  });

  it("keeps the result hook total when native event data is malformed", async () => {
    const { toolHooks } = await createPluginHarness();
    const executeAfter = toolHooks.get("execute.after");
    if (!executeAfter) throw new Error("tool result hook is not registered");
    const malformed = new Proxy(
      { tool: "subagent", status: "completed", input: { agent: "chat-reasoning-critic" } },
      {
        get(target, key, receiver) {
          if (key === "result") throw new Error("simulated malformed native result");
          return Reflect.get(target, key, receiver);
        },
      },
    );

    expect(() => executeAfter(malformed)).not.toThrow();
  });

  it("replaces every Scout delegation grant with the exact three native targets", async () => {
    const harness = await createPluginHarness();
    harness.agents.scout?.permissions.push(
      { action: "subagent", resource: "chat-reasoning-critic", effect: "allow" },
      { action: "subagent", resource: "chat-reasoning-verifier-extra", effect: "allow" },
      { action: "subagent", resource: "*", effect: "allow" },
      { action: "subagent", resource: "unlisted-agent", effect: "ask" },
      { action: "*", resource: "*", effect: "ask" },
      { action: "task", resource: "*", effect: "allow" },
      { action: "*", resource: "*", effect: "allow" },
    );

    applyAgentTransform(harness);

    const permissions = harness.agents.scout?.permissions ?? [];
    expect(permissions.filter((rule) => rule.action === "subagent" && rule.effect === "allow")).toEqual([
      { action: "subagent", resource: "chat-research-worker", effect: "allow" },
      { action: "subagent", resource: "chat-reasoning-critic", effect: "allow" },
      { action: "subagent", resource: "chat-reasoning-verifier", effect: "allow" },
    ]);
    expect(permissions).not.toContainEqual({ action: "task", resource: "*", effect: "allow" });
    expect(permissions).not.toContainEqual({ action: "subagent", resource: "unlisted-agent", effect: "ask" });
    expect(permissions).not.toContainEqual({ action: "*", resource: "*", effect: "ask" });
    expect(permissions).not.toContainEqual({ action: "*", resource: "*", effect: "allow" });
    expect(permissions).toContainEqual({ action: "*", resource: "*", effect: "deny" });
    expect(harness.agents["chat-research-worker"]?.permissions).not.toContainEqual(
      expect.objectContaining({ action: "subagent", effect: "allow" }),
    );
    expect(harness.agents.build?.permissions).not.toContainEqual(
      expect.objectContaining({ action: "subagent", effect: "allow" }),
    );
  });

  it("waits for all native profiles before applying reasoning-target grants", async () => {
    const harness = await createPluginHarness();
    const scout = harness.agents.scout;
    const critic = harness.agents["chat-reasoning-critic"];
    const verifier = harness.agents["chat-reasoning-verifier"];
    if (!scout || !critic || !verifier) throw new Error("test profiles are missing");

    delete harness.agents["chat-reasoning-critic"];
    expect(() => applyAgentTransform(harness)).not.toThrow();
    expect(scout.permissions.filter((rule) => rule.action === "subagent" && rule.effect === "allow")).toEqual([
      { action: "subagent", resource: "chat-research-worker", effect: "allow" },
    ]);

    harness.agents["chat-reasoning-critic"] = critic;
    delete harness.agents["chat-reasoning-verifier"];
    expect(() => applyAgentTransform(harness)).not.toThrow();
    expect(scout.permissions.filter((rule) => rule.action === "subagent" && rule.effect === "allow")).toEqual([
      { action: "subagent", resource: "chat-research-worker", effect: "allow" },
    ]);

    harness.agents["chat-reasoning-verifier"] = verifier;
    expect(() => applyAgentTransform(harness)).not.toThrow();
    expect(scout.permissions.filter((rule) => rule.action === "subagent" && rule.effect === "allow")).toEqual([
      { action: "subagent", resource: "chat-research-worker", effect: "allow" },
      { action: "subagent", resource: "chat-reasoning-critic", effect: "allow" },
      { action: "subagent", resource: "chat-reasoning-verifier", effect: "allow" },
    ]);
    expect(critic.permissions.every((rule) => rule.effect === "deny")).toBe(true);
    expect(verifier.permissions.every((rule) => rule.effect === "deny")).toBe(true);
  });

  it("removes reviewer model tools while leaving Scout and other agents unchanged", async () => {
    const harness = await createPluginHarness();
    applyAgentTransform(harness);
    const context = harness.hooks.get("context");
    if (!context) throw new Error("context hook is not registered");
    for (const target of ["chat-reasoning-critic", "chat-reasoning-verifier", RESTRICTED_REVIEW_AGENT_NAME]) {
      const tools = { browser: { description: "browser" }, read: { description: "read" } };
      await context({ agent: target, tools });
      expect(tools).toEqual({});
      const emptyTools = {};
      await expect(context({ agent: target, tools: emptyTools })).resolves.toBeUndefined();
      expect(emptyTools).toEqual({});
    }
    const scoutTools = { browser: { description: "browser" } };
    await context({ agent: "scout", tools: scoutTools });
    expect(scoutTools).toEqual({ browser: { description: "browser" } });
    const otherTools = { read: { description: "read" } };
    await context({ agent: "build", tools: otherTools });
    expect(otherTools).toEqual({ read: { description: "read" } });
    const workerTools = { browser: { description: "browser" } };
    await context({ agent: "chat-research-worker", tools: workerTools });
    expect(workerTools).toEqual({ browser: { description: "browser" } });
    for (const agent of ["vibefeld-restricted-review-extra", "chat-reasoning-critic-extra"]) {
      const nearMissTools = { read: { description: "read" } };
      await context({ agent, tools: nearMissTools });
      expect(nearMissTools).toEqual({ read: { description: "read" } });
    }
    expect(harness.agents.scout?.permissions).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "subagent", resource: "chat-research-worker", effect: "allow" },
      { action: "subagent", resource: "chat-reasoning-critic", effect: "allow" },
      { action: "subagent", resource: "chat-reasoning-verifier", effect: "allow" },
    ]);
    expect(harness.agents["chat-research-worker"]?.permissions).toEqual([
      { action: "*", resource: "*", effect: "deny" },
    ]);
  });

  it("fails closed when restricted context tool definitions are malformed or cannot be removed", async () => {
    const { hooks } = await createPluginHarness();
    const context = hooks.get("context");
    if (!context) throw new Error("context hook is not registered");
    const failure = "Scribe could not safely remove tools from a restricted model request.";
    const throwingTools = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("injected context-filter failure");
        },
      },
    );
    const nonConfigurableTools = Object.defineProperty({}, "read", {
      value: { description: "read" },
      configurable: false,
    });

    for (const agent of ["chat-reasoning-critic", "chat-reasoning-verifier", RESTRICTED_REVIEW_AGENT_NAME]) {
      await expect(context({ agent })).rejects.toThrow(failure);
      await expect(context({ agent, tools: null })).rejects.toThrow(failure);
      await expect(context({ agent, tools: [] })).rejects.toThrow(failure);
      await expect(context({ agent, tools: throwingTools })).rejects.toThrow(failure);
      await expect(context({ agent, tools: nonConfigurableTools })).rejects.toThrow(failure);
    }

    await expect(context({ agent: "scout", tools: null, system: [] })).resolves.toBeUndefined();
  });

  it("removes only host-restricted generate tools and fails closed on malformed definitions", async () => {
    const harness = await createPluginHarness();
    const generate = harness.hooks.get("generate");
    if (!generate) throw new Error("generate hook is not registered");

    const system = [{ type: "text", text: "unchanged system" }];
    const messages = [{ role: "user", content: "unchanged prompt" }];
    const options = { temperature: 0.25 };
    const restrictedTools = { skill: { description: "skill" }, read: { description: "read" } };
    const restrictedEvent = {
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      tools: restrictedTools,
      system,
      messages,
      options,
    };
    expect(() => generate(restrictedEvent)).not.toThrow();
    expect(restrictedTools).toEqual({});
    expect(restrictedEvent).toEqual({
      agent: RESTRICTED_REVIEW_AGENT_NAME,
      tools: {},
      system,
      messages,
      options,
    });

    for (const agent of [
      "scout",
      "chat-research-worker",
      "build",
      "chat-reasoning-critic",
      "chat-reasoning-verifier",
      "vibefeld-restricted-review-extra",
    ]) {
      const tools = { skill: { description: "skill" }, read: { description: "read" } };
      expect(() => generate({ agent, tools })).not.toThrow();
      expect(tools).toEqual({ skill: { description: "skill" }, read: { description: "read" } });
    }
    expect(() => generate({ agent: "scout" })).not.toThrow();
    expect(() => generate({ agent: "scout", tools: null })).not.toThrow();

    const failure = "Scribe could not safely remove tools from a restricted model request.";
    const throwingTools = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("injected generate-hook failure");
        },
      },
    );
    const nonConfigurableTools = Object.defineProperty({}, "read", {
      value: { description: "read" },
      configurable: false,
    });
    expect(() => generate({ agent: RESTRICTED_REVIEW_AGENT_NAME })).toThrow(failure);
    expect(() => generate({ agent: RESTRICTED_REVIEW_AGENT_NAME, tools: null })).toThrow(failure);
    expect(() => generate({ agent: RESTRICTED_REVIEW_AGENT_NAME, tools: [] })).toThrow(failure);
    expect(() => generate({ agent: RESTRICTED_REVIEW_AGENT_NAME, tools: throwingTools })).toThrow(failure);
    expect(() => generate({ agent: RESTRICTED_REVIEW_AGENT_NAME, tools: nonConfigurableTools })).toThrow(failure);
  });

  it("never injects the Scout brief into a reasoning reviewer", async () => {
    const { handlers, hooks } = await createPluginHarness();
    const put = handlers.scribe_reasoning_context?.put;
    const prompt = hooks.get("prompt");
    const context = hooks.get("context");
    if (!put || !prompt || !context) throw new Error("plugin registrations are incomplete");
    await put({ sessionID: "session-A", turnID: "turn-A", brief: "Scout-only brief" });
    prompt({ sessionID: "session-A", messageID: "turn-A" });
    const system: unknown[] = [];
    for (const target of ["chat-reasoning-critic", RESTRICTED_REVIEW_AGENT_NAME]) {
      const tools = { browser: {} };
      await context({ sessionID: "session-A", agent: target, tools, system });
      expect(tools).toEqual({});
    }
    expect(system).toEqual([]);
  });

  it("allows each exact reasoning target once per active Scout turn, then resets on the next prompt", async () => {
    const harness = await createPluginHarness();
    const prompt = harness.hooks.get("prompt");
    const evaluate = harness.permissionHooks.get("evaluate");
    if (!prompt || !evaluate) throw new Error("reasoning hooks are not registered");

    const invoke = (sessionID: string, target: string, agent = "scout") => {
      const event = { sessionID, agent, action: "subagent", resources: [target], effect: "allow" as string };
      evaluate(event);
      return event.effect;
    };

    prompt({ sessionID: "session-A", messageID: "turn-A" });
    expect(invoke("session-A", "chat-reasoning-critic")).toBe("allow");
    expect(invoke("session-A", "chat-reasoning-critic")).toBe("deny");
    expect(invoke("session-A", "chat-reasoning-verifier")).toBe("allow");
    expect(invoke("session-A", "chat-reasoning-verifier")).toBe("deny");

    prompt({ sessionID: "session-A", messageID: "turn-B" });
    expect(invoke("session-A", "chat-reasoning-critic")).toBe("allow");
    expect(invoke("session-A", "chat-reasoning-verifier")).toBe("allow");
  });

  it("rejects repeated reviewer tool invocations even when native permission evaluation is cached", async () => {
    const harness = await createPluginHarness();
    const prompt = harness.hooks.get("prompt");
    const executeBefore = harness.toolHooks.get("execute.before");
    if (!prompt || !executeBefore) throw new Error("reasoning hooks are not registered");

    const invoke = (sessionID: string, target: string, agent = "scout") =>
      executeBefore({ tool: "subagent", sessionID, agent, input: { agent: target } });

    prompt({ sessionID: "session-A", messageID: "turn-A" });
    expect(() => invoke("session-A", "chat-reasoning-critic")).not.toThrow();
    expect(() => invoke("session-A", "chat-reasoning-critic")).toThrow(
      "This reasoning target is unavailable or has already been used this turn.",
    );
    expect(() => invoke("session-A", "chat-reasoning-verifier")).not.toThrow();
    expect(() => invoke("session-A", "chat-reasoning-verifier")).toThrow(
      "This reasoning target is unavailable or has already been used this turn.",
    );

    prompt({ sessionID: "session-A", messageID: "turn-B" });
    expect(() => invoke("session-A", "chat-reasoning-critic")).not.toThrow();
    expect(() => invoke("session-A", "chat-reasoning-verifier")).not.toThrow();
    expect(() => invoke("session-A", "chat-reasoning-critic", "build")).toThrow(
      "This reasoning target is unavailable or has already been used this turn.",
    );
    expect(() => invoke("session-A", "chat-research-worker")).not.toThrow();
  });

  it("fails closed for reasoning targets outside Scout's active turn and leaves other permissions untouched", async () => {
    const harness = await createPluginHarness();
    const prompt = harness.hooks.get("prompt");
    const evaluate = harness.permissionHooks.get("evaluate");
    if (!prompt || !evaluate) throw new Error("reasoning hooks are not registered");

    const invoke = (sessionID: string, target: string, agent = "scout") => {
      const event = { sessionID, agent, action: "subagent", resources: [target], effect: "allow" as string };
      evaluate(event);
      return event.effect;
    };

    expect(invoke("unknown-session", "chat-reasoning-critic")).toBe("deny");
    prompt({ sessionID: "session-A", messageID: "turn-A" });
    expect(invoke("session-A", "chat-reasoning-verifier", "build")).toBe("deny");
    expect(invoke("session-B", "chat-reasoning-verifier")).toBe("deny");
    expect(invoke("session-A", "chat-reasoning-verifier")).toBe("allow");

    const workerCall = {
      sessionID: "unknown-session",
      agent: "build",
      action: "subagent",
      resources: ["chat-research-worker"],
      effect: "ask",
    };
    evaluate(workerCall);
    expect(workerCall.effect).toBe("ask");

    const unrelatedAction = {
      sessionID: "unknown-session",
      agent: "build",
      action: "read",
      resources: ["chat-reasoning-critic"],
      effect: "ask",
    };
    evaluate(unrelatedAction);
    expect(unrelatedAction.effect).toBe("ask");
  });

  it("denies Scout near-miss targets and all tool calls from reasoning agents", async () => {
    const harness = await createPluginHarness();
    const prompt = harness.hooks.get("prompt");
    const evaluate = harness.permissionHooks.get("evaluate");
    if (!prompt || !evaluate) throw new Error("reasoning hooks are not registered");

    prompt({ sessionID: "session-A", messageID: "turn-A" });
    const nearMiss = {
      sessionID: "session-A",
      agent: "scout",
      action: "subagent",
      resources: ["chat-reasoning-critic-extra"],
      effect: "allow",
    };
    evaluate(nearMiss);
    expect(nearMiss.effect).toBe("deny");

    for (const agent of ["chat-reasoning-critic", "chat-reasoning-verifier"]) {
      for (const action of [
        "read",
        "edit",
        "bash",
        "execute",
        "webfetch",
        "firecrawl_search",
        "vibefeld",
        "hindsight_recall",
        "subagent",
        "unrecognized-action",
      ]) {
        const reviewerPermission = {
          sessionID: "child-session",
          agent,
          action,
          resources: [action === "subagent" ? "chat-research-worker" : "*"],
          effect: "allow",
        };
        evaluate(reviewerPermission);
        expect(reviewerPermission.effect).toBe("deny");
      }
    }

    const worker = {
      sessionID: "session-A",
      agent: "scout",
      action: "subagent",
      resources: ["chat-research-worker"],
      effect: "allow",
    };
    evaluate(worker);
    expect(worker.effect).toBe("allow");
  });

  it("denies an identified reasoning call if evaluation fails but does not change non-reasoning failures", async () => {
    const harness = await createPluginHarness();
    const evaluate = harness.permissionHooks.get("evaluate");
    if (!evaluate) throw new Error("permission hook is not registered");

    const reasoningEvent = new Proxy(
      {
        sessionID: "session-A",
        action: "subagent",
        resources: ["chat-reasoning-critic"],
        effect: "allow",
        message: undefined as string | undefined,
      },
      {
        get(target, key, receiver) {
          if (key === "agent") throw new Error("simulated permission hook failure");
          return Reflect.get(target, key, receiver);
        },
      },
    );
    evaluate(reasoningEvent);
    expect(reasoningEvent.effect).toBe("deny");

    const unrelatedResources = new Proxy(["chat-research-worker"], {
      get(target, key, receiver) {
        if (key === "0") throw new Error("simulated unrelated hook failure");
        return Reflect.get(target, key, receiver);
      },
    });
    const unrelatedEvent = {
      sessionID: "session-A",
      agent: "scout",
      action: "subagent",
      resources: unrelatedResources,
      effect: "ask",
    };
    evaluate(unrelatedEvent);
    expect(unrelatedEvent.effect).toBe("ask");
  });

  it("keeps per-turn enforcement bounded and normalizes reasoning permissions to deny-only", async () => {
    const harness = await createPluginHarness();
    const prompt = harness.hooks.get("prompt");
    const evaluate = harness.permissionHooks.get("evaluate");
    if (!prompt || !evaluate) throw new Error("reasoning hooks are not registered");

    for (let index = 0; index < 16; index += 1) {
      prompt({ sessionID: `session-${index}`, messageID: "turn" });
    }
    const lastAllowed = {
      sessionID: "session-15",
      agent: "scout",
      action: "subagent",
      resources: ["chat-reasoning-critic"],
      effect: "allow",
    };
    evaluate(lastAllowed);
    expect(lastAllowed.effect).toBe("allow");
    const overflow = {
      sessionID: "session-overflow",
      agent: "scout",
      action: "subagent",
      resources: ["chat-reasoning-critic"],
      effect: "allow",
    };
    evaluate(overflow);
    expect(overflow.effect).toBe("deny");

    for (const target of ["chat-reasoning-critic", "chat-reasoning-verifier"]) {
      harness.agents[target]?.permissions.push(
        { action: "read", resource: "*", effect: "allow" },
        { action: "execute", resource: "*", effect: "ask" },
      );
    }
    applyAgentTransform(harness);
    for (const target of ["chat-reasoning-critic", "chat-reasoning-verifier"]) {
      expect(harness.agents[target]?.permissions.every((rule) => rule.effect === "deny")).toBe(true);
    }

    const invalidReasoning = await createPluginHarness();
    const critic = invalidReasoning.agents["chat-reasoning-critic"];
    if (critic) critic.mode = "all";
    expect(() => applyAgentTransform(invalidReasoning)).toThrow("tool-less profile");

    const unexpectedScout = await createPluginHarness();
    if (unexpectedScout.agents.scout) unexpectedScout.agents.scout.mode = "subagent";
    expect(() => applyAgentTransform(unexpectedScout)).toThrow("deny-by-default profile");
  });

  it("injects synchronously only for the prompt-bound Scout session and turn", async () => {
    const { handlers, hooks } = await createPluginHarness();
    const rpc = handlers.scribe_reasoning_context;
    const put = rpc?.put;
    const prompt = hooks.get("prompt");
    const context = hooks.get("context");
    if (!put || !prompt || !context) throw new Error("plugin registrations are incomplete");

    await expect(put({ sessionID: "session-A", turnID: "turn-A", brief: "bounded brief" })).resolves.toEqual({
      accepted: true,
      internalGraceWaitMs: 0,
    });
    prompt({ sessionID: "session-A", messageID: "turn-A" });

    const system: unknown[] = [];
    await expect(context({ sessionID: "session-A", agent: "scout", system })).resolves.toBeUndefined();
    expect(system).toEqual([{ type: "text", text: "bounded brief" }]);

    const nextLoopSystem: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: nextLoopSystem });
    expect(nextLoopSystem).toEqual([{ type: "text", text: "bounded brief" }]);

    const nonScoutSystem: unknown[] = [];
    await context({ sessionID: "session-A", agent: "build", system: nonScoutSystem });
    expect(nonScoutSystem).toEqual([]);
  });

  it("isolates cross-session and stale keys while retaining briefs for the active turn", async () => {
    const { handlers, hooks } = await createPluginHarness();
    const rpc = handlers.scribe_reasoning_context;
    const put = rpc?.put;
    const clear = rpc?.clear;
    const prompt = hooks.get("prompt");
    const context = hooks.get("context");
    if (!put || !clear || !prompt || !context) throw new Error("plugin registrations are incomplete");

    await put({ sessionID: "session-A", turnID: "turn-A", brief: "private A" });
    prompt({ sessionID: "session-B", messageID: "turn-A" });
    const foreignSystem: unknown[] = [];
    await context({ sessionID: "session-B", agent: "scout", system: foreignSystem });
    expect(foreignSystem).toEqual([]);

    prompt({ sessionID: "session-A", messageID: "turn-A" });
    const firstSystem: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: firstSystem });
    expect(firstSystem).toEqual([{ type: "text", text: "private A" }]);
    const secondSystem: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: secondSystem });
    expect(secondSystem).toEqual([{ type: "text", text: "private A" }]);

    prompt({ sessionID: "session-A", messageID: "stale-turn" });
    const staleSystem: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: staleSystem });
    expect(staleSystem).toEqual([]);

    await put({ sessionID: "session-A", turnID: "turn-B", brief: "private B" });
    prompt({ sessionID: "session-A", messageID: "turn-B" });
    await expect(clear({ sessionID: "session-A", turnID: "turn-A" })).resolves.toEqual({
      cleared: 0,
      internalGraceWaitMs: 0,
    });
    const stillActive: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: stillActive });
    expect(stillActive).toEqual([{ type: "text", text: "private B" }]);

    const stillActiveLoop: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: stillActiveLoop });
    expect(stillActiveLoop).toEqual([{ type: "text", text: "private B" }]);

    await expect(clear({ sessionID: "session-A" })).resolves.toEqual({ cleared: 1, internalGraceWaitMs: 0 });
    const clearedSystem: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: clearedSystem });
    expect(clearedSystem).toEqual([]);
  });

  it("waits only for a matching confirmed pending turn and resolves when put arrives", async () => {
    const { handlers, hooks } = await createPluginHarness();
    const pending = handlers.scribe_reasoning_context?.pending;
    const put = handlers.scribe_reasoning_context?.put;
    const prompt = hooks.get("prompt");
    const context = hooks.get("context");
    if (!pending || !put || !prompt || !context) throw new Error("plugin registrations are incomplete");

    await expect(pending({ sessionID: "session-A", turnID: "turn-A", graceMs: 1_000 })).resolves.toEqual({
      pending: true,
    });
    prompt({ sessionID: "session-A", messageID: "turn-A" });
    const system: unknown[] = [];
    let completed = false;
    const contextPromise = Promise.resolve(context({ sessionID: "session-A", agent: "scout", system })).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    const putResult = await put({ sessionID: "session-A", turnID: "turn-A", brief: "arrived within grace" });
    await contextPromise;
    expect(putResult).toMatchObject({ accepted: true, internalGraceWaitMs: expect.any(Number) });
    expect((putResult as { internalGraceWaitMs: number }).internalGraceWaitMs).toBeLessThanOrEqual(1_000);
    expect(system).toEqual([{ type: "text", text: "arrived within grace" }]);

    const nextLoopSystem: unknown[] = [];
    await context({ sessionID: "session-A", agent: "scout", system: nextLoopSystem });
    expect(nextLoopSystem).toEqual([{ type: "text", text: "arrived within grace" }]);
  });

  it("does not wait on an unpended Scout turn", async () => {
    const { hooks } = await createPluginHarness();
    const prompt = hooks.get("prompt");
    const context = hooks.get("context");
    if (!prompt || !context) throw new Error("plugin hooks are incomplete");

    prompt({ sessionID: "session-A", messageID: "turn-A" });
    const system: unknown[] = [];
    await expect(context({ sessionID: "session-A", agent: "scout", system })).resolves.toBeUndefined();
    expect(system).toEqual([]);
  });

  it("clears a pending grace wait without injecting a brief", async () => {
    vi.useFakeTimers();
    try {
      const { handlers, hooks } = await createPluginHarness();
      const pending = handlers.scribe_reasoning_context?.pending;
      const clear = handlers.scribe_reasoning_context?.clear;
      const prompt = hooks.get("prompt");
      const context = hooks.get("context");
      if (!pending || !clear || !prompt || !context) throw new Error("plugin registrations are incomplete");

      await pending({ sessionID: "session-A", turnID: "turn-A", graceMs: 1_000 });
      prompt({ sessionID: "session-A", messageID: "turn-A" });
      const system: unknown[] = [];
      let completed = false;
      const contextPromise = Promise.resolve(context({ sessionID: "session-A", agent: "scout", system })).then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);

      await expect(clear({ sessionID: "session-A", turnID: "turn-A" })).resolves.toEqual({
        cleared: 0,
        internalGraceWaitMs: 0,
      });
      await contextPromise;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(system).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers a post-grace brief to every later call in the active turn, then clears on the next prompt", async () => {
    vi.useFakeTimers();
    try {
      const { handlers, hooks } = await createPluginHarness();
      const pending = handlers.scribe_reasoning_context?.pending;
      const put = handlers.scribe_reasoning_context?.put;
      const prompt = hooks.get("prompt");
      const context = hooks.get("context");
      if (!pending || !put || !prompt || !context) throw new Error("plugin registrations are incomplete");

      await pending({ sessionID: "session-A", turnID: "turn-A", graceMs: 100 });
      prompt({ sessionID: "session-A", messageID: "turn-A" });
      const firstSystem: unknown[] = [];
      const firstContext = Promise.resolve(context({ sessionID: "session-A", agent: "scout", system: firstSystem }));
      await vi.advanceTimersByTimeAsync(100);
      await firstContext;
      expect(firstSystem).toEqual([]);

      const secondSystem: unknown[] = [];
      let secondCompleted = false;
      const secondContext = Promise.resolve(
        context({ sessionID: "session-A", agent: "scout", system: secondSystem }),
      ).then(() => {
        secondCompleted = true;
      });
      await Promise.resolve();
      expect(secondCompleted).toBe(true);
      await secondContext;
      expect(secondSystem).toEqual([]);

      await expect(put({ sessionID: "session-A", turnID: "turn-A", brief: "late but current" })).resolves.toMatchObject(
        {
          accepted: true,
          internalGraceWaitMs: 100,
        },
      );
      const nextSystem: unknown[] = [];
      await context({ sessionID: "session-A", agent: "scout", system: nextSystem });
      expect(nextSystem).toEqual([{ type: "text", text: "late but current" }]);

      const followingSystem: unknown[] = [];
      await context({ sessionID: "session-A", agent: "scout", system: followingSystem });
      expect(followingSystem).toEqual([{ type: "text", text: "late but current" }]);

      prompt({ sessionID: "session-A", messageID: "turn-B" });
      const nextTurnSystem: unknown[] = [];
      await context({ sessionID: "session-A", agent: "scout", system: nextTurnSystem });
      expect(nextTurnSystem).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces the 2,000ms hard ceiling when the host requests a larger grace", async () => {
    vi.useFakeTimers();
    try {
      const { handlers, hooks } = await createPluginHarness();
      const pending = handlers.scribe_reasoning_context?.pending;
      const clear = handlers.scribe_reasoning_context?.clear;
      const prompt = hooks.get("prompt");
      const context = hooks.get("context");
      if (!pending || !clear || !prompt || !context) throw new Error("plugin registrations are incomplete");

      await expect(pending({ sessionID: "session-A", turnID: "turn-A", graceMs: 60_000 })).resolves.toEqual({
        pending: true,
      });
      prompt({ sessionID: "session-A", messageID: "turn-A" });
      const system: unknown[] = [];
      let completed = false;
      const contextPromise = Promise.resolve(context({ sessionID: "session-A", agent: "scout", system })).then(() => {
        completed = true;
      });
      await vi.advanceTimersByTimeAsync(SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS - 1);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await contextPromise;

      const result = (await clear({ sessionID: "session-A", turnID: "turn-A" })) as {
        internalGraceWaitMs: number;
      };
      expect(result.internalGraceWaitMs).toBeLessThanOrEqual(SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS);
      expect(system).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces key and entry-count bounds", async () => {
    const { handlers } = await createPluginHarness();
    const rpc = handlers.scribe_reasoning_context;
    const put = rpc?.put;
    if (!put) throw new Error("plugin RPC registration is incomplete");

    await expect(put({ sessionID: "bad/key", turnID: "turn", brief: "brief" })).resolves.toEqual({
      accepted: false,
      internalGraceWaitMs: 0,
    });
    await expect(put({ sessionID: "session", turnID: "x".repeat(129), brief: "brief" })).resolves.toEqual({
      accepted: false,
      internalGraceWaitMs: 0,
    });

    for (let index = 0; index < 16; index += 1) {
      await expect(put({ sessionID: `session-${index}`, turnID: "turn", brief: "brief" })).resolves.toEqual({
        accepted: true,
        internalGraceWaitMs: 0,
      });
    }
    await expect(put({ sessionID: "session-overflow", turnID: "turn", brief: "brief" })).resolves.toEqual({
      accepted: false,
      internalGraceWaitMs: 0,
    });
  });

  it("keeps bundled literals aligned and accepts only the shared character and UTF-8 bounds", async () => {
    const { context, handlers } = await createPluginHarness();
    const put = handlers.scribe_reasoning_context?.put;
    if (!put) throw new Error("plugin RPC registration is incomplete");

    const source = await readFile(new URL("../scribe-context-plugin/server.js", import.meta.url), "utf8");
    expect(source.match(/const MAX_BRIEF_CHARS = (\d+);/)?.[1]).toBe(String(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS));
    expect(source.match(/const MAX_BRIEF_BYTES = (\d+);/)?.[1]).toBe(String(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES));
    expect(source.match(/const MAX_GRACE_MS = (\d+);/)?.[1]).toBe(String(SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS));
    expect(SCRIBE_REASONING_CONTEXT_GRACE_MS).toBeLessThanOrEqual(SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS);

    const registration = context.rpc.register.mock.calls[0]?.[0] as {
      methods: { put: { input: { properties: { brief: { maxLength: number } } } } };
    };
    expect(registration.methods.put.input.properties.brief.maxLength).toBe(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS);
    expect(SCRIBE_REASONING_CONTEXT_RPC.methods.put.input.properties.brief.maxLength).toBe(
      SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS,
    );

    const exactLimit = "é".repeat(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS);
    expect(exactLimit.length).toBe(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS);
    expect(Buffer.byteLength(exactLimit, "utf8")).toBeLessThanOrEqual(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES);
    await expect(put({ sessionID: "session-max", turnID: "turn", brief: exactLimit })).resolves.toEqual({
      accepted: true,
      internalGraceWaitMs: 0,
    });

    const tooManyCharacters = "x".repeat(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS + 1);
    await expect(put({ sessionID: "session-char-over", turnID: "turn", brief: tooManyCharacters })).resolves.toEqual({
      accepted: false,
      internalGraceWaitMs: 0,
    });

    const tooManyBytes = "🧠".repeat(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS + 1);
    expect(Buffer.byteLength(tooManyBytes, "utf8")).toBeGreaterThan(SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES);
    await expect(put({ sessionID: "session-byte-over", turnID: "turn", brief: tooManyBytes })).resolves.toEqual({
      accepted: false,
      internalGraceWaitMs: 0,
    });
  });

  it("catches context-hook failures and disposes all in-memory registrations", async () => {
    const { handlers, hooks, dispose, disposals } = await createPluginHarness();
    const put = handlers.scribe_reasoning_context?.put;
    const prompt = hooks.get("prompt");
    const context = hooks.get("context");
    if (!put || !prompt || !context) throw new Error("plugin registrations are incomplete");

    await put({ sessionID: "session-A", turnID: "turn-A", brief: "bounded brief" });
    prompt({ sessionID: "session-A", messageID: "turn-A" });
    const system: unknown[] = [];
    Object.defineProperty(system, "push", {
      value: () => {
        throw new Error("injected hook failure");
      },
    });
    await expect(context({ sessionID: "session-A", agent: "scout", system })).resolves.toBeUndefined();

    await dispose();
    expect(disposals.every((disposeRegistration) => disposeRegistration.mock.calls.length === 1)).toBe(true);
  });
});
