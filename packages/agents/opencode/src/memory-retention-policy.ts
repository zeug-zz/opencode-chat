import type { MemoryRetentionPolicy } from "@opencode-chat/core";

export const MAX_MEMORY_RETENTION_SUMMARY_LENGTH = 2_000;
export const MAX_MEMORY_RETENTION_TITLE_LENGTH = 160;
export const MAX_MEMORY_RETENTION_TAGS = 8;
export const MAX_MEMORY_RETENTION_TAG_LENGTH = 40;

const REDACTED = "[redacted]";

export type MemoryRetentionSummary = {
  summary: string;
  title?: string;
  tags?: string[];
};

export type MemoryRetentionValidation =
  | { accepted: true; value: MemoryRetentionSummary }
  | { accepted: false; reason: MemoryRetentionValidationReason };

export type MemoryRetentionValidationReason =
  | "empty-summary"
  | "summary-too-large"
  | "unsupported-content"
  | "secret-material"
  | "invalid-summary";

const SAFE_DEFAULT_POLICY: MemoryRetentionPolicy = {
  enabled: false,
  requireConfirmation: true,
  automaticSessionRetention: false,
};

const DEFAULT_POLICY: MemoryRetentionPolicy = {
  enabled: false,
  requireConfirmation: true,
  automaticSessionRetention: true,
};

/** Normalize untrusted settings without ever enabling durable writes by accident. */
export function normalizeMemoryRetentionPolicy(value: unknown): MemoryRetentionPolicy {
  if (value === undefined) return { ...DEFAULT_POLICY };
  if (!isRecord(value)) return { ...SAFE_DEFAULT_POLICY };
  if (
    Object.keys(value).some((key) => !["enabled", "requireConfirmation", "automaticSessionRetention"].includes(key)) ||
    (value.enabled !== undefined && typeof value.enabled !== "boolean") ||
    (value.requireConfirmation !== undefined && typeof value.requireConfirmation !== "boolean") ||
    (value.automaticSessionRetention !== undefined && typeof value.automaticSessionRetention !== "boolean")
  ) {
    return { ...SAFE_DEFAULT_POLICY };
  }

  return {
    enabled: value.enabled === true,
    requireConfirmation: value.requireConfirmation !== false,
    automaticSessionRetention: value.automaticSessionRetention !== false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactPemBlocks(value: string): string {
  const beginPattern = /-----BEGIN [^-]+ KEY-----/gi;
  const endPattern = /-----END [^-]+ KEY-----/gi;
  let cursor = 0;
  let redacted = "";

  while (true) {
    beginPattern.lastIndex = cursor;
    const begin = beginPattern.exec(value);
    if (begin === null) return redacted + value.slice(cursor);

    endPattern.lastIndex = begin.index + begin[0].length;
    const end = endPattern.exec(value);
    if (end === null) return redacted + value.slice(cursor);

    redacted += `${value.slice(cursor, begin.index)}${REDACTED}`;
    cursor = end.index + end[0].length;
  }
}

function redactSecrets(value: string): string {
  return redactPemBlocks(value)
    .replace(/\b(?:bearer\s+|authorization\s*[:=]\s*)[^\s,;]+/gi, REDACTED)
    .replace(/\b(?:api[_-]?key|access[_-]?key|secret|password|passwd|token)\s*[:=]\s*(["']?)[^\s,"']+\1/gi, REDACTED)
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])-[A-Za-z0-9_-]{12,}\b/g, REDACTED)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED);
}

function containsResidualSecretMarker(value: string): boolean {
  return /-----BEGIN|\b(?:authorization|bearer|api[_-]?key|access[_-]?key|secret|password|passwd|token)\s*[:=]|\b(?:secret|password|passwd)\b/i.test(
    value,
  );
}

function containsIncompleteCredentialMarker(value: string): boolean {
  return /\b(?:authorization\s*:\s*bearer|bearer)\s*$/i.test(value.trim());
}

function containsUnsupportedContent(value: string): boolean {
  return (
    /(?:raw|tool|payload|transcript|full document|provider output|configuration|config)\s*[:=]/i.test(value) ||
    /(?:^|\s)(?:\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)/.test(value)
  );
}

/**
 * Validate the only shape permitted to cross the retention boundary.
 * Unknown fields are rejected so callers cannot smuggle raw payloads or paths.
 */
export function validateMemoryRetentionSummary(input: unknown): MemoryRetentionValidation {
  if (!isRecord(input)) return { accepted: false, reason: "invalid-summary" };

  const keys = Object.keys(input);
  if (keys.some((key) => !["summary", "title", "tags"].includes(key))) {
    return { accepted: false, reason: "unsupported-content" };
  }
  if (typeof input.summary !== "string") return { accepted: false, reason: "invalid-summary" };

  const summary = redactSecrets(input.summary).replace(/\s+/g, " ").trim();
  if (!summary) return { accepted: false, reason: "empty-summary" };
  if (summary.length > MAX_MEMORY_RETENTION_SUMMARY_LENGTH) {
    return { accepted: false, reason: "summary-too-large" };
  }
  const hasSecretMarker = containsResidualSecretMarker(summary) || containsIncompleteCredentialMarker(input.summary);
  if (containsUnsupportedContent(summary) || hasSecretMarker) {
    return { accepted: false, reason: hasSecretMarker ? "secret-material" : "unsupported-content" };
  }

  let title: string | undefined;
  if (input.title !== undefined) {
    if (typeof input.title !== "string") return { accepted: false, reason: "invalid-summary" };
    title = redactSecrets(input.title).replace(/\s+/g, " ").trim();
    if (title.length > MAX_MEMORY_RETENTION_TITLE_LENGTH || containsResidualSecretMarker(title)) {
      return { accepted: false, reason: "secret-material" };
    }
  }

  let tags: string[] | undefined;
  if (input.tags !== undefined) {
    if (
      !Array.isArray(input.tags) ||
      input.tags.length > MAX_MEMORY_RETENTION_TAGS ||
      input.tags.some((tag) => typeof tag !== "string" || tag.length > MAX_MEMORY_RETENTION_TAG_LENGTH)
    ) {
      return { accepted: false, reason: "invalid-summary" };
    }
    tags = input.tags.map((tag) => tag.replace(/\s+/g, " ").trim());
  }

  return { accepted: true, value: { summary, ...(title ? { title } : {}), ...(tags ? { tags } : {}) } };
}
