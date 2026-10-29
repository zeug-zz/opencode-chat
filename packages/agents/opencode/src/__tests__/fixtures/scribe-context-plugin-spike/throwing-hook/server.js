const rpcDefinition = {
  id: "scribe_native_throw_spike",
  events: {},
  methods: {
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

export default {
  id: "fixture.scribe-context-plugin-spike.throwing-hook",
  async setup(ctx) {
    let throwNext = false;
    const rpcRegistration = await ctx.rpc.register(rpcDefinition, {
      armThrow: async () => {
        throwNext = true;
        return { armed: true };
      },
    });
    const hookRegistration = await ctx.session.hook("context", () => {
      if (!throwNext) return;
      throwNext = false;
      throw new Error("fixture_hook_failure");
    });
    return async () => Promise.all([rpcRegistration.dispose(), hookRegistration.dispose()]);
  },
};
