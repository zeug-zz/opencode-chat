# Proposal: Polish thinking display and review toggle

## Scope

Improve the reading and quick control of reasoning in the chat UI through one capability, `chat-reasoning-ui`, with two related improvements:

- Render model thinking in `ReasoningPartView` as sanitized Markdown through the existing `TextPartView` rendering pipeline, while preserving streaming, expansion, show-all behavior, and compact muted styling.
- Add a compact brain-outline toggle in the input area's right context-bar slot. It updates the existing `userEnabled` preference using the existing callback and follows host preference, runtime availability, and workspace opt-out state.

Together these improvements make thinking readable and make the existing reasoning-review preference quickly accessible.

## Non-goals

- Change Scribe-generated `ReasoningAssistRow` statuses: they remain plain localized text. Do not infer provenance from text or modify stored content.
- Add a preference, protocol, abstraction, backend, runtime, or security behavior.
- Change `workspaceOptOut`; add dependencies, VSIX packaging, or live-runtime qualification. VSIX packaging is explicitly excluded; it is handled by a concurrent user session.

## Compatibility

No preference or protocol migration is introduced. Existing rendering and preference plumbing remain authoritative.
