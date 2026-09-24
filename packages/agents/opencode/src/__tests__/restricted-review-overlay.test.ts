import { describe, expect, it } from "vitest";
import { buildChatOverlay } from "../opencode-agent";
import {
  buildRestrictedReviewAgentEntry,
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
      prompt: RESTRICTED_REVIEW_PROMPT,
      maxSteps: validInput.maxSteps,
      mode: "subagent",
      hidden: true,
    });
    expect(entry).not.toHaveProperty("description");
    expect(entry.permission).toEqual(
      expect.objectContaining({
        "*": "deny",
        ...Object.fromEntries(RESTRICTED_REVIEW_AUTHORITIES.map((authority) => [authority, "deny"])),
        mcp_sentinel_read: "deny",
      }),
    );
    expect(Object.values(entry.permission).every((value) => value === "deny")).toBe(true);
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
    [{ ...validInput, unexpected: true }, "unknown field"],
    [{ ...validInput, dynamicToolNames: [" "] }, "dynamic tool"],
  ] as Array<[unknown, string]>)("rejects invalid host input (%s)", (input: unknown) => {
    expect(() => buildRestrictedReviewAgentEntry(input)).toThrow(RestrictedReviewOverlayValidationError);
  });

  it("merges only the configured entry into the in-memory chat overlay", () => {
    const baseline = buildChatOverlay(undefined, undefined, undefined);
    const configured = buildChatOverlay(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      validInput,
    );

    expect(baseline).not.toHaveProperty(`agent.${RESTRICTED_REVIEW_AGENT_NAME}`);
    expect(configured).toHaveProperty(`agent.${RESTRICTED_REVIEW_AGENT_NAME}`);
    expect(configured).not.toHaveProperty("plugin");
    expect(configured).not.toHaveProperty("mcp");
    expect(configured).toEqual(
      expect.objectContaining({
        agent: expect.objectContaining({ [RESTRICTED_REVIEW_AGENT_NAME]: expect.any(Object) }),
      }),
    );
    expect(JSON.stringify(baseline)).toBe(JSON.stringify(buildChatOverlay(undefined, undefined, undefined)));
  });

  it("keeps the hidden entry the only added registration and denies task delegation", () => {
    const entry = buildRestrictedReviewAgentEntry(validInput);

    // Task delegation is denied for the hidden agent, so no architect/critic
    // stage can become a delegated task target.
    expect(RESTRICTED_REVIEW_AUTHORITIES).toContain("task");
    expect(entry.permission.task).toBe("deny");

    // The overlay registers exactly Scout, the research worker, Build, and the
    // hidden restricted agent: no architect or critic agent exists.
    const configured = buildChatOverlay(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      validInput,
    );
    const configuredAgents = configured.agent as Record<string, unknown>;
    expect(Object.keys(configuredAgents).sort()).toEqual(
      ["build", "chat-research-worker", "scout", RESTRICTED_REVIEW_AGENT_NAME].sort(),
    );
  });
});

describe("restricted review stage instructions", () => {
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
