import type { ModelInfo, ModelVariantRef, ProviderInfo } from "@opencode-chat/core";
import { validateModelVariant } from "@opencode-chat/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AllProvidersData } from "../vscode-api";
import { getPersistedState, postMessage, setPersistedState } from "../vscode-api";

type SelectedModel = { providerID: string; modelID: string };

/**
 * Webview provider/model state.
 *
 * Tracks the currently selected model plus an optional explicit
 * model effort/variant for that model. The effort state is
 * intentionally additive: when unset, the GUI sends no effort
 * override and opencode applies its own default behavior. When
 * set, the value is normalized from `ModelInfo.variants` so it
 * always reflects what the model actually advertises.
 *
 * The hook centralizes effort invalidation rules for the
 * `model-effort-control` capability:
 *
 * - When the selected model changes, prior effort that the new
 *   model does not advertise is cleared.
 * - When provider metadata for the selected model changes (a
 *   variant id disappears or becomes `disabled: true`), the same
 *   invalidation runs.
 * - The exposed `setSelectedModelEffort` validates the requested
 *   effort against the current model metadata before storing, so
 *   callers always observe a normalized value or `undefined`.
 *
 * Existing provider/model-only behavior is preserved: callers that
 * never touch `selectedModelEffort` see no effort in any downstream
 * payload (this change does not yet wire effort into protocol
 * messages; that is task 3.1+).
 */
export function useProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [allProvidersData, setAllProvidersData] = useState<AllProvidersData | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [selectedModelEffort, setSelectedModelEffortRaw] = useState<ModelVariantRef | undefined>(undefined);
  const prevModelKeyRef = useRef<string | null>(null);

  // Centralized revalidation: when the selected model or provider
  // metadata changes, validate the existing effort against the new
  // metadata. Keep if supported; clear if not. This single effect
  // covers both model-change and metadata-refresh invalidation.
  // - "Validate effort when the selected model changes" requirement.
  // - Restore persisted effort when metadata becomes available
  //   (Decision 2 in design.md: validate before restore).
  useEffect(() => {
    const info = findModelInfo(selectedModel, allProvidersData, providers);

    // Detect model change so the current in-memory effort (which
    // belongs to the previous model) does not take precedence over
    // the new model's persisted effort (task 2.3 round-trip).
    const newModelKey = selectedModel
      ? `${selectedModel.providerID}/${selectedModel.modelID}`
      : null;
    const modelChanged = newModelKey !== prevModelKeyRef.current;
    prevModelKeyRef.current = newModelKey;

    // Stale persisted entry cleanup (Decision 2 pt.5): if a stored
    // effort for the current model is no longer advertised, remove it
    // so it does not linger indefinitely in persisted state.
    if (selectedModel && info) {
      const key = `${selectedModel.providerID}/${selectedModel.modelID}`;
      const persistedId = getPersistedState()?.modelEffortByModel?.[key];
      if (persistedId) {
        const restored = validateModelVariant(info, { id: persistedId });
        if (!restored) {
          const state = { ...getPersistedState() };
          if (state.modelEffortByModel) {
            const { [key]: _discard, ...otherEntries } = state.modelEffortByModel;
            if (Object.keys(otherEntries).length > 0) {
              setPersistedState({ ...state, modelEffortByModel: otherEntries });
            } else {
              const { modelEffortByModel: _omit, ...remaining } = state;
              setPersistedState(remaining);
            }
          }
        }
      }
    }

    setSelectedModelEffortRaw((prev) => {
      if (modelChanged) {
        // Model changed: restore the new model's persisted effort
        // first. Fall back to the in-memory effort from the
        // previous model only if it happens to be valid for the
        // new model (e.g. both models share the same variant id).
        if (selectedModel && info) {
          const key = `${selectedModel.providerID}/${selectedModel.modelID}`;
          const persistedId = getPersistedState()?.modelEffortByModel?.[key];
          if (persistedId) {
            const restored = validateModelVariant(info, { id: persistedId });
            if (restored) return restored;
          }
        }
        // 3. No valid persisted effort — fall back to in-memory
        //    effort if it works for the new model.
        if (prev) {
          const validated = validateModelVariant(info, prev);
          if (validated) return validated;
        }
      } else {
        // Same model (metadata refresh): in-memory takes precedence
        // over persisted state.
        if (prev) {
          const validated = validateModelVariant(info, prev);
          if (validated) return validated;
        }
        if (selectedModel && info) {
          const key = `${selectedModel.providerID}/${selectedModel.modelID}`;
          const persistedId = getPersistedState()?.modelEffortByModel?.[key];
          if (persistedId) {
            const restored = validateModelVariant(info, { id: persistedId });
            if (restored) return restored;
          }
        }
      }
      // 4. No valid effort from any source — leave unset/default.
      return undefined;
    });
  }, [selectedModel, allProvidersData, providers]);

  const handleModelSelect = useCallback((model: SelectedModel) => {
    setSelectedModel(model);
    postMessage({ type: "setModel", model: `${model.providerID}/${model.modelID}` });
  }, []);

  // Public setter for explicit effort selection. Validates against
  // the currently selected model so the stored state is always
  // normalized (id + label from the model's metadata). Pass
  // `undefined` / `null` to clear the selection.
  // - "Preserve default effort until explicitly selected" requirement.
  const setSelectedModelEffort = useCallback(
    (effort: ModelVariantRef | null | undefined) => {
      if (!effort) {
        setSelectedModelEffortRaw(undefined);
        // Remove the current model key from persisted state (Decision 3).
        if (selectedModel) {
          const key = `${selectedModel.providerID}/${selectedModel.modelID}`;
          const state = getPersistedState() ?? {};
          if (state.modelEffortByModel) {
            const { [key]: _removed, ...otherEntries } = state.modelEffortByModel;
            if (Object.keys(otherEntries).length > 0) {
              setPersistedState({ ...state, modelEffortByModel: otherEntries });
            } else {
              const { modelEffortByModel: _omit, ...remainingState } = state;
              setPersistedState(remainingState);
            }
          }
        }
        return;
      }
      const info = findModelInfo(selectedModel, allProvidersData, providers);
      const normalized = validateModelVariant(info, effort);
      if (normalized && selectedModel) {
        // Write valid effort id into persisted state (Decision 3).
        const key = `${selectedModel.providerID}/${selectedModel.modelID}`;
        const state = getPersistedState() ?? {};
        setPersistedState({
          ...state,
          modelEffortByModel: {
            ...(state.modelEffortByModel ?? {}),
            [key]: normalized.id,
          },
        });
      }
      setSelectedModelEffortRaw(normalized);
    },
    [selectedModel, allProvidersData, providers],
  );

  return {
    providers,
    setProviders,
    allProvidersData,
    setAllProvidersData,
    selectedModel,
    setSelectedModel,
    selectedModelEffort,
    setSelectedModelEffort,
    handleModelSelect,
  } as const;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Resolve the full `ModelInfo` for a `{ providerID, modelID }` pair
 * from the most authoritative available source.
 *
 * - Prefers `allProvidersData.all` (which carries the `variants` map
 *   and is the source of truth for effort choices).
 * - Falls back to `providers` (the connected-only list) when the
 *   all-providers payload is missing or doesn't contain the target.
 *
 * Returns `null` when the model cannot be resolved from either
 * source. Callers must treat that as "no metadata available" and
 * clear any prior effort rather than guess from the id.
 */
function findModelInfo(
  target: SelectedModel | null,
  allProvidersData: AllProvidersData | null,
  providers: ProviderInfo[],
): ModelInfo | null {
  if (!target) return null;
  const lookup = (list: ProviderInfo[] | null | undefined): ModelInfo | null => {
    if (!list) return null;
    for (const provider of list) {
      if (provider.id !== target.providerID) continue;
      const model = provider.models?.[target.modelID];
      if (model) return model;
    }
    return null;
  };
  return lookup(allProvidersData?.all) ?? lookup(providers);
}
