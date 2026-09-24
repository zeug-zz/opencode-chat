import type { ReasoningAssistStage, ReasoningAssistSummary } from "@opencode-chat/core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageWithParts } from "../../../App";
import { getPersistedState } from "../../vscode-api";
import { createMessage, createSession, createTextPart } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

const toggleName = "Expand or collapse reasoning assist";

/** 検証済みの要約だけを使い、生のトークンや ID は含めない。 */
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

/** ドキュメント順で `later` が `earlier` の後に来るかを返す。 */
function documentOrder(earlier: Node, later: Node): "after" | "before" {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? "after" : "before";
}

/** `middle` がドキュメント順で `before` と `after` の間に表示されるかを返す。 */
function rendersBetween(before: Node, middle: Node, after: Node): boolean {
  return documentOrder(before, middle) === "after" && documentOrder(middle, after) === "after";
}

function userMessage(id: string, text: string, sessionId = "s1"): MessageWithParts {
  return {
    info: createMessage({ id, sessionID: sessionId, role: "user" }),
    parts: [createTextPart(text, { messageID: id, sessionID: sessionId })],
  };
}

function assistantMessage(id: string, text: string, sessionId = "s1"): MessageWithParts {
  return {
    info: createMessage({ id, sessionID: sessionId, role: "assistant" }),
    parts: [createTextPart(text, { messageID: id, sessionID: sessionId })],
  };
}

function progress(promptToken: string, stage: ReasoningAssistStage, sessionId = "s1") {
  return { type: "reasoningAssistProgress" as const, sessionId, promptToken, stage };
}

function assistSummary(promptToken: string, sessionId = "s1") {
  return { type: "reasoningAssistSummary" as const, sessionId, promptToken, summary };
}

function cleared(promptToken: string, sessionId = "s1") {
  return { type: "reasoningAssistCleared" as const, sessionId, promptToken };
}

/**
 * アシスト面（行、スピナー、レビューカード、思考面、`blocked` 表示）が残って
 * いないことを表明する。`rawIds` には生のトークンやセッション ID を渡し、
 * 表示漏れが無いことも確認する。
 */
function expectNoAssistSurface(container: HTMLElement, rawIds: string[] = []) {
  expect(screen.queryByText("Reasoning assist")).not.toBeInTheDocument();
  expect(container.querySelector("[data-testid='streaming-indicator']")).toBeNull();
  expect(container.querySelector(".reviewCard")).toBeNull();
  expect(container.querySelector(".reasoningPart")).toBeNull();
  expect(container.querySelector(".reasoningHeader")).toBeNull();
  expect(screen.queryByText("Thought")).not.toBeInTheDocument();
  expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Reasoning review" })).not.toBeInTheDocument();
  expect(container.textContent).not.toContain("blocked");
  for (const rawId of rawIds) {
    expect(container.textContent).not.toContain(rawId);
  }
}

async function sendMessages(sessionId: string, messages: MessageWithParts[]) {
  await sendExtMessage({ type: "messages", sessionId, messages });
}

describe("reasoning assist のアンカー", () => {
  beforeEach(() => {
    vi.mocked(getPersistedState).mockReturnValue(undefined);
  });

  it("プリフライト中は行をトランスクリプト末尾に置き、プロンプト到着後にアンカーすること", async () => {
    renderApp();
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });

    const firstUser = userMessage("u1", "First prompt");
    const firstAssistant = assistantMessage("a1", "First reply");
    await sendMessages("s1", [firstUser, firstAssistant]);

    // ホストは sendMessage より先に進捗を公開するため、この時点ではまだ
    // 対応するユーザーメッセージが届いていない
    await sendExtMessage({
      type: "reasoningAssistProgress",
      sessionId: "s1",
      promptToken: "tok-1",
      stage: "assessing",
    });

    const preflightRow = screen.getByText("Reasoning assist");
    expect(documentOrder(screen.getByText("First reply"), preflightRow)).toBe("after");
    expect(rendersBetween(screen.getByText("First prompt"), preflightRow, screen.getByText("First reply"))).toBe(false);

    // プロンプトが届くと、行はそのメッセージ直後へアンカーされる
    const secondUser = userMessage("u2", "Second prompt");
    await sendMessages("s1", [firstUser, firstAssistant, secondUser]);

    expect(screen.getAllByText("Reasoning assist")).toHaveLength(1);
    expect(documentOrder(screen.getByText("Second prompt"), screen.getByText("Reasoning assist"))).toBe("after");

    // 応答が届いても、行はアンカー先のプロンプト直後に留まる
    const secondAssistant = assistantMessage("a2", "Second reply");
    await sendMessages("s1", [firstUser, firstAssistant, secondUser, secondAssistant]);

    expect(screen.getAllByText("Reasoning assist")).toHaveLength(1);
    expect(
      rendersBetween(
        screen.getByText("Second prompt"),
        screen.getByText("Reasoning assist"),
        screen.getByText("Second reply"),
      ),
    ).toBe(true);
  });

  it("通常のプリフライトはクリア後に行もスピナーも blocked も残さないこと", async () => {
    const { container } = renderApp();
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
    await sendMessages("s1", [userMessage("u1", "First prompt"), assistantMessage("a1", "First reply")]);

    await sendExtMessage(progress("tok-ordinary", "assessing"));
    expect(screen.getByText("Assessing prompt")).toBeInTheDocument();

    await sendExtMessage(cleared("tok-ordinary"));

    expectNoAssistSurface(container, ["tok-ordinary"]);
    expect(screen.getByText("First prompt")).toBeInTheDocument();
    expect(screen.getByText("First reply")).toBeInTheDocument();
  });

  it("無効・利用不可・失敗したプリフライトもクリア後に通常のトランスクリプトへ影響しないこと", async () => {
    const { container } = renderApp();
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
    await sendMessages("s1", [userMessage("u1", "First prompt"), assistantMessage("a1", "First reply")]);

    // ホストが dispatch-unchanged へ写像する失敗経路では、進捗の後に cleared だけが届く
    await sendExtMessage(progress("tok-invalid", "mapping"));
    await sendExtMessage(progress("tok-invalid", "recording"));
    expect(screen.getByText("Recording structure")).toBeInTheDocument();

    await sendExtMessage(cleared("tok-invalid"));

    expectNoAssistSurface(container, ["tok-invalid"]);
    expect(documentOrder(screen.getByText("First prompt"), screen.getByText("First reply"))).toBe("after");
  });

  it("アシストメッセージが無ければ行を出さず、古いトークンのクリアは新しい行を消さないこと", async () => {
    const { container } = renderApp();
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
    await sendMessages("s1", [userMessage("u1", "First prompt"), assistantMessage("a1", "First reply")]);

    // アシストメッセージが一切無い通常フロー
    expectNoAssistSurface(container);

    await sendExtMessage(progress("tok-new", "assessing"));
    expect(screen.getByText("Assessing prompt")).toBeInTheDocument();

    // 古いプリフライトの cleared は新しいトークンの行を消さない
    await sendExtMessage(cleared("tok-stale-old"));
    expect(screen.getAllByText("Reasoning assist")).toHaveLength(1);
    expect(screen.getByText("Assessing prompt")).toBeInTheDocument();

    await sendExtMessage(cleared("tok-new"));
    expectNoAssistSurface(container, ["tok-new", "tok-stale-old"]);
  });

  it("キャンセルされたプリフライトの行は消え、二重のクリアも無害であること", async () => {
    const { container } = renderApp();
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
    await sendMessages("s1", [userMessage("u1", "First prompt")]);

    await sendExtMessage(progress("tok-cancelled", "mapping"));
    expect(screen.getByText("Mapping argument")).toBeInTheDocument();

    await sendExtMessage(cleared("tok-cancelled"));
    expectNoAssistSurface(container, ["tok-cancelled"]);

    // 再キャンセル（重複 cleared）は表示も状態も変えない
    await sendExtMessage(cleared("tok-cancelled"));
    expectNoAssistSurface(container, ["tok-cancelled"]);
    expect(screen.getByText("First prompt")).toBeInTheDocument();
  });

  it("適用済みブリーフは発生元セッション・プロンプト・応答に固定されること", async () => {
    const { container } = renderApp();
    const sessionA = createSession({ id: "session-a" });
    const sessionB = createSession({ id: "session-b" });
    await sendExtMessage({ type: "activeSession", session: sessionA });

    const promptA = userMessage("u-a1", "Alpha prompt", "session-a");
    const replyA = assistantMessage("a-a1", "Alpha reply", "session-a");
    await sendMessages("session-a", [promptA]);

    await sendExtMessage(progress("tok-applied-1", "assessing", "session-a"));
    await sendExtMessage(progress("tok-applied-1", "mapping", "session-a"));
    await sendExtMessage(progress("tok-applied-1", "recording", "session-a"));
    await sendExtMessage(progress("tok-applied-1", "critiquing", "session-a"));
    await sendExtMessage(progress("tok-applied-1", "preparing", "session-a"));
    await sendExtMessage(assistSummary("tok-applied-1", "session-a"));
    await sendExtMessage(progress("tok-applied-1", "applied", "session-a"));

    await sendMessages("session-a", [promptA, replyA]);

    // 行は元のプロンプトと応答の間に固定される
    expect(screen.getByText("Assist applied")).toBeInTheDocument();
    expect(
      rendersBetween(
        screen.getByText("Alpha prompt"),
        screen.getByText("Reasoning assist"),
        screen.getByText("Alpha reply"),
      ),
    ).toBe(true);

    // 展開しても検証済みの要約フィールドだけを描画する
    await userEvent.click(screen.getByRole("button", { name: toggleName }));
    expect(screen.getByText(summary.candidateConclusion)).toBeInTheDocument();
    for (const assumption of summary.assumptions) {
      expect(screen.getByText(assumption)).toBeInTheDocument();
    }
    expect(screen.getByText(summary.evidenceBoundary)).toBeInTheDocument();
    for (const objection of summary.criticObjections) {
      expect(screen.getByText(objection.objection)).toBeInTheDocument();
    }
    expect(screen.getByText("AF recorded structure")).toBeInTheDocument();
    expect(screen.queryByText("Uncertainty")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("tok-applied-1");
    expect(container.textContent).not.toContain("session-a");

    // セッション B では A の行を表示しない
    await sendExtMessage({ type: "activeSession", session: sessionB });
    await sendMessages("session-b", [
      userMessage("u-b1", "Bravo prompt", "session-b"),
      assistantMessage("a-b1", "Bravo reply", "session-b"),
    ]);
    expectNoAssistSurface(container);
    expect(screen.getByText("Bravo prompt")).toBeInTheDocument();

    // A へ戻すと、適用済み行は元のアンカー位置のまま再表示される
    await sendExtMessage({ type: "activeSession", session: sessionA });
    await sendMessages("session-a", [promptA, replyA]);
    expect(screen.getAllByText("Reasoning assist")).toHaveLength(1);
    expect(screen.getByText("Assist applied")).toBeInTheDocument();
    expect(
      rendersBetween(
        screen.getByText("Alpha prompt"),
        screen.getByText("Reasoning assist"),
        screen.getByText("Alpha reply"),
      ),
    ).toBe(true);

    // 新しいプロンプトは自分の行を持ち、古い適用済み行は元の位置に残る
    const promptA2 = userMessage("u-a2", "Alpha follow-up", "session-a");
    await sendMessages("session-a", [promptA, replyA, promptA2]);
    await sendExtMessage(progress("tok-applied-2", "assessing", "session-a"));

    expect(screen.getAllByText("Reasoning assist")).toHaveLength(2);
    expect(screen.getByText("Assist applied")).toBeInTheDocument();
    expect(screen.getByText("Assessing prompt")).toBeInTheDocument();
    expect(documentOrder(screen.getByText("Alpha follow-up"), screen.getByText("Assessing prompt"))).toBe("after");
    expect(
      rendersBetween(
        screen.getByText("Alpha prompt"),
        screen.getByText("Assist applied"),
        screen.getByText("Alpha reply"),
      ),
    ).toBe(true);

    // 新しいトークンの cleared は古い適用済み行を消さない
    await sendExtMessage(cleared("tok-applied-2", "session-a"));
    expect(screen.getAllByText("Reasoning assist")).toHaveLength(1);
    expect(screen.getByText("Assist applied")).toBeInTheDocument();
    expect(screen.queryByText("Assessing prompt")).not.toBeInTheDocument();
    expect(
      rendersBetween(
        screen.getByText("Alpha prompt"),
        screen.getByText("Reasoning assist"),
        screen.getByText("Alpha reply"),
      ),
    ).toBe(true);
  });

  it("セッション切替で保留行だけが破棄されること", async () => {
    const { container } = renderApp();
    const sessionA = createSession({ id: "session-a" });
    const sessionB = createSession({ id: "session-b" });
    await sendExtMessage({ type: "activeSession", session: sessionA });
    const promptA = userMessage("u-a1", "Alpha prompt", "session-a");
    await sendMessages("session-a", [promptA]);

    await sendExtMessage(progress("tok-pending", "recording", "session-a"));
    expect(screen.getByText("Recording structure")).toBeInTheDocument();

    // 保留行を持ったままセッションを切り替える
    await sendExtMessage({ type: "activeSession", session: sessionB });
    expectNoAssistSurface(container);

    // 戻しても保留行は復活しない（スピナーやカードも残らない）
    await sendExtMessage({ type: "activeSession", session: sessionA });
    await sendMessages("session-a", [promptA]);
    expectNoAssistSurface(container, ["tok-pending"]);
    expect(screen.getByText("Alpha prompt")).toBeInTheDocument();
  });
});
