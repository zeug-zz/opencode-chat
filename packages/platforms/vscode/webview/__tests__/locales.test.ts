import { describe, expect, it } from "vitest";
import { en } from "../locales/en";
import { es } from "../locales/es";
import { ja } from "../locales/ja";
import { ko } from "../locales/ko";
import { ptBr } from "../locales/pt-br";
import { ru } from "../locales/ru";
import { zhCn } from "../locales/zh-cn";
import { zhTw } from "../locales/zh-tw";

const dictionaries = { en, ja, "zh-cn": zhCn, ko, "zh-tw": zhTw, es, "pt-br": ptBr, ru };

const reviewKeys = [
  "message.reviewArgument",
  "message.cancelReview",
  "message.showReview",
  "message.hideReview",
  "review.card.title",
  "review.status.unavailable",
  "review.status.reviewing",
  "review.status.structurallyChecked",
  "review.status.conditional",
  "review.status.unresolved",
  "review.status.refuted",
  "review.status.blocked",
  "review.status.auditFailed",
  "review.unavailableNote",
  "review.conclusion",
  "review.assumptions",
  "review.evidence",
  "review.evidence.notAssessed",
  "review.evidence.notRequired",
  "review.evidence.sourceRecorded",
  "review.evidence.unverified",
  "review.evidence.humanVerified",
  "review.evidence.conflicted",
  "review.openChallenges",
  "review.interpretiveBoundary",
  "review.automaticLabel",
  "review.automaticReason",
  "review.routingReason.evidenceDependent",
  "review.routingReason.multiStepArgument",
  "review.routingReason.highImpactRecommendation",
  "review.feedback.label",
  "review.feedback.correct",
  "review.feedback.unfoundedChallenge",
  "review.feedback.recorded",
] as const;

describe("webview locale dictionaries", () => {
  it("keeps every dictionary exactly aligned with the canonical schema", () => {
    const canonicalKeys = Object.keys(en).sort();

    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expect(Object.keys(dictionary).sort(), locale).toEqual(canonicalKeys);
      for (const key of canonicalKeys) {
        expect(typeof dictionary[key as keyof typeof en], `${locale}.${key}`).toBe(typeof en[key as keyof typeof en]);
      }
    }
  });

  it("provides every review action, status, safe-field, and evidence key in every locale", () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of reviewKeys) {
        expect(dictionary[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});
