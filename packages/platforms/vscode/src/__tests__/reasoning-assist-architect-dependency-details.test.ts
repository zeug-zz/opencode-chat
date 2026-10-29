import { describe, expect, it, vi } from "vitest";

vi.mock("../vibefeld/claim-graph", async () => {
  const actual = await vi.importActual<typeof import("../vibefeld/claim-graph")>("../vibefeld/claim-graph");
  return {
    ...actual,
    validateClaimGraph: vi.fn(() => ({ ok: false as const, errors: [{ code: "missing-dependency" as const }] })),
  };
});

import { parseArchitectResultWithDetails } from "../vibefeld/reasoning-assist-architect";

describe("architect dependency diagnostic fallback", () => {
  it("uses dependency-other when the parsed graph has no recognized dependency failure", () => {
    const sentinel = "UNIQUE_OTHER_DEPENDENCY_SENTINEL";
    const details = parseArchitectResultWithDetails(
      JSON.stringify({
        kind: "argument",
        conclusionId: "claim-a",
        claims: [{ id: "claim-a", class: "deductive", statement: `${sentinel} statement`, dependsOn: [] }],
        assumptions: [],
        evidenceNeeds: [],
        uncertainty: [],
      }),
    );

    expect(details.result).toEqual({ kind: "no-assist", reason: "missing-dependency" });
    expect(details.dependencySubreason).toBe("dependency-other");
    expect(JSON.stringify(details)).not.toContain(sentinel);
  });
});
