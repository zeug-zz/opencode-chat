## Context

The GUI already supports model variants as explicit effort overrides. `useProviders` restores a valid variant from `modelEffortByModel`, validates it when provider metadata changes, and clears stale persisted values. `InputArea` independently resolves the selected model and handles `Ctrl+T`; `ModelSelector` only displays the selected effort beside the model name. This leaves the feature discoverable only through a shortcut and duplicates selected-model metadata lookup.

OpenCode's hosted app presents a dedicated variant control only for models with advertised variants. Its menu offers a default choice plus the available variants. The VS Code GUI must retain its existing local persistence and default semantics rather than copy the hosted app's storage implementation.

## Goals / Non-Goals

**Goals:**
- Add a discoverable, mouse-accessible effort menu for models with valid metadata variants.
- Keep effort sticky per model through the existing persisted UI state.
- Preserve `Ctrl+T` cycle-to-default behavior and current send/edit payload semantics.
- Make one resolved variant list the source of truth for effort rendering and cycling.
- Keep the control accessible, localized, and focused on the message input after a choice.

**Non-Goals:**
- Do not add or alter OpenCode configuration, agent configuration, protocol messages, or server APIs.
- Do not infer variants from provider or model names.
- Do not change shell execution behavior.
- Do not reproduce the hosted app's hover-only visibility; the supported-model control remains visible for discoverability.

## Decisions

### Decision 1: Add a dedicated `ModelEffortSelector` next to the model selector

Create a focused webview component that renders only when the selected model exposes at least one normalized, enabled variant. Its trigger shows the current explicit variant label or localized `Default`; its popover presents `Default` and every server-advertised variant in metadata order as mutually exclusive choices.

Selecting a variant calls the existing `setSelectedModelEffort`. Selecting `Default` calls it with `undefined`, which removes the per-model persisted key and preserves the server/config default by omitting `variant` on the next chat or edit/resend request. The component closes its popover and restores focus to the message textarea.

Alternatives considered:
- Extend the model selector panel: rejected because effort is a separate property and would make choosing a model and variant one coupled interaction.
- Use an icon-only control: rejected because the current value and default state would be hidden from keyboard and mouse users.
- Hide the default control until toolbar hover: rejected because this makes the new feature less discoverable in the compact VS Code sidebar.

### Decision 2: Centralize selected-model variant derivation in `useProviders`

`useProviders` will resolve `ModelInfo` once from authoritative all-provider metadata with the existing connected-provider fallback, derive normalized variants with `getModelVariants`, and expose that selected-model variant list to the input toolbar. The effort menu and `Ctrl+T` will consume this same list.

The existing revalidation effect remains responsible for restoring valid persisted selections and removing stale ones. The input component must no longer duplicate provider/model lookup or compute variants from raw provider data.

### Decision 3: Make the dedicated control the only visible effort value

Remove the model-label suffix (`Model · Low`) from `ModelSelector`. The dedicated effort trigger is the canonical visible location for the current effort, avoids duplicate labels, and keeps the model selector focused on model selection.

### Decision 4: Preserve the existing keyboard and wire contracts

`Ctrl+T` remains active only for supported models and retains `unset/default → first variant → … → last variant → unset/default`. It must prevent the browser default only when a cycle occurs. Chat and edit/resend continue to include effort only when an explicit selection exists; shell requests continue to omit effort.

## Risks / Trade-offs

- [Menu and shortcut diverge] → Both consume `selectedModelVariants` and the same state setter; focused tests cover direct selection and shortcut cycling.
- [Stale provider metadata] → Existing validation and persisted-entry cleanup remain the authority; an empty normalized list hides the control and disables cycling.
- [Popover accessibility/focus regressions] → Use a labelled button and radio semantics, close after selection, restore textarea focus, and test keyboard shortcut compatibility.
- [Toolbar crowding] → Render only for supported models and use a compact value trigger.

## Migration Plan

1. Add the presentation component and expose the already-normalized selected variant list from provider state.
2. Replace the model-label effort suffix with the dedicated control while retaining the same persisted state and setter.
3. Verify no override is sent for `Default`, unsupported models, or shell execution.
4. Roll back by removing the new component and its prop; persisted `modelEffortByModel` data remains backward-compatible with the existing shortcut-based UI.

## Open Questions

- None.