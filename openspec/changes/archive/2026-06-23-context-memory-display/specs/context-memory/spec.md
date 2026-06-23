## Context Memory Display

The InputArea MUST display a contextual memory chip showing context window usage (e.g. `22.1K (2%)`) using server-provided token data from events or React state when the opencode server emits matching session events.

## ADDED Requirements

### Requirement: Event types for context memory data flow

The `AgentEvent` union in `@opencode-chat/core` MUST include event variants that carry token data for context memory computation: `session.next.context.updated` (server-provided text), `session.next.step.ended` (step tokens), and `message.updated` and `session.updated` (both with `sessionID` at properties level).

#### Scenario: All required event variants compile

- GIVEN the `AgentEvent` union in `packages/core/src/domain.ts`
- WHEN TypeScript checks the type
- THEN `session.next.context.updated`, `session.next.step.ended` variants are valid members
- AND `session.updated` and `message.updated` include `sessionID: string` in properties
- AND existing `AgentEvent` consumers remain type-compatible without modification.

### Requirement: ChatSession carries aggregate token data

The `ChatSession` domain type SHALL include an optional `tokens` field matching the SDK `Session.tokens` shape, enabling state-based context memory computation without depending on transient events.

#### Scenario: ChatSession tokens are accessible

- GIVEN a `ChatSession` object with `tokens: { input: 19857, output: 65, reasoning: 75, cache: { read: 22016, write: 0 } }`
- WHEN the state-based context memory effect runs
- THEN `getContextTokenCount(tokens)` returns `22121` (input + cache.read)
- AND the formatted string is computed correctly.

### Requirement: Multi-source context memory fallback

The `handleEvent` callback in `App.tsx` MUST set `contextMemory` state from available token sources in this priority: (1) server-provided `context.updated` text (unless it represents zero); (2) `message.updated` assistant message tokens; (3) `session.updated` aggregate session tokens; (4) `session.next.step.ended` step tokens. A state-based `useEffect` SHALL also derive the display from `session.activeSession?.tokens` or the latest assistant message tokens in `msg.messages`.

#### Scenario: session.updated tokens update chip

- GIVEN an active session with id matching the event
- WHEN a `session.updated` event arrives with `info.tokens: { input: 105, cache: { read: 22016 } }`
- THEN `contextMemory` state is set to the formatted token count with percentage.

#### Scenario: State fallback ignores zero tokens

- GIVEN `session.activeSession?.tokens` exists but `getContextTokenCount` returns 0
- WHEN the state-based effect runs
- THEN `setContextMemory` is NOT called (value preserved from last good source).

#### Scenario: Zero server text is ignored

- GIVEN a `context.updated` event with `text: "0 (0%)"`
- WHEN the handler processes it
- THEN `setContextMemory` is NOT called with that text.

### Requirement: Chip rendered in InputArea action bar

The InputArea MUST render the context memory text as a `<span>` element in the `actionsLeft` bar when `contextMemoryText` is a non-empty string, placed after the terminal button.

#### Scenario: Chip renders when text is non-empty

- GIVEN `contextMemoryText` is `"22.1K (2%)"`
- WHEN InputArea renders
- THEN a `<span>` with the text content is present in `actionsLeft`
- AND the `<span>` appears after the terminal button in DOM order.

#### Scenario: Chip hidden when text is empty

- GIVEN `contextMemoryText` is `""` (or `undefined`)
- WHEN InputArea renders
- THEN no context memory `<span>` is rendered.

### Requirement: Chip styling matches TUI convention

The context memory span SHALL use muted monospace styling to match the TUI's terminal-like appearance.

#### Scenario: Chip uses muted monospace style

- GIVEN the chip is rendered
- THEN the span has CSS class `contextMemory`
- AND the computed style includes `color: var(--vscode-descriptionForeground)`
- AND the computed style includes a monospace font-family.

### Requirement: Internationalized tooltip

The context memory chip SHALL have a localized title attribute set to the `input.contextMemory` locale key across all eight supported locales.

#### Scenario: Chip has localized title

- GIVEN locale is English
- WHEN the chip renders
- THEN the `<span>` title attribute is `"Contextual memory"`.
