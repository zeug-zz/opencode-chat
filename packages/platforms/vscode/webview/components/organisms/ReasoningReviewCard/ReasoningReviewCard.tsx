import type {
  ReasoningEvidenceStatus,
  ReasoningReviewRoutingReasonCode,
  ReasoningReviewRuntime,
  ReasoningReviewStatus,
  ReasoningReviewSummary,
} from "@opencode-chat/core";
import { useLocale } from "../../../locales";
import type { LocaleKeys } from "../../../locales/en";
import styles from "./ReasoningReviewCard.module.css";

type Props = {
  summary?: ReasoningReviewSummary;
  isReviewing: boolean;
  runtime: ReasoningReviewRuntime | null;
};

const MAX_TEXT_LENGTH = 500;
const MAX_ITEMS = 3;

function boundedText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}…` : value;
}

function statusFor(
  summary: ReasoningReviewSummary | undefined,
  isReviewing: boolean,
  runtime: ReasoningReviewRuntime | null,
) {
  if (isReviewing) return "reviewing" as const;
  if (summary) return summary.status;
  return runtime?.state === "unavailable" ? ("unavailable" as const) : null;
}

const statusKeys: Record<Exclude<ReasoningReviewStatus, "not_reviewed">, keyof ReturnType<typeof useLocale>> = {
  unavailable: "review.status.unavailable",
  reviewing: "review.status.reviewing",
  structurally_checked: "review.status.structurallyChecked",
  conditional: "review.status.conditional",
  unresolved: "review.status.unresolved",
  refuted: "review.status.refuted",
  blocked: "review.status.blocked",
  audit_failed: "review.status.auditFailed",
};

const evidenceStatusKeys: Record<ReasoningEvidenceStatus, LocaleKeys> = {
  not_assessed: "review.evidence.notAssessed",
  not_required: "review.evidence.notRequired",
  source_recorded: "review.evidence.sourceRecorded",
  unverified: "review.evidence.unverified",
  human_verified: "review.evidence.humanVerified",
  conflicted: "review.evidence.conflicted",
};

const routingReasonKeys: Record<ReasoningReviewRoutingReasonCode, LocaleKeys> = {
  evidence_dependent: "review.routingReason.evidenceDependent",
  multi_step_argument: "review.routingReason.multiStepArgument",
  high_impact_recommendation: "review.routingReason.highImpactRecommendation",
};

function automaticRoutingReason(summary: ReasoningReviewSummary | undefined): LocaleKeys | null {
  if (summary?.invocation !== "automatic" || !summary.routing) return null;
  return Object.hasOwn(routingReasonKeys, summary.routing.reasonCode)
    ? routingReasonKeys[summary.routing.reasonCode]
    : null;
}

export function ReasoningReviewCard({ summary, isReviewing, runtime }: Props) {
  const t = useLocale();
  const status = statusFor(summary, isReviewing, runtime);
  const routingReason = automaticRoutingReason(summary);
  if (!status || status === "not_reviewed") return null;

  return (
    <section className={`${styles.card} ${styles[status]}`} aria-label={t["review.card.title"]}>
      <div className={styles.header}>
        <span className={styles.title}>{t["review.card.title"]}</span>
        <span className={styles.status}>{t[statusKeys[status]]}</span>
      </div>
      {summary && status !== "reviewing" && (
        <div className={styles.details}>
          {routingReason && (
            <div>
              <div className={styles.label}>{t["review.automaticLabel"]}</div>
              <div>
                <span className={styles.label}>{t["review.automaticReason"]}</span> {t[routingReason]}
              </div>
            </div>
          )}
          {summary.conclusion && (
            <div>
              <div className={styles.label}>{t["review.conclusion"]}</div>
              <div>{boundedText(summary.conclusion)}</div>
            </div>
          )}
          {summary.assumptions.length > 0 && (
            <div>
              <div className={styles.label}>{t["review.assumptions"]}</div>
              <ul>
                {summary.assumptions.slice(0, MAX_ITEMS).map((assumption) => (
                  <li key={assumption}>{boundedText(assumption)}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <span className={styles.label}>{t["review.evidence"]}</span> {t[evidenceStatusKeys[summary.evidenceStatus]]}
          </div>
          {summary.openChallenges.length > 0 && (
            <div>
              <div className={styles.label}>{t["review.openChallenges"]}</div>
              <ul>
                {summary.openChallenges.slice(0, MAX_ITEMS).map((challenge) => (
                  <li key={`${challenge.severity}:${challenge.target}:${challenge.reason}`}>
                    {boundedText(challenge.reason)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.interpretiveBoundary && (
            <div>
              <div className={styles.label}>{t["review.interpretiveBoundary"]}</div>
              <div>{boundedText(summary.interpretiveBoundary)}</div>
            </div>
          )}
        </div>
      )}
      {status === "unavailable" && <div className={styles.note}>{t["review.unavailableNote"]}</div>}
    </section>
  );
}
