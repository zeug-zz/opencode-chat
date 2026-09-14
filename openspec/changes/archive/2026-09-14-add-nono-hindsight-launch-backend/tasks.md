## 0. Implementation ownership gate

- [x] 0.1 Before editing, obtain explicit user direction that separates, retains, or discards the current uncommitted `complete-hindsight-tui-parity` queue; verify the resulting `git status --short` makes this change’s files and scope reviewable, without running reset, clean, stash, commit, or other git cleanup automatically.

## 1. Select and validate the user’s nono profile

- [x] 1.1 Add a bounded extension-host profile discovery flow that uses nono’s supported profile introspection and reads only the documented user-profile location (`$XDG_CONFIG_HOME/nono/profiles`, default `~/.config/nono/profiles`) as needed; never parse or copy profile contents into Scribe policy.
- [x] 1.2 Add an explicit workspace-scoped user selection for one discovered profile name, such as `opencode-local`; persist only that name in existing extension settings and allow clearing/changing it without modifying nono files.
- [x] 1.3 Resolve `nono` only when Chat sandboxing is enabled and the explicitly selected profile passes bounded `nono profile show <name>` preflight; preserve `NONO_BIN` precedence, cache the decision for reconnect, use compatibility fallback for absent/invalid selection, and preserve explicit sandbox-off SDK behavior.
- [x] 1.4 Verify focused resolver, extension-host, locale, and settings tests cover XDG/default paths, malformed/missing profiles, user selection, selected profile validation, no arbitrary profile auto-selection, Windows behavior, backend preservation, and no settings/config writes outside the extension’s supported setting path.
- [x] 1.5 Default enabled sandbox launches to preflighted built-in `opencode`; when custom profiles exist and no choice is stored, show one nonblocking picker offering `opencode` plus discovered custom profiles, persist only the explicit resulting name, and never prompt/auto-select when none exist; verify resolver, setting, extension-host, locale, and reconnect behavior.

## 2. Launch and manage the selected nono child

- [x] 2.1 Refactor the sandboxed OpenCode child launcher so the existing `SandboxManager` branch remains intact and the selected-profile nono branch spawns direct argv with `shell: false`; verify exact argv, argument boundaries, cwd, overlay environment, and no `SandboxManager` initialization/reset in the nono branch.
- [x] 2.2 Share bounded output, loopback readiness, SDK client setup, event subscription, and process-group cleanup across both child backends while keeping diagnostics backend-aware; verify no runtime backend downgrade after selected-nono startup/readiness failure.
- [x] 2.3 Preserve same-backend plugin-free fallback for selected nono and clear provider authority on that retry; verify no nono failure launches the VS Code or SDK backend and no fallback preserves Hindsight permissions.

## 3. Scope Hindsight by the selected backend

- [x] 3.1 Apply backend-scoped Hindsight policy: verified selected nono receives only exact observed approved native operations; compatibility fallback receives only search/list/read and suppresses reflection, writes, capture, diagnostics, synchronization, and lifecycle hooks.
- [x] 3.2 Keep provider identity/inventory checks, Scout/Build negative permissions, research-worker Hindsight denial, process-scoped overlays, and no global/workspace OpenCode or nono configuration writes in both backends.
- [x] 3.3 Gate automatic retention and native lifecycle behavior on the verified selected-profile nono backend only; verify the compatibility fallback is non-mutating and never reports retention active.

## 4. Verify backend behavior and document support

- [x] 4.1 Update the opt-in nono integration check to use an explicitly selected disposable profile; default execution must perform no nono launch, and opted-in runs must verify permitted workspace/OpenCode state, protected-read denial, loopback, optional network behavior, descendant inheritance, and cleanup.
- [x] 4.2 Update maintained sandbox/security, architecture, extension documentation, and settings guidance to describe external nono, explicit selected-profile setup, profile discovery/preflight, recall-only fallback, absent bundled binaries/profile modification, and non-equivalence without opt-in verification.
- [x] 4.3 Update maintained profile-selection documentation and the opt-in test guidance for native default `opencode`, optional custom-profile selection, and fallback only when nono is unavailable; verify no stale claim says an absent profile uses compatibility fallback.

## 5. Final validation

- [x] 5.1 Run focused suites, `pnpm run check`, `pnpm run build`, `pnpm run test:all`, `git diff --check`, and `openspec validate add-nono-hindsight-launch-backend --strict`; review status/diff for unrelated files, generated artifacts, secrets, lockfile churn, or git-history changes.
- [x] 5.2 With explicit disposable/operator authorization, manually verify the opt-in default `opencode` native profile exposes approved Hindsight operations and no non-Hindsight tools; verify selected-nono failures fail closed and the independent TUI remains unaffected where the test environment permits.
