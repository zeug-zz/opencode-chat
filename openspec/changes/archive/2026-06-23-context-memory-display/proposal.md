## Why

OpenCode TUI reports contextual memory usage (e.g. `134.6K (28%)`) in its input area. The opencode-chat GUI has no equivalent, missing a key signal about how full the context window is. The initial approach relied solely on `session.next.context.updated` SSE events, but testing revealed the opencode server does not emit this event during normal chat sessions. The `session.next.step.ended` event IS emitted on every LLM response and carries `tokens.input` (total prompt tokens for the step, representing the full context window usage), providing a reliable fallback data source.

## What Changes

- Add `session.next.context.updated` to the `AgentEvent` union in `domain.ts` so the event flows through the existing SSE pipeline (primary source, if the server ever emits it).
- Add `session.next.step.ended` to the `AgentEvent` union as a fallback source (always emitted on LLM response completion).
- Handle both events in `App.tsx`, filtered by active session id. The `context.updated` handler renders the server-provided text as-is; the `step.ended` handler computes `tokens.input + tokens.cache.read`, resolves the selected model's context limit from provider metadata, and formats a display string like `"134.6K (28%)"`.
- Thread a `contextMemoryText` prop through to `InputArea`.
- Render the text as-is in a muted monospace chip in the `actionsLeft` bar, right after the "Open session in terminal" button.
- Add an i18n tooltip key to all eight locale files.

## Scope

- In scope: `domain.ts` (two event variants added to `AgentEvent`), `App.tsx` (state + two event handlers + model-limit lookup + format helper + prop), `InputArea.tsx` (prop + render), `InputArea.module.css` (chip style), and the eight locale files.
- In scope: the chip clears when the active session changes or the webview remounts (ephemeral state, no persistence).
- Out of scope: persisting across webview remounts, or adding new postMessage protocol types.

## Non-Goals

- Do not compute context window usage by summing individual message token counts (the `step.ended` total is more accurate as it includes system prompts and tool overhead).
- Do not persist the value across sessions or webview restarts.
- Do not add new postMessage types or protocol changes — both events flow through the existing `event` channel.
- Do not modify mappers, agent, or extension host code.

## Risks

- The `text` field format may vary across opencode server versions. Mitigation: render as-is — the server is the authority on formatting.
- The `step.ended` fallback computes context usage from `tokens.input + tokens.cache.read`, which may slightly differ from the server's own context calculation (the server may include additional overhead). Mitigation: this is an approximation; if `context.updated` events are emitted in future server versions, they take priority.
- The `step.ended` event fires on every LLM response, which may update the chip frequently during multi-step tool-use sequences. Mitigation: React batching handles state updates; the chip is a single text span with no expensive side effects.
- Adding `prov.selectedModel` and `prov.providers` to `handleEvent` deps causes the message listener `useEffect` to re-register when the model changes. Mitigation: this is acceptable — the effect already re-registers for other deps, and the re-registration is a lightweight addEventListener/removeEventListener.

## Fallback

If the chip causes layout issues or the event format changes unexpectedly, revert: remove the `AgentEvent` variants, the `App.tsx` state + handlers + prop, the `InputArea` prop + render, the CSS rule, and the locale key. Existing InputArea layout is unchanged because the chip is conditionally rendered only when `contextMemoryText` is non-empty.

## Compatibility Impact

- Existing `AgentEvent` consumers are compatible — both new variants are additive and handled in new branches.
- No protocol changes — `HostToUIMessage` and `UIToHostMessage` are unchanged.
- No persisted state changes.

## Impact

- Affected code: `packages/core/src/domain.ts`, `packages/platforms/vscode/webview/App.tsx`, `packages/platforms/vscode/webview/components/organisms/InputArea/InputArea.tsx`, `packages/platforms/vscode/webview/components/organisms/InputArea/InputArea.module.css`, and the eight locale files under `packages/platforms/vscode/webview/locales/`.
- Affected tests: scenario test under `__tests__/scenarios/`, component test under `__tests__/components/organisms/InputArea.test.tsx`.
