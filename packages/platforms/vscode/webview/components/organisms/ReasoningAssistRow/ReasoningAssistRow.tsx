import type { ReasoningAssistStage } from "@opencode-chat/core";
import { useState } from "react";
import type { ReasoningAssistRowState } from "../../../hooks/useReasoningAssist";
import { useLocale } from "../../../locales";
import { ChevronRightIcon } from "../../atoms/icons";
import styles from "./ReasoningAssistRow.module.css";

type Props = {
  row: ReasoningAssistRowState;
};

/**
 * Localized stage label keys for the assist lifecycle. These are progress
 * labels, not a transcript: the component never renders stage output.
 */
const stageLabelKeys = {
  assessing: "reasoningAssist.stage.assessing",
  mapping: "reasoningAssist.stage.mapping",
  recording: "reasoningAssist.stage.recording",
  critiquing: "reasoningAssist.stage.critiquing",
  preparing: "reasoningAssist.stage.preparing",
  applied: "reasoningAssist.stage.applied",
} as const satisfies Record<ReasoningAssistStage, string>;

/**
 * Compact expandable `Reasoning assist` row for one prompt token.
 *
 * The body renders only validated summary fields and only while expanded. It
 * deliberately shares no markup, styles, or state with the model `Thought` /
 * reasoning-part surface or the removed review card.
 */
export function ReasoningAssistRow({ row }: Props) {
  const t = useLocale();
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const summary = row.summary;
  const expanded = detailsExpanded && summary !== undefined;
  const stageKey = row.applied ? stageLabelKeys.applied : stageLabelKeys[row.stage];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{t["reasoningAssist.title"]}</span>
        <span className={styles.stage}>{t[stageKey]}</span>
        <button
          type="button"
          className={styles.toggle}
          aria-label={t["reasoningAssist.toggleDetails"]}
          title={t["reasoningAssist.toggleDetails"]}
          aria-expanded={expanded}
          disabled={summary === undefined}
          onClick={() => setDetailsExpanded((value) => !value)}
        >
          <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>
            <ChevronRightIcon />
          </span>
        </button>
      </div>
      {expanded && summary && (
        <div className={styles.body}>
          <div className={styles.field}>
            <span className={styles.label}>{t["reasoningAssist.candidateConclusion"]}</span>
            <p className={styles.text}>{summary.candidateConclusion}</p>
          </div>
          {summary.assumptions.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>{t["reasoningAssist.assumptions"]}</span>
              <ul className={styles.list}>
                {summary.assumptions.map((assumption, index) => (
                  <li key={index}>{assumption}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.evidenceBoundary.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>{t["reasoningAssist.evidenceBoundary"]}</span>
              <p className={styles.text}>{summary.evidenceBoundary}</p>
            </div>
          )}
          {summary.criticObjections.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>{t["reasoningAssist.criticObjections"]}</span>
              <ul className={styles.list}>
                {summary.criticObjections.map((objection, index) => (
                  <li key={index}>{objection.objection}</li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.field}>
            <span className={styles.label}>
              {summary.afFact === "recorded_structure"
                ? t["reasoningAssist.afRecordedStructure"]
                : t["reasoningAssist.afNotAvailable"]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
