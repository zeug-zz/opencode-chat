/**
 * Host-private architect preflight boundary for reasoning assistance.
 *
 * This module owns exactly two pure operations:
 * - build one bounded architect packet from the allowed inputs only, and
 * - parse the exact architect JSON result, converting only a fully valid
 *   argument map into the private `ClaimGraph` shape.
 *
 * It has no AF, critic, provider, orchestrator, VS Code, or webview dependency
 * and performs no I/O. A malformed, unsafe, cyclic, missing-dependency, or
 * over-limit result is "no assist": nothing is repaired, guessed, or partially
 * accepted, so a failure can never start AF or critic work.
 */

import {
  CLAIM_CLASSES,
  type ClaimAssumption,
  type ClaimClass,
  type ClaimGraph,
  type ClaimNode,
  type ClaimStatement,
  type ClaimValidationErrorCode,
  DEFAULT_CLAIM_GRAPH_LIMITS,
  EVIDENCE_SOURCE_KINDS,
  EVIDENCE_STATUSES,
  type EvidenceReference,
  type EvidenceSourceKind,
  type EvidenceStatus,
  hasUnsafeValue,
  type LogicalDependency,
  validateClaimGraph,
  validIdentifier,
} from "./claim-graph";

/**
 * Packet bounds. The mandatory block (header plus the bounded user text) and
 * the worst-case optional blocks stay inside `ARCHITECT_PACKET_MAX_CHARS`,
 * which itself stays below the provider's packet cap.
 */
export const ARCHITECT_PACKET_MAX_CHARS = 12_000;
export const ARCHITECT_PACKET_PROVIDER_CAP_CHARS = 16_384;
export const ARCHITECT_USER_TEXT_MAX_CHARS = 8_000;
export const ARCHITECT_CONTEXT_MAX_TURNS = 2;
export const ARCHITECT_CONTEXT_TURN_MAX_CHARS = 1_200;
export const ARCHITECT_PRIOR_SUMMARY_MAX_CHARS = 1_200;

/** Bound on the raw architect result text before any JSON parsing is attempted. */
export const ARCHITECT_RESULT_MAX_CHARS = 8_192;

/** Hard parser limits; identifier and statement limits mirror the private domain. */
export const ARCHITECT_RESULT_LIMITS = Object.freeze({
  maxIdentifierLength: DEFAULT_CLAIM_GRAPH_LIMITS.maxIdentifierLength,
  maxStatementLength: DEFAULT_CLAIM_GRAPH_LIMITS.maxStatementLength,
  maxClaimCount: 12,
  maxAssumptionCount: 8,
  maxEvidenceNeedCount: 8,
  maxUncertaintyCount: 5,
  maxUncertaintyLength: 256,
  maxDependenciesPerClaim: 12,
});

export type ArchitectRecentTurn = Readonly<{ role: "user" | "assistant"; text: string }>;

/** The only inputs the architect packet accepts; anything else fails closed. */
export type ArchitectPacketInput = Readonly<{
  userText: string;
  recentTurns?: readonly ArchitectRecentTurn[];
  priorSummary?: string;
}>;

export type ArchitectPacketIneligibleReason = "empty-text" | "text-over-limit" | "invalid-input";

export type ArchitectPacketResult =
  | Readonly<{ kind: "packet"; packet: string }>
  | Readonly<{ kind: "not-eligible"; reason: ArchitectPacketIneligibleReason }>;

/** Display-safe map facts for the later assist brief; no identifiers are needed. */
export type ArchitectAssistFacts = Readonly<{
  conclusion: Readonly<{ class: ClaimClass; statement: ClaimStatement }>;
  assumptions: readonly ClaimStatement[];
  evidenceNeeds: readonly Readonly<{ sourceKind: EvidenceSourceKind; status: EvidenceStatus }>[];
  uncertainty: readonly string[];
}>;

export type ArchitectNoAssistReason = ClaimValidationErrorCode;

export type ArchitectAssistResult =
  | Readonly<{ kind: "ordinary" }>
  | Readonly<{ kind: "argument"; graph: ClaimGraph; facts: ArchitectAssistFacts }>
  | Readonly<{ kind: "no-assist"; reason: ArchitectNoAssistReason }>;

const PACKET_INPUT_KEYS = new Set(["userText", "recentTurns", "priorSummary"]);
const PACKET_HEADER = "Reasoning-assist preflight packet.";
const PACKET_USER_LABEL = "CURRENT USER TEXT:";
const PACKET_CONTEXT_LABEL = "RECENT SAME-SESSION CONTEXT:";
const PACKET_SUMMARY_LABEL = "PRIOR ASSIST SUMMARY:";
const ARGUMENT_RESULT_KEYS = ["kind", "conclusionId", "claims", "assumptions", "evidenceNeeds", "uncertainty"];
const INVALID_PACKET_INPUT = Symbol("invalid-packet-input");

type ArchitectClaim = Readonly<{
  id: string;
  class: ClaimClass;
  statement: ClaimStatement;
  dependsOn: readonly string[];
}>;

type ArchitectEvidenceNeed = Readonly<{
  claimId: string;
  sourceKind: EvidenceSourceKind;
  status: EvidenceStatus;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function notEligible(reason: ArchitectPacketIneligibleReason): ArchitectPacketResult {
  return { kind: "not-eligible", reason };
}

function noAssist(reason: ArchitectNoAssistReason): ArchitectAssistResult {
  return { kind: "no-assist", reason };
}

function identifierError(value: unknown): ArchitectNoAssistReason | undefined {
  if (typeof value !== "string" || value.length === 0) return "malformed";
  if (value.length > ARCHITECT_RESULT_LIMITS.maxIdentifierLength) return "over-limit";
  if (hasUnsafeValue(value)) return "unsafe-value";
  if (!validIdentifier(value, DEFAULT_CLAIM_GRAPH_LIMITS)) return "malformed";
  return undefined;
}

function boundedTextError(value: unknown, maxLength: number): ArchitectNoAssistReason | undefined {
  if (typeof value !== "string" || value.length === 0) return "malformed";
  if (value.length > maxLength) return "over-limit";
  if (hasUnsafeValue(value)) return "unsafe-value";
  return undefined;
}

function readRecentTurns(value: unknown): readonly ArchitectRecentTurn[] | undefined | typeof INVALID_PACKET_INPUT {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > ARCHITECT_CONTEXT_MAX_TURNS) return INVALID_PACKET_INPUT;
  const turns: ArchitectRecentTurn[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !exactKeys(entry, ["role", "text"])) return INVALID_PACKET_INPUT;
    if (entry.role !== "user" && entry.role !== "assistant") return INVALID_PACKET_INPUT;
    if (typeof entry.text !== "string") return INVALID_PACKET_INPUT;
    // Over-bounded optional context is omitted whole, never truncated.
    if (entry.text.length === 0 || entry.text.length > ARCHITECT_CONTEXT_TURN_MAX_CHARS) continue;
    turns.push({ role: entry.role, text: entry.text });
  }
  return turns;
}

function readPriorSummary(value: unknown): string | undefined | typeof INVALID_PACKET_INPUT {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return INVALID_PACKET_INPUT;
  if (value.length === 0 || value.length > ARCHITECT_PRIOR_SUMMARY_MAX_CHARS) return undefined;
  return value;
}

/**
 * Build the one bounded architect packet. The builder accepts only the new
 * user text, at most two recent same-session turns, and an optional compact
 * prior assist summary; unknown fields (attachments, tool content, reasoning
 * parts, paths, credentials, AF output, unrestricted history) fail closed.
 */
export function buildArchitectPacket(input: ArchitectPacketInput): ArchitectPacketResult {
  const value: unknown = input;
  if (!isRecord(value)) return notEligible("invalid-input");
  if (Object.keys(value).some((key) => !PACKET_INPUT_KEYS.has(key))) return notEligible("invalid-input");
  if (!Object.hasOwn(value, "userText")) return notEligible("invalid-input");

  const userText = value.userText;
  if (typeof userText !== "string") return notEligible("invalid-input");
  if (userText.length === 0) return notEligible("empty-text");
  if (userText.length > ARCHITECT_USER_TEXT_MAX_CHARS) return notEligible("text-over-limit");

  const turns = readRecentTurns(value.recentTurns);
  if (turns === INVALID_PACKET_INPUT) return notEligible("invalid-input");
  const summary = readPriorSummary(value.priorSummary);
  if (summary === INVALID_PACKET_INPUT) return notEligible("invalid-input");

  const sections = [PACKET_HEADER, `${PACKET_USER_LABEL}\n${userText}`];
  const optional: string[] = [];
  if (turns.length > 0)
    optional.push(
      `${PACKET_CONTEXT_LABEL}\n${turns.map(({ role, text }) => `${role.toUpperCase()}: ${text}`).join("\n")}`,
    );
  if (summary !== undefined) optional.push(`${PACKET_SUMMARY_LABEL}\n${summary}`);
  for (const section of optional) {
    const candidate = [...sections, section].join("\n\n");
    if (candidate.length <= ARCHITECT_PACKET_MAX_CHARS) sections.push(section);
  }

  const packet = sections.join("\n\n");
  if (packet.length > ARCHITECT_PACKET_MAX_CHARS || packet.length > ARCHITECT_PACKET_PROVIDER_CAP_CHARS)
    return notEligible("invalid-input");
  return { kind: "packet", packet };
}

function mintGeneratedIdentifier(prefix: string, usedIds: Set<string>): string {
  let counter = 1;
  let candidate = `${prefix}-${counter}`;
  while (
    usedIds.has(candidate) ||
    hasUnsafeValue(candidate) ||
    !validIdentifier(candidate, DEFAULT_CLAIM_GRAPH_LIMITS)
  ) {
    counter += 1;
    candidate = `${prefix}-${counter}`;
  }
  usedIds.add(candidate);
  return candidate;
}

/**
 * Parse the exact architect result text. Only `{ "kind": "ordinary" }` and the
 * exact argument-map schema are accepted, and only after every identifier,
 * class, text, list, and safety bound passes is the map converted and handed to
 * `validateClaimGraph()` for the private domain's own final validation.
 */
export function parseArchitectResult(text: unknown): ArchitectAssistResult {
  if (typeof text !== "string" || text.length === 0) return noAssist("malformed");
  if (text.length > ARCHITECT_RESULT_MAX_CHARS) return noAssist("over-limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return noAssist("malformed");
  }
  if (!isRecord(parsed)) return noAssist("malformed");
  if (parsed.kind === "ordinary") {
    if (!exactKeys(parsed, ["kind"])) return noAssist("malformed");
    return { kind: "ordinary" };
  }
  if (parsed.kind !== "argument" || !exactKeys(parsed, ARGUMENT_RESULT_KEYS)) return noAssist("malformed");

  const conclusionIdError = identifierError(parsed.conclusionId);
  if (conclusionIdError) return noAssist(conclusionIdError);
  const conclusionId = parsed.conclusionId as string;
  const suppliedIds = new Set<string>();

  if (!Array.isArray(parsed.claims) || parsed.claims.length === 0) return noAssist("malformed");
  if (parsed.claims.length > ARCHITECT_RESULT_LIMITS.maxClaimCount) return noAssist("over-limit");
  const claims: ArchitectClaim[] = [];
  for (const entry of parsed.claims) {
    if (!isRecord(entry) || !exactKeys(entry, ["id", "class", "statement", "dependsOn"])) return noAssist("malformed");
    const idError = identifierError(entry.id);
    if (idError) return noAssist(idError);
    const id = entry.id as string;
    if (suppliedIds.has(id)) return noAssist("duplicate-identifier");
    if (!CLAIM_CLASSES.includes(entry.class as ClaimClass)) return noAssist("invalid-claim-class");
    const statementError = boundedTextError(entry.statement, ARCHITECT_RESULT_LIMITS.maxStatementLength);
    if (statementError) return noAssist(statementError);
    if (!Array.isArray(entry.dependsOn)) return noAssist("malformed");
    if (entry.dependsOn.length > ARCHITECT_RESULT_LIMITS.maxDependenciesPerClaim) return noAssist("over-limit");
    const dependsOn: string[] = [];
    for (const target of entry.dependsOn) {
      const targetError = identifierError(target);
      if (targetError) return noAssist(targetError);
      if (dependsOn.includes(target as string)) return noAssist("malformed");
      dependsOn.push(target as string);
    }
    suppliedIds.add(id);
    claims.push({ id, class: entry.class as ClaimClass, statement: entry.statement as string, dependsOn });
  }

  if (!Array.isArray(parsed.assumptions)) return noAssist("malformed");
  if (parsed.assumptions.length > ARCHITECT_RESULT_LIMITS.maxAssumptionCount) return noAssist("over-limit");
  const assumptions: ClaimAssumption[] = [];
  for (const entry of parsed.assumptions) {
    if (!isRecord(entry) || !exactKeys(entry, ["id", "claimId", "statement"])) return noAssist("malformed");
    const idError = identifierError(entry.id);
    if (idError) return noAssist(idError);
    const id = entry.id as string;
    if (suppliedIds.has(id)) return noAssist("duplicate-identifier");
    const claimIdError = identifierError(entry.claimId);
    if (claimIdError) return noAssist(claimIdError);
    const statementError = boundedTextError(entry.statement, ARCHITECT_RESULT_LIMITS.maxStatementLength);
    if (statementError) return noAssist(statementError);
    suppliedIds.add(id);
    assumptions.push({ id, claimId: entry.claimId as string, statement: entry.statement as string });
  }

  if (!Array.isArray(parsed.evidenceNeeds)) return noAssist("malformed");
  if (parsed.evidenceNeeds.length > ARCHITECT_RESULT_LIMITS.maxEvidenceNeedCount) return noAssist("over-limit");
  const evidenceNeeds: ArchitectEvidenceNeed[] = [];
  for (const entry of parsed.evidenceNeeds) {
    if (!isRecord(entry) || !exactKeys(entry, ["claimId", "sourceKind", "status"])) return noAssist("malformed");
    const claimIdError = identifierError(entry.claimId);
    if (claimIdError) return noAssist(claimIdError);
    if (!EVIDENCE_SOURCE_KINDS.includes(entry.sourceKind as EvidenceSourceKind)) return noAssist("malformed");
    if (!EVIDENCE_STATUSES.includes(entry.status as EvidenceStatus)) return noAssist("malformed");
    evidenceNeeds.push({
      claimId: entry.claimId as string,
      sourceKind: entry.sourceKind as EvidenceSourceKind,
      status: entry.status as EvidenceStatus,
    });
  }

  if (!Array.isArray(parsed.uncertainty)) return noAssist("malformed");
  if (parsed.uncertainty.length > ARCHITECT_RESULT_LIMITS.maxUncertaintyCount) return noAssist("over-limit");
  const uncertainty: string[] = [];
  for (const entry of parsed.uncertainty) {
    const textError = boundedTextError(entry, ARCHITECT_RESULT_LIMITS.maxUncertaintyLength);
    if (textError) return noAssist(textError);
    uncertainty.push(entry as string);
  }

  const usedIds = new Set(suppliedIds);
  const logicalDependencies: LogicalDependency[] = [];
  const evidenceReferences: EvidenceReference[] = [];
  const dependencyIdsByClaim = new Map<string, string[]>();
  const evidenceIdsByClaim = new Map<string, string[]>();
  for (const claim of claims) {
    const dependencyIds: string[] = [];
    for (const target of claim.dependsOn) {
      const id = mintGeneratedIdentifier("edge", usedIds);
      logicalDependencies.push({ id, fromClaimId: claim.id, toClaimId: target });
      dependencyIds.push(id);
    }
    dependencyIdsByClaim.set(claim.id, dependencyIds);
  }
  for (const need of evidenceNeeds) {
    const id = mintGeneratedIdentifier("evidence", usedIds);
    evidenceReferences.push({
      id,
      claimId: need.claimId,
      metadata: { sourceKind: need.sourceKind, status: need.status },
    });
    evidenceIdsByClaim.set(need.claimId, [...(evidenceIdsByClaim.get(need.claimId) ?? []), id]);
  }
  const nodes: ClaimNode[] = claims.map((claim) => ({
    id: claim.id,
    class: claim.class,
    statement: claim.statement,
    assumptionIds: assumptions.filter((assumption) => assumption.claimId === claim.id).map(({ id }) => id),
    logicalDependencyIds: dependencyIdsByClaim.get(claim.id) ?? [],
    evidenceReferenceIds: evidenceIdsByClaim.get(claim.id) ?? [],
  }));

  const validation = validateClaimGraph({ conclusionId, nodes, assumptions, logicalDependencies, evidenceReferences });
  if (!validation.ok) return noAssist(validation.errors[0]?.code ?? "malformed");
  const conclusionNode = validation.graph.nodes.find((node) => node.id === conclusionId);
  if (!conclusionNode) return noAssist("missing-dependency");
  return {
    kind: "argument",
    graph: validation.graph,
    facts: {
      conclusion: { class: conclusionNode.class, statement: conclusionNode.statement },
      assumptions: validation.graph.assumptions.map(({ statement }) => statement),
      evidenceNeeds: validation.graph.evidenceReferences.map(({ metadata }) => ({
        sourceKind: metadata.sourceKind,
        status: metadata.status,
      })),
      uncertainty: [...uncertainty],
    },
  };
}
