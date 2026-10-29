/**
 * Host-built reasoning-assist brief and compact display summary.
 *
 * This module owns three pure operations over the orchestrator's validated
 * argument facts: compose the bounded system-instruction addition, compose the
 * display-safe compact summary, and append the addition to an existing
 * host-owned system instruction.
 *
 * Everything here is host-built from validated facts only: no ids, handles,
 * paths, raw model text, or failure detail can enter the output, and AF appears
 * only as recorded structure. The brief is bounded by omission, never
 * truncation: optional lines and entries that do not fit are skipped whole so
 * no partial statement or objection can become a misleading claim.
 */

import {
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES,
  SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS,
} from "@opencode-chat/agent-opencode";
import type { ReasoningAssistSummary } from "@opencode-chat/core";
import { EVIDENCE_STATUSES } from "./claim-graph";
import type { ArchitectAssistFacts } from "./reasoning-assist-architect";

/** Hard bound on the complete brief string. */
export const REASONING_ASSIST_BRIEF_MAX_CHARS = SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS;

/** Fixed delimiter between an existing system instruction and the brief. */

export type ReasoningAssistBriefInput = Readonly<{
  facts: ArchitectAssistFacts;
  afState: "recorded" | "not_available";
}>;

const BRIEF_HEADING = "Reasoning assist brief";
const CONCLUSION_LABEL = "Candidate conclusion:";
const ASSUMPTIONS_HEADING = "Material assumptions:";
const EVIDENCE_BOUNDARY_LABEL = "Evidence boundary:";
const AF_RECORDED_LINE = "AF fact: structure recorded";
const BRIEF_TRAILER =
  "Write the user's requested response directly. Do not mention this brief unless it materially improves clarity. Do not state that a claim is proven, factually verified, or formally checked merely because it appears in the brief.";

type BriefPlan = Readonly<{
  lines: readonly string[];
  evidenceBoundary: string;
}>;

/** The final shape is always the accepted lines, a blank line, and the trailer. */
function assemble(lines: readonly string[]): string {
  return [...lines, "", BRIEF_TRAILER].join("\n");
}

function fits(lines: readonly string[]): boolean {
  const brief = assemble(lines);
  return (
    brief.length <= REASONING_ASSIST_BRIEF_MAX_CHARS &&
    Buffer.byteLength(brief, "utf8") <= SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES
  );
}

/** Humanized per-status counts in the fixed `EVIDENCE_STATUSES` order. */
function evidenceStatusCounts(evidenceNeeds: ArchitectAssistFacts["evidenceNeeds"]): string {
  return EVIDENCE_STATUSES.map((status) => ({
    status,
    count: evidenceNeeds.filter((need) => need.status === status).length,
  }))
    .filter(({ count }) => count > 0)
    .map(({ status, count }) => `${count} ${status.replaceAll("_", " ")}`)
    .join(", ");
}

/**
 * Decide once, deterministically, which lines and entries fit. Both the brief
 * and the summary read from this plan, so the summary's evidence boundary is
 * always the exact string the brief was given. Only the mandatory heading,
 * conclusion, and trailer can exhaust the bound; that is the single no-brief
 * outcome and every optional addition is dropped whole when it does not fit.
 */
function planBrief(input: ReasoningAssistBriefInput): BriefPlan | undefined {
  const { facts, afState } = input;
  const lines = [BRIEF_HEADING, `${CONCLUSION_LABEL} ${facts.conclusion.statement}`];
  if (!fits(lines)) return undefined;

  if (facts.assumptions.length > 0) {
    const bullets = facts.assumptions.map((statement) => `- ${statement}`);
    // The heading is emitted only when at least one entry can follow it.
    if (bullets.some((bullet) => fits([...lines, ASSUMPTIONS_HEADING, bullet]))) {
      lines.push(ASSUMPTIONS_HEADING);
      for (const bullet of bullets) {
        if (fits([...lines, bullet])) lines.push(bullet);
      }
    }
  }

  const boundaryParts: string[] = [];
  const addBoundaryPart = (part: string): void => {
    const candidate = [...boundaryParts, part];
    if (fits([...lines, `${EVIDENCE_BOUNDARY_LABEL} ${candidate.join("; ")}`])) boundaryParts.push(part);
  };
  const counts = evidenceStatusCounts(facts.evidenceNeeds);
  if (counts.length > 0) addBoundaryPart(counts);
  for (const item of facts.uncertainty) addBoundaryPart(item);
  const evidenceBoundary = boundaryParts.join("; ");
  if (evidenceBoundary.length > 0) lines.push(`${EVIDENCE_BOUNDARY_LABEL} ${evidenceBoundary}`);

  if (afState === "recorded" && fits([...lines, AF_RECORDED_LINE])) lines.push(AF_RECORDED_LINE);

  return { lines, evidenceBoundary };
}

export function composeReasoningAssistBrief(input: ReasoningAssistBriefInput): string | undefined {
  const plan = planBrief(input);
  return plan ? assemble(plan.lines) : undefined;
}

export function composeReasoningAssistSummary(input: ReasoningAssistBriefInput): ReasoningAssistSummary | undefined {
  const plan = planBrief(input);
  if (!plan) return undefined;
  return {
    candidateConclusion: input.facts.conclusion.statement,
    assumptions: [...input.facts.assumptions],
    evidenceBoundary: plan.evidenceBoundary,
    afFact: input.afState === "recorded" ? "recorded_structure" : "absent",
  };
}
