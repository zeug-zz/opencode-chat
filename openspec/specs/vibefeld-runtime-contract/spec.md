# vibefeld-runtime-contract Specification

## Purpose
Capture evidence about the installed AF runtime and define the dedicated,
non-executing process-boundary contract required before Scribe can add an AF
runtime bridge.

## Requirements

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

### Requirement: Define direct AF execution without a nested sandbox

The AF runtime bridge SHALL run AF directly as a bounded child process of the
extension host under whatever enclosing sandbox the user's session already has,
and SHALL cross the execution boundary with a descriptor limited to
`{ executable, argv, cwd }`. The policy adapter SHALL report readiness
`{ state: "ready", execution: "direct" }` only from a host-resolved executable
that satisfies the pinned compatibility contract on a supported macOS/Linux
host, and SHALL execute with the fixed host-owned argv, `shell: false`, a
detached process group, an allowlisted environment, and bounded
stdin/stdout/stderr. AF SHALL NOT be wrapped in a `nono` profile, a wrapper, or
any second sandbox, and there SHALL be no runtime grants, no denied domains, and
no audit verification. The review workspace remains only AF's working directory
for review scratch, and direct execution is the only execution path.

#### Scenario: A future review requests a proof workspace

- **WHEN** a later bridge prepares a review workspace
- **THEN** it SHALL derive a unique review root beneath
  `context.globalStorageUri`
- **AND** that root SHALL not overlap the repository, home directory, OpenCode
  state, or another session/review root
- **AND** the current Chat sandbox SHALL not be used as a substitute
- **AND** the root SHALL be passed to AF only as the working directory, with no
  isolation guarantee claimed

#### Scenario: AF starts a descendant process or attempts an escape

- **WHEN** the bridge launches or tears down AF
- **THEN** AF SHALL run directly as a bounded child process with no `nono`
  invocation, profile flag, wrapper, or second sandbox
- **AND** the bridge SHALL terminate and reap AF and SHALL report a bounded
  non-success without retrying outside the direct execution path

### Requirement: Require bounded, cancellable, fail-closed execution before enablement

A future bridge SHALL bound input and stdout/stderr, enforce an operation-specific
timeout, cancel and reap AF and its process group, and discard raw child output
from diagnostics. Missing or ambiguous compatibility, unsupported platforms,
fixture mismatch, malformed output, timeout, cancellation, signal exit, or
cleanup failure SHALL leave the runtime unavailable or unverified. Direct
execution is the only execution path, so no retry outside it exists. This
phase SHALL document the contract but SHALL not claim that it is enforced.

#### Scenario: Boundary prerequisites are missing

- **WHEN** the executable, approved fixture, supported platform, or compatibility
  evidence is missing or ambiguous
- **THEN** the runtime SHALL remain unavailable/incompatible
- **AND** Scribe SHALL not fall back to the active-workspace Chat sandbox or any
  nested sandbox for AF

#### Scenario: A review is cancelled or times out

- **WHEN** a future AF operation is cancelled or exceeds its bounded timeout
- **THEN** the bridge SHALL terminate and reap AF and its process group
- **AND** it SHALL return a bounded non-success without retrying with weaker
  limits or publishing raw child output

### Requirement: Keep AF host-owned and outside model/configuration authority

The contract SHALL expose no model-controlled executable, workspace, environment,
command verb, flag, or raw argv input. AF SHALL not be added as an OpenCode
plugin, MCP server, custom tool, or `pluginSources` entry. Scribe SHALL not
create, modify, promote, or broaden global OpenCode configuration, AF
configuration, nono profiles, or user sandbox profiles, and SHALL select,
persist, and verify no AF profile: direct execution needs no profile, no runtime
grants, and no denied-domain attestation. Scribe MUST NOT write AF or OpenCode
configuration.

#### Scenario: A model or ordinary Chat request asks to run AF

- **WHEN** a model or normal Chat path requests an AF operation
- **THEN** no model-visible execution tool or plugin route SHALL exist
- **AND** only the host-owned activation path may resolve and preflight AF, and only when the pinned identity and direct execution readiness are present

#### Scenario: Runtime setup would require user configuration changes

- **WHEN** enabling AF would require editing OpenCode config, AF config, or a
  user sandbox profile, selecting a nono profile, or creating a second sandbox
- **THEN** production code SHALL refuse to enable the runtime and remain dormant
- **AND** it SHALL leave those files and the existing Chat authority unchanged

#### Scenario: Direct execution needs no profile

- **WHEN** the runtime enables direct execution on a supported host
- **THEN** Scribe SHALL select, persist, and verify no AF or nono profile
- **AND** readiness SHALL derive only from resolved compatibility and a valid
  fixed executable

### Requirement: Preserve ordinary Scribe behavior during the contract phase

Loading or validating the AF contract SHALL not run per message during ordinary
Chat operation. Existing Chat, Write, Scout, worker, MCP, reasoning streaming,
companion sandboxing, unavailable review fallback, and independent TUI behavior
SHALL remain unchanged when AF is absent, incompatible, or unsupported, or when
direct execution readiness is unavailable. Activation MAY resolve and preflight
the pinned runtime at most once per extension activation on supported macOS/Linux
hosts when a compatible executable is present, using direct execution with no
profile, grant, or policy preflight. CI and default test suites SHALL replay
fixtures or injected seams only and SHALL not require an AF binary or any nono
installation; live capture requires an explicit opt-in documented by the
activation change.

#### Scenario: Extension activation and ordinary review remain unavailable

- **WHEN** the extension activates and AF is absent, incompatible, or unsupported, or direct execution readiness is unavailable
- **THEN** production code SHALL not spawn AF or create a proof workspace
- **AND** the unavailable controller SHALL return its existing bounded fallback after at most one nonfatal preflight attempt

#### Scenario: Fixture tests run without AF installed

- **WHEN** the focused or full test suite runs in an environment without the AF
  binary
- **THEN** fixture validation, injected-seam, and regression tests SHALL still run from checked-in data
- **AND** no default test SHALL invoke a shell, process-spawn API, or live AF command
