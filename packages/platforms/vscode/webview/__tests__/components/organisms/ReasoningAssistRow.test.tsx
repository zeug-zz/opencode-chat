import type { ReasoningAssistStage, ReasoningAssistSummary } from "@opencode-chat/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { ReasoningAssistRow } from "../../../components/organisms/ReasoningAssistRow";
import type { ReasoningAssistRowState } from "../../../hooks/useReasoningAssist";

const toggleName = "Expand or collapse reasoning assist";

const summary: ReasoningAssistSummary = {
  candidateConclusion: "Structure supports one bounded conclusion.",
  assumptions: ["Assumption one", "Assumption two"],
  evidenceBoundary: "Only same-thread evidence was considered.",
  criticObjections: [
    { target: "candidate_conclusion", objection: "Scope may exceed the evidence." },
    { target: "assumption", objection: "The second assumption may not hold." },
  ],
  afFact: "recorded_structure",
};

function createRow(overrides: Partial<ReasoningAssistRowState> = {}): ReasoningAssistRowState {
  return {
    sessionId: "session-1",
    promptToken: "token-1",
    stage: "mapping",
    applied: false,
    ...overrides,
  };
}

const stageLabels: Array<[ReasoningAssistStage, string]> = [
  ["assessing", "Assessing prompt"],
  ["mapping", "Mapping argument"],
  ["recording", "Recording structure"],
  ["critiquing", "Reviewing objections"],
  ["preparing", "Preparing answer"],
  ["applied", "Assist applied"],
];

describe("ReasoningAssistRow", () => {
  it("renders the localized title and stage label for every stage", () => {
    for (const [stage, label] of stageLabels) {
      const { unmount } = render(<ReasoningAssistRow row={createRow({ stage })} />);
      expect(screen.getByText("Reasoning assist")).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows the applied stage label on an applied row", () => {
    render(<ReasoningAssistRow row={createRow({ stage: "applied", applied: true, summary })} />);

    expect(screen.getByText("Assist applied")).toBeInTheDocument();
  });

  it("expands and collapses the validated summary details", async () => {
    render(<ReasoningAssistRow row={createRow({ stage: "preparing", summary })} />);

    const toggle = screen.getByRole("button", { name: toggleName });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("title", toggleName);
    expect(screen.queryByText("Candidate conclusion")).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Candidate conclusion")).toBeInTheDocument();
    expect(screen.getByText(summary.candidateConclusion)).toBeInTheDocument();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Candidate conclusion")).not.toBeInTheDocument();
    expect(screen.queryByText(summary.candidateConclusion)).not.toBeInTheDocument();
  });

  it("renders exactly the validated summary fields while expanded", async () => {
    render(<ReasoningAssistRow row={createRow({ stage: "applied", applied: true, summary })} />);

    await userEvent.click(screen.getByRole("button", { name: toggleName }));

    expect(screen.getByText("Candidate conclusion")).toBeInTheDocument();
    expect(screen.getByText(summary.candidateConclusion)).toBeInTheDocument();
    expect(screen.getByText("Assumptions")).toBeInTheDocument();
    for (const assumption of summary.assumptions) {
      expect(screen.getByText(assumption)).toBeInTheDocument();
    }
    expect(screen.getByText("Evidence boundary")).toBeInTheDocument();
    expect(screen.getByText(summary.evidenceBoundary)).toBeInTheDocument();
    expect(screen.getByText("Critic objections to address")).toBeInTheDocument();
    for (const objection of summary.criticObjections) {
      expect(screen.getByText(objection.objection)).toBeInTheDocument();
    }
    expect(screen.getByText("AF recorded structure")).toBeInTheDocument();
  });

  it("omits empty optional blocks but keeps the candidate conclusion and AF fact", async () => {
    const sparse: ReasoningAssistSummary = {
      candidateConclusion: "Only one bounded conclusion.",
      assumptions: [],
      evidenceBoundary: "",
      criticObjections: [],
      afFact: "absent",
    };
    render(<ReasoningAssistRow row={createRow({ stage: "applied", applied: true, summary: sparse })} />);

    await userEvent.click(screen.getByRole("button", { name: toggleName }));

    expect(screen.getByText(sparse.candidateConclusion)).toBeInTheDocument();
    expect(screen.queryByText("Assumptions")).not.toBeInTheDocument();
    expect(screen.queryByText("Evidence boundary")).not.toBeInTheDocument();
    expect(screen.queryByText("Critic objections to address")).not.toBeInTheDocument();
    expect(screen.getByText("AF structure not available")).toBeInTheDocument();
  });

  it("renders the AF fact for both validated values", async () => {
    const { unmount } = render(<ReasoningAssistRow row={createRow({ summary: { ...summary, afFact: "absent" } })} />);
    await userEvent.click(screen.getByRole("button", { name: toggleName }));
    expect(screen.getByText("AF structure not available")).toBeInTheDocument();
    unmount();

    render(<ReasoningAssistRow row={createRow({ summary: { ...summary, afFact: "recorded_structure" } })} />);
    await userEvent.click(screen.getByRole("button", { name: toggleName }));
    expect(screen.getByText("AF recorded structure")).toBeInTheDocument();
  });

  it("disables the toggle until a validated summary exists", () => {
    render(<ReasoningAssistRow row={createRow({ stage: "critiquing" })} />);

    expect(screen.getByRole("button", { name: toggleName })).toBeDisabled();
  });

  it("never renders model thought, reasoning-part, or review-card surfaces", async () => {
    const { container } = render(<ReasoningAssistRow row={createRow({ stage: "applied", applied: true, summary })} />);

    await userEvent.click(screen.getByRole("button", { name: toggleName }));

    expect(container.querySelector(".reasoningPart")).toBeNull();
    expect(container.querySelector(".reasoningHeader")).toBeNull();
    expect(container.querySelector(".reasoningBody")).toBeNull();
    expect(container.querySelector(".card")).toBeNull();
    expect(screen.queryByText("Thought")).not.toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Reasoning review" })).not.toBeInTheDocument();
  });

  it("never renders the session id, prompt token, or unknown fields", async () => {
    const { container } = render(
      <ReasoningAssistRow
        row={createRow({
          sessionId: "session-secret-42",
          promptToken: "token-secret-7",
          stage: "applied",
          applied: true,
          summary,
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: toggleName }));

    expect(container.textContent).not.toContain("session-secret-42");
    expect(container.textContent).not.toContain("token-secret-7");
  });
});
