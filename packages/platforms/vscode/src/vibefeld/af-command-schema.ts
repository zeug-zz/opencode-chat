import { AF_FIXTURE_LIMITS } from "./af-runtime-contract";

const SHELL_TOKEN = /[;&|`$\n\r]|\$\(|\b(?:sh|bash|zsh|fish|powershell|cmd)\s+-c\b/i;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u;

/** AF node identifiers are dotted decimal paths such as `1` or `1.2.3`. */
const AF_NODE_ID_PATTERN = /^[0-9]+(?:\.[0-9]+)*$/;
const AF_NODE_ID_MAX_LENGTH = 64;

/**
 * The projection owner identity is fixed by the host and deliberately private:
 * no operation input can supply, override, or discover it.
 */
const AF_PROJECTION_OWNER = "scribe";

/**
 * Statement bound for one refine call. The execution boundary admits at most 32
 * argv entries, and the fixed refine argv already occupies nine of them
 * (executable, verb, parent id, `--owner`, owner, `--dir`, workspace,
 * `--format`, `json`). Over-limit input is rejected, never truncated.
 */
export const AF_MAX_REFINE_STATEMENTS = AF_FIXTURE_LIMITS.argumentCount - 9;

export const AF_COMMAND_OPERATIONS = ["version", "schema", "init", "claim", "refine", "status"] as const;
export type AfCommandOperationName = (typeof AF_COMMAND_OPERATIONS)[number];

/** The observed AF role allowlist for a claim; no other role is accepted. */
export type AfClaimRole = "prover" | "verifier";

export type AfCommandOperation =
  | { readonly operation: "version" }
  | { readonly operation: "schema" }
  | { readonly operation: "init"; readonly conjecture: string; readonly author: string }
  | { readonly operation: "claim"; readonly nodeId: string; readonly role: AfClaimRole }
  | { readonly operation: "refine"; readonly parentId: string; readonly statements: readonly string[] }
  | { readonly operation: "status" };

/** The caller cannot select the executable or workspace through an operation. */
export type AfCommandContext = Readonly<{
  executable: string;
  workspace: string;
}>;

export type AfLaunchDescriptor = Readonly<{
  executable: string;
  argv: readonly [string, ...string[]];
  shell: false;
  cwd?: string;
}>;

export type AfCommandErrorCode = "invalid-operation" | "invalid-input" | "unsafe-input" | "invalid-context";

export class AfCommandError extends Error {
  readonly code: AfCommandErrorCode;

  constructor(code: AfCommandErrorCode, message: string) {
    super(message);
    this.name = "AfCommandError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeBoundedText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= AF_FIXTURE_LIMITS.stringLength &&
  !SHELL_TOKEN.test(value);

const isBoundedNodeId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= AF_NODE_ID_MAX_LENGTH &&
  AF_NODE_ID_PATTERN.test(value);

const isAfClaimRole = (value: unknown): value is AfClaimRole => value === "prover" || value === "verifier";

const isBoundedStatementList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= AF_MAX_REFINE_STATEMENTS &&
  value.every(isSafeBoundedText);

const assertContext = (context: AfCommandContext): void => {
  if (
    !isRecord(context) ||
    typeof context.executable !== "string" ||
    context.executable.length === 0 ||
    context.executable.length > AF_FIXTURE_LIMITS.argumentLength ||
    typeof context.workspace !== "string" ||
    context.workspace.length === 0 ||
    context.workspace.length > AF_FIXTURE_LIMITS.argumentLength ||
    SHELL_TOKEN.test(context.executable) ||
    SHELL_TOKEN.test(context.workspace)
  ) {
    throw new AfCommandError("invalid-context", "AF command context is not host-owned and bounded");
  }
};

const assertOperation = (value: unknown): AfCommandOperation => {
  if (!isRecord(value) || typeof value.operation !== "string") {
    throw new AfCommandError("invalid-operation", "AF operation is not supported");
  }

  const keys = Object.keys(value);
  switch (value.operation) {
    case "version":
      if (keys.length !== 1) throw new AfCommandError("invalid-input", "version accepts no additional input");
      return { operation: "version" };
    case "schema":
      if (keys.length !== 1) throw new AfCommandError("invalid-input", "schema accepts no additional input");
      return { operation: "schema" };
    case "status":
      if (keys.length !== 1) throw new AfCommandError("invalid-input", "status accepts no additional input");
      return { operation: "status" };
    case "init":
      if (keys.length !== 3 || !isSafeBoundedText(value.conjecture) || !isSafeBoundedText(value.author)) {
        throw new AfCommandError("invalid-input", "init requires bounded conjecture and author text");
      }
      return { operation: "init", conjecture: value.conjecture, author: value.author };
    case "claim":
      if (keys.length !== 3 || !isBoundedNodeId(value.nodeId) || !isAfClaimRole(value.role)) {
        throw new AfCommandError("invalid-input", "claim requires a bounded node id and a prover or verifier role");
      }
      return { operation: "claim", nodeId: value.nodeId, role: value.role };
    case "refine":
      if (keys.length !== 3 || !isBoundedNodeId(value.parentId) || !isBoundedStatementList(value.statements)) {
        throw new AfCommandError("invalid-input", "refine requires a bounded parent id and a bounded statement list");
      }
      return { operation: "refine", parentId: value.parentId, statements: [...value.statements] };
    default:
      throw new AfCommandError("invalid-operation", "AF operation is not supported");
  }
};

/**
 * Creates the only command encoder. The context is supplied by the host; it is
 * deliberately not part of the operation union and cannot be overridden per call.
 */
export function createAfCommandSchema(context: AfCommandContext) {
  assertContext(context);
  const executable = context.executable;
  const workspace = context.workspace;

  return {
    build(operation: AfCommandOperation): AfLaunchDescriptor {
      const validated = assertOperation(operation);
      switch (validated.operation) {
        case "version":
          return { executable, argv: [executable, "version", "--json"], shell: false };
        case "schema":
          return { executable, argv: [executable, "schema", "--format", "json"], shell: false };
        case "init":
          return {
            executable,
            argv: [
              executable,
              "init",
              "--conjecture",
              validated.conjecture,
              "--author",
              validated.author,
              "--dir",
              workspace,
            ],
            shell: false,
            cwd: workspace,
          };
        case "claim":
          return {
            executable,
            argv: [
              executable,
              "claim",
              validated.nodeId,
              "--owner",
              AF_PROJECTION_OWNER,
              "--role",
              validated.role,
              "--dir",
              workspace,
              "--format",
              "json",
            ],
            shell: false,
            cwd: workspace,
          };
        case "refine":
          return {
            executable,
            argv: [
              executable,
              "refine",
              validated.parentId,
              ...validated.statements,
              "--owner",
              AF_PROJECTION_OWNER,
              "--dir",
              workspace,
              "--format",
              "json",
            ],
            shell: false,
            cwd: workspace,
          };
        case "status":
          return {
            executable,
            argv: [executable, "status", "--dir", workspace, "--format", "json"],
            shell: false,
            cwd: workspace,
          };
      }
    },
  } as const;
}
