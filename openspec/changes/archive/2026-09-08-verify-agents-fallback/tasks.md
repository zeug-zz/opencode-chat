## 1. Integration fixture and discovery proof

- [x] 1.1 Create a checked-in project-local workspace/OpenCode integration
  fixture with a distinctive applicable `AGENTS.md` marker and a deterministic
  way to observe the assembled request context. If the SDK requires model
  execution to expose that context, the test may use a test-only in-process or
  localhost fake model transport owned by the test; it must use no credentials,
  external network, real memory provider, or provider/plugin startup.
  **Verify:** capture the actual OpenCode-assembled request/context and prove
  server discovery; do not pass the AGENTS.md text directly as a mocked
  system/request option.
- [x] 1.2 Exercise the fixture through both Chat/Scout and Write/Build with no
  provider, and assert discovered AGENTS.md, ordinary workspace/request
  context, and normal message handling. **Verify:** focused integration tests
  pass for both modes.

## 2. Failure and disabled fallback coverage

- [x] 2.1 Add deterministic mocked tests for provider unavailable, blocked,
  detection error, unavailable tool inventory, and
  memory-integration-disabled paths. **Verify:** every path preserves
  Chat/Write context and startup without credentials, network, or a live
  provider; no-provider and disabled paths make no provider/plugin startup
  attempt.
- [x] 2.2 Assert fallback status is provider-neutral/context-only with retain,
  recall, reflect, and automatic-session-retention disabled. **Verify:** agent,
  extension-host, and protocol assertions cover all fallback states.

## 3. Security and compatibility regressions

- [x] 3.1 Add negative spies/assertions proving fallback paths invoke no recall,
  reflect, retain, delete, lifecycle retention, provider loading outside the
  exact approved Hindsight preflight, provider or OpenCode configuration
  writes, or external-provider startup dependency. **Verify:** focused agent
  and extension tests observe zero forbidden calls; in the configured-provider
  case, explicitly verify the sole exception is a process-scoped,
  lifecycle-disabled, non-mutating, exact-provider-only tool-inventory
  preflight, with no provider tools exposed before capability verification.
  This task explicitly allows the smallest production/helper correction needed
  to ensure that explicit base-launch reconstruction after approved-provider
  preflight failure, blocked paths, unavailable inventory, or detection error
  uses a real base launch configuration without provider integration, rather
  than retaining an active integration through a helper default. Add focused
  regression tests for that base-launch behavior. All other production
  behavior is out of scope, and successful exact-provider preflight behavior
  must remain unchanged.
- [x] 3.2 Compare fallback launches against the existing baseline and prove
  Chat/Scout and Write/Build system guidance, permissions, sandbox mode,
  ordinary OpenCode context, independent TUI configuration, and existing MCP
  behavior are unchanged. **Verify:** launch/overlay regression tests pass.
- [x] 3.3 Verify retrieved/provider content remains evidence rather than
  instruction and that AGENTS.md remains project guidance rather than durable
  memory. **Verify:** focused prompt/security assertions cover the distinction.

## 4. Documentation and final validation

- [x] 4.1 Update maintained documentation (including applicable Chat/Write and
  project memory guidance) to distinguish AGENTS.md from durable cross-session
  memory and document no-provider, disabled, and provider-failure fallback.
  **Verify:** documentation audit and `git diff --check` pass.
- [x] 4.2 Run focused affected-package tests, Biome checks for touched files,
  and `openspec validate "verify-agents-fallback" --strict`. **Verify:** all
  applicable commands pass and any schema issue is reported.
- [x] 4.3 Perform final scope/diff review to confirm this change does not add a
  generic provider registry or AGENTS.md write/promotion feature and does not
  modify unrelated changes. **Verify:** only intended implementation,
  fixture, and documentation files are present; do not archive or commit.
