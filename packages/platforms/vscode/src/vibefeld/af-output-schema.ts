import { type AfResultClassification, classifyAfRuntimeResult } from "./af-runtime-contract";

const MAX_OUTPUT_BYTES = 32_768;
const MAX_TEXT_LENGTH = 256;
const EXPECTED_FIXTURE_SCHEMA = "af-runtime-fixture-1" as const;
const EXPECTED_WORKSPACE_FORMAT = "1.0" as const;
const EXPECTED_RUNTIME = {
  executableName: "af",
  version: "0.1.7",
  commit: "5a37413",
  buildDate: "2026-09-08T02:25:39Z",
  goVersion: "go1.27.1",
} as const;

type AfOutputFailure = Extract<AfResultClassification, { outcome: "unavailable" | "audit-failed" }>;

export type AfOutputExecution = Readonly<{
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  cancelled?: boolean;
}>;

export type AfVersionFacts = Readonly<{
  fixtureSchema: typeof EXPECTED_FIXTURE_SCHEMA;
  runtime: typeof EXPECTED_RUNTIME;
  operatingSystem: "darwin" | "linux";
  architecture: "arm64" | "x64" | "arm" | "ia32";
}>;

export type AfSchemaFacts = Readonly<{
  fixtureSchema: typeof EXPECTED_FIXTURE_SCHEMA;
  workspaceFormat: typeof EXPECTED_WORKSPACE_FORMAT;
  schemaKeys: readonly [
    "inference_types",
    "node_types",
    "workflow_states",
    "epistemic_states",
    "taint_states",
    "challenge_targets",
  ];
}>;

export type AfInitFacts = Readonly<{
  fixtureSchema: typeof EXPECTED_FIXTURE_SCHEMA;
  workspaceFormat: typeof EXPECTED_WORKSPACE_FORMAT;
  entryCount: number;
  directoryCount: number;
  fileCount: number;
}>;

export type AfStatusFacts = Readonly<{
  fixtureSchema: typeof EXPECTED_FIXTURE_SCHEMA;
  workspaceFormat: typeof EXPECTED_WORKSPACE_FORMAT;
  rootState: "pending" | "available" | "resolved" | "refuted";
  rootResolution: "unresolved" | "conditional" | "accepted" | "refuted";
  statistics: Readonly<{
    totalNodes: number;
    pendingNodes: number;
    unresolvedNodes: number;
    totalChallenges: number;
    openChallenges: number;
  }>;
  jobs: Readonly<{ proverJobs: number; verifierJobs: number }>;
  nodeCount: number;
  challengeCount: number;
}>;

export type AfOutputSuccess<T> = Readonly<{
  ok: true;
  facts: T;
  structuralStatus: null;
}>;

export type AfOutputResult<T> = AfOutputSuccess<T> | { ok: false; failure: AfOutputFailure };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH;

const isSafePlaceholder = (value: unknown): value is string =>
  isBoundedString(value) &&
  !value.startsWith("/") &&
  !/^[A-Za-z]:[\\/]/u.test(value) &&
  !value.split(/[\\/]/u).includes("..") &&
  !/[;&|`$\n\r]/u.test(value) &&
  !/(?:prompt|source[-_ ]?packet|private[-_ ]?reasoning|chain[-_ ]?of[-_ ]?thought|secret|password|token|authorization|credential|api[-_ ]?key)/iu.test(
    value,
  );

const failure = (reason: Parameters<typeof classifyAfRuntimeResult>[0]): AfOutputResult<never> => ({
  ok: false,
  failure: classifyAfRuntimeResult(reason),
});

const executionFailure = (execution: AfOutputExecution): AfOutputResult<never> | undefined => {
  if (execution.cancelled) return failure("cancelled");
  if (execution.timedOut) return failure("timeout");
  if (execution.signal) return failure("signaled");
  if (execution.exitCode !== undefined && execution.exitCode !== 0) return failure("non-zero");
  return undefined;
};

const outputExitFailure = (value: Record<string, unknown>): AfOutputResult<never> | undefined => {
  if (value.exitCode !== 0) return failure("non-zero");
  return undefined;
};

const parseJson = (stdout: string, execution: AfOutputExecution): AfOutputResult<Record<string, unknown>> => {
  const executionError = executionFailure(execution);
  if (executionError) return executionError;
  if (typeof stdout !== "string" || new TextEncoder().encode(stdout).length > MAX_OUTPUT_BYTES) {
    return failure("oversized");
  }
  try {
    const value: unknown = JSON.parse(stdout);
    return isRecord(value) ? { ok: true, facts: value, structuralStatus: null } : failure("malformed");
  } catch {
    return failure("malformed");
  }
};

const fixtureHeader = (value: Record<string, unknown>): boolean => value.fixtureSchema === EXPECTED_FIXTURE_SCHEMA;

const normalizeRuntime = (value: unknown): AfVersionFacts["runtime"] | undefined => {
  if (!isRecord(value)) return undefined;
  const buildDate = value.buildDate ?? value.build_date;
  const goVersion = value.goVersion ?? value.go_version;
  if (
    value.executableName !== EXPECTED_RUNTIME.executableName ||
    value.version !== EXPECTED_RUNTIME.version ||
    value.commit !== EXPECTED_RUNTIME.commit ||
    buildDate !== EXPECTED_RUNTIME.buildDate ||
    goVersion !== EXPECTED_RUNTIME.goVersion
  )
    return undefined;
  return EXPECTED_RUNTIME;
};

const normalizePlatform = (value: unknown): Pick<AfVersionFacts, "operatingSystem" | "architecture"> | undefined => {
  if (!isRecord(value) || !isBoundedString(value.operatingSystem) || !isBoundedString(value.architecture))
    return undefined;
  if (!["darwin", "linux"].includes(value.operatingSystem)) return undefined;
  if (!["arm64", "x64", "arm", "ia32"].includes(value.architecture)) return undefined;
  return {
    operatingSystem: value.operatingSystem as AfVersionFacts["operatingSystem"],
    architecture: value.architecture as AfVersionFacts["architecture"],
  };
};

export function parseAfVersionOutput(
  stdout: string,
  execution: AfOutputExecution = {},
): AfOutputResult<AfVersionFacts> {
  const parsed = parseJson(stdout, execution);
  if (!parsed.ok) return parsed;
  const runtime = normalizeRuntime(parsed.facts.runtime);
  const platform = normalizePlatform(parsed.facts.platform);
  const exitFailure = outputExitFailure(parsed.facts);
  if (exitFailure) return exitFailure;
  if (!fixtureHeader(parsed.facts) || !runtime || !platform || !Array.isArray(parsed.facts.argv))
    return failure("unknown");
  return { ok: true, facts: { fixtureSchema: EXPECTED_FIXTURE_SCHEMA, runtime, ...platform }, structuralStatus: null };
}

export function parseAfSchemaOutput(stdout: string, execution: AfOutputExecution = {}): AfOutputResult<AfSchemaFacts> {
  const parsed = parseJson(stdout, execution);
  if (!parsed.ok) return parsed;
  const schema = parsed.facts.schema;
  const exitFailure = outputExitFailure(parsed.facts);
  if (exitFailure) return exitFailure;
  const keys = [
    "inference_types",
    "node_types",
    "workflow_states",
    "epistemic_states",
    "taint_states",
    "challenge_targets",
  ] as const;
  if (
    !fixtureHeader(parsed.facts) ||
    parsed.facts.workspaceFormat !== EXPECTED_WORKSPACE_FORMAT ||
    !isRecord(schema) ||
    !keys.every((key) => Array.isArray(schema[key]))
  )
    return failure("unknown");
  return {
    ok: true,
    facts: { fixtureSchema: EXPECTED_FIXTURE_SCHEMA, workspaceFormat: EXPECTED_WORKSPACE_FORMAT, schemaKeys: keys },
    structuralStatus: null,
  };
}

export function parseAfInitOutput(stdout: string, execution: AfOutputExecution = {}): AfOutputResult<AfInitFacts> {
  const parsed = parseJson(stdout, execution);
  if (!parsed.ok) return parsed;
  const workspace = parsed.facts.workspace;
  const entries = isRecord(workspace) ? workspace.entries : undefined;
  const exitFailure = outputExitFailure(parsed.facts);
  if (exitFailure) return exitFailure;
  if (
    !fixtureHeader(parsed.facts) ||
    !isRecord(workspace) ||
    workspace.format !== EXPECTED_WORKSPACE_FORMAT ||
    !Array.isArray(entries)
  )
    return failure("unknown");
  let directoryCount = 0;
  let fileCount = 0;
  for (const entry of entries) {
    if (!isRecord(entry) || !isSafePlaceholder(entry.path) || !["file", "directory"].includes(String(entry.kind)))
      return failure("audit-failure");
    if (entry.kind === "directory") directoryCount += 1;
    else fileCount += 1;
  }
  return {
    ok: true,
    facts: {
      fixtureSchema: EXPECTED_FIXTURE_SCHEMA,
      workspaceFormat: EXPECTED_WORKSPACE_FORMAT,
      entryCount: entries.length,
      directoryCount,
      fileCount,
    },
    structuralStatus: null,
  };
}

export function parseAfStatusOutput(stdout: string, execution: AfOutputExecution = {}): AfOutputResult<AfStatusFacts> {
  const parsed = parseJson(stdout, execution);
  if (!parsed.ok) return parsed;
  const status = parsed.facts.status;
  const root = isRecord(status) ? status.root : undefined;
  const statistics = isRecord(status) ? status.statistics : undefined;
  const jobs = isRecord(status) ? status.jobs : undefined;
  const nodes = isRecord(status) ? status.nodes : undefined;
  const challenges = isRecord(status) ? status.challenges : undefined;
  const exitFailure = outputExitFailure(parsed.facts);
  if (exitFailure) return exitFailure;
  if (
    !fixtureHeader(parsed.facts) ||
    !isRecord(status) ||
    status.workspaceFormat !== EXPECTED_WORKSPACE_FORMAT ||
    !isRecord(root) ||
    !isRecord(statistics) ||
    !isRecord(jobs) ||
    !Array.isArray(nodes) ||
    !Array.isArray(challenges) ||
    !["pending", "available", "resolved", "refuted"].includes(String(root.state)) ||
    !["unresolved", "conditional", "accepted", "refuted"].includes(String(root.resolution))
  )
    return failure("unknown");
  const numeric = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value) && value >= 0;
  const values = [
    statistics.total_nodes,
    statistics.total_challenges,
    statistics.open_challenges,
    jobs.prover_jobs,
    jobs.verifier_jobs,
  ];
  if (!values.every(numeric) || !nodes.every((node) => isRecord(node) && Object.values(node).every(isSafePlaceholder)))
    return failure("audit-failure");
  return {
    ok: true,
    facts: {
      fixtureSchema: EXPECTED_FIXTURE_SCHEMA,
      workspaceFormat: EXPECTED_WORKSPACE_FORMAT,
      rootState: root.state as AfStatusFacts["rootState"],
      rootResolution: root.resolution as AfStatusFacts["rootResolution"],
      statistics: {
        totalNodes: statistics.total_nodes as number,
        pendingNodes:
          isRecord(statistics.epistemic_state) && numeric(statistics.epistemic_state.pending)
            ? statistics.epistemic_state.pending
            : 0,
        unresolvedNodes:
          isRecord(statistics.taint_state) && numeric(statistics.taint_state.unresolved)
            ? statistics.taint_state.unresolved
            : 0,
        totalChallenges: statistics.total_challenges as number,
        openChallenges: statistics.open_challenges as number,
      },
      jobs: { proverJobs: jobs.prover_jobs as number, verifierJobs: jobs.verifier_jobs as number },
      nodeCount: nodes.length,
      challengeCount: challenges.length,
    },
    structuralStatus: null,
  };
}
