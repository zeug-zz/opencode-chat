/**
 * Gated live-capture harness for the real AF CLI output shapes.
 *
 * This module is pure: it never launches a subprocess, reads or writes the
 * filesystem, or touches the network. The default test suite exercises only
 * these functions against synthetic and stored-fixture inputs; the explicitly
 * opted-in integration test (`OPENCODE_CHAT_RUN_VIBEFELD_CAPTURE=1`) runs the
 * fixed version/schema/init/claim/refine/status sequence against a
 * project-relative disposable workspace, sanitizes the results here, and
 * writes the capture set beneath that temporary root.
 *
 * Sanitization is fail-closed and bounded: a capture either becomes a small
 * safe string containing no host path, no control character, no shell token,
 * and no prompt/secret-style marker, or it is rejected with a bounded reason.
 */

export const MAX_CAPTURE_OUTPUT_BYTES = 32_768;
export const MAX_CAPTURE_TEXT_LENGTH = 256;

const MAX_CAPTURE_TIMESTAMP_LENGTH = 64;
const MAX_CAPTURE_WORKSPACE_LENGTH = 4_096;
const MAX_CAPTURE_JSON_DEPTH = 8;
const MAX_CAPTURE_JSON_KEYS = 256;
const MAX_CAPTURE_ARRAY_LENGTH = 256;

export const AF_CAPTURE_EXECUTABLE = "af";
export const AF_CAPTURE_AUTHOR = "capture";
/** Fixed host-owned claim/refine runtime values; no caller, graph, or model input reaches them. */
export const AF_CAPTURE_ROOT_NODE_ID = "1";
export const AF_CAPTURE_CLAIM_ROLE = "prover";
export const AF_CAPTURE_STATEMENT = "All primes greater than 2 are odd";
export const AF_CAPTURE_MANIFEST_FILE = "manifest.json";
export const AF_CAPTURE_WORKSPACE_PLACEHOLDER = "<workspace>";

const CONJECTURE_PLACEHOLDER = "<conjecture>";
const AUTHOR_PLACEHOLDER = "<author>";
const NODE_ID_PLACEHOLDER = "<node-id>";
const PARENT_ID_PLACEHOLDER = "<parent-id>";
const STATEMENT_PLACEHOLDER = "<statement>";
const OWNER_PLACEHOLDER = "<owner>";
const ROLE_PLACEHOLDER = "<role>";

/**
 * Designated content fields are replaced with these placeholders before any
 * inspection: the original values never reach validation, serialization, or a
 * failure message.
 */
const REDACTED_CAPTURE_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  statement: "<statement>",
  context: "<context>",
  content_hash: "<hash>",
  content: "<content>",
  ledger: "<ledger>",
  rationale: "<rationale>",
  text: "<text>",
});

/** True for C0 controls other than tab and newline, plus DEL. */
const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) || codePoint === 0x7f) return true;
  }
  return false;
};

const SHELL_TOKEN = /[;&|`$]/u;
const UNSAFE_MARKER =
  /(?:prompt|source[-_ ]?packet|private[-_ ]?reasoning|chain[-_ ]?of[-_ ]?thought|secret|password|token|authorization|credential|api[-_ ]?key)/iu;
const HOST_PATH_PREFIX =
  /(?:\/(?:Users|home|root|private|var|tmp|etc|opt|mnt|media|srv|Volumes|System|Library|Applications|usr|dev|proc|run|bin|sbin)(?:\/|$)|[A-Za-z]:[\\/]|\\\\)/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;

export type AfCaptureOperation = "version" | "schema" | "init" | "claim" | "refine" | "status";

/** Operations whose JSON embeds recorded content: their designated fields are never stored. */
const CONTENT_BEARING_OPERATIONS: readonly AfCaptureOperation[] = ["claim", "refine", "status"];

export type AfCaptureOperationShape = Readonly<{
  operation: AfCaptureOperation;
  /** Fixed argv after the executable name; `buildCaptureArgv` substitutes the host workspace. */
  argv: readonly string[];
  /** Bounded base file name; callers join it to a project-relative capture root. */
  file: string;
}>;

/**
 * The six fixed capture shapes. The recorded manifest keeps the shapes with
 * placeholders, so no host workspace, executable path, node or owner identity,
 * statement, or conjecture text is ever stored in the capture set.
 */
export const CAPTURE_OPERATIONS: readonly AfCaptureOperationShape[] = [
  { operation: "version", argv: ["version", "--json"], file: "version.json" },
  { operation: "schema", argv: ["schema", "--format", "json"], file: "schema.json" },
  {
    operation: "init",
    argv: ["init", "-c", CONJECTURE_PLACEHOLDER, "-a", AUTHOR_PLACEHOLDER, "-d", AF_CAPTURE_WORKSPACE_PLACEHOLDER],
    file: "init.txt",
  },
  {
    operation: "claim",
    argv: [
      "claim",
      NODE_ID_PLACEHOLDER,
      "--owner",
      OWNER_PLACEHOLDER,
      "--role",
      ROLE_PLACEHOLDER,
      "-d",
      AF_CAPTURE_WORKSPACE_PLACEHOLDER,
      "--format",
      "json",
    ],
    file: "claim.json",
  },
  {
    operation: "refine",
    argv: [
      "refine",
      PARENT_ID_PLACEHOLDER,
      STATEMENT_PLACEHOLDER,
      "--owner",
      OWNER_PLACEHOLDER,
      "-d",
      AF_CAPTURE_WORKSPACE_PLACEHOLDER,
      "--format",
      "json",
    ],
    file: "refine.json",
  },
  {
    operation: "status",
    argv: ["status", "-d", AF_CAPTURE_WORKSPACE_PLACEHOLDER, "--format", "json"],
    file: "status.json",
  },
];

export type AfCaptureFailureReason =
  | "unsupported-operation"
  | "invalid-workspace"
  | "invalid-input"
  | "malformed"
  | "oversized"
  | "unsafe-value";

export type AfCaptureSanitizeResult =
  | Readonly<{ ok: true; operation: AfCaptureOperation; contents: string; byteLength: number }>
  | Readonly<{ ok: false; operation: AfCaptureOperation | "unknown"; reason: AfCaptureFailureReason }>;

export type AfCaptureRunInput = Readonly<{ workspace: string; conjecture?: string }>;

export type AfCaptureRuntimeIdentity = Readonly<{
  version: string;
  commit: string;
  build_date: string;
  go_version: string;
  format: string;
  policy: string;
}>;

export type AfCaptureOutputs = Readonly<Record<AfCaptureOperation, string>>;

export type AfCaptureFile = Readonly<{ relativePath: string; contents: string }>;

export type AfCaptureManifest = Readonly<{
  capturedAt: string;
  runtime: AfCaptureRuntimeIdentity;
  commands: readonly (readonly string[])[];
}>;

export type AfCaptureSetResult =
  | Readonly<{ ok: true; files: readonly AfCaptureFile[]; manifest: AfCaptureManifest }>
  | Readonly<{ ok: false; reason: AfCaptureFailureReason }>;

class CaptureInputError extends Error {
  readonly reason: AfCaptureFailureReason;

  constructor(reason: AfCaptureFailureReason) {
    super(reason);
    this.name = "CaptureInputError";
    this.reason = reason;
  }
}

const reject = (reason: AfCaptureFailureReason): never => {
  throw new CaptureInputError(reason);
};

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCaptureOperation = (value: unknown): value is AfCaptureOperation =>
  CAPTURE_OPERATIONS.some((shape) => shape.operation === value);

const hasTraversalSegment = (value: string): boolean => value.split(/[\\/]/u).includes("..");

/** Rejects an absolute host path anywhere in retained text, including mid-line paths. */
const hasAbsoluteHostPath = (value: string): boolean =>
  value.trimStart().startsWith("/") || HOST_PATH_PREFIX.test(value);

const normalizeWorkspacePath = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CAPTURE_WORKSPACE_LENGTH) return undefined;
  if (hasControlCharacter(value) || SHELL_TOKEN.test(value) || hasTraversalSegment(value)) return undefined;
  const normalized = value.replace(/[\\/]+$/u, "");
  if (normalized.length === 0 || normalized === "/") return undefined;
  return normalized;
};

const replaceWorkspacePath = (value: string, workspacePath: string): string =>
  value.split(workspacePath).join(AF_CAPTURE_WORKSPACE_PLACEHOLDER);

const readSafeField = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CAPTURE_TEXT_LENGTH) return undefined;
  if (hasControlCharacter(value) || SHELL_TOKEN.test(value) || UNSAFE_MARKER.test(value)) return undefined;
  if (hasAbsoluteHostPath(value) || hasTraversalSegment(value)) return undefined;
  return value;
};

const assertSafeRetainedText = (value: string): void => {
  if (value.length > MAX_CAPTURE_TEXT_LENGTH) reject("oversized");
  if (hasControlCharacter(value) || SHELL_TOKEN.test(value) || UNSAFE_MARKER.test(value)) reject("unsafe-value");
  if (hasAbsoluteHostPath(value) || hasTraversalSegment(value)) reject("unsafe-value");
};

const sanitizeJsonValue = (
  value: unknown,
  workspacePath: string,
  depth: number,
  state: { keys: number },
  redactContent: boolean,
): unknown => {
  if (depth > MAX_CAPTURE_JSON_DEPTH) reject("oversized");
  if (typeof value === "string") {
    const replaced = replaceWorkspacePath(value, workspacePath);
    assertSafeRetainedText(replaced);
    return replaced;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("unsafe-value");
    return value;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    if (value.length > MAX_CAPTURE_ARRAY_LENGTH) reject("oversized");
    return value.map((item) => sanitizeJsonValue(item, workspacePath, depth + 1, state, redactContent));
  }
  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      state.keys += 1;
      if (state.keys > MAX_CAPTURE_JSON_KEYS) reject("oversized");
      if (key.length === 0 || key.length > MAX_CAPTURE_TEXT_LENGTH) reject("oversized");
      if (hasControlCharacter(key) || SHELL_TOKEN.test(key) || UNSAFE_MARKER.test(key)) reject("unsafe-value");
      const placeholder = redactContent ? REDACTED_CAPTURE_FIELDS[key] : undefined;
      if (placeholder !== undefined) {
        sanitized[key] = placeholder;
        continue;
      }
      sanitized[key] = sanitizeJsonValue(item, workspacePath, depth + 1, state, redactContent);
    }
    return sanitized;
  }
  return reject("unsafe-value");
};

const sanitizeCaptureJson = (
  operation: AfCaptureOperation,
  stdout: string,
  workspacePath: string,
): AfCaptureSanitizeResult => {
  if (utf8Bytes(stdout) > MAX_CAPTURE_OUTPUT_BYTES) return { ok: false, operation, reason: "oversized" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, operation, reason: "malformed" };
  }
  if (!isRecord(parsed) && !Array.isArray(parsed)) return { ok: false, operation, reason: "malformed" };
  const sanitized = sanitizeJsonValue(
    parsed,
    workspacePath,
    0,
    { keys: 0 },
    CONTENT_BEARING_OPERATIONS.includes(operation),
  );
  const contents = `${JSON.stringify(sanitized, null, 2)}\n`;
  const byteLength = utf8Bytes(contents);
  if (byteLength > MAX_CAPTURE_OUTPUT_BYTES) return { ok: false, operation, reason: "oversized" };
  return { ok: true, operation, contents, byteLength };
};

const sanitizeCaptureText = (
  operation: AfCaptureOperation,
  stdout: string,
  workspacePath: string,
): AfCaptureSanitizeResult => {
  if (utf8Bytes(stdout) > MAX_CAPTURE_OUTPUT_BYTES) return { ok: false, operation, reason: "oversized" };
  const replaced = replaceWorkspacePath(stdout, workspacePath);
  if (replaced.trim().length === 0) return { ok: false, operation, reason: "malformed" };
  if (hasControlCharacter(replaced)) return { ok: false, operation, reason: "unsafe-value" };
  const lines = replaced.split("\n").map((line) => line.replace(/[ \t]+$/u, ""));
  for (const line of lines) {
    if (line.length > MAX_CAPTURE_TEXT_LENGTH) return { ok: false, operation, reason: "oversized" };
    if (SHELL_TOKEN.test(line) || UNSAFE_MARKER.test(line) || hasAbsoluteHostPath(line) || hasTraversalSegment(line)) {
      return { ok: false, operation, reason: "unsafe-value" };
    }
  }
  const contents = `${lines.join("\n").replace(/\n+$/u, "")}\n`;
  const byteLength = utf8Bytes(contents);
  if (byteLength > MAX_CAPTURE_OUTPUT_BYTES) return { ok: false, operation, reason: "oversized" };
  return { ok: true, operation, contents, byteLength };
};

/**
 * Sanitizes one captured stdout string into a bounded capture file body, or
 * returns a bounded failure reason. The workspace path is replaced with
 * `<workspace>` everywhere; any remaining absolute host path, control
 * character, shell token, or restricted marker rejects the capture. Status node
 * statements, content hashes, challenge content, and recorded claim context or
 * refine statements are replaced with placeholders, so no node, ledger,
 * challenge, statement, or context content is ever returned.
 */
export function sanitizeCaptureOutput(
  operation: AfCaptureOperation,
  stdout: string,
  workspacePath: string,
): AfCaptureSanitizeResult {
  if (!isCaptureOperation(operation)) return { ok: false, operation: "unknown", reason: "unsupported-operation" };
  const workspace = normalizeWorkspacePath(workspacePath);
  if (!workspace) return { ok: false, operation, reason: "invalid-workspace" };
  if (typeof stdout !== "string") return { ok: false, operation, reason: "invalid-input" };
  try {
    return operation === "init"
      ? sanitizeCaptureText(operation, stdout, workspace)
      : sanitizeCaptureJson(operation, stdout, workspace);
  } catch (error) {
    return { ok: false, operation, reason: error instanceof CaptureInputError ? error.reason : "invalid-input" };
  }
}

/**
 * Builds the fixed argv for one capture operation. The workspace is the only
 * host-selected input; the author, node identifiers, role, and refine statement
 * are fixed host-owned capture values. An invalid workspace or conjecture
 * resolves `undefined`, and callers must not substitute one.
 */
export function buildCaptureArgv(
  operation: AfCaptureOperation,
  input: AfCaptureRunInput,
): readonly string[] | undefined {
  if (!isRecord(input)) return undefined;
  const workspace = normalizeWorkspacePath(input.workspace);
  if (!workspace) return undefined;
  switch (operation) {
    case "version":
      return ["version", "--json"];
    case "schema":
      return ["schema", "--format", "json"];
    case "status":
      return ["status", "-d", workspace, "--format", "json"];
    case "claim":
      return [
        "claim",
        AF_CAPTURE_ROOT_NODE_ID,
        "--owner",
        AF_CAPTURE_AUTHOR,
        "--role",
        AF_CAPTURE_CLAIM_ROLE,
        "-d",
        workspace,
        "--format",
        "json",
      ];
    case "refine":
      return [
        "refine",
        AF_CAPTURE_ROOT_NODE_ID,
        AF_CAPTURE_STATEMENT,
        "--owner",
        AF_CAPTURE_AUTHOR,
        "-d",
        workspace,
        "--format",
        "json",
      ];
    case "init": {
      const conjecture = input.conjecture;
      if (typeof conjecture !== "string" || conjecture.length === 0) return undefined;
      if (readSafeField(conjecture) === undefined) return undefined;
      return ["init", "-c", conjecture, "-a", AF_CAPTURE_AUTHOR, "-d", workspace];
    }
    default:
      return undefined;
  }
}

const readRuntimeIdentity = (value: AfCaptureRuntimeIdentity): AfCaptureRuntimeIdentity | undefined => {
  if (!isRecord(value)) return undefined;
  const version = readSafeField(value.version);
  const commit = readSafeField(value.commit);
  const buildDate = readSafeField(value.build_date);
  const goVersion = readSafeField(value.go_version);
  const format = readSafeField(value.format);
  const policy = readSafeField(value.policy);
  if (!version || !commit || !buildDate || !goVersion || !format || !policy) return undefined;
  return { version, commit, build_date: buildDate, go_version: goVersion, format, policy };
};

const assertCaptureBody = (contents: string): AfCaptureFailureReason | undefined => {
  if (contents.trim().length === 0) return "invalid-input";
  if (utf8Bytes(contents) > MAX_CAPTURE_OUTPUT_BYTES) return "oversized";
  if (hasControlCharacter(contents)) return "unsafe-value";
  if (UNSAFE_MARKER.test(contents) || hasAbsoluteHostPath(contents)) return "unsafe-value";
  return undefined;
};

/**
 * Assembles the bounded, project-relative capture set from already-sanitized
 * operation outputs plus a host-observed runtime identity and timestamp. The
 * manifest records the fixed command shapes with placeholders, never a host
 * executable path or workspace. No filesystem write occurs here.
 */
export function buildCaptureSet(
  outputs: AfCaptureOutputs,
  runtimeIdentity: AfCaptureRuntimeIdentity,
  capturedAt: string,
): AfCaptureSetResult {
  if (!isRecord(outputs)) return { ok: false, reason: "invalid-input" };
  const runtime = readRuntimeIdentity(runtimeIdentity);
  if (!runtime) return { ok: false, reason: "invalid-input" };
  if (
    typeof capturedAt !== "string" ||
    capturedAt.length > MAX_CAPTURE_TIMESTAMP_LENGTH ||
    !ISO_TIMESTAMP.test(capturedAt)
  ) {
    return { ok: false, reason: "invalid-input" };
  }

  const files: AfCaptureFile[] = [];
  for (const shape of CAPTURE_OPERATIONS) {
    const contents = outputs[shape.operation];
    if (typeof contents !== "string") return { ok: false, reason: "invalid-input" };
    const reason = assertCaptureBody(contents);
    if (reason) return { ok: false, reason };
    files.push({ relativePath: shape.file, contents });
  }

  const manifest: AfCaptureManifest = {
    capturedAt,
    runtime,
    commands: CAPTURE_OPERATIONS.map((shape) => [AF_CAPTURE_EXECUTABLE, ...shape.argv]),
  };
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
  if (utf8Bytes(manifestContents) > MAX_CAPTURE_OUTPUT_BYTES) return { ok: false, reason: "oversized" };
  files.push({ relativePath: AF_CAPTURE_MANIFEST_FILE, contents: manifestContents });

  return { ok: true, files, manifest };
}
