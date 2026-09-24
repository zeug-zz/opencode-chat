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

import type {
  ReasoningAssistCriticObjection,
  ReasoningAssistCriticObjections,
  ReasoningAssistSummary,
} from "@opencode-chat/core";
import { EVIDENCE_STATUSES } from "./claim-graph";
import type { ArchitectAssistFacts } from "./reasoning-assist-architect";
import type { CriticObjection } from "./reasoning-assist-critic";

/** Hard bound on the complete brief string. */
export const REASONING_ASSIST_BRIEF_MAX_CHARS = 4_096;

/** Fixed delimiter between an existing system instruction and the brief. */
export const REASONING_ASSIST_BRIEF_DELIMITER = "\n\n";

export type ReasoningAssistBriefInput = Readonly<{
  facts: ArchitectAssistFacts;
  afState: "recorded" | "not_available";
  objections: readonly CriticObjection[];
}>;

const BRIEF_HEADING = "Reasoning assist brief";
const CONCLUSION_LABEL = "Candidate conclusion:";
const ASSUMPTIONS_HEADING = "Material assumptions:";
const EVIDENCE_BOUNDARY_LABEL = "Evidence boundary:";
const OBJECTIONS_HEADING = "Independent objections to address or qualify:";
const AF_RECORDED_LINE = "AF fact: structure recorded";
const BRIEF_TRAILER =
  "Write the user's requested response directly. Do not mention this brief unless it materially improves clarity. Do not state that a claim is proven, factually verified, or formally checked merely because it appears in the brief.";
const MAX_CRITIC_OBJECTIONS = 2;

type BriefPlan = Readonly<{
  lines: readonly string[];
  evidenceBoundary: string;
  objections: readonly CriticObjection[];
}>;

/** The final shape is always the accepted lines, a blank line, and the trailer. */
function assemble(lines: readonly string[]): string {
  return [...lines, "", BRIEF_TRAILER].join("\n");
}

function fits(lines: readonly string[]): boolean {
  return assemble(lines).length <= REASONING_ASSIST_BRIEF_MAX_CHARS;
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

  const objections = input.objections.slice(0, MAX_CRITIC_OBJECTIONS);
  const objectionBullets = objections.map(({ objection }) => `- ${objection}`);
  if (objectionBullets.some((bullet) => fits([...lines, OBJECTIONS_HEADING, bullet]))) {
    lines.push(OBJECTIONS_HEADING);
    for (const bullet of objectionBullets) {
      if (fits([...lines, bullet])) lines.push(bullet);
    }
  }

  if (afState === "recorded" && fits([...lines, AF_RECORDED_LINE])) lines.push(AF_RECORDED_LINE);

  return { lines, evidenceBoundary, objections };
}

export function composeReasoningAssistBrief(input: ReasoningAssistBriefInput): string | undefined {
  const plan = planBrief(input);
  return plan ? assemble(plan.lines) : undefined;
}

export function composeReasoningAssistSummary(input: ReasoningAssistBriefInput): ReasoningAssistSummary | undefined {
  const plan = planBrief(input);
  if (!plan) return undefined;
  const mapped: ReasoningAssistCriticObjection[] = plan.objections.map(({ target, objection }) => ({
    target: target.kind,
    objection,
  }));
  const first = mapped.at(0);
  const second = mapped.at(1);
  const criticObjections: ReasoningAssistCriticObjections =
    first === undefined ? [] : second === undefined ? [first] : [first, second];
  return {
    candidateConclusion: input.facts.conclusion.statement,
    assumptions: [...input.facts.assumptions],
    evidenceBoundary: plan.evidenceBoundary,
    criticObjections,
    afFact: input.afState === "recorded" ? "recorded_structure" : "absent",
  };
}

export function appendReasoningAssistBrief(baseSystem: string | undefined, brief: string): string {
  if (!baseSystem) return brief;
  return `${baseSystem}${REASONING_ASSIST_BRIEF_DELIMITER}${brief}`;
}
