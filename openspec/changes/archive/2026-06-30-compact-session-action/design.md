## Context

The webview already has a `compressSession` UI-to-host protocol message and the extension host handles it by calling `agent.summarizeSession(sessionId, model)`, which maps to opencode SDK `client.session.summarize`. The missing integration is a webview caller.

A previous local patch added `compaction` to `AgentSelector` as a selectable primary agent and displayed it as `compact`. That behavior is misleading: sending a prompt with `primaryAgent: "compaction"` starts the compaction agent as a chat participant rather than compacting the active session.

## Goals / Non-Goals

**Goals:**
- Provide a GUI `compact` action from the existing Agents menu.
- Keep menu order as `chat`, `build`, `compact`.
- Keep `chat` and `build` as the only selectable primary agents.
- Invoke real session compaction through `compressSession` for the active session and selected model.
- Preserve existing selected primary-agent state when `compact` is clicked.

**Non-Goals:**
- Do not implement `/compact` slash-command parsing in chat text.
- Do not add a new extension command palette command in this change.
- Do not change opencode SDK usage or host protocol shape unless tests reveal the existing path is unusable.
- Do not change subagent mention behavior or `AgentPopup`.

## Decisions

### Decision 1: Model `compact` as an action row, not a selectable primary agent

`AgentSelector` should render selectable primary agents from an ordered allowlist containing `plan` and `build` only. It should render `compact` as a separate action row after those entries when an `onCompact` callback is provided.

Alternative considered: keep `compaction` in the selectable allowlist. Rejected because that uses `primaryAgent: "compaction"` in normal chat sends and does not invoke session compaction.

### Decision 2: Reuse existing `compressSession` protocol

`App.tsx` should add a handler that posts `{ type: "compressSession", sessionId, model }` using the active session ID and selected model, then pass it to `InputArea`, which passes it to `AgentSelector`.

Alternative considered: add a new host command or protocol message. Rejected because `compressSession` and host handling already exist and are tested.

### Decision 3: Preserve current selection and menu label

Clicking `compact` must close the menu and trigger the action, but must not call `onSelect("compaction")` and must not change `selectedPrimaryAgent`. The selector label remains the currently selected primary agent (`chat` or `build`).

Alternative considered: temporarily showing `compact` as the label. Rejected because it suggests a persistent primary-agent mode.

### Decision 4: Re-fetch session and messages after compaction completes

The extension host handler for `compressSession` must follow the same pattern as `revertToMessage`: after `summarizeSession` resolves, re-fetch the active session (for updated token counts) and messages (for the compaction summary message), then post both back to the webview via `activeSession` and `messages`. Without this feedback loop the webview has no way to observe compaction effects — the context memory display stays stale, and the user sees no visual confirmation.

Alternative considered: relying on SDK-emitted events to propagate state changes. Rejected because (a) `summarizeSession` returns `Promise<void>` with no guarantee of event emission, and (b) the webview's context memory display depends on `session.activeSession.tokens` which is set from `activeSession`/`session.updated` host messages, not raw agent events.

## Risks / Trade-offs

- Existing host compaction has no explicit success/failure feedback in the webview → Accept for this change; future UX can add toast/progress once a notification pattern exists.
- The action row shares the Agents menu, so visual distinction is limited → Mitigate with description text and one-shot behavior.
- Current uncommitted selector changes include `compaction` in the primary-agent allowlist → Builder must remove that behavior while retaining tests for the new action semantics.

## Migration Plan

1. Update webview callback plumbing from `App` to `InputArea` to `AgentSelector`.
2. Convert `compact` from selectable primary agent to action row.
3. Update focused tests to assert real `compressSession` behavior and preserved primary selection.
4. Update extension host `compressSession` handler to re-fetch session + messages and post them back to the webview.
5. Run focused tests and repository checks.

Rollback path: remove the compact action callback/row and retain the prior two-agent selector (`chat`, `build`).

## Open Questions

- **SDK behavior**: Does opencode SDK `summarizeSession` actually truncate/replace context, or does it only append a summary message? If it only appends, the context token count will never decrease and the "stuck at N%" symptom will persist regardless of GUI fixes. This needs investigation as a potential SDK-side task.
