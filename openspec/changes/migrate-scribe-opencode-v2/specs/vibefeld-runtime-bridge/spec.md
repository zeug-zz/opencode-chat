## MODIFIED Requirements

### Requirement: Preflight the pinned runtime before execution
**Traceability ID: AF1**

The bridge SHALL run only on a supported macOS or Linux host and SHALL require a host-resolved executable whose bounded live version/schema results satisfy the current source compatibility contract: supported AF `0.1.x` version line, format `1.1`, required bounded/safe version fields, and recognized live schema. Commit, build date, Go version, and policy values SHALL be recorded only as host-private metadata and SHALL NOT be exact-match gates. Fixture identity/schema SHALL remain test evidence only, not a production pin. Missing executable, unsupported platform, malformed output, timeout, non-zero exit, signal exit, fixture-shaped evidence, or incomplete direct-execution readiness SHALL produce an unavailable or incompatible result without enabling an operation. Readiness SHALL require only compatibility and the existing host-owned direct-execution adapter; it SHALL NOT require a separate AF policy, grant, denied-domain, profile, or policy preflight. This migration does not upgrade or otherwise change the supported AF runtime contract.

#### Scenario: The resolved AF runtime matches the contract
- **WHEN** the host resolves an executable and its bounded live version/schema preflight meets the current `0.1.x` and format `1.1` compatibility contract with all required safe fields
- **THEN** the bridge SHALL report a compatible runtime only after direct-execution readiness is established
- **AND** it SHALL keep observed compatibility metadata host-private without exact-matching commit/build/Go/policy values or exposing executable paths or raw preflight output

#### Scenario: Runtime preflight cannot establish compatibility
- **WHEN** the executable is absent, the platform is unsupported, the output is malformed/oversized, the identity differs, direct execution is unavailable, or a preflight operation fails
- **THEN** the bridge SHALL report unavailable or incompatible
- **AND** it SHALL not execute initialization or status operations, create a review root, or retry outside direct execution

### Requirement: Allocate and protect dedicated proof roots
**Traceability ID: AF2**

Each runtime review workspace SHALL be unique, session-scoped, and located beneath the VS Code extension's global storage root. The writable root SHALL not be the repository, the home-directory root, OpenCode state, or another review root. Allocation and cleanup SHALL retain symlink, traversal, rename, containment, and ambiguous real-path checks, and SHALL not persist source packets, prompts, private reasoning, credentials, or raw child logs. The proof root is a path-safety boundary only; it SHALL NOT be described as an OS grant or AF process-containment guarantee.

#### Scenario: A review workspace is allocated
- **WHEN** a compatible bridge requests an AF workspace
- **THEN** the host SHALL create a unique descendant of `context.globalStorageUri`
- **AND** the root SHALL remain path-safe and isolated from the repository, OpenCode state, and other session/review roots
- **AND** the root SHALL be used as the AF working directory without implying a dedicated OS policy or containment guarantee

#### Scenario: A workspace path can escape the review root
- **WHEN** allocation or cleanup observes an absolute/parent-traversal path, symlinked root/ancestor, rename outside the root, root overlap, or failed real-path containment check
- **THEN** the bridge SHALL fail closed and report an audit/unavailable result
- **AND** it SHALL not follow, delete, or grant the escaping path

### Requirement: Enforce a dedicated descendant process boundary
**Traceability ID: AF3**

AF SHALL run as a fixed, host-owned bounded direct child under whatever enclosing sandbox is already present. The adapter SHALL add no nested nono, separate AF OS policy, AF profile, policy/grant/denied-domain preflight, or new containment guarantee. It SHALL preserve the supported fixed operations, `shell: false`, bounded I/O/timeouts, cancellation, process cleanup, proof-root path safety, and host/model/configuration authority boundaries.

#### Scenario: AF or a descendant attempts an unauthorized action
- **WHEN** AF or a descendant attempts an action rejected by the fixed host-owned operation or path-safety checks
- **THEN** the bridge SHALL return a bounded non-success
- **AND** it SHALL not claim AF-specific OS containment or denied-domain guarantees from the enclosing sandbox

#### Scenario: Only the Chat sandbox is available
- **WHEN** the extension can provide its existing Chat sandbox and direct-execution readiness without an AF-specific policy
- **THEN** the bridge SHALL remain eligible when runtime compatibility and direct-execution readiness pass
- **AND** it SHALL not require, create, query, or configure a separate AF policy, profile, grant, denied-domain preflight, or nested sandbox

### Requirement: Gate live integration tests behind disposable explicit inputs
**Traceability ID: AF4**

Integration tests that resolve or spawn AF SHALL require explicit opt-in, an explicitly selected disposable AF executable/runtime, and a disposable workspace. Default focused and full suites SHALL replay checked-in fixtures or injected fakes only, use project-relative artifacts, clean bounded state, and skip safely when live inputs are absent. AF-specific policy validation is not required; any enclosing sandbox remains whatever the test environment already supplies.

#### Scenario: Default test execution has no live runtime inputs
- **WHEN** the normal test suite runs without the opt-in flag and disposable runtime/workspace inputs
- **THEN** no AF process, shell, network request, user profile, or global configuration write SHALL occur
- **AND** fixture and boundary tests SHALL still verify compatibility, path safety, bounded direct execution, and failure behavior

#### Scenario: Explicit disposable integration inputs are supplied
- **WHEN** the opt-in flag, selected disposable runtime, and disposable workspace are supplied
- **THEN** integration tests MAY launch only the fixed operations inside project-local disposable artifacts under the existing enclosing sandbox, if any
- **AND** tests SHALL assert bounded output, cancellation/cleanup, path-safety checks, no policy fallback, and no leakage of raw paths or payloads
