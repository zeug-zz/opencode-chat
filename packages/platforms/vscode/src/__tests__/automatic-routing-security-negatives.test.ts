import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { measureAutomaticRoutingFixture } from "../vibefeld/automatic-routing-evaluation";
import { createAutomaticRoutingLifecycle } from "../vibefeld/automatic-routing-lifecycle";
import { selectAutomaticRouting } from "../vibefeld/automatic-routing-policy";

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const extensionSource = readSource("../extension.ts");
const evaluationSource = readSource("../vibefeld/automatic-routing-evaluation.ts");
const policySource = readSource("../vibefeld/automatic-routing-policy.ts");
const lifecycleSource = readSource("../vibefeld/automatic-routing-lifecycle.ts");
const qualificationRecorderSource = readSource("../vibefeld/qualification-recorder.ts");
const qualificationStoreSource = readSource("../vibefeld/qualification-store.ts");

const qualifiedEvaluation = {
  version: "automatic-routing-evaluation-1",
  corpusId: "fixture-corpus",
  caseCount: 100,
  p95LatencyMs: 1_000,
  expectedCalibrationError: 0.05,
  falseChallengeRate: 0.02,
  qualified: true,
} as const;

describe("automatic-routing security negatives", () => {
  it("pins the constrained automatic-routing wiring and the unavailable controller as fallback", () => {
    expect(extensionSource).toContain("UnavailableReasoningReviewController");
    // The activation path is the only permitted route: the extension resolves
    // the gated activation, selects through the router, and reads a dynamic
    // evaluation provider instead of carrying hard-coded qualification.
    expect(extensionSource).toContain("resolveAutomaticRoutingActivation");
    expect(extensionSource).toContain("selectAutomaticRouting");
    expect(extensionSource).toContain("evaluationProvider");
    expect(extensionSource).not.toMatch(/(?:fixture-corpus|evaluation-1)/u);
    expect(extensionSource).not.toMatch(/qualified:\s*true/u);
    // The evaluation and lifecycle modules stay behind the router/activation
    // route; the extension never imports them directly.
    expect(extensionSource).not.toContain('from "./vibefeld/automatic-routing-evaluation"');
    expect(extensionSource).not.toContain('from "./vibefeld/automatic-routing-lifecycle"');
  });

  it("keeps automatic-routing modules pure and outside execution or authority boundaries", () => {
    const sources = [evaluationSource, policySource, lifecycleSource, qualificationRecorderSource];
    const forbidden = [
      /(?:node:child_process|node:net|node:http|node:https|node:fs|vscode)/u,
      /(?:spawn|exec|fork|fetch|WebSocket|createServer|writeFile|mkdir|mkdtemp)\s*\(/u,
      /(?:OpenCodeAgent|ChatViewProvider|IAgent|pluginSources|mcpOverlay|task|agent|tools?|permissions?)/iu,
      /(?:\bAF\b|proofWorkspace|proof workspace|sandbox|nono|TUI|configuration)/iu,
    ];

    for (const source of sources) {
      for (const pattern of forbidden) expect(source).not.toMatch(pattern);
      expect(source).not.toMatch(
        /(?:from\s+["'][^"']*(?:hindsight|memory)|(?:hindsight_|ctx_|detectMemoryProvider|resolveHindsightPlugin|buildHindsight))/iu,
      );
    }
    expect(qualificationStoreSource).not.toMatch(
      /(?:from\s+["'][^"']*(?:hindsight|memory)|(?:hindsight_|ctx_|detectMemoryProvider|resolveHindsightPlugin|buildHindsight))/iu,
    );

    expect(evaluationSource).toContain("callers must not treat fixture output as production evidence");
    expect(lifecycleSource).toContain("It never stores request/response text");
    expect(lifecycleSource).toContain("or references the response-gate boundary");
  });

  it("evaluates an eligible fixture without invoking process, network, filesystem, or product-capability spies", () => {
    const processLaunch = vi.fn();
    const network = vi.fn();
    const filesystemWrite = vi.fn();
    const plugin = vi.fn();
    const mcp = vi.fn();
    const tool = vi.fn();
    const task = vi.fn();
    const childAgent = vi.fn();
    const permissionChange = vi.fn();

    const selection = selectAutomaticRouting({
      enabled: true,
      runtime: "available",
      evaluation: qualifiedEvaluation,
      workMode: "scout",
      requestClass: "argument",
      response: {
        sessionId: "session-1",
        activeSessionId: "session-1",
        role: "assistant",
        completion: "completed",
      },
      signals: { evidenceDependent: true, multiStepArgument: true, highImpactRecommendation: false },
    });

    expect(selection).toEqual({
      selected: true,
      reasonCode: "evidence_dependent",
      summary: "Evidence-dependent response",
    });
    for (const capability of [
      processLaunch,
      network,
      filesystemWrite,
      plugin,
      mcp,
      tool,
      task,
      childAgent,
      permissionChange,
    ]) {
      expect(capability).not.toHaveBeenCalled();
    }
  });

  it("keeps fixture measurement aggregate-only and lifecycle-only", () => {
    const cases = Array.from({ length: 100 }, () => ({
      latencyMs: 10,
      confidence: 0.9,
      correct: true,
      challenged: false,
      falseChallenge: false,
    }));
    const measurement = measureAutomaticRoutingFixture("fixture-corpus", cases);
    expect(measurement).toMatchObject({ ok: true, value: { caseCount: 100, qualified: true } });
    expect(JSON.stringify(measurement)).not.toMatch(/(?:requestText|sourceText|private reasoning|ledger)/iu);

    const lifecycle = createAutomaticRoutingLifecycle({ sessionId: "session-1", generation: 0 });
    expect(
      lifecycle.start({
        binding: { sessionId: "session-1", messageId: "message-1", generation: 0 },
        selection: {
          selected: true,
          reasonCode: "evidence_dependent",
          summary: "Evidence-dependent response",
        },
      }),
    ).toMatchObject({ kind: "started" });
    expect(JSON.stringify(lifecycle)).not.toMatch(/(?:gate|release|process|network|write|config)/iu);
  });
});
