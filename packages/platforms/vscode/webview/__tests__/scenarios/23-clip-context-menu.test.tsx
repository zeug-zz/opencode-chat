import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage } from "../../vscode-api";
import { createSession } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

/** テスト用エージェントデータ */
const testAgents = [
  {
    name: "general",
    description: "General purpose subagent",
    mode: "subagent",
    builtIn: true,
    permission: { edit: "ask", bash: {} },
    tools: {},
    options: {},
  },
  {
    name: "explore",
    description: "Read-only exploration subagent",
    mode: "subagent",
    builtIn: true,
    permission: { edit: "deny", bash: {} },
    tools: {},
    options: {},
  },
] as any;

const testSkills = [
  {
    name: "coding-guidelines",
    description: "Code with project guidelines",
    location: "/skills/coding-guidelines",
  },
] as any;

/** エージェント付きセットアップ */
async function setupWithAgents() {
  renderApp();
  await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
  await sendExtMessage({ type: "agents", agents: testAgents });
  await sendExtMessage({ type: "skills", skills: testSkills });
  vi.mocked(postMessage).mockClear();
}

// Clip context menu integration
describe("統合コンテキストメニュー", () => {
  // Opening the menu shows three sections
  context("クリップボタンをクリックした場合", () => {
    beforeEach(async () => {
      await setupWithAgents();
    });

    it("ファイル・エージェント・スキルの 3 セクションが表示されること", async () => {
      const user = userEvent.setup();
      const clipButton = screen.getByTitle("Add context");
      await user.click(clipButton);
      expect(screen.getByText("Files")).toBeInTheDocument();
      expect(screen.getByText("Sub-agents")).toBeInTheDocument();
      expect(screen.getByText("Skills")).toBeInTheDocument();
      expect(screen.queryByText("Shell Mode")).not.toBeInTheDocument();
    });
  });

  // Selecting an agent from the menu
  context("統合メニューからエージェントを選択した場合", () => {
    beforeEach(async () => {
      await setupWithAgents();
    });

    // shows agent chip in contextBar
    it("エージェントチップが contextBar に表示されること", async () => {
      const user = userEvent.setup();
      await user.click(screen.getByTitle("Add context"));
      await user.click(screen.getByText("general"));
      expect(screen.getByText("@general")).toBeInTheDocument();
    });

    // includes agent in sendMessage
    it("送信時に agent が含まれること", async () => {
      const user = userEvent.setup();
      await user.click(screen.getByTitle("Add context"));
      await user.click(screen.getByText("general"));
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
      await user.type(textarea, "Fix the bug{Enter}");
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sendMessage",
          text: "Fix the bug",
          agent: "general",
        }),
      );
    });
  });

  context("統合メニューからスキルを選択した場合", () => {
    beforeEach(async () => {
      await setupWithAgents();
    });

    it("スキルチップが contextBar に表示されること", async () => {
      const user = userEvent.setup();
      await user.click(screen.getByTitle("Add context"));
      await user.click(screen.getByText("coding-guidelines"));
      expect(screen.getByText("/coding-guidelines")).toBeInTheDocument();
    });

    it("送信時に skill が含まれること", async () => {
      const user = userEvent.setup();
      await user.click(screen.getByTitle("Add context"));
      await user.click(screen.getByText("coding-guidelines"));
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
      await user.type(textarea, "Fix the bug{Enter}");
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sendMessage",
          text: "Fix the bug",
          skill: "coding-guidelines",
        }),
      );
    });
  });
});
