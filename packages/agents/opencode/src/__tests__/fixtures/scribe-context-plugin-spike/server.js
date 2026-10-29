const MAX_BRIEF_BYTES = 256;
const MAX_KEY_BYTES = 128;
const MAX_ENTRIES = 16;
const MAX_OBSERVATIONS = 32;
const RPC_ID = "scribe_context_spike";

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: MAX_KEY_BYTES,
};
const rpcDefinition = {
  id: RPC_ID,
  events: {},
  methods: {
    put: {
      input: {
        type: "object",
        properties: {
          sessionID: idSchema,
          turnID: idSchema,
          brief: { type: "string", minLength: 1, maxLength: MAX_BRIEF_BYTES },
        },
        required: ["sessionID", "turnID", "brief"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { accepted: { type: "boolean" } },
        required: ["accepted"],
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
        properties: { cleared: { type: "integer", minimum: 0 } },
        required: ["cleared"],
        additionalProperties: false,
      },
    },
    inspect: {
      input: {
        type: "object",
        properties: { sessionID: idSchema },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          storedEntries: { type: "integer", minimum: 0, maximum: MAX_ENTRIES },
          sessionEntries: { type: "integer", minimum: 0, maximum: MAX_ENTRIES },
          hasActiveTurn: { type: "boolean" },
          promptBindings: { type: "integer", minimum: 0 },
          idleClears: { type: "integer", minimum: 0 },
          hookCalls: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          hookInternalExceptions: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          calls: {
            type: "array",
            maxItems: MAX_OBSERVATIONS,
            items: {
              type: "object",
              properties: {
                agent: { type: ["string", "null"] },
                turnBound: { type: "boolean" },
                briefApplied: { type: "boolean" },
                hookThrew: { type: "boolean" },
              },
              required: ["agent", "turnBound", "briefApplied", "hookThrew"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "storedEntries",
          "sessionEntries",
          "hasActiveTurn",
          "promptBindings",
          "idleClears",
          "hookCalls",
          "hookInternalExceptions",
          "calls",
        ],
        additionalProperties: false,
      },
    },
    armThrow: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { armed: { type: "boolean" } },
        required: ["armed"],
        additionalProperties: false,
      },
    },
  },
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validID(value) {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_BYTES && /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function entryKey(sessionID, turnID) {
  return JSON.stringify([sessionID, turnID]);
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

export default {
  id: "fixture.scribe-context-plugin-spike",
  async setup(ctx) {
    const briefs = new Map();
    const activeTurnBySession = new Map();
    const observations = [];
    const eventAbort = new AbortController();
    let promptBindings = 0;
    let idleClears = 0;
    let hookCalls = 0;
    let hookInternalExceptions = 0;
    let throwNextContext = false;
    const incrementCounter = (value) => Math.min(value + 1, Number.MAX_SAFE_INTEGER);

    const clearSession = (sessionID) => {
      let cleared = 0;
      for (const [key, entry] of briefs) {
        if (entry.sessionID === sessionID) {
          briefs.delete(key);
          cleared += 1;
        }
      }
      activeTurnBySession.delete(sessionID);
      return cleared;
    };

    // OpenCode 2.1.4 disables JSON Schema pattern validation for RPC contracts; validID enforces the exact key pattern.
    const rpcRegistration = await ctx.rpc.register(rpcDefinition, {
      put: async (input) => {
        if (
          !isRecord(input) ||
          !validID(input.sessionID) ||
          !validID(input.turnID) ||
          typeof input.brief !== "string" ||
          input.brief.length === 0 ||
          utf8Bytes(input.brief) > MAX_BRIEF_BYTES
        ) {
          return { accepted: false };
        }
        const key = entryKey(input.sessionID, input.turnID);
        if (!briefs.has(key) && briefs.size >= MAX_ENTRIES) return { accepted: false };
        clearSession(input.sessionID);
        briefs.set(key, { sessionID: input.sessionID, turnID: input.turnID, brief: input.brief });
        return { accepted: true };
      },
      clear: async (input) => {
        if (!isRecord(input) || !validID(input.sessionID)) return { cleared: 0 };
        if (input.turnID === undefined) return { cleared: clearSession(input.sessionID) };
        if (!validID(input.turnID)) return { cleared: 0 };
        const key = entryKey(input.sessionID, input.turnID);
        const deleted = briefs.delete(key);
        if (activeTurnBySession.get(input.sessionID) === input.turnID) activeTurnBySession.delete(input.sessionID);
        return { cleared: deleted ? 1 : 0 };
      },
      inspect: async (input) => {
        const sessionID = isRecord(input) && validID(input.sessionID) ? input.sessionID : "";
        const calls = observations
          .filter((entry) => entry.sessionID === sessionID)
          .slice(-MAX_OBSERVATIONS)
          .map(({ agent, turnBound, briefApplied, hookThrew }) => ({ agent, turnBound, briefApplied, hookThrew }));
        return {
          storedEntries: briefs.size,
          sessionEntries: [...briefs.values()].filter((entry) => entry.sessionID === sessionID).length,
          hasActiveTurn: activeTurnBySession.has(sessionID),
          promptBindings,
          idleClears,
          hookCalls,
          hookInternalExceptions,
          calls,
        };
      },
      armThrow: async () => {
        throwNextContext = true;
        return { armed: true };
      },
    });

    const promptRegistration = await ctx.session.hook("prompt", (event) => {
      if (!isRecord(event) || !validID(event.sessionID)) return;
      const sessionID = event.sessionID;
      const turnID = event.messageID;
      if (validID(turnID) && briefs.has(entryKey(sessionID, turnID))) {
        activeTurnBySession.set(sessionID, turnID);
        promptBindings += 1;
        return;
      }
      clearSession(sessionID);
    });

    const contextRegistration = await ctx.session.hook("context", (event) => {
      const observation = {
        sessionID: "",
        agent: null,
        turnBound: false,
        briefApplied: false,
        hookThrew: false,
      };
      try {
        if (!isRecord(event)) return;
        const sessionID = validID(event.sessionID) ? event.sessionID : "";
        const agent = typeof event.agent === "string" ? event.agent : null;
        const turnID = sessionID ? activeTurnBySession.get(sessionID) : undefined;
        const entry = turnID ? briefs.get(entryKey(sessionID, turnID)) : undefined;
        observation.sessionID = sessionID;
        observation.agent = agent;
        observation.turnBound = Boolean(turnID && entry && entry.turnID === turnID);
        if (throwNextContext) {
          throwNextContext = false;
          throw new Error("fixture_hook_failure");
        }
        observation.briefApplied = agent === "scout" && !!entry && Array.isArray(event.system);
        if (observation.briefApplied) event.system.push({ type: "text", text: entry.brief });
      } catch {
        // Production-style fail-open: a brief-hook error skips injection but never escapes to Chat.
        hookInternalExceptions = incrementCounter(hookInternalExceptions);
        observation.hookThrew = true;
        observation.briefApplied = false;
      } finally {
        hookCalls = incrementCounter(hookCalls);
        observations.push(observation);
        if (observations.length > MAX_OBSERVATIONS) observations.shift();
      }
    });

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: eventAbort.signal })) {
          if (event.type !== "session.idle" || !isRecord(event.properties)) continue;
          const sessionID = event.properties.sessionID;
          if (!validID(sessionID)) continue;
          if (clearSession(sessionID) > 0) idleClears += 1;
        }
      } catch {
        // Event delivery is optional in the fixture; the authenticated clear RPC is the explicit host path.
      }
    })();

    return async () => {
      eventAbort.abort();
      await Promise.all([promptRegistration.dispose(), contextRegistration.dispose(), rpcRegistration.dispose()]);
      briefs.clear();
      activeTurnBySession.clear();
      observations.length = 0;
    };
  },
};
