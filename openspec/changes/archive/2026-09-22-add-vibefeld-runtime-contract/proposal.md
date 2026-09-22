## Why

The first Vibefeld change establishes an unavailable manual review surface, but it
intentionally proves nothing about the external `af` runtime. Before Scribe can
add a runtime bridge, it needs version-pinned observations and a separate process
boundary contract; otherwise command syntax, output shape, filesystem effects,
and failure handling would be guessed from documentation and could widen the
existing Chat authority boundary.

## What Changes

- Add a private, platform-owned runtime-contract module for sanitized AF evidence
  and the requirements a later bridge must satisfy.
- Capture the installed AF executable identity and observed, versioned JSON
  behavior in checked-in fixtures, including workspace initialization, read-only
  status/schema output, workspace layout, and representative non-zero results.
- Add pure fixture loading, normalization, and validation that rejects unbounded
  output, private paths, secrets, raw prompts, and provider data that is not
  explicitly sanitized.
- Record a dedicated macOS/Linux process-boundary contract: fixed executable and
  typed argv only, `shell: false`, extension-storage review roots, descendant
  confinement, bounded output, timeout/cancellation cleanup, and fail-closed
  behavior.
- Add negative tests proving that this phase does not discover or launch AF and
  does not alter the existing unavailable review controller or Chat authority.

### Scope and Non-Goals

This is a phase-0 evidence and contract change. It does not add a subprocess
runner, runtime discovery during activation, a proof workspace creator, a
Settings control, an AF operation bridge, claim-graph projection, model or
subagent integration, response gating, or persistence of user review data.
The checked-in fixtures are sanitized observations only; they are not a license
to execute any command in production.

It does not modify `packages/core`, `IAgent`, OpenCode overlays, plugin sources,
MCP servers, Scout/Write/worker permissions, the current Chat sandbox, the
independent TUI, global OpenCode configuration, or user nono profiles.

## Capabilities

### New Capabilities

- `vibefeld-runtime-contract`: Captures version-pinned AF evidence and defines
  the non-executing dedicated process-boundary contract required before a future
  runtime bridge can be enabled.

### Modified Capabilities

None.

## Impact

- Affected code: private platform-side Vibefeld contract types, fixture
  validation helpers, sanitized AF fixtures, and focused extension-host tests.
- Affected behavior: no normal Chat, Write, review-card, reasoning-streaming,
  sandbox, or TUI behavior changes; the existing review controller remains
  unavailable and non-executing.
- Dependencies: no AF package is added to the repository and no new runtime
  dependency is introduced. Fixture capture may use an externally installed AF
  binary, but CI replays checked-in data only.
- Security: the contract keeps AF-specific paths and CLI details out of core,
  distinguishes observed facts from future approved operations, and fails closed
  when evidence or boundary enforcement is missing, stale, malformed, or
  unsupported.
