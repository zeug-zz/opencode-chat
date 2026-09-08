## Context

OpenCode assembles applicable `AGENTS.md` guidance together with ordinary
workspace files and request context. This is project guidance, not durable
cross-session memory. Provider discovery and retention are optional overlays;
their failure must not change the ordinary Chat/Scout or Write/Build request
path. The existing Hindsight companion integration and retention controls are
already implemented and are outside this change's design boundary.

## Architecture boundaries

1. **OpenCode context boundary:** Use a real checked-in project-local
   workspace/OpenCode integration fixture with an `AGENTS.md` containing a
   distinctive applicable marker. Assert that server-discovered guidance is
   present in the actual assembled request/context for both Chat/Scout and
   Write/Build rather than injecting the same text directly into a mock system
   or request option. If the OpenCode SDK requires model execution before it
   exposes assembled context, the test may own a test-only in-process or
   localhost fake model transport. That transport MUST use no credentials, no
   external network, no real memory provider, and no provider/plugin startup.
2. **Provider boundary:** Use the existing discovery, adapter, and retention
   policy interfaces. No-provider and disabled cases MUST NOT attempt provider
   or plugin startup. When an exact approved provider is configured, the
   existing companion launch MAY perform only its bounded preflight: launch
   that exact provider with lifecycle hooks disabled, make no mutations, and
   inventory registered tools before capability verification. No provider
   tools may be exposed before that verification; it must not invoke recall,
   reflect, retain, delete, automatic/lifecycle retention, or provider/OpenCode
   configuration writes. For unavailable, blocked, error, or
   unavailable-inventory outcomes, inject deterministic fakes or
   failure conditions and assert selection/status only.
3. **Launch/host boundary:** Compare fallback launch configuration with the
   existing baseline. The fallback must not add provider plugins, tool allows,
   runtime grants, network requirements, configuration writes, or lifecycle
   hooks. The requested sandbox mode and MCP/guidance overlays remain as they
   were. A minimal compatibility correction is allowed if the existing launch
   helper's default Hindsight integration would cause an explicit base-launch
   reconstruction to retain the active integration: the base reconstruction
   MUST explicitly carry no provider integration. This correction is limited
   to the helper and focused regression tests; successful exact-provider
   preflight behavior and all other production behavior remain unchanged.
4. **Documentation boundary:** Describe `AGENTS.md` as maintained applicable
   project guidance and provider memory as optional evidence. Do not turn
   `AGENTS.md` into a memory store or add promotion/write behavior.

## Fallback contract

Fallback status is provider-neutral and context-only. It may identify that no
usable provider is available, but it MUST not imply a provider-backed memory
capability. Retain, recall, reflect, and automatic session retention are all
disabled. Automatic and lifecycle retention remain disabled regardless of
whether detection is unavailable, blocked, errored, or the preflight inventory
is unavailable.

No fallback path may call recall, reflect, retain, delete, or lifecycle
retention; load or initialize any provider/plugin outside the exact approved
preflight; write provider or OpenCode configuration; or require an external
provider to start. The exact approved preflight is the sole exception to
provider loading: it MUST be process-scoped, lifecycle-disabled,
non-mutating, exact-provider-only, inventory-only, and must not expose
provider tools before capability verification; it must not invoke recall,
reflect, retain, delete, automatic/lifecycle retention, or provider/OpenCode
configuration writes. Its failure, blocked paths,
unavailable inventory, or detection error is nonfatal: ordinary Chat/Scout and
Write/Build startup continues in the requested sandbox mode with the base
AGENTS.md/context fallback and no provider-backed capabilities. Retrieved/
provider content, when present on non-fallback paths, remains evidence rather
than instruction and cannot supersede applicable project guidance.

Explicit base-launch reconstruction after approved-provider preflight failure,
blocked paths, unavailable inventory, or detection error MUST use a real base
launch configuration and MUST NOT be overridden by a helper default that
reintroduces the active provider integration. This is a narrowly scoped
compatibility correction only; it does not add provider behavior or alter
successful exact-provider preflight.

## Verification approach

- Prefer one integration-shaped, checked-in project-local fixture that starts
  the supported OpenCode test server against a workspace containing applicable
  `AGENTS.md`, then exercises Chat/Scout and Write/Build with each fallback
  status as applicable. Where SDK context observation requires execution, use
  only the test-owned fake model transport described above and capture the
  actual OpenCode-assembled request/context; supplying the marker as a mocked
  system/request option is not verification.
- Use deterministic mocked tests for provider unavailable, blocked, error,
  unavailable-inventory, and disabled paths where a live provider is
  unnecessary. Spies must cover all durable-memory operations, provider
  loading outside the exact approved preflight, configuration writes, and
  lifecycle-retention hooks. The configured-provider case must explicitly
  verify the narrow preflight exception and that tools are withheld until
  inventory/capability verification.
- Assert unchanged Chat/Write system guidance, permissions, sandbox mode,
  ordinary OpenCode context, independent TUI configuration, and existing MCP
  behavior by comparing the fallback overlay to the pre-provider baseline.

## Trade-offs, migration, and rollback

The real fixture costs more setup than a prompt-only unit test, but it is the
only reliable proof of actual `AGENTS.md` discovery. Mocked provider failures
keep tests deterministic and credential-free. No data migration or user
configuration migration is required. Rollback is limited to removing the new
fixture, assertions, and documentation; existing provider integration and
retention controls remain unchanged.
