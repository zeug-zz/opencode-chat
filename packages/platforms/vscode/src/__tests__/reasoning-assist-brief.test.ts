/**
 * Focused tests for the host-built reasoning-assist brief and summary.
 *
 * The brief is a security-relevant prompt bound: these tests pin the exact
 * template, the omission-not-truncation bound, the deterministic evidence
 * boundary derivation, and the absence of ids, handles, raw statuses, raw
 * model text, or verification language outside the fixed trailer.
 */
import { describe, expect, it } from "vitest";
import {
  appendReasoningAssistBrief,
  composeReasoningAssistBrief,
  composeReasoningAssistSummary,
  REASONING_ASSIST_BRIEF_DELIMITER,
  REASONING_ASSIST_BRIEF_MAX_CHARS,
  type ReasoningAssistBriefInput,
} from "../vibefeld/reasoning-assist-brief";

const TRAILER =
  "Write the user's requested response directly. Do not mention this brief unless it materially improves clarity. Do not state that a claim is proven, factually verified, or formally checked merely because it appears in the brief.";

const OBJECTION_ASSUMPTION = {
  target: { kind: "assumption" as const, id: "assumption-1" },
  severity: "material" as const,
  objection: "The premise applies only to a narrower case.",
};

const OBJECTION_CONCLUSION = {
  target: { kind: "candidate_conclusion" as const, id: "claim-conclusion" },
  severity: "minor" as const,
  objection: "The conclusion needs an explicit qualifier.",
};

type InputOverrides = {
  facts?: ReasoningAssistBriefInput["facts"];
  afState?: ReasoningAssistBriefInput["afState"];
  objections?: ReasoningAssistBriefInput["objections"];
};

function makeInput(overrides: InputOverrides = {}): ReasoningAssistBriefInput {
  return {
    facts: {
      conclusion: { class: "deductive", statement: "The conclusion follows from the recorded premise." },
      assumptions: ["The premise applies to this case.", "No other premise changes the result."],
      evidenceNeeds: [
        { sourceKind: "observation", status: "source_recorded" },
        { sourceKind: "citation", status: "unverified" },
        { sourceKind: "calculation", status: "unverified" },
      ],
      uncertainty: ["The observation is bounded to one case.", "The calculation assumes constant rates."],
    },
    afState: "recorded",
    objections: [OBJECTION_ASSUMPTION, OBJECTION_CONCLUSION],
    ...overrides,
  };
}

const EXPECTED_BOUNDARY =
  "1 source recorded, 2 unverified; The observation is bounded to one case.; The calculation assumes constant rates.";

describe("composeReasoningAssistBrief", () => {
  it("composes the complete fixed template from validated facts", () => {
    const brief = composeReasoningAssistBrief(makeInput());

    expect(brief).toBe(
      [
        "Reasoning assist brief",
        "Candidate conclusion: The conclusion follows from the recorded premise.",
        "Material assumptions:",
        "- The premise applies to this case.",
        "- No other premise changes the result.",
        `Evidence boundary: ${EXPECTED_BOUNDARY}`,
        "Independent objections to address or qualify:",
        "- The premise applies only to a narrower case.",
        "- The conclusion needs an explicit qualifier.",
        "AF fact: structure recorded",
        "",
        TRAILER,
      ].join("\n"),
    );
    // The blank line and the fixed trailer always close the brief verbatim.
    expect(brief?.endsWith(`\n\n${TRAILER}`)).toBe(true);
  });

  it("omits the AF line entirely when structure is not recorded", () => {
    const brief = composeReasoningAssistBrief(makeInput({ afState: "not_available" }));

    expect(brief).toBeDefined();
    expect(brief).not.toContain("AF fact:");
    expect(brief).not.toContain("not available");
    expect(brief).not.toContain("recorded structure");
    expect(brief?.endsWith(`\n\n${TRAILER}`)).toBe(true);
  });

  it("describes recorded AF only as recorded structure", () => {
    const brief = composeReasoningAssistBrief(makeInput());
    const afLine = brief?.split("\n").find((line) => line.startsWith("AF fact:"));

    expect(afLine).toBe("AF fact: structure recorded");
  });

  it("derives the evidence boundary from status counts in fixed order", () => {
    const brief = composeReasoningAssistBrief(
      makeInput({
        facts: {
          conclusion: { class: "deductive", statement: "The conclusion follows." },
          assumptions: [],
          evidenceNeeds: [
            { sourceKind: "citation", status: "conflicted" },
            { sourceKind: "human", status: "human_verified" },
            { sourceKind: "procedure", status: "not_required" },
            { sourceKind: "observation", status: "source_recorded" },
            { sourceKind: "calculation", status: "unverified" },
            { sourceKind: "citation", status: "conflicted" },
          ],
          uncertainty: [],
        },
        objections: [],
      }),
    );

    // Fixed `EVIDENCE_STATUSES` order: not_required, source_recorded,
    // unverified, human_verified, conflicted.
    expect(brief).toContain(
      "Evidence boundary: 1 not required, 1 source recorded, 1 unverified, 1 human verified, 2 conflicted",
    );
    expect(brief).not.toContain("Material assumptions:");
    expect(brief).not.toContain("Independent objections");
  });

  it("joins uncertainty items with a semicolon and omits an empty boundary", () => {
    const withUncertainty = composeReasoningAssistBrief(
      makeInput({
        facts: {
          conclusion: { class: "interpretive", statement: "The reading holds for this text." },
          assumptions: [],
          evidenceNeeds: [],
          uncertainty: ["First uncertainty.", "Second uncertainty."],
        },
        objections: [],
      }),
    );
    expect(withUncertainty).toContain("Evidence boundary: First uncertainty.; Second uncertainty.");

    const emptyBoundary = composeReasoningAssistBrief(
      makeInput({
        facts: {
          conclusion: { class: "interpretive", statement: "The reading holds for this text." },
          assumptions: [],
          evidenceNeeds: [],
          uncertainty: [],
        },
        objections: [],
      }),
    );
    expect(emptyBoundary).not.toContain("Evidence boundary:");
  });

  it("bounds by omission and never truncates a statement, uncertainty item, or objection", () => {
    const conclusion = `The conclusion rests on a bounded chain: ${"c".repeat(430)}`;
    const assumptions = Array.from({ length: 8 }, (_, index) => `Premise ${index + 1}: ${"a".repeat(490)}`);
    const uncertainty = Array.from({ length: 5 }, (_, index) => `Uncertainty item ${index + 1}: ${"u".repeat(230)}`);
    const objections = [
      {
        target: { kind: "assumption" as const, id: "assumption-1" },
        severity: "material" as const,
        objection: `Objection one: ${"o".repeat(490)}`,
      },
      {
        target: { kind: "candidate_conclusion" as const, id: "claim-conclusion" },
        severity: "minor" as const,
        objection: `Objection two: ${"p".repeat(490)}`,
      },
    ];
    const brief = composeReasoningAssistBrief(
      makeInput({
        facts: {
          conclusion: { class: "deductive", statement: conclusion },
          assumptions,
          evidenceNeeds: [{ sourceKind: "observation", status: "source_recorded" }],
          uncertainty,
        },
        objections,
      }),
    );

    expect(brief).toBeDefined();
    const composed = brief ?? "";
    expect(composed.length).toBeLessThanOrEqual(REASONING_ASSIST_BRIEF_MAX_CHARS);
    expect(composed.includes(conclusion)).toBe(true);

    // Every entry is either present whole or absent entirely.
    for (const entry of [...assumptions, ...uncertainty, ...objections.map(({ objection }) => objection)]) {
      const included = composed.includes(entry);
      expect(included || !composed.includes(entry.slice(0, 48))).toBe(true);
    }

    // The fixture is large enough that both outcomes actually occur.
    expect(assumptions.some((statement) => composed.includes(statement))).toBe(true);
    expect(assumptions.some((statement) => !composed.includes(statement))).toBe(true);
    expect(uncertainty.some((item) => !composed.includes(item))).toBe(true);
    expect(objections.every(({ objection }) => !composed.includes(objection))).toBe(true);
  });

  it("returns no brief when only the mandatory content exceeds the bound", () => {
    const brief = composeReasoningAssistBrief(
      makeInput({
        facts: {
          conclusion: {
            class: "deductive",
            statement: `Overlong conclusion: ${"x".repeat(REASONING_ASSIST_BRIEF_MAX_CHARS)}`,
          },
          assumptions: ["This assumption must never be reached."],
          evidenceNeeds: [],
          uncertainty: [],
        },
      }),
    );

    expect(brief).toBeUndefined();
  });
});

describe("composeReasoningAssistSummary", () => {
  it("maps validated facts and objection target kinds into the compact summary", () => {
    const summary = composeReasoningAssistSummary(makeInput());

    expect(summary).toEqual({
      candidateConclusion: "The conclusion follows from the recorded premise.",
      assumptions: ["The premise applies to this case.", "No other premise changes the result."],
      evidenceBoundary: EXPECTED_BOUNDARY,
      criticObjections: [
        { target: "assumption", objection: "The premise applies only to a narrower case." },
        { target: "candidate_conclusion", objection: "The conclusion needs an explicit qualifier." },
      ],
      afFact: "recorded_structure",
    });
  });

  it("reports the evidence boundary exactly as the brief was given it", () => {
    const input = makeInput();
    const brief = composeReasoningAssistBrief(input);
    const summary = composeReasoningAssistSummary(input);

    expect(brief).toContain(`Evidence boundary: ${summary?.evidenceBoundary}`);
  });

  it("keeps zero, one, and two objections as exact tuple lengths", () => {
    const none = composeReasoningAssistSummary(makeInput({ objections: [] }));
    expect(none?.criticObjections).toHaveLength(0);
    expect(none?.criticObjections).toEqual([]);

    const one = composeReasoningAssistSummary(makeInput({ objections: [OBJECTION_ASSUMPTION] }));
    expect(one?.criticObjections).toHaveLength(1);
    expect(one?.criticObjections).toEqual([
      { target: "assumption", objection: "The premise applies only to a narrower case." },
    ]);

    const two = composeReasoningAssistSummary(makeInput({ objections: [OBJECTION_ASSUMPTION, OBJECTION_CONCLUSION] }));
    expect(two?.criticObjections).toHaveLength(2);
    expect(two?.criticObjections).toEqual([
      { target: "assumption", objection: "The premise applies only to a narrower case." },
      { target: "candidate_conclusion", objection: "The conclusion needs an explicit qualifier." },
    ]);

    // More than two validated objections are still bounded by the core tuple.
    const three = composeReasoningAssistSummary(
      makeInput({ objections: [OBJECTION_ASSUMPTION, OBJECTION_CONCLUSION, OBJECTION_ASSUMPTION] }),
    );
    expect(three?.criticObjections).toHaveLength(2);
  });

  it("reports the AF fact as absent unless structure was recorded", () => {
    expect(composeReasoningAssistSummary(makeInput({ afState: "recorded" }))?.afFact).toBe("recorded_structure");
    expect(composeReasoningAssistSummary(makeInput({ afState: "not_available" }))?.afFact).toBe("absent");
  });

  it("returns no summary exactly when no brief exists", () => {
    const input = makeInput({
      facts: {
        conclusion: {
          class: "deductive",
          statement: `Overlong conclusion: ${"x".repeat(REASONING_ASSIST_BRIEF_MAX_CHARS)}`,
        },
        assumptions: ["This assumption must never be reached."],
        evidenceNeeds: [],
        uncertainty: [],
      },
    });

    expect(composeReasoningAssistBrief(input)).toBeUndefined();
    expect(composeReasoningAssistSummary(input)).toBeUndefined();
  });
});

describe("appendReasoningAssistBrief", () => {
  it("uses the brief alone when the base system instruction is undefined or empty", () => {
    const brief = composeReasoningAssistBrief(makeInput()) ?? "";

    expect(appendReasoningAssistBrief(undefined, brief)).toBe(brief);
    expect(appendReasoningAssistBrief("", brief)).toBe(brief);
  });

  it("appends the brief to an existing base with the fixed delimiter", () => {
    const brief = composeReasoningAssistBrief(makeInput()) ?? "";

    expect(appendReasoningAssistBrief("chat prompt", brief)).toBe(
      `chat prompt${REASONING_ASSIST_BRIEF_DELIMITER}${brief}`,
    );
    expect(appendReasoningAssistBrief("chat prompt", brief).startsWith("chat prompt")).toBe(true);
  });
});

describe("reasoning-assist brief and summary safety", () => {
  // Word boundaries keep the humanized `unverified` status count from reading
  // as a standalone verification claim.
  const FORBIDDEN_LANGUAGE = [
    /\bproven\b/,
    /\bverified\b/,
    /formally checked/,
    /structurally checked/,
    /structurally_checked/,
    /\bproved\b/,
  ];
  const FORBIDDEN_CONTENT = [
    "claim-conclusion",
    "claim-premise",
    "assumption-1",
    "handle",
    "identity",
    "sourcekind",
    "source_recorded",
    "human_verified",
    "not_required",
  ];

  it("never uses verification language outside the fixed trailer", () => {
    const brief = composeReasoningAssistBrief(makeInput()) ?? "";
    const summaryText = JSON.stringify(composeReasoningAssistSummary(makeInput()));

    expect(brief.endsWith(`\n\n${TRAILER}`)).toBe(true);
    const dynamic = brief.slice(0, brief.length - TRAILER.length);
    for (const pattern of FORBIDDEN_LANGUAGE) {
      expect(dynamic).not.toMatch(pattern);
      expect(summaryText).not.toMatch(pattern);
    }
  });

  it("never carries ids, handles, provenance identities, source kinds, or raw statuses", () => {
    const input = makeInput({
      facts: {
        conclusion: { class: "empirical", statement: "The bounded observation supports the candidate conclusion." },
        assumptions: ["The sampled scope covers the case."],
        evidenceNeeds: [
          { sourceKind: "citation", status: "source_recorded" },
          { sourceKind: "human", status: "human_verified" },
          { sourceKind: "procedure", status: "not_required" },
        ],
        uncertainty: ["The scope remains bounded."],
      },
    });
    const brief = composeReasoningAssistBrief(input) ?? "";
    const summaryText = JSON.stringify(composeReasoningAssistSummary(input));

    for (const value of FORBIDDEN_CONTENT) {
      expect(brief.toLowerCase()).not.toContain(value);
      expect(summaryText.toLowerCase()).not.toContain(value);
    }
    // The humanized forms are the only status representation that may appear.
    expect(brief).toContain("1 not required, 1 source recorded, 1 human verified");
  });
});
