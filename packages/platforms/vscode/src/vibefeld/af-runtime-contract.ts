/**
 * Platform-private evidence for the AF bridge contract.
 *
 * These shapes describe recorded observations and boundary requirements only.
 * They are deliberately not part of the host/webview protocol and do not
 * authorize loading a runtime or starting a process. The synthetic
 * `af-runtime-fixture-1` envelope and its `AF_FIXTURE_*` constants are an
 * explicit test double: sanitized real captures are the live-shape reference
 * and fixture evidence is never production runtime evidence.
 */

/** Test-double schema tag for the synthetic fixture envelope; never production evidence. */
export type AfFixtureSchemaVersion = `af-runtime-fixture-${number}`;

export type AfRuntimeIdentity = {
  executableName: "af";
  version: string;
  commit: string;
  buildDate: string;
  goVersion: string;
};

export type AfCapturePlatform = {
  operatingSystem: "darwin" | "linux" | "windows";
  architecture: "arm64" | "x64" | "arm" | "ia32";
};

export type AfWorkspaceMetadata = {
  format: string;
  root: "fixture-workspace";
};

export type AfJsonPrimitive = string | number | boolean | null;
export type AfJsonValue = AfJsonPrimitive | AfJsonValue[] | { readonly [key: string]: AfJsonValue };

export type AfWorkspaceEffect = {
  path: string;
  kind: "file" | "directory" | "symlink";
  effect: "created" | "modified" | "removed" | "unchanged";
};

export type AfObservedSuccess = {
  outcome: "success";
  exitCode: 0;
  output: AfJsonValue;
};

export type AfObservedFailure = {
  outcome: "failure";
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  cancelled?: boolean;
  output?: AfJsonValue;
};

export type AfObservedResult = AfObservedSuccess | AfObservedFailure;

export type AfCommandObservation = {
  name: string;
  argv: readonly [string, ...string[]];
  result: AfObservedResult;
  workspaceEffects: readonly AfWorkspaceEffect[];
};

/** Observed commands are evidence; they are not executable capabilities. */
export type AfObservedOperation = AfCommandObservation;

/** This phase intentionally has no approved production operations. */
export type AfApprovedOperationSet = readonly [];

/** The evidence corpus must not become an execution allowlist. */
export const AF_APPROVED_OPERATIONS: AfApprovedOperationSet = [];

export const AF_EXECUTION_REQUIREMENTS = Object.freeze({
  executable: "host-resolved-fixed-executable",
  argv: "typed-fixed-operations",
  shell: false,
  reviewRoot: "context.globalStorageUri",
  descendantPolicy: "inherited-by-descendants",
  boundedInput: "required",
  boundedOutput: "required",
  timeout: "operation-specific-required",
  cancellation: "terminate-and-reap-descendants",
  downgrade: "never-unsandboxed-or-chat-sandbox",
} as const);

export const AF_REVIEW_ROOT_REQUIREMENTS = Object.freeze({
  location: "context.globalStorageUri",
  confinement: "unique-descendant-root",
  excludes: ["repository", "home-directory", "opencode-state", "sibling-review-roots"],
  protections: ["traversal", "symlink", "rename", "outside-root-write"],
} as const);

export type AfRuntimeResultKind =
  | "success"
  | "unknown"
  | "non-zero"
  | "malformed"
  | "oversized"
  | "timeout"
  | "cancelled"
  | "signaled"
  | "policy-failure"
  | "cleanup-failure"
  | "audit-failure";

export type AfResultClassification =
  | { outcome: "observed-success"; structuralStatus: null }
  | {
      outcome: "unavailable" | "audit-failed";
      reason: Exclude<AfRuntimeResultKind, "success">;
      structuralStatus: null;
    };

/**
 * Classify a result without projecting it into a review status. Unknown and
 * execution-boundary failures remain non-success, even if a child emitted
 * data that resembles a valid result.
 */
export function classifyAfRuntimeResult(kind: AfRuntimeResultKind): AfResultClassification {
  if (kind === "success") {
    return { outcome: "observed-success", structuralStatus: null };
  }

  const auditFailure = kind === "policy-failure" || kind === "cleanup-failure" || kind === "audit-failure";
  return {
    outcome: auditFailure ? "audit-failed" : "unavailable",
    reason: kind,
    structuralStatus: null,
  };
}

/** Fixture test-double evidence records; not production runtime evidence. */
export type AfRuntimeEvidence = {
  schemaVersion: AfFixtureSchemaVersion;
  runtime: AfRuntimeIdentity;
  platform: AfCapturePlatform;
  workspace: AfWorkspaceMetadata;
  observedOperations: readonly AfObservedOperation[];
  approvedOperations: AfApprovedOperationSet;
};

/** Fixture test-double compatibility result; not a live compatibility verdict. */
export type AfCompatibility =
  | { state: "compatible"; schemaVersion: AfFixtureSchemaVersion; runtime: AfRuntimeIdentity }
  | { state: "incompatible"; reason: "schema" | "runtime" | "platform" | "workspace" | "incomplete" };

export type AfProcessBoundaryRequirements = {
  supportedPlatforms: readonly ["darwin" | "linux", ...("darwin" | "linux")[]];
  policy: "dedicated-separate-from-chat-sandbox";
  executableResolution: "host-resolved-fixed-executable";
  operations: readonly ["version", "schema", "init", "status"];
  argv: "typed-fixed-operations";
  shell: false;
  reviewRoot: "context.globalStorageUri";
  deniedWriteDomains: readonly ["repository", "home-directory", "opencode-state", "sibling-review-roots"];
  descendantConfinement: "required";
  pathEscapeProtection: readonly ["traversal", "symlink", "rename"];
  unapprovedChildExecution: "denied";
  boundedInput: true;
  boundedOutput: true;
  timeout: "operation-specific";
  cancellation: "terminate-and-reap-descendants";
  cleanup: "fail-closed";
  downgrade: "never-unsandboxed-or-chat-sandbox";
  failureMode: "fail-closed";
};

/** The complete future boundary is a contract, not an executable policy. */
export const AF_PROCESS_BOUNDARY_REQUIREMENTS: AfProcessBoundaryRequirements = Object.freeze({
  supportedPlatforms: ["darwin", "linux"],
  policy: "dedicated-separate-from-chat-sandbox",
  executableResolution: "host-resolved-fixed-executable",
  operations: ["version", "schema", "init", "status"],
  argv: "typed-fixed-operations",
  shell: false,
  reviewRoot: "context.globalStorageUri",
  deniedWriteDomains: ["repository", "home-directory", "opencode-state", "sibling-review-roots"],
  descendantConfinement: "required",
  pathEscapeProtection: ["traversal", "symlink", "rename"],
  unapprovedChildExecution: "denied",
  boundedInput: true,
  boundedOutput: true,
  timeout: "operation-specific",
  cancellation: "terminate-and-reap-descendants",
  cleanup: "fail-closed",
  downgrade: "never-unsandboxed-or-chat-sandbox",
  failureMode: "fail-closed",
} as const);

export type AfRuntimeContract = {
  evidence: AfRuntimeEvidence;
  compatibility: AfCompatibility;
  processBoundary: AfProcessBoundaryRequirements;
};

/** Limits are intentionally small because fixture data is evidence, not a log. */
export const AF_FIXTURE_LIMITS = Object.freeze({
  jsonBytes: 32_768,
  stringLength: 256,
  argumentLength: 256,
  argumentCount: 32,
  operationCount: 32,
  workspaceEffectCount: 128,
  jsonDepth: 8,
  jsonKeys: 256,
} as const);

export type AfFixtureValidationError = {
  code:
    | "malformed-json"
    | "invalid-shape"
    | "unsupported-schema"
    | "unsupported-runtime"
    | "unsupported-platform"
    | "unsupported-workspace"
    | "incomplete-boundary"
    | "unsafe-value"
    | "unbounded-value";
  message: string;
};

export type AfFixtureValidation =
  | { ok: true; value: AfRuntimeContract }
  | { ok: false; errors: readonly AfFixtureValidationError[] };

/** Explicit fixture test-double schema marker for the synthetic envelope; never production evidence. */
export const AF_FIXTURE_SCHEMA_VERSION = "af-runtime-fixture-1" as const;
/** Explicit fixture test-double runtime identity for the synthetic envelope; never production evidence. */
export const AF_FIXTURE_RUNTIME_IDENTITY: AfRuntimeIdentity = {
  executableName: "af",
  version: "0.1.7",
  commit: "5a37413",
  buildDate: "2026-09-08T02:25:39Z",
  goVersion: "go1.27.1",
};
/** Explicit fixture test-double capture platform for the synthetic envelope; never production evidence. */
export const AF_FIXTURE_PLATFORM: AfCapturePlatform = { operatingSystem: "darwin", architecture: "arm64" };
/** Explicit fixture test-double workspace identity for the synthetic envelope; never production evidence. */
export const AF_FIXTURE_WORKSPACE: AfWorkspaceMetadata = { format: "1.0", root: "fixture-workspace" };
const UNSAFE_MARKER =
  /(?:prompt|source[-_ ]?packet|private[-_ ]?reasoning|chain[-_ ]?of[-_ ]?thought|secret|password|token|authorization|credential|api[-_ ]?key)/i;
const SHELL_TOKEN = /[;&|`$\n\r]|\$\(|\b(?:sh|bash|zsh|fish|powershell|cmd)\s+-c\b/i;
const UNSAFE_ARGUMENT = /^--(?:exec(?:utable)?|binary|workspace(?:-dir)?|config|env|shell|plugin)(?:=|$)/i;
const ALLOWED_PLACEHOLDER = /^<(?:fixture-workspace|missing-workspace|fixture-conjecture|fixture-author)>$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const error = (code: AfFixtureValidationError["code"], message: string): AfFixtureValidationError => ({
  code,
  message,
});

const pathIsUnsafe = (value: string): boolean =>
  value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]/u).includes("..");

const validateJsonValue = (
  value: unknown,
  depth: number,
  state: { keys: number },
  errors: AfFixtureValidationError[],
): void => {
  if (depth > AF_FIXTURE_LIMITS.jsonDepth) {
    errors.push(error("unbounded-value", "fixture JSON exceeds the maximum nesting depth"));
    return;
  }
  if (typeof value === "string") {
    if (value.length > AF_FIXTURE_LIMITS.stringLength)
      errors.push(error("unbounded-value", "fixture string exceeds the maximum length"));
    if (pathIsUnsafe(value)) errors.push(error("unsafe-value", "fixture contains an absolute or escaping path"));
    if (UNSAFE_MARKER.test(value)) errors.push(error("unsafe-value", "fixture contains a restricted value"));
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push(error("invalid-shape", "fixture contains a non-finite number"));
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > AF_FIXTURE_LIMITS.workspaceEffectCount)
      errors.push(error("unbounded-value", "fixture array exceeds the maximum length"));
    value.forEach((item) => {
      validateJsonValue(item, depth + 1, state, errors);
    });
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => {
      state.keys += 1;
      if (state.keys > AF_FIXTURE_LIMITS.jsonKeys) return;
      if (UNSAFE_MARKER.test(key)) errors.push(error("unsafe-value", "fixture contains a restricted field"));
      validateJsonValue(item, depth + 1, state, errors);
    });
  }
};

const readString = (value: unknown): value is string =>
  typeof value === "string" && value.length <= AF_FIXTURE_LIMITS.stringLength;

const normalizeRuntime = (value: unknown): AfRuntimeIdentity | undefined => {
  if (!isRecord(value)) return undefined;
  const buildDate = value.buildDate ?? value.build_date;
  const goVersion = value.goVersion ?? value.go_version;
  if (![value.executableName, value.version, value.commit, buildDate, goVersion].every(readString)) return undefined;
  return {
    executableName: value.executableName === "af" ? "af" : (value.executableName as "af"),
    version: value.version,
    commit: value.commit,
    buildDate,
    goVersion,
  };
};

const normalizePlatform = (value: unknown): AfCapturePlatform | undefined => {
  if (!isRecord(value) || !readString(value.operatingSystem) || !readString(value.architecture)) return undefined;
  if (
    !["darwin", "linux", "windows"].includes(value.operatingSystem) ||
    !["arm64", "x64", "arm", "ia32"].includes(value.architecture)
  )
    return undefined;
  return {
    operatingSystem: value.operatingSystem as AfCapturePlatform["operatingSystem"],
    architecture: value.architecture as AfCapturePlatform["architecture"],
  };
};

const validateArgv = (value: unknown, errors: AfFixtureValidationError[]): value is readonly [string, ...string[]] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > AF_FIXTURE_LIMITS.argumentCount ||
    !value.every(readString)
  ) {
    errors.push(error("invalid-shape", "observed argv must be a bounded non-empty string array"));
    return false;
  }
  if (value[0] !== "af") errors.push(error("unsafe-value", "observed argv must invoke the observed af executable"));
  value.forEach((argument, index) => {
    const previous = value[index - 1];
    const isDirectoryArgument = previous === "--dir";
    if (
      argument.length > AF_FIXTURE_LIMITS.argumentLength ||
      SHELL_TOKEN.test(argument) ||
      pathIsUnsafe(argument) ||
      UNSAFE_ARGUMENT.test(argument) ||
      (isDirectoryArgument && !ALLOWED_PLACEHOLDER.test(argument))
    ) {
      errors.push(error("unsafe-value", "observed argv contains an unsafe argument"));
    }
  });
  return true;
};

const normalizeResult = (value: unknown, errors: AfFixtureValidationError[]): AfObservedResult | undefined => {
  if (!isRecord(value) || (value.outcome !== "success" && value.outcome !== "failure")) {
    errors.push(error("invalid-shape", "observed result has an unsupported outcome"));
    return undefined;
  }
  if (typeof value.exitCode !== "undefined" && (!Number.isInteger(value.exitCode) || value.exitCode < 0)) {
    errors.push(error("invalid-shape", "observed exit code is invalid"));
  }
  if (typeof value.signal !== "undefined" && !readString(value.signal))
    errors.push(error("invalid-shape", "observed signal is invalid"));
  ["timedOut", "cancelled"].forEach((key) => {
    if (typeof value[key] !== "undefined" && typeof value[key] !== "boolean")
      errors.push(error("invalid-shape", "observed boundary fact is invalid"));
  });
  if (value.outcome === "success" && value.exitCode !== 0)
    errors.push(error("invalid-shape", "observed success must have exit code zero"));
  if (value.outcome === "failure" && value.exitCode === 0)
    errors.push(error("invalid-shape", "observed failure cannot have exit code zero"));
  if (typeof value.output !== "undefined") validateJsonValue(value.output, 0, { keys: 0 }, errors);
  return value.outcome === "success"
    ? { outcome: "success", exitCode: 0, output: (value.output ?? null) as AfJsonValue }
    : {
        outcome: "failure",
        ...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
        ...(typeof value.signal === "string" ? { signal: value.signal } : {}),
        ...(typeof value.timedOut === "boolean" ? { timedOut: value.timedOut } : {}),
        ...(typeof value.cancelled === "boolean" ? { cancelled: value.cancelled } : {}),
        ...(typeof value.output !== "undefined" ? { output: value.output as AfJsonValue } : {}),
      };
};

const normalizeOperation = (value: unknown, errors: AfFixtureValidationError[]): AfObservedOperation | undefined => {
  if (!isRecord(value) || !readString(value.name)) {
    errors.push(error("invalid-shape", "observed operation is incomplete"));
    return undefined;
  }
  const argv = validateArgv(value.argv, errors) ? ([...value.argv] as [string, ...string[]]) : undefined;
  const result = normalizeResult(value.result, errors);
  if (
    !Array.isArray(value.workspaceEffects) ||
    value.workspaceEffects.length > AF_FIXTURE_LIMITS.workspaceEffectCount
  ) {
    errors.push(error("invalid-shape", "workspace effects are missing or unbounded"));
    return undefined;
  }
  const workspaceEffects: AfWorkspaceEffect[] = [];
  for (const effect of value.workspaceEffects) {
    if (
      !isRecord(effect) ||
      !readString(effect.path) ||
      pathIsUnsafe(effect.path) ||
      effect.path.startsWith("fixture-workspace/") === false ||
      !["file", "directory", "symlink"].includes(String(effect.kind)) ||
      !["created", "modified", "removed", "unchanged"].includes(String(effect.effect))
    ) {
      errors.push(error("unsafe-value", "workspace effect is not fixture-relative and normalized"));
      continue;
    }
    workspaceEffects.push({
      path: effect.path,
      kind: effect.kind as AfWorkspaceEffect["kind"],
      effect: effect.effect as AfWorkspaceEffect["effect"],
    });
  }
  if (!argv || !result) return undefined;
  return { name: value.name, argv, result, workspaceEffects };
};

const hasExactArray = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);

const hasCompleteBoundary = (value: unknown): value is AfProcessBoundaryRequirements =>
  isRecord(value) &&
  hasExactArray(value.supportedPlatforms, ["darwin", "linux"]) &&
  value.policy === "dedicated-separate-from-chat-sandbox" &&
  value.executableResolution === "host-resolved-fixed-executable" &&
  hasExactArray(value.operations, ["version", "schema", "init", "status"]) &&
  value.argv === "typed-fixed-operations" &&
  value.shell === false &&
  value.reviewRoot === "context.globalStorageUri" &&
  hasExactArray(value.deniedWriteDomains, ["repository", "home-directory", "opencode-state", "sibling-review-roots"]) &&
  value.descendantConfinement === "required" &&
  hasExactArray(value.pathEscapeProtection, ["traversal", "symlink", "rename"]) &&
  value.unapprovedChildExecution === "denied" &&
  value.boundedInput === true &&
  value.boundedOutput === true &&
  value.timeout === "operation-specific" &&
  value.cancellation === "terminate-and-reap-descendants" &&
  value.cleanup === "fail-closed" &&
  value.downgrade === "never-unsandboxed-or-chat-sandbox" &&
  value.failureMode === "fail-closed";

/** Parse JSON without touching the filesystem or returning malformed payloads. */
export function parseAfFixtureJson(json: string): AfFixtureValidation {
  if (typeof json !== "string" || new TextEncoder().encode(json).length > AF_FIXTURE_LIMITS.jsonBytes) {
    return { ok: false, errors: [error("unbounded-value", "fixture JSON exceeds the maximum byte length")] };
  }
  try {
    return normalizeAfFixture(JSON.parse(json) as unknown);
  } catch {
    return { ok: false, errors: [error("malformed-json", "fixture JSON is malformed")] };
  }
}

/** Normalize a manifest-shaped fixture into a non-executable private contract. */
export function normalizeAfFixture(input: unknown): AfFixtureValidation {
  const errors: AfFixtureValidationError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [error("invalid-shape", "fixture root must be an object")] };
  validateJsonValue(input, 0, { keys: 0 }, errors);
  const runtime = normalizeRuntime(input.runtime);
  const platform = normalizePlatform(input.capturePlatform ?? input.platform);
  const processBoundary = input.processBoundary;
  const workspace =
    isRecord(input.workspace) && input.workspace.format === "1.0" && input.workspace.root === "fixture-workspace"
      ? AF_FIXTURE_WORKSPACE
      : undefined;
  if (input.fixtureSchema !== AF_FIXTURE_SCHEMA_VERSION)
    errors.push(error("unsupported-schema", "fixture schema is unsupported"));
  if (!runtime || JSON.stringify(runtime) !== JSON.stringify(AF_FIXTURE_RUNTIME_IDENTITY))
    errors.push(error("unsupported-runtime", "fixture runtime identity is unsupported"));
  if (!platform || JSON.stringify(platform) !== JSON.stringify(AF_FIXTURE_PLATFORM))
    errors.push(error("unsupported-platform", "fixture capture platform is unsupported"));
  if (!workspace) errors.push(error("unsupported-workspace", "fixture workspace identity is unsupported"));
  if (!hasCompleteBoundary(processBoundary))
    errors.push(error("incomplete-boundary", "fixture process boundary is incomplete or unsupported"));
  if (!Array.isArray(input.observedOperations) || input.observedOperations.length > AF_FIXTURE_LIMITS.operationCount)
    errors.push(error("invalid-shape", "fixture observations are missing or unbounded"));
  if (!Array.isArray(input.approvedOperations) || input.approvedOperations.length !== 0)
    errors.push(error("incomplete-boundary", "fixture must approve no production operations"));
  if (
    errors.length > 0 ||
    !runtime ||
    !platform ||
    !workspace ||
    !hasCompleteBoundary(processBoundary) ||
    !Array.isArray(input.observedOperations)
  )
    return { ok: false, errors };
  const observedOperations = input.observedOperations
    .map((operation) => normalizeOperation(operation, errors))
    .filter((operation): operation is AfObservedOperation => operation !== undefined);
  if (observedOperations.length !== input.observedOperations.length || errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      evidence: {
        schemaVersion: AF_FIXTURE_SCHEMA_VERSION,
        runtime,
        platform,
        workspace,
        observedOperations,
        approvedOperations: AF_APPROVED_OPERATIONS,
      },
      compatibility: { state: "compatible", schemaVersion: AF_FIXTURE_SCHEMA_VERSION, runtime },
      processBoundary,
    },
  };
}
