import { describe, expect, it, vi } from "vitest";
import {
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_PROMPT,
} from "../restricted-review-overlay";
import { createRestrictedReviewProvider, mintRestrictedReviewProvenance } from "../restricted-review-provider";

const identifier = /^[A-Za-z][A-Za-z0-9_-]*$/;
const nativeDefaultPermissions = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
];

function makeProvider(
  data: unknown,
  location = { directory: "/workspace" },
  modelResolution: "pinned" | "native-default" = "pinned",
) {
  const client = {
    agent: { get: vi.fn().mockResolvedValue({ location, data }) },
    session: {
      create: vi.fn(),
      wait: vi.fn(),
      instructions: { entry: { put: vi.fn() } },
      prompt: vi.fn(),
      interrupt: vi.fn(),
      remove: vi.fn(),
    },
    message: { list: vi.fn() },
  };
  const provider = createRestrictedReviewProvider({
    client: client as never,
    directory: "/workspace",
    restrictedReview:
      modelResolution === "native-default"
        ? {
            modelResolution,
            prompt: RESTRICTED_REVIEW_PROMPT,
            maxSteps: 4,
            dynamicToolNames: ["dynamic"],
          }
        : {
            model: "provider/model",
            prompt: RESTRICTED_REVIEW_PROMPT,
            maxSteps: 4,
            dynamicToolNames: ["dynamic"],
          },
    hostPinnedModel: { providerID: "provider", modelID: "model" },
  });
  return { client, provider };
}

function agent(
  permissions = [
    ...nativeDefaultPermissions,
    ...["*", ...RESTRICTED_REVIEW_AUTHORITIES, "dynamic"].map((action) => ({
      action,
      resource: "*",
      effect: "deny",
    })),
  ],
) {
  return {
    id: RESTRICTED_REVIEW_AGENT_NAME,
    model: { id: "model", providerID: "provider" },
    system: RESTRICTED_REVIEW_PROMPT,
    steps: 4,
    mode: "subagent",
    hidden: true,
    permissions,
  };
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
  it("checks native agent readback at the active location without creating sessions", async () => {
    const { client, provider } = makeProvider(agent());
    await expect(provider.checkReadiness()).resolves.toBe(true);
    expect(client.agent.get).toHaveBeenCalledWith(
      { agentID: RESTRICTED_REVIEW_AGENT_NAME, location: { directory: "/workspace" } },
      expect.anything(),
    );
    expect(client.session.create).not.toHaveBeenCalled();
  });

  it("accepts native default allow/ask rules shadowed by the later wildcard deny", async () => {
    const { provider } = makeProvider(agent());
    await expect(provider.checkReadiness()).resolves.toBe(true);
  });

  it("accepts additional well-formed earlier rules shadowed by the last wildcard deny", async () => {
    const { provider } = makeProvider(
      agent([
        ...nativeDefaultPermissions,
        { action: "unknown-earlier-tool", resource: "*", effect: "ask" },
        ...["*", ...RESTRICTED_REVIEW_AUTHORITIES, "dynamic"].map((action) => ({
          action,
          resource: "*",
          effect: "deny",
        })),
      ]),
    );
    await expect(provider.checkReadiness()).resolves.toBe(true);
  });

  it("accepts a model-inheriting hidden agent after the native default is pinned", async () => {
    const inheritedAgent = { ...agent(), model: undefined };
    const { client, provider } = makeProvider(inheritedAgent, { directory: "/workspace" }, "native-default");

    await expect(provider.checkReadiness()).resolves.toBe(true);
    expect(client.agent.get).toHaveBeenCalledWith(
      { agentID: RESTRICTED_REVIEW_AGENT_NAME, location: { directory: "/workspace" } },
      expect.anything(),
    );
    expect(inheritedAgent.model).toBeUndefined();
    expect(inheritedAgent.permissions).toContainEqual({ action: "execute", resource: "*", effect: "deny" });
    expect(client.session.create).not.toHaveBeenCalled();
  });

  it("rejects a nonempty reviewer model even when it differs from the UI-selected model", async () => {
    const { provider } = makeProvider(
      { ...agent(), model: { providerID: "ui-selected-provider", id: "ui-selected-model" } },
      { directory: "/workspace" },
      "native-default",
    );
    await expect(provider.checkReadiness()).resolves.toBe(false);
  });

  it("still requires every configured deny in the effective suffix", async () => {
    const actions = ["*", ...RESTRICTED_REVIEW_AUTHORITIES, "dynamic"].filter(
      (action) => action !== RESTRICTED_REVIEW_AUTHORITIES[0],
    );
    const { provider } = makeProvider(
      agent([...nativeDefaultPermissions, ...actions.map((action) => ({ action, resource: "*", effect: "deny" }))]),
    );
    await expect(provider.checkReadiness()).resolves.toBe(false);
  });

  it.each([
    [
      "missing wildcard",
      agent(RESTRICTED_REVIEW_AUTHORITIES.map((action) => ({ action, resource: "*", effect: "deny" }))),
    ],
    [
      "allow after wildcard deny",
      agent([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ]),
    ],
    [
      "ask after wildcard deny",
      agent([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "ask" },
      ]),
    ],
    [
      "malformed earlier rule",
      agent([
        { action: "read", resource: "*.env", effect: "permit" },
        ...nativeDefaultPermissions,
        ...["*", ...RESTRICTED_REVIEW_AUTHORITIES, "dynamic"].map((action) => ({
          action,
          resource: "*",
          effect: "deny",
        })),
      ]),
    ],
    ["malformed rule", agent([null as never])],
    ["wrong agent", { ...agent(), id: "other" }],
    ["wrong model", { ...agent(), model: { providerID: "provider", id: "other" } }],
    ["malformed string model", { ...agent(), model: "provider/model" }],
    ["wrong system", { ...agent(), system: "other" }],
    ["wrong mode", { ...agent(), mode: "all" }],
    ["visible", { ...agent(), hidden: false }],
    ["wrong steps", { ...agent(), steps: 9 }],
  ])("stays unavailable for %s readback", async (_label, data) => {
    const { provider } = makeProvider(data);
    await expect(provider.checkReadiness()).resolves.toBe(false);
  });

  it("rejects an active-location mismatch", async () => {
    const { provider } = makeProvider(agent(), { directory: "/other" });
    await expect(provider.checkReadiness()).resolves.toBe(false);
  });
});
