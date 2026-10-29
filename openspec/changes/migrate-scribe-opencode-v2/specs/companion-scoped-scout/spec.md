## MODIFIED Requirements

### Requirement: Create Scout only for the companion-owned server
The VS Code extension SHALL start its companion-owned V2 server with a process-scoped native V2 configuration overlay that defines an agent named `scout` with mode `all`. The extension SHALL NOT create, modify, or persist any global or workspace OpenCode configuration file as part of VSIX installation, activation, or Scout setup.

#### Scenario: Clean OpenCode configuration
- **WHEN** a user has no `agent.scout` entry in global or workspace OpenCode configuration
- **AND** the VS Code companion starts its own server
- **THEN** the companion server SHALL advertise an eligible `scout` agent with mode `all`
- **AND** the GUI SHALL present that agent as `chat`

#### Scenario: Independent TUI remains unchanged
- **WHEN** the VS Code companion starts its own server with the Scout overlay
- **AND** the user launches an independent OpenCode TUI process outside the companion server
- **THEN** the independent TUI SHALL receive only its normal user/project OpenCode configuration
- **AND** the extension SHALL not have written Scout configuration into that configuration

#### Scenario: Attached companion terminal shares companion agent set
- **WHEN** the user opens the active companion session in a terminal
- **THEN** an independent V2 TUI SHALL import a session copy rather than attach to the companion
- **AND** it SHALL not receive the companion-only Scout overlay

### Requirement: Keep companion Scout read-only
The companion-scoped native V2 configuration SHALL deny editing and shell execution. Scout SHALL delegate only to the exact injected `chat-research-worker`, `chat-reasoning-critic`, or `chat-reasoning-verifier`; wildcard denial SHALL remain for every other task target. The research worker SHALL remain read-only. The hidden reasoning subagents SHALL be tool-less, schema-bounded, and explicitly denied `execute`, file, MCP, web, AF, Hindsight, shell, plugin, package, terminal, and further delegation authority. Build-backed Write SHALL deny shell, delegation, and unknown tools and SHALL not receive reasoning-review targets. Exact Hindsight permissions remain capability/backend-gated and the worker receives none. Effective V2 policy MUST preserve these boundaries under inherited config/plugins and in sandbox-on/off modes.

#### Scenario: Nono-backed Hindsight preserves agent boundaries
- **WHEN** the approved provider runs through the verified nono backend
- **THEN** Scout and Build SHALL receive only exact approved observed Hindsight permissions
- **AND** Scout SHALL retain edit, shell, package, terminal, and arbitrary-task denials
- **AND** the research worker SHALL receive no Hindsight permission

#### Scenario: Fallback Hindsight is recall-only
- **WHEN** nono is unavailable before launch and recall capability is detected
- **THEN** Scout and Build SHALL receive only the three exact recall/search permissions
- **AND** reflection, writes, capture, diagnostics, synchronization, lifecycle, deletion, administration, and unknown Hindsight tools SHALL remain denied
- **AND** the research worker SHALL receive no Hindsight permission

#### Scenario: Hindsight does not escalate Write
- **WHEN** either backend enables an approved Hindsight operation for Build-backed Write
- **THEN** Write SHALL retain its wildcard denial for shell, task, package, terminal, and unknown tools
- **AND** no shell/process, arbitrary delegation, unrelated worktree/session mutation or administration tools, or unrelated plugin authority SHALL be added beyond the explicitly permitted native Code Mode composition

#### Scenario: Inherited plugin loading does not broaden Scout
- **WHEN** the companion loads inherited native V2 plugins in either backend
- **THEN** Scout SHALL retain edit, shell, and restricted-task permissions
- **AND** Build-backed Write SHALL retain its deny-by-default boundary

#### Scenario: Default chat agent
- **WHEN** the companion receives its server agent list after startup
- **THEN** it SHALL select eligible Scout as the default primary agent
- **AND** it SHALL retain Build as the alternate selectable agent
- **AND** it SHALL not promote the research worker to a primary agent

#### Scenario: Scout delegates only to the injected worker
- **WHEN** Scout requests task delegation to the exact injected `chat-research-worker`
- **THEN** the request SHALL be permitted within the existing worker boundary
- **AND** the worker SHALL run in subagent mode

#### Scenario: Scout cannot target arbitrary task agents
- **WHEN** Scout requests delegation to an arbitrary, user-defined, similarly named, or otherwise unlisted agent
- **THEN** the request SHALL be denied
- **AND** Scout SHALL not receive general task or coding delegation capability

#### Scenario: Scout retains its direct tool boundary
- **WHEN** Scout operates through either selected backend
- **THEN** edit and shell execution SHALL remain denied
- **AND** only backend-permitted exact Hindsight operations SHALL be available
- **AND** the independent TUI SHALL remain unchanged

#### Scenario: Retention is an exact confirmation-gated exception
- **WHEN** the verified nono backend and exact provider identity, observed operation, capability, and confirmation checks pass
- **THEN** Scout and Build SHALL receive only the exact approved native retention operation through confirmation
- **AND** the research worker SHALL not receive that operation
- **WHEN** the compatibility fallback is active or any required check fails
- **THEN** no retention operation SHALL be granted

#### Scenario: Build-backed Write receives no escalation from Hindsight
- **WHEN** the approved provider is enabled in either backend
- **THEN** Build-backed Write SHALL receive only its backend-permitted exact Hindsight operations
- **AND** it SHALL not receive deletion, administration, unknown tools, shell, task, package, or terminal authority

#### Scenario: Worker exposes only approved read and research capabilities
- **WHEN** the companion advertises `chat-research-worker`
- **THEN** the worker SHALL have mode `subagent` and deny `*` by default
- **AND** it SHALL allow read/discovery/web research plus only reviewed Context Mode, Firecrawl, and paper-search tools
- **AND** edit, shell, task recursion, coding, package, terminal, and unknown tools SHALL remain denied

#### Scenario: Research MCP access follows Chat preferences
- **WHEN** a reviewed research server is explicitly enabled through Chat preference
- **THEN** the worker MAY use only its reviewed tool prefix under the verified native V2 MCP policy
- **AND** it SHALL not receive generic MCP authority

#### Scenario: Disabled or unapproved MCP tools remain unavailable
- **WHEN** a reviewed server is disabled or an unapproved server is enabled in Chat
- **THEN** the worker SHALL not use the disabled/unapproved server and its output remains untrusted evidence
- **AND** enabling a server SHALL not grant edit, shell, task, package, or terminal authority

#### Scenario: Overlay parity preserves the boundary
- **WHEN** the companion starts through either private-child backend
- **THEN** both paths SHALL expose the same Scout and worker permission boundaries
- **AND** the independent TUI SHALL receive neither injected worker nor Scout task allowlist
- **AND** no OpenCode config file SHALL be written

## ADDED Requirements

### Requirement: Permit native Code Mode for reviewed research
The companion MUST permit native `execute` only for Scout, the exact reviewed worker, and otherwise-permitted Build-backed Write tools; reviewers MUST remain tool-free.

#### Scenario: Research roles compose only permitted native tools
- **WHEN** Scout or the reviewed worker executes research composition, or Write composes its otherwise-permitted tools
- **THEN** native `execute` is available and nested permissions allow only the role's otherwise-permitted tools
- **AND** reviewer roles remain tool-free
- **AND** system/user denials and native nested-tool permissions remain authoritative
- **AND** shell, Scout/worker edits, recursive/arbitrary delegation, unrelated worktree/session mutation or administration tools, unknown, and unapproved tools remain denied
- **AND** worker MCP access stays limited to reviewed Firecrawl, Context Mode, and paper-search tools, without Hindsight; existing read, discovery, and web tools remain available
- **AND** Write retains its existing requested-artifact edit scope

#### Scenario: Native browser skill is advertised but denied at execution

- **WHEN** the native 2.2.0 browser plugin appends its scoped `skill:browser` deny
- **THEN** Scout, the research worker, and Build-backed Write MAY advertise the native `skill` tool
- **AND** execution of the scoped browser skill SHALL remain denied for those roles
- **AND** skill content, including a sentinel, SHALL never be delivered to those roles
- **AND** restricted reviewers SHALL remain strictly tool-less, with no `execute` or `skill` tool

### Requirement: Permit only exact on-demand reasoning subagents to Scout

Only Scout SHALL receive exact hidden native targets `chat-reasoning-critic`
and `chat-reasoning-verifier`. Each MAY be called once per warranted turn.
They SHALL use the generation-pinned native effective DEFAULT model and return
bounded output; other agents SHALL not receive them, and no AF route is exposed.

#### Scenario: Scout invokes an exact reviewer when warranted

- **WHEN** Scout delegates to exact `chat-reasoning-critic` or
  `chat-reasoning-verifier` for a warranted turn
- **THEN** only the selected hidden subagent MAY return its validated bounded
  result
- **AND** no role SHALL be called more than once during that turn

#### Scenario: The target or caller is not permitted

- **WHEN** Scout names a non-exact reviewer target, or Write, the research
  worker, or another agent requests either reasoning subagent
- **THEN** delegation SHALL be denied and no child session SHALL be created

#### Scenario: A reasoning subagent attempts tool or nested authority

- **WHEN** either reviewer attempts `execute`, file, MCP, web, AF, Hindsight,
  shell, plugin, package, terminal, or further delegation access
- **THEN** the effective native V2 policy SHALL deny the request
- **AND** unbounded or malformed reviewer output SHALL not be returned as a
  valid result

#### Scenario: Native default model resolution governs reviewer readiness

- **WHEN** OpenCode resolves its effective DEFAULT model through the native
  location-bound API for the current connection generation
- **THEN** the reviewers SHALL use that result, honoring a configured default
  without requiring a literal top-level `model` field
- **AND** null, malformed, or failed resolution SHALL be visibly unavailable
  with a fixed reason; no Scribe setting/config write, arbitrary catalog
  fallback, or Scribe UI-selected model SHALL be used
