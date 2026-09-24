import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RESTRICTED_REVIEW_PERMISSION_ATTESTATION } from "../vibefeld/adversarial-review-contract";
import { createAdversarialReviewSeam, type RestrictedReviewAdapter } from "../vibefeld/adversarial-review-seam";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import { ClaimProjectionReasoningReviewController } from "../vibefeld/claim-projection-reasoning-review-controller";
import { createClaimProjectionSeam } from "../vibefeld/claim-projection-seam";
import {
  type CurrentVibefeldRuntimeBoundary,
  createCurrentVibefeldClaimProjectionSeam,
} from "../vibefeld/current-vibefeld-claim-projection";
import { UnavailableReasoningReviewController } from "../vibefeld/unavailable-reasoning-review-controller";
import type { AfBridgeOperation } from "../vibefeld/vibefeld-runtime";

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

type ProductionSource = Readonly<{ name: string; source: string }>;

/**
 * Every non-test TypeScript module under the extension `src/` tree, named by
 * its `src/`-relative path. Test directories and test files are excluded so a
 * production regression cannot hide behind the suites that assert it.
 */
const productionSources = (relativeDirectory: string): readonly ProductionSource[] =>
  readdirSync(new URL(relativeDirectory, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") return [];
      return productionSources(`${relativeDirectory}${entry.name}/`);
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    const relativePath = `${relativeDirectory}${entry.name}`;
    return [{ name: relativePath.replace(/^\.\.\//u, ""), source: readSource(relativePath) }];
  });

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
const vibefeldActivationSource = readSource("../vibefeld/vibefeld-activation.ts");
const claimControllerSource = readSource("../vibefeld/claim-projection-reasoning-review-controller.ts");
const claimSeamSource = readSource("../vibefeld/claim-projection-seam.ts");
const currentClaimProjectionSource = readSource("../vibefeld/current-vibefeld-claim-projection.ts");
const restrictedOverlaySource = readSource("../../../../agents/opencode/src/restricted-review-overlay.ts");
const restrictedProviderSource = readSource("../../../../agents/opencode/src/restricted-review-provider.ts");
const restrictedAdapterSource = readSource("../vibefeld/restricted-review-adapter.ts");
const reasoningAssistArchitectSource = readSource("../vibefeld/reasoning-assist-architect.ts");
const reasoningAssistCriticSource = readSource("../vibefeld/reasoning-assist-critic.ts");
const reasoningAssistOrchestratorSource = readSource("../vibefeld/reasoning-assist-orchestrator.ts");
const reasoningAssistBriefSource = readSource("../vibefeld/reasoning-assist-brief.ts");
const reasoningAssistStructureRecorderSource = readSource("../vibefeld/reasoning-assist-structure-recorder.ts");
const reasoningAssistSources = [
  reasoningAssistArchitectSource,
  reasoningAssistCriticSource,
  reasoningAssistOrchestratorSource,
  reasoningAssistBriefSource,
  reasoningAssistStructureRecorderSource,
];
const adversarialControllerSource = readSource("../vibefeld/adversarial-review-reasoning-review-controller.ts");
const hiddenRegistrySource = readSource("../vibefeld/hidden-session-registry.ts");
const redactionSource = readSource("../vibefeld/adversarial-review-redaction.ts");
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

const assertNoWidenedVibefeldAuthority = (source: string): void => {
  expect(source).not.toMatch(
    /(?:vibefeld|\baf\b)[\s\S]{0,120}(?:pluginSources|mcpOverlay|customTools|agentOverlay|runAf|invokeAf|af(?:Argv|Executable|Workspace|Environment))/iu,
  );
  expect(source).not.toMatch(
    /(?:pluginSources|mcpOverlay|customTools|agentOverlay|runAf|invokeAf|af(?:Argv|Executable|Workspace|Environment))[\s\S]{0,120}(?:vibefeld|\baf\b)/iu,
  );
  expect(source).not.toMatch(/(?:vibefeld|\baf\b)[\w.-]*(?:response[- ]gate|adversarial|child[- ]model)/iu);
  expect(source).not.toMatch(
    /(?:vibefeld|\baf\b)[\s\S]{0,120}(?:unsandboxed|un-sandboxed)[\s\S]{0,80}(?:retry|fallback)/iu,
  );
};

/** The contracted ready bridge result; operation facts stay test-owned. */
const readyResult = (facts?: unknown) =>
  Object.freeze({
    state: "ready" as const,
    structuralStatus: null,
    ...(facts === undefined ? {} : { facts }),
  });

/**
 * A widened boundary double for the constrained claim-projection wiring: the
 * full boundary exists and every call stays observable, while the capability
 * report and per-operation facts stay test-owned. The production boundary type
 * only expresses an always-supported report, so the fake is narrowed once at
 * this call site and nowhere else.
 */
function boundaryDouble(options: {
  readonly capability: () => unknown;
  readonly run?: (operation: AfBridgeOperation) => unknown;
}) {
  const preflight = vi.fn();
  const run = vi.fn(async (operation: AfBridgeOperation) => options.run?.(operation) ?? readyResult());
  const teardown = vi.fn();
  const beginReview = vi.fn(async () => readyResult());
  const getClaimCapability = vi.fn(options.capability);

  return {
    boundary: {
      preflight,
      run,
      teardown,
      beginReview,
      getClaimCapability,
    } as unknown as CurrentVibefeldRuntimeBoundary,
    preflight,
    run,
    teardown,
    beginReview,
    getClaimCapability,
  };
}

describe("Vibefeld runtime bridge security negatives", () => {
  it("keeps adversarial modules out of activation and the ordinary host routes", () => {
    for (const source of [chatViewSource, agentSource, launchConfigSource, protocolSource]) {
      expect(source).not.toMatch(/adversarial-review|fixture-adversarial|vibefeld-prover|vibefeld-verifier/iu);
      expect(source).not.toMatch(/(?:prover|verifier)\s*:/u);
    }

    expect(extensionSource).toContain("UnavailableReasoningReviewController");
    expect(extensionSource).toContain("AdversarialReviewReasoningReviewController");
    expect(extensionSource).toContain("createAdversarialReviewSeam");
    expect(extensionSource).toContain("createRestrictedReviewAdapter");
    expect(extensionSource).toContain("provider.checkReadiness()");
    expect(extensionSource).toMatch(
      /if \(provider && \(await provider\.checkReadiness\(\)\)\) \{[\s\S]*?createRestrictedReviewAdapter\(\{ provider \}\)/u,
    );
    expect(extensionSource).not.toMatch(/createFixtureOnlyAdversarialReviewAdapter|fixture-adversarial/iu);
    expect(extensionSource).not.toMatch(/vibefeld-prover|vibefeld-verifier/iu);
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

  it("fails closed on a deliberately widened activation fixture", () => {
    const widenedFixture = `
      const extensionDescriptor = {
        vibefeld: {
          pluginSources: ["vibefeld-plugin"],
          argv: ["--workspace", "/repo"],
          afExecutable: "/usr/local/bin/af",
          afEnvironment: { AF_PROFILE: "broad" },
          providerExecutable: "/provider/af",
          nono: "/usr/bin/nono",
          profile: "broad",
          runtimeGrants: ["repository"],
          nestedSandbox: true,
          unsandboxedRetry: true,
        },
      };
    `;

    expect(() => assertNoWidenedVibefeldAuthority(widenedFixture)).toThrow();
    for (const source of [extensionSource, agentSource, launchConfigSource, protocolSource]) {
      assertNoWidenedVibefeldAuthority(source);
    }
  });

  it("keeps adversarial review out of AF, Chat sandbox, configuration, and nono profile authority", () => {
    for (const source of [
      sandboxPolicySource,
      nonoProfileSource,
      afRuntimeSource,
      afExecutionSource,
      vibefeldRuntimeSource,
    ]) {
      expect(source).not.toMatch(/adversarial-review|vibefeld-prover|vibefeld-verifier/iu);
    }

    // The constrained selection is the sole production exception: its
    // internally constructed provider is host-private and never an ordinary
    // configuration, profile, workspace, or proof-workspace authority.
    expect(extensionSource).toContain("readEffectiveOpenCodeConfiguration");
    expect(extensionSource).toContain("effectiveConfig.model");
    expect(extensionSource).toContain("restrictedReview:");
    expect(extensionSource).toContain("createRestrictedReviewProvider");
    expect(extensionSource).not.toMatch(/createFixtureOnlyAdversarialReviewAdapter|fixture-adversarial/iu);
    expect(extensionSource).not.toMatch(/vibefeld-prover|vibefeld-verifier/iu);
    const selectionSource =
      extensionSource.match(
        /async function selectReasoningReviewDependencies[\s\S]*?\n\}\n\ntype RestrictedReviewSelectionOptions/u,
      )?.[0] ?? "";
    expect(selectionSource).not.toMatch(
      /configuration\.update|profile.*(?:create|promote)|workspace.*(?:write|mkdir)|proofWorkspace/iu,
    );

    // The extension may reach AF only through the constrained host-owned
    // runtime resolution module, which the bridge test below pins. The bridge
    // module, proof storage, and every broader authority token stay out.
    expect(extensionSource).not.toMatch(/(?:proofWorkspace|approvedOperations|createProofWorkspace)/u);
    expect(extensionSource).not.toMatch(
      /(?:af-discovery|af-compatibility|af-direct-policy|af-execution-boundary|vibefeld-runtime)/u,
    );
    expect(sandboxPolicySource).not.toMatch(/(?:prover|verifier|\baf\b|proof)/iu);
    expect(nonoProfileSource).not.toMatch(/(?:prover|verifier|\baf\b|proof)/iu);
    expect(packageSource).not.toMatch(/(?:adversarial-review|vibefeld-prover|vibefeld-verifier)/iu);
  });

  it("keeps the host bridge out of OpenCode plugin, MCP, and custom-tool configuration", () => {
    for (const token of bridgeIntegrationTokens) {
      expect(agentSource, `agent integration contains ${token}`).not.toContain(token);
      expect(launchConfigSource, `launch configuration contains ${token}`).not.toContain(token);
    }

    // The extension host may reach AF only through the two constrained,
    // host-private modules: the runtime resolution seam and the activation
    // composition. The bridge module, bridge class, proof storage, and every
    // authority token stay out of the extension source itself.
    for (const token of bridgeIntegrationTokens.filter(
      (value) => value !== "createVibefeld" && value !== "af-runtime",
    )) {
      expect(extensionSource, `extension integration contains ${token}`).not.toContain(token);
    }
    expect(extensionSource).toContain('from "./vibefeld/af-runtime-resolution"');
    expect(extensionSource).toContain('from "./vibefeld/vibefeld-activation"');
    expect(extensionSource).not.toMatch(
      /from "\.\/vibefeld\/(?:af-discovery|af-compatibility|af-direct-policy|af-execution-boundary|vibefeld-runtime)"/u,
    );
    expect(extensionSource).not.toContain("ProofWorkspaceStore");

    expect(launchConfigSource).toMatch(/pluginSources\?:/);
    expect(launchConfigSource).toMatch(/mcpOverlay\?:/);
    expect(launchConfigSource).not.toMatch(/(?:\baf\b|vibefeld|proofWorkspace|customTool)/iu);
  });

  it("permits only the constrained activation composition wiring", () => {
    expect(vibefeldActivationSource).not.toMatch(/from ["']vscode["']/u);
    expect(vibefeldActivationSource).not.toMatch(/node:child_process|node:net|node:http|node:https/u);
    expect(vibefeldActivationSource).not.toMatch(/\b(?:spawn|execFile|fetch)\s*\(/u);
    expect(vibefeldActivationSource).not.toContain("createAfOutputParsers");
    expect(vibefeldActivationSource).not.toContain("af-output-schema");
    expect(vibefeldActivationSource).toContain("createProductionAfOutputParsers");
    expect(vibefeldActivationSource).toContain("globalStoragePath");
    expect(vibefeldActivationSource).toContain("createVibefeldRuntimeBridge");
    expect(vibefeldActivationSource).not.toMatch(/\.preflight\(|\.allocate\(/u);
    expect(vibefeldActivationSource).not.toMatch(/pluginSources|mcpOverlay|customTools|agentOverlay/u);
    expect(vibefeldActivationSource).not.toMatch(/configuration\.update|profile.*(?:create|promote|broaden)/iu);
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

    expect(protocolSource).toContain('type: "reasoningRuntime"');
    expect(protocolSource).toContain('type: "reasoningReviewPreference"');
    // The retired completed-message review and feedback discriminants stay out
    // of both protocol directions.
    expect(protocolSource).not.toContain('type: "requestReasoningReview"');
    expect(protocolSource).not.toContain('type: "cancelReasoningReview"');
    expect(protocolSource).not.toContain('type: "setReasoningReviewFeedback"');
    expect(protocolSource).not.toMatch(/type: "reasoningReview"/u);
    expect(agentInterfaceSource).not.toMatch(/VibefeldRuntimeBridge|ReasoningReviewController/u);
  });

  it("has no post-response review route and never compiles completed assistant prose", () => {
    // The only production route that converted completed visible assistant text
    // into the private compile grammar is gone.
    expect(existsSync(new URL("../vibefeld/reasoning-review-source-packet.ts", import.meta.url))).toBe(false);
    for (const source of [chatViewSource, extensionSource]) {
      expect(source).not.toMatch(/buildReasoningReviewSourcePacket|reasoning-review-source-packet|compileClaimGraph/u);
      // No ordinary host route invokes a review controller at all.
      expect(source).not.toMatch(/\.review\(\{|controller\.review/u);
    }

    // No production module under src/ references the deleted source packet.
    const productionSources = readdirSync(new URL("..", import.meta.url))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({ name, source: readSource(`../${name}`) }));
    for (const { name, source } of productionSources) {
      expect(source, name).not.toMatch(/buildReasoningReviewSourcePacket|reasoning-review-source-packet/u);
    }

    // No message handler or retained metadata for a manual or automatic
    // post-response review remains in the ordinary host routes.
    expect(chatViewSource).not.toMatch(
      /requestReasoningReview|cancelReasoningReview|setReasoningReviewFeedback|type: "reasoningReview"|automatic-routing|AutomaticRouting|qualification|routeAutomaticReview/u,
    );
    expect(extensionSource).not.toMatch(
      /automatic-routing|AutomaticRouting|QualificationRecorder|createQualificationFileStore|qualification-recorder|qualification-store/u,
    );
  });

  it("keeps claim projection host-private and out of model-visible authority routes", () => {
    for (const source of [chatViewSource, agentSource, launchConfigSource, protocolSource]) {
      expect(source).not.toMatch(/ClaimProjection|claim_projection|fixture-claim-projection/u);
      expect(source).not.toMatch(/(?:adversarial|child model|response gate|automatic route)/iu);
    }

    // Activation may reach claim projection only through the constrained,
    // host-private dynamic selection: no fixture seam, fixture adapter, or
    // model-visible route is added.
    expect(extensionSource).not.toMatch(
      /fixture-claim-projection|createFixtureOnly|fixtureClaimProjection|claim-projection-seam/u,
    );
    expect(extensionSource).toContain("ClaimProjectionReasoningReviewController");
    expect(extensionSource).toContain("createCurrentVibefeldClaimProjectionSeam");
    expect(extensionSource).toContain("createRestrictedReviewAdapter");
    expect(extensionSource).not.toMatch(/fixture-claim-projection|createFixtureOnly|fixtureClaimProjection/u);
    expect(extensionSource).not.toMatch(/vibefeld-prover|vibefeld-verifier/iu);

    // The restricted agent is a hidden in-memory overlay, not a model-visible
    // route. Filtering is host-side for agents, sessions, and events.
    expect(agentSource).toContain("RESTRICTED_REVIEW_AGENT_NAME");
    expect(agentSource).toContain("buildRestrictedReviewAgentEntry");
    expect(agentSource).toContain("restrictedReview");
    const restrictedOverlayBlock = agentSource.match(/const restrictedAgentOverlay[\s\S]*?return \{/u)?.[0] ?? "";
    expect(restrictedOverlayBlock).not.toMatch(/plugin|mcp/iu);
    expect(agentSource).not.toMatch(
      /(?:chatPrompt|writePrompt|task|plugin|mcp|customTools)[\s\S]{0,120}vibefeld-restricted-review/iu,
    );
    expect(chatViewSource).toContain("hiddenSessionRegistry.filterAgents");
    expect(chatViewSource).toContain("hiddenSessionRegistry.filterSessions");
    expect(chatViewSource).toContain("hiddenSessionRegistry.isHiddenSessionId");
    expect(hiddenRegistrySource).toContain("filterAgents");
    expect(hiddenRegistrySource).toContain("RESTRICTED_REVIEW_AGENT_NAME");
    expect(restrictedOverlaySource).toContain("hidden: true");
    expect(restrictedOverlaySource).toContain('"*"');
    expect(restrictedOverlaySource).toContain('mode: "subagent"');
    expect(restrictedProviderSource).toContain("Object.is(recordedGeneration, currentGeneration())");
    expect(restrictedProviderSource).toContain("client.config.get()");
    expect(restrictedAdapterSource).toContain("RESTRICTED_REVIEW_PERMISSION_ATTESTATION");
    expect(adversarialControllerSource).toMatch(/if \(invocation === "automatic"\) \{[\s\S]{0,120}unavailableSummary/u);
    expect(redactionSource).toContain("redactReviewReason");

    expect(claimControllerSource).toContain("compileClaimGraph(sourceText)");
    expect(claimControllerSource).toContain("this.seam.getCapability()");
    expect(claimControllerSource).not.toMatch(/(?:sendMessage|executeShell|connectMcp|spawn|fetch|writeFile)/u);
    expect(claimSeamSource).toContain("The only delegate input is a validated, host-private graph");
    expect(claimSeamSource).not.toMatch(/(?:argv|command|path|ledger|prompt|credential)/iu);
  });

  it("gates claim-projection selection on a supported claim operation before publishing availability", () => {
    const selectionSource =
      extensionSource.match(
        /async function selectReasoningReviewDependencies[\s\S]*?\n\}\n\ntype RestrictedReviewSelectionOptions/u,
      )?.[0] ?? "";
    expect(selectionSource).not.toBe("");

    // The capability check precedes the only projection-controller
    // construction, so a ready preflight alone can never select it.
    const capabilityIndex = selectionSource.indexOf("claimSeam.getCapability().supported");
    const projectionIndex = selectionSource.indexOf("new ClaimProjectionReasoningReviewController(");
    expect(capabilityIndex).toBeGreaterThanOrEqual(0);
    expect(projectionIndex).toBeGreaterThan(capabilityIndex);

    // The unsupported branch keeps the bounded unavailable delegate and
    // publishes the reviewed reason constant instead of deriving availability.
    expect(selectionSource).toMatch(
      /claimSeam\.getCapability\(\)\.supported[\s\S]{0,200}CLAIM_CAPABILITY_UNAVAILABLE_REASONING_REVIEW_RUNTIME/u,
    );
    expect(selectionSource).toContain("new UnavailableReasoningReviewController()");
    // Availability is derived only on the supported branch beside the
    // projection controller.
    expect(selectionSource).toMatch(
      /runtime = claimAvailable\s*\?[\s\S]{0,120}deriveReasoningReviewRuntime\(preflight\)/u,
    );
    expect(selectionSource).toMatch(/const provider = model \? createProvider\(model\) : undefined;/u);
    expect(selectionSource).toMatch(/provider && \(await provider\.checkReadiness\(\)\)/u);
    expect(selectionSource).toContain('{ state: "available" }');
    expect(selectionSource).not.toMatch(/enforced isolation|isolation enforced/iu);

    // The published status stays the bounded two-field constant.
    const capabilityStatus =
      extensionSource.match(/const CLAIM_CAPABILITY_UNAVAILABLE_REASONING_REVIEW_RUNTIME[\s\S]*?\n\};/u)?.[0] ?? "";
    expect(capabilityStatus).toContain("ReasoningReviewRuntime");
    expect(capabilityStatus).toContain('state: "unavailable"');
    expect(capabilityStatus).toContain('reason: "claim-capability-unavailable"');
  });

  it("keeps the fixture claim seam out of every production source and the current factory only", () => {
    for (const source of [
      extensionSource,
      chatViewSource,
      vibefeldActivationSource,
      vibefeldRuntimeSource,
      claimControllerSource,
      claimSeamSource,
      currentClaimProjectionSource,
    ]) {
      expect(source).not.toMatch(/fixture-claim-projection|createFixtureOnly|fixtureClaimProjection/u);
    }

    // The extension reaches claim projection only through the current factory,
    // which reads the bridge capability report and composes the unsupported
    // seam for every non-contracted boundary — never a fixture declaration.
    expect(extensionSource).toContain("createCurrentVibefeldClaimProjectionSeam");
    expect(currentClaimProjectionSource).toContain("createCurrentVibefeldClaimProjectionSeam");
    expect(currentClaimProjectionSource).toContain("getClaimCapability");
    expect(currentClaimProjectionSource).toContain("createUnsupportedClaimProjectionSeam()");
    // Capability reads and seam construction take no process, workspace
    // allocation, child-process, sandbox-manager, or configuration authority.
    expect(currentClaimProjectionSource).not.toMatch(
      /\bspawn\s*\(|\ballocate\s*\(|child_process|SandboxManager|configuration\.update/u,
    );
    // No unobserved verb or flag is reachable from the projection module.
    expect(currentClaimProjectionSource).not.toMatch(/challenge|resolve-challenge|accept|release|--refresh/u);
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
    // The widened boundary carries every member but reports no supported claim
    // operation, so no bridge call may start.
    const fake = boundaryDouble({ capability: () => Object.freeze({ supported: false }) });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.boundary);
    const controller = new ClaimProjectionReasoningReviewController(seam);

    const result = await controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText: "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.",
    });

    expect(result.status).toBe("unavailable");
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
    expect(fake.beginReview).not.toHaveBeenCalled();
    expect(fake.getClaimCapability).toHaveBeenCalledTimes(1);
  });

  it("projects only the contracted sequence through a capability-reporting bridge boundary", async () => {
    const requested: AfBridgeOperation[] = [];
    const fake = boundaryDouble({
      capability: () => Object.freeze({ supported: true, operation: "claim_projection" }),
      run: (operation) => {
        requested.push(operation);
        switch (operation.operation) {
          case "init":
            return readyResult({ initialized: true });
          case "claim":
            return readyResult({ nodeId: "1", role: "prover", claimed: true });
          case "refine":
            return readyResult({ parentId: "1", childIds: ["1.1"], childCount: 1 });
          case "status":
            return readyResult({ statistics: { totalNodes: 2 } });
        }
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.boundary);

    expect(seam.getCapability()).toEqual({ supported: true, operation: "claim_projection" });

    const controller = new ClaimProjectionReasoningReviewController(seam);
    const result = await controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText:
        "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.\nCLAIM: claim-2|deductive|A bounded supporting claim.\nDEPENDS: dependency-1|claim-1|claim-2",
    });

    expect(result.status).toBe("structurally_checked");
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
    expect(fake.beginReview).toHaveBeenCalledTimes(1);
    // The fixed sequence and host-owned inputs only: the host-fixed root id and
    // prover role, no other verb, and no raw argv, executable, workspace, or
    // owner reachable through the requested operations.
    expect(requested).toEqual([
      { operation: "init", conjecture: "A bounded conclusion.", author: "scribe" },
      { operation: "claim", nodeId: "1", role: "prover" },
      { operation: "refine", parentId: "1", statements: ["A bounded supporting claim."] },
      { operation: "status" },
    ]);
    expect(JSON.stringify(requested)).not.toMatch(
      /challenge|resolve-challenge|accept|release|--refresh|argv|executable|workspace|owner/iu,
    );
  });

  it("treats a widened capability report as unsupported and starts no claim operation", async () => {
    const fake = boundaryDouble({
      capability: () => Object.freeze({ supported: true, operation: "claim_projection", extra: true }),
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.boundary);

    expect(seam.getCapability()).toEqual({ supported: false });

    const controller = new ClaimProjectionReasoningReviewController(seam);
    const result = await controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText: "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.",
    });

    expect(result.status).toBe("unavailable");
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
    expect(fake.beginReview).not.toHaveBeenCalled();

    const permissiveAdapter = {
      attestation: {
        ...RESTRICTED_REVIEW_PERMISSION_ATTESTATION,
        permissions: { ...RESTRICTED_REVIEW_PERMISSION_ATTESTATION.permissions, repositoryRead: true },
      },
      createContext: vi.fn(),
      runProver: vi.fn(),
      runVerifier: vi.fn(),
      cancelContext: vi.fn(),
    } as unknown as RestrictedReviewAdapter;
    expect(createAdversarialReviewSeam(permissiveAdapter).getCapability()).toEqual({ supported: false });
  });

  it("fails closed to unresolved when the claim read-back does not match the host-fixed root", async () => {
    const requested: AfBridgeOperation[] = [];
    const fake = boundaryDouble({
      capability: () => Object.freeze({ supported: true, operation: "claim_projection" }),
      run: (operation) => {
        requested.push(operation);
        switch (operation.operation) {
          case "init":
            return readyResult({ initialized: true });
          case "claim":
            // Unexpected facts: the host-fixed root is "1"; any other node id
            // is not a valid recording of the claimed root.
            return readyResult({ nodeId: "2", role: "prover", claimed: true });
          case "refine":
            return readyResult({ parentId: "1", childIds: ["1.1"], childCount: 1 });
          case "status":
            return readyResult({ statistics: { totalNodes: 2 } });
        }
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.boundary);
    const controller = new ClaimProjectionReasoningReviewController(seam);

    const result = await controller.review({
      sessionId: "session-1",
      messageId: "message-1",
      sourceText:
        "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.\nCLAIM: claim-2|deductive|A bounded supporting claim.\nDEPENDS: dependency-1|claim-1|claim-2",
    });

    expect(result.status).toBe("unresolved");
    expect(JSON.stringify(result)).not.toContain("structurally_checked");
    // The sequence stops at the unexpected claim read-back: no refine, status,
    // preflight, or teardown follows.
    expect(requested.map((operation) => operation.operation)).toEqual(["init", "claim"]);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it("keeps ordinary activation dormant and retains the unavailable manual controller", async () => {
    expect(extensionSource).toContain("import { UnavailableReasoningReviewController }");
    expect(extensionSource).toContain("selectReasoningReviewDependencies(vibefeldActivation)");
    expect(extensionSource).toContain("reasoningReviewController,");
    expect(extensionSource).not.toMatch(/new\s+VibefeldRuntimeBridge|\.allocate\(\)/u);
    // Exactly one bounded activation preflight; no other module may preflight.
    expect(extensionSource.match(/\.preflight\(\)/gu) ?? []).toHaveLength(1);
    for (const source of [
      chatViewSource,
      vibefeldActivationSource,
      vibefeldRuntimeSource,
      claimControllerSource,
      claimSeamSource,
      currentClaimProjectionSource,
    ]) {
      expect(source).not.toMatch(/\.preflight\(/u);
    }
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

describe("Reasoning-assist security negatives", () => {
  it("keeps the assist surface host-owned with no IAgent or protocol route", () => {
    // `IAgent` gains no assist member and no assist/architect/critic type, so no
    // model-visible caller reaches a preflight, stage, or restricted adapter
    // through the agent contract.
    expect(agentInterfaceSource).not.toMatch(
      /reasoningAssist|ReasoningAssist|architect|critic|restrictedReview[\s\S]{0,80}stage|runReasoningAssistStage|ReasoningAssistRestrictedReviewAdapter|compileClaimGraph/iu,
    );

    // The protocol's assist surface is exactly the three prompt-scoped
    // host-to-UI messages. The UI-to-host union stays request- and
    // activation-free, and no architect/critic/stage-text/graph field crosses
    // the protocol in either direction.
    const uiToHostUnion = protocolSource.match(
      /export type UIToHostMessage =([\s\S]*?)\nexport type HostToUIMessage/u,
    )?.[1];
    const hostToUiUnion = protocolSource.match(/export type HostToUIMessage =([\s\S]*)$/u)?.[1];
    expect(uiToHostUnion).toBeDefined();
    expect(hostToUiUnion).toBeDefined();
    expect(uiToHostUnion).not.toBe("");
    expect(hostToUiUnion).not.toBe("");
    expect(uiToHostUnion).not.toMatch(/reasoningAssist|reasoning-assist|architect|critic/iu);
    expect([...(hostToUiUnion ?? "").matchAll(/type: "(reasoningAssist\w*)"/gu)].map(([, name]) => name)).toEqual([
      "reasoningAssistProgress",
      "reasoningAssistSummary",
      "reasoningAssistCleared",
    ]);
    expect(protocolSource).not.toMatch(/architect|critic|stageText|stage-text|claimGraph|compileClaimGraph/u);
    expect(protocolSource).not.toMatch(/requestReasoningAssist|cancelReasoningAssist|activateReasoningAssist/u);
  });

  it("keeps architect, critic, and assist wiring out of model-visible agent, launch, and prompt surfaces", () => {
    for (const source of [agentSource, launchConfigSource, chatPrompt, writePrompt]) {
      expect(source).not.toMatch(/architect|critic|reasoningAssist|reasoning-assist/iu);
    }

    expect(packageSource).not.toMatch(/reasoningAssist|reasoning-assist|architect|critic/iu);
    // The launch configuration gains no assist/AF option: only the existing
    // bounded plugin sources and MCP overlay seams remain.
    expect(launchConfigSource).toMatch(/pluginSources\?:/);
    expect(launchConfigSource).toMatch(/mcpOverlay\?:/);
    expect(launchConfigSource).not.toMatch(
      /(?:reasoningAssist|architect|critic)[\s\S]{0,80}(?:Argv|Executable|Workspace|Environment)/iu,
    );
  });

  it("keeps the restricted overlay and assist stages tool-less, in-memory, and permission-free", () => {
    for (const source of [...reasoningAssistSources, restrictedAdapterSource]) {
      expect(source, "assist/restricted source").not.toMatch(
        /pluginSources|mcpOverlay|customTools|agentOverlay|configuration\.update/u,
      );
      expect(source, "assist/restricted source").not.toMatch(/\bgrant\b/iu);
      expect(source, "assist/restricted source").not.toMatch(
        /\b(?:writeFile|writeFileSync|appendFile|mkdir|rm|unlink|createWriteStream)\s*\(/u,
      );
      expect(source, "assist/restricted source").not.toMatch(/node:fs|node:child_process|from ["']vscode["']/u);
    }

    // The five host-private assist modules add no plugin, MCP, or custom-tool
    // surface at all; only the retained restricted seam names review roles.
    for (const source of reasoningAssistSources) {
      expect(source).not.toMatch(/plugin|mcp|customTool/iu);
    }

    // The agent-package overlay and provider add no plugin, MCP, overlay, or
    // permission-grant authority of their own.
    for (const source of [restrictedOverlaySource, restrictedProviderSource]) {
      expect(source).not.toMatch(/pluginSources|mcpOverlay|customTools|configuration\.update|\bgrant\b/iu);
      expect(source).not.toMatch(/\b(?:writeFile|writeFileSync|appendFile|mkdir|unlink|createWriteStream)\s*\(/u);
    }
  });

  it("keeps the single delegated worker and the deny-by-default task map as the only delegation route", () => {
    // Exactly one allow target: the wildcard denies everything else, so no
    // architect/critic task target can be delegated to.
    expect(agentSource).toMatch(/task:\s*\{\s*"\*":\s*"deny",\s*"chat-research-worker":\s*"allow",\s*\},/u);
    expect(agentSource).toMatch(/"chat-research-worker":\s*\{\s*mode:\s*"subagent"/u);
    expect(agentSource).not.toMatch(/architect|critic|reasoningAssist|reasoning-assist/iu);

    // The worker MCP allow list is exactly the reviewed package prefixes; no AF
    // or assist MCP/tool prefix is added.
    const workerBlock = agentSource.match(/"chat-research-worker":\s*\{[\s\S]*?\n {4}\},/u)?.[0] ?? "";
    expect(workerBlock).not.toBe("");
    expect([...workerBlock.matchAll(/"([\w-]+_\*)":\s*"allow"/gu)].map(([, prefix]) => prefix)).toEqual([
      "firecrawl_*",
      "ctx_*",
      "context-mode_*",
      "paper-search_*",
    ]);
    expect(workerBlock).not.toMatch(/\baf\b|reasoning|assist|architect|critic/iu);
  });

  it("registers no architect or critic agent entry in any production source", () => {
    for (const { name, source } of productionSources("../")) {
      expect(source, name).not.toMatch(/["']?(?:architect|critic)["']?\s*:\s*\{/iu);
    }
    // The visible agent overlay registers exactly the Scout, worker, and Build
    // agents; any assist stage stays inside the hidden restricted agent.
    expect(agentSource).toMatch(/scout:\s*\{[\s\S]*?"chat-research-worker":\s*\{[\s\S]*?build:\s*\{/u);
  });

  it("keeps completed prose away from the claim compiler and builds the assist graph only from parsed architect output", () => {
    // Every production importer of the completed-prose compiler is accounted
    // for: the private graph module itself and the retained dormant
    // adversarial/projection machinery. No assist, dispatch, activation, or
    // controller module may become a new importer.
    const retainedClaimCompilerSources = [
      "vibefeld/adversarial-review-orchestrator.ts",
      "vibefeld/adversarial-review-reasoning-review-controller.ts",
      "vibefeld/claim-graph.ts",
      "vibefeld/claim-projection-reasoning-review-controller.ts",
    ] as const;
    const claimCompilerImporters = productionSources("../")
      .filter(({ source }) => /compileClaimGraph/u.test(source))
      .map(({ name }) => name)
      .sort();
    expect(claimCompilerImporters).toEqual([...retainedClaimCompilerSources].sort());

    // The architect converts only its own parsed JSON result and revalidates it
    // through the private domain: no compiled prose and no assistant text can
    // enter the assist graph, and the packet accepts only the three bounded
    // input keys.
    expect(reasoningAssistArchitectSource).toContain("validateClaimGraph(");
    expect(reasoningAssistArchitectSource).not.toContain("compileClaimGraph");
    expect(reasoningAssistArchitectSource).toContain("JSON.parse(text)");
    expect(reasoningAssistArchitectSource).toContain("graph: validation.graph");
    expect(reasoningAssistArchitectSource).toContain(
      'const PACKET_INPUT_KEYS = new Set(["userText", "recentTurns", "priorSummary"]);',
    );
    for (const source of reasoningAssistSources) {
      expect(source).not.toMatch(/sourceText|assistantResponse|completedMessage|messageText|responseText/iu);
    }
  });

  it("keeps the assist wiring to the bounded activation injection and lifecycle hook with no widening", () => {
    // The extension's assist surface is the bounded activation injection: the
    // typed adapter and recorder passed straight into the provider options,
    // plus the provider lifecycle hook and its best-effort deactivation call.
    // Nothing session-, config-, workspace-, or sandbox-shaped is reachable
    // through it, and the restricted disposal is registered through the
    // adapter itself.
    const assistWiringLines = extensionSource.split("\n").filter((line) => line.includes("reasoningAssist"));
    const assistWiring = assistWiringLines.join("\n");
    expect(assistWiring).toContain("cancelAllReasoningAssistWork()");
    expect(assistWiring).toContain("reasoningAssistAdapter");
    expect(assistWiring).toContain("reasoningAssistStructureRecorder");
    expect(assistWiring).not.toMatch(
      /getConfiguration|configuration\.update|workspace|nono|sandbox|profile|grant|permission|session/iu,
    );

    // The only assist modules the extension reaches are the two host-private
    // vibefeld factories: the recorder (type plus factory) and the adapter
    // (type only; its factory stays behind the readiness-gated dynamic import
    // shared with the adversarial seam). No architect, critic, orchestrator,
    // or brief module is imported by activation.
    expect(extensionSource).toContain('from "./vibefeld/reasoning-assist-structure-recorder"');
    expect(extensionSource).toContain('from "./vibefeld/restricted-review-adapter"');
    expect(extensionSource).toMatch(/import\("\.\/vibefeld\/restricted-review-adapter"\)/u);
    expect(extensionSource).not.toMatch(
      /from "\.\/vibefeld\/(?:reasoning-assist-(?:architect|critic|orchestrator|brief))"/u,
    );
    expect(extensionSource).toMatch(/restrictedReviewDisposal = adapter\.dispose;/u);
    expect(extensionSource).toContain("let reasoningAssistDisposal: (() => void) | undefined;");
    expect(extensionSource).toContain(
      "reasoningAssistDisposal = () => chatViewProvider?.cancelAllReasoningAssistWork();",
    );
    expect(extensionSource).toContain("const disposeAssist = reasoningAssistDisposal;");
    expect(extensionSource).toContain("reasoningAssistDisposal = undefined;");

    // The dispatch path reaches only the host-owned orchestrator and brief
    // helpers, and appends the brief only to the host-owned system instruction.
    const assistDispatchBlock =
      chatViewSource.match(/private async dispatchPrompt[\s\S]*?\n {2}\}\n\n {2}private postMcpPrefs/u)?.[0] ?? "";
    expect(assistDispatchBlock).not.toBe("");
    expect(assistDispatchBlock).toContain("runReasoningAssistPreflight");
    expect(assistDispatchBlock).toContain("appendReasoningAssistBrief");
    expect(assistDispatchBlock).toMatch(
      /system: assist \? appendReasoningAssistBrief\(baseSystem, assist\.brief\) : baseSystem/u,
    );
    expect(assistDispatchBlock).not.toMatch(
      /reasoningReviewController|\.review\(|requestReasoningReview|cancelReasoningReview|automatic-routing|qualification|blocked/iu,
    );

    // The assist modules perform no configuration, workspace, sandbox, profile,
    // permission, or process work of their own.
    for (const source of [...reasoningAssistSources, restrictedAdapterSource]) {
      expect(source).not.toMatch(
        /getConfiguration|configuration\.update|vscode\.workspace|\bworkspace\b|nono|sandbox-exec|\bprofile\b|\bgrant\b|permission[\s\S]{0,40}(?:allow|true)/iu,
      );
      expect(source).not.toMatch(/\b(?:spawn|exec|execFile|fetch)\s*\(/u);
    }
  });
});
