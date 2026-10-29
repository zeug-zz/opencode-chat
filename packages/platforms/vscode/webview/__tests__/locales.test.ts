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

const retainedReviewConfigKeys = [
  "config.reasoningReview",
  "config.reasoningReviewEnable",
  "config.reasoningReviewWorkspaceOptOut",
  "config.reasoningReviewDescription",
  "config.reasoningReviewEffective",
] as const;

const reasoningReviewToggleKeys = [
  "input.reasoningReviewOn",
  "input.reasoningReviewOff",
  "input.reasoningReviewBlocked",
] as const;

const retainedReasoningAssistKeys = [
  "reasoningAssist.title",
  "reasoningAssist.stage.assessing",
  "reasoningAssist.stage.mapping",
  "reasoningAssist.stage.recording",
  "reasoningAssist.stage.critiquing",
  "reasoningAssist.stage.preparing",
  "reasoningAssist.stage.applied",
  "reasoningAssist.toggleDetails",
  "reasoningAssist.candidateConclusion",
  "reasoningAssist.assumptions",
  "reasoningAssist.evidenceBoundary",
  "reasoningAssist.afRecordedStructure",
  "reasoningAssist.afNotAvailable",
] as const;

const manualReasoningReviewKeys = [
  "reasoningReview.action",
  "reasoningReview.cancel",
  "reasoningReview.cancelling",
  "reasoningReview.inProgress",
  "reasoningReview.cancelled",
  "reasoningReview.resultLabel",
  "reasoningReview.statusLabel",
  "reasoningReview.evidenceLabel",
  "reasoningReview.assumptionsLabel",
  "reasoningReview.challengesLabel",
  "reasoningReview.status.notReviewed",
  "reasoningReview.status.reviewing",
  "reasoningReview.status.structurallyChecked",
  "reasoningReview.status.conditional",
  "reasoningReview.status.unresolved",
  "reasoningReview.status.refuted",
  "reasoningReview.status.blocked",
  "reasoningReview.status.auditFailed",
  "reasoningReview.status.unavailable",
  "reasoningReview.evidence.notAssessed",
  "reasoningReview.evidence.notRequired",
  "reasoningReview.evidence.sourceRecorded",
  "reasoningReview.evidence.unverified",
  "reasoningReview.evidence.humanVerified",
  "reasoningReview.evidence.conflicted",
  "reasoningReview.severity.critical",
  "reasoningReview.severity.major",
  "reasoningReview.severity.minor",
  "reasoningReview.severity.note",
  "reasoningReview.stage.claimProjection",
  "reasoningReview.stage.adversarialReview",
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

  it("provides every retained reasoning-review runtime preference key in every locale", () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of retainedReviewConfigKeys) {
        expect(dictionary[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it("provides the exact reasoning-review toggle labels in every locale", () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of reasoningReviewToggleKeys) {
        expect(dictionary[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it("provides every reasoning-assist lifecycle key in every locale", () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of retainedReasoningAssistKeys) {
        expect(dictionary[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it("provides every manual completed-answer review key in every locale", () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of manualReasoningReviewKeys) {
        expect(dictionary[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it("provides the localized secondary message-action label in every locale", () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expect(dictionary["message.moreActions"], `${locale}.message.moreActions`).toBeTruthy();
      expect(dictionary).not.toHaveProperty("message.copyThinkingMarkdown");
      expect(dictionary).not.toHaveProperty("reasoningReview.copyMarkdown");
    }
  });
});
