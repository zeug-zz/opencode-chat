## Context

The preceding `add-vibefeld-runtime-contract` change keeps AF evidence private and non-executable. It establishes the pinned AF `0.1.7` observations and describes a dedicated macOS/Linux boundary, but it deliberately does not resolve a binary, create a proof root, or run a child. The existing Chat sandbox is a singleton companion boundary whose workspace grant is intentionally too broad for AF proof storage, so the bridge cannot reuse or reconfigure it.

See `proposal.md` for the motivation and `specs/vibefeld-runtime-bridge/spec.md` for the normative behavior. The bridge is infrastructure for the later claim-projection phase; it is intentionally not a replacement for the unavailable manual-review controller in this change.

## Goals / Non-Goals

**Goals:**

- Turn only the observed AF compatibility commands into a typed, bounded host operation surface.
- Preflight the pinned runtime and a separately validated process policy without exposing private paths or raw output.
- Own unique proof roots below extension global storage and fail closed on path ambiguity or cleanup failure.
- Provide a process-boundary adapter that can enforce descendant confinement, direct argv execution, bounded I/O, timeout, cancellation, and cleanup.
- Keep the bridge lazy and dormant for ordinary Chat, with deterministic fixture/fake tests and a separately gated live test path.

**Non-Goals:**

- Claim graph construction, AF claim mutation beyond the bounded compatibility initialization operation, evidence projection, status mapping, adversarial agents, automatic routing, or response gating.
- Replacing `UnavailableReasoningReviewController` or publishing a structural review result to the webview.
- Reusing the Chat `SandboxManager`, adding AF as a plugin/MCP/custom tool, changing `IAgent`, modifying core protocol types, or changing Scout/Write/worker permissions.
- Creating or editing nono/OpenCode/AF configuration, discovering arbitrary profiles, bundling AF, or guaranteeing Windows support.

## Decisions

### Keep the bridge platform-private and dormant

All AF-specific command, parser, workspace, and policy types stay under
`packages/platforms/vscode/src/vibefeld/`. The extension's current review
controller remains the unavailable implementation. The bridge is created only
by an explicit host integration or test; it is not loaded as runtime configuration
by ordinary activation and is not available through OpenCode permissions.

**Alternative rejected:** replacing the unavailable controller immediately. The
bridge cannot produce a calibrated review until claim projection and status
mapping exist, and reporting an `available` runtime beside an unavailable review
would mislead users.

### Derive commands from the pinned fixture, not documentation

`af-command-schema.ts` owns a closed operation union for `version`, `schema`, `init`,
and `status`. It accepts only bounded host-owned values for initialization and an
opaque internal workspace handle. It constructs argv arrays at the last possible
boundary; no public type carries a shell command, arbitrary flags, executable
selection, or user-selected path.

**Alternative rejected:** a generic `runAf(args: string[])` helper. It would make
command injection, unsupported verbs, and workspace escape properties dependent
on every caller rather than enforceable in one place.

### Separate output parsing from process execution

`af-output-schema.ts` parses bounded stdout for the observed version, schema, init,
and status shapes and returns sanitized typed facts or a bounded error code. Raw
stdout/stderr is retained only in memory long enough to parse, is size-limited,
and is never placed in diagnostics. A successful parse remains an execution fact,
not a reasoning-review status.

**Alternative rejected:** returning arbitrary JSON from the runner. That would
leak AF node/ledger/source values into the host boundary and make later status
mapping impossible to audit.

### Own proof roots through an injected storage service

`proof-workspace-store.ts` receives the VS Code global-storage root plus trusted
host boundaries (repository, OpenCode state, and home roots). It creates a random,
non-user-controlled child under a fixed `vibefeld/reviews` directory, verifies
real-path containment and non-symlink ancestors, and exposes an opaque workspace
handle. Cleanup rechecks containment before removing anything and returns failure
rather than following an altered path.

The store does not persist source packets, prompts, model reasoning, credentials,
or child logs. AF's own bounded workspace artifacts are disposable bridge state;
retention/export/deletion policy remains outside this change.

**Alternative rejected:** using `os.tmpdir()` or the active workspace. A temporary
root is not an adequate ownership boundary, and the active workspace is explicitly
writable by Chat.

### Require an independently supplied dedicated policy adapter

`af-execution-boundary.ts` defines the narrow adapter required to launch AF under
a dedicated macOS/Linux policy. The adapter receives only the fixed executable,
internal argv, cwd, read-only runtime grants, and the single review-root write
grant. It must return bounded exit/signal/timeout/cancellation facts and provide
termination/reaping semantics. The bridge refuses to run when the adapter is
missing, reports unsupported platform, or cannot prove its policy is active.

The adapter is deliberately not implemented by calling or resetting the global
Chat `SandboxManager`: that manager owns another process tree and its policy
includes active-workspace writes. A native policy provider (for example, an
independently validated OS launcher supplied by a later platform integration) can
implement the adapter; the default extension path supplies none until that
provider is proven. This lets the bridge enforce a fail-closed contract now
without claiming that the current Chat sandbox is a proof boundary.

**Alternative rejected:** copying Chat's filesystem policy or wrapping AF inside
the Chat companion process. Both would conflate policy ownership and permit an
active-workspace or sibling-process escape.

### Make lifecycle and failure mapping one-way

`vibefeld-runtime.ts` composes compatibility preflight, proof storage, command
encoding, policy execution, output parsing, and cleanup. It has a small state
machine: unavailable/incompatible → preflighting → ready → running → ready, with
any policy/cleanup/audit failure returning to unavailable until a new preflight.
There is no automatic retry with weaker policy, no fallback to unsandboxed
`spawn`, and no downgrade to the Chat sandbox.

Cancellation uses an `AbortSignal` propagated to the policy adapter. Timeouts are
owned by the operation descriptor; both paths terminate and reap descendants
before returning. Results carry normalized private facts and bounded error kinds,
never a structural status or raw child output.

### Gate live tests separately from normal verification

Unit and extension-host tests use injected process/policy/filesystem seams and the
checked-in fixtures. The live suite is an opt-in integration file that requires a
specific environment gate, an explicitly selected disposable AF executable, and
a dedicated disposable policy. It uses project-local `tmp/` artifacts, bounded
capture, cleanup, and one intentional skip when prerequisites are missing. It
must never use a user's real proof bank, profile, workspace, or credentials.

## Risks / Trade-offs

- [The independently supplied policy adapter is unavailable on most developer machines] → Keep the bridge unavailable rather than silently treating the Chat sandbox as equivalent; fixture tests still cover all orchestration and failure paths.
- [AF fixture identity becomes stale] → Pin identity and schema, validate on every preflight, and reject mismatches without executing initialization.
- [A symlink or rename changes a proof root after allocation] → Recheck real paths and containment at allocation, execution, and cleanup; treat ambiguity as audit failure.
- [Child output contains user or ledger content] → Bound buffers, parse only approved shapes, discard raw output, and expose only normalized operation facts.
- [Cancellation leaves descendants] → Make descendant termination/reaping part of the adapter contract and make cleanup failure invalidate the bridge.
- [A later change mistakes compatibility success for proof] → Keep the bridge result private and structural status null; claim projection is a separate OpenSpec capability.
- [Adding a live test causes accidental process/network activity in CI] → Require an explicit opt-in plus explicit disposable inputs; default tests never resolve or spawn AF.

## Migration Plan

There is no persisted-data or configuration migration. The bridge is additive and
can be rolled back by removing its private modules and test fixtures; the existing
unavailable review controller and Chat authority remain intact. A later claim-
projection change may consume the bridge only after this change passes strict
validation and its live prerequisites are independently reviewed. No archive,
commit, profile promotion, or global configuration update is part of this change.
