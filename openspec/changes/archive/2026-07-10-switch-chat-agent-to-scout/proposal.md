## Why

OpenCode Chat currently presents the chat companion as the built-in `plan` primary agent plus an appended chat persona. The built-in Plan prompt includes planning/coding workflow instructions that can conflict with the intended lightweight research/chat companion role.

Switching the chat companion canvas to the built-in `scout` agent gives the custom chat system prompt a cleaner base while preserving the existing build-agent escape hatch.

## What Changes

- Default chat primary-agent initialization changes from eligible `plan` to eligible `scout`.
- The primary-agent selector displays `scout` as `chat` and continues to expose `build` for full implementation mode.
- The chat companion system prompt is appended when the selected primary agent is `scout`, not `plan`.
- `CHAT_SYSTEM.md` wording no longer describes the companion as operating in "plan mode".
- Initialization tests are updated to assert the Scout-first behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `primary-agent-selection`: default chat agent selection, display naming, send payload behavior, and chat system prompt injection move from `plan` to `scout`.

## Scope

In scope: VS Code webview primary-agent selection, primary-agent selector labels/descriptions, extension-host chat system prompt injection gate, chat companion prompt wording, and focused tests.

Out of scope: changing OpenCode's built-in agent definitions, changing model/provider selection, changing build-agent behavior, changing subagent mention behavior, or introducing new protocol fields.

## Non-Goals

- Do not remove the `build` option from the chat UI.
- Do not add a user-facing setting for arbitrary chat-agent selection in this change.
- Do not alter OpenCode base system prompt assembly.

## Risks

- If a user's OpenCode installation lacks a primary/all `scout` agent, fallback will select the first eligible primary/all agent. This preserves existing fallback semantics but may not yield the intended chat canvas.
- Existing tests and comments that assume `plan` is the chat agent must be updated coherently to avoid stale documentation.

## Fallback

Rollback is a small code revert from `scout` back to `plan` in the selector allowlist, default selection, prompt injection gate, prompt wording, and tests.

## Compatibility Impact

No protocol shape changes are required. The existing `primaryAgent` send payload remains unchanged except for the selected value changing from `"plan"` to `"scout"` when Scout is available.