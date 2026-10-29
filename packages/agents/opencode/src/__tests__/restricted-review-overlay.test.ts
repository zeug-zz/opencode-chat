import { describe, expect, it } from "vitest";
import { buildChatOverlay } from "../opencode-agent";
import {
  buildChatReasoningSubagentEntries,
  buildRestrictedReviewAgentEntry,
  CHAT_REASONING_CRITIC_AGENT_NAME,
  CHAT_REASONING_CRITIC_OUTPUT_SCHEMA,
  CHAT_REASONING_SUBAGENT_DENIED_AUTHORITIES,
  CHAT_REASONING_SUBAGENT_MAX_OUTPUT_CHARS,
  CHAT_REASONING_SUBAGENT_MAX_STEPS,
  CHAT_REASONING_VERIFIER_AGENT_NAME,
  CHAT_REASONING_VERIFIER_OUTPUT_SCHEMA,
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_MAX_STEPS,
  RESTRICTED_REVIEW_PROMPT,
  RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
  RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
  RestrictedReviewOverlayValidationError,
} from "../restricted-review-overlay";

const validInput = {
  model: "provider/model",
  prompt: RESTRICTED_REVIEW_PROMPT,
  maxSteps: 4,
  dynamicToolNames: ["mcp_sentinel_read"],
};

describe("restricted review overlay", () => {
  it("denies the complete authority inventory and dynamic tools", () => {
    const entry = buildRestrictedReviewAgentEntry(validInput);

    expect(entry).toMatchObject({
      model: validInput.model,
      system: RESTRICTED_REVIEW_PROMPT,
      steps: validInput.maxSteps,
      mode: "subagent",
      hidden: true,
    });
    expect(entry).not.toHaveProperty("description");
    expect(entry.permissions).toEqual(
      expect.arrayContaining(
        ["*", ...RESTRICTED_REVIEW_AUTHORITIES, "mcp_sentinel_read"].map((action) => ({
          action,
          resource: "*",
          effect: "deny",
        })),
      ),
    );
    expect(entry.permissions.every((rule) => rule.effect === "deny")).toBe(true);
    expect(entry.permissions).not.toContainEqual(expect.objectContaining({ action: "execute", effect: "allow" }));
    expect(entry.permissions).toContainEqual({ action: "execute", resource: "*", effect: "deny" });
  });

  it("bootstraps a hidden model-inheriting reviewer for native default resolution", () => {
    const nativeDefault = {
      modelResolution: "native-default" as const,
      prompt: RESTRICTED_REVIEW_PROMPT,
      maxSteps: 4,
    };
    const entry = buildRestrictedReviewAgentEntry(nativeDefault);
    const overlay = buildChatOverlay(undefined, undefined, undefined, undefined, undefined, undefined, nativeDefault);

    expect(entry).toMatchObject({ system: RESTRICTED_REVIEW_PROMPT, mode: "subagent", hidden: true });
    expect(entry).not.toHaveProperty("model");
    expect(entry.permissions).toContainEqual({ action: "execute", resource: "*", effect: "deny" });
    expect(
      (overlay.agents as Record<string, Record<string, unknown>>)[RESTRICTED_REVIEW_AGENT_NAME],
    ).not.toHaveProperty("model");
    expect(overlay).not.toHaveProperty("model");
  });

  it.each([
    [{ ...validInput, model: " " }, "model"],
    [{ ...validInput, prompt: "caller instruction" }, "prompt"],
    [{ ...validInput, maxSteps: 0 }, "steps"],
    [{ ...validInput, maxSteps: RESTRICTED_REVIEW_MAX_STEPS + 1 }, "steps"],
    [{ ...validInput, permission: { "*": "allow" } }, "permissive"],
    [{ ...validInput, permission: { "*": "deny" } }, "partial"],
    [
      {
        ...validInput,
        permission: {
          "*": "deny",
          unknown_authority: "deny",
        },
      },
      "unknown authority",
    ],
    [{ ...validInput, modelResolution: "native-default" }, "must inherit"],
    [{ ...validInput, modelResolution: "invalid" }, "resolution is invalid"],
    [{ ...validInput, unexpected: true }, "unknown field"],
    [{ ...validInput, dynamicToolNames: [" "] }, "dynamic tool"],
  ] as Array<[unknown, string]>)("rejects invalid host input (%s)", (input: unknown) => {
    expect(() => buildRestrictedReviewAgentEntry(input)).toThrow(RestrictedReviewOverlayValidationError);
  });

  it("merges only the configured entry into the in-memory chat overlay", () => {
    const baseline = buildChatOverlay(undefined, undefined, undefined);
    const configured = buildChatOverlay(undefined, undefined, undefined, undefined, undefined, undefined, validInput);

    expect(baseline).not.toHaveProperty(`agents.${RESTRICTED_REVIEW_AGENT_NAME}`);
    expect(configured).toHaveProperty(`agents.${RESTRICTED_REVIEW_AGENT_NAME}`);
    expect(configured).not.toHaveProperty("plugin");
    expect(configured).not.toHaveProperty("mcp");
    expect(configured).toEqual(
      expect.objectContaining({
        agents: expect.objectContaining({ [RESTRICTED_REVIEW_AGENT_NAME]: expect.any(Object) }),
      }),
    );
    expect(JSON.stringify(baseline)).toBe(JSON.stringify(buildChatOverlay(undefined, undefined, undefined)));
  });

  it("keeps the hidden entry the only added registration and denies task delegation", () => {
    const entry = buildRestrictedReviewAgentEntry(validInput);

    // Task delegation is denied for the hidden agent, so no architect/critic
    // stage can become a delegated task target.
    expect(RESTRICTED_REVIEW_AUTHORITIES).toContain("task");
    expect(entry.permissions).toContainEqual({ action: "task", resource: "*", effect: "deny" });
    expect(entry.permissions).toContainEqual({ action: "*", resource: "*", effect: "deny" });

    // The configured review agent is separate from the two hidden on-demand
    // Scout targets; no architect target or additional critic alias exists.
    const configured = buildChatOverlay(undefined, undefined, undefined, undefined, undefined, undefined, validInput);
    const configuredAgents = configured.agents as Record<string, unknown>;
    expect(Object.keys(configuredAgents).sort()).toEqual(
      [
        "build",
        "chat-research-worker",
        "scout",
        CHAT_REASONING_CRITIC_AGENT_NAME,
        CHAT_REASONING_VERIFIER_AGENT_NAME,
        RESTRICTED_REVIEW_AGENT_NAME,
      ].sort(),
    );
    expect(configuredAgents).not.toHaveProperty("architect");
  });
});

describe("on-demand Scout reasoning subagents", () => {
  it("registers only hidden, model-inheriting, two-step, deny-only critic and verifier entries", () => {
    const entries = buildChatReasoningSubagentEntries();
    const overlayAgents = buildChatOverlay(undefined, undefined, undefined).agents as Record<string, unknown>;

    expect(Object.keys(entries).sort()).toEqual(
      [CHAT_REASONING_CRITIC_AGENT_NAME, CHAT_REASONING_VERIFIER_AGENT_NAME].sort(),
    );
    for (const target of [CHAT_REASONING_CRITIC_AGENT_NAME, CHAT_REASONING_VERIFIER_AGENT_NAME]) {
      const entry = entries[target];
      expect(entry).toMatchObject({ mode: "subagent", hidden: true, steps: CHAT_REASONING_SUBAGENT_MAX_STEPS });
      expect(entry).not.toHaveProperty("model");
      expect(entry.permissions.every((rule) => rule.effect === "deny")).toBe(true);
      expect(entry.permissions).toContainEqual({ action: "*", resource: "*", effect: "deny" });
      expect(entry.permissions).toContainEqual({ action: "execute", resource: "*", effect: "deny" });
      expect(entry.permissions).toEqual(
        expect.arrayContaining(
          CHAT_REASONING_SUBAGENT_DENIED_AUTHORITIES.map((action) => ({ action, resource: "*", effect: "deny" })),
        ),
      );
      expect(entry.system).toContain(`within ${CHAT_REASONING_SUBAGENT_MAX_OUTPUT_CHARS} characters`);
      expect(overlayAgents[target]).toEqual(entry);
    }
  });

  it("uses closed, bounded schemas for critic objections and verifier dispositions", () => {
    for (const schema of [CHAT_REASONING_CRITIC_OUTPUT_SCHEMA, CHAT_REASONING_VERIFIER_OUTPUT_SCHEMA]) {
      expect(schema).toMatchObject({ type: "object", additionalProperties: false });
      const arraySchema = Object.values(schema.properties)[0];
      expect(arraySchema).toMatchObject({ type: "array", maxItems: 3 });
      expect(arraySchema.items).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(CHAT_REASONING_CRITIC_OUTPUT_SCHEMA.properties.objections.items.properties.objection.maxLength).toBe(280);
    expect(CHAT_REASONING_VERIFIER_OUTPUT_SCHEMA.properties.verdicts.items.properties.reason.maxLength).toBe(280);
  });
});

describe("restricted review stage instructions", () => {
  it("includes a connected illustrative architect map and focused selection guidance", () => {
    const marker = "Connected-map example (illustrative only): ";
    const exampleText = RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION.split(marker).at(-1);
    expect(exampleText).toBeDefined();
    const example = JSON.parse(exampleText as string) as {
      conclusionId: string;
      claims: Array<{ id: string; dependsOn: string[] }>;
    };
    expect(example.claims.find(({ id }) => id === "c")?.dependsOn).toEqual(["p1", "p2"]);
    const byId = new Map(example.claims.map((claim) => [claim.id, claim]));
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (id: string) => {
      expect(active.has(id)).toBe(false);
      if (visited.has(id)) return;
      active.add(id);
      visited.add(id);
      for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
      active.delete(id);
    };
    visit(example.conclusionId);
    expect(visited.size).toBe(example.claims.length);
    for (const phrase of [
      "argument actually supplied for evaluation",
      "smallest faithful argument",
      "material support",
      "Preserve material caveats",
      "Never copy the illustrative example",
    ]) {
      expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(phrase);
    }
  });

  it("pins the fixed host-owned architect instruction", () => {
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('{ "kind": "ordinary" }');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('{ "kind": "argument"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('"conclusionId"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('"claims"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('"assumptions"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('"evidenceNeeds"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('"sourceKind"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('"dependsOn"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain('"uncertainty"');
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      '"class": <"deductive" | "computational" | "empirical" | "procedural" | "interpretive" | "normative">',
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      '"sourceKind": <"citation" | "observation" | "calculation" | "procedure" | "human">',
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      '"status": <"not_required" | "source_recorded" | "unverified" | "human_verified" | "conflicted">',
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).not.toContain("bounded claim class");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).not.toContain("bounded source kind");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).not.toContain("bounded status");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("no prose");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("no tool use");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("host validates");

    // Soft generation caps keep the map small enough to finish inside the
    // stage deadline; they guide the model and leave the parser's hard bounds
    // untouched.
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      "Return the smallest sufficient map: at most 6 claims, 4 assumptions, 4 evidence needs, and 3 uncertainty items, and keep every statement under 160 characters.",
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      "Every claim, assumption, and uncertainty statement must be one plain sentence under 160 characters, contain none of these characters: ; | & ` $, and contain no line breaks. Use commas or separate claims instead.",
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).not.toMatch(/[\r\n]/u);
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("conclusionId` must name one listed claim");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      "dependsOn` may contain only other listed claim IDs that directly support that claim",
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("supported claim → supporting claims");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("never assumption IDs");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      "every listed claim must be reachable from the conclusion by following `dependsOn`",
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("do not create cycles");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain(
      "Every `assumptions[].claimId` and `evidenceNeeds[].claimId` must name a listed claim",
    );
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION).toContain("Unsupported premises use `dependsOn: []`");
    expect(RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION.indexOf("Return the smallest sufficient map")).toBeLessThan(
      RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION.indexOf("The host validates"),
    );
  });

  it("pins the fixed host-owned critic instruction", () => {
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain('"objections"');
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain('"kind": "claim" | "assumption"');
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain('"severity": <"material" | "minor">');
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).not.toContain("bounded severity");
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain("at most two");
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain("present in the packet");
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain("no prose");
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain("no tool use");
    expect(RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION).toContain("host validates");
  });

  it("pins strict prover and verifier JSON shapes and existing validator rules", () => {
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain(
      '{"proposalId":"proposal-1","objections":[{"objectionId":"objection-1","target":{"kind":"claim","id":"claim-1"},"severity":"major","reason":"..."}]}',
    );
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain(
      "Allowed target kinds are claim, assumption, logical_dependency, and evidence; severity is minor, major, or critical.",
    );
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain(
      "Every ID must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$, objectionId values must be unique",
    );
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain(
      "each target ID must exist in the matching packet collection (claims, assumptions, logicalDependencies, or evidenceReferences)",
    );
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain("packet.limits.maxReasonLength (256 characters)");
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain("existing validator limit of 128 objections");
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain(
      "Return an empty objections array when no objection is justified",
    );
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain("Do not return provenance; the host adds it");
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain("do not use tools or seek external truth");
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain("compressed argument map");
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain("claims[].statement contains the mapped substance");
    expect(RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION).toContain(
      "scope the objection explicitly to the map and its uncertainty",
    );

    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain(
      '{"proposalId":"proposal-1","dispositions":[{"objectionId":"objection-1","disposition":"confirmed","reason":"..."}]}',
    );
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain("disposition is confirmed, rejected, or unresolved");
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain("proposalId must exactly match the proposal");
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain(
      "cover every proposal objectionId exactly once with no missing, duplicate, or extra entries",
    );
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain(
      "Return an empty dispositions array only when the proposal has no objections",
    );
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain("at most 256 characters");
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain("Do not return provenance; the host adds it");
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain("do not use tools or seek external truth");
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain(
      "Reject an objection whose sole basis is intentionally omitted raw citation content",
    );
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain(
      "Treat genuine insufficiency of the map as unresolved",
    );
    expect(RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION).toContain(
      "Do not dismiss substantive unsupported-dependency or empirical-support objections",
    );

    for (const instruction of [
      RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
      RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
    ]) {
      expect(instruction).toContain("no prose, fences, or extra keys");
      expect(instruction).not.toContain("<identifier>");
      expect(instruction).not.toContain("<bounded text>");
    }
  });

  it("keeps the four stage instructions distinct and role-specific", () => {
    const instructions = [
      RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION,
      RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION,
      RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION,
      RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION,
    ];
    expect(new Set(instructions).size).toBe(4);
  });
});
