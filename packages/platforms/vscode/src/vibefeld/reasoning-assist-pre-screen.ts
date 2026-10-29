/** Conservative, locale-neutral screening before the semantic architect call. */
export type ReasoningAssistPreScreenResult = "ordinary" | "maybe-argument";

const OBVIOUS_CONVERSATIONAL_TURNS = new Set([
  "hello",
  "hello there",
  "hi",
  "hi there",
  "hey",
  "hey there",
  "howdy",
  "good morning",
  "good afternoon",
  "good evening",
  "good night",
  "greetings",
  "thanks",
  "thank you",
  "thanks a lot",
  "many thanks",
  "thx",
  "ty",
  "ok",
  "okay",
  "k",
  "yes",
  "yeah",
  "yep",
  "yup",
  "no",
  "nope",
  "sure",
  "got it",
  "i see",
  "understood",
  "noted",
  "right",
  "cool",
  "fine",
  "alright",
  "all right",
]);

const EMOJI_OR_PUNCTUATION_ONLY =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|[\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u20E3|[\p{P}\p{Z}\s])*$/u;

/**
 * Skips only exact low-information conversational turns or strings consisting
 * solely of spacing, punctuation, or emoji. Prompt length is never considered.
 */
export function classifyReasoningAssistPreScreen(text: string): ReasoningAssistPreScreenResult {
  if (typeof text !== "string") return "maybe-argument";
  if (EMOJI_OR_PUNCTUATION_ONLY.test(text)) return "ordinary";

  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]+/gu, " ")
    .trim();
  return OBVIOUS_CONVERSATIONAL_TURNS.has(normalized) ? "ordinary" : "maybe-argument";
}
