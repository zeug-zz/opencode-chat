import path from "node:path";

const MAX_PATH_LENGTH = 4_096;
const MAX_ARG_LENGTH = 256;
const MAX_ARG_COUNT = 32;
const SHELL_TOKEN = /[;&|`$\n\r]|\$\(|\b(?:sh|bash|zsh|fish|powershell|cmd)\s+-c\b/i;

export const AF_DENIED_POLICY_DOMAINS = [
  "repository",
  "home-directory",
  "opencode-state",
  "sibling-review-roots",
] as const;

export type AfDeniedPolicyDomain = (typeof AF_DENIED_POLICY_DOMAINS)[number];

export type AfPolicyReadiness =
  | Readonly<{
      state: "ready";
      descendantConfinement: "inherited";
      childExecution: "deny-unapproved";
      deniedDomains: "enforced";
      audit: "verified";
    }>
  | Readonly<{ state: "unavailable" | "ambiguous" }>;

/**
 * The adapter is supplied by a separately validated native policy provider.
 * It is intentionally not implemented by, or coupled to, Chat's sandbox.
 */
export interface AfExecutionPolicyAdapter {
  readonly platform: NodeJS.Platform;
  readonly readiness: AfPolicyReadiness;
  launch(
    descriptor: AfPolicyDescriptor,
    signal?: AbortSignal,
    limits?: AfPolicyIoLimits,
  ): Promise<AfPolicyExecutionFact>;
  /** Read-only version/schema preflight; it must not require a review-root grant. */
  launchPreflight?(
    descriptor: AfPreflightDescriptor,
    signal?: AbortSignal,
    limits?: AfPolicyIoLimits,
  ): Promise<AfPolicyExecutionFact>;
  terminateAndReap(): Promise<AfPolicyCleanupFact>;
}

/** Limits supplied to the policy provider; the provider must enforce these on the process tree. */
export type AfPolicyIoLimits = Readonly<{
  stdinBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
}>;

export type AfPolicyExecutionFact = Readonly<{
  outcome: "exited" | "signaled" | "timed-out" | "cancelled";
  exitCode?: number;
  signal?: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGHUP";
  /** Bounded transport captured by the dedicated adapter, never a diagnostic. */
  stdout?: string;
  stderr?: string;
}>;

export type AfPolicyCleanupFact = Readonly<{ outcome: "reaped" | "failed" }>;

export type AfRuntimeReadGrant = Readonly<{ path: string }>;

/** Only these fields may cross the policy boundary. */
export type AfPolicyRequest = Readonly<{
  executable: string;
  argv: readonly [string, ...string[]];
  cwd: string;
  readOnlyRuntimeGrants: readonly AfRuntimeReadGrant[];
  reviewRootWriteGrant: Readonly<{ path: string }>;
}>;

export type AfPolicyDescriptor = Readonly<{
  executable: string;
  argv: readonly [string, ...string[]];
  cwd: string;
  shell: false;
  readOnlyRuntimeGrants: readonly AfRuntimeReadGrant[];
  reviewRootWriteGrant: Readonly<{ path: string }>;
  descendantConfinement: "inherited";
  childExecution: "deny-unapproved";
  deniedDomains: readonly AfDeniedPolicyDomain[];
  network: "deny-denied-domains";
  audit: "verified";
}>;

export type AfPreflightDescriptor = Readonly<{
  executable: string;
  argv: readonly [string, ...string[]];
  cwd: string;
  shell: false;
  readOnlyRuntimeGrants: readonly AfRuntimeReadGrant[];
  descendantConfinement: "inherited";
  childExecution: "deny-unapproved";
  deniedDomains: readonly AfDeniedPolicyDomain[];
  network: "deny-denied-domains";
  audit: "verified";
}>;

export type AfPolicyUnavailableReason =
  | "unsupported-platform"
  | "missing-adapter"
  | "policy-not-ready"
  | "ambiguous-policy"
  | "invalid-request"
  | "invalid-grant-overlap"
  | "invalid-write-grant";

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

const isWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

const overlaps = (left: string, right: string): boolean => isWithin(left, right) || isWithin(right, left);

const invalid = (reason: AfPolicyUnavailableReason): AfPolicyDescriptorResult => ({ available: false, reason });

const validateRequest = (
  request: unknown,
):
  | {
      ok: true;
      value: Omit<
        AfPolicyDescriptor,
        "shell" | "descendantConfinement" | "childExecution" | "deniedDomains" | "network" | "audit"
      >;
    }
  | { ok: false; reason: AfPolicyUnavailableReason } => {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["executable", "argv", "cwd", "readOnlyRuntimeGrants", "reviewRootWriteGrant"])
  )
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

  const normalizedArgv = [...argv] as [string, ...string[]];
  if (normalizedArgv[0] !== executable) return { ok: false, reason: "invalid-request" };

  const grants = request.readOnlyRuntimeGrants;
  if (!Array.isArray(grants) || grants.length === 0) return { ok: false, reason: "invalid-grant-overlap" };
  const readOnlyRuntimeGrants: AfRuntimeReadGrant[] = [];
  for (const grant of grants) {
    if (!isRecord(grant) || !hasOnlyKeys(grant, ["path"])) return { ok: false, reason: "invalid-request" };
    const grantPath = normalizeBoundaryPath(grant.path);
    if (grantPath === undefined || readOnlyRuntimeGrants.some((item) => overlaps(item.path, grantPath)))
      return { ok: false, reason: "invalid-grant-overlap" };
    readOnlyRuntimeGrants.push({ path: grantPath });
  }

  const writeGrant = request.reviewRootWriteGrant;
  if (!isRecord(writeGrant) || !hasOnlyKeys(writeGrant, ["path"])) return { ok: false, reason: "invalid-write-grant" };
  const reviewRoot = normalizeBoundaryPath(writeGrant.path);
  if (reviewRoot === undefined || readOnlyRuntimeGrants.some((grant) => overlaps(grant.path, reviewRoot)))
    return { ok: false, reason: "invalid-write-grant" };
  if (!isWithin(reviewRoot, cwd)) return { ok: false, reason: "invalid-write-grant" };

  return {
    ok: true,
    value: { executable, argv: normalizedArgv, cwd, readOnlyRuntimeGrants, reviewRootWriteGrant: { path: reviewRoot } },
  };
};

/** Construct a descriptor only after the independently supplied policy proves readiness. */
export function buildAfPolicyDescriptor(
  adapter: AfExecutionPolicyAdapter | undefined,
  request: AfPolicyRequest,
): AfPolicyDescriptorResult {
  if (adapter === undefined) return invalid("missing-adapter");
  if (adapter.platform !== "darwin" && adapter.platform !== "linux") return invalid("unsupported-platform");
  if (adapter.readiness.state === "ambiguous") return invalid("ambiguous-policy");
  if (adapter.readiness.state !== "ready") return invalid("policy-not-ready");
  if (
    adapter.readiness.descendantConfinement !== "inherited" ||
    adapter.readiness.childExecution !== "deny-unapproved" ||
    adapter.readiness.deniedDomains !== "enforced" ||
    adapter.readiness.audit !== "verified"
  )
    return invalid("policy-not-ready");

  const validated = validateRequest(request);
  if (!validated.ok) return invalid(validated.reason);
  return {
    available: true,
    descriptor: {
      ...validated.value,
      shell: false,
      descendantConfinement: "inherited",
      childExecution: "deny-unapproved",
      deniedDomains: AF_DENIED_POLICY_DOMAINS,
      network: "deny-denied-domains",
      audit: "verified",
    },
  };
}

/** Build the distinct read-only descriptor used before a proof root exists. */
export function buildAfPreflightDescriptor(
  adapter: AfExecutionPolicyAdapter | undefined,
  request: Readonly<{
    executable: string;
    argv: readonly [string, ...string[]];
    cwd: string;
    readOnlyRuntimeGrants: readonly AfRuntimeReadGrant[];
  }>,
): AfPreflightDescriptorResult {
  if (adapter === undefined) return invalid("missing-adapter");
  if (adapter.platform !== "darwin" && adapter.platform !== "linux") return invalid("unsupported-platform");
  if (adapter.readiness.state === "ambiguous") return invalid("ambiguous-policy");
  if (adapter.readiness.state !== "ready") return invalid("policy-not-ready");
  if (
    adapter.readiness.descendantConfinement !== "inherited" ||
    adapter.readiness.childExecution !== "deny-unapproved" ||
    adapter.readiness.deniedDomains !== "enforced" ||
    adapter.readiness.audit !== "verified"
  )
    return invalid("policy-not-ready");
  const executable = normalizeBoundaryPath(request.executable);
  const cwd = normalizeBoundaryPath(request.cwd);
  if (executable === undefined || cwd === undefined) return invalid("invalid-request");
  if (
    !Array.isArray(request.argv) ||
    request.argv.length === 0 ||
    request.argv.length > MAX_ARG_COUNT ||
    !request.argv.every(
      (argument) =>
        typeof argument === "string" &&
        argument.length > 0 &&
        argument.length <= MAX_ARG_LENGTH &&
        !SHELL_TOKEN.test(argument),
    )
  )
    return invalid("invalid-request");
  const grants = request.readOnlyRuntimeGrants;
  if (!Array.isArray(grants) || grants.length === 0) return invalid("invalid-grant-overlap");
  const readOnlyRuntimeGrants: AfRuntimeReadGrant[] = [];
  for (const grant of grants) {
    const grantPath = isRecord(grant) && hasOnlyKeys(grant, ["path"]) ? normalizeBoundaryPath(grant.path) : undefined;
    if (grantPath === undefined || readOnlyRuntimeGrants.some((item) => overlaps(item.path, grantPath)))
      return invalid("invalid-grant-overlap");
    readOnlyRuntimeGrants.push({ path: grantPath });
  }
  const normalizedArgv = [...request.argv] as [string, ...string[]];
  if (normalizedArgv[0] !== executable) return invalid("invalid-request");
  return {
    available: true,
    descriptor: {
      executable,
      argv: normalizedArgv,
      cwd,
      shell: false,
      readOnlyRuntimeGrants,
      descendantConfinement: "inherited",
      childExecution: "deny-unapproved",
      deniedDomains: AF_DENIED_POLICY_DOMAINS,
      network: "deny-denied-domains",
      audit: "verified",
    },
  };
}
