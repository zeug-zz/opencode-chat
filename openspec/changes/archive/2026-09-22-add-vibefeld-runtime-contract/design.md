## Context

`add-vibefeld-review-scaffold` deliberately keeps the controller unavailable:
Scribe forwards ordinary OpenCode responses directly and its existing Chat
sandbox grants the active repository write access. That sandbox is therefore not
a proof-root boundary. The next safe step is to capture what the installed AF
binary actually does and to freeze the requirements for a future dedicated
bridge without putting AF on the production execution path.

The repository currently has no AF dependency or bundled executable. A disposable
capture with the externally installed binary observed AF `0.1.7`, commit
`5a37413`, build date `2026-09-08T02:25:39Z`, Go `go1.27.1`, on Darwin arm64.
The initialized workspace reported format `1.0`. These values are evidence from
one installed binary, not a claim that every AF release is compatible.

## Goals / Non-Goals

**Goals:**

- Keep a versioned, sanitized corpus of observed AF behavior that can be
  replayed without invoking AF.
- Separate observed commands and output shapes from operations approved for a
  future bridge; this phase approves no production operation.
- Define the dedicated OS process-boundary invariants needed for AF and all of
  its descendants.
- Make malformed, stale, secret-bearing, path-bearing, oversized, or incomplete
  evidence fail closed as unavailable/incompatible.
- Prove by tests that extension activation and ordinary manual review still use
  the unavailable controller and do not spawn, write, or change permissions.

**Non-Goals:**

- AF discovery, executable resolution, subprocess execution, or proof-workspace
  creation in production code.
- A runtime bridge, fixed operation union, claim graph, evidence projection,
  adversarial model contexts, automatic routing, or response release gating.
- Changes to `packages/core`, `IAgent`, OpenCode SDK usage, overlays, plugins,
  MCP inventory, sandbox setup, settings, locale strings, or user configuration.
- Treating the AF ledger as semantic proof or exposing raw ledger, prompt,
  source-packet, model-reasoning, or private filesystem data.

## Decisions

### Keep the contract platform-private

Add the runtime contract below `packages/platforms/vscode/src/vibefeld/`.
AF-specific executable names, CLI verbs, workspace formats, paths, and parser
rules must not enter `packages/core` or the webview protocol. The existing
`IReasoningReviewController` remains the only review boundary used by the host,
and it remains unavailable in this phase.

### Treat fixtures as evidence, not configuration

Use a checked-in fixture manifest with a schema version, executable identity,
platform, workspace format, command observations, normalized workspace effects,
and sanitized parsed outputs. Each command observation stores an argv array,
never a shell command string. Paths use fixture-relative placeholders rather
than host absolute paths. Raw stdout/stderr is not stored unless it is bounded
and demonstrably free of prompts, credentials, private reasoning, and user
content; normalized JSON shapes are preferred.

The initial fixture records the observed AF `0.1.7` version JSON, schema JSON,
`init` workspace shape, `status --format json` shape, and representative invalid
node/missing-workspace failures. It may record commands as observed, but the
approved bridge-operation set remains empty. Documentation can suggest commands
but cannot add a command, flag, field, exit category, workspace behavior, or
runtime path to the approved contract without observed fixture evidence.

### Validate before any future use

Expose pure validation/normalization helpers only. Validation must check:

- schema version and exact runtime identity are present;
- command argv is non-empty, does not contain a shell string, and contains no
  absolute path, parent traversal, executable override, or unbounded argument;
- JSON output is bounded and contains only fixture-safe values;
- workspace entries are relative, normalized, and within the fixture workspace;
- failure observations retain exact observed exit/signal/timeout facts when
  present, while unknown failure modes remain conservative non-success;
- secrets, authorization material, raw prompts, source packets, private model
  reasoning, and unrestricted logs are rejected;
- incomplete or mismatched platform/version evidence is incompatible.

Validation returns a non-executable contract. It must not resolve a binary,
read user configuration, inspect a nono profile, or start a child process.

### Define a separate future process boundary

The contract for `add-vibefeld-runtime-bridge` requires a dedicated OS policy,
separate from the existing Chat companion policy, and applies it to AF and all
descendants. The future runner must:

- use a fixture-approved executable resolved by the host, a fixed typed
  operation union, and direct argv with `shell: false`;
- resolve a per-review directory beneath `context.globalStorageUri`, outside
  the repository, home directory, OpenCode state, and sibling review roots;
- allow only observed required read-only runtime files and the internal review
  root, with symlink, traversal, rename, and descendant escape protection;
- bound stdout/stderr and input, enforce operation-specific timeouts, cancel and
  reap the complete descendant tree, and discard raw child output from logs;
- fail closed on missing/ambiguous policy support, unsupported platforms,
  fixture mismatch, malformed output, timeout, cancellation, signal exit, or
  audit failure; it must return unavailable/audit-failed rather than guessing a
  review state;
- never let a model select the executable, workspace, environment, command
  verb, flags, or raw argv, and never add AF as an OpenCode plugin, MCP server,
  custom tool, or `pluginSources` entry.

macOS/Linux are the initial candidate platforms because an equivalent Windows
process/file policy has not been established. This change documents the
requirement; it does not claim enforcement or enable AF on either platform.

### Preserve current behavior by construction

No production activation path imports a subprocess API or loads the fixture as
runtime configuration. The unavailable controller remains injected by
`extension.ts`. Existing Chat, Write, Scout, worker, MCP, sandbox, reasoning
streaming, and TUI tests remain the regression gate. A later bridge change must
explicitly replace this unavailable status only after this contract and its
boundary prerequisites are independently verified.

## Risks / Trade-offs

- [An observed AF build becomes stale] -> Pin the version/build identity and
  reject mismatches instead of silently reusing the fixture.
- [Documentation is mistaken for executable truth] -> Store observed facts and
  keep approved operations empty until a later bridge review.
- [Fixtures leak user data or paths] -> Normalize to placeholders, bound every
  field, reject secrets and absolute paths, and keep raw output out of the
  corpus.
- [The existing Chat sandbox is reused as a proof root] -> Make the dedicated
  OS boundary an explicit prerequisite and do not implement a runner here.
- [A future model bypasses the bridge] -> Keep execution host-owned with no
  plugin/tool/MCP surface and no model-controlled argv in the contract.
- [A failed child is interpreted as a proof result] -> Map all unknown,
  malformed, timed-out, cancelled, signaled, and policy failures to a bounded
  non-success state.

## Migration Plan

There is no persisted-data or configuration migration. The change adds only
private contract code, sanitized test fixtures, and tests. Rollback is removal
of those new files; the existing unavailable review controller and all normal
Chat behavior remain intact. The next bridge change must treat this contract as
its prerequisite and must not enable execution from documentation alone.
