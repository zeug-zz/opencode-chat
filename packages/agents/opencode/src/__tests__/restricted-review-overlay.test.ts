import { describe, expect, it } from "vitest";
import { buildChatOverlay } from "../opencode-agent";
import {
  buildRestrictedReviewAgentEntry,
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_MAX_STEPS,
  RESTRICTED_REVIEW_PROMPT,
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
});
