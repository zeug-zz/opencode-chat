import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage } from "../../vscode-api";
import { createAllProvidersData, createProvider, createSession } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

/**
 * Primary-agent initialization fixture set.
 *
 * The exact `plan`-first selection is verified for three orderings:
 *   - `build` (`primary`) then `plan` (`primary`)
 *   - `build` (`primary`) then `plan` (`all`)
 *   - `plan` (`all`) then `build` (`primary`)
 *
 * The fallback (no `plan` agent) is verified for `build` (`primary`)
 * only and a subagent-only list.
 */
const buildPrimaryPlanPrimaryAgents = [
  {
    name: "build",
    description: "Primary build agent",
    mode: "primary",
    builtIn: true,
    permission: { edit: "ask", bash: {} },
    tools: {},
    options: {},
  },
  {
    name: "plan",
    description: "Primary plan agent",
    mode: "primary",
    builtIn: true,
    permission: { edit: "deny", bash: {} },
    tools: {},
    options: {},
  },
] as any;

const buildPrimaryPlanAllAgents = [
  {
    name: "build",
    description: "Primary build agent",
    mode: "primary",
    builtIn: true,
    permission: { edit: "ask", bash: {} },
    tools: {},
    options: {},
  },
  {
    name: "plan",
    description: "All-mode plan agent",
    mode: "all",
    builtIn: true,
    permission: { edit: "deny", bash: {} },
    tools: {},
    options: {},
  },
] as any;

const planAllBuildPrimaryAgents = [
  {
    name: "plan",
    description: "All-mode plan agent",
    mode: "all",
    builtIn: true,
    permission: { edit: "deny", bash: {} },
    tools: {},
    options: {},
  },
  {
    name: "build",
    description: "Primary build agent",
    mode: "primary",
    builtIn: true,
    permission: { edit: "ask", bash: {} },
    tools: {},
    options: {},
  },
] as any;

const buildOnlyPrimaryAgents = [
  {
    name: "build",
    description: "Primary build agent",
    mode: "primary",
    builtIn: true,
    permission: { edit: "ask", bash: {} },
    tools: {},
    options: {},
  },
] as any;

const subagentOnlyAgents = [
  {
    name: "general",
    description: "General purpose subagent",
    mode: "subagent",
    builtIn: true,
    permission: { edit: "ask", bash: {} },
    tools: {},
    options: {},
  },
] as any;

// Initialization
describe("初期化", () => {
  // On mount
  context("マウントした場合", () => {
    // Sends ready on mount
    it("ready を送信すること", () => {
      renderApp();

      expect(postMessage).toHaveBeenCalledWith({ type: "ready" });
    });

    // Sends getOpenEditors on mount
    it("getOpenEditors を送信すること", () => {
      renderApp();

      expect(postMessage).toHaveBeenCalledWith({ type: "getOpenEditors" });
    });

    it("getSkills を送信すること", () => {
      renderApp();

      expect(postMessage).toHaveBeenCalledWith({ type: "getSkills" });
    });
  });

  // When sessions message is received
  context("sessions メッセージを受信した場合", () => {
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(async () => {
      renderApp();
      const sessions = [createSession({ title: "My Session" }), createSession({ title: "Another" })];
      await sendExtMessage({ type: "sessions", sessions });

      user = userEvent.setup();
      await user.click(screen.getByTitle("Sessions"));
    });

    // First session is displayed
    it("最初のセッションが表示されること", () => {
      expect(screen.getByText("My Session")).toBeInTheDocument();
    });

    // Second session is displayed
    it("2番目のセッションが表示されること", () => {
      expect(screen.getByText("Another")).toBeInTheDocument();
    });
  });

  // When providers message has configModel
  context("providers メッセージに configModel がある場合", () => {
    // Selects model from configModel
    it("configModel からモデルが選択されること", async () => {
      renderApp();

      const provider = createProvider("anthropic", {
        "claude-4-opus": { id: "claude-4-opus", name: "Claude 4 Opus", limit: { context: 200000, output: 4096 } },
      });

      await sendExtMessage({
        type: "providers",
        providers: [provider],
        allProviders: createAllProvidersData(
          ["anthropic"],
          [
            {
              id: "anthropic",
              name: "Anthropic",
              models: {
                "claude-4-opus": {
                  id: "claude-4-opus",
                  name: "Claude 4 Opus",
                  limit: { context: 200000, output: 4096 },
                },
              },
            },
          ],
        ),
        default: { general: "anthropic/claude-4-opus" },
        configModel: "anthropic/claude-4-opus",
      });

      await sendExtMessage({ type: "activeSession", session: createSession() });

      expect(screen.getByText("Claude 4 Opus")).toBeInTheDocument();
    });
  });

  // When configModel is absent
  context("configModel がない場合", () => {
    // Falls back to default model
    it("default でフォールバックすること", async () => {
      renderApp();

      const provider = createProvider("openai", {
        "gpt-5": { id: "gpt-5", name: "GPT-5", limit: { context: 128000, output: 4096 } },
      });

      await sendExtMessage({
        type: "providers",
        providers: [provider],
        allProviders: createAllProvidersData(
          ["openai"],
          [
            {
              id: "openai",
              name: "OpenAI",
              models: { "gpt-5": { id: "gpt-5", name: "GPT-5", limit: { context: 128000, output: 4096 } } },
            },
          ],
        ),
        default: { general: "openai/gpt-5" },
      });

      await sendExtMessage({ type: "activeSession", session: createSession() });

      expect(screen.getByText("GPT-5")).toBeInTheDocument();
    });
  });

  // When locale message sets Japanese
  context("locale メッセージで日本語を設定した場合", () => {
    // Switches UI to Japanese
    it("EmptyState が日本語になること", async () => {
      renderApp();

      await sendExtMessage({ type: "locale", vscodeLanguage: "ja" });

      expect(screen.getByText("新しい会話を始めましょう。")).toBeInTheDocument();
    });
  });

  // When agents message arrives with build before plan (both primary)
  context("agents メッセージに plan を含む場合（build が先頭）", () => {
    beforeEach(async () => {
      renderApp();
      await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
      await sendExtMessage({ type: "agents", agents: buildPrimaryPlanPrimaryAgents });
    });

    // Selector shows plan
    it("AgentSelector が plan を表示すること", () => {
      expect(screen.getByTitle("Select agent")).toHaveTextContent("plan");
      expect(screen.queryByTitle("Select agent")).not.toHaveTextContent("build");
    });

    // Send payload uses primaryAgent: "plan"
    it('送信時に primaryAgent: "plan" が含まれること', async () => {
      const user = userEvent.setup();
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
      await user.type(textarea, "Hello{Enter}");
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sendMessage",
          text: "Hello",
          primaryAgent: "plan",
        }),
      );
    });
  });

  // When agents message includes plan with mode: "all" alongside build primary
  context("agents メッセージに plan（mode: all）と build（mode: primary）が含まれる場合", () => {
    beforeEach(async () => {
      renderApp();
      await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
      await sendExtMessage({ type: "agents", agents: buildPrimaryPlanAllAgents });
    });

    // Selector shows plan
    it("AgentSelector が plan を表示すること", () => {
      expect(screen.getByTitle("Select agent")).toHaveTextContent("plan");
    });
  });

  // When agents message starts with plan (mode: all) and build follows
  context("agents メッセージが plan（mode: all）から始まる場合", () => {
    beforeEach(async () => {
      renderApp();
      await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
      await sendExtMessage({ type: "agents", agents: planAllBuildPrimaryAgents });
    });

    // Selector still shows plan (no ordering regression)
    it("AgentSelector が plan を表示すること", () => {
      expect(screen.getByTitle("Select agent")).toHaveTextContent("plan");
    });
  });

  // When agents message has no plan, fallback to first primary/all
  context("agents メッセージに plan が含まれない場合", () => {
    beforeEach(async () => {
      renderApp();
      await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
      await sendExtMessage({ type: "agents", agents: buildOnlyPrimaryAgents });
    });

    // Selector shows build
    it("AgentSelector が build を表示すること（先頭の primary/all にフォールバック）", () => {
      expect(screen.getByTitle("Select agent")).toHaveTextContent("build");
    });

    // Send payload uses primaryAgent: "build"
    it('送信時に primaryAgent: "build" が含まれること', async () => {
      const user = userEvent.setup();
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
      await user.type(textarea, "Hi{Enter}");
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sendMessage",
          text: "Hi",
          primaryAgent: "build",
        }),
      );
    });
  });

  // When agents message has only subagents (no eligible primary/all)
  context("agents メッセージに primary/all エージェントが含まれない場合", () => {
    beforeEach(async () => {
      renderApp();
      await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
      await sendExtMessage({ type: "agents", agents: subagentOnlyAgents });
    });

    // Selector is not rendered (no eligible primary agents)
    it("AgentSelector が表示されないこと", () => {
      expect(screen.queryByTitle("Select agent")).not.toBeInTheDocument();
    });

    // Send payload does NOT include primaryAgent
    it("送信時に primaryAgent が含まれないこと", async () => {
      const user = userEvent.setup();
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
      await user.type(textarea, "Hi{Enter}");
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sendMessage",
          text: "Hi",
        }),
      );
      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sendMessage",
          primaryAgent: expect.anything(),
        }),
      );
    });
  });

  // When a primary agent is already user-selected and a new agents message
  // includes an eligible plan agent, the existing selection must be preserved.
  context("ユーザーが build を選択済みで、その後に plan を含む agents を受信した場合", () => {
    beforeEach(async () => {
      renderApp();
      await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
      // Initial agents: build only — fallback selects build
      await sendExtMessage({ type: "agents", agents: buildOnlyPrimaryAgents });
    });

    // Subsequent agents message with plan must not overwrite user choice
    it("AgentSelector は build のまま上書きされないこと", async () => {
      const user = userEvent.setup();

      // Sanity: fallback selected build.
      const trigger = screen.getByTitle("Select agent");
      expect(trigger).toHaveTextContent("build");

      // Simulate the user explicitly selecting build through the selector.
      // The popover item name lives in a separate node from the trigger
      // button label, so use getAllByText and pick the popover item.
      await user.click(trigger);
      const buildItems = screen.getAllByText("build");
      // [0] is the trigger label, [1] is the popover item.
      await user.click(buildItems[1]);

      // Now an agents message arrives that includes plan (eligible).
      await sendExtMessage({ type: "agents", agents: buildPrimaryPlanPrimaryAgents });

      // The user selection must remain build.
      expect(screen.getByTitle("Select agent")).toHaveTextContent("build");
      expect(screen.queryByTitle("Select agent")).not.toHaveTextContent("plan");

      // And the send payload must use build.
      vi.mocked(postMessage).mockClear();
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
      await user.type(textarea, "Persist{Enter}");
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "sendMessage",
          text: "Persist",
          primaryAgent: "build",
        }),
      );
    });
  });
});
