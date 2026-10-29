import { randomUUID } from "node:crypto";

export const SCRIBE_REASONING_CONTEXT_RPC_ID = "scribe_reasoning_context" as const;
export const SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS = 4_096;
export const SCRIBE_REASONING_CONTEXT_MAX_BRIEF_BYTES = 16_384;
export const SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH = 128;
export const SCRIBE_REASONING_CONTEXT_RPC_TIMEOUT_MS = 500;
/** PROVISIONAL grace pending an authorized installed-host latency baseline. */
export const SCRIBE_REASONING_CONTEXT_GRACE_MS = 1_500;
export const SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS = 2_000;

export const SCRIBE_REASONING_CONTEXT_RPC = {
  id: SCRIBE_REASONING_CONTEXT_RPC_ID,
  events: {},
  methods: {
    pending: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH },
          turnID: { type: "string", minLength: 1, maxLength: SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH },
          graceMs: { type: "integer", minimum: 0, maximum: 60_000 },
        },
        required: ["sessionID", "turnID", "graceMs"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { pending: { type: "boolean" } },
        required: ["pending"],
        additionalProperties: false,
      },
    },
    put: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH },
          turnID: { type: "string", minLength: 1, maxLength: SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH },
          brief: { type: "string", minLength: 1, maxLength: SCRIBE_REASONING_CONTEXT_MAX_BRIEF_CHARS },
        },
        required: ["sessionID", "turnID", "brief"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          accepted: { type: "boolean" },
          internalGraceWaitMs: { type: "integer", minimum: 0, maximum: SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS },
        },
        required: ["accepted", "internalGraceWaitMs"],
        additionalProperties: false,
      },
    },
    clear: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH },
          turnID: { type: "string", minLength: 1, maxLength: SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          cleared: { type: "integer", minimum: 0 },
          internalGraceWaitMs: { type: "integer", minimum: 0, maximum: SCRIBE_REASONING_CONTEXT_GRACE_CEILING_MS },
        },
        required: ["cleared", "internalGraceWaitMs"],
        additionalProperties: false,
      },
    },
  },
} as const;

export function createNativeTurnId(): string {
  return `msg_${randomUUID().replaceAll("-", "")}`;
}

export function isNativeTurnId(value: unknown): value is string {
  return typeof value === "string" && /^msg_[a-f0-9]{32}$/.test(value);
}

export function isValidScribeReasoningContextKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SCRIBE_REASONING_CONTEXT_MAX_KEY_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}
