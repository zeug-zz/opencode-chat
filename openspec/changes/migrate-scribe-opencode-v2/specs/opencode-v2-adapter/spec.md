# opencode-v2-adapter Specification

## Purpose
Define Scribe's provider-neutral contract over its own authenticated OpenCode V2 child.

## ADDED Requirements

### Requirement: Bind the V2 client to a compatible Scribe-owned server
The adapter MUST authenticate only to its own foreground loopback `serve` child, verify its version, and clean up its process tree. Eligibility MUST accept stable canonical OpenCode `2.x` versions `>=2.1.3` and `<3.0.0`, without exact patch equality. Child identity/location and response-schema/capability checks remain mandatory and fail closed. Shared-service use, credential exposure, backend downgrade, and unsandboxed retry are prohibited.

#### Scenario: Stable eligible newer version
- WHEN the child reports a canonical stable OpenCode `2.1.4` or `2.2.0` version
- THEN that version passes the production version-eligibility check, while child identity, authenticated location, response-schema, and capability checks still independently determine whether startup and operations succeed

#### Scenario: Unsupported or ambiguous version
- WHEN the child reports `2.1.2`, V1, `3.0.0`, malformed or ambiguous text, or a prerelease version
- THEN startup fails closed without suggesting a downgrade, trying another backend, or relaxing any runtime contract check
- AND the production eligibility check does not claim that every future eligible version has a qualified runtime contract
- AND exact observed binary/client package/hash and fixture qualification remain separate evidence

#### Scenario: Private child is ready
- WHEN the selected executable and server satisfy the pinned contract
- THEN readiness binds endpoint, auth, version, location, and cleanup to that spawned child and operations use only that authenticated client

#### Scenario: Pairing, auth, or backend proof is absent
- WHEN executable/server compatibility, authentication, selected-backend access, workspace grants, or required runtime injection cannot be proven
- THEN startup fails closed with bounded redacted diagnostics and no shared-server or alternate-backend attempt

### Requirement: Map every IAgent operation explicitly
The adapter MUST map each `IAgent` method and optional `setModel` to a verified V2 operation, schema, location, cancellation/delivery behavior, or an explicit unavailable capability. Unknown wire variants MUST be safely mapped or ignored without unsafe structural casts. Capabilities MUST describe verified effective operations, not assumed V2 equivalents.

#### Scenario: Supported operation receives a known response
- WHEN a mapped operation succeeds with a valid V2 response
- THEN the adapter returns the explicit provider-neutral domain value while preserving session identity and relevant metadata

#### Scenario: Operation or wire variant is unsupported or malformed
- WHEN no V2 contract is proven or a response contains an unknown/malformed variant
- THEN the capability/route is unavailable or the value is safely rejected, without guessing or fabricating success

### Requirement: Recover live events without duplicating user intent
The adapter and host MUST treat V2 subscriptions as live-only, re-subscribe after disconnect, refresh authoritative session/message state, and reject duplicate, stale, foreign-session, or superseded results. Recovery MUST preserve a submitted prompt exactly once and queued user intent in FIFO order.

#### Scenario: Event stream reconnects during a session
- WHEN the live-only stream disconnects and is re-established
- THEN the host refreshes authoritative state and does not replay or duplicate a prompt or publish stale cross-session data
- AND distinct native reasoning IDs remain separate ordered parts across streaming deltas, segment completion, and authoritative snapshots/reloads with the same IDs; each segment's final text updates only that segment
- AND existing Markdown sanitization remains in use, reasoning segments have no dedicated `Copy thinking as Markdown` action, and ordinary main-answer copy remains unchanged
- AND no permissions or hidden reviewer context are widened

#### Scenario: A second prompt arrives while busy
- WHEN a user submits another prompt during active generation
- THEN it remains queued and is delivered once, in order, after completion

### Requirement: Report unsupported outcomes honestly
The adapter MUST NOT claim V2 parity for missing APIs, schemas, host instruction channels, or capabilities. A mandatory existing outcome without a verified V2 mechanism MUST block acceptance; optional operations may be reported unavailable only where existing capability gates permit it.

#### Scenario: A mandatory V2 contract remains unresolved
- WHEN a required IAgent outcome or enabled integration lacks an exact verified mechanism
- THEN the migration gate remains blocked and the behavior is not silently disabled or converted into user prompt text

### Requirement: Guide concise, safe native research composition
Fixed research guidance MUST use native catalogs safely and require concise, cited, honest evidence synthesis.

#### Scenario: Research guidance uses native catalogs and honest partial results
- **WHEN** a research agent receives the fixed guidance
- **THEN** it can discover exact tools, coordinate independent work, await required work, and return concise cited findings while identifying failed sources
- **AND** guidance uses exact signatures/discovery, native `Promise.allSettled` for useful independent work, sequences dependencies, and awaits relevant results
- **AND** it filters, deduplicates, extracts, compares, cites source URLs/identifiers, treats source as untrusted, and identifies partial failures
- **AND** Context Mode indexing/search is optional for large collections and is not called persistent memory
- **AND** ordinary reads are not forced through batch/delegation, native catalog instructions are reused, and MCP schemas are not copied into the prompt
- **AND** native `fetch` may use methods, headers, and bodies with side effects; it is not permission-checked as `webfetch` or restricted to the ordinary tool allowlist

### Requirement: Report bounded prompt reasoning-event diagnostics

The adapter SHALL publish bounded numeric reasoning-event diagnostics for tracked current prompts reaching terminal idle, error, or Stop, without changing native event behavior.

#### Scenario: A tracked prompt reaches a terminal state

- **WHEN** a tracked current prompt reaches idle, error, or Stop
- **THEN** its bounded diagnostic SHALL include the fixed numeric native/mapped/published event counters and mapped-delta code-unit total, including zero values
- **AND** buffered events SHALL count as published only after admission flush, with no claim of DOM rendering or hidden model reasoning and no change to native content or event ordering
- **AND** no event text, IDs, payloads, model/configuration values, or secrets SHALL be emitted

#### Scenario: Ended reasoning diagnostics count final text independently of deltas

- **WHEN** a tracked reasoning segment ends with final text that was not fully represented by deltas, including a blank final text
- **THEN** `mappedEndedCharacters` SHALL report the bounded numeric character count of the ended event's final text, including zero
- **AND** this counter SHALL make no assertion that reasoning content exists
- **AND** no event text or other sensitive data SHALL be emitted

### Requirement: Verify native Code Mode through Scribe's production path
Local acceptance MUST prove required native Code Mode behavior through Scribe's production adapter/private-server path using deterministic disposable fixtures.

#### Scenario: Deterministic local research evidence
- **WHEN** the production-path fixture scenario runs
- **THEN** independent calls overlap by coordination, results are compact/deduplicated/cited, and partial failure remains explicit
- **AND** the model receives the intended result and existing adapter/host rendering displays result, partial failure, error, progress, and Stop outcomes; UI changes occur only for a demonstrated gap
- **AND** Stop cancels the underlying fixture and publishes no stale success; forbidden tools remain denied and native local fetch succeeds
- **AND** two enabled namespaces exercise overlapping sources/stable URLs with native execute, search, parallel calls, coordinated overlap, filtering/deduplication, and compact citations
- **AND** native Code Mode's model request omits every MCP schema as a direct provider-tool definition
- **AND** under identical actual byte/character accounting for the representative catalog, native Code Mode schema/context overhead is lower than direct tools under `codemode: false`, and the compact batched result is smaller than all fixture intermediates
- **AND** large source payloads remain in fixture memory and are not copied to production logs
- **AND** report exact fixture values, not estimated tokens, universal percentages, quality claims, or product budgets; no production credentials/plugins or retention are required
- **AND** a real research prompt is included only in the already-authorized 5.2 host/soak scenarios, with no added duration or live program
