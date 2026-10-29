const MAX_BRIEF_CHARS = 4096;
const MAX_BRIEF_BYTES = 16384;
const MAX_KEY_LENGTH = 128;
const MAX_ENTRIES = 16;
const MAX_GRACE_MS = 2000;
const MAX_HOST_GRACE_MS = 60000;
const MAX_SUBAGENT_RESULT_CHARS = 2048;
const SUBAGENT_RESULT_TRUNCATION_MARKER = "\n[truncated by OpenCode Scribe]";
const MAX_REASONING_TURN_SESSIONS = MAX_ENTRIES;
const RPC_ID = "scribe_reasoning_context";
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const RESTRICTED_REVIEW_AGENT_TARGET = "vibefeld-restricted-review";
const REASONING_SUBAGENT_TARGETS = ["chat-reasoning-critic", "chat-reasoning-verifier"];
const TOOLLESS_REVIEW_AGENT_TARGETS = [RESTRICTED_REVIEW_AGENT_TARGET, ...REASONING_SUBAGENT_TARGETS];
const SCOUT_SUBAGENT_TARGETS = ["chat-research-worker", ...REASONING_SUBAGENT_TARGETS];
export const REASONING_SUBAGENT_DENIAL = "This reasoning target is unavailable or has already been used this turn.";
export const SCOUT_DELEGATION_DENIAL = "This Scout delegation target is unavailable or disallowed.";
export const REASONING_SUBAGENT_TOOL_DENIAL = "Reasoning agents cannot invoke tools.";

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: MAX_KEY_LENGTH,
};

const graceWaitSchema = { type: "integer", minimum: 0, maximum: MAX_GRACE_MS };

const rpcDefinition = {
  id: RPC_ID,
  events: {},
  methods: {
    pending: {
      input: {
        type: "object",
        properties: {
          sessionID: idSchema,
          turnID: idSchema,
          graceMs: { type: "integer", minimum: 0, maximum: MAX_HOST_GRACE_MS },
        },
        required: ["sessionID", "turnID", "graceMs"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { pending: { type: "boolean" } },
        required: ["pending"],
        additionalProperties: false,
      },
    },
    put: {
      input: {
        type: "object",
        properties: {
          sessionID: idSchema,
          turnID: idSchema,
          brief: { type: "string", minLength: 1, maxLength: MAX_BRIEF_CHARS },
        },
        required: ["sessionID", "turnID", "brief"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { accepted: { type: "boolean" }, internalGraceWaitMs: graceWaitSchema },
        required: ["accepted", "internalGraceWaitMs"],
        additionalProperties: false,
      },
    },
    clear: {
      input: {
        type: "object",
        properties: { sessionID: idSchema, turnID: idSchema },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          cleared: { type: "integer", minimum: 0 },
          internalGraceWaitMs: graceWaitSchema,
        },
        required: ["cleared", "internalGraceWaitMs"],
        additionalProperties: false,
      },
    },
  },
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filterRestrictedToolsOrThrow(event) {
  try {
    if (!isRecord(event)) throw new Error();
    const tools = event.tools;
    if (!isRecord(tools)) throw new Error();
    const prototype = Object.getPrototypeOf(tools);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    for (const tool of Reflect.ownKeys(tools)) {
      if (!Reflect.deleteProperty(tools, tool)) throw new Error();
    }
    if (Reflect.ownKeys(tools).length !== 0) throw new Error();
  } catch {
    throw new Error("Scribe could not safely remove tools from a restricted model request.");
  }
}

function validKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH && KEY_PATTERN.test(value);
}

function entryKey(sessionID, turnID) {
  return JSON.stringify([sessionID, turnID]);
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function truncateSubagentText(value) {
  if (typeof value !== "string" || value.length <= MAX_SUBAGENT_RESULT_CHARS) return value;
  let prefix = value.slice(0, MAX_SUBAGENT_RESULT_CHARS - SUBAGENT_RESULT_TRUNCATION_MARKER.length);
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}${SUBAGENT_RESULT_TRUNCATION_MARKER}`;
}

function truncateSubagentContent(value) {
  if (typeof value === "string") return truncateSubagentText(value);
  if (!Array.isArray(value)) return value;
  const text = value
    .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  if (text.length <= MAX_SUBAGENT_RESULT_CHARS) return value;
  return [{ type: "text", text: truncateSubagentText(text) }];
}

function monotonicNow() {
  try {
    const value = globalThis.performance?.now();
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  } catch {
    // Use the bounded wall clock only when a monotonic clock is unavailable.
  }
  try {
    const value = Date.now();
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export default {
  id: "drmrStudio.scribe-reasoning-context",
  async setup(ctx) {
    const briefs = new Map();
    const pendingByKey = new Map();
    const activeTurnBySession = new Map();
    const reasoningTurnBySession = new Map();
    const reasoningCallsByTurn = new Map();
    const reasoningToolCallsByTurn = new Map();

    const isReasoningTarget = (value) => REASONING_SUBAGENT_TARGETS.includes(value);
    const clearReasoningTurn = (sessionID) => {
      const turnID = reasoningTurnBySession.get(sessionID);
      if (turnID !== undefined) {
        const key = entryKey(sessionID, turnID);
        reasoningCallsByTurn.delete(key);
        reasoningToolCallsByTurn.delete(key);
      }
      reasoningTurnBySession.delete(sessionID);
    };
    const beginReasoningTurn = (sessionID, turnID) => {
      clearReasoningTurn(sessionID);
      if (!validKey(turnID) || reasoningTurnBySession.size >= MAX_REASONING_TURN_SESSIONS) return;
      reasoningTurnBySession.set(sessionID, turnID);
      const key = entryKey(sessionID, turnID);
      reasoningCallsByTurn.set(key, new Set());
      reasoningToolCallsByTurn.set(key, new Set());
    };

    const settlePending = (pending, result) => {
      if (pending.settled) return;
      pending.settled = true;
      if (pending.waitStartedAt !== undefined) {
        const elapsed = Math.max(0, monotonicNow() - pending.waitStartedAt);
        pending.internalGraceWaitMs = Math.min(pending.graceMs, Math.round(elapsed));
      }
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      pending.resolve?.(result);
    };

    const clearSession = (sessionID) => {
      let cleared = 0;
      let internalGraceWaitMs = 0;
      for (const [key, entry] of briefs) {
        if (entry.sessionID === sessionID) {
          briefs.delete(key);
          cleared += 1;
        }
      }
      for (const [key, pending] of pendingByKey) {
        if (pending.sessionID !== sessionID) continue;
        settlePending(pending, "clear");
        internalGraceWaitMs = Math.min(MAX_GRACE_MS, internalGraceWaitMs + pending.internalGraceWaitMs);
        pendingByKey.delete(key);
      }
      activeTurnBySession.delete(sessionID);
      return { cleared, internalGraceWaitMs };
    };

    const clearSessionExcept = (sessionID, turnID) => {
      let cleared = 0;
      for (const [key, entry] of briefs) {
        if (entry.sessionID === sessionID && entry.turnID !== turnID) {
          briefs.delete(key);
          cleared += 1;
        }
      }
      for (const [key, pending] of pendingByKey) {
        if (pending.sessionID !== sessionID || pending.turnID === turnID) continue;
        settlePending(pending, "clear");
        pendingByKey.delete(key);
      }
      if (activeTurnBySession.get(sessionID) !== turnID) activeTurnBySession.delete(sessionID);
      return cleared;
    };

    const rpcRegistration = await ctx.rpc.register(rpcDefinition, {
      pending: async (input) => {
        if (
          !isRecord(input) ||
          !validKey(input.sessionID) ||
          !validKey(input.turnID) ||
          !Number.isSafeInteger(input.graceMs) ||
          input.graceMs < 0 ||
          input.graceMs > MAX_HOST_GRACE_MS
        ) {
          return { pending: false };
        }

        const { sessionID, turnID } = input;
        const key = entryKey(sessionID, turnID);
        const existing = pendingByKey.get(key);
        if (existing) {
          activeTurnBySession.set(sessionID, turnID);
          return { pending: true };
        }

        clearSessionExcept(sessionID, turnID);
        if (briefs.size + pendingByKey.size >= MAX_ENTRIES) return { pending: false };
        pendingByKey.set(key, {
          sessionID,
          turnID,
          graceMs: Math.min(input.graceMs, MAX_GRACE_MS),
          waitUsed: false,
          settled: false,
          internalGraceWaitMs: 0,
          resolve: undefined,
          timer: undefined,
          waitStartedAt: undefined,
        });
        activeTurnBySession.set(sessionID, turnID);
        return { pending: true };
      },
      put: async (input) => {
        if (
          !isRecord(input) ||
          !validKey(input.sessionID) ||
          !validKey(input.turnID) ||
          typeof input.brief !== "string" ||
          input.brief.length === 0 ||
          input.brief.length > MAX_BRIEF_CHARS ||
          utf8Bytes(input.brief) > MAX_BRIEF_BYTES
        ) {
          return { accepted: false, internalGraceWaitMs: 0 };
        }

        const { sessionID, turnID, brief } = input;
        clearSessionExcept(sessionID, turnID);
        const key = entryKey(sessionID, turnID);
        const pending = pendingByKey.get(key);
        if (!pending && briefs.size + pendingByKey.size >= MAX_ENTRIES) {
          return { accepted: false, internalGraceWaitMs: 0 };
        }

        briefs.set(key, { sessionID, turnID, brief });
        activeTurnBySession.set(sessionID, turnID);
        if (pending) {
          settlePending(pending, "brief");
          pendingByKey.delete(key);
        }
        return { accepted: true, internalGraceWaitMs: pending?.internalGraceWaitMs ?? 0 };
      },
      clear: async (input) => {
        if (!isRecord(input) || !validKey(input.sessionID)) {
          return { cleared: 0, internalGraceWaitMs: 0 };
        }
        if (input.turnID === undefined) {
          const result = clearSession(input.sessionID);
          clearReasoningTurn(input.sessionID);
          return result;
        }
        if (!validKey(input.turnID)) return { cleared: 0, internalGraceWaitMs: 0 };

        const key = entryKey(input.sessionID, input.turnID);
        const pending = pendingByKey.get(key);
        if (pending) {
          settlePending(pending, "clear");
          pendingByKey.delete(key);
        }
        const deleted = briefs.delete(key);
        if (activeTurnBySession.get(input.sessionID) === input.turnID) {
          activeTurnBySession.delete(input.sessionID);
        }
        return {
          cleared: deleted ? 1 : 0,
          internalGraceWaitMs: pending?.internalGraceWaitMs ?? 0,
        };
      },
    });

    const promptRegistration = await ctx.session.hook("prompt", (event) => {
      try {
        if (!isRecord(event) || !validKey(event.sessionID)) return;
        const sessionID = event.sessionID;
        const turnID = event.messageID;
        beginReasoningTurn(sessionID, turnID);
        if (
          validKey(turnID) &&
          (briefs.has(entryKey(sessionID, turnID)) || pendingByKey.has(entryKey(sessionID, turnID)))
        ) {
          clearSessionExcept(sessionID, turnID);
          activeTurnBySession.set(sessionID, turnID);
          return;
        }
        clearSession(sessionID);
      } catch {
        // Prompt lifecycle cleanup is best-effort; the context hook remains fail-open.
      }
    });

    const contextRegistration = await ctx.session.hook("context", async (event) => {
      let agent;
      try {
        if (isRecord(event)) agent = event.agent;
      } catch {
        // An unreadable identity is not an identified restricted role.
      }
      if (TOOLLESS_REVIEW_AGENT_TARGETS.includes(agent)) {
        filterRestrictedToolsOrThrow(event);
        return;
      }

      try {
        if (!isRecord(event) || event.agent !== "scout" || !validKey(event.sessionID) || !Array.isArray(event.system))
          return;
        const sessionID = event.sessionID;
        const turnID = activeTurnBySession.get(sessionID);
        if (!turnID) return;

        const key = entryKey(sessionID, turnID);
        let entry = briefs.get(key);
        if (!entry) {
          const pending = pendingByKey.get(key);
          if (!pending || pending.waitUsed || pending.settled) return;
          pending.waitUsed = true;
          pending.waitStartedAt = monotonicNow();
          const resolution = await new Promise((resolve) => {
            pending.resolve = resolve;
            pending.timer = setTimeout(() => settlePending(pending, "timeout"), pending.graceMs);
          });
          if (resolution !== "brief" || activeTurnBySession.get(sessionID) !== turnID) return;
          entry = briefs.get(key);
        }

        if (
          !entry ||
          entry.turnID !== turnID ||
          activeTurnBySession.get(sessionID) !== turnID ||
          !Array.isArray(event.system)
        )
          return;
        event.system.push({ type: "text", text: entry.brief });
      } catch {
        // The hook is total: internal errors never prevent the model call.
      }
    });

    const generateRegistration = await ctx.session.hook("generate", (event) => {
      let agent;
      try {
        if (isRecord(event)) agent = event.agent;
      } catch {
        // An unreadable identity is not an identified restricted role.
      }
      if (agent === RESTRICTED_REVIEW_AGENT_TARGET) filterRestrictedToolsOrThrow(event);
    });

    const permissionRegistration = await ctx.permission.hook("evaluate", (event) => {
      let target;
      let denyOnError = false;
      let denialMessage = REASONING_SUBAGENT_DENIAL;
      try {
        if (!isRecord(event)) return;
        if (event.action === "subagent" && Array.isArray(event.resources)) {
          target = event.resources.find(isReasoningTarget);
          if (target) denyOnError = true;
        }
        if (isReasoningTarget(event.agent)) {
          denyOnError = true;
          denialMessage = REASONING_SUBAGENT_TOOL_DENIAL;
          event.effect = "deny";
          event.message = denialMessage;
          return;
        }
        if (event.action !== "subagent") return;

        const deny = (message = REASONING_SUBAGENT_DENIAL) => {
          event.effect = "deny";
          event.message = message;
        };
        if (event.agent !== "scout") {
          if (target) deny();
          return;
        }
        denyOnError = true;
        denialMessage = SCOUT_DELEGATION_DENIAL;
        if (!Array.isArray(event.resources) || event.resources.length !== 1) {
          deny(SCOUT_DELEGATION_DENIAL);
          return;
        }
        const requestedTarget = event.resources[0];
        if (typeof requestedTarget !== "string" || !SCOUT_SUBAGENT_TARGETS.includes(requestedTarget)) {
          deny(SCOUT_DELEGATION_DENIAL);
          return;
        }
        if (requestedTarget === "chat-research-worker") return;
        target = requestedTarget;

        const sessionID = event.sessionID;
        const turnID = reasoningTurnBySession.get(sessionID);
        if (!validKey(turnID)) {
          deny();
          return;
        }
        const calls = reasoningCallsByTurn.get(entryKey(sessionID, turnID));
        if (!calls || calls.has(target)) {
          deny();
          return;
        }
        calls.add(target);
        denialMessage = REASONING_SUBAGENT_DENIAL;
        event.effect = "allow";
      } catch {
        // Keep unrelated permissions untouched; scoped delegation or reviewer failures deny.
        if (denyOnError && isRecord(event)) {
          event.effect = "deny";
          event.message = denialMessage;
        }
      }
    });

    // OpenCode 2.1.4 may reuse a previously confirmed native subagent permission
    // without re-running permission.evaluate. Enforce the same once-per-turn rule
    // at each actual tool invocation as well.
    const toolBeforeRegistration = await ctx.tool.hook("execute.before", (event) => {
      let isReasoningCall = false;
      try {
        if (!isRecord(event) || event.tool !== "subagent" || !isRecord(event.input)) return;
        const target = event.input.agent;
        if (!isReasoningTarget(target)) return;
        isReasoningCall = true;

        if (event.agent !== "scout" || !validKey(event.sessionID)) {
          throw new Error(REASONING_SUBAGENT_DENIAL);
        }
        const turnID = reasoningTurnBySession.get(event.sessionID);
        if (!validKey(turnID)) throw new Error(REASONING_SUBAGENT_DENIAL);
        const calls = reasoningToolCallsByTurn.get(entryKey(event.sessionID, turnID));
        if (!calls || calls.has(target)) throw new Error(REASONING_SUBAGENT_DENIAL);
        calls.add(target);
      } catch {
        if (isReasoningCall) throw new Error(REASONING_SUBAGENT_DENIAL);
      }
    });

    const toolAfterRegistration = await ctx.tool.hook("execute.after", (event) => {
      try {
        if (
          !isRecord(event) ||
          event.tool !== "subagent" ||
          event.status !== "completed" ||
          !isRecord(event.input) ||
          !isReasoningTarget(event.input.agent) ||
          !isRecord(event.result)
        )
          return;

        const result = event.result;
        const output = result.output;
        if (!isRecord(output) || output.status !== "completed") return;

        const boundedOutput = truncateSubagentText(output.output);
        const boundedContent = truncateSubagentContent(result.content);
        if (boundedOutput === undefined && boundedContent === result.content) return;

        event.result = {
          ...result,
          ...(boundedOutput === output.output ? {} : { output: { ...output, output: boundedOutput } }),
          ...(boundedContent === result.content ? {} : { content: boundedContent }),
        };
      } catch {
        // execute.after cannot reject a tool call; malformed hook data must not break Chat.
      }
    });

    const agentTransformRegistration = await ctx.agent.transform((editor) => {
      const scout = editor.get("scout");
      const reasoningAgents = REASONING_SUBAGENT_TARGETS.map((target) => editor.get(target));

      // Agent state can be read before the config overlay has populated all of its
      // profiles. Keep the transform registered and let a later state rebuild apply
      // the policy atomically once every required profile exists.
      if (!scout || reasoningAgents.some((agent) => !agent)) return;

      for (const target of REASONING_SUBAGENT_TARGETS) {
        const entry = editor.get(target);
        const permissions = entry?.permissions;
        if (
          entry?.mode !== "subagent" ||
          entry.hidden !== true ||
          entry.model !== undefined ||
          !Array.isArray(permissions) ||
          !permissions.some((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "deny") ||
          !permissions.some((rule) => rule.action === "execute" && rule.resource === "*" && rule.effect === "deny")
        ) {
          throw new Error("Reasoning target does not have the fixed tool-less profile");
        }
        editor.update(target, (agent) => {
          if (!Array.isArray(agent.permissions)) throw new Error("Reasoning target permissions are malformed");
          agent.permissions = agent.permissions.filter(
            (rule) =>
              isRecord(rule) &&
              typeof rule.action === "string" &&
              typeof rule.resource === "string" &&
              rule.effect === "deny",
          );
        });
      }

      if (
        scout?.mode !== "all" ||
        !Array.isArray(scout.permissions) ||
        !scout.permissions.some((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "deny")
      ) {
        throw new Error("Scout does not have the expected deny-by-default profile");
      }

      editor.update("scout", (agent) => {
        if (!Array.isArray(agent.permissions)) throw new Error("Scout permissions are malformed");
        const permissions = agent.permissions.filter(
          (rule) =>
            !(rule.effect !== "deny" && (rule.action === "*" || rule.action === "task" || rule.action === "subagent")),
        );
        agent.permissions = [
          ...permissions,
          ...SCOUT_SUBAGENT_TARGETS.map((resource) => ({ action: "subagent", resource, effect: "allow" })),
        ];
      });
    });

    return async () => {
      for (const pending of pendingByKey.values()) settlePending(pending, "clear");
      await Promise.all([
        rpcRegistration.dispose(),
        promptRegistration.dispose(),
        contextRegistration.dispose(),
        generateRegistration.dispose(),
        permissionRegistration.dispose(),
        toolBeforeRegistration.dispose(),
        toolAfterRegistration.dispose(),
        agentTransformRegistration.dispose(),
      ]);
      briefs.clear();
      pendingByKey.clear();
      activeTurnBySession.clear();
      reasoningTurnBySession.clear();
      reasoningCallsByTurn.clear();
      reasoningToolCallsByTurn.clear();
    };
  },
};
