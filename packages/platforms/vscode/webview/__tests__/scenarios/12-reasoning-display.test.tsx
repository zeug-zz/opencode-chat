import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPersistedState } from "../../vscode-api";
import { createMessage, createSession } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

/** Reasoning パートを持つメッセージを表示するセットアップ */
async function setupWithReasoningPart(partOverrides: Record<string, unknown> = {}) {
  renderApp();
  await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });

  const msg = createMessage({ id: "m1", sessionID: "s1", role: "assistant" });
  const reasoningPart = {
    id: "rp1",
    type: "reasoning",
    text: "Let me think about this step by step...",
    messageID: "m1",
    time: { created: Date.now(), updated: Date.now() },
    ...partOverrides,
  };

  await sendExtMessage({
    type: "messages",
    sessionId: "s1",
    messages: [{ info: msg, parts: [reasoningPart as any] }],
  });
}

// Reasoning display (ReasoningPartView)
describe("思考表示（ReasoningPartView）", () => {
  beforeEach(() => {
    vi.mocked(getPersistedState).mockReturnValue(undefined);
  });

  // In-progress reasoning part shows spinner and "Thinking..."
  context("進行中のリーズニングパートの場合", () => {
    let part: Element | null;

    beforeEach(async () => {
      await setupWithReasoningPart({ time: { created: Date.now() } });
      part = screen.getByText("Thinking\u2026").closest(".reasoningPart");
    });

    // Shows Thinking label
    it("Thinking\u2026 が表示されること", () => {
      expect(screen.getByText("Thinking\u2026")).toBeInTheDocument();
    });

    // Has active class
    it("reasoningActive クラスが付与されること", () => {
      expect(part).toHaveClass("reasoningActive");
    });

    // Shows spinner
    it("スピナーが表示されること", () => {
      expect(part?.querySelector(".spinner")).toBeInTheDocument();
    });

    it("デフォルトでは本文が折りたたまれていること", () => {
      expect(screen.queryByText("Let me think about this step by step...")).not.toBeInTheDocument();
    });
  });

  context("すべての思考を表示する設定が有効な場合", () => {
    beforeEach(async () => {
      vi.mocked(getPersistedState).mockReturnValue({ showAllThinking: true });
      await setupWithReasoningPart({
        text: "Previously hidden reasoning",
        time: { created: Date.now(), end: Date.now() },
      });
    });

    it("既存の完了済み本文をクリックなしで表示すること", () => {
      expect(screen.getByText("Previously hidden reasoning")).toBeInTheDocument();
    });
  });

  // Completed reasoning part shows "Thought"
  context("完了したリーズニングパートの場合", () => {
    let part: Element | null;

    beforeEach(async () => {
      await setupWithReasoningPart({ time: { created: Date.now(), end: Date.now() } });
      part = screen.getByText("Thought").closest(".reasoningPart");
    });

    // Shows Thought label
    it("Thought が表示されること", () => {
      expect(screen.getByText("Thought")).toBeInTheDocument();
    });

    // Has no active class (complete state)
    it("reasoningActive クラスが付与されないこと", () => {
      expect(part).not.toHaveClass("reasoningActive");
    });

    // No spinner
    it("スピナーが表示されないこと", () => {
      expect(part?.querySelector(".spinner")).not.toBeInTheDocument();
    });
  });

  // Clicking header expands/collapses thought content
  context("ヘッダをクリックした場合", () => {
    beforeEach(async () => {
      await setupWithReasoningPart({
        text: "Step 1: analyze the problem",
        time: { created: Date.now(), end: Date.now() },
      });
    });

    // Initially collapsed
    it("初期状態では本文が非表示こと", () => {
      expect(screen.queryByText("Step 1: analyze the problem")).not.toBeInTheDocument();
    });

    // Expands on click
    context("展開した場合", () => {
      beforeEach(async () => {
        const user = userEvent.setup();
        await user.click(screen.getByTitle("Toggle thought details"));
      });

      // Shows content
      it("本文が表示されること", async () => {
        expect(await screen.findByText("Step 1: analyze the problem")).toBeInTheDocument();
      });

      // Collapses on second click
      context("再クリックした場合", () => {
        beforeEach(async () => {
          const user = userEvent.setup();
          await user.click(screen.getByTitle("Toggle thought details"));
        });

        // Hides content
        it("本文が非表示になること", () => {
          expect(screen.queryByText("Step 1: analyze the problem")).not.toBeInTheDocument();
        });
      });
    });
  });
});
