## MODIFIED Requirements

### Requirement: Keep plugin loading equivalent across launch paths

The unsandboxed and sandboxed private-child V2 launch paths SHALL expose equivalent native plugin sources, agent overlays, MCP overlays, guidance overlays, and workspace context. Both paths SHALL use the same process-scoped V2 configuration without modifying user or project configuration files.

#### Scenario: SDK-managed and sandboxed launches have plugin parity

- **WHEN** the same workspace is launched once through the unsandboxed private-child path and once through the sandboxed private-child path
- **THEN** both launches SHALL receive the same effective plugin sources
- **AND** both launches SHALL retain the same Scout, Build, worker, MCP, guidance, network, and workspace policies

#### Scenario: Independent TUI remains unchanged

- **WHEN** the companion loads inherited plugins
- **AND** an independent OpenCode TUI is started
- **THEN** the TUI SHALL use its normal native configuration and plugin lifecycle
- **AND** the extension SHALL not persist or alter companion overlay data in the TUI configuration

## ADDED Requirements

### Requirement: Qualify inherited V2 plugin discovery without weakening fallback
Plugin qualification MUST verify intended V2 discovery in a fresh private child and distinguish it from metadata, fixtures, and Scribe operation. The inherited lane MUST assert expected identity/source/version and effective policy with isolated mutable state; empty inventory is not PASS.

#### Scenario: Expected plugin is absent or fallback retains authority
- **WHEN** intended plugin discovery is absent, ambiguous, or fallback leaves plugin/provider authority
- **THEN** qualification fails and required integration remains blocked; no empty-inventory success or broader retry occurs

### Requirement: Rely on native per-plugin failure isolation
Native V2 lists a failing plugin as failed while the server stays ready, so Scribe MUST NOT add a plugin-free retry. A configuration-level plugin-free relaunch is not expressible in native V2. A failed required integration plugin MUST be reported unavailable, never claimed.

#### Scenario: A failing inherited plugin does not block the companion
- **WHEN** an inherited plugin throws on import, has an invalid export, or throws during activation
- **THEN** the private child still becomes ready, the plugin is reported failed by native plugin status, other plugins and sessions keep working, and no Scribe retry or authority change occurs
- **AND** an integration that depends on that plugin (for example Hindsight) is reported unavailable

### Requirement: Preserve delivered Codex V2 retry ownership and limits
Scribe MUST qualify but MUST NOT modify the delivered external Codex plugin. Verification MUST distinguish module-evaluation loading before fetch capture, root/child native session correlation and cancellation, stripping private tokens before provider delegation, and native retry ownership. Coverage is HTTP-only and process-alive-only; WebSocket/other transports pass through and transport preferences MUST NOT be forced for test coverage.

#### Scenario: Child correlation and cancellation
- **WHEN** a child session request is retried or cancelled
- **THEN** correlation uses verified native child evidence (not outgoing `x-session-id` alone), cancellation reaches the child, and private tokens do not reach the provider delegate

### Requirement: Load the Scribe reasoning-context plugin only in the private server

The bundled reasoning-context plugin SHALL pass a pinned SHA-256 check and be
loaded only through Scribe's private-server in-memory overlay. It SHALL be
tool-less and absent from user/project/global configuration and the independent
TUI. It MAY modify only a matching outgoing Scout call with a bounded
host-delivered brief, never history or durable instructions. Failure SHALL
disable assist only; Chat SHALL remain available without an alternate-server,
durable-channel, or unsandboxed fallback.

#### Scenario: The bundled plugin is loaded for Scribe only

- **WHEN** the extension verifies the bundled plugin digest and starts its
  private V2 server
- **THEN** it MAY add the verified tool-less plugin only through the private
  server's in-memory overlay
- **AND** user/project/global configuration and an independent TUI SHALL remain
  unchanged

#### Scenario: A nono-contained private server can read the verified plugin

- **WHEN** the private server is launched through nono with the verified plugin
- **THEN** the launch SHALL add a read-only grant for exactly the verified plugin
  directory
- **AND** it SHALL add no write grant, no grant for inherited or unverified
  plugin paths, and no grant when the plugin is not launched

#### Scenario: The bundled bytes or hook identity are invalid

- **WHEN** the digest mismatches, hook session/agent identity cannot be
  verified, or a delivery is stale or oversized
- **THEN** the plugin SHALL apply no brief and reasoning assist SHALL be
  unavailable for that turn
- **AND** no durable instruction, configuration entry, or broader authority
  SHALL be used as a fallback

#### Scenario: The plugin fails while ordinary Chat is usable

- **WHEN** native plugin loading, hook execution, or the host-to-plugin channel
  fails
- **THEN** the private Chat server and ordinary prompt path SHALL remain usable
- **AND** only reasoning assist SHALL be disabled with bounded redacted
  diagnostics

#### Scenario: Restricted-role tool filtering fails closed without changing Scout fail-open behavior

- **WHEN** the context hook receives the exact `vibefeld-restricted-review`, `chat-reasoning-critic`, or `chat-reasoning-verifier` identity, or the `session.generate` hook receives the exact `vibefeld-restricted-review` identity
- **THEN** the applicable hook SHALL remove every own model-tool key and verify that no key remains
- **AND** a missing or malformed tool container, a filtering exception, an unremovable definition, or any leftover key SHALL raise a fixed hook error and SHALL prevent that restricted request from reaching the model provider
- **AND** the context hook SHALL filter no other role, and the `session.generate` hook SHALL filter no role other than `vibefeld-restricted-review`
- **AND** definition filtering SHALL grant no authority and SHALL leave native deny policies and existing permission-denial and execution-denial hooks in force
- **AND** Scout brief injection SHALL remain total and fail-open: internal injection errors or grace expiry apply no brief but allow the ordinary Scout model request to continue
- **AND** the Scout context hook SHALL perform no I/O and MAY await only the one in-memory grace promise for a matching host-confirmed pending argument turn, one-shot and capped by the plugin at 2 seconds regardless of host-supplied grace
- **AND** plugin absence or failure SHALL disable reasoning assist only and preserve ordinary Chat
- **AND** the pinned OpenCode 2.2.0 native fixture SHALL verify zero tool definitions on restricted generate/prompt requests, no provider request after an injected restricted generate-hook failure, and successful subsequent Scout generation; this fixture evidence SHALL NOT be represented as an actual-host guarantee, and 2.1.3 evidence remains source-availability-only

#### Scenario: A narrowly unavailable reasoning RPC may use one status probe

- **WHEN** the reasoning-context RPC fails specifically with `rpc.unavailable` or `rpc.method_not_found`
- **THEN** the adapter MAY make one bounded `plugin.list` status probe in that connection generation and validate the exact launched plugin identity and location
- **AND** the probe SHALL be generation-bound, time-bounded, response-bounded, fail-open, and never repeated in that generation
- **AND** every other RPC failure SHALL skip the probe
- **AND** probe failure or stale generation SHALL resolve as unavailable without exposing native errors, paths, or response contents
- **AND** the probe SHALL not expand permissions or introduce alternate launch, server, or fallback paths

#### Scenario: Concurrent manual-review cleanup coalesces for one owned child

- **WHEN** timeout, cancellation, and deletion concurrently request cleanup of the same owned child
- **THEN** native cancellation and deletion SHALL be coalesced into one cleanup operation
- **AND** a genuine native cleanup failure SHALL remain observable to the caller
- **AND** the existing stage and total review deadlines SHALL remain unchanged
