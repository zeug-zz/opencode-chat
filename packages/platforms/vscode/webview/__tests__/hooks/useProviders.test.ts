import type { AllProvidersData, ModelInfo, ProviderInfo } from "@opencode-chat/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProviders } from "../../hooks/useProviders";
import { getPersistedState, postMessage, setPersistedState } from "../../vscode-api";

// ============================================================
// Test fixtures (synthetic providers / models with variants)
// ============================================================
//
// Per task 2.1: "Use synthetic providers/allProvidersData with
// `variants` maps; do not hardcode effort lists except in test
// fixtures as metadata keys."

// OpenAI gpt-5.4 style: full {low, medium, high} variant set.
const gpt54: ModelInfo = {
  id: "openai/gpt-5.4",
  name: "GPT-5.4",
  limit: { context: 0, output: 0 },
  variants: {
    low: { label: "Low" },
    medium: { label: "Medium" },
    high: { label: "High" },
  },
};

// OpenAI gpt-5.4-mini: subset of gpt-5.4's variants but still
// shares the "low" id, so a switch from gpt-5.4 must keep it.
const gpt54Mini: ModelInfo = {
  id: "openai/gpt-5.4-mini",
  name: "GPT-5.4 Mini",
  limit: { context: 0, output: 0 },
  variants: {
    low: { label: "Low" },
    medium: { label: "Medium" },
  },
};

// Anthropic claude-opus: different variant set entirely.
const claudeOpus: ModelInfo = {
  id: "anthropic/claude-opus",
  name: "Claude Opus",
  limit: { context: 0, output: 0 },
  variants: {
    low: { label: "Low" },
    medium: { label: "Medium" },
    // no "high" — switching to this with prior "high" effort must clear.
  },
};

// DeepSeek deepseek-reasoner: reasoning-only model with no variants.
// Mirrors the live probe finding (deepseek-reasoner has no variants).
const deepseekReasoner: ModelInfo = {
  id: "deepseek/deepseek-reasoner",
  name: "DeepSeek Reasoner",
  reasoning: true,
  limit: { context: 0, output: 0 },
  // intentionally no variants
};

const openaiProvider: ProviderInfo = {
  id: "openai",
  name: "OpenAI",
  env: [],
  models: {
    "gpt-5.4": gpt54,
    "gpt-5.4-mini": gpt54Mini,
  },
};

const anthropicProvider: ProviderInfo = {
  id: "anthropic",
  name: "Anthropic",
  env: [],
  models: {
    "claude-opus": claudeOpus,
  },
};

const deepseekProvider: ProviderInfo = {
  id: "deepseek",
  name: "DeepSeek",
  env: [],
  models: {
    "deepseek-reasoner": deepseekReasoner,
  },
};

const allProvidersDataFixture: AllProvidersData = {
  all: [openaiProvider, anthropicProvider, deepseekProvider],
  default: {},
  connected: ["openai", "anthropic", "deepseek"],
};

describe("useProviders", () => {
  // initial state
  context("初期状態の場合", () => {
    // providers is empty
    it("providers が空配列であること", () => {
      const { result } = renderHook(() => useProviders());
      expect(result.current.providers).toEqual([]);
    });

    // selectedModel is null
    it("selectedModel が null であること", () => {
      const { result } = renderHook(() => useProviders());
      expect(result.current.selectedModel).toBeNull();
    });

    // allProvidersData is null
    it("allProvidersData が null であること", () => {
      const { result } = renderHook(() => useProviders());
      expect(result.current.allProvidersData).toBeNull();
    });

    // 1. initial selected effort is unset
    // - "Preserve default effort until explicitly selected" requirement
    it("selectedModelEffort が undefined であること", () => {
      const { result } = renderHook(() => useProviders());
      expect(result.current.selectedModelEffort).toBeUndefined();
    });
  });

  // handleModelSelect
  context("handleModelSelect を呼んだ場合", () => {
    // updates selectedModel
    it("selectedModel が更新されること", () => {
      const { result } = renderHook(() => useProviders());
      const model = { providerID: "openai", modelID: "gpt-4" };
      act(() => result.current.handleModelSelect(model));
      expect(result.current.selectedModel).toEqual(model);
    });

    // sends setModel message
    it("setModel メッセージを送信すること", () => {
      const { result } = renderHook(() => useProviders());
      const model = { providerID: "openai", modelID: "gpt-4" };
      act(() => result.current.handleModelSelect(model));
      expect(postMessage).toHaveBeenCalledWith({ type: "setModel", model: "openai/gpt-4" });
    });
  });

  // setters
  context("setters でステートを更新する場合", () => {
    // setProviders updates providers
    it("setProviders で providers を設定できること", () => {
      const { result } = renderHook(() => useProviders());
      const providers = [{ id: "anthropic", models: {} }] as any[];
      act(() => result.current.setProviders(providers));
      expect(result.current.providers).toEqual(providers);
    });

    // setAllProvidersData updates allProvidersData
    it("setAllProvidersData で allProvidersData を設定できること", () => {
      const { result } = renderHook(() => useProviders());
      const data = { anthropic: { name: "Anthropic", models: {} } } as any;
      act(() => result.current.setAllProvidersData(data));
      expect(result.current.allProvidersData).toEqual(data);
    });

    // setSelectedModel with function updater
    it("setSelectedModel に関数を渡してモデルを設定できること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setSelectedModel(() => ({ providerID: "openai", modelID: "gpt-4o" })));
      expect(result.current.selectedModel).toEqual({ providerID: "openai", modelID: "gpt-4o" });
    });
  });

  // effort state — initial + explicit selection
  context("effort state の場合", () => {
    // 2. setting/selecting an explicit supported effort stores normalized state
    context("サポートされた effort を setSelectedModelEffort で設定した場合", () => {
      it("label を含む normalized な state を保存すること", () => {
        const { result } = renderHook(() => useProviders());
        act(() => result.current.setAllProvidersData(allProvidersDataFixture));
        act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
        act(() => result.current.setSelectedModelEffort({ id: "low" }));
        expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });
      });

      it("label が存在しない variant は id のみを保存すること", () => {
        const { result } = renderHook(() => useProviders());
        // Use a model where one variant has no label/name/title.
        const bareModel: ModelInfo = {
          id: "openai/gpt-bare",
          name: "Bare",
          limit: { context: 0, output: 0 },
          variants: { minimal: { reasoningEffort: "minimal" } },
        };
        const data: AllProvidersData = {
          all: [{ id: "openai", name: "OpenAI", env: [], models: { "gpt-bare": bareModel } }],
          default: {},
          connected: ["openai"],
        };
        act(() => result.current.setAllProvidersData(data));
        act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-bare" }));
        act(() => result.current.setSelectedModelEffort({ id: "minimal" }));
        expect(result.current.selectedModelEffort).toEqual({ id: "minimal" });
      });

      it("モデルが未選択の場合、effort は保存されず undefined のままとなること", () => {
        // Spec: do not guess effort when no model is selected.
        const { result } = renderHook(() => useProviders());
        act(() => result.current.setAllProvidersData(allProvidersDataFixture));
        // Note: no setSelectedModel call.
        act(() => result.current.setSelectedModelEffort({ id: "low" }));
        expect(result.current.selectedModelEffort).toBeUndefined();
      });

      it("undefined を渡して effort をクリアできること", () => {
        const { result } = renderHook(() => useProviders());
        act(() => result.current.setAllProvidersData(allProvidersDataFixture));
        act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
        act(() => result.current.setSelectedModelEffort({ id: "low" }));
        act(() => result.current.setSelectedModelEffort(undefined));
        expect(result.current.selectedModelEffort).toBeUndefined();
      });
    });
  });

  // effort persistence write (Decision 3: write/clear on explicit selection)
  context("effort の永続化書き込み", () => {
    beforeEach(() => {
      vi.mocked(getPersistedState).mockReturnValue(undefined);
    });

    it("有効な effort を設定すると setPersistedState が正しいキーと値で呼ばれること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "low" }));
      expect(setPersistedState).toHaveBeenCalledWith({
        modelEffortByModel: { "openai/gpt-5.4": "low" },
      });
    });

    it("effort をクリアするとキーが削除されること", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        modelEffortByModel: { "openai/gpt-5.4": "low" },
      });
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort(undefined));
      // The key was the only entry, so modelEffortByModel is removed entirely.
      expect(setPersistedState).toHaveBeenCalledWith({});
    });

    it("unrelated fields (localeSetting, inputHistory) が effort 書き込み時に保持されること", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        localeSetting: "ja",
        inputHistory: ["hello"],
      });
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "medium" }));
      expect(setPersistedState).toHaveBeenCalledWith({
        localeSetting: "ja",
        inputHistory: ["hello"],
        modelEffortByModel: { "openai/gpt-5.4": "medium" },
      });
    });

    it("unrelated fields (localeSetting, inputHistory) が effort クリア時に保持されること", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        localeSetting: "ja",
        inputHistory: ["world"],
        modelEffortByModel: { "openai/gpt-5.4": "low" },
      });
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort(undefined));
      expect(setPersistedState).toHaveBeenCalledWith({
        localeSetting: "ja",
        inputHistory: ["world"],
        // modelEffortByModel removed entirely (was the only entry)
      });
    });
  });

  // effort invalidation on model change
  context("選択モデルを変更した場合", () => {
    // 3. switching to a model that supports the same effort keeps it
    it("同じ effort id をサポートするモデルへ切り替えると effort が維持されること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "low" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });

      // gpt-5.4-mini also supports "low"; effort must be preserved.
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4-mini" }));
      expect(result.current.selectedModel).toEqual({ providerID: "openai", modelID: "gpt-5.4-mini" });
      expect(result.current.selectedModelEffort).toBeDefined();
      expect(result.current.selectedModelEffort?.id).toBe("low");
    });

    // 4. switching to a model that does not support the prior effort clears it
    it("prior effort をサポートしないモデルへ切り替えると effort がクリアされること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "high" }));
      expect(result.current.selectedModelEffort?.id).toBe("high");

      // anthropic/claude-opus has no "high" variant — effort must be cleared.
      act(() => result.current.setSelectedModel({ providerID: "anthropic", modelID: "claude-opus" }));
      expect(result.current.selectedModelEffort).toBeUndefined();
    });

    // 5. switching to a reasoning-only/no-variants model clears it and does not guess
    it("variants がない reasoning-only モデルへ切り替えると effort がクリアされ、推測もしないこと", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "low" }));
      expect(result.current.selectedModelEffort?.id).toBe("low");

      // deepseek-reasoner: reasoning: true but no variants map.
      // The GUI must clear, not invent an effort value.
      act(() => result.current.setSelectedModel({ providerID: "deepseek", modelID: "deepseek-reasoner" }));
      expect(result.current.selectedModelEffort).toBeUndefined();
    });

    // 7a. direct setSelectedModel value-form invalidates effort
    it("setSelectedModel を値形式で呼んだ場合も effort が invalidate されること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "high" }));

      // Direct value-form path (App.tsx pattern).
      act(() => result.current.setSelectedModel({ providerID: "anthropic", modelID: "claude-opus" }));
      expect(result.current.selectedModel).toEqual({ providerID: "anthropic", modelID: "claude-opus" });
      expect(result.current.selectedModelEffort).toBeUndefined();
    });

    // 7b. direct setSelectedModel function-form invalidates effort
    it("setSelectedModel を関数形式で呼んだ場合も effort が invalidate されること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "high" }));

      // Direct function-form path (App.tsx pattern in the "providers" handler).
      act(() =>
        result.current.setSelectedModel(() => ({
          providerID: "anthropic",
          modelID: "claude-opus",
        })),
      );
      expect(result.current.selectedModel).toEqual({ providerID: "anthropic", modelID: "claude-opus" });
      expect(result.current.selectedModelEffort).toBeUndefined();
    });

    // 6. existing selected model behavior and setModel postMessage still works
    context("既存挙動 (handleModelSelect 経由)", () => {
      it("setModel postMessage はそのまま送信されること", () => {
        const { result } = renderHook(() => useProviders());
        act(() => result.current.setAllProvidersData(allProvidersDataFixture));
        act(() => result.current.handleModelSelect({ providerID: "openai", modelID: "gpt-5.4" }));
        expect(postMessage).toHaveBeenCalledWith({ type: "setModel", model: "openai/gpt-5.4" });
      });

      it("handleModelSelect 後のモデル変更で effort が invalidate されること", () => {
        const { result } = renderHook(() => useProviders());
        act(() => result.current.setAllProvidersData(allProvidersDataFixture));
        act(() => result.current.handleModelSelect({ providerID: "openai", modelID: "gpt-5.4" }));
        act(() => result.current.setSelectedModelEffort({ id: "high" }));
        // Switch to a model without "high" via handleModelSelect.
        act(() => result.current.handleModelSelect({ providerID: "deepseek", modelID: "deepseek-reasoner" }));
        expect(result.current.selectedModel).toEqual({ providerID: "deepseek", modelID: "deepseek-reasoner" });
        expect(result.current.selectedModelEffort).toBeUndefined();
      });
    });
  });

  // effort revalidation on metadata change
  context("プロバイダメタデータが更新された場合", () => {
    it("サポートされている effort は維持されること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "low" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });

      // Refresh allProvidersData with a new reference but identical content.
      act(() => result.current.setAllProvidersData({ ...allProvidersDataFixture }));
      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });
    });

    it("新たに unsupported (disabled) になった effort はクリアされること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      act(() => result.current.setSelectedModelEffort({ id: "low" }));
      expect(result.current.selectedModelEffort?.id).toBe("low");

      // Simulate metadata refresh: "low" becomes disabled on this model.
      const refreshed: AllProvidersData = {
        ...allProvidersDataFixture,
        all: allProvidersDataFixture.all.map((p) =>
          p.id === "openai"
            ? {
                ...p,
                models: {
                  ...p.models,
                  "gpt-5.4": {
                    ...gpt54,
                    variants: {
                      low: { label: "Low", disabled: true },
                      medium: { label: "Medium" },
                      high: { label: "High" },
                    },
                  },
                },
              }
            : p,
        ),
      };
      act(() => result.current.setAllProvidersData(refreshed));
      expect(result.current.selectedModelEffort).toBeUndefined();
    });
  });

  // persisted effort restoration (Decision 2: validate before restore)
  context("永続化された effort の復元", () => {
    it("有効な persisted effort が復元されること", () => {
      const mockGetPersistedState = vi.mocked(getPersistedState);
      mockGetPersistedState.mockReturnValue({
        modelEffortByModel: { "openai/gpt-5.4": "low" },
      });

      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));

      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });
    });

    it("無効な persisted effort は復元されず unset のままとなること", () => {
      const mockGetPersistedState = vi.mocked(getPersistedState);
      mockGetPersistedState.mockReturnValue({
        modelEffortByModel: { "openai/gpt-5.4": "nonexistent" },
      });

      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));

      expect(result.current.selectedModelEffort).toBeUndefined();
    });

    it("persisted state が存在しない場合は unset のままとなること", () => {
      // getPersistedState returns undefined by default (from setup mock).
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));

      expect(result.current.selectedModelEffort).toBeUndefined();
    });

    it("インメモリの effort が persisted effort より優先されること", () => {
      const mockGetPersistedState = vi.mocked(getPersistedState);
      mockGetPersistedState.mockReturnValue({
        modelEffortByModel: { "openai/gpt-5.4": "low" },
      });

      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      // Initially restored "low" from persistence.
      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });

      // Explicitly set a different valid effort — in-memory takes precedence.
      act(() => result.current.setSelectedModelEffort({ id: "medium" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "medium", label: "Medium" });

      // Trigger effect re-run via metadata refresh.
      act(() => result.current.setAllProvidersData({ ...allProvidersDataFixture }));
      // In-memory "medium" must be preserved, not overwritten by persisted "low".
      expect(result.current.selectedModelEffort).toEqual({ id: "medium", label: "Medium" });
    });
  });

  // model-switch round-trip (task 2.3): per-model remembered effort
  context("モデル切替時の effort 保持（ラウンドトリップ）", () => {
    it("A→B 切替で B の永続化 effort が復元されること", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        modelEffortByModel: {
          "openai/gpt-5.4": "low",
          "anthropic/claude-opus": "medium",
        },
      });

      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));

      // Select gpt-5.4 → "low" restored
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });

      // Switch to claude-opus → "medium" restored (different model's own persisted effort)
      act(() => result.current.setSelectedModel({ providerID: "anthropic", modelID: "claude-opus" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "medium", label: "Medium" });
    });

    it("B→A 切替で A の永続化 effort が復元されること", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        modelEffortByModel: {
          "openai/gpt-5.4": "low",
          "anthropic/claude-opus": "medium",
        },
      });

      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));

      // Select claude-opus first → "medium" restored
      act(() => result.current.setSelectedModel({ providerID: "anthropic", modelID: "claude-opus" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "medium", label: "Medium" });

      // Switch to gpt-5.4 → "low" restored (back to first model's effort)
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });
    });

    it("ラウンドトリップ: effort 設定→切替→復元が正しく動作すること", () => {
      // Pre-populate claude-opus with medium only (gpt-5.4 will be set at runtime)
      vi.mocked(getPersistedState).mockReturnValue({
        modelEffortByModel: { "anthropic/claude-opus": "medium" },
      });

      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));

      // Select gpt-5.4 → no persisted effort for it → undefined
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelEffort).toBeUndefined();

      // Set effort to "high" explicitly → persisted
      act(() => result.current.setSelectedModelEffort({ id: "high" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "high", label: "High" });

      // Update getPersistedState to reflect what was written
      vi.mocked(getPersistedState).mockReturnValue({
        modelEffortByModel: {
          "openai/gpt-5.4": "high",
          "anthropic/claude-opus": "medium",
        },
      });

      // Switch to claude-opus → "medium" restored (claude's persisted effort)
      act(() => result.current.setSelectedModel({ providerID: "anthropic", modelID: "claude-opus" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "medium", label: "Medium" });

      // Switch back to gpt-5.4 → "high" restored (gpt-5.4's persisted effort)
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "high", label: "High" });
    });

    it("一方のモデルの effort クリアが他方のモデルの永続化 effort に影響しないこと", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        modelEffortByModel: {
          "openai/gpt-5.4": "low",
          "anthropic/claude-opus": "medium",
        },
      });

      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));

      // Select gpt-5.4 → "low" restored
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "low", label: "Low" });

      // Clear effort on gpt-5.4
      act(() => result.current.setSelectedModelEffort(undefined));
      expect(result.current.selectedModelEffort).toBeUndefined();

      // Verify setPersistedState removed only gpt-5.4 key, preserved claude-opus
      expect(setPersistedState).toHaveBeenCalledWith({
        modelEffortByModel: { "anthropic/claude-opus": "medium" },
      });

      // Switch to claude-opus → "medium" still restored (claude's effort untouched)
      act(() => result.current.setSelectedModel({ providerID: "anthropic", modelID: "claude-opus" }));
      expect(result.current.selectedModelEffort).toEqual({ id: "medium", label: "Medium" });
    });
  });

  describe("recentModels", () => {
    it("モデルを選択すると recentModels の先頭に追加されること", () => {
      const { result } = renderHook(() => useProviders());
      const model = { providerID: "openai", modelID: "gpt-4" };
      act(() => result.current.handleModelSelect(model));
      expect(result.current.recentModels[0]).toEqual(model);
      expect(result.current.recentModels).toHaveLength(1);
    });

    it("同じモデルを再選択すると先頭に移動し重複しないこと", () => {
      const { result } = renderHook(() => useProviders());
      const modelA = { providerID: "openai", modelID: "gpt-4" };
      const modelB = { providerID: "anthropic", modelID: "claude-opus" };
      act(() => result.current.handleModelSelect(modelA));
      act(() => result.current.handleModelSelect(modelB));
      act(() => result.current.handleModelSelect(modelA));
      expect(result.current.recentModels).toEqual([modelA, modelB]);
    });

    it("6個目を選択すると最も古いものが削除されること", () => {
      const { result } = renderHook(() => useProviders());
      const models = Array.from({ length: 6 }, (_, i) => ({
        providerID: `provider${i}`,
        modelID: `model${i}`,
      }));
      for (const m of models) {
        act(() => result.current.handleModelSelect(m));
      }
      expect(result.current.recentModels).toHaveLength(5);
      // The 6th (oldest, index 0) should be absent; the last selected should be first.
      expect(result.current.recentModels[0]).toEqual(models[5]);
      expect(
        result.current.recentModels.find(
          (m) => m.providerID === models[0].providerID && m.modelID === models[0].modelID,
        ),
      ).toBeUndefined();
    });

    it("永続化時に他のフィールド (localeSetting, inputHistory, soundSettings, modelEffortByModel) が保護されること", () => {
      const baseState = {
        localeSetting: "ja",
        inputHistory: ["hello"],
        soundSettings: { responseComplete: { enabled: true } },
        modelEffortByModel: { "openai/gpt": "low" },
      };
      vi.mocked(getPersistedState).mockReturnValue(baseState);
      const { result } = renderHook(() => useProviders());
      const model = { providerID: "openai", modelID: "gpt-4" };
      act(() => result.current.handleModelSelect(model));
      expect(setPersistedState).toHaveBeenCalledWith({
        ...baseState,
        recentModels: [model],
      });
    });
  });

  context("selectedModelVariants", () => {
    it("authoritative metadata から variant リストを返すこと", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelVariants).toEqual([
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ]);
    });

    it("allProvidersData が null の場合、接続プロバイダのデータにフォールバックすること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setProviders([openaiProvider]));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelVariants).toEqual([
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ]);
    });

    it("variant を持たないモデルでは空配列を返すこと", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "deepseek", modelID: "deepseek-reasoner" }));
      expect(result.current.selectedModelVariants).toEqual([]);
    });

    it("モデル未選択の場合は空配列を返すこと", () => {
      const { result } = renderHook(() => useProviders());
      expect(result.current.selectedModelVariants).toEqual([]);
    });

    it("variant が disabled になるとリストから除外されること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelVariants).toHaveLength(3);

      const refreshed: AllProvidersData = {
        ...allProvidersDataFixture,
        all: allProvidersDataFixture.all.map((p) =>
          p.id === "openai"
            ? {
                ...p,
                models: {
                  ...p.models,
                  "gpt-5.4": {
                    ...gpt54,
                    variants: {
                      low: { label: "Low", disabled: true },
                      medium: { label: "Medium" },
                      high: { label: "High" },
                    },
                  },
                },
              }
            : p,
        ),
      };
      act(() => result.current.setAllProvidersData(refreshed));
      expect(result.current.selectedModelVariants).toEqual([
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ]);
    });

    it("variant が完全に削除されるとリストから消えること", () => {
      const { result } = renderHook(() => useProviders());
      act(() => result.current.setAllProvidersData(allProvidersDataFixture));
      act(() => result.current.setSelectedModel({ providerID: "openai", modelID: "gpt-5.4" }));
      expect(result.current.selectedModelVariants).toHaveLength(3);

      const refreshed: AllProvidersData = {
        ...allProvidersDataFixture,
        all: allProvidersDataFixture.all.map((p) =>
          p.id === "openai"
            ? {
                ...p,
                models: {
                  ...p.models,
                  "gpt-5.4": {
                    ...gpt54,
                    variants: {
                      low: { label: "Low" },
                      medium: { label: "Medium" },
                    },
                  },
                },
              }
            : p,
        ),
      };
      act(() => result.current.setAllProvidersData(refreshed));
      expect(result.current.selectedModelVariants).toEqual([
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
      ]);
    });
  });
});
