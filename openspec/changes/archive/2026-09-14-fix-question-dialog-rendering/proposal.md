## Why

When an OpenCode `question.asked` event arrives for an existing assistant
message, the webview updates its question state but the memoized
`MessageItem` ignores that prop in its comparison. The question therefore does
not appear until an unrelated message update, such as interrupting the active
turn, causes the item to render again. The message area also only observes
message changes for auto-scroll, so a newly revealed question can remain below
the viewport.

## What Changes

- Make question state part of the `MessageItem` render invalidation boundary,
  preferably using only the question data relevant to that message.
- Render an active question immediately after its `question.asked` event,
  without requiring a new message event or an interrupt.
- Include newly rendered question content in bottom-aware auto-scroll behavior
  while preserving the user's position when they have intentionally scrolled
  away from the bottom.
- Add a webview regression scenario that delivers a question for an existing
  assistant message and verifies the question UI appears before any unrelated
  message update.
- Preserve existing session filtering, answer/reject bridge messages, question
  placement, and memoization for unrelated message updates.

## Capabilities

### New Capabilities

- `question-dialog-rendering`: Defines immediate rendering and visibility of
  interactive question requests in the message stream.

### Modified Capabilities

None.

## Impact

- `packages/platforms/vscode/webview/components/organisms/MessageItem/MessageItem.tsx`:
  include question state in memoized rendering decisions.
- `packages/platforms/vscode/webview/components/organisms/MessagesArea/MessagesArea.tsx`:
  pass question changes into visibility/scroll behavior as needed.
- `packages/platforms/vscode/webview/hooks/useAutoScroll.ts`:
  support content changes that do not alter the message array.
- `packages/platforms/vscode/webview/__tests__/`:
  add coverage for event-to-render and scroll behavior.
- No core protocol, host routing, SDK, persistence, or external API changes are
  expected.

## Scope and Non-goals

- In scope: rendering and visibility of already-received question requests in
  the active message stream.
- Out of scope: changing the OpenCode question protocol, changing question
  answer semantics, introducing a modal redesign, changing session filtering,
  or altering the streaming spinner lifecycle.

## Risks, Fallback, and Compatibility

The primary risk is causing unnecessary rerenders or unexpectedly moving a
user's scroll position. The implementation should compare only the relevant
question state and reuse the existing near-bottom guard; if question metadata
cannot be associated with a message, existing behavior should remain safe and
the request should not be rendered against another message. If no question is
pending, the current message rendering and auto-scroll behavior remain
unchanged.

This is a corrective webview behavior change with no protocol or persisted-state
migration. Existing answer/reject messages, session filtering, Chat/Write
boundaries, and independent TUI behavior remain compatible.
