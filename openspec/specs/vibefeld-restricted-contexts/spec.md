# vibefeld-restricted-contexts Specification

## Purpose
Provide a hidden, host-owned restricted child-context boundary for bounded
adversarial review without exposing broader model, tool, or configuration authority.

## Requirements

### Requirement: Provide a hidden restricted child-context provider over the extension-owned server

The host MAY declare exactly one restricted-review agent overlay inside the
extension-owned OpenCode server's in-memory configuration for the architect and
critic stages. The overlay SHALL deny every known tool and dynamically present
tool name in addition to the `"*"` wildcard, reject unknown authority entries,

#### Scenario: The restricted overlay is built
- **WHEN** the host composes its server configuration for reasoning assistance
- **THEN** the restricted agent SHALL exist only in the in-memory configuration
  with every enumerated tool denied and host-pinned model and instructions
- **AND** it SHALL not appear in a user-visible agent list or modify configuration
  files, profiles, plugins, MCP servers, or custom tools

#### Scenario: An overlay is permissive or unknown
- **WHEN** the overlay grants any tool, omits the deny map, supplies an
  unexpected field, names an unknown authority, or uses a non-host-owned model
  or instruction channel
- **THEN** the host SHALL reject it before any context is created
- **AND** ordinary prompt dispatch SHALL continue without hidden assistance

### Requirement: Gate the provider on a configuration-verified, generation-bound readiness preflight

The provider SHALL report `supported: true` only when both hold: the host
composed the restricted overlay for the current server generation, and a
read-only inspection of the extension-owned server's effective configuration
confirms the restricted agent with every configured tool denied and the expected
host-pinned model and instructions. The check proves configuration only and
SHALL NOT be described or published as enforced isolation; enforcement evidence
SHALL come from the provider implementation and the gated live proof. The
preflight SHALL create no session, make no model call, spawn no process, and
write no configuration. The readiness result SHALL be invalidated by any server
generation change (reconnect, relaunch, or overlay change), SHALL be revalidated
before each review, and any mismatch, absent restricted agent, malformed
read-back, or stale generation SHALL keep the provider dormant and unavailable;
no claim or AF compatibility result SHALL be treated as restricted-context
capability.

#### Scenario: The server confirms the restricted agent

- **WHEN** the host-composed overlay for the current generation and the
  effective configuration report the restricted agent with every enumerated tool
  denied and the host-pinned model and instructions
- **THEN** the provider MAY report ready for manual adversarial review
- **AND** the check SHALL remain read-only with no session or model call
- **AND** any published status SHALL use configuration-level wording only

#### Scenario: The server drifts, reconnects, or cannot be inspected

- **WHEN** the restricted agent is absent, a tool is permitted, the model or
  instructions differ, the generation changed, or the configuration read fails
- **THEN** the provider SHALL invalidate or withhold readiness, stay dormant, and
  publish an unavailable status
- **AND** no child context, model call, configuration write, or fallback to
  another authority path SHALL occur

### Requirement: Keep child sessions hidden and unretained

The provider SHALL register every created child session id with the host at
creation, and the extension SHALL filter registered ids from session-list
mapping, agent lists, and webview event publication. Child sessions SHALL use
fixed host-private marker titles containing only a random token. Every preflight
SHALL abort and delete its child sessions regardless of outcome, extension
deactivation SHALL await disposal, and startup SHALL scavenge leftover marked
sessions. The host SHALL not persist stage packets, raw architect results, raw
critic output, or traces; it MAY publish only the bounded reasoning-assist
summary.

#### Scenario: Child sessions exist during a review
- **WHEN** the host holds an architect or critic child session, including one
  whose creation event arrives before registration resolves
- **THEN** the extension's session list, agent list, and webview SHALL not
  surface it or its events

#### Scenario: A review or the extension ends
- **WHEN** a preflight completes, fails, times out, or is cancelled, or the
  extension deactivates with work in flight
- **THEN** the host SHALL abort and delete every created child session and await
  disposal on deactivation
- **AND** no packet, raw stage output, or trace SHALL remain persisted

### Requirement: Keep default verification fixture-only and gate the live proof

Default tests and ordinary activation SHALL use injected provider fakes and
sanitized fixtures only, and SHALL not require a running OpenCode server, model
provider, network, shell, user profile, or configuration write. Any live proof
SHALL reuse the repository's existing live-test opt-in gate with a disposable
host-owned configuration and SHALL assert, together: the restricted agent is
present with every enumerated tool denied in the effective configuration,
including a dynamically added tool; the hidden agent is directly invokable for
both roles; a probe that attempts to read a sentinel file returns no tool
invocation and no sentinel content; prover and verifier use distinct minted
provenance; cancellation aborts and deletes the sessions; deletion removes child
sessions after both successful and failed reviews; marked sessions stay hidden
from the extension session list; and no global or workspace configuration file
is written. With the gate absent, the proof SHALL skip without launching a
server or making a model call. A configuration-only match without the no-tool
probe and the dynamic-tool check, or an uninvokable hidden agent, SHALL NOT be
treated as proof.

#### Scenario: The default suite runs

- **WHEN** focused or full tests run without the live-proof gate
- **THEN** they SHALL exercise overlay validation, readiness gating and
  invalidation, bounded stage validation, provenance minting, stage deadlines,
  serialized cancellation, redaction, registry filtering, cleanup, scavenging,
  and selection using fakes and fixtures
- **AND** no server process, model request, network call, shell command, or
  configuration write SHALL occur

#### Scenario: The live proof is gated and absent

- **WHEN** the live-proof opt-in, a disposable server configuration, or a model
  provider is unavailable
- **THEN** the proof SHALL skip safely
- **AND** the provider SHALL remain unavailable rather than weaken permissions or
  claim fixture results represent production support

### Requirement: Run bounded architect and critic stages

The provider SHALL create one host-private context for an architect stage and,
Each stage SHALL receive only its bounded packet, use a provider-enforced
deadline, validate exact schema output, and discard raw text after host
normalization. The stage instructions SHALL enumerate every bounded enum value
the schema validates - claim classes, evidence source kinds, evidence statuses,
objection severities, and objection target kinds - so a hidden stage can comply
without guessing, and the enumerated literals SHALL match the host parser's
frozen enums. The architect instruction SHALL request the smallest sufficient
argument map - bounded soft counts for claims, assumptions, evidence needs, and
uncertainty items, and short statements - so generation fits the stage deadline.
It SHALL mint stage identities that are bounded, letter-leading,
webview. A preflight SHALL have at most two live child sessions, no automatic
retry, and a bounded total timeout.

#### Scenario: Architect and critic stages complete
- **WHEN** a generation-ready provider runs a valid architect result followed by
  a valid critic stage
- **THEN** it SHALL retain only normalized host-private stage data needed for the
  compact assist brief
- **AND** it SHALL not retain or publish raw child output, packets, paths, or
  model reasoning

#### Scenario: Stage instructions enumerate their validated enums
- **WHEN** a hidden stage receives its instruction
- **THEN** every enum the host schema validates SHALL be spelled out in the
  instruction with its exact allowed values
- **AND** the instruction literals SHALL be pinned to the host parser's frozen
  enum constants by a cross-package test

#### Scenario: A stage fails or is cancelled
- **WHEN** a stage returns malformed, oversized, unsafe, or ambiguous data, the
  stage deadline expires, or the prompt is cancelled or superseded
- **THEN** the provider SHALL abort and delete every context it created and drop
  late results
- **AND** it SHALL not retry through the Chat sandbox, task delegation, plugin,
  MCP, or an unsandboxed process

### Requirement: Read stage results only after the hidden reply completes

The stage transport SHALL treat a hidden stage reply as a stage result only
after the assistant message reports completion, either through its
message-level completion timestamp or through an end timestamp on every one of
its text parts. When the server exposes neither marker, the transport SHALL
require the same non-empty text across a fixed number of consecutive polls
before returning it. Retrieval SHALL respect the provider-enforced deadline, and
no partial streamed reply SHALL reach schema validation.

#### Scenario: A streaming reply is not returned early
- **WHEN** the hidden assistant message is still streaming without completion
  markers
- **THEN** the transport SHALL keep polling within the stage deadline
- **AND** it SHALL NOT return partial text for schema validation

#### Scenario: A completed reply is returned once
- **WHEN** the assistant message reports completion
- **THEN** the transport SHALL return its full bounded text as the stage result

#### Scenario: A reply never completes
- **WHEN** no completion marker or bounded stability is reached within the stage
  deadline
- **THEN** the transport SHALL fail the stage as a bounded timeout
