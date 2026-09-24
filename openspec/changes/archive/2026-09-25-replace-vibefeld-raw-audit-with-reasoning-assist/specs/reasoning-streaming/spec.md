# Spec Delta

## ADDED Requirements

### Requirement: Event delivery tolerates unexpected and payload-less OpenCode events

The companion agent SHALL normalize every received OpenCode event so that
`properties` is always defined, defaulting to an empty object when the server
omits both `properties` and `data`. No event, however unexpected or malformed,
SHALL terminate event delivery: a failing event listener SHALL be isolated so
later events on the same stream are still delivered. The agent SHALL record a
bounded diagnostic for a payload-less or failing event that names only the event
type and the error name, at most once per distinct event type up to a fixed
bound, and SHALL NOT log event payload contents. The chat view provider's event
handler SHALL forward a payload-less event without throwing.

#### Scenario: A payload-less event is delivered safely

- **WHEN** the server delivers an event that has neither `properties` nor `data`
- **THEN** the agent SHALL deliver it with an empty `properties` object
- **AND** the chat view provider SHALL forward it without an unhandled error
- **AND** subsequent events SHALL continue to be delivered

#### Scenario: A listener failure is isolated

- **WHEN** a registered event listener throws while handling an event
- **THEN** the agent SHALL record a bounded diagnostic naming only the event type
  and the error name, at most once per distinct type
- **AND** SHALL continue delivering later events on the same stream instead of
  terminating the subscription

#### Scenario: Reconnect invalidation stays reachable

- **WHEN** a payload-less `server.connected` event arrives
- **THEN** the chat view provider SHALL apply its reconnect invalidation and
  SHALL NOT throw

#### Scenario: Diagnostics stay bounded and redacted

- **WHEN** many distinct unexpected event types arrive
- **THEN** the agent SHALL emit at most the fixed bounded number of distinct
  diagnostics
- **AND** SHALL NOT include event payload contents
