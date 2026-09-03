## ADDED Requirements

### Requirement: Reviewed credential leaves are protected

When Chat sandboxing is enabled on a supported macOS or Linux environment, the
static protected-read baseline SHALL additionally deny the following
home-relative credential or private-key paths to the companion and its complete
process tree:

- `.claude.json`
- `.claude/.credentials.json`
- `.codex/auth.json`
- `.gemini/oauth_creds.json`
- `.electrum`
- `.android/adbkey`
- `.android/adbkey.pub`

The baseline SHALL preserve the existing platform-aware normalization,
deduplication, deterministic ordering, descendant inheritance, and fail-closed
overlap validation. These additions SHALL remain narrow paths and SHALL NOT be
replaced by a whole-home, generic configuration, or generic application-data
deny.

The baseline SHALL NOT deny the OpenCode configuration root or the provider
authentication path required by the companion. Required OpenCode configuration,
authentication, state, cache, workspace, executable, runtime, and temporary
access SHALL remain available when non-conflicting with the protected baseline.

#### Scenario: macOS denies the reviewed credential leaves

- **WHEN** Chat sandboxing is enabled on macOS
- **THEN** the companion SHALL receive the home-relative paths `.claude.json`,
  `.claude/.credentials.json`, `.codex/auth.json`, `.gemini/oauth_creds.json`,
  `.electrum`, `.android/adbkey`, and `.android/adbkey.pub` in its
  protected-read baseline
- **AND** reads of those paths SHALL fail at the sandbox boundary
- **AND** the baseline SHALL not deny the home directory, generic application
  support, or generic configuration parents

#### Scenario: Linux denies the reviewed credential leaves

- **WHEN** Chat sandboxing is enabled on Linux
- **THEN** the companion SHALL receive the same cross-platform reviewed
  credential and private-key paths in its protected-read baseline
- **AND** reads of those paths SHALL fail at the sandbox boundary
- **AND** macOS-only paths SHALL not be introduced by this addition

#### Scenario: Protected leaves are inherited by local MCP descendants

- **WHEN** a local MCP or a descendant of the companion attempts to read one of
  the reviewed credential leaves
- **THEN** the read SHALL fail under the inherited sandbox boundary
- **AND** the MCP identity or descendant relationship SHALL not grant an
  exception

#### Scenario: OpenCode authentication remains usable

- **WHEN** a sandboxed companion reads the required OpenCode configuration or
  provider-authentication data outside the reviewed protected leaves
- **THEN** the required read SHALL remain available
- **AND** the policy SHALL not deny the OpenCode configuration root or broaden a
  conflicting grant to the home directory

#### Scenario: Non-conflicting compatibility remains available

- **WHEN** an active workspace, installed runtime, executable, cache,
  temporary path, or local MCP dependency does not overlap a reviewed protected
  leaf
- **THEN** the existing compatibility read and write behavior SHALL remain
  available
- **AND** Write SHALL retain its existing workspace-scoped editing capability
- **AND** Scout and Write agent permissions SHALL remain unchanged

### Requirement: Host-side sandbox denial diagnostics

When supported Chat sandboxing is active, the extension host SHALL record a
bounded and redacted diagnostic for sandboxed companion startup/readiness
failures, unexpected companion exits, and failed MCP operations when diagnostic
information is available. The record SHALL identify the relevant stage or
operation and SHALL preserve the underlying runtime or operating-system denial
reason, such as an exposed `EPERM`, `EACCES`, `Operation not permitted`,
`permission denied`, or equivalent stderr/violation/SDK error. An opaque error
provided without an underlying reason SHALL be recorded as opaque; the
extension SHALL NOT invent a more specific cause.

The host-side diagnostic SHALL use the existing secret-safety behavior and SHALL
NOT record file contents, credential values, authorization material, request
payloads, or unredacted environment/configuration data. Existing user-visible
sandbox and MCP diagnostics SHALL remain bounded, redacted, transport-aware,
and available without retrying outside the sandbox or widening filesystem
permissions.

#### Scenario: Startup denial is recorded with its available reason

- **WHEN** a supported sandboxed companion fails initialization or readiness
  because the runtime exposes a filesystem denial
- **THEN** the extension host SHALL record the startup/readiness stage and the
  exposed denial reason
- **AND** the record SHALL be bounded and redacted
- **AND** Chat SHALL remain unavailable without an unsandboxed retry

#### Scenario: MCP denial is recorded with operation context

- **WHEN** a sandboxed local or remote MCP operation fails and the SDK, child
  output, or sandbox violation store exposes a denial reason
- **THEN** the extension host SHALL record the MCP operation context and the
  available denial reason
- **AND** local child, remote, and in-process failures SHALL retain their
  existing attribution distinctions
- **AND** the companion policy SHALL not be broadened to recover from the
  failure

#### Scenario: Opaque errors are not misrepresented

- **WHEN** a sandbox or file-access broker reports only an opaque error without
  an underlying operating-system reason
- **THEN** the extension host SHALL record the bounded opaque error as provided
- **AND** it SHALL not claim that a specific filesystem denial occurred
- **AND** it SHALL not log additional secret or payload data while attempting to
  diagnose the error

#### Scenario: Diagnostic logging does not expose secrets

- **WHEN** captured stderr, stdout, SDK errors, or violation records contain
  credentials, authorization material, environment configuration, or payload
  data alongside a denial reason
- **THEN** the host-side record and user-visible diagnostic SHALL redact those
  values
- **AND** the captured diagnostic SHALL remain bounded
- **AND** the denial reason and safe operation context SHALL remain available
