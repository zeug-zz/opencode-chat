import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAIM_CLASSES, EVIDENCE_SOURCE_KINDS, EVIDENCE_STATUSES } from "../vibefeld/claim-graph";
import { CRITIC_OBJECTION_SEVERITIES } from "../vibefeld/reasoning-assist-critic";

const overlaySource = readFileSync(
  new URL("../../../../agents/opencode/src/restricted-review-overlay.ts", import.meta.url),
  "utf8",
);

/**
 * Extract one stage-instruction constant so parity is pinned to the exact
 * instruction text the hidden stages receive, not to unrelated overlay source.
 */
const instructionConstant = (name: string): string => {
  const match = overlaySource.match(new RegExp(`const ${name}\\s*=\\s*'([^']*)';`));
  const value = match?.[1];
  if (value === undefined) throw new Error(`Missing or malformed ${name} in restricted-review-overlay.ts.`);
  return value;
};

const architectInstruction = instructionConstant("RESTRICTED_REVIEW_ARCHITECT_STAGE_INSTRUCTION");
const criticInstruction = instructionConstant("RESTRICTED_REVIEW_CRITIC_STAGE_INSTRUCTION");

describe("restricted review instruction enum parity", () => {
  it("enumerates every claim class the architect schema validates", () => {
    for (const claimClass of CLAIM_CLASSES) expect(architectInstruction).toContain(`"${claimClass}"`);
  });

  it("enumerates every evidence source kind the architect schema validates", () => {
    for (const sourceKind of EVIDENCE_SOURCE_KINDS) expect(architectInstruction).toContain(`"${sourceKind}"`);
  });

  it("enumerates every evidence status the architect schema validates", () => {
    for (const status of EVIDENCE_STATUSES) expect(architectInstruction).toContain(`"${status}"`);
  });

  it("enumerates every objection severity the critic schema validates", () => {
    for (const severity of CRITIC_OBJECTION_SEVERITIES) expect(criticInstruction).toContain(`"${severity}"`);
  });

  it("replaces every enum placeholder with its enumerated values", () => {
    for (const placeholder of ["bounded claim class", "bounded source kind", "bounded status"]) {
      expect(architectInstruction).not.toContain(placeholder);
    }
    expect(criticInstruction).not.toContain("bounded severity");
  });
});
