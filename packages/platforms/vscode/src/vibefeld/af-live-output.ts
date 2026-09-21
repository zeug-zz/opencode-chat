import { type AfResultClassification, classifyAfRuntimeResult } from "./af-runtime-contract";

/**
 * Live AF output parsers for the sanitized real capture shapes (af 0.1.11).
 *
 * These parsers are deliberately separate from the fixture-schema parser: they
 * accept only the real CLI shapes, reject fixture-shaped evidence, and return
 * bounded host-private facts. They are pure functions over a bounded stdout
 * string plus an execution fact; they never launch a child process, touch the
 * filesystem or network, and do not import the fixture envelope.
 */

const MAX_OUTPUT_BYTES = 32_768;
const MAX_TEXT_LENGTH = 256;

const FIXTURE_MARKERS = [
  "af-runtime-fixture",
  "fixtureschema",
  "fixture-workspace",
  "missing-workspace",
  "<fixture-",
] as const;

const LIVE_INIT_SUCCESS_LINE = /^\s*Proof initialized successfully\b/im;

const UNSAFE_VALUE =
  /(?:prompt|source[-_ ]?packet|private[-_ ]?reasoning|chain[-_ ]?of[-_ ]?thought|secret|password|token|authorization|credential|api[-_ ]?key)/iu;
const SHELL_TOKEN = /[;&|`$\n\r]/u;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;
const SUPPORTED_LIVE_PLATFORMS = ["darwin", "linux"] as const;
const SUPPORTED_LIVE_ARCHITECTURES = ["arm64", "x64", "arm", "ia32"] as const;

/** Section keys of the real `af schema --format json` result. */
export const AF_LIVE_SCHEMA_SECTIONS = [
  "inference_types",
  "node_types",
  "workflow_states",
  "epistemic_states",
  "taint_states",
  "challenge_targets",
] as const;

export type AfLiveSchemaSection = (typeof AF_LIVE_SCHEMA_SECTIONS)[number];

export type AfLiveOutputExecution = Readonly<{
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  cancelled?: boolean;
}>;

/** Flat `af version --json` fields; AF exposes no OS or architecture field. */
export type AfLiveVersionFacts = Readonly<{
  version: string;
  commit: string;
  buildDate: string;
  goVersion: string;
  format: string;
  policy: string;
}>;

export type AfLiveSchemaFacts = Readonly<{
  sections: Readonly<Record<AfLiveSchemaSection, number>>;
  totalEntries: number;
}>;

export type AfLiveInitFacts = Readonly<{ initialized: true }>;

export type AfLiveStatusFacts = Readonly<{
  statistics: Readonly<{ totalNodes: number; totalChallenges: number; openChallenges: number }>;
  jobs: Readonly<{ proverJobs: number; verifierJobs: number }>;
  nodeCount: number;
}>;

export type AfLiveHostPlatform = Readonly<{
  operatingSystem: (typeof SUPPORTED_LIVE_PLATFORMS)[number];
  architecture: (typeof SUPPORTED_LIVE_ARCHITECTURES)[number];
}>;

type AfLiveFailure = Extract<AfResultClassification, { outcome: "unavailable" | "audit-failed" }>;

export type AfLiveOutputResult<T> =
  | Readonly<{ ok: true; facts: T; structuralStatus: null }>
  | Readonly<{ ok: false; failure: AfLiveFailure }>;

type AfLiveTextRead =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; reason: "unknown" | "audit-failure" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const failure = (reason: Parameters<typeof classifyAfRuntimeResult>[0]): AfLiveOutputResult<never> => ({
  ok: false,
  failure: classifyAfRuntimeResult(reason),
});

const executionFailure = (execution: AfLiveOutputExecution): AfLiveOutputResult<never> | undefined => {
  if (execution.cancelled) return failure("cancelled");
  if (execution.timedOut) return failure("timeout");
  if (execution.signal) return failure("signaled");
  if (execution.exitCode !== undefined && execution.exitCode !== 0) return failure("non-zero");
  return undefined;
};

/** Live mode never promotes a fixture schema, placeholder, or workspace identity. */
const fixtureShaped = (stdout: string): boolean => {
  const lowered = stdout.toLowerCase();
  return FIXTURE_MARKERS.some((marker) => lowered.includes(marker));
};

const parseBoundedJson = (
  stdout: string,
  execution: AfLiveOutputExecution,
): AfLiveOutputResult<Record<string, unknown>> => {
  const executionError = executionFailure(execution);
  if (executionError) return executionError;
  if (typeof stdout !== "string" || new TextEncoder().encode(stdout).length > MAX_OUTPUT_BYTES)
    return failure("oversized");
  if (fixtureShaped(stdout)) return failure("unknown");
  try {
    const value: unknown = JSON.parse(stdout);
    return isRecord(value) ? { ok: true, facts: value, structuralStatus: null } : failure("malformed");
  } catch {
    return failure("malformed");
  }
};

const isBoundedText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH;

const isSafeText = (value: string): boolean =>
  !value.startsWith("/") &&
  !WINDOWS_ABSOLUTE_PATH.test(value) &&
  !value.split(/[\\/]/u).includes("..") &&
  !SHELL_TOKEN.test(value) &&
  !UNSAFE_VALUE.test(value);

/** Absent evidence is `unknown`; a present but unbounded or unsafe value is an audit failure. */
const readLiveText = (value: unknown): AfLiveTextRead => {
  if (value === undefined || value === null) return { ok: false, reason: "unknown" };
  if (!isBoundedText(value) || !isSafeText(value)) return { ok: false, reason: "audit-failure" };
  return { ok: true, value };
};

const failedReadReason = (parts: readonly AfLiveTextRead[]): "unknown" | "audit-failure" | undefined => {
  const failed = parts.find((part) => !part.ok);
  return failed && !failed.ok ? failed.reason : undefined;
};

export function parseLiveVersionOutput(
  stdout: string,
  execution: AfLiveOutputExecution = {},
): AfLiveOutputResult<AfLiveVersionFacts> {
  const parsed = parseBoundedJson(stdout, execution);
  if (!parsed.ok) return parsed;
  const parts = [
    readLiveText(parsed.facts.version),
    readLiveText(parsed.facts.commit),
    readLiveText(parsed.facts.build_date ?? parsed.facts.buildDate),
    readLiveText(parsed.facts.go_version ?? parsed.facts.goVersion),
    readLiveText(parsed.facts.format),
    readLiveText(parsed.facts.policy),
  ];
  const reason = failedReadReason(parts);
  if (reason) return failure(reason);
  const texts = parts.map((part) => (part.ok ? part.value : ""));
  const [version, commit, buildDate, goVersion, format, policy] = texts;
  return { ok: true, facts: { version, commit, buildDate, goVersion, format, policy }, structuralStatus: null };
}

export function parseLiveSchemaOutput(
  stdout: string,
  execution: AfLiveOutputExecution = {},
): AfLiveOutputResult<AfLiveSchemaFacts> {
  const parsed = parseBoundedJson(stdout, execution);
  if (!parsed.ok) return parsed;
  const sections: Record<AfLiveSchemaSection, number> = {
    inference_types: 0,
    node_types: 0,
    workflow_states: 0,
    epistemic_states: 0,
    taint_states: 0,
    challenge_targets: 0,
  };
  let totalEntries = 0;
  for (const key of AF_LIVE_SCHEMA_SECTIONS) {
    const section = parsed.facts[key];
    if (!Array.isArray(section)) return failure("unknown");
    for (const entry of section) {
      if (!isRecord(entry)) return failure("unknown");
      const id = readLiveText(entry.id);
      if (!id.ok) return failure(id.reason);
    }
    sections[key] = section.length;
    totalEntries += section.length;
  }
  return { ok: true, facts: { sections, totalEntries }, structuralStatus: null };
}

export function parseLiveInitOutput(
  stdout: string,
  execution: AfLiveOutputExecution = {},
): AfLiveOutputResult<AfLiveInitFacts> {
  const executionError = executionFailure(execution);
  if (executionError) return executionError;
  if (typeof stdout !== "string" || new TextEncoder().encode(stdout).length > MAX_OUTPUT_BYTES)
    return failure("oversized");
  if (fixtureShaped(stdout)) return failure("unknown");
  if (!LIVE_INIT_SUCCESS_LINE.test(stdout)) return failure("malformed");
  // The prose, including any workspace path, is deliberately discarded and never stored.
  return { ok: true, facts: { initialized: true }, structuralStatus: null };
}

export function parseLiveStatusOutput(
  stdout: string,
  execution: AfLiveOutputExecution = {},
): AfLiveOutputResult<AfLiveStatusFacts> {
  const parsed = parseBoundedJson(stdout, execution);
  if (!parsed.ok) return parsed;
  const statistics = parsed.facts.statistics;
  const jobs = parsed.facts.jobs;
  const nodes = parsed.facts.nodes;
  const challenges = parsed.facts.challenges;
  if (!isRecord(statistics) || !isRecord(jobs) || !Array.isArray(nodes) || !Array.isArray(challenges))
    return failure("unknown");
  const aggregates = [
    statistics.total_nodes,
    statistics.total_challenges,
    statistics.open_challenges,
    jobs.prover_jobs,
    jobs.verifier_jobs,
  ];
  const values: number[] = [];
  for (const value of aggregates) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return failure("audit-failure");
    values.push(value);
  }
  const [totalNodes, totalChallenges, openChallenges, proverJobs, verifierJobs] = values;
  return {
    ok: true,
    facts: {
      statistics: { totalNodes, totalChallenges, openChallenges },
      jobs: { proverJobs, verifierJobs },
      nodeCount: nodes.length,
    },
    structuralStatus: null,
  };
}

/**
 * Maps host-supplied platform and architecture values to the bounded supported
 * host set. Callers pass the values read from the host process; parsing never
 * reads process state and never derives platform or architecture from AF output.
 */
export function resolveLiveHostPlatform(platform: string, architecture: string): AfLiveHostPlatform | undefined {
  const operatingSystem = SUPPORTED_LIVE_PLATFORMS.find((value) => value === platform);
  const resolvedArchitecture = SUPPORTED_LIVE_ARCHITECTURES.find((value) => value === architecture);
  if (!operatingSystem || !resolvedArchitecture) return undefined;
  return { operatingSystem, architecture: resolvedArchitecture };
}
