import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AF_MAX_REFINE_STATEMENTS } from "../vibefeld/af-command-schema";
import { AF_FIXTURE_LIMITS } from "../vibefeld/af-runtime-contract";
import { type ClaimGraph, compileClaimGraph } from "../vibefeld/claim-graph";
import { mapClaimProjectionToSummary } from "../vibefeld/claim-projection-mapper";
import { createUnsupportedClaimProjectionSeam } from "../vibefeld/claim-projection-seam";
import {
  type CurrentVibefeldRuntimeBoundary,
  createCurrentVibefeldClaimProjectionSeam,
} from "../vibefeld/current-vibefeld-claim-projection";
import { normalizeEvidenceReferences } from "../vibefeld/evidence-metadata";
import type { AfBridgeFailureReason, AfBridgeOperation, AfBridgeState } from "../vibefeld/vibefeld-runtime";

const CLAIM_CAPABILITY = Object.freeze({ supported: true, operation: "claim_projection" } as const);
/** The seam's host-fixed prover identity; graph, model, and caller input cannot change it. */
const HOST_FIXED_AUTHOR = "scribe";

const ready = (facts?: unknown) =>
  Object.freeze({
    state: "ready" as const,
    structuralStatus: null,
    ...(facts === undefined ? {} : { facts }),
  });

const failure = (reason: AfBridgeFailureReason, state: AfBridgeState = "unavailable") =>
  Object.freeze({ state, structuralStatus: null, reason });

type RunOperationName = AfBridgeOperation["operation"];
type Stage = "beginReview" | RunOperationName;
type OperationHandler = (operation: AfBridgeOperation, signal: AbortSignal | undefined) => unknown;

type FakeOptions = Readonly<{
  readonly capability?: () => unknown;
  readonly failAt?: Stage;
  readonly failure?: unknown;
  readonly handlers?: Readonly<Partial<Record<RunOperationName, OperationHandler>>>;
}>;

/** A recording bridge double; the capability report and every operation are observable. */
function bridgeFake(options: FakeOptions = {}) {
  const calls: { kind: Stage; operation?: AfBridgeOperation }[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let refinedStatementCount = 0;

  const preflight = vi.fn(async () => ready());
  const beginReview = vi.fn(async () => {
    calls.push({ kind: "beginReview" });
    if (options.failAt === "beginReview") return options.failure;
    return ready();
  });
  const run = vi.fn(async (operation: AfBridgeOperation, signal?: AbortSignal) => {
    calls.push({ kind: operation.operation, operation });
    signals.push(signal);
    if (options.failAt === operation.operation) return options.failure;
    const handler = options.handlers?.[operation.operation];
    if (handler) return handler(operation, signal);
    switch (operation.operation) {
      case "init":
        return ready({ initialized: true });
      case "claim":
        return ready({ nodeId: operation.nodeId, role: operation.role, claimed: true });
      case "refine":
        refinedStatementCount += operation.statements.length;
        return ready({
          parentId: operation.parentId,
          childIds: operation.statements.map((_, index) => `${operation.parentId}.${index + 1}`),
          childCount: operation.statements.length,
        });
      case "status":
        return ready({
          statistics: { totalNodes: 1 + refinedStatementCount, totalChallenges: 0, openChallenges: 0 },
          jobs: { proverJobs: 0, verifierJobs: 0 },
          nodeCount: 1 + refinedStatementCount,
        });
    }
  });
  const teardown = vi.fn(async () => Object.freeze({ state: "unavailable" as const, structuralStatus: null }));
  const getClaimCapability = vi.fn(options.capability ?? (() => CLAIM_CAPABILITY));

  return {
    runtime: {
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
    calls,
    signals,
  };
}

function requireGraph(result: ReturnType<typeof compileClaimGraph>) {
  if (!result.ok) throw new Error("test graph must be valid");
  return result.graph;
}

const singleClaimResult = compileClaimGraph("CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.");
const singleClaimGraph = requireGraph(singleClaimResult);

const CLEAN_CONCLUSION = "The bounded conclusion is recorded.";
const CLEAN_REMAINING = ["The first supporting claim is recorded.", "The second supporting claim is recorded."];
const cleanGraph = requireGraph(
  compileClaimGraph(
    [
      "CONCLUSION: claim-1",
      `CLAIM: claim-1|deductive|${CLEAN_CONCLUSION}`,
      `CLAIM: claim-2|deductive|${CLEAN_REMAINING[0]}`,
      `CLAIM: claim-3|empirical|${CLEAN_REMAINING[1]}`,
      "DEPENDS: dependency-1|claim-1|claim-2",
      "DEPENDS: dependency-2|claim-1|claim-3",
    ].join("\n"),
  ),
);

const chunkStatements = Array.from(
  { length: AF_MAX_REFINE_STATEMENTS + 1 },
  (_, index) => `Chunk statement ${index + 1}.`,
);
const chunkGraph = requireGraph(
  compileClaimGraph(
    [
      "CONCLUSION: claim-1",
      "CLAIM: claim-1|deductive|The chunked conclusion is recorded.",
      ...chunkStatements.map((statement, index) => `CLAIM: claim-${index + 2}|deductive|${statement}`),
      ...chunkStatements.map((_, index) => `DEPENDS: dependency-${index + 1}|claim-1|claim-${index + 2}`),
    ].join("\n"),
  ),
);

describe("current Vibefeld runtime claim boundary", () => {
  it("reads the contracted capability without preflight, spawning, or allocation", () => {
    const fake = bridgeFake();

    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(seam.getCapability()).toEqual({ supported: true, operation: "claim_projection" });
    expect(seam.getCapability()).toEqual({ supported: true, operation: "claim_projection" });
    expect(fake.getClaimCapability).toHaveBeenCalledTimes(1);
    expect(fake.calls).toEqual([]);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.beginReview).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it("stays unsupported when the boundary has no capability report", async () => {
    const runtime = {
      preflight: vi.fn(),
      run: vi.fn(),
      teardown: vi.fn(),
      beginReview: vi.fn(),
    };
    const seam = createCurrentVibefeldClaimProjectionSeam(runtime as unknown as CurrentVibefeldRuntimeBoundary);

    expect(seam.getCapability()).toEqual({ supported: false });
    expect(await seam.project(singleClaimGraph)).toEqual({ status: "unavailable", reason: "unsupported" });
    expect(runtime.preflight).not.toHaveBeenCalled();
    expect(runtime.run).not.toHaveBeenCalled();
    expect(runtime.beginReview).not.toHaveBeenCalled();
    expect(runtime.teardown).not.toHaveBeenCalled();
  });

  it("stays unsupported when the capability report throws", async () => {
    const fake = bridgeFake({
      capability: () => {
        throw new Error("capability read failed");
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(seam.getCapability()).toEqual({ supported: false });
    expect(await seam.project(singleClaimGraph)).toEqual({ status: "unavailable", reason: "unsupported" });
    expect(fake.calls).toEqual([]);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.beginReview).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it("stays unsupported unless the report is exactly the contracted shape", async () => {
    const reports: unknown[] = [
      { supported: false },
      { supported: true },
      { supported: true, operation: "claim_projection", extra: true },
      { supported: true, operation: "claim_projection", extra: undefined },
      { supported: true, operation: "version" },
      { supported: "true", operation: "claim_projection" },
      { operation: "claim_projection" },
      [],
      null,
      "claim_projection",
      42,
      () => CLAIM_CAPABILITY,
    ];

    for (const report of reports) {
      const fake = bridgeFake({ capability: () => report });
      const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

      expect(seam.getCapability(), JSON.stringify(report)).toEqual({ supported: false });
      expect(await seam.project(singleClaimGraph), JSON.stringify(report)).toEqual({
        status: "unavailable",
        reason: "unsupported",
      });
      expect(fake.calls, JSON.stringify(report)).toEqual([]);
      expect(fake.preflight, JSON.stringify(report)).not.toHaveBeenCalled();
      expect(fake.run, JSON.stringify(report)).not.toHaveBeenCalled();
      expect(fake.beginReview, JSON.stringify(report)).not.toHaveBeenCalled();
      expect(fake.teardown, JSON.stringify(report)).not.toHaveBeenCalled();
    }
  });

  it("composes exactly the unsupported production seam for a capability-less boundary", async () => {
    const fake = bridgeFake({ capability: () => ({ supported: false }) });
    const reference = createUnsupportedClaimProjectionSeam();
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);
    // Unsupported short-circuits before graph validation, exactly like the reference seam.
    const uncheckedGraph = { conclusionId: "claim-1" } as unknown as ClaimGraph;

    expect(seam.getCapability()).toEqual(reference.getCapability());
    expect(await seam.project(singleClaimGraph)).toEqual({ status: "unavailable", reason: "unsupported" });
    expect(await seam.project(uncheckedGraph)).toEqual(await reference.project(uncheckedGraph));
    expect(fake.getClaimCapability).toHaveBeenCalledTimes(1);
    expect(fake.calls).toEqual([]);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.beginReview).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it.each([
    { label: "unready", reason: "operation-not-ready", state: "unavailable" },
    { label: "incompatible", reason: "runtime-mismatch", state: "incompatible" },
  ] as const)("keeps a $label review boundary non-structural without running the sequence", async (boundary) => {
    const fake = bridgeFake({ failAt: "beginReview", failure: failure(boundary.reason, boundary.state) });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(seam.getCapability()).toEqual(CLAIM_CAPABILITY);
    expect(await seam.project(cleanGraph)).toEqual({ status: "unavailable", reason: "malformed" });
    expect(fake.calls.map((call) => call.kind)).toEqual(["beginReview"]);
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it("maps an audit-failed review boundary without running the sequence", async () => {
    const fake = bridgeFake({ failAt: "beginReview", failure: failure("audit-failure", "audit-failed") });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(cleanGraph)).toEqual({ status: "audit_failed", reason: "audit" });
    expect(fake.calls.map((call) => call.kind)).toEqual(["beginReview"]);
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it("keeps the fixture claim seam unreachable from production modules", () => {
    const fixtureTokens = /fixture-claim-projection|createFixtureOnlyClaimProjectionSeam|fixtureClaimProjection/u;
    for (const modulePath of [
      "../extension.ts",
      "../vibefeld/current-vibefeld-claim-projection.ts",
      "../vibefeld/vibefeld-runtime.ts",
      "../vibefeld/claim-projection-reasoning-review-controller.ts",
      "../vibefeld/claim-projection-seam.ts",
    ]) {
      expect(readFileSync(new URL(modulePath, import.meta.url), "utf8"), modulePath).not.toMatch(fixtureTokens);
    }

    // The fixture factory's only callers are its own module and test files.
    const fixtureFactoryCallers: string[] = [];
    const collectCallers = (directory: URL, prefix: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relativePath = `${prefix}${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          collectCallers(new URL(`${entry.name}/`, directory), `${relativePath}/`);
          continue;
        }
        if (!/\.tsx?$/u.test(entry.name)) continue;
        if (readFileSync(new URL(entry.name, directory), "utf8").includes("createFixtureOnlyClaimProjectionSeam"))
          fixtureFactoryCallers.push(relativePath);
      }
    };
    collectCallers(new URL("../", import.meta.url), "");

    expect(
      fixtureFactoryCallers.filter(
        (caller) => caller !== "vibefeld/fixture-claim-projection-seam.ts" && !caller.startsWith("__tests__/"),
      ),
    ).toEqual([]);
  });

  it("maps an unsupported projection to a bounded unavailable summary", async () => {
    const fake = bridgeFake({ capability: () => ({ supported: false }) });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);
    const evidence = normalizeEvidenceReferences([]);
    const result = mapClaimProjectionToSummary({
      reviewedMessageId: "message-1",
      graph: singleClaimResult,
      evidence,
      outcome: await seam.project(singleClaimGraph),
    });

    expect(result.status).toBe("unavailable");
    expect(result.evidenceStatus).toBe("not_required");
    expect(JSON.stringify(result)).not.toContain("structurally_checked");
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("projects a validated graph through the fixed bridge sequence", async () => {
    const fake = bridgeFake();
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);
    const controller = new AbortController();

    const outcome = await seam.project(cleanGraph, controller.signal);

    expect(outcome).toEqual({ status: "structurally_checked" });
    // The normalized outcome carries no facts, paths, argv, or statement content.
    expect(JSON.stringify(outcome)).toBe('{"status":"structurally_checked"}');
    expect(fake.calls.map((call) => call.kind)).toEqual(["beginReview", "init", "claim", "refine", "status"]);
    expect(fake.calls[1]?.operation).toEqual({
      operation: "init",
      conjecture: CLEAN_CONCLUSION,
      author: HOST_FIXED_AUTHOR,
    });
    expect(fake.calls[2]?.operation).toEqual({ operation: "claim", nodeId: "1", role: "prover" });
    expect(fake.calls[3]?.operation).toEqual({ operation: "refine", parentId: "1", statements: CLEAN_REMAINING });
    expect(fake.calls[4]?.operation).toEqual({ operation: "status" });
    expect(fake.signals).toHaveLength(4);
    for (const signal of fake.signals) expect(signal).toBe(controller.signal);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it("chunks remaining statements within the fixed refine bound without loss", async () => {
    const fake = bridgeFake();
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(chunkGraph)).toEqual({ status: "structurally_checked" });
    expect(fake.calls.map((call) => call.kind)).toEqual(["beginReview", "init", "claim", "refine", "refine", "status"]);
    const refineCalls = fake.calls.filter((call) => call.kind === "refine");
    expect(refineCalls).toHaveLength(2);
    const chunks = refineCalls.map((call) =>
      call.operation?.operation === "refine" ? call.operation.statements : ([] as readonly string[]),
    );
    expect(chunks[0]).toHaveLength(AF_MAX_REFINE_STATEMENTS);
    expect(chunks[1]).toHaveLength(1);
    expect([...chunks[0], ...chunks[1]]).toEqual(chunkStatements);
  });

  it("publishes unresolved when a refine reports an unexpected child count", async () => {
    const fake = bridgeFake({
      handlers: {
        refine: (operation) =>
          ready({
            parentId: "1",
            childIds: ["1.1"],
            childCount: operation.operation === "refine" ? operation.statements.length - 1 : 0,
          }),
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(cleanGraph)).toEqual({ status: "unresolved" });
  });

  it("publishes unresolved when a refine reports an unexpected parent", async () => {
    const fake = bridgeFake({
      handlers: {
        refine: (operation) =>
          ready({
            parentId: "2",
            childIds: ["2.1", "2.2"],
            childCount: operation.operation === "refine" ? operation.statements.length : 0,
          }),
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(cleanGraph)).toEqual({ status: "unresolved" });
  });

  it("publishes unresolved when the claim result does not report the host-fixed root", async () => {
    const fake = bridgeFake({ handlers: { claim: () => ready({ nodeId: "2", role: "prover", claimed: true }) } });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(cleanGraph)).toEqual({ status: "unresolved" });
  });

  it("publishes unresolved when the status read-back reports an unexpected node count", async () => {
    const fake = bridgeFake({
      handlers: {
        status: () =>
          ready({
            statistics: { totalNodes: 4, totalChallenges: 0, openChallenges: 0 },
            jobs: { proverJobs: 0, verifierJobs: 0 },
            nodeCount: 4,
          }),
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(cleanGraph)).toEqual({ status: "unresolved" });
  });

  it("refuses an over-limit conclusion statement without calling the bridge", async () => {
    const graph = requireGraph(
      compileClaimGraph(
        `CONCLUSION: claim-1\nCLAIM: claim-1|deductive|${"x".repeat(AF_FIXTURE_LIMITS.stringLength + 1)}`,
      ),
    );
    const fake = bridgeFake();
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(graph)).toEqual({ status: "unavailable", reason: "oversized" });
    expect(fake.calls).toEqual([]);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.beginReview).not.toHaveBeenCalled();
    expect(fake.teardown).not.toHaveBeenCalled();
  });

  it("refuses an out-of-bounds non-conclusion statement before recording anything", async () => {
    const statement = "x".repeat(AF_FIXTURE_LIMITS.stringLength + 1);
    const graph = requireGraph(
      compileClaimGraph(
        [
          "CONCLUSION: claim-1",
          "CLAIM: claim-1|deductive|A bounded conclusion.",
          `CLAIM: claim-2|deductive|${statement}`,
          "DEPENDS: dependency-1|claim-1|claim-2",
        ].join("\n"),
      ),
    );
    const fake = bridgeFake();
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(graph)).toEqual({ status: "unavailable", reason: "oversized" });
    expect(fake.calls).toEqual([]);
  });

  it("refuses a statement the fixed command schema would reject as a shell token", async () => {
    const graph = requireGraph(
      compileClaimGraph("CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A statement; with a shell token."),
    );
    const fake = bridgeFake();
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(graph)).toEqual({ status: "unavailable", reason: "oversized" });
    expect(fake.calls).toEqual([]);
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("stops at an aborted signal after init and publishes cancelled", async () => {
    const controller = new AbortController();
    const fake = bridgeFake({
      handlers: {
        init: () => {
          controller.abort();
          return ready({ initialized: true });
        },
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(cleanGraph, controller.signal)).toEqual({
      status: "unavailable",
      reason: "cancelled",
    });
    expect(fake.calls.map((call) => call.kind)).toEqual(["beginReview", "init"]);
  });

  it("stops at an aborted signal after a refine chunk and publishes cancelled", async () => {
    const controller = new AbortController();
    const fake = bridgeFake({
      handlers: {
        refine: (operation) => {
          controller.abort();
          return ready({
            parentId: "1",
            childIds: ["1.1", "1.2"],
            childCount: operation.operation === "refine" ? operation.statements.length : 0,
          });
        },
      },
    });
    const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

    expect(await seam.project(chunkGraph, controller.signal)).toEqual({
      status: "unavailable",
      reason: "cancelled",
    });
    expect(fake.calls.map((call) => call.kind)).toEqual(["beginReview", "init", "claim", "refine"]);
  });

  type FailureCase = Readonly<{
    readonly label: string;
    readonly stage: Stage;
    readonly result: unknown;
    readonly expected: Readonly<{ status: string; reason: string }>;
  }>;

  const failureCases: readonly FailureCase[] = [
    {
      label: "cancelled",
      stage: "beginReview",
      result: failure("cancelled"),
      expected: { status: "unavailable", reason: "cancelled" },
    },
    {
      label: "timeout",
      stage: "init",
      result: failure("timeout"),
      expected: { status: "unavailable", reason: "timeout" },
    },
    {
      label: "signaled",
      stage: "init",
      result: failure("signaled"),
      expected: { status: "unavailable", reason: "signaled" },
    },
    {
      label: "oversized",
      stage: "claim",
      result: failure("oversized"),
      expected: { status: "unavailable", reason: "oversized" },
    },
    {
      label: "policy-unavailable",
      stage: "beginReview",
      result: failure("policy-unavailable"),
      expected: { status: "unavailable", reason: "policy" },
    },
    {
      label: "cleanup-failure",
      stage: "beginReview",
      result: failure("cleanup-failure", "audit-failed"),
      expected: { status: "audit_failed", reason: "cleanup" },
    },
    {
      label: "audit-failure",
      stage: "init",
      result: failure("audit-failure", "audit-failed"),
      expected: { status: "audit_failed", reason: "audit" },
    },
    {
      label: "operation-not-ready",
      stage: "init",
      result: failure("operation-not-ready", "ready"),
      expected: { status: "unavailable", reason: "malformed" },
    },
    {
      label: "preflight-failed",
      stage: "beginReview",
      result: failure("preflight-failed"),
      expected: { status: "unavailable", reason: "malformed" },
    },
    {
      label: "runtime-mismatch",
      stage: "beginReview",
      result: failure("runtime-mismatch"),
      expected: { status: "unavailable", reason: "malformed" },
    },
    {
      label: "non-zero",
      stage: "status",
      result: failure("non-zero"),
      expected: { status: "unavailable", reason: "malformed" },
    },
    {
      label: "malformed",
      stage: "claim",
      result: failure("malformed"),
      expected: { status: "unavailable", reason: "malformed" },
    },
    {
      label: "unsupported-platform",
      stage: "beginReview",
      result: failure("unsupported-platform"),
      expected: { status: "unavailable", reason: "malformed" },
    },
    {
      label: "missing-executable",
      stage: "beginReview",
      result: failure("missing-executable"),
      expected: { status: "unavailable", reason: "malformed" },
    },
  ];

  for (const failureCase of failureCases) {
    it(`maps ${failureCase.label} to ${failureCase.expected.status}/${failureCase.expected.reason}`, async () => {
      const fake = bridgeFake({ failAt: failureCase.stage, failure: failureCase.result });
      const seam = createCurrentVibefeldClaimProjectionSeam(fake.runtime);

      expect(await seam.project(cleanGraph)).toEqual(failureCase.expected);
      // The bounded failure ends the sequence immediately.
      expect(fake.calls[fake.calls.length - 1]?.kind).toBe(failureCase.stage);
    });
  }
});
