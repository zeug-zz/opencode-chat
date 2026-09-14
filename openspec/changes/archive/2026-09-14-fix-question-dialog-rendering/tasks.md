## 1. Question Render Invalidation

- [x] 1.1 Update `MessageItem` question inputs and its memo comparison so an associated question being added, changed, or removed invalidates the affected message while unrelated message updates retain the existing memoization boundary; verify with a focused `MessageItem` regression test.
- [x] 1.2 Update `MessagesArea` question projection/wiring as needed so each question remains associated with its original assistant message and active-session filtering is unchanged; verify existing message rendering and question association tests pass.

## 2. Question Visibility And Scrolling

- [x] 2.1 Extend `useAutoScroll` with an explicit stable content-change signal in addition to the message list, preserving the near-bottom and text-selection guards; verify hook tests cover question-content changes, near-bottom scrolling, and intentional scroll-up preservation.
- [x] 2.2 Wire question changes from `MessagesArea` into the content-change signal so a newly rendered question is visible to a near-bottom user without forcing a scrolled-up user to the bottom; verify the message-area scroll tests pass.

## 3. End-To-End Regression Coverage

- [x] 3.1 Add a webview scenario that renders an existing busy assistant message, delivers a matching `question.asked` event without changing the message list, and asserts the question UI appears before any interrupt or unrelated message update; verify the streaming indicator may remain while the question is answerable.
- [x] 3.2 Extend the scenario coverage to answer and reject the newly rendered request and confirm the existing typed bridge messages retain the original request identifier and answer shape; verify the question is removed after the corresponding event.

## 4. Validation

- [x] 4.1 Run the focused webview tests for `MessageItem`, `MessagesArea`, `useAutoScroll`, and the new question-rendering scenario; verify all assertions pass.
- [x] 4.2 Run `openspec validate --change "fix-question-dialog-rendering" --strict`, `pnpm run check`, `pnpm run build`, and `git diff --check`; verify the change validates, lint/format checks, builds, and has no whitespace errors.
