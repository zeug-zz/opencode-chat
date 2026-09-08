## Why

The companion now has provider discovery, a provider-neutral `none` fallback,
approved Hindsight tools, and retention controls, but the most important
degraded-mode guarantee still needs direct verification: Chat/Scout and
Write/Build must continue to receive the applicable OpenCode context,
including discovered `AGENTS.md`, when memory is absent or unusable. Existing
tests exercise supplied guidance and normalized status, but do not prove actual
workspace/OpenCode discovery through both user-facing modes.
The SDK may expose the assembled `AGENTS.md` context only after a model request
executes, so the verification must use a test-owned local model transport when
that execution step is required rather than weakening the discovery assertion.

## What Changes

- Add a checked-in project-local workspace/OpenCode integration fixture
  containing a distinctive applicable `AGENTS.md` marker and verify that it
  reaches Chat and Write. If the OpenCode SDK exposes assembled context only
  after model execution, the test may use a test-only in-process or localhost
  fake model transport owned by the test; it must use no credentials, external
  network, real memory provider, or provider/plugin startup.
- Add deterministic mocked coverage for no provider, unavailable/blocked/error
  provider detection, and disabled memory integration.
- Preserve the existing exact-approved-Hindsight preflight exception: when an
  approved provider is configured, its plugin may be launched only in the
  bounded, non-mutating, process-scoped preflight needed to inventory
  registered tools. Lifecycle hooks must be disabled, and provider tools must
  not be exposed until capability verification succeeds. The preflight must
  not invoke recall, reflect, retain, or delete, automatic/lifecycle
  retention, or provider/OpenCode configuration writes.
- Verify fallback status is provider-neutral and context-only, with retain,
  recall, reflect, and automatic session retention disabled.
- Verify that no-provider and disabled paths do not attempt provider/plugin
  startup, while provider preflight failure, blocked paths, unavailable
  inventory, and detection errors are nonfatal and fall back to ordinary
  startup in the requested sandbox mode with no provider-backed capabilities.
- Allow one minimal compatibility correction where explicit base-launch
  reconstruction after approved-provider preflight failure, blocked paths,
  unavailable inventory, or detection error must not be overridden by a
  default provider integration. Successful exact-provider preflight behavior
  remains unchanged.
- Verify fallback paths perform no durable-memory operation, provider loading
  outside the exact preflight exception, provider configuration write,
  lifecycle retention, or external-provider startup dependency.
- Document the distinction between stable `AGENTS.md` project guidance and
  optional durable cross-session memory, including failure/no-provider
  behavior.

## Capabilities

### New Capabilities

- `agents-md-minimum-fallback`: Preserve and verify applicable OpenCode
  guidance and ordinary workspace/request context for Chat and Write without a
  memory provider.

### Modified Capabilities

None.

## Non-goals

- A generic provider registry or replacement-provider implementation.
- Writing, promoting, or synchronizing findings into `AGENTS.md`.
- Changing Chat/Scout or Write/Build prompts, permissions, sandbox mode, MCP
  behavior, independent TUI configuration, or provider policy.
- Broadening production changes beyond the smallest launch-helper correction
  required to construct a real base launch configuration for the documented
  fallback, plus focused regression tests for that correction.
- Adding new recall, reflect, retain, delete, lifecycle-retention, plugin,
  configuration, or external-provider startup behavior.

## Risks and fallback

The primary risk is accidentally treating provider status as a prerequisite for
normal context assembly, or allowing a degraded status to trigger provider
side effects. Tests must fail if any fallback path invokes memory operations,
loads a provider outside the exact approved preflight, writes configuration,
or changes the existing launch profile. A configured-provider preflight must be
proven non-mutating and lifecycle-disabled, and its failure must not prevent
ordinary startup.
If a live provider or integration fixture cannot run, deterministic provider
fakes still prove failure and disabled paths; the checked-in project-local
fixture remains required for proving actual `AGENTS.md` discovery. The
discovery assertion must capture the actual OpenCode-assembled request/context,
not pass the fixture's `AGENTS.md` text as a mocked system or request option.
