## MODIFIED Requirements

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

## ADDED Requirements

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
