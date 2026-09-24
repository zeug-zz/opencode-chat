import { describe, expect, it, vi } from "vitest";
import {
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_PROMPT,
} from "../restricted-review-overlay";
import { createRestrictedReviewProvider, mintRestrictedReviewProvenance } from "../restricted-review-provider";

const identifier = /^[A-Za-z][A-Za-z0-9_-]*$/;

function client(config: unknown) {
  return {
    config: { get: vi.fn().mockResolvedValue({ data: config }) },
    session: {
      create: vi.fn(),
      promptAsync: vi.fn(),
      messages: vi.fn(),
      abort: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function config(model = "provider/model", prompt = RESTRICTED_REVIEW_PROMPT, dynamicToolNames = ["mcp_tool"]) {
  const permission = Object.fromEntries(
    ["*", ...RESTRICTED_REVIEW_AUTHORITIES, ...dynamicToolNames].map((name) => [name, "deny"]),
  );
  return { agent: { [RESTRICTED_REVIEW_AGENT_NAME]: { model, prompt, permission } } };
}

function withPermission(permission: Record<string, string>) {
  const baseline = config();
  return {
    ...baseline,
    agent: {
      [RESTRICTED_REVIEW_AGENT_NAME]: {
        ...baseline.agent[RESTRICTED_REVIEW_AGENT_NAME],
        permission,
      },
    },
  };
}

function provider(readback: unknown, generation: object = {}) {
  const sdk = client(readback);
  const currentGeneration = vi.fn(() => generation);
  const instance = createRestrictedReviewProvider({
    client: sdk as never,
    restrictedReview: {
      model: "provider/model",
      prompt: RESTRICTED_REVIEW_PROMPT,
      maxSteps: 4,
      dynamicToolNames: ["mcp_tool"],
    },
    hostPinnedModel: { providerID: "provider", modelID: "model" },
    generation,
    currentGeneration,
  });
  return { instance, sdk, currentGeneration };
}

describe("restricted review provenance", () => {
  it("mints validator-shaped, distinct provenance without packet influence", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const prover = mintRestrictedReviewProvenance("prover");
      const verifier = mintRestrictedReviewProvenance("verifier");
      expect(prover.contextNumber).toBe(1);
      expect(verifier.contextNumber).toBe(2);
      expect(prover.identity).toMatch(identifier);
      expect(prover.handle).toMatch(identifier);
      expect(verifier.identity).toMatch(identifier);
      expect(verifier.handle).toMatch(identifier);
      expect(prover.identity.length).toBeLessThanOrEqual(64);
      expect(prover.handle.length).toBeLessThanOrEqual(64);
      expect(verifier.identity.length).toBeLessThanOrEqual(64);
      expect(verifier.handle.length).toBeLessThanOrEqual(64);
      expect(prover.identity).not.toBe(verifier.identity);
      expect(prover.handle).not.toBe(verifier.handle);
      expect(prover.identity).toMatch(/^prover-/);
      expect(verifier.identity).toMatch(/^verifier-/);
      seen.add(`${prover.identity}:${verifier.identity}`);
    }
    expect(seen.size).toBe(500);
    expect(mintRestrictedReviewProvenance("prover")).not.toEqual(mintRestrictedReviewProvenance("prover"));
  });

  it("numbers architect and critic contexts one and two in the same bounded form", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const architect = mintRestrictedReviewProvenance("architect");
      const critic = mintRestrictedReviewProvenance("critic");
      expect(architect.contextNumber).toBe(1);
      expect(critic.contextNumber).toBe(2);
      expect(architect.identity).toMatch(/^architect-/);
      expect(critic.identity).toMatch(/^critic-/);
      expect(architect.identity).toMatch(identifier);
      expect(architect.handle).toMatch(identifier);
      expect(critic.identity).toMatch(identifier);
      expect(critic.handle).toMatch(identifier);
      expect(architect.identity.length).toBeLessThanOrEqual(64);
      expect(architect.handle.length).toBeLessThanOrEqual(64);
      expect(critic.identity.length).toBeLessThanOrEqual(64);
      expect(critic.handle.length).toBeLessThanOrEqual(64);
      expect(architect.identity).not.toBe(critic.identity);
      expect(architect.handle).not.toBe(critic.handle);
      seen.add(`${architect.identity}:${critic.identity}`);
    }
    expect(seen.size).toBe(100);
    expect(mintRestrictedReviewProvenance("critic")).not.toEqual(mintRestrictedReviewProvenance("critic"));
  });
});

describe("restricted review readiness", () => {
  it("is ready only after a matching read-only effective config check", async () => {
    const { instance, sdk } = provider(config());
    await expect(instance.checkReadiness()).resolves.toBe(true);
    expect(instance.isReady()).toBe(true);
    expect(sdk.config.get).toHaveBeenCalledTimes(1);
    expect(sdk.session.create).not.toHaveBeenCalled();
    expect(sdk.session.promptAsync).not.toHaveBeenCalled();
    expect(sdk.session.messages).not.toHaveBeenCalled();
    expect(sdk.session.abort).not.toHaveBeenCalled();
    expect(sdk.session.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", {}],
    ["malformed", { agent: { [RESTRICTED_REVIEW_AGENT_NAME]: null } }],
    ["permissive", withPermission({ "*": "allow" })],
    ["missing", withPermission({ "*": "deny" })],
    ["extra", withPermission({ ...config().agent[RESTRICTED_REVIEW_AGENT_NAME].permission, extra: "deny" })],
    ["model", config("other/model")],
    ["prompt", config("provider/model", "other prompt")],
    ["absent data", undefined],
  ])("stays dormant for %s read-back", async (_name, readback) => {
    const { instance } = provider(readback);
    await expect(instance.checkReadiness()).resolves.toBe(false);
    expect(instance.isReady()).toBe(false);
  });

  it("invalidates a ready result on generation drift, explicit invalidation, and SDK rejection", async () => {
    const generation = {};
    const current = { value: generation };
    const sdk = client(config("provider/model", RESTRICTED_REVIEW_PROMPT, []));
    const instance = createRestrictedReviewProvider({
      client: sdk as never,
      restrictedReview: { model: "provider/model", prompt: RESTRICTED_REVIEW_PROMPT, maxSteps: 4 },
      hostPinnedModel: { providerID: "provider", modelID: "model" },
      generation,
      currentGeneration: () => current.value,
    });
    await expect(instance.checkReadiness()).resolves.toBe(true);
    current.value = {};
    expect(instance.isReady()).toBe(false);
    instance.invalidate();
    await expect(instance.checkReadiness()).resolves.toBe(false);
    sdk.config.get.mockRejectedValue(new Error("unavailable"));
    expect(instance.isReady()).toBe(false);
  });
});
