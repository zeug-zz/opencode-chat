import { randomUUID } from "node:crypto";
import type { SessionTransferData } from "@opencode/client";

const MESSAGE_TYPES = new Set([
  "agent-switched",
  "model-switched",
  "location-switched",
  "user",
  "synthetic",
  "system",
  "skill",
  "shell",
  "assistant",
  "compaction",
  "idle",
]);
const MAX_ID_LENGTH = 512;

function validID(value: unknown, prefix: "ses_" | "msg_"): value is string {
  return (
    typeof value === "string" && value.length <= MAX_ID_LENGTH && new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(value)
  );
}

function assertJSON(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || seen.has(value)) throw new Error("Invalid native session export.");
  seen.add(value);
  if (Array.isArray(value)) for (const entry of value) assertJSON(entry, seen);
  else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error("Invalid native session export.");
    for (const entry of Object.values(value)) assertJSON(entry, seen);
  }
  seen.delete(value);
}

/** Independent TUI copy: only native root controls and typed outer IDs change. */
export function copySessionTransferData(
  data: SessionTransferData,
  createID: (kind: "session" | "message") => string = (kind) =>
    `${kind === "session" ? "ses_" : "msg_"}${randomUUID()}`,
): SessionTransferData {
  try {
    if (
      !data ||
      typeof data !== "object" ||
      !data.info ||
      typeof data.info !== "object" ||
      !validID(data.info.id, "ses_") ||
      !Array.isArray(data.messages)
    )
      throw new Error();
    const sourceIDs = new Set<string>([data.info.id]);
    for (const message of data.messages) {
      if (
        !message ||
        typeof message !== "object" ||
        !validID(message.id, "msg_") ||
        !MESSAGE_TYPES.has(message.type) ||
        sourceIDs.has(message.id)
      )
        throw new Error();
      sourceIDs.add(message.id);
    }
    assertJSON(data);
    const sessionID = createID("session");
    const messageIDs = data.messages.map(() => createID("message"));
    const ids = [sessionID, ...messageIDs];
    if (
      !validID(sessionID, "ses_") ||
      messageIDs.some((id) => !validID(id, "msg_")) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => sourceIDs.has(id))
    )
      throw new Error();
    return {
      info: { ...data.info, id: sessionID, parentID: undefined, fork: undefined, agent: undefined },
      messages: data.messages.map((message, index) => ({ ...message, id: messageIDs[index]! })),
    };
  } catch {
    throw new Error("Invalid native session export.");
  }
}
