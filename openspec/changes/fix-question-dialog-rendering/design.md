## Context

See `proposal.md` for the user-visible motivation. The existing flow already
delivers `question.asked` through the typed agent event path and stores pending
requests in `useQuestions`. `MessageItem` derives the requests associated with
its message and renders `QuestionView`, but its `memo` comparator does not
consider the `questions` input. `useAutoScroll` similarly reacts to the
`messages` array only, even though question content is appended inside an
existing message.

## Goals / Non-Goals

**Goals:**

- Make a question request render as soon as its state enters the webview.
- Keep the render invalidation scoped to question data relevant to the message
  where practical.
- Make the existing near-bottom scroll policy apply to question content.
- Prove the behavior through a realistic event-to-render webview test.

**Non-Goals:**

- Changing the core question event or host protocol.
- Moving questions into a new modal or changing their visual design.
- Changing session filtering, answer serialization, or the streaming status
  lifecycle.
- Adding persistence or changing the OpenCode SDK adapter.

## Decisions

### 1. Include question state in the message render boundary

The message component will receive a question-derived render input and the
memo comparison will account for it. A question request appearing, changing,
or disappearing must be sufficient to rerender the affected message; no
unrelated message or session event should be required.

The preferred shape is a per-message question collection or stable signature
derived from the existing `questions` map. Comparing the entire map reference
is acceptable only if it preserves correctness and does not create a material
regression, but it may rerender messages that have no question. The
implementation must not mutate the existing map in place, because the hook's
state updates rely on replacement semantics.

**Alternative considered:** remove `memo` from `MessageItem`. Rejected because
it fixes the symptom by discarding an existing streaming-render performance
boundary instead of making the boundary complete.

### 2. Extend auto-scroll with an explicit content-change signal

`MessagesArea` will provide question-content changes to the auto-scroll logic
as a separate dependency from the message list. The existing near-bottom and
text-selection guards remain authoritative: newly added question content
scrolls into view only when the user is already following the bottom, while an
intentional scroll-up is preserved.

The implementation should avoid using a freshly allocated aggregate array as a
dependency on every render. An explicit secondary dependency or a stable
question revision is preferred so ordinary renders do not cause repeated
scroll attempts.

**Alternative considered:** call `scrollToBottom` directly from
`useQuestions`. Rejected because question state does not own the scroll
container, and it would bypass the message area's existing user-position and
selection safeguards.

### 3. Test the observable event-to-render path

Add a webview regression test that starts with an existing assistant message,
dispatches a matching `question.asked` event through the same event path used
by `App`, and asserts that `QuestionView` is rendered before any message
update or interrupt. Add coverage for question removal and the near-bottom
versus scrolled-up scroll policy where the existing test harness can observe
the container position.

The existing hook and standalone `QuestionView` tests remain useful, but they
do not exercise the memoized parent boundary and therefore cannot be the sole
regression coverage.

## Risks / Trade-offs

- **Question updates rerender too many messages** -> Compare per-message
  question state or a stable per-message signature rather than blindly
  invalidating every message when feasible.
- **A question shifts content below the viewport** -> Reuse the existing
  near-bottom, text-selection, and explicit scroll guards.
- **A question is removed while the session is busy** -> Keep question removal
  driven by the existing replied/rejected events and avoid changing session
  busy handling.
- **The test observes implementation details instead of user behavior** ->
  Assert rendered question text and bridge behavior through the webview test
  harness, using internal helpers only to set up the event.

## Migration Plan

No persisted data, protocol, SDK, or configuration migration is required. The
fix takes effect on the next webview build. To roll back, restore the prior
message memo comparison and message-only auto-scroll dependency; no user data
or provider state cleanup is needed.
