/**
 * Ctrl+T effort cycling scenarios.
 *
 * task 2.3: Add `Ctrl+T` handling in the message input to cycle valid
 * efforts only when supported; verify shortcut behavior with React
 * Testing Library and ensure Enter, IME, popup navigation, and input
 * history tests still pass.
 *
 * Each scenario uses a synthetic `variants` map; no hardcoded provider
 * effort lists leak into production code. `defaultPrevented` and the
 * rendered `ModelSelector` label (`.effort`, `.separator`, `.modelName`
 * CSS-module classes) are the canonical observables for the cycle
 * action. Send/edit payloads are intentionally NOT inspected here —
 * that lives in task 3.1+.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputArea } from "../../components/organisms/InputArea/InputArea";
import { getPersistedState, postMessage } from "../../vscode-api";
import { createAllProvidersData, createMessage, createProvider, createSession, createTextPart } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

// ============================================================
// Synthetic provider fixtures
// ============================================================
//
// The GUI only reads `variants` keys; nothing about provider names or
// model ids is hardcoded in production code. The "reasoning-only"
// fixture is the same shape as the live-probe `deepseek-reasoner`
// (reasoning: true, no variants) and must remain unsupported for
// cycling per the discovery findings.

const openaiAllProvider = {
  id: "openai",
  name: "OpenAI",
  env: [],
  models: {
    // Full {low, medium, high} cycle.
    "gpt-5.4": {
      id: "gpt-5.4",
      name: "GPT-5.4",
      limit: { context: 128000, output: 4096 },
      variants: {
        low: { label: "Low" },
        medium: { label: "Medium" },
        high: { label: "High" },
      },
    },
    // Single-variant set: a cycle is still allowed and wraps to the
    // first/only entry.
    "gpt-5.4-mini": {
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      limit: { context: 128000, output: 4096 },
      variants: {
        minimal: { label: "Minimal" },
      },
    },
    // Reasoning-only, no variants: MUST NOT cycle, MUST NOT show
    // any effort text. Mirrors the deepseek-reasoner fixture.
    reasoner: {
      id: "reasoner",
      name: "Reasoner",
      reasoning: true,
      limit: { context: 128000, output: 4096 },
    },
  },
};

// Fallback `providers` list carries the same metadata; the cycle
// resolver falls back to this when allProvidersData is missing the
// model (defensive path).
const openaiConnectedProvider = createProvider("openai", {
  "gpt-5.4": {
    id: "gpt-5.4",
    name: "GPT-5.4",
    limit: { context: 128000, output: 4096 },
    variants: {
      low: { label: "Low" },
      medium: { label: "Medium" },
      high: { label: "High" },
    },
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    limit: { context: 128000, output: 4096 },
    variants: {
      minimal: { label: "Minimal" },
    },
  },
  reasoner: {
    id: "reasoner",
    name: "Reasoner",
    reasoning: true,
    limit: { context: 128000, output: 4096 },
  },
});

const deepseekConnectedProvider = createProvider("deepseek", {
  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    reasoning: true,
    limit: { context: 128000, output: 4096 },
  },
});

const deepseekAllProvider = {
  id: "deepseek",
  name: "DeepSeek",
  env: [],
  models: {
    "deepseek-reasoner": {
      id: "deepseek-reasoner",
      name: "DeepSeek Reasoner",
      reasoning: true,
      limit: { context: 128000, output: 4096 },
    },
  },
};

// ============================================================
// Setup helpers
// ============================================================

/**
 * Standard setup: render the app, load providers + allProvidersData
 * (with variants), and activate a session so the InputArea is
 * visible. Returns the textarea handle.
 */
async function setupWithVariants(
  defaultModel = "openai/gpt-5.4",
  providers = [openaiConnectedProvider],
  allProvidersRoot = openaiAllProvider,
) {
  renderApp();
  await sendExtMessage({
    type: "providers",
    providers,
    allProviders: createAllProvidersData(
      providers.map((p) => p.id),
      [allProvidersRoot as any],
    ),
    default: { general: defaultModel },
    configModel: defaultModel,
  });
  await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
  const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
  return textarea;
}

/**
 * Returns the rendered text content of the ModelSelector button
 * (the `.label` wrapper in ModelSelector.module.css). Effort is no
 * longer part of this label — use `getEffortText()` for that.
 */
function getModelButtonText(): string {
  const label = document.querySelector(".label");
  return label?.textContent ?? "";
}

/**
 * Returns the text content of the ModelEffortSelector button, or
 * null when no effort selector is rendered (unsupported model or
 * no setter wired).
 */
function getEffortText(): string | null {
  const btn = screen.queryByRole("button", { name: /^Select effort:/i });
  return btn?.textContent ?? null;
}

/**
 * Helper to build minimal but complete props for an isolated
 * `InputArea` render — used by the "no setter wired" scenarios.
 */
function makeBareProps(overrides: Record<string, unknown> = {}) {
  return {
    onSend: vi.fn(),
    onShellExecute: vi.fn(),
    onAbort: vi.fn(),
    isBusy: false,
    providers: [openaiConnectedProvider],
    allProvidersData: createAllProvidersData(["openai"], [openaiAllProvider as any]),
    selectedModel: { providerID: "openai", modelID: "gpt-5.4" },
    onModelSelect: vi.fn(),
    selectedPrimaryAgent: null,
    onPrimaryAgentSelect: vi.fn(),
    openEditors: [],
    activeEditorFile: null,
    workspaceFiles: [],
    prefillText: "",
    onPrefillConsumed: vi.fn(),
    openCodePaths: null,
    onOpenConfigFile: vi.fn(),
    onOpenTerminal: vi.fn(),
    localeSetting: "auto" as any,
    onLocaleSettingChange: vi.fn(),
    soundSettings: {} as any,
    onSoundSettingChange: vi.fn(),
    agents: [],
    skills: [],
    selectedModelVariants: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
    ],
    ...overrides,
  };
}

// ============================================================
// Ctrl+T effort cycling
// ============================================================

describe("Ctrl+T による effort サイクル", () => {
  // Reset all mocks between scenarios so sendMessage counts etc. are
  // isolated, even though Ctrl+T itself never sends a protocol
  // message (cycle is purely local state).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. cycling from unset picks the first explicit effort
  context("effort 未選択 + 対応モデルで Ctrl+T を押した場合", () => {
    it("最初の variant が選択されモデル名横に表示されること", async () => {
      const textarea = await setupWithVariants();

      // Baseline: effort selector shows "Default", model name has no suffix.
      expect(getEffortText()).toBe("Default");
      expect(getModelButtonText()).toBe("GPT-5.4");

      // Press Ctrl+T.
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });

      // First effort is "low" / "Low".
      expect(getEffortText()).toBe("Low");
      // The model button contains only the model name.
      expect(getModelButtonText()).toBe("GPT-5.4");
    });

    it("default が preventDefault され、既存のテキスト入力が影響を受けないこと", async () => {
      const textarea = await setupWithVariants();

      // type some text first so we can detect "didn't clobber" afterwards.
      const user = (await import("@testing-library/user-event")).default.setup();
      await user.type(textarea, "draft");

      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      // Wrap in act: the keydown handler triggers a React state
      // update in useProviders (setSelectedModelEffort), which would
      // otherwise emit an "act()" warning.
      act(() => {
        textarea.dispatchEvent(event);
      });

      // Cycle happened, default prevented.
      expect(event.defaultPrevented).toBe(true);
      // Existing draft text is untouched.
      expect(textarea).toHaveValue("draft");
    });
  });

  // 2. subsequent Ctrl+T cycles to next effort and wraps back to default/unset
  context("2 回目以降の Ctrl+T", () => {
    it("次の variant へ進み、最後から unset に戻ること", async () => {
      const textarea = await setupWithVariants();

      // 1st: low
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Low");

      // 2nd: medium
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Medium");

      // 3rd: high
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("High");

      // 4th: cycles back to unset — effort selector shows "Default"
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Default");
    });

    it("variant が 1 つだけのモデルでもサイクルして unset に戻ること", async () => {
      const textarea = await setupWithVariants("openai/gpt-5.4-mini");

      // Cycle once: should land on the only available variant.
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Minimal");

      // Cycle again: returns to unset (single variant: last === first).
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Default");
    });

    it("最後の variant から Ctrl+T で effort がクリアされること", async () => {
      const textarea = await setupWithVariants();

      // Cycle through all three: low → medium → high
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Low");

      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Medium");

      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("High");

      // One more Ctrl+T: effort clears, selector shows "Default"
      fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
      expect(getEffortText()).toBe("Default");

      // The model button contains only the model name (no effort text).
      expect(document.querySelector(".modelName")?.textContent).toBeTruthy();
      expect(getModelButtonText()).not.toContain("Low");
      expect(getModelButtonText()).not.toContain("Medium");
      expect(getModelButtonText()).not.toContain("High");
    });
  });

  // 3. preventDefault only when a valid cycle occurs
  context("preventDefault の挙動", () => {
    it("対応モデルでは preventDefault が呼ばれること", async () => {
      const textarea = await setupWithVariants();
      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        textarea.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
    });

    it("unsupported / variants 不在のモデルでは preventDefault されず effort も表示されないこと", async () => {
      const textarea = await setupWithVariants(
        "deepseek/deepseek-reasoner",
        [deepseekConnectedProvider],
        deepseekAllProvider,
      );

      // Pre-condition: no effort UI present.
      expect(getEffortText()).toBeNull();

      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      // Wrap in act for consistency with the other keydown
      // scenarios; the unsupported path itself doesn't update state
      // but the surrounding render lifecycle still expects the
      // dispatch to be inside a testing act batch.
      act(() => {
        textarea.dispatchEvent(event);
      });

      // Unsupported: no cycle, no preventDefault.
      expect(event.defaultPrevented).toBe(false);
      // No effort rendered.
      expect(getEffortText()).toBeNull();
    });

    it("Cmd+Ctrl+T (metaKey) はサイクルせず preventDefault もしないこと", async () => {
      const textarea = await setupWithVariants();

      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        textarea.dispatchEvent(event);
      });

      // Ctrl+Cmd+T (or accidental Cmd+T with ctrlKey) must NOT
      // hijack the user shortcut. We don't prevent default so the
      // platform/browser can still handle Cmd+T (open new tab).
      expect(event.defaultPrevented).toBe(false);
      // Effort selector still shows "Default" — no cycle occurred.
      expect(getEffortText()).toBe("Default");
    });

    it("Ctrl+Alt+T (altKey) はサイクルせず preventDefault もしないこと", async () => {
      const textarea = await setupWithVariants();

      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        textarea.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(false);
      expect(getEffortText()).toBe("Default");
    });
  });

  // 4. Ctrl+T does not leak when no setter is wired
  context("onModelEffortSelect が未指定の場合", () => {
    it("サイクルは行われず preventDefault もされないこと", async () => {
      // Render InputArea in isolation with no onModelEffortSelect.
      const props = makeBareProps();
      // Make sure no onModelEffortSelect is present.
      delete (props as any).onModelEffortSelect;
      const view = render(<InputArea {...props} />);
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");

      const event = new KeyboardEvent("keydown", {
        key: "t",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        textarea.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(false);
      // No setter → no effort selector rendered.
      expect(getEffortText()).toBeNull();
      view.unmount();
    });

    it("bare な Enter 入力など既存挙動に影響しないこと", async () => {
      // Regression guard: Ctrl+T no-op must not break text entry.
      const user = (await import("@testing-library/user-event")).default.setup();
      const props = makeBareProps();
      delete (props as any).onModelEffortSelect;
      const view = render(<InputArea {...props} />);
      const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");

      await user.type(textarea, "hello");

      // Plain Enter still doesn't fire because text is "hello" (which
      // IS a send) — but use Shift+Enter so we just observe the
      // newline path. The key point is that text content is intact.
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      expect((textarea as HTMLTextAreaElement).value).toContain("hello");
      view.unmount();
    });
  });
});

// ============================================================
// Effort menu interaction: selecting from the clickable menu
// (not Ctrl+T) must update the UI, close the popover, preserve
// draft text, restore textarea focus, and allow Default to
// clear the explicit override.
// ============================================================

describe("Effort menu interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selecting a variant from the menu updates the effort label and preserves draft text and focus", async () => {
    const textarea = await setupWithVariants();
    const user = userEvent.setup();

    await user.type(textarea, "Draft message");

    // Open the effort menu
    const effortButton = screen.getByRole("button", { name: /^Select effort:/i });
    await user.click(effortButton);

    // Select "Low"
    await user.click(screen.getByText("Low"));

    // Effort label reflects the choice
    expect(getEffortText()).toBe("Low");

    // Draft text preserved
    expect(textarea).toHaveValue("Draft message");

    // Focus restored — can continue typing
    await user.type(textarea, " and more");
    expect(textarea).toHaveValue("Draft message and more");
  });

  it("selecting Default from the menu clears the explicit effort", async () => {
    const textarea = await setupWithVariants();
    const user = userEvent.setup();

    // First set an explicit effort via Ctrl+T
    fireEvent.keyDown(textarea, { key: "t", ctrlKey: true });
    expect(getEffortText()).toBe("Low");

    // Open the effort menu
    const effortButton = screen.getByRole("button", { name: /^Select effort:/i });
    await user.click(effortButton);

    // Click the Default radio option (first in the radiogroup)
    const radios = screen.getAllByRole("radio");
    await user.click(radios[0]);

    // Effort shows "Default" — override cleared
    expect(getEffortText()).toBe("Default");
  });

  it("menu click closes the popover panel", async () => {
    const textarea = await setupWithVariants();
    const user = userEvent.setup();

    // Open menu
    const effortButton = screen.getByRole("button", { name: /^Select effort:/i });
    await user.click(effortButton);

    // Panel is visible
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();

    // Select a variant
    await user.click(screen.getByText("Medium"));

    // Panel is closed
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

// ============================================================
// Task 4.1: Persisted effort survives webview remount and
// appears in chat/edit payloads only when restored as valid.
// ============================================================

describe("永続化された effort の復元と送信ペイロード (Task 4.1)", () => {
  // No describe-level beforeEach — the global setup.ts
  // clearAllMocks() runs before each test, ensuring clean state.

  // ----------------------------------------------------------
  // 1. Persisted effort survives webview remount
  // ----------------------------------------------------------
  it("永続化された effort が webview 再マウント後に復元され sendMessage に含まれること", async () => {
    vi.mocked(getPersistedState).mockReturnValue({
      modelEffortByModel: { "openai/gpt-5.4": "low" },
    });

    renderApp();
    await sendExtMessage({
      type: "providers",
      providers: [openaiConnectedProvider],
      allProviders: createAllProvidersData(["openai"], [openaiAllProvider as any]),
      default: { general: "openai/gpt-5.4" },
      configModel: "openai/gpt-5.4",
    });
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });

    // ModelEffortSelector shows "Low" effort label restored from persistence.
    expect(getEffortText()).toBe("Low");

    // Send a message — verify effort is included in the payload.
    vi.mocked(postMessage).mockClear();
    const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
    const user = userEvent.setup();
    await user.type(textarea, "Hello{Enter}");

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sendMessage",
        sessionId: "s1",
        text: "Hello",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        effort: { id: "low", label: "Low" },
      }),
    );
  });

  // ----------------------------------------------------------
  // 2. Persisted effort included in editAndResend payload
  // ----------------------------------------------------------
  it("永続化された effort が editAndResend ペイロードに含まれること", async () => {
    vi.mocked(getPersistedState).mockReturnValue({
      modelEffortByModel: { "openai/gpt-5.4": "low" },
    });

    renderApp();
    await sendExtMessage({
      type: "providers",
      providers: [openaiConnectedProvider],
      allProviders: createAllProvidersData(["openai"], [openaiAllProvider as any]),
      default: { general: "openai/gpt-5.4" },
      configModel: "openai/gpt-5.4",
    });

    const session = createSession({ id: "s1" });
    await sendExtMessage({ type: "activeSession", session });

    // Set up messages: user → assistant → user (edit targets second user msg).
    const userMsg1 = createMessage({ id: "m1", sessionID: "s1", role: "user" });
    const userPart1 = createTextPart("First question", { messageID: "m1" });
    const assistantMsg = createMessage({ id: "m2", sessionID: "s1", role: "assistant" });
    const assistantPart = createTextPart("First answer", { messageID: "m2" });
    const userMsg2 = createMessage({ id: "m3", sessionID: "s1", role: "user" });
    const userPart2 = createTextPart("Second question", { messageID: "m3" });

    await sendExtMessage({
      type: "messages",
      sessionId: "s1",
      messages: [
        { info: userMsg1, parts: [userPart1] },
        { info: assistantMsg, parts: [assistantPart] },
        { info: userMsg2, parts: [userPart2] },
      ],
    });
    vi.mocked(postMessage).mockClear();

    // Edit-and-resend on the last user message.
    const user = userEvent.setup();
    await user.click(screen.getByText("Second question"));
    const editTextarea = screen.getByDisplayValue("Second question");
    await user.clear(editTextarea);
    await user.type(editTextarea, "Revised{Enter}");

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "editAndResend",
        sessionId: "s1",
        messageId: "m2",
        text: "Revised",
        effort: { id: "low", label: "Low" },
      }),
    );
  });

  // ----------------------------------------------------------
  // 3. Stale persisted effort NOT included in payloads
  // ----------------------------------------------------------
  it("無効な永続化 effort は復元されず sendMessage に effort が含まれないこと", async () => {
    vi.mocked(getPersistedState).mockReturnValue({
      modelEffortByModel: { "openai/gpt-5.4": "nonexistent" },
    });

    renderApp();
    await sendExtMessage({
      type: "providers",
      providers: [openaiConnectedProvider],
      allProviders: createAllProvidersData(["openai"], [openaiAllProvider as any]),
      default: { general: "openai/gpt-5.4" },
      configModel: "openai/gpt-5.4",
    });
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });

    // Effort remains unset — stale value is ignored, selector shows "Default".
    expect(getEffortText()).toBe("Default");

    // Send message — effort must NOT appear in payload.
    vi.mocked(postMessage).mockClear();
    const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
    const user = userEvent.setup();
    await user.type(textarea, "Hello{Enter}");

    const calls = vi.mocked(postMessage).mock.calls;
    const sendCall = calls.find((c) => (c[0] as { type?: string })?.type === "sendMessage");
    expect(sendCall, "sendMessage must have been called").toBeDefined();
    expect("effort" in (sendCall![0] as object)).toBe(false);
  });

  // ----------------------------------------------------------
  // 4. No persisted effort means no effort in payload
  //    (already covered by 03-messaging.test.tsx; added here
  //     for explicit coverage in persistence context.)
  // ----------------------------------------------------------
  it("永続化 effort がない場合 sendMessage に effort が含まれないこと", async () => {
    // Default: getPersistedState returns undefined (setup.ts mock).
    renderApp();
    await sendExtMessage({
      type: "providers",
      providers: [openaiConnectedProvider],
      allProviders: createAllProvidersData(["openai"], [openaiAllProvider as any]),
      default: { general: "openai/gpt-5.4" },
      configModel: "openai/gpt-5.4",
    });
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });
    vi.mocked(postMessage).mockClear();

    const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
    const user = userEvent.setup();
    await user.type(textarea, "Hello{Enter}");

    const calls = vi.mocked(postMessage).mock.calls;
    const sendCall = calls.find((c) => (c[0] as { type?: string })?.type === "sendMessage");
    expect(sendCall, "sendMessage must have been called").toBeDefined();
    expect("effort" in (sendCall![0] as object)).toBe(false);
  });
});
