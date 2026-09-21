import type { ReasoningReviewStatus, ReasoningReviewSummary } from "@opencode-chat/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReasoningReviewCard } from "../../../components/organisms/ReasoningReviewCard";
import { LocaleProvider } from "../../../locales";
import { en } from "../../../locales/en";
import { es } from "../../../locales/es";

const statuses: ReasoningReviewStatus[] = [
  "unavailable",
  "reviewing",
  "structurally_checked",
  "conditional",
  "unresolved",
  "refuted",
  "blocked",
  "audit_failed",
];

const evidenceStatuses = [
  "not_assessed",
  "not_required",
  "source_recorded",
  "unverified",
  "human_verified",
  "conflicted",
] as const;

function makeSummary(status: ReasoningReviewStatus): ReasoningReviewSummary {
  return {
    reviewedMessageId: "assistant-1",
    status,
    invocation: "manual",
    conclusion: "A bounded conclusion",
    assumptions: ["A bounded assumption"],
    evidenceStatus: "unverified",
    openChallenges: [{ severity: "minor", target: "claim", reason: "A bounded challenge" }],
    interpretiveBoundary: "A bounded boundary",
    artifactHandle: "private-provider-handle",
  };
}

function renderCard(summary: ReasoningReviewSummary) {
  return render(
    <LocaleProvider value={en}>
      <ReasoningReviewCard summary={summary} isReviewing={false} runtime={{ state: "available" }} />
    </LocaleProvider>,
  );
}

describe("ReasoningReviewCard", () => {
  it.each(statuses)("presents the %s status with a localized label", (status) => {
    renderCard(makeSummary(status));
    expect(
      screen.getByText(
        en[
          `review.status.${status === "structurally_checked" ? "structurallyChecked" : status === "audit_failed" ? "auditFailed" : status}` as keyof typeof en
        ],
      ),
    ).toBeInTheDocument();
  });

  it("presents pending work as reviewing without showing a result", () => {
    render(
      <LocaleProvider value={en}>
        <ReasoningReviewCard isReviewing runtime={{ state: "available" }} />
      </LocaleProvider>,
    );
    expect(screen.getByText("Reviewing")).toBeInTheDocument();
    expect(screen.queryByText("A bounded conclusion")).not.toBeInTheDocument();
  });

  it.each(evidenceStatuses)("localizes the %s evidence status", (evidenceStatus) => {
    renderCard({ ...makeSummary("conditional"), evidenceStatus });
    const key =
      `review.evidence.${evidenceStatus === "not_assessed" ? "notAssessed" : evidenceStatus === "not_required" ? "notRequired" : evidenceStatus === "source_recorded" ? "sourceRecorded" : evidenceStatus === "human_verified" ? "humanVerified" : evidenceStatus}` as keyof typeof en;
    expect(screen.getByText(en[key])).toBeInTheDocument();
    expect(screen.queryByText(evidenceStatus)).not.toBeInTheDocument();
  });

  it("renders bounded safe summary fields and omits private data", () => {
    const { container } = renderCard(makeSummary("structurally_checked"));
    expect(container).toHaveTextContent("A bounded conclusion");
    expect(container).toHaveTextContent("A bounded assumption");
    expect(container).not.toHaveTextContent("private-provider-handle");
  });

  it("exposes the card as an accessible review region", () => {
    renderCard(makeSummary("unavailable"));
    expect(screen.getByRole("region", { name: en["review.card.title"] })).toBeInTheDocument();
  });

  it("renders only approved bounded fields when prohibited provider data is present", () => {
    const prohibitedValues = [
      "RAW_PROVIDER_OUTPUT_SENTINEL",
      "RAW_PROVIDER_DATA_SENTINEL",
      "SOURCE_PACKET_SENTINEL",
      "PROMPT_SENTINEL",
      "WORKSPACE_PATH_SENTINEL",
      "PRIVATE_REASONING_SENTINEL",
      "TOOL_INPUT_SENTINEL",
      "TOOL_OUTPUT_SENTINEL",
      "ATTACHMENT_SENTINEL",
      "PERMISSION_METADATA_SENTINEL",
      "EXECUTABLE_PATH_SENTINEL",
      "COMMAND_SENTINEL",
      "OPAQUE_HANDLE_SENTINEL",
    ];
    const summary = {
      ...makeSummary("conditional"),
      artifactHandle: prohibitedValues[12],
      providerOutput: prohibitedValues[0],
      rawProviderData: prohibitedValues[1],
      sourcePacket: prohibitedValues[2],
      prompt: prohibitedValues[3],
      workspacePath: prohibitedValues[4],
      privateReasoning: prohibitedValues[5],
      toolInput: prohibitedValues[6],
      toolOutput: prohibitedValues[7],
      attachment: prohibitedValues[8],
      permissionMetadata: prohibitedValues[9],
      executablePath: prohibitedValues[10],
      command: prohibitedValues[11],
    } as ReasoningReviewSummary;

    const { container } = renderCard(summary);
    expect(container).toHaveTextContent("A bounded conclusion");
    expect(container).toHaveTextContent("A bounded assumption");
    expect(container).toHaveTextContent("A bounded challenge");
    for (const value of prohibitedValues) expect(container).not.toHaveTextContent(value);
  });

  it("localizes evidence status labels instead of rendering enum tokens", () => {
    render(
      <LocaleProvider value={es}>
        <ReasoningReviewCard
          summary={makeSummary("structurally_checked")}
          isReviewing={false}
          runtime={{ state: "available" }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(es["review.evidence.unverified"])).toBeInTheDocument();
    expect(screen.queryByText("unverified")).not.toBeInTheDocument();
  });

  it("renders a localized bounded reason for automatic reviews", () => {
    renderCard({
      ...makeSummary("conditional"),
      invocation: "automatic",
      routing: { reasonCode: "evidence_dependent", summary: "Evidence-dependent response" },
    });

    expect(screen.getByText(en["review.automaticLabel"])).toBeInTheDocument();
    expect(screen.getByText(en["review.routingReason.evidenceDependent"])).toBeInTheDocument();
    expect(screen.getByText(en["review.automaticReason"])).toBeInTheDocument();
  });

  it("keeps manual summaries free of automatic routing metadata", () => {
    renderCard({
      ...makeSummary("conditional"),
      routing: { reasonCode: "multi_step_argument", summary: "Multi-step argument" },
    });

    expect(screen.queryByText(en["review.automaticLabel"])).not.toBeInTheDocument();
    expect(screen.queryByText(en["review.routingReason.multiStepArgument"])).not.toBeInTheDocument();
  });

  it("rejects an unknown runtime reason without rendering raw metadata", () => {
    renderCard({
      ...makeSummary("conditional"),
      invocation: "automatic",
      routing: { reasonCode: "unsafe_reason", summary: "unsafe" },
    } as ReasoningReviewSummary);

    expect(screen.queryByText(en["review.automaticLabel"])).not.toBeInTheDocument();
    expect(screen.queryByText("unsafe")).not.toBeInTheDocument();
    expect(screen.queryByText("unsafe_reason")).not.toBeInTheDocument();
  });

  it("emits only bounded feedback booleans from the review result", () => {
    const onFeedback = vi.fn();
    render(
      <LocaleProvider value={en}>
        <ReasoningReviewCard
          summary={makeSummary("conditional")}
          isReviewing={false}
          runtime={{ state: "available" }}
          onFeedback={onFeedback}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: en["review.feedback.correct"] }));
    expect(onFeedback).toHaveBeenLastCalledWith({ correct: true });
    expect(Object.keys(onFeedback.mock.calls.at(-1)?.[0] ?? {})).toEqual(["correct"]);

    fireEvent.click(screen.getByRole("button", { name: en["review.feedback.unfoundedChallenge"] }));
    expect(onFeedback).toHaveBeenLastCalledWith({ correct: false, falseChallenge: true });
    expect(Object.keys(onFeedback.mock.calls.at(-1)?.[0] ?? {}).sort()).toEqual(["correct", "falseChallenge"]);
    expect(JSON.stringify(onFeedback.mock.calls)).not.toMatch(/prompt|source|response|path/iu);
  });

  it("offers the challenge control only when the review raised open challenges", () => {
    const onFeedback = vi.fn();
    render(
      <LocaleProvider value={en}>
        <ReasoningReviewCard
          summary={{ ...makeSummary("conditional"), openChallenges: [] }}
          isReviewing={false}
          runtime={{ state: "available" }}
          onFeedback={onFeedback}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("button", { name: en["review.feedback.correct"] })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en["review.feedback.unfoundedChallenge"] })).not.toBeInTheDocument();
  });

  it("offers no feedback controls without a result or without a handler", () => {
    const onFeedback = vi.fn();
    const { unmount } = render(
      <LocaleProvider value={en}>
        <ReasoningReviewCard isReviewing runtime={{ state: "available" }} onFeedback={onFeedback} />
      </LocaleProvider>,
    );
    expect(screen.queryByRole("button", { name: en["review.feedback.correct"] })).not.toBeInTheDocument();
    unmount();

    renderCard(makeSummary("structurally_checked"));
    expect(screen.queryByRole("button", { name: en["review.feedback.correct"] })).not.toBeInTheDocument();
  });

  it("replaces the controls with a localized recorded note after feedback", () => {
    render(
      <LocaleProvider value={en}>
        <ReasoningReviewCard
          summary={makeSummary("conditional")}
          isReviewing={false}
          runtime={{ state: "available" }}
          feedback={{ correct: false, falseChallenge: true }}
          onFeedback={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText(en["review.feedback.recorded"])).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en["review.feedback.correct"] })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en["review.feedback.unfoundedChallenge"] })).not.toBeInTheDocument();
  });
});
