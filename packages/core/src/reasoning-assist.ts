/**
 * Provider-neutral contracts for the bounded, host-owned reasoning assist.
 * Only compact facts suitable for prompt-scoped display cross this boundary.
 */

export type ReasoningAssistStage = "assessing" | "mapping" | "recording" | "critiquing" | "preparing" | "applied";

export type ReasoningAssistProgress = {
  sessionId: string;
  promptToken: string;
  stage: ReasoningAssistStage;
};

export type ReasoningAssistObjectionTarget = "candidate_conclusion" | "assumption";

export type ReasoningAssistCriticObjection = {
  target: ReasoningAssistObjectionTarget;
  objection: string;
};

export type ReasoningAssistCriticObjections =
  | []
  | [ReasoningAssistCriticObjection]
  | [ReasoningAssistCriticObjection, ReasoningAssistCriticObjection];

export type ReasoningAssistAfFact = "recorded_structure" | "absent";

export type ReasoningAssistSummary = {
  candidateConclusion: string;
  assumptions: string[];
  evidenceBoundary: string;
  criticObjections: ReasoningAssistCriticObjections;
  afFact: ReasoningAssistAfFact;
};
