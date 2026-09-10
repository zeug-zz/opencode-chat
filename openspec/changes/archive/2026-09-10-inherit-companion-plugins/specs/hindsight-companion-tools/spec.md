## MODIFIED Requirements

### Requirement: Load only the approved Hindsight integration

The companion MAY load the complete native OpenCode plugin surface for the
active global/project configuration, but it SHALL identify at most one Hindsight
integration by the exact approved Hindsight coding-agent package identity. The
Hindsight resolver SHALL inspect configuration metadata without executing plugin
code and SHALL use the approved identity only to derive Hindsight-specific
capabilities, lifecycle policy, sandbox paths, and exact tool permissions. Other
inherited plugins SHALL not be treated as Hindsight or receive Hindsight
authority.

#### Scenario: Approved Hindsight entry is configured with other plugins

- **WHEN** the effective OpenCode configuration contains the approved Hindsight
  entry and unrelated user plugins
- **THEN** the companion MAY load the native plugin set
- **AND** only the exact approved Hindsight entry SHALL participate in Hindsight
  capability detection and retention policy
- **AND** the independent TUI configuration SHALL remain unchanged

#### Scenario: Hindsight-like but unapproved entry is configured

- **WHEN** a configured plugin name or path merely contains a Hindsight-like
  string but does not resolve to the exact approved package
- **THEN** the companion SHALL not expose Hindsight tools for that entry
- **AND** normal Chat/Write operation and other native plugin loading SHALL
  remain governed by their own boundaries

#### Scenario: Approved Hindsight entry is configured

- **WHEN** the effective OpenCode configuration contains the exact approved
  Hindsight entry
- **THEN** the resolver SHALL identify that entry without executing plugin code
- **AND** Hindsight capability detection SHALL remain limited to that entry
- **AND** unrelated inherited plugins SHALL not receive Hindsight authority

### Requirement: Integrate with sandbox policy without weakening it

When the companion is sandboxed, Hindsight and all other inherited plugins SHALL
use the generic compatibility filesystem policy. The integration SHALL not grant
the home-directory root, broad credential directories, unrestricted writes, or a
plugin-specific write exception. Hindsight-specific provider paths may continue
to participate in exact capability verification, but failure to satisfy them
shall disable only the Hindsight capability and SHALL not weaken the sandbox or
prevent plugin-free ordinary Chat/Write fallback.

#### Scenario: Hindsight and other plugins share compatibility policy

- **WHEN** inherited plugins are loaded in a sandboxed companion
- **THEN** their source/dependency reads SHALL use compatibility semantics
- **AND** Hindsight tool permissions SHALL still depend on exact observed
  capabilities and tools
- **AND** protected-path conflicts SHALL not trigger an unsandboxed retry

#### Scenario: Exact provider paths are safe to grant

- **WHEN** the approved provider's required runtime/configuration paths pass the
  existing sandbox checks
- **THEN** the provider MAY use those paths under the generic compatibility
  policy
- **AND** protected denies and constrained writes SHALL remain in force

#### Scenario: Provider path cannot be safely granted

- **WHEN** a required provider path is missing, unsafe, or conflicts with a
  protected deny-read path
- **THEN** the Hindsight capability SHALL be unavailable or blocked
- **AND** ordinary Chat/Write behavior SHALL remain available without weakening
  the sandbox or retrying unsandboxed
