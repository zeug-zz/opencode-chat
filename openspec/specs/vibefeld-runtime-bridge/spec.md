# vibefeld-runtime-bridge Specification

## Purpose
Provide a host-owned, fixture-derived AF execution boundary that can be used by later claim projection without exposing arbitrary process, workspace, or configuration authority to models or ordinary Chat paths.

## Requirements

### Requirement: Restrict bridge operations to the observed fixed union

The runtime bridge SHALL expose only the fixture-approved operations `version`,
`schema`, `init`, `claim`, `refine`, and `status`. The `claim` and `refine`
shapes SHALL be derived from the sanitized AF 0.1.11 capture set in this change,
not from documentation or inference. Each operation SHALL have a typed input
shape, a bounded input size, a deterministic argv builder, and a versioned
JSON/result parser. Callers SHALL NOT provide a shell command, executable path,
workspace path, arbitrary verb, arbitrary flag, environment override,
interactive mode, raw argv, node identifier, owner identity, or statement; node
identifiers, statements, and the projection owner identity SHALL be host-owned
and bounded. The `claim` and `refine` operations SHALL remain unavailable until
a successful initialization in the current review root.

#### Scenario: A supported operation is encoded from typed input

- **WHEN** the host requests a supported version, schema, initialization,
  claim, refine, or status operation
- **THEN** the bridge SHALL construct the corresponding observed argv shape
  with the host-resolved executable and internally owned review root
- **AND** it SHALL invoke the operation with `shell: false`
- **AND** the operation SHALL remain unavailable if its fixture schema or
  runtime identity is not supported

#### Scenario: A claim or refine input exceeds the observed bounds

- **WHEN** a node identifier, statement, owner, or chunked statement count is
  absent, malformed, unsafe, or outside the fixed argv and argument limits
- **THEN** the bridge SHALL reject the request before process creation without
  truncating or reinterpreting the input

#### Scenario: An unapproved operation or argument is requested

- **WHEN** a caller requests an unobserved verb such as `get`, a
  shell/interactive mode, an executable or workspace override, an unknown flag,
  or raw argv
- **THEN** the bridge SHALL reject the request before process creation
- **AND** it SHALL not reinterpret the request as a supported operation or
  retry it through Chat, a plugin, MCP, or a model-visible tool

### Requirement: Preflight the pinned runtime before execution

The bridge SHALL run only on a supported macOS or Linux host and SHALL require a host-resolved executable whose bounded version and schema results match the pinned AF identity, fixture schema, and workspace format `1.0`. Missing executable, unsupported platform, unavailable policy, malformed output, timeout, non-zero exit, signal exit, fixture mismatch, or incomplete boundary requirements SHALL produce an unavailable or incompatible result without enabling an operation.

#### Scenario: The resolved AF runtime matches the contract

- **WHEN** the host resolves an executable and its bounded version/schema preflight matches AF `0.1.7`, build identity `5a37413`, the captured build metadata, and workspace format `1.0`
- **THEN** the bridge SHALL report a compatible runtime only after the dedicated policy is ready
- **AND** it SHALL preserve the exact pinned identity in host-private state without exposing an executable path or raw preflight output

#### Scenario: Runtime preflight cannot establish compatibility

- **WHEN** the executable is absent, the platform is unsupported, the output is malformed/oversized, the identity differs, the policy is missing, or a preflight operation fails
- **THEN** the bridge SHALL report unavailable or incompatible
- **AND** it SHALL not execute initialization or status operations, create a review root, or downgrade to the active-workspace Chat sandbox or an unsandboxed child

### Requirement: Allocate and protect dedicated proof roots

Each runtime review workspace SHALL be unique, session-scoped, and located beneath the VS Code extension's global storage root. The writable root SHALL not be the repository, the home-directory root, OpenCode state, or another review root. Workspace allocation and cleanup SHALL reject symlink, traversal, rename, containment, and ambiguous real-path conditions, and SHALL not persist source packets, prompts, private reasoning, credentials, or raw child logs.

#### Scenario: A review workspace is allocated

- **WHEN** a compatible bridge requests an AF workspace
- **THEN** the host SHALL create a unique descendant of `context.globalStorageUri`
- **AND** only that review root SHALL be offered as a writable workspace to the dedicated process policy
- **AND** the root SHALL remain isolated from the repository, OpenCode state, and other session/review roots

#### Scenario: A workspace path can escape the review root

- **WHEN** allocation or cleanup observes an absolute/parent-traversal path, symlinked root/ancestor, rename outside the root, root overlap, or failed real-path containment check
- **THEN** the bridge SHALL fail closed and report an audit/unavailable result
- **AND** it SHALL not follow, delete, or grant the escaping path

### Requirement: Enforce a dedicated descendant process boundary

AF and every descendant process SHALL run under a dedicated OS policy separate from the Chat companion policy. The policy SHALL allow only the host-resolved fixed executable, required read-only runtime files, and the allocated review root; deny repository/home/OpenCode-state/sibling-root writes, unapproved child execution, and path escapes; and preserve direct argv with `shell: false`. If the platform cannot prove this policy is active, the bridge SHALL not start AF.

#### Scenario: AF or a descendant attempts an unauthorized action

- **WHEN** AF or a descendant attempts to write outside the review root, follow an escaping symlink, rename a path outside the root, read a denied domain, or start an unapproved child
- **THEN** the dedicated policy SHALL deny the action for the complete process tree
- **AND** the bridge SHALL return an audit-failed or unavailable result without weakening the policy or retrying under Chat's broader workspace grants

#### Scenario: Only the Chat sandbox is available

- **WHEN** the extension can provide its existing Chat sandbox but no independently validated AF policy
- **THEN** the bridge SHALL remain unavailable
- **AND** it SHALL not reuse, reconfigure, reset, or query Chat's sandbox manager as an AF proof boundary

### Requirement: Bound execution, cancellation, and failure publication

The bridge SHALL bound operation input and stdout/stderr, enforce an operation-specific timeout, cancel and reap AF plus all descendants, and discard raw child output from diagnostics. Non-zero, malformed, oversized, timed-out, cancelled, signaled, policy, cleanup, and audit failures SHALL remain bounded non-success results with no synthesized structural review status.

#### Scenario: A bounded operation succeeds

- **WHEN** a fixed operation exits successfully within its limits and its JSON output matches the pinned parser
- **THEN** the bridge SHALL return normalized host-private facts for the requested operation
- **AND** it SHALL not expose raw output, workspace paths, ledger data, or a structural review claim to the webview or model

#### Scenario: An operation times out or is cancelled

- **WHEN** a fixed operation exceeds its timeout or is cancelled
- **THEN** the bridge SHALL terminate and reap AF and all descendants within a bounded cleanup window
- **AND** it SHALL return unavailable/audit-failed without retrying with weaker limits or publishing raw stdout/stderr

#### Scenario: Cleanup cannot be proven complete

- **WHEN** descendant termination, process reaping, workspace cleanup, or policy teardown fails
- **THEN** the bridge SHALL classify the result as audit-failed
- **AND** it SHALL refuse subsequent runtime operations until a fresh compatible boundary is established

### Requirement: Keep bridge authority host-owned and dormant for ordinary Chat

The bridge SHALL not be exposed as an OpenCode plugin, MCP server, custom tool, agent/task target, or model-controlled route. It SHALL not edit global OpenCode configuration, AF configuration, nono profiles, user sandbox profiles, or ordinary workspace files. After activation, `extension.ts` MAY construct the bridge and proof store beneath extension global storage and preflight the pinned runtime at most once per extension activation using direct execution; availability SHALL depend only on compatibility and direct execution readiness, with no grant, denied-domain, or policy preflight. A caller SHALL still be unable to supply an executable, workspace, environment, or argv value. The existing unavailable manual-review controller SHALL remain the review-result fallback whenever the runtime is not ready.

#### Scenario: Ordinary Chat or a model asks to run AF

- **WHEN** an ordinary prompt, model output, Scout, Write, worker, or MCP path asks to invoke AF
- **THEN** no bridge operation SHALL be available through that path
- **AND** the existing Chat, Write, Scout, worker, MCP, reasoning-streaming, and TUI authority boundaries SHALL remain unchanged

#### Scenario: The bridge is constructed without an explicit review request

- **WHEN** the extension activates on a supported host without a later claim-projection request
- **THEN** the host MAY construct the bridge, allocate the proof store beneath global storage, and preflight once
- **AND** a dormant or failed preflight SHALL leave the unavailable review flow and ordinary behavior unchanged

#### Scenario: Default activation and tests remain fixture-only

- **WHEN** the normal test suite runs or AF is absent
- **THEN** default activation and tests SHALL not require an AF binary, a nono installation or profile, network, or configuration mutation
- **AND** fixture and injected-seam tests SHALL still verify compatibility, bounded direct execution, and failure behavior

### Requirement: Gate live integration tests behind disposable explicit inputs

Integration tests that resolve or spawn AF SHALL require an explicit opt-in flag, an explicitly selected disposable AF executable/runtime, and an independently validated disposable policy. Default focused and full test suites SHALL replay checked-in fixtures or injected fakes only, use project-relative artifacts, clean up bounded state, and skip safely when live prerequisites are absent.

#### Scenario: Default test execution has no live runtime inputs

- **WHEN** the normal test suite runs without the opt-in flag and disposable runtime/policy inputs
- **THEN** no AF process, shell, network request, user profile, or global configuration write SHALL occur
- **AND** fixture and boundary tests SHALL still verify the bridge's compatibility, isolation, and failure behavior

#### Scenario: Explicit disposable integration inputs are supplied

- **WHEN** the opt-in flag, selected disposable runtime, and dedicated policy are all present and validated
- **THEN** integration tests MAY launch the fixed operations only inside project-local disposable artifacts
- **AND** the tests SHALL assert bounded output, descendant cleanup, denied escape/write behavior, no fallback, and no leakage of raw paths or payloads

### Requirement: Declare the claim projection capability explicitly

The bridge SHALL expose a side-effect-free capability report that is exactly
`{ supported: true, operation: "claim_projection" }` only when it contracts the
observed `claim` and `refine` operations, and SHALL otherwise report
unsupported. Capability discovery SHALL NOT preflight, spawn a process, allocate
a workspace, or read status. A ready preflight or a successful `init`/`status`
result alone SHALL NOT be treated as claim capability.

#### Scenario: A composed bridge is asked for its claim capability

- **WHEN** the host reads the bridge's capability without a preflight or review
  request
- **THEN** the report SHALL be a bounded frozen value with no path, version,
  executable, raw error, or workspace detail
- **AND** no process, workspace allocation, or status operation SHALL occur

### Requirement: Rotate the review root for each claim projection

Each claim projection SHALL run in a review root that no prior projection has
initialized. The bridge SHALL reuse the preflight-allocated root for the first
projection and, once a projection has initialized the current root, clean it up
and allocate a fresh contained review root before the next projection. A cleanup
or allocation failure SHALL fail closed as audit-failed and SHALL NOT be retried
with weaker containment.

#### Scenario: A second projection starts on a used review root

- **WHEN** the bridge begins a projection and its current review root already
  holds an initialized proof
- **THEN** the bridge SHALL remove only the still-contained current root and
  allocate a unique descendant of the extension global storage root
- **AND** the successful initialization, claim, refine, and status sequence
  SHALL run against the fresh root

#### Scenario: Review-root rotation cannot be proven safe

- **WHEN** cleanup or allocation observes a containment, symlink, rename, or
  filesystem failure
- **THEN** the bridge SHALL return an audit-failed result
- **AND** it SHALL refuse further runtime operations until a fresh compatible
  boundary is established
