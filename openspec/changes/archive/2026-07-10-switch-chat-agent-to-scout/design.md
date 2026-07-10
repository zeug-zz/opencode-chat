## Context

OpenCode Chat currently aliases the built-in `plan` primary agent as the user-facing `chat` mode. The extension host appends `CHAT_SYSTEM.md` only for `primaryAgent === "plan"`. The webview defaults to `plan` on first agent-list receipt, and the agent selector only exposes `plan` and `build`.

The desired behavior is to use built-in `scout` as the chat companion canvas because Scout has minimal agent-specific instructions compared with Plan. The OpenCode agent list confirms `scout (all)`, so the existing primary/all eligibility filter already supports it.

## Goals / Non-Goals

**Goals:**

- Make `scout` the preferred default chat primary agent when eligible.
- Display `scout` as user-facing `chat` in the selector.
- Append `CHAT_SYSTEM.md` for Scout-based chat messages.
- Preserve `build` mode and all existing send payload structure.
- Keep fallback behavior unchanged when Scout is unavailable.

**Non-Goals:**

- Redefine Scout or Plan in OpenCode configuration.
- Broaden the selector to all primary agents.
- Change subagent mention behavior.
- Change model selection, effort selection, session state, or protocol schema.

## Decisions

1. Replace the hardcoded chat identity from `plan` to `scout` in the existing selection path.

   Rationale: This is the smallest compatible change. The existing `isPrimaryOrAll` helper already treats `mode: "all"` as eligible, and Scout is reported as `mode: "all"`.

   Alternative considered: Add both `plan` and `scout` to the selector. Rejected for this change because the user-facing model is a two-mode switch, `chat` and `build`, not a general primary-agent browser.

2. Keep the user-facing label as `chat`.

   Rationale: The feature is a chat companion mode; exposing the implementation agent name would make the UI less stable and less clear.

   Alternative considered: Display `scout`. Rejected because it leaks the implementation detail and changes UX more than required.

3. Move the system prompt injection gate to `primaryAgent === "scout"`.

   Rationale: The chat persona should be appended to the selected chat canvas. Keeping the gate on Plan would silently drop the persona after defaulting to Scout.

4. Preserve fallback-to-first-primary behavior when Scout is absent.

   Rationale: This preserves compatibility with OpenCode installations or test fixtures where Scout is unavailable.

## Risks / Trade-offs

- Scout unavailable in some environments → fallback behavior remains unchanged; tests should cover fallback.
- Stale references to Plan in tests or prompt text → update focused assertions and wording.
- Broader primary-agent selector expectations → intentionally unchanged; only `chat` and `build` remain exposed.

## Migration Plan

1. Update webview default and selector mapping from Plan to Scout.
2. Update extension-host chat system prompt injection gate.
3. Update prompt wording and tests.
4. Run focused initialization tests, extension host prompt-injection tests if present, OpenSpec validation, and project checks as needed.

Rollback: revert the same focused replacements from `scout` to `plan`.