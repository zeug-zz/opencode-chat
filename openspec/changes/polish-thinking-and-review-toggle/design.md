# Design: Polish thinking display and review toggle

## Approach

For model reasoning parts, reuse the existing sanitized Markdown renderer in `TextPartView`, adapting the part locally if its type differs. Keep the current reasoning component's streaming updates, expand/collapse and show-all state, and muted compact presentation. Leave `ReasoningAssistRow` statuses as plain localized text.

Place a compact brain-outline toggle in the input area's `contextBar` right slot. Reuse the existing callback that updates `userEnabled`; reflect authoritative host updates in both the toggle and settings checkbox. Show it only when the runtime is available, disable it until the host preference is loaded and while workspace opt-out is active, and explain opt-out in its localized tooltip. Provide localized on/off tooltip text and `aria-pressed`. The toggle never changes `workspaceOptOut`.

No new protocol, preference, abstraction, or backend work is needed.

## Alternative considered

Introducing a separate Markdown renderer or new preference/protocol would duplicate existing behavior and plumbing; it is unnecessary for these UI changes.
