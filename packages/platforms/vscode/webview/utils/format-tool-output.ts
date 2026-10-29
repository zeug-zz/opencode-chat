/** Format tool results for React text nodes without interpreting them as markup. */
export function formatToolOutput(value: unknown, unavailableFallback: string, spacing?: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    const serialized = JSON.stringify(value, null, spacing);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    // Tool results can contain cycles or otherwise non-serializable values.
    // Do not leak object coercions, throw, or emit unbounded diagnostics.
    return unavailableFallback;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
