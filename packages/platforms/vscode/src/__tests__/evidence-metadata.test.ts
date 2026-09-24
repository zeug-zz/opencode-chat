import { describe, expect, it } from "vitest";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import { assessClaimGraphEvidence, normalizeEvidenceReferences } from "../vibefeld/evidence-metadata";

const reference = (id: string, claimId: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  claimId,
  metadata: { sourceKind: "citation", status, ...extra },
});

describe("private evidence metadata normalization", () => {
  it.each(["not_required", "source_recorded", "unverified", "human_verified", "conflicted"])(
    "preserves %s",
    (status) => {
      const result = normalizeEvidenceReferences([reference("evidence-1", "claim-1", status)]);
      expect(result).toEqual({
        ok: true,
        assessment: {
          references: [expect.objectContaining({ metadata: { sourceKind: "citation", status } })],
          claims: { "claim-1": status },
          status,
        },
      });
    },
  );

  it("aggregates conflicting evidence without upgrading it", () => {
    const result = normalizeEvidenceReferences([
      reference("evidence-1", "claim-1", "source_recorded", { conflictGroup: "sources-1" }),
      reference("evidence-2", "claim-1", "human_verified", { conflictGroup: "sources-1" }),
    ]);
    expect(result).toEqual({
      ok: true,
      assessment: {
        references: expect.any(Array),
        claims: { "claim-1": "conflicted" },
        status: "conflicted",
      },
    });
  });

  it("keeps evidence references separate from logical dependencies", () => {
    const compiled = compileClaimGraph(
      [
        "CONCLUSION: claim-2",
        "CLAIM: claim-1|empirical|An observation is recorded.",
        "CLAIM: claim-2|deductive|The conclusion follows.",
        "DEPENDS: edge-1|claim-2|claim-1",
        "EVIDENCE: evidence-1|claim-1|observation|unverified",
      ].join("\n"),
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const result = assessClaimGraphEvidence(compiled.graph);
    expect(result.ok).toBe(true);
    expect(compiled.graph.logicalDependencies).toEqual([
      { id: "edge-1", fromClaimId: "claim-2", toClaimId: "claim-1" },
    ]);
    expect(JSON.stringify(result)).not.toContain("fromClaimId");
  });

  it.each([
    ["malformed", [reference("evidence-1", "claim-1", "unknown")]],
    ["unsafe-value", [reference("evidence-1", "claim-1", "unverified", { conflictGroup: "prompt" })]],
    ["malformed", [reference("evidence-1", "claim-1", "unverified", { excerpt: "private reasoning" })]],
  ] as const)("rejects %s metadata without echoing input", (code, input) => {
    const result = normalizeEvidenceReferences(input);
    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(input));
  });

  it("rejects duplicate and over-limit references", () => {
    expect(
      normalizeEvidenceReferences([
        reference("same", "claim-1", "unverified"),
        reference("same", "claim-1", "unverified"),
      ]),
    ).toEqual({
      ok: false,
      code: "duplicate-identifier",
    });
    expect(
      normalizeEvidenceReferences(
        Array.from({ length: 129 }, (_, index) => reference(`evidence-${index}`, "claim-1", "unverified")),
      ),
    ).toEqual({
      ok: false,
      code: "over-limit",
    });
  });

  it("does not retain source excerpts, URLs, or provider fields", () => {
    const result = normalizeEvidenceReferences([
      reference("evidence-1", "claim-1", "source_recorded", {
        conflictGroup: "group-1",
        excerpt: "should be rejected",
        url: "https://example.test/source",
        rawProviderOutput: "secret",
      }),
    ]);
    expect(result).toEqual({ ok: false, code: "malformed" });
    expect(JSON.stringify(result)).not.toMatch(/excerpt|url|rawProviderOutput|secret/);
  });
});
