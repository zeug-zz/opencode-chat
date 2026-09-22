## Purpose

Capture evidence about the installed AF runtime and define the dedicated,
non-executing process-boundary contract required before Scribe can add an AF
runtime bridge.

## ADDED Requirements

### Requirement: Pin runtime evidence to an observed AF build

The system SHALL represent AF runtime evidence with a versioned fixture schema,
executable name, exact AF version/build identity, capture platform, and observed
workspace format. A fixture SHALL be accepted as compatible only when its
identity and schema match the contract under test. Documentation-only claims
SHALL NOT add executable operations, flags, output fields, exit categories,
workspace behavior, or runtime paths to the approved contract.

#### Scenario: The checked-in fixture identifies the observed runtime

- **WHEN** the fixture corpus is loaded
- **THEN** it SHALL identify AF as executable `af` at observed version `0.1.7`
  with its captured build identity and workspace format `1.0`
- **AND** the fixture SHALL identify the capture platform without recording a
  host-specific executable path
- **AND** the fixture SHALL remain evidence only, with no approved production
  operation enabled by fixture loading

#### Scenario: Runtime identity or fixture schema does not match

- **WHEN** a fixture has an unsupported schema, version, build identity, or
  platform
- **THEN** validation SHALL return an incompatible/unavailable result
- **AND** no operation or runtime path SHALL be inferred from the mismatched
  fixture

#### Scenario: Documentation contains an unobserved operation

- **WHEN** a command, flag, output field, exit category, or workspace behavior
  appears only in documentation and not in an observed fixture
- **THEN** it SHALL remain unapproved
- **AND** the contract SHALL not expose it as executable capability

### Requirement: Store only bounded and sanitized fixture evidence

The fixture corpus SHALL use bounded, normalized records. Command observations
SHALL use argv arrays rather than shell command strings. Fixture paths SHALL be
relative placeholders within a declared disposable workspace. Validation SHALL
reject absolute paths, parent traversal, executable or workspace overrides,
secrets, authorization material, raw prompts, source packets, private model
reasoning, unbounded output, and unrestricted logs.

#### Scenario: Sanitized observed output is replayable

- **WHEN** a checked-in fixture contains a bounded parsed JSON result and a
  normalized workspace tree
- **THEN** pure fixture validation SHALL accept it without invoking AF
- **AND** replay SHALL preserve the observed fields needed for a later contract
  review without exposing a host path or raw user content

#### Scenario: Fixture contains unsafe data

- **WHEN** a fixture contains a secret-like value, an absolute or escaping path,
  a shell command string, an unbounded output field, or raw prompt/reasoning
  content
- **THEN** validation SHALL reject the fixture
- **AND** the result SHALL be incompatible/unavailable rather than partially
  accepting the unsafe record

### Requirement: Preserve exact observed command and failure facts

The fixture contract SHALL retain exact observed argv values (with approved
fixture placeholders), parsed output shape, workspace effects, exit code,
signal, timeout, and cancellation facts when those facts were observed. It
SHALL distinguish observed facts from policy requirements and SHALL NOT invent
an exit mapping or success result for an unobserved failure mode.

#### Scenario: Observed command succeeds with bounded JSON

- **WHEN** an observed AF command returns exit code `0` and its normalized JSON
  matches the versioned fixture shape
- **THEN** validation SHALL preserve it as an observed success
- **AND** it SHALL not make that command available to production execution in
  this phase

#### Scenario: Non-zero, malformed, oversized, timed-out, cancelled, or signaled

- **WHEN** an observed or future runtime result is non-zero, malformed,
  oversized, timed out, cancelled, or signal-terminated
- **THEN** the contract SHALL classify it as a bounded non-success such as
  unavailable or audit-failed
- **AND** it SHALL never synthesize a structural review status from that result

### Requirement: Define a dedicated descendant-enforced process boundary

A future AF runtime bridge SHALL use an OS process policy separate from the
existing Chat companion sandbox. The policy SHALL apply to AF and every
 descendant, use a fixture-approved executable with direct typed argv and
`shell: false`, and resolve each review workspace beneath extension global
storage outside the repository, home directory, OpenCode state, and sibling
review workspaces. The policy SHALL protect against path traversal, symlink or
rename escape, arbitrary child execution, and writes outside the review root.

#### Scenario: A future review requests a proof workspace

- **WHEN** a later bridge prepares a review workspace
- **THEN** it SHALL derive a unique review root beneath
  `context.globalStorageUri`
- **AND** that root SHALL not overlap the repository, home directory, OpenCode
  state, or another session/review root
- **AND** the current Chat sandbox SHALL not be used as a substitute

#### Scenario: AF starts a descendant process or attempts an escape

- **WHEN** AF or one of its descendants reads/writes outside the approved
  runtime and review-root grants, follows an escaping symlink, renames a path
  outside the root, or starts an unapproved child
- **THEN** the dedicated policy SHALL deny the action for the complete process
  tree
- **AND** the bridge SHALL report an unavailable/audit-failed result without
  weakening the policy or retrying in the Chat sandbox

### Requirement: Require bounded, cancellable, fail-closed execution before enablement

A future bridge SHALL bound input and stdout/stderr, enforce an operation-specific
timeout, cancel and reap the complete descendant process tree, and discard raw
child output from diagnostics. Missing or ambiguous policy support, unsupported
platforms, fixture mismatch, malformed output, timeout, cancellation, signal
exit, cleanup failure, or audit failure SHALL leave the runtime unavailable or
unverified. This phase SHALL document the contract but SHALL not claim that it
is enforced.

#### Scenario: Boundary prerequisites are missing

- **WHEN** the executable, approved fixture, dedicated policy, supported platform,
  or required runtime read grants are missing or ambiguous
- **THEN** the runtime SHALL remain unavailable/incompatible
- **AND** Scribe SHALL not fall back to the active-workspace Chat sandbox for AF

#### Scenario: A review is cancelled or times out

- **WHEN** a future AF operation is cancelled or exceeds its bounded timeout
- **THEN** the bridge SHALL terminate and reap AF and all descendants
- **AND** it SHALL return a bounded non-success without retrying with weaker
  limits or publishing raw child output

### Requirement: Keep AF host-owned and outside model/configuration authority

The contract SHALL expose no model-controlled executable, workspace, environment,
command verb, flag, or raw argv input. AF SHALL not be added as an OpenCode
plugin, MCP server, custom tool, or `pluginSources` entry. Scribe SHALL not
create, modify, promote, or broaden global OpenCode configuration, AF
configuration, nono profiles, or user sandbox profiles.

#### Scenario: A model or ordinary Chat request asks to run AF

- **WHEN** a model or normal Chat path requests an AF operation
- **THEN** no model-visible execution tool or plugin route SHALL exist
- **AND** the current unavailable review controller SHALL remain the only
  production review path

#### Scenario: Runtime setup would require user configuration changes

- **WHEN** enabling AF would require editing OpenCode config, AF config, a nono
  profile, or a user sandbox profile
- **THEN** this phase SHALL refuse to enable the runtime
- **AND** it SHALL leave those files and the existing Chat authority unchanged

### Requirement: Preserve ordinary Scribe behavior during the contract phase

Loading or validating the AF contract SHALL not run during extension activation or
ordinary Chat operation. Existing Chat, Write, Scout, worker, MCP, reasoning
streaming, companion sandboxing, unavailable review fallback, and independent
TUI behavior SHALL remain unchanged. CI and normal tests SHALL replay fixtures
only and SHALL not require an AF binary.

#### Scenario: Extension activation and ordinary review remain unavailable

- **WHEN** the extension activates or a user requests the scaffold's manual
  review action
- **THEN** production code SHALL not resolve or spawn AF, create a proof
  workspace, or write runtime state
- **AND** the unavailable controller SHALL return its existing bounded fallback

#### Scenario: Fixture tests run without AF installed

- **WHEN** the focused or full test suite runs in an environment without the AF
  binary
- **THEN** fixture validation and regression tests SHALL still run from
  checked-in data
- **AND** no test SHALL invoke a shell, process-spawn API, or live AF command
