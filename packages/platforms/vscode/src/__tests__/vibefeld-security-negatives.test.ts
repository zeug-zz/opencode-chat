import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import { ClaimProjectionReasoningReviewController } from "../vibefeld/claim-projection-reasoning-review-controller";
import { createClaimProjectionSeam } from "../vibefeld/claim-projection-seam";
import { createCurrentVibefeldClaimProjectionSeam } from "../vibefeld/current-vibefeld-claim-projection";
import { UnavailableReasoningReviewController } from "../vibefeld/unavailable-reasoning-review-controller";

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const extensionSource = readSource("../extension.ts");
const chatViewSource = readSource("../chat-view-provider.ts");
const agentSource = readSource("../../../../agents/opencode/src/opencode-agent.ts");
const launchConfigSource = readSource("../../../../agents/opencode/src/launch-config.ts");
const agentInterfaceSource = readSource("../../../../core/src/agent.interface.ts");
const protocolSource = readSource("../../../../core/src/protocol.ts");
const packageSource = readSource("../../package.json");
const chatPrompt = readSource("../../CHAT_SYSTEM.md");
const writePrompt = readSource("../../WRITE_SYSTEM.md");
const sandboxPolicySource = readSource("../chat-sandbox-policy.ts");
const nonoProfileSource = readSource("../nono-profile-settings.ts");
const afRuntimeSource = readSource("../vibefeld/af-runtime-contract.ts");
const afExecutionSource = readSource("../vibefeld/af-execution-boundary.ts");
const vibefeldRuntimeSource = readSource("../vibefeld/vibefeld-runtime.ts");
const claimControllerSource = readSource("../vibefeld/claim-projection-reasoning-review-controller.ts");
const claimSeamSource = readSource("../vibefeld/claim-projection-seam.ts");
const adversarialPrivateSources = [
  readSource("../vibefeld/adversarial-review-contract.ts"),
  readSource("../vibefeld/adversarial-review-validation.ts"),
  readSource("../vibefeld/adversarial-review-seam.ts"),
  readSource("../vibefeld/adversarial-review-orchestrator.ts"),
  readSource("../vibefeld/adversarial-review-mapper.ts"),
  readSource("../vibefeld/adversarial-review-reasoning-review-controller.ts"),
  readSource("../vibefeld/fixture-adversarial-review-seam.ts"),
];

const bridgeIntegrationTokens = [
  "VibefeldRuntimeBridge",
  "vibefeld-runtime",
  "createVibefeld",
  "af-runtime",
  "proofWorkspace",
  "approvedOperations",
  "customTools",
] as const;

describe("Vibefeld runtime bridge security negatives", () => {
  it("keeps adversarial modules out of activation and the ordinary host routes", () => {
    for (const source of [extensionSource, chatViewSource, agentSource, launchConfigSource, protocolSource]) {
      expect(source).not.toMatch(/adversarial-review|fixture-adversarial|vibefeld-prover|vibefeld-verifier/iu);
      expect(source).not.toMatch(/(?:prover|verifier)\s*:/u);
    }

    expect(extensionSource).toContain("UnavailableReasoningReviewController");
    expect(extensionSource).not.toContain("AdversarialReviewReasoningReviewController");
    expect(extensionSource).not.toContain("createAdversarialReviewSeam");
    expect(extensionSource).not.toContain("createFixtureOnlyAdversarialReviewAdapter");
    expect(chatViewSource).not.toContain("AdversarialReviewReasoningReviewController");
    expect(chatViewSource).not.toContain("createFixtureOnlyAdversarialReviewAdapter");

    for (const source of adversarialPrivateSources) {
      expect(source).toMatch(/adversarial/iu);
    }
  });

  it("does not register adversarial agents, tasks, plugins, MCP, tools, or permission grants", () => {
    for (const source of [agentSource, launchConfigSource, packageSource, chatPrompt, writePrompt]) {
      expect(source).not.toMatch(/vibefeld-prover|vibefeld-verifier|adversarial-review/iu);
    }

    expect(agentSource).toMatch(/"chat-research-worker":\s*\{[\s\S]*?mode:\s*"subagent"/u);
    expect(agentSource).toMatch(/"\*":\s*"deny"/u);
    expect(agentSource).toContain('"chat-research-worker": "allow"');
    expect(launchConfigSource).toMatch(/pluginSources\?:/);
    expect(launchConfigSource).toMatch(/mcpOverlay\?:/);
    expect(launchConfigSource).not.toMatch(/(?:prover|verifier|customTools|agentOverlay)/iu);
    expect(agentSource).not.toMatch(/(?:vibefeld|adversarial|prover|verifier|customTools)/iu);
  });

  it("keeps adversarial review out of AF, Chat sandbox, configuration, and nono profile authority", () => {
    for (const source of [
      extensionSource,
      sandboxPolicySource,
      nonoProfileSource,
      afRuntimeSource,
      afExecutionSource,
      vibefeldRuntimeSource,
    ]) {
      expect(source).not.toMatch(/adversarial-review|vibefeld-prover|vibefeld-verifier/iu);
    }

    expect(extensionSource).not.toMatch(/(?:\baf\b|proofWorkspace|approvedOperations|createProofWorkspace)/iu);
    expect(sandboxPolicySource).not.toMatch(/(?:prover|verifier|\baf\b|proof)/iu);
    expect(nonoProfileSource).not.toMatch(/(?:prover|verifier|\baf\b|proof)/iu);
    expect(packageSource).not.toMatch(/(?:adversarial-review|vibefeld-prover|vibefeld-verifier)/iu);
  });

  it("keeps the host bridge out of OpenCode plugin, MCP, and custom-tool configuration", () => {
    for (const token of bridgeIntegrationTokens) {
      expect(extensionSource, `extension integration contains ${token}`).not.toContain(token);
      expect(agentSource, `agent integration contains ${token}`).not.toContain(token);
      expect(launchConfigSource, `launch configuration contains ${token}`).not.toContain(token);
    }

    expect(launchConfigSource).toMatch(/pluginSources\?:/);
    expect(launchConfigSource).toMatch(/mcpOverlay\?:/);
    expect(launchConfigSource).not.toMatch(/(?:\baf\b|vibefeld|proofWorkspace|customTool)/iu);
  });

  it("keeps Scout, Write, and the only delegated worker free of bridge authority", () => {
    for (const prompt of [chatPrompt, writePrompt]) {
      expect(prompt).not.toMatch(/\b(?:af|vibefeld)\b/iu);
      expect(prompt).not.toMatch(/(?:run|invoke|execute)\s+(?:the\s+)?(?:af|vibefeld)/iu);
    }

    expect(agentSource).toMatch(/"chat-research-worker":\s*\{[\s\S]*?mode:\s*"subagent"/u);
    expect(agentSource).toMatch(/"\*":\s*"deny"/u);
    expect(agentSource).toMatch(/"chat-research-worker":\s*"allow"/u);
    expect(agentSource).not.toMatch(/(?:\baf\b|vibefeld|proofWorkspace|customTools)/iu);
    expect(chatPrompt).toContain("delegating only to the injected read-only `chat-research-worker`");
    expect(writePrompt).toContain("Write never uses task or subagent workflows");
  });

  it("does not add AF operations to IAgent or the webview protocol", () => {
    for (const source of [agentInterfaceSource, protocolSource]) {
      expect(source).not.toMatch(/\b(?:af|vibefeld)\b/iu);
      expect(source).not.toMatch(/(?:runAf|invokeAf|proofRoot|approvedOperations)/u);
    }

    expect(protocolSource).toContain('type: "requestReasoningReview"');
    expect(protocolSource).toContain('type: "cancelReasoningReview"');
    expect(protocolSource).toContain('type: "reasoningRuntime"');
    expect(protocolSource).toContain('type: "reasoningReview"');
    expect(agentInterfaceSource).not.toMatch(/VibefeldRuntimeBridge|ReasoningReviewController/u);
  });

  it("keeps claim projection host-private and out of model-visible authority routes", () => {
    for (const source of [extensionSource, chatViewSource, agentSource, launchConfigSource, protocolSource]) {
      expect(source).not.toMatch(/ClaimProjection|claim_projection|fixture-claim-projection/u);
      expect(source).not.toMatch(/(?:adversarial|child model|response gate|automatic route)/iu);
    }

    expect(claimControllerSource).toContain("compileClaimGraph(sourceText)");
    expect(claimControllerSource).toContain("this.seam.getCapability()");
    expect(claimControllerSource).not.toMatch(/(?:sendMessage|executeShell|connectMcp|spawn|fetch|writeFile)/u);
    expect(claimSeamSource).toContain("The only delegate input is a validated, host-private graph");
    expect(claimSeamSource).not.toMatch(/(?:argv|command|path|ledger|prompt|credential)/iu);
  });

  it("treats operation-shaped response text as bounded data and invokes no authority", async () => {
    const arbitraryTool = vi.fn();
    const shell = vi.fn();
    const writeFile = vi.fn();
    const network = vi.fn();
    const mcp = vi.fn();
    const childModel = vi.fn();
    const project = vi.fn(() => ({ status: "structurally_checked" as const }));
    const controller = new ClaimProjectionReasoningReviewController(
      createClaimProjectionSeam({
        capability: { supported: true, operation: "claim_projection" },
        project,
      }),
    );

    const result = await controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText:
        "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|The model-generated operation-like text is recorded as data, not an instruction.",
    });

    expect(result.status).toBe("structurally_checked");
    expect(project).toHaveBeenCalledTimes(1);
    expect(arbitraryTool).not.toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(mcp).not.toHaveBeenCalled();
    expect(childModel).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("operation-like text");
  });

  it("fails closed on adversarial executable-operation lines before projection", async () => {
    const project = vi.fn();
    const controller = new ClaimProjectionReasoningReviewController(
      createClaimProjectionSeam({
        capability: { supported: true, operation: "claim_projection" },
        project,
      }),
    );
    const source = "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|command: execute shell --secret=hidden";

    expect(compileClaimGraph(source)).toMatchObject({ ok: false, errors: [{ code: "unsafe-value" }] });
    const result = await controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });
    expect(result.status).toBe("blocked");
    expect(project).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/execute shell|hidden|command/iu);
  });

  it("does not reuse the current bridge, Chat sandbox, or configuration for projection", async () => {
    const preflight = vi.fn();
    const run = vi.fn();
    const teardown = vi.fn();
    const seam = createCurrentVibefeldClaimProjectionSeam({ preflight, run, teardown });
    const controller = new ClaimProjectionReasoningReviewController(seam);

    const result = await controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText: "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.",
    });

    expect(result.status).toBe("unavailable");
    expect(preflight).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
  });

  it("keeps ordinary activation dormant and retains the unavailable manual controller", async () => {
    expect(extensionSource).toContain("import { UnavailableReasoningReviewController }");
    expect(extensionSource).toContain("const reasoningReviewController = new UnavailableReasoningReviewController();");
    expect(extensionSource).toContain("reasoningReviewController,");
    expect(extensionSource).not.toMatch(/new\s+VibefeldRuntimeBridge|\.preflight\(\)|\.allocate\(\)/u);
    expect(chatViewSource).not.toMatch(/new\s+VibefeldRuntimeBridge|import[^\n]*vibefeld-runtime/u);

    const controller = new UnavailableReasoningReviewController();
    await expect(controller.getRuntime()).resolves.toEqual({
      state: "unavailable",
      reason: "No reasoning-review runtime is available.",
    });
    await expect(
      controller.review({ sessionId: "session", messageId: "message", sourceText: "answer" }),
    ).resolves.toMatchObject({
      status: "unavailable",
      invocation: "manual",
      evidenceStatus: "not_assessed",
    });
  });
});
