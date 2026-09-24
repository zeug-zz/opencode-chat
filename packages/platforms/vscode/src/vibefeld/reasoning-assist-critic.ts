/**
 * Host-private critic packet and objection boundary for reasoning assistance.
 *
 * This module owns exactly two pure operations:
 * - build one bounded critic packet from a locally validated claim graph only,
 *   naming the candidate conclusion and each assumption as the only targets,
 *   and
 * - parse the exact critic JSON result, normalizing at most two bounded
 *   objections that target a known claim or assumption.
 *
 * It has no AF, architect, provider, orchestrator, VS Code, or webview
 * dependency and performs no I/O. There is no verifier role anywhere in this
 * module, and raw critic text never leaves it: a malformed, unsafe,
 * unknown-target, or over-limit result is a bounded no-assist carrying no raw
 * text, identifiers, or error detail.
 */

import { type ClaimGraph, DEFAULT_CLAIM_GRAPH_LIMITS, hasUnsafeValue, validateClaimGraph } from "./claim-graph";

/**
 * Packet bound. The mandatory conclusion block plus every assumption block
 * stay inside `CRITIC_PACKET_MAX_CHARS`; a graph whose packet would exceed it
 * is not eligible for a critic stage at all.
 */
export const CRITIC_PACKET_MAX_CHARS = 12_000;

/** Bound on the raw critic result text before any JSON parsing is attempted. */
export const CRITIC_RESULT_MAX_CHARS = 4_096;

/** Hard parser limits: at most two objections with bounded reason text. */
export const CRITIC_RESULT_LIMITS = Object.freeze({
  maxObjections: 2,
  maxReasonLength: 512,
});

/** The only objection severities the normalized result can express. */
export const CRITIC_OBJECTION_SEVERITIES = Object.freeze(["material", "minor"] as const);

export type CriticObjectionSeverity = (typeof CRITIC_OBJECTION_SEVERITIES)[number];

/** The only input the critic packet accepts; anything else fails closed. */
export type CriticPacketInput = Readonly<{ graph: ClaimGraph }>;

/** The only nodes a critic objection may name; supporting claims are never targetable. */
export type CriticPacketTargets = Readonly<{
  conclusionId: string;
  assumptionIds: readonly string[];
}>;

export type CriticPacketIneligibleReason = "invalid-input" | "invalid-graph" | "over-limit";

export type CriticPacketResult =
  | Readonly<{ kind: "packet"; packet: string; targets: CriticPacketTargets }>
  | Readonly<{ kind: "not-eligible"; reason: CriticPacketIneligibleReason }>;

/** Normalized target kinds mirror the provider-neutral core contract. */
export type CriticObjectionTargetKind = "candidate_conclusion" | "assumption";

export type CriticObjection = Readonly<{
  target: Readonly<{ kind: CriticObjectionTargetKind; id: string }>;
  severity: CriticObjectionSeverity;
  objection: string;
}>;

export type CriticNormalizedObjections = [CriticObjection] | [CriticObjection, CriticObjection];

export type CriticNoAssistReason = "malformed" | "unsafe-value" | "over-limit" | "unknown-target";

export type CriticAssistResult =
  | Readonly<{ kind: "no-objections" }>
  | Readonly<{ kind: "objections"; objections: CriticNormalizedObjections }>
  | Readonly<{ kind: "no-assist"; reason: CriticNoAssistReason }>;

const PACKET_HEADER = "Reasoning-assist critic packet.";
const PACKET_CONCLUSION_LABEL = "CANDIDATE CONCLUSION:";
const PACKET_ASSUMPTIONS_LABEL = "ASSUMPTIONS:";
const PACKET_NO_ASSUMPTIONS = "(none)";
const RESULT_KEYS = ["objections"];
const OBJECTION_KEYS = ["target", "severity", "reason"];
const TARGET_KEYS = ["kind", "id"];
const RAW_TARGET_KINDS = ["claim", "assumption"] as const;

type RawTargetKind = (typeof RAW_TARGET_KINDS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function notEligible(reason: CriticPacketIneligibleReason): CriticPacketResult {
  return { kind: "not-eligible", reason };
}

function noAssist(reason: CriticNoAssistReason): CriticAssistResult {
  return { kind: "no-assist", reason };
}

function targetIdError(value: unknown): CriticNoAssistReason | undefined {
  if (typeof value !== "string" || value.length === 0) return "malformed";
  if (value.length > DEFAULT_CLAIM_GRAPH_LIMITS.maxIdentifierLength) return "over-limit";
  if (hasUnsafeValue(value)) return "unsafe-value";
  return undefined;
}

function objectionTextError(value: unknown): CriticNoAssistReason | undefined {
  if (typeof value !== "string" || value.length === 0) return "malformed";
  if (value.length > CRITIC_RESULT_LIMITS.maxReasonLength) return "over-limit";
  if (hasUnsafeValue(value)) return "unsafe-value";
  return undefined;
}

function validTargets(value: unknown): value is CriticPacketTargets {
  return (
    isRecord(value) &&
    typeof value.conclusionId === "string" &&
    value.conclusionId.length > 0 &&
    Array.isArray(value.assumptionIds) &&
    value.assumptionIds.every((id) => typeof id === "string")
  );
}

/**
 * Build the one bounded critic packet. The packet names only the candidate
 * conclusion and each assumption with clearly visible identifiers; supporting
 * claim nodes are intentionally not targetable because the compact core
 * summary can only express objections against the candidate conclusion or an
 * assumption, so objections against internal supporting claims have no honest
 * representation. The graph is re-validated and the assembled text is
 * re-checked for unsafe values before any packet is returned.
 */
export function buildCriticPacket(input: CriticPacketInput): CriticPacketResult {
  const value: unknown = input;
  if (!isRecord(value) || !exactKeys(value, ["graph"])) return notEligible("invalid-input");

  const validation = validateClaimGraph(value.graph);
  if (!validation.ok) return notEligible("invalid-graph");
  const { graph } = validation;
  const conclusion = graph.nodes.find((node) => node.id === graph.conclusionId);
  if (!conclusion) return notEligible("invalid-graph");

  const conclusionSection = `${PACKET_CONCLUSION_LABEL}\nid: ${conclusion.id}\nstatement: ${conclusion.statement}`;
  const assumptionBlocks = graph.assumptions.map(
    (assumption) => `id: ${assumption.id}\nstatement: ${assumption.statement}`,
  );
  const assumptionsSection = `${PACKET_ASSUMPTIONS_LABEL}\n${
    assumptionBlocks.length === 0 ? PACKET_NO_ASSUMPTIONS : assumptionBlocks.join("\n\n")
  }`;
  const packet = [PACKET_HEADER, conclusionSection, assumptionsSection].join("\n\n");

  // Defense-in-depth: validated graph text is re-checked after assembly so an
  // unsafe packet can never reach the restricted critic stage.
  if (hasUnsafeValue(packet)) return notEligible("invalid-graph");
  if (packet.length > CRITIC_PACKET_MAX_CHARS) return notEligible("over-limit");
  return {
    kind: "packet",
    packet,
    targets: { conclusionId: graph.conclusionId, assumptionIds: graph.assumptions.map(({ id }) => id) },
  };
}

/**
 * Parse the exact critic result text against the packet targets. Only
 * `{ "objections": [...] }` with exact entry and target keys is accepted, and
 * each target id must name the candidate conclusion or a listed assumption.
 * Nothing is repaired, guessed, or partially accepted, and a failure carries
 * no raw text, identifiers, or error detail.
 */
export function parseCriticResult(text: unknown, targets: CriticPacketTargets): CriticAssistResult {
  if (!validTargets(targets)) return noAssist("malformed");
  if (typeof text !== "string" || text.length === 0) return noAssist("malformed");
  if (text.length > CRITIC_RESULT_MAX_CHARS) return noAssist("over-limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return noAssist("malformed");
  }
  if (!isRecord(parsed) || !exactKeys(parsed, RESULT_KEYS)) return noAssist("malformed");
  if (!Array.isArray(parsed.objections)) return noAssist("malformed");
  if (parsed.objections.length > CRITIC_RESULT_LIMITS.maxObjections) return noAssist("over-limit");
  if (parsed.objections.length === 0) return { kind: "no-objections" };

  const knownAssumptionIds = new Set(targets.assumptionIds);
  const objections: CriticObjection[] = [];
  for (const entry of parsed.objections) {
    if (!isRecord(entry) || !exactKeys(entry, OBJECTION_KEYS)) return noAssist("malformed");
    if (!isRecord(entry.target) || !exactKeys(entry.target, TARGET_KEYS)) return noAssist("malformed");
    const rawKind = entry.target.kind;
    if (!RAW_TARGET_KINDS.includes(rawKind as RawTargetKind)) return noAssist("malformed");
    const idError = targetIdError(entry.target.id);
    if (idError) return noAssist(idError);
    const id = entry.target.id as string;
    if (rawKind === "claim" && id !== targets.conclusionId) return noAssist("unknown-target");
    if (rawKind === "assumption" && !knownAssumptionIds.has(id)) return noAssist("unknown-target");
    if (
      typeof entry.severity !== "string" ||
      !CRITIC_OBJECTION_SEVERITIES.includes(entry.severity as CriticObjectionSeverity)
    )
      return noAssist("malformed");
    const textError = objectionTextError(entry.reason);
    if (textError) return noAssist(textError);
    objections.push({
      target: { kind: rawKind === "claim" ? "candidate_conclusion" : "assumption", id },
      severity: entry.severity as CriticObjectionSeverity,
      objection: entry.reason as string,
    });
  }
  return { kind: "objections", objections: objections as CriticNormalizedObjections };
}
