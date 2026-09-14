## Context

See `proposal.md` for the user-visible motivation. The existing webview keeps
the context-memory value in `App.tsx`, where it receives OpenCode events and
loaded message snapshots. The current implementation accumulates
`step-finish` input values in a per-session ref. That treats each model request's
full prompt as a new amount of context, even though successive tool-use steps
repeat much of the same conversation.

The domain already exposes the relevant event and token shapes. The OpenCode
adapter passes session, message, part, and context events through without a
separate context API. `ChatSession.tokens` is retained by the SDK as
session-level usage and is not a reliable current-window snapshot; upstream has
also documented the distinction between cumulative web totals and the TUI's
latest-assistant context value.

## Goals / Non-Goals

**Goals:**

- Make the chip represent the latest valid context snapshot for the active
  session.
- Keep server-provided context text as the preferred source when available.
- Use the latest assistant or step token data as replacement snapshots, never as
  cumulative additions.
- Preserve active-session filtering, zero-value handling, and compaction reset
  behavior.
- Keep the existing provider-neutral event and host protocol boundaries.

**Non-Goals:**

- Changing OpenCode's server-side token or cost accounting.
- Reproducing the TUI's separate session-cost or lifetime-usage totals.
- Changing the chip's placement, styling, locale text, or model-limit lookup.
- Adding a REST endpoint, host message, SDK dependency, or persisted UI state.

## Decisions

### 1. Treat context usage as a replacement snapshot

The context meter will hold one latest snapshot per active session. A valid
assistant message snapshot or `session.next.step.ended` snapshot replaces the
previous value. The implementation will remove the numeric accumulator and will
not sum `step-finish` parts, assistant messages, or event deliveries.

This matches the semantics of a context window: each model request reports the
prompt sent for that request, not a delta to add to the previous request. It also
makes duplicate event delivery harmless because assigning the same snapshot
twice produces the same display.

**Alternative considered:** continue accumulating and reset only at compaction.
Rejected because multi-step tool calls can contain several full prompt
snapshots before compaction, and the displayed value becomes wrong immediately.

### 2. Prefer current prompt sources over session totals

The source order for a current update is:

1. Non-zero `session.next.context.updated` text, displayed as supplied by the
   server.
2. The latest assistant message token snapshot from `message.updated` or loaded
   message state.
3. The latest `session.next.step.ended` token snapshot.

The token calculation remains the project-defined prompt-context metric:
`input + cache.read`, computed once for the selected snapshot. Output,
reasoning, and cache-write values are not added to the context occupancy value;
they belong to response or billing accounting rather than the prompt currently
occupying the window.

`session.updated.info.tokens` and `session.activeSession.tokens` remain usable
for ordinary session state and aggregate usage, but they are excluded from this
meter because they can be cumulative over the session lifetime.

**Alternative considered:** copy the TUI's complete token total, including
output, reasoning, and cache-write fields. Rejected for this chip because the
existing capability contract defines prompt-context occupancy, and exact TUI
parity would conflate current prompt size with response/cost accounting.

### 3. Use event updates and loaded state as equivalent fallbacks

`message.updated` will immediately provide the latest assistant snapshot when
it has usable token data. The state-based effect will scan loaded messages from
newest to oldest and select the latest assistant message with a non-zero valid
snapshot; it will never reduce over all messages.

`session.next.step.ended` will be handled as a replacement fallback for servers
that emit it before the assistant message is finalized. The existing
`message.part.updated` `step-finish` accumulation path will be removed rather
than used as another counter source.

The server context-text source is treated as authoritative for the update in
which it arrives. A later valid assistant or step snapshot may replace it when
the conversation advances, so a post-compaction text value cannot remain stale
forever.

### 4. Keep compaction state explicit

On compaction start, clear the chip and suppress pre-compaction fallback events.
When a non-zero context text arrives, accept it and end the suppression period.
When compaction ends or a compacted session is reported, end suppression as well
so a post-compaction loaded assistant snapshot can repopulate the chip even if
the server does not emit context text. Session changes clear the snapshot and
source state completely.

### 5. Test behavior at the event boundary

Focused webview scenario tests will drive events through the existing bridge,
rather than testing a private counter implementation. They will assert the
observable chip value for multiple messages, multiple steps, repeated events,
session aggregate updates, server text, zero values, model percentages, and
compaction transitions.

## Risks / Trade-offs

- **Provider token fields may be absent or zero during streaming** -> Ignore
  unusable fallback snapshots and preserve the last valid display value.
- **Some OpenCode versions may not emit `context.updated`** -> Use assistant
  message events and loaded message state, with `step.ended` as a replacement
  fallback.
- **Compaction events can arrive in different orders** -> Clear on start,
  suppress only the compaction interval, and release the guard on either
  accepted context text or compaction completion.
- **The chip may not exactly match every TUI token-total presentation** -> Keep
  the prompt-context metric explicit in the capability spec and tooltip behavior
  rather than silently mixing lifetime usage into the value.
- **The selected model may not expose a context limit** -> Continue showing the
  formatted token count without a percentage, preserving existing behavior.

## Migration Plan

No persisted data or protocol migration is required. The change takes effect on
the next webview render and session event; existing sessions are repopulated
from their latest loaded assistant snapshot when selected. The independent
OpenCode TUI and server storage remain unchanged.

To roll back, restore the previous `App.tsx` context display implementation and
the prior context-memory specification/tests. No database cleanup or user
configuration change is needed.
