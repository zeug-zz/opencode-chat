import path from "node:path";

const MAX_PATH_LENGTH = 4_096;
const MAX_ARG_LENGTH = 256;
const MAX_ARG_COUNT = 32;
const SHELL_TOKEN = /[;&|`$\n\r]|\$\(|\b(?:sh|bash|zsh|fish|powershell|cmd)\s+-c\b/i;

/**
 * Direct execution readiness. AF runs as a bounded child process of the
 * extension host, under whatever enclosing confinement the user's session
 * already has; the adapter adds no second layer of its own.
 */
export type AfExecutionPolicyReadiness =
  | Readonly<{ state: "ready"; execution: "direct" }>
  | Readonly<{ state: "unavailable" | "ambiguous" }>;

/**
 * The adapter owns every child creation and termination for AF. It is
 * intentionally not implemented by, or coupled to, Chat's sandbox.
 */
export interface AfExecutionPolicyAdapter {
  readonly platform: NodeJS.Platform;
  readonly readiness: AfExecutionPolicyReadiness;
  launch(
    descriptor: AfPolicyDescriptor,
    signal?: AbortSignal,
    limits?: AfPolicyIoLimits,
  ): Promise<AfPolicyExecutionFact>;
  /** Read-only version/schema preflight; it needs no review-root write access. */
  launchPreflight?(
    descriptor: AfPreflightDescriptor,
    signal?: AbortSignal,
    limits?: AfPolicyIoLimits,
  ): Promise<AfPolicyExecutionFact>;
  terminateAndReap(): Promise<AfPolicyCleanupFact>;
}

/** Limits the adapter enforces on the direct child's stdio. */
export type AfPolicyIoLimits = Readonly<{
  stdinBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
}>;

export type AfPolicyExecutionFact = Readonly<{
  outcome: "exited" | "signaled" | "timed-out" | "cancelled";
  exitCode?: number;
  signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
  /** Bounded transport captured by the adapter, never a diagnostic. */
  stdout?: string;
  stderr?: string;
}>;

export type AfPolicyCleanupFact = Readonly<{ outcome: "reaped" | "failed" }>;

/** Only these fields may cross the execution boundary. */
export type AfPolicyRequest = Readonly<{
  executable: string;
  argv: readonly string[];
  cwd: string;
}>;

export type AfPolicyDescriptor = AfPolicyRequest;

export type AfPreflightDescriptor = AfPolicyDescriptor;

export type AfPolicyUnavailableReason =
  | "unsupported-platform"
  | "missing-adapter"
  | "policy-not-ready"
  | "ambiguous-policy"
  | "invalid-request";

export type AfPolicyDescriptorResult =
  | Readonly<{ available: true; descriptor: AfPolicyDescriptor }>
  | Readonly<{ available: false; reason: AfPolicyUnavailableReason }>;

export type AfPreflightDescriptorResult =
  | Readonly<{ available: true; descriptor: AfPreflightDescriptor }>
  | Readonly<{ available: false; reason: AfPolicyUnavailableReason }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const normalizeBoundaryPath = (value: unknown): string | undefined => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.includes("\0") ||
    SHELL_TOKEN.test(value)
  )
    return undefined;
  if (!path.isAbsolute(value)) return undefined;
  const normalized = path.normalize(value);
  const relative = path.relative(path.parse(normalized).root, normalized);
  if (relative.split(path.sep).some((part) => part === "..")) return undefined;
  return normalized;
};

const invalid = (reason: AfPolicyUnavailableReason): { available: false; reason: AfPolicyUnavailableReason } => ({
  available: false,
  reason,
});

/**
 * A descriptor may cross the boundary only when the supplied adapter proves
 * direct-execution readiness and the fixed host-owned argv is bounded, names
 * the validated executable, and carries no caller-controlled extra field.
 */
const validateRequest = (
  request: unknown,
): { ok: true; value: AfPolicyDescriptor } | { ok: false; reason: AfPolicyUnavailableReason } => {
  if (!isRecord(request) || !hasOnlyKeys(request, ["executable", "argv", "cwd"]))
    return { ok: false, reason: "invalid-request" };

  const executable = normalizeBoundaryPath(request.executable);
  const cwd = normalizeBoundaryPath(request.cwd);
  const argv = request.argv;
  if (
    executable === undefined ||
    cwd === undefined ||
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.length > MAX_ARG_COUNT ||
    !argv.every(
      (argument) =>
        typeof argument === "string" &&
        argument.length > 0 &&
        argument.length <= MAX_ARG_LENGTH &&
        !SHELL_TOKEN.test(argument),
    )
  )
    return { ok: false, reason: "invalid-request" };

  const normalizedArgv = [...argv] as string[];
  if (normalizedArgv[0] !== executable) return { ok: false, reason: "invalid-request" };

  return { ok: true, value: { executable, argv: normalizedArgv, cwd } };
};

const readinessRejection = (adapter: AfExecutionPolicyAdapter | undefined): AfPolicyUnavailableReason | undefined => {
  if (adapter === undefined) return "missing-adapter";
  if (adapter.platform !== "darwin" && adapter.platform !== "linux") return "unsupported-platform";
  if (adapter.readiness.state === "ambiguous") return "ambiguous-policy";
  if (adapter.readiness.state !== "ready" || adapter.readiness.execution !== "direct") return "policy-not-ready";
  return undefined;
};

/** Construct a descriptor only after the supplied adapter proves direct readiness. */
export function buildAfPolicyDescriptor(
  adapter: AfExecutionPolicyAdapter | undefined,
  request: AfPolicyRequest,
): AfPolicyDescriptorResult {
  const rejection = readinessRejection(adapter);
  if (rejection) return invalid(rejection);
  const validated = validateRequest(request);
  if (!validated.ok) return invalid(validated.reason);
  return { available: true, descriptor: validated.value };
}

/** Build the same bounded descriptor for the read-only version/schema preflight. */
export function buildAfPreflightDescriptor(
  adapter: AfExecutionPolicyAdapter | undefined,
  request: AfPolicyRequest,
): AfPreflightDescriptorResult {
  return buildAfPolicyDescriptor(adapter, request);
}
