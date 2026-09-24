## ADDED Requirements

### Requirement: Provide a hidden restricted child-context provider over the extension-owned server

The host MAY declare exactly one restricted-review agent overlay inside the
extension-owned OpenCode server's in-memory configuration. The overlay SHALL
deny every tool by enumerating the authoritative tool and permission inventory —
the concrete built-in authorities (`read`, `glob`, `grep`, `edit`, `write`,
`patch`, `bash`, `task`, `webfetch`, `websearch`, `skill`, `todo`/`todowrite`,
`question`, `lsp`, `list`, `external_directory`, `doom_loop`) and any
dynamically present tool names from installed plugins or MCP servers — in
addition to the `"*"` wildcard, SHALL reject unknown or unrecognized authority
entries rather than passing them through, SHALL pin the host-resolved child
model, SHALL carry a fixed host-owned instruction, SHALL bound the agentic
steps, and SHALL keep the agent hidden from user-visible agent surfaces. The
overlay SHALL never be written to a global or workspace configuration file, a
profile, a plugin, an MCP server, or a custom tool, and SHALL apply only to the
extension-owned server process. Child stage prompts SHALL use that agent with
the same deny map, the pinned model, a fixed host-owned system instruction, and
only the bounded review packet as input; no attachments, files, argv, commands,
paths, credentials, or additional instruction channels SHALL be supplied. The
child model SHALL be resolved host-side only (from host-recorded review state or
the host configuration) and SHALL never be derived from the packet, the review
request, or child output. Host-configured plugins and MCP servers SHALL remain
trusted host extensions in that same process; this requirement constrains the
restricted agent's model-callable authority and SHALL NOT constrain those host
extensions.

#### Scenario: The restricted overlay is built

- **WHEN** the host composes the extension-owned server configuration for a
  restricted review capability
- **THEN** the restricted agent SHALL be present only in the in-memory
  configuration with every enumerated tool denied and the host-pinned model and
  instructions
- **AND** no global or workspace configuration file, profile, plugin, MCP server,
  or custom tool SHALL be added or modified
- **AND** the restricted agent SHALL not appear in a user-visible agent list

#### Scenario: An overlay is permissive or unknown

- **WHEN** the overlay grants any tool, omits the deny map, supplies an
  unexpected field, names an unknown authority entry, or names a model or
  instruction channel that is not host-owned
- **THEN** the host SHALL reject the overlay before any context is created
- **AND** it SHALL keep the provider unavailable without retrying through another
  authority path

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

### Requirement: Run provenance-distinct, bounded, cancellable stages

The provider SHALL create one host-private context per role through distinct
creation calls. It SHALL mint bounded letter-leading identities and handles
(`prover-…`/`verifier-…`, ≤64 characters, matching `^[A-Za-z][A-Za-z0-9_-]*$`)
that are never derived from packet content and never published to the webview or
core protocol, and it SHALL use the fixed context numbers (prover 1, verifier 2).
A child stage SHALL receive only the validated bounded review packet; stage text
SHALL be obtained through a bounded await within a provider-enforced stage
deadline (no more than 30 seconds), validated by the existing exact-key bounded
validators, used only to produce redacted findings, and then discarded.
Stage-derived reason text SHALL be normalized with host-applied redaction of
path-, URL-, and secret-like patterns and hard bounds before any projection, and
raw child text SHALL NOT be published. Malformed, oversized, unsafe,
unknown-target, or ambiguous data SHALL fail closed as audit-failed without
echoing the invalid payload or forcing acceptance. Each review SHALL run at most
one prover stage and one verifier stage, with at most two child sessions alive
and one in-flight review per session/message; the host SHALL set an explicit
bounded total timeout (default 60 seconds) when constructing the orchestrator
and SHALL perform no automatic retry. A newer review SHALL await the
cancellation of the previous one before starting, cancellation SHALL abort and
delete both role contexts, a publication generation token SHALL be checked
before any result is published, and a late or superseded result SHALL never be
published.

#### Scenario: A bounded stage completes

- **WHEN** a prover or verifier stage returns bounded schema-valid data for the
  known packet targets within the stage deadline
- **THEN** the host SHALL accept only the normalized review data and the minted
  provenance identity
- **AND** no raw child output, packet content, path, or reasoning SHALL be
  retained or published, and projected reasons SHALL be redacted

#### Scenario: A stage fails or is cancelled

- **WHEN** a stage returns malformed, oversized, unsafe, or ambiguous data, the
  model fails, the stage deadline or total timeout elapses, or the user cancels
  the review
- **THEN** the host SHALL map the outcome to unavailable, audit-failed, or
  unresolved without forced acceptance or automatic retry
- **AND** it SHALL abort and delete both contexts, drop any late result via the
  generation token, and SHALL not retry through the Chat sandbox, a task, a
  plugin, MCP, or an unsandboxed process

### Requirement: Keep child sessions hidden and unretained

The provider SHALL register every created child session id with the host at
creation, and the extension SHALL filter registered ids from session-list
mapping, agent lists, and webview event publication, buffering events that
arrive before registration resolves so hiddenness does not depend on title
matching. Child sessions SHALL use fixed host-private marker titles containing
only a random token — never packet, claim, or child content — retained solely
for startup scavenging. Every review SHALL abort and delete its child sessions
unconditionally regardless of outcome, extension deactivation SHALL await
disposal of all child sessions, and startup SHALL scavenge leftover marked
sessions from a crashed process. The host SHALL not persist review packets,
proposals, verdicts, child outputs, or traces; only the existing bounded
`ReasoningReviewSummary` may be published.

#### Scenario: Child sessions exist during a review

- **WHEN** the host holds one or more restricted child sessions, including one
  whose creation event arrives before registration resolves
- **THEN** the extension's session list, agent list, and webview SHALL not
  surface them
- **AND** their events SHALL not reach the webview or alter the reviewed message

#### Scenario: A review or the extension ends

- **WHEN** a review completes, fails, times out, or is cancelled, or the
  extension deactivates with work in flight
- **THEN** the host SHALL abort and delete every child session it created,
  awaiting disposal on deactivation and scavenging marked leftovers at startup
- **AND** no packet, proposal, verdict, or trace SHALL remain persisted

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
