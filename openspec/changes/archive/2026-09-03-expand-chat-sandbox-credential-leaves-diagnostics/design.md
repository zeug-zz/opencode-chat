## Context

The active `chat-agent-sandbox` capability already derives a static macOS/Linux
protected-read list, validates all required read grants against that list, and
captures bounded/redacted companion output and sandbox violation records for
user-visible MCP diagnostics. The report in `plans/security/jailbreak.md`
identified high-value home-relative stores that are not currently protected and
also found that the file-access surface may return an opaque write error. See
`proposal.md` for the motivation and scope; the delta spec defines the
observable contract.

The companion is the only process that should receive these changes. The VS
Code extension host remains outside the sandbox, Scout and Write permissions
remain unchanged, and OpenCode provider authentication is a required
compatibility read rather than a protectable optional store.

## Goals / Non-Goals

**Goals:**

- Add a small, auditable set of cross-platform credential/private-key paths to
the existing static baseline without changing policy construction or grant
semantics.
- Preserve the existing compatibility grants and the explicit user-controlled
`off` mode for workflows that intentionally need a protected path.
- Make available sandbox denial causes durable in the extension-host log using
the same bounded and redacted diagnostic data already used for user-visible
failures.
- Keep MCP transport attribution and fail-closed startup behavior intact.

**Non-Goals:**

- Do not turn the compatibility sandbox into a whole-home read allowlist or
attempt to isolate other user homes, external volumes, or generic application
configuration.
- Do not add a new UI message, protocol type, MCP-specific exception, network
rule, sandbox backend, or Windows enforcement.
- Do not log raw process output, file contents, credentials, environment values,
or request payloads.

## Decisions

### 1. Extend the existing cross-platform static list

Add these relative entries to the existing cross-platform deny constant:
`.claude.json`, `.claude/.credentials.json`, `.codex/auth.json`,
`.gemini/oauth_creds.json`, `.electrum`, `.android/adbkey`, and
`.android/adbkey.pub`. They are all home-relative and are applicable to both
supported POSIX platforms. `.electrum` is a dedicated wallet-application root,
while the other entries are exact credential or private-key leaves; none is a
generic XDG, application-support, or home parent.

Do not probe for existence or inspect user configuration while constructing the
policy. The current normalization, sorting, deduplication, platform selection,
missing-path behavior, and overlap validation remain the source of truth. The
existing `.config/op` deny entry must not be confused with `.config/opencode`:
the latter, including required provider authentication data, remains available
to the companion.

**Alternative rejected:** denying all of `.claude`, `.android`, `.codex`,
`.gemini`, `.config`, or the home directory would reduce compatibility for
project tooling and local MCPs without being necessary to protect the observed
credential leaves.

### 2. Reuse the existing diagnostic pipeline and add a host log sink

Keep the current bounded tail collection, redaction, sandbox-runtime stderr
annotation, violation-store lookup, and MCP transport attribution. Add a small
extension-host logging step at the existing failure boundaries:

- sandbox initialization/readiness failure;
- unexpected ready-companion exit; and
- a failed MCP status/operation when the sandboxed companion can provide a
diagnostic.

Log only the already formatted/redacted diagnostic, with stage or operation
context. Preserve a runtime-provided `EPERM`, `EACCES`, `Operation not
permitted`, `permission denied`, or equivalent reason when present. If the
broker supplies only an opaque error, record that bounded opaque message and do
not infer a filesystem cause. Keep the log operation local to the agent's
extension-host execution path; no webview or core protocol change is needed.

The logging helper must keep its own retained state bounded (or avoid retaining
unbounded history) and must not bypass `redactDiagnostic` or the existing output
limits. Repeated status polling must not create an ever-growing in-memory
record. Existing user-visible diagnostics remain the user-facing surface and
must continue to work even if logging itself cannot be observed in a test.

**Alternatives rejected:**

- Logging raw stderr or SDK errors would create a new secret-exposure path.
- Adding a webview diagnostic protocol would increase surface area without
improving the underlying reason available from the sandbox runtime.
- Replacing an opaque broker error with a guessed protected-path message would
create false assurance and misdiagnose compatibility failures.

### 3. Preserve agent and compatibility boundaries

The deny list remains process-wide for the companion and descendants, including
local MCPs. Required workspace, OpenCode, executable/PATH, runtime-cache, and
temporary grants remain unchanged when non-conflicting. No permission overlay,
Build capability, Write requested-artifact behavior, independent TUI handoff,
MCP inventory, network setting, or Windows path changes are part of this work.

### 4. Test policy behavior and diagnostic safety separately

Extend policy unit coverage to pin every new entry on macOS and Linux, absence
on Windows, deterministic normalized output, preservation of OpenCode auth and
other compatibility grants, and rejection of broad-parent substitutions.
Extend agent tests to assert the denial reason and operation context reach the
host log in startup, unexpected-exit, and MCP failure paths while credential and
configuration values remain redacted and output remains bounded. Keep the
opt-in OS enforcement suite unchanged except where a safe representative
existing path is needed; skipped nested macOS enforcement remains an
environment limitation rather than a passing enforcement result.

## Risks / Trade-offs

- **MCP compatibility loss:** an intentionally configured MCP may read one of
the new paths. → Keep the list narrow, preserve the existing actionable
failure, and use the explicit sandbox `off` setting; never remove a deny or
retry unsandboxed.
- **Credential-list drift:** new tools may use different paths. → Keep the
inventory versioned, explicit, and covered by exact tests; defer broad or
uncertain stores to a later review.
- **Diagnostic leakage:** stderr or SDK errors may contain secrets. → Reuse
redaction and bounded tails before logging and user display; test secret,
environment, and payload examples.
- **Opaque broker errors remain opaque:** the extension cannot reconstruct a
reason not exposed by the runtime. → Record the opaque error faithfully and
document that limitation rather than claiming stronger attribution.
- **Repeated MCP polling may duplicate log lines:** status is queried more than
once. → Keep any deduplication state bounded and treat logging as diagnostics,
not a stateful audit database.

## Migration Plan

No migration is required. The new paths are denied only when supported Chat
sandboxing is active; existing unsandboxed mode remains the explicit
compatibility fallback. On a protected-path conflict or intentional MCP
compatibility failure, the existing visible error and user-selected `off` mode
remain available. The logging addition changes diagnostics only and does not
alter agent permissions, protocol data, or persisted settings.
