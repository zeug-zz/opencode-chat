export const RESTRICTED_REVIEW_AGENT_NAME = "vibefeld-restricted-review";
export const RESTRICTED_REVIEW_PROMPT =
  "You are a host-owned restricted review agent. Evaluate only the bounded review packet supplied by the host.";
export const RESTRICTED_REVIEW_PROVER_STAGE_INSTRUCTION =
  'Reply only as JSON: { "proposalId": <identifier>, "objections": [ { "objectionId", "target": { "kind", "id" }, "severity", "reason" } ] }.';
export const RESTRICTED_REVIEW_VERIFIER_STAGE_INSTRUCTION =
  'Reply only as JSON: { "proposalId": <same identifier>, "dispositions": [ { "objectionId", "disposition", "reason" } ] }.';
export const RESTRICTED_REVIEW_MAX_STEPS = 8;

export const RESTRICTED_REVIEW_AUTHORITIES = [
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "patch",
  "bash",
  "task",
  "webfetch",
  "websearch",
  "skill",
  "todo",
  "todowrite",
  "question",
  "lsp",
  "list",
  "external_directory",
  "doom_loop",
] as const;

const RESTRICTED_REVIEW_ENTRY_KEYS = new Set(["model", "prompt", "maxSteps", "dynamicToolNames", "permission"]);

export type RestrictedReviewOverlayInput = {
  model: string;
  prompt: string;
  maxSteps: number;
  dynamicToolNames?: readonly string[];
  permission?: unknown;
};

export type RestrictedReviewAgentEntry = {
  model: string;
  prompt: string;
  maxSteps: number;
  mode: "subagent";
  hidden: true;
  permission: Record<string, "deny">;
};

export class RestrictedReviewOverlayValidationError extends Error {
  readonly code = "INVALID_RESTRICTED_REVIEW_OVERLAY" as const;

  constructor(message: string) {
    super(message);
    this.name = "RestrictedReviewOverlayValidationError";
  }
}

function reject(message: string): never {
  throw new RestrictedReviewOverlayValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDynamicToolNames(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) reject("dynamicToolNames must be an array.");

  const names = value as unknown[];
  const result = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || name.trim().length === 0 || name === "*") {
      reject("dynamicToolNames must contain non-blank concrete authority names.");
    }
    result.add(name);
  }
  return [...result];
}

export function validateRestrictedReviewOverlayInput(value: unknown): RestrictedReviewOverlayInput {
  if (!isRecord(value)) reject("Restricted review overlay must be an object.");

  for (const key of Object.keys(value)) {
    if (!RESTRICTED_REVIEW_ENTRY_KEYS.has(key)) reject(`Unknown restricted review overlay field: ${key}.`);
  }

  const model = value.model;
  if (typeof model !== "string" || model.trim().length === 0) reject("Restricted review model is required.");

  if (value.prompt !== RESTRICTED_REVIEW_PROMPT) {
    reject("Restricted review prompt must be the fixed host-owned instruction.");
  }

  const maxSteps = value.maxSteps;
  if (
    typeof maxSteps !== "number" ||
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > RESTRICTED_REVIEW_MAX_STEPS
  ) {
    reject(`Restricted review maxSteps must be an integer from 1 to ${RESTRICTED_REVIEW_MAX_STEPS}.`);
  }

  const dynamicToolNames = validateDynamicToolNames(value.dynamicToolNames);
  if (value.permission !== undefined) {
    if (!isRecord(value.permission)) reject("Restricted review permission must be an object.");
    const suppliedPermission = value.permission as Record<string, unknown>;
    const expectedAuthorities = new Set(["*", ...RESTRICTED_REVIEW_AUTHORITIES, ...dynamicToolNames]);
    const actualAuthorities = Object.keys(suppliedPermission);
    if (
      actualAuthorities.length !== expectedAuthorities.size ||
      actualAuthorities.some((authority) => !expectedAuthorities.has(authority)) ||
      actualAuthorities.some((authority) => suppliedPermission[authority] !== "deny")
    ) {
      reject("Restricted review permission must deny every known authority and no other authority.");
    }
  }

  return {
    model,
    prompt: RESTRICTED_REVIEW_PROMPT,
    maxSteps,
    dynamicToolNames,
  };
}

export function buildRestrictedReviewAgentEntry(input: unknown): RestrictedReviewAgentEntry {
  const validated = validateRestrictedReviewOverlayInput(input);
  const permission: Record<string, "deny"> = { "*": "deny" };
  for (const authority of RESTRICTED_REVIEW_AUTHORITIES) permission[authority] = "deny";
  for (const authority of validated.dynamicToolNames ?? []) permission[authority] = "deny";

  return {
    model: validated.model,
    prompt: validated.prompt,
    maxSteps: validated.maxSteps,
    mode: "subagent",
    hidden: true,
    permission,
  };
}
