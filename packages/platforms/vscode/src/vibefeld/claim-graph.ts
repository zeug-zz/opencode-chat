/**
 * Host-private claim projection shapes.
 *
 * These are normalized graph facts, not AF workspace records. In particular,
 * they contain no executable, workspace, provider, source-content, or model
 * payloads and are never part of the webview protocol.
 */

export type ClaimClass = "deductive" | "computational" | "empirical" | "procedural" | "interpretive" | "normative";

export type ClaimIdentifier = string;
export type ClaimStatement = string;

export type ClaimNode = Readonly<{
  id: ClaimIdentifier;
  class: ClaimClass;
  statement: ClaimStatement;
  assumptionIds: readonly ClaimIdentifier[];
  logicalDependencyIds: readonly ClaimIdentifier[];
  evidenceReferenceIds: readonly ClaimIdentifier[];
}>;

export type ClaimAssumption = Readonly<{
  id: ClaimIdentifier;
  claimId: ClaimIdentifier;
  statement: ClaimStatement;
}>;

/** Logical edges are deliberately a different type from evidence references. */
export type LogicalDependency = Readonly<{
  id: ClaimIdentifier;
  fromClaimId: ClaimIdentifier;
  toClaimId: ClaimIdentifier;
}>;

export type EvidenceStatus = "not_required" | "source_recorded" | "unverified" | "human_verified" | "conflicted";

export type EvidenceSourceKind = "citation" | "observation" | "calculation" | "procedure" | "human";

/** Evidence metadata identifies state only; it does not retain evidence content. */
export type EvidenceMetadata = Readonly<{
  sourceKind: EvidenceSourceKind;
  status: EvidenceStatus;
  conflictGroup?: ClaimIdentifier;
}>;

export type EvidenceReference = Readonly<{
  id: ClaimIdentifier;
  claimId: ClaimIdentifier;
  metadata: EvidenceMetadata;
}>;

export type ClaimGraphLimits = Readonly<{
  maxSourceTextLength: number;
  maxIdentifierLength: number;
  maxStatementLength: number;
  maxNodeCount: number;
  maxClaimCount: number;
  maxAssumptionCount: number;
  maxLogicalDependencyCount: number;
  maxEvidenceReferenceCount: number;
  maxDepth: number;
}>;

export const DEFAULT_CLAIM_GRAPH_LIMITS: ClaimGraphLimits = Object.freeze({
  maxSourceTextLength: 12_000,
  maxIdentifierLength: 64,
  maxStatementLength: 512,
  maxNodeCount: 64,
  maxClaimCount: 64,
  maxAssumptionCount: 128,
  maxLogicalDependencyCount: 128,
  maxEvidenceReferenceCount: 128,
  maxDepth: 16,
});

export type ClaimGraph = Readonly<{
  conclusionId: ClaimIdentifier;
  nodes: readonly ClaimNode[];
  assumptions: readonly ClaimAssumption[];
  logicalDependencies: readonly LogicalDependency[];
  evidenceReferences: readonly EvidenceReference[];
}>;

export type ClaimValidationErrorCode =
  | "malformed"
  | "duplicate-identifier"
  | "missing-dependency"
  | "cycle"
  | "invalid-claim-class"
  | "unsafe-value"
  | "over-limit";

export type ClaimValidationError = Readonly<{
  code: ClaimValidationErrorCode;
}>;

export type ClaimGraphValidationResult =
  | Readonly<{ ok: true; graph: ClaimGraph }>
  | Readonly<{ ok: false; errors: readonly ClaimValidationError[] }>;

/**
 * The source packet is deliberately a small, non-ambiguous line format.  It is
 * not a prompt and is never sent to a provider.  Every non-empty line must be
 * represented by one of these records; this prevents a conservative compiler
 * from silently losing a premise or dependency.
 *
 * CONCLUSION: claim-id
 * CLAIM: claim-id|class|statement
 * ASSUMPTION: assumption-id|claim-id|statement
 * DEPENDS: edge-id|from-claim-id|to-claim-id
 * EVIDENCE: evidence-id|claim-id|source-kind|status
 */
export const CLAIM_CLASSES: readonly ClaimClass[] = [
  "deductive",
  "computational",
  "empirical",
  "procedural",
  "interpretive",
  "normative",
];
export const EVIDENCE_SOURCE_KINDS: readonly EvidenceSourceKind[] = [
  "citation",
  "observation",
  "calculation",
  "procedure",
  "human",
];
export const EVIDENCE_STATUSES: readonly EvidenceStatus[] = [
  "not_required",
  "source_recorded",
  "unverified",
  "human_verified",
  "conflicted",
];
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const UNSAFE_VALUE_PATTERN =
  /(?:ignore\s+(?:all|any|the)\s+(?:previous|prior|above)|(?:^|\b)(?:prompt|command|argv|credential|password|secret|token|private\s*reasoning|chain[- ]of[- ]thought|ledger)\s*[:=]|(?:^|\s)(?:\/Users\/|\/private\/|\/home\/|\/tmp\/|\/var\/|[A-Za-z]:[\\/]))/i;

function error(code: ClaimValidationErrorCode): ClaimValidationError {
  return { code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shared with the host-private reasoning-assist parser so unset/bounded text rules cannot drift. */
export function hasUnsafeValue(value: unknown): boolean {
  return typeof value === "string" && UNSAFE_VALUE_PATTERN.test(value);
}

function hasString(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

/** Shared with the host-private reasoning-assist parser so the identifier rule and limit cannot drift. */
export function validIdentifier(value: unknown, limits: ClaimGraphLimits): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limits.maxIdentifierLength &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function addUnique(values: ClaimValidationError[], code: ClaimValidationErrorCode): void {
  if (!values.some((value) => value.code === code)) values.push(error(code));
}

/** Compile the explicit visible-text packet into a private graph, fail-closed. */
export function compileClaimGraph(
  sourceText: string,
  limits: ClaimGraphLimits = DEFAULT_CLAIM_GRAPH_LIMITS,
): ClaimGraphValidationResult {
  if (typeof sourceText !== "string" || sourceText.length > limits.maxSourceTextLength || hasUnsafeValue(sourceText)) {
    return {
      ok: false,
      errors: [error(sourceText.length > limits.maxSourceTextLength ? "over-limit" : "unsafe-value")],
    };
  }

  const claims: ClaimNode[] = [];
  const assumptions: ClaimAssumption[] = [];
  const logicalDependencies: LogicalDependency[] = [];
  const evidenceReferences: EvidenceReference[] = [];
  let conclusionId: string | undefined;
  const errors: ClaimValidationError[] = [];

  for (const rawLine of sourceText.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator < 0) {
      addUnique(errors, "malformed");
      continue;
    }
    const marker = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (hasUnsafeValue(value)) {
      addUnique(errors, "unsafe-value");
      continue;
    }
    if (marker === "CONCLUSION") {
      if (conclusionId !== undefined || !validIdentifier(value, limits))
        addUnique(errors, conclusionId === undefined ? "malformed" : "duplicate-identifier");
      else conclusionId = value;
      continue;
    }
    const fields = value.split("|").map((field) => field.trim());
    if (marker === "CLAIM" && fields.length === 3) {
      const [id, claimClass, statement] = fields;
      if (!validIdentifier(id, limits) || !hasString(statement, limits.maxStatementLength))
        addUnique(errors, "malformed");
      else if (!CLAIM_CLASSES.includes(claimClass as ClaimClass)) addUnique(errors, "invalid-claim-class");
      else
        claims.push({
          id,
          class: claimClass as ClaimClass,
          statement,
          assumptionIds: [],
          logicalDependencyIds: [],
          evidenceReferenceIds: [],
        });
    } else if (marker === "ASSUMPTION" && fields.length === 3) {
      const [id, claimId, statement] = fields;
      if (
        !validIdentifier(id, limits) ||
        !validIdentifier(claimId, limits) ||
        !hasString(statement, limits.maxStatementLength)
      )
        addUnique(errors, "malformed");
      else assumptions.push({ id, claimId, statement });
    } else if (marker === "DEPENDS" && fields.length === 3) {
      const [id, fromClaimId, toClaimId] = fields;
      if (!validIdentifier(id, limits) || !validIdentifier(fromClaimId, limits) || !validIdentifier(toClaimId, limits))
        addUnique(errors, "malformed");
      else logicalDependencies.push({ id, fromClaimId, toClaimId });
    } else if (marker === "EVIDENCE" && fields.length === 4) {
      const [id, claimId, sourceKind, status] = fields;
      if (!validIdentifier(id, limits) || !validIdentifier(claimId, limits)) addUnique(errors, "malformed");
      else if (
        !EVIDENCE_SOURCE_KINDS.includes(sourceKind as EvidenceSourceKind) ||
        !EVIDENCE_STATUSES.includes(status as EvidenceStatus)
      )
        addUnique(errors, "malformed");
      else
        evidenceReferences.push({
          id,
          claimId,
          metadata: { sourceKind: sourceKind as EvidenceSourceKind, status: status as EvidenceStatus },
        });
    } else {
      addUnique(errors, "malformed");
    }
  }

  const claimMap = new Map(claims.map((claim) => [claim.id, claim]));
  const assumptionMap = new Map(assumptions.map((assumption) => [assumption.id, assumption]));
  const dependencyMap = new Map(logicalDependencies.map((dependency) => [dependency.id, dependency]));
  const evidenceMap = new Map(evidenceReferences.map((reference) => [reference.id, reference]));
  const identifiers = [
    ...claims.map(({ id }) => id),
    ...assumptions.map(({ id }) => id),
    ...logicalDependencies.map(({ id }) => id),
    ...evidenceReferences.map(({ id }) => id),
  ];
  if (new Set(identifiers).size !== identifiers.length) addUnique(errors, "duplicate-identifier");
  if (conclusionId === undefined || !claimMap.has(conclusionId)) addUnique(errors, "missing-dependency");
  for (const assumption of assumptions) if (!claimMap.has(assumption.claimId)) addUnique(errors, "missing-dependency");
  for (const dependency of logicalDependencies)
    if (!claimMap.has(dependency.fromClaimId) || !claimMap.has(dependency.toClaimId))
      addUnique(errors, "missing-dependency");
  for (const reference of evidenceReferences)
    if (!claimMap.has(reference.claimId)) addUnique(errors, "missing-dependency");
  if (
    claims.length > limits.maxClaimCount ||
    claims.length + assumptions.length > limits.maxNodeCount ||
    assumptions.length > limits.maxAssumptionCount ||
    logicalDependencies.length > limits.maxLogicalDependencyCount ||
    evidenceReferences.length > limits.maxEvidenceReferenceCount
  )
    addUnique(errors, "over-limit");

  const adjacency = new Map<string, string[]>();
  for (const dependency of logicalDependencies)
    adjacency.set(dependency.fromClaimId, [...(adjacency.get(dependency.fromClaimId) ?? []), dependency.toClaimId]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      addUnique(errors, "cycle");
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of adjacency.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  if (conclusionId !== undefined) visit(conclusionId);
  if (visited.size !== claims.length && claims.length > 0) addUnique(errors, "missing-dependency");
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return limits.maxDepth + 1;
    const next = new Set(seen).add(id);
    return 1 + Math.max(0, ...(adjacency.get(id) ?? []).map((dependency) => depth(dependency, next)));
  };
  if (conclusionId !== undefined && depth(conclusionId) > limits.maxDepth) addUnique(errors, "over-limit");
  if (errors.length > 0) return { ok: false, errors };

  const nodes = claims.map((claim) => ({
    ...claim,
    assumptionIds: assumptions.filter((assumption) => assumption.claimId === claim.id).map(({ id }) => id),
    logicalDependencyIds: logicalDependencies
      .filter((dependency) => dependency.fromClaimId === claim.id)
      .map(({ id }) => id),
    evidenceReferenceIds: evidenceReferences.filter((reference) => reference.claimId === claim.id).map(({ id }) => id),
  }));
  // The maps above intentionally force all parsed records through validation;
  // keeping them named also makes it difficult to accidentally drop a record.
  void assumptionMap;
  void dependencyMap;
  void evidenceMap;
  return validateClaimGraph(
    { conclusionId: conclusionId as string, nodes, assumptions, logicalDependencies, evidenceReferences },
    limits,
  );
}

/** Validate a graph supplied by a private test seam or a future local compiler. */
export function validateClaimGraph(
  graph: unknown,
  limits: ClaimGraphLimits = DEFAULT_CLAIM_GRAPH_LIMITS,
): ClaimGraphValidationResult {
  const errors: ClaimValidationError[] = [];
  if (
    !isRecord(graph) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.assumptions) ||
    !Array.isArray(graph.logicalDependencies) ||
    !Array.isArray(graph.evidenceReferences) ||
    typeof graph.conclusionId !== "string"
  )
    return { ok: false, errors: [error("malformed")] };
  const nodes = graph.nodes as readonly ClaimNode[];
  const assumptions = graph.assumptions as readonly ClaimAssumption[];
  const logicalDependencies = graph.logicalDependencies as readonly LogicalDependency[];
  const evidenceReferences = graph.evidenceReferences as readonly EvidenceReference[];
  const allIds = [...nodes, ...assumptions, ...logicalDependencies, ...evidenceReferences].map((item) =>
    isRecord(item) ? item.id : undefined,
  );
  if (allIds.some((id) => !validIdentifier(id, limits)) || !validIdentifier(graph.conclusionId, limits))
    addUnique(errors, "malformed");
  if (allIds.some((id) => typeof id === "string" && hasUnsafeValue(id)) || hasUnsafeValue(graph.conclusionId))
    addUnique(errors, "unsafe-value");
  if (new Set(allIds.filter((id): id is string => typeof id === "string")).size !== allIds.length)
    addUnique(errors, "duplicate-identifier");
  if (
    nodes.length > limits.maxNodeCount ||
    nodes.length > limits.maxClaimCount ||
    assumptions.length > limits.maxAssumptionCount ||
    logicalDependencies.length > limits.maxLogicalDependencyCount ||
    evidenceReferences.length > limits.maxEvidenceReferenceCount
  )
    addUnique(errors, "over-limit");
  const claimIds = new Set(nodes.filter(isRecord).map((node) => node.id));
  const assumptionIds = new Set(assumptions.filter(isRecord).map((assumption) => assumption.id));
  if (!claimIds.has(graph.conclusionId)) addUnique(errors, "missing-dependency");
  for (const node of nodes) {
    if (
      !isRecord(node) ||
      !CLAIM_CLASSES.includes(node.class as ClaimClass) ||
      !hasString(node.statement, limits.maxStatementLength) ||
      hasUnsafeValue(node.statement)
    )
      addUnique(
        errors,
        !isRecord(node) || !CLAIM_CLASSES.includes(node.class as ClaimClass)
          ? "invalid-claim-class"
          : hasUnsafeValue(node.statement)
            ? "unsafe-value"
            : "malformed",
      );
    if (
      !isRecord(node) ||
      !Array.isArray(node.assumptionIds) ||
      !Array.isArray(node.logicalDependencyIds) ||
      !Array.isArray(node.evidenceReferenceIds)
    )
      addUnique(errors, "malformed");
    if (
      (isRecord(node) &&
        Array.isArray(node.assumptionIds) &&
        node.assumptionIds.some((id) => !validIdentifier(id, limits))) ||
      (isRecord(node) &&
        Array.isArray(node.logicalDependencyIds) &&
        node.logicalDependencyIds.some((id) => !validIdentifier(id, limits))) ||
      (isRecord(node) &&
        Array.isArray(node.evidenceReferenceIds) &&
        node.evidenceReferenceIds.some((id) => !validIdentifier(id, limits)))
    )
      addUnique(errors, "malformed");
    if (isRecord(node) && Array.isArray(node.assumptionIds) && node.assumptionIds.some((id) => !assumptionIds.has(id)))
      addUnique(errors, "missing-dependency");
  }
  const dependencyIds = new Set(logicalDependencies.filter(isRecord).map((dependency) => dependency.id));
  for (const dependency of logicalDependencies) {
    if (!isRecord(dependency)) addUnique(errors, "malformed");
    else if (!validIdentifier(dependency.fromClaimId, limits) || !validIdentifier(dependency.toClaimId, limits))
      addUnique(errors, "malformed");
    else if (!claimIds.has(dependency.fromClaimId) || !claimIds.has(dependency.toClaimId))
      addUnique(errors, "missing-dependency");
  }
  for (const assumption of assumptions) {
    if (
      !isRecord(assumption) ||
      !claimIds.has(assumption.claimId) ||
      !hasString(assumption.statement, limits.maxStatementLength)
    )
      addUnique(errors, "missing-dependency");
    if (isRecord(assumption) && hasUnsafeValue(assumption.statement)) addUnique(errors, "unsafe-value");
  }
  const evidenceIds = new Set(evidenceReferences.filter(isRecord).map((reference) => reference.id));
  for (const reference of evidenceReferences) {
    if (!isRecord(reference) || !claimIds.has(reference.claimId) || !isRecord(reference.metadata))
      addUnique(errors, "missing-dependency");
    if (
      isRecord(reference) &&
      isRecord(reference.metadata) &&
      (!EVIDENCE_SOURCE_KINDS.includes(reference.metadata.sourceKind as EvidenceSourceKind) ||
        !EVIDENCE_STATUSES.includes(reference.metadata.status as EvidenceStatus))
    )
      addUnique(errors, "malformed");
  }
  for (const node of nodes) {
    if (
      (isRecord(node) &&
        Array.isArray(node.logicalDependencyIds) &&
        node.logicalDependencyIds.some((id) => !dependencyIds.has(id))) ||
      (isRecord(node) &&
        Array.isArray(node.evidenceReferenceIds) &&
        node.evidenceReferenceIds.some((id) => !evidenceIds.has(id)))
    )
      addUnique(errors, "missing-dependency");
  }
  const adjacency = new Map<string, string[]>();
  for (const dependency of logicalDependencies)
    if (isRecord(dependency) && typeof dependency.fromClaimId === "string" && typeof dependency.toClaimId === "string")
      adjacency.set(dependency.fromClaimId, [...(adjacency.get(dependency.fromClaimId) ?? []), dependency.toClaimId]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) addUnique(errors, "cycle");
    else if (!visited.has(id)) {
      visiting.add(id);
      for (const next of adjacency.get(id) ?? []) walk(next);
      visiting.delete(id);
      visited.add(id);
    }
  };
  walk(graph.conclusionId);
  if (visited.size !== nodes.length) addUnique(errors, "missing-dependency");
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return limits.maxDepth + 1;
    const next = new Set(seen).add(id);
    return 1 + Math.max(0, ...(adjacency.get(id) ?? []).map((dependency) => depth(dependency, next)));
  };
  if (depth(graph.conclusionId) > limits.maxDepth) addUnique(errors, "over-limit");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, graph: graph as ClaimGraph };
}
