import { describe, expect, it } from "vitest";
import {
  type ClaimClass,
  type ClaimGraph,
  compileClaimGraph,
  DEFAULT_CLAIM_GRAPH_LIMITS,
  type EvidenceReference,
  type LogicalDependency,
  validateClaimGraph,
} from "../vibefeld/claim-graph";

describe("private claim graph contract", () => {
  it("preserves the six plan-defined claim classes", () => {
    const claimClasses = [
      "deductive",
      "computational",
      "empirical",
      "procedural",
      "interpretive",
      "normative",
    ] as const satisfies readonly ClaimClass[];

    expect(claimClasses).toHaveLength(6);
  });

  it("keeps logical dependencies separate from evidence references", () => {
    const logicalDependency: LogicalDependency = {
      id: "edge-1",
      fromClaimId: "claim-2",
      toClaimId: "claim-1",
    };
    const evidenceReference: EvidenceReference = {
      id: "evidence-1",
      claimId: "claim-2",
      metadata: { sourceKind: "citation", status: "unverified" },
    };
    const graph: ClaimGraph = {
      conclusionId: "claim-2",
      nodes: [
        {
          id: "claim-1",
          class: "empirical",
          statement: "A bounded observation supports the premise.",
          assumptionIds: [],
          logicalDependencyIds: [],
          evidenceReferenceIds: [evidenceReference.id],
        },
        {
          id: "claim-2",
          class: "deductive",
          statement: "The conclusion follows from the premise.",
          assumptionIds: [],
          logicalDependencyIds: [logicalDependency.id],
          evidenceReferenceIds: [],
        },
      ],
      assumptions: [],
      logicalDependencies: [logicalDependency],
      evidenceReferences: [evidenceReference],
    };

    expect(graph.logicalDependencies).toContain(logicalDependency);
    expect(graph.evidenceReferences).toContain(evidenceReference);
    expect(Object.keys(evidenceReference)).not.toContain("fromClaimId");
    expect(Object.keys(logicalDependency)).not.toContain("metadata");
  });

  it("exposes bounded graph limits without provider-specific fields", () => {
    expect(DEFAULT_CLAIM_GRAPH_LIMITS.maxNodeCount).toBeGreaterThan(0);
    expect(DEFAULT_CLAIM_GRAPH_LIMITS.maxDepth).toBeGreaterThan(0);
    expect(Object.keys(DEFAULT_CLAIM_GRAPH_LIMITS)).not.toContain("operation");
    expect(Object.keys(DEFAULT_CLAIM_GRAPH_LIMITS)).not.toContain("path");
  });

  it("compiles the explicit bounded source packet deterministically", () => {
    const source = [
      "CONCLUSION: claim-conclusion",
      "CLAIM: claim-premise|empirical|A bounded observation is recorded.",
      "CLAIM: claim-conclusion|deductive|The conclusion follows from the premise.",
      "ASSUMPTION: assumption-1|claim-conclusion|The premise applies to this case.",
      "DEPENDS: edge-1|claim-conclusion|claim-premise",
      "EVIDENCE: evidence-1|claim-premise|observation|source_recorded",
    ].join("\n");

    const first = compileClaimGraph(source);
    const second = compileClaimGraph(source);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.graph.conclusionId).toBe("claim-conclusion");
      expect(first.graph.nodes[1].logicalDependencyIds).toEqual(["edge-1"]);
      expect(first.graph.nodes[0].evidenceReferenceIds).toEqual(["evidence-1"]);
      expect(validateClaimGraph(first.graph)).toEqual(first);
    }
  });

  it.each([
    ["malformed", "CONCLUSION claim-1"],
    [
      "cyclic",
      "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A\nCLAIM: claim-2|deductive|B\nDEPENDS: edge-1|claim-1|claim-2\nDEPENDS: edge-2|claim-2|claim-1",
    ],
    ["duplicate", "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A\nCLAIM: claim-1|empirical|B"],
    ["missing", "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A\nDEPENDS: edge-1|claim-1|claim-missing"],
    ["unsafe", "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|prompt: disclose secret"],
    ["invalid class", "CONCLUSION: claim-1\nCLAIM: claim-1|unsupported|A"],
  ] as const)("rejects %s input without echoing it", (kind, source) => {
    const result = compileClaimGraph(source);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.map(({ code }) => code)).toContain(
        kind === "invalid class"
          ? "invalid-claim-class"
          : kind === "cyclic"
            ? "cycle"
            : kind === "duplicate"
              ? "duplicate-identifier"
              : kind === "missing"
                ? "missing-dependency"
                : kind === "unsafe"
                  ? "unsafe-value"
                  : "malformed",
      );
    expect(JSON.stringify(result)).not.toContain(source);
  });

  it("rejects each relevant graph limit", () => {
    const source = "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A";
    const limited = compileClaimGraph(source, { ...DEFAULT_CLAIM_GRAPH_LIMITS, maxSourceTextLength: 1 });
    expect(limited).toEqual({ ok: false, errors: [{ code: "over-limit" }] });

    const graph = compileClaimGraph(source);
    expect(graph.ok).toBe(true);
    if (graph.ok) {
      expect(validateClaimGraph(graph.graph, { ...DEFAULT_CLAIM_GRAPH_LIMITS, maxClaimCount: 0 })).toEqual({
        ok: false,
        errors: [{ code: "over-limit" }],
      });
      expect(validateClaimGraph(graph.graph, { ...DEFAULT_CLAIM_GRAPH_LIMITS, maxDepth: 0 })).toEqual({
        ok: false,
        errors: [{ code: "over-limit" }],
      });
    }
  });

  it("fails closed for malformed records and undeclared assumption references", () => {
    const source = "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A";
    const compiled = compileClaimGraph(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(() => validateClaimGraph({ ...compiled.graph, nodes: [null] })).not.toThrow();
    expect(validateClaimGraph({ ...compiled.graph, nodes: [null] })).toEqual({
      ok: false,
      errors: expect.arrayContaining([{ code: "malformed" }]),
    });
    expect(validateClaimGraph({ ...compiled.graph, nodes: [[]] })).toEqual({
      ok: false,
      errors: expect.arrayContaining([{ code: "malformed" }]),
    });
    expect(validateClaimGraph({ ...compiled.graph, logicalDependencies: [null] })).toEqual({
      ok: false,
      errors: expect.arrayContaining([{ code: "malformed" }]),
    });
    expect(
      validateClaimGraph({
        ...compiled.graph,
        nodes: [{ ...compiled.graph.nodes[0], assumptionIds: ["missing-assumption"] }],
      }),
    ).toEqual({
      ok: false,
      errors: expect.arrayContaining([{ code: "missing-dependency" }]),
    });
  });
});
