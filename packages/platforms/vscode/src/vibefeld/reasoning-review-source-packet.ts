import type { ChatMessage } from "@opencode-chat/core";

/** The only message fields needed to derive a review source packet. */
export type ReasoningReviewSourceInput = {
  info: Pick<ChatMessage, "role"> & Record<string, unknown>;
  parts: ReadonlyArray<{ type: string; text?: unknown; ignored?: unknown; [key: string]: unknown }>;
};

/** Maximum number of JavaScript string characters forwarded to a review controller. */
export const REASONING_REVIEW_SOURCE_MAX_CHARS = 16_384;

/**
 * Build the host-internal review source from visible assistant text only.
 *
 * Text parts are concatenated in message order without serialization or a
 * truncation marker. The deterministic prefix bound keeps the packet within
 * the controller boundary while preserving the original text up to the
 * exact limit; all other message and part fields are intentionally ignored.
 */
export function buildReasoningReviewSourcePacket(message: ReasoningReviewSourceInput): string {
  if (message.info.role !== "assistant") return "";

  let sourceText = "";
  for (const part of message.parts) {
    if (part.type !== "text" || part.ignored === true || typeof part.text !== "string") continue;

    const remaining = REASONING_REVIEW_SOURCE_MAX_CHARS - sourceText.length;
    if (remaining <= 0) break;
    sourceText += part.text.slice(0, remaining);
  }

  return sourceText;
}
