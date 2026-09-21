import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileClaimGraph } from "../vibefeld/claim-graph";
import { createFixtureOnlyClaimProjectionSeam } from "../vibefeld/fixture-claim-projection-seam";

const graph = compileClaimGraph("CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.");

function validGraph() {
  if (!graph.ok) throw new Error("test graph must be valid");
  return graph.graph;
}

function declaration(outcome: unknown): Record<string, unknown> {
  return { fixtureId: "claim-fixture", fixtureVersion: "v1", claimCapability: true, outcome };
}

describe("test-only fixture claim projection seam", () => {
  it.each([
    { status: "structurally_checked" },
    { status: "conditional" },
    { status: "unresolved" },
    { status: "refuted" },
    { status: "unavailable", reason: "unsupported" },
    { status: "audit_failed", reason: "audit" },
  ] as const)("uses only the explicitly declared normalized $status outcome", async (outcome) => {
    const seam = createFixtureOnlyClaimProjectionSeam(declaration(outcome));

    expect(seam.getCapability()).toEqual({ supported: true, operation: "claim_projection" });
    expect(await seam.project(validGraph())).toEqual(outcome);
  });

  it.each([
    {},
    { fixtureId: "claim-fixture", fixtureVersion: "v1", outcome: { status: "structurally_checked" } },
    { ...declaration({ status: "structurally_checked" }), claimCapability: false },
    { ...declaration({ status: "structurally_checked" }), claimCapability: "claim_projection" },
    { ...declaration({ status: "structurally_checked" }), structuralStatus: null },
    { ...declaration({ status: "structurally_checked" }), version: "0.1.7" },
    { ...declaration({ status: "structurally_checked" }), status: "ready" },
    { ...declaration({ status: "structurally_checked" }), result: { arbitrary: true } },
  ])("returns unsupported when capability is absent, inferred, or unsanitized", async (fixture) => {
    const seam = createFixtureOnlyClaimProjectionSeam(fixture);

    expect(seam.getCapability()).toEqual({ supported: false });
    expect(await seam.project(validGraph())).toEqual({ status: "unavailable", reason: "unsupported" });
  });

  it("rejects unknown, raw, and unbounded fixture fields without echoing them", async () => {
    const raw = "secret ledger /private/workspace --prompt";
    const seam = createFixtureOnlyClaimProjectionSeam({
      ...declaration({ status: "structurally_checked" }),
      argv: [raw],
      rawJson: raw.repeat(10_000),
    });

    expect(seam.getCapability()).toEqual({ supported: false });
    const result = await seam.project(validGraph());
    expect(result).toEqual({ status: "unavailable", reason: "unsupported" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    { ...declaration({ status: "not-a-status" }), outcome: { status: "not-a-status" } },
    { ...declaration({ status: "structurally_checked" }), outcome: { status: "structurally_checked", output: "raw" } },
    {
      ...declaration({ status: "structurally_checked" }),
      fixtureVersion: "v".repeat(65),
    },
  ])("keeps malformed or oversized fixture output unsupported", async (fixture) => {
    const seam = createFixtureOnlyClaimProjectionSeam(fixture);

    expect(seam.getCapability()).toEqual({ supported: false });
    expect(await seam.project(validGraph())).toEqual({ status: "unavailable", reason: "unsupported" });
  });

  it("keeps the fixture adapter dormant and out of activation", () => {
    const fixtureSource = readFileSync(
      new URL("../vibefeld/fixture-claim-projection-seam.ts", import.meta.url),
      "utf8",
    );
    const extensionSource = readFileSync(new URL("../extension.ts", import.meta.url), "utf8");

    expect(fixtureSource).toContain("TEST-ONLY");
    expect(fixtureSource).not.toMatch(/(?:node:|child_process|spawn\(|fetch\(|writeFile\()/u);
    expect(extensionSource).not.toContain("fixture-claim-projection-seam");
    expect(extensionSource).not.toContain("createFixtureOnlyClaimProjectionSeam");
  });
});
