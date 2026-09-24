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
  "reasoningAssist.criticObjections",
  "reasoningAssist.afRecordedStructure",
  "reasoningAssist.afNotAvailable",
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

  it("provides every reasoning-assist lifecycle key in every locale", () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const key of retainedReasoningAssistKeys) {
        expect(dictionary[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});
