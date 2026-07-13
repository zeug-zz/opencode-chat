/**
 * Classifies companion server connect errors for user-facing messages.
 *
 * - "not-found": OpenCode binary is missing (ENOENT). User must install OpenCode.
 * - "database-locked": Another OpenCode process holds the project SQLite DB lock.
 * - "other": Any other failure.
 */
export type ConnectErrorKind = "not-found" | "database-locked" | "other";

export function classifyConnectError(error: unknown): ConnectErrorKind {
  if (!(error instanceof Error)) {
    return "other";
  }
  const nodeErr = error as NodeJS.ErrnoException;
  if (nodeErr.code === "ENOENT" || error.message.includes("ENOENT")) {
    return "not-found";
  }
  if (error.message.toLowerCase().includes("database is locked")) {
    return "database-locked";
  }
  return "other";
}
