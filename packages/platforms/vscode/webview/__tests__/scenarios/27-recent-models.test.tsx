/**
 * Model Selector Recent section scenario tests.
 *
 * Verifies that selecting a model surfaces it under "Recent" on
 * re-open, that selecting a recent entry switches the model and
 * restores the persisted effort, and that the Recent section is
 * hidden while searching.
 *
 * Task 5.1 — recent-models-selector
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPersistedState, postMessage, setPersistedState } from "../../vscode-api";
import { createAllProvidersData, createProvider, createSession } from "../factories";
import { renderApp, sendExtMessage } from "../helpers";

// ============================================================
// Provider fixtures
// ============================================================

const openaiAllProvider = {
  id: "openai",
  name: "OpenAI",
  env: [],
  models: {
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
    "gpt-4": {
      id: "gpt-4",
      name: "GPT-4",
      limit: { context: 128000, output: 4096 },
      variants: {
        low: { label: "Low" },
        medium: { label: "Medium" },
        high: { label: "High" },
      },
    },
  },
};

const openaiConnectedProvider = createProvider("openai", {
  "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", limit: { context: 128000, output: 4096 } },
  "gpt-4": { id: "gpt-4", name: "GPT-4", limit: { context: 128000, output: 4096 } },
});

// ============================================================
// Test suite
// ============================================================

describe("モデルセレクターの Recent セクション", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------
  // 1. Select a model, reopen selector — it appears under Recent
  // ----------------------------------------------------------
  it("モデルを選択して開き直すと Recent に表示されること", async () => {
    const { container } = renderApp();
    await sendExtMessage({
      type: "providers",
      providers: [openaiConnectedProvider],
      allProviders: createAllProvidersData(["openai"], [openaiAllProvider as any]),
      default: { general: "openai/gpt-5.4" },
      configModel: "openai/gpt-5.4",
    });
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });

    // Open the model selector
    fireEvent.click(container.querySelector(".button")!);

    // Click the second .item — GPT-4 (first is already-selected GPT-5.4)
    const items = container.querySelectorAll(".item");
    fireEvent.click(items[1]);

    // setPersistedState should have been called with recentModels
    const calls = vi.mocked(setPersistedState).mock.calls;
    const recentCall = calls.find(([arg]) => Array.isArray((arg as Record<string, unknown>).recentModels));
    expect(recentCall, "setPersistedState must have been called with recentModels").toBeDefined();
    expect((recentCall![0] as { recentModels: unknown[] }).recentModels[0]).toEqual({
      providerID: "openai",
      modelID: "gpt-4",
    });

    // Reopen the selector
    fireEvent.click(container.querySelector(".button")!);

    // Recent section is visible
    expect(container.textContent).toContain("Recent");

    // Recent row shows the provider name (OpenAI from allProvidersData)
    const providerSpan = container.querySelector(".itemProvider");
    expect(providerSpan).toBeInTheDocument();
    expect(providerSpan!.textContent).toBe("OpenAI");

    // Search box shows the placeholder
    const searchInput = container.querySelector(".searchInput");
    expect(searchInput?.getAttribute("placeholder")).toBeTruthy();
  });

  // ----------------------------------------------------------
  // 2. Select a Recent model — model switches, effort restores
  // ----------------------------------------------------------
  it("Recent のモデルを選択すると選択され、effort が復元されること", async () => {
    vi.mocked(getPersistedState).mockReturnValue({
      modelEffortByModel: { "openai/gpt-4": "low" },
      recentModels: [{ providerID: "openai", modelID: "gpt-4" }],
    });

    const { container } = renderApp();
    await sendExtMessage({
      type: "providers",
      providers: [openaiConnectedProvider],
      allProviders: createAllProvidersData(["openai"], [openaiAllProvider as any]),
      default: { general: "openai/gpt-5.4" },
      configModel: "openai/gpt-5.4",
    });
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });

    // Open the selector
    fireEvent.click(container.querySelector(".button")!);

    // Recent section shows GPT-4 with provider "OpenAI"
    expect(container.textContent).toContain("Recent");
    const providerSpan = container.querySelector(".itemProvider");
    expect(providerSpan).toBeInTheDocument();
    expect(providerSpan!.textContent).toBe("OpenAI");

    // Click the Recent entry (first .item in the panel)
    const recentItem = container.querySelectorAll(".item")[0];
    fireEvent.click(recentItem);

    // Panel closes and trigger shows "GPT-4 · Low" (effort restored)
    expect(container.querySelector(".effort")?.textContent).toBe("Low");

    // Optional: verify sendMessage includes effort
    vi.mocked(postMessage).mockClear();
    const textarea = screen.getByPlaceholderText("Ask OpenCode... (type # to attach files)");
    const user = userEvent.setup();
    await user.type(textarea, "Hello{Enter}");

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sendMessage",
        effort: { id: "low", label: "Low" },
      }),
    );
  });

  // ----------------------------------------------------------
  // 3. Search hides the Recent section
  // ----------------------------------------------------------
  it("検索中は Recent セクションが非表示になること", async () => {
    vi.mocked(getPersistedState).mockReturnValue({
      recentModels: [{ providerID: "openai", modelID: "gpt-4" }],
    });

    const { container } = renderApp();
    await sendExtMessage({
      type: "providers",
      providers: [openaiConnectedProvider],
      allProviders: createAllProvidersData(["openai"], [openaiAllProvider as any]),
      default: { general: "openai/gpt-5.4" },
      configModel: "openai/gpt-5.4",
    });
    await sendExtMessage({ type: "activeSession", session: createSession({ id: "s1" }) });

    // Open the selector
    fireEvent.click(container.querySelector(".button")!);

    // Recent section is visible
    expect(container.textContent).toContain("Recent");

    // Type into the search input
    const searchInput = container.querySelector(".searchInput") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    // Recent section hidden, "no matching models" message shown
    expect(container.textContent).not.toContain("Recent");
    expect(container.textContent).toContain("No matching models");

    // Clear search
    fireEvent.change(searchInput!, { target: { value: "" } });

    // Recent section reappears
    expect(container.textContent).toContain("Recent");
  });
});
