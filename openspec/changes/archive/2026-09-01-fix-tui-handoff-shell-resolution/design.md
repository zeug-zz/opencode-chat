## Context

The handoff implementation in `packages/platforms/vscode/src/vscode-platform-services.ts` uses `resolveOpencodeBinary()` for both the extension-host `opencode import` preflight and commands sent to the integrated terminal. `runInTerminal()` creates a VS Code terminal with its configured default profile, waits for shell integration when available, and sends the command as shell text. The terminal command currently contains a shell-quoted absolute OpenCode path.

A user may define `opencode` as a zsh function, alias, or shell hook that applies a nono policy. Invoking `/path/to/opencode` does not resolve through that command name and bypasses the hook. The existing session export/import protocol, companion connection, and handoff fallback are otherwise correct and are outside this fix.

## Goals / Non-Goals

**Goals:**

- Make the independent continuation command sent to the integrated terminal use the literal `opencode` command name.
- Make the attach fallback use the literal `opencode` command name as well.
- Preserve argument quoting, shell-readiness waiting, session selection, and visible error behavior.
- Preserve absolute executable resolution for direct extension-host operations, including the companion launch and current import preflight.
- Keep the change independent of nono detection and external sandbox installation.

**Non-Goals:**

- Changing how the companion server is spawned or sandboxed.
- Moving the import preflight into the terminal shell.
- Adding terminal exit monitoring or a new terminal process manager.
- Bundling nono or making the extension understand a user's shell policy implementation.
- Changing the export format, independent session semantics, or attach fallback purpose.

## Decisions

### Use the shell command name only for integrated-terminal commands

The handoff terminal command will be built from the literal `opencode` command name plus its existing arguments, rather than from `resolveOpencodeBinary()`. This lets the configured terminal shell resolve aliases/functions/hooks and lets a normal installation resolve OpenCode through PATH.

The extension-host `execFile()` import preflight and companion launch retain resolved binaries. Those processes do not run through the user's integrated terminal shell, so replacing their executable path would not activate zshrc policy and could reduce launch reliability.

Alternative rejected: keep the absolute path and add nono detection in the extension. That duplicates a machine-specific shell policy, fails to cover user-defined wrappers other than nono, and leaves the terminal command contract dependent on extension-side sandbox knowledge.

### Apply the same rule to attach fallback

The attach fallback is also an integrated-terminal OpenCode command, so it will use `opencode attach ...` rather than an absolute path. This avoids a security-policy bypass if the independent import/TUI path fails and the user chooses attach.

Alternative rejected: leave attach on the absolute resolver because the server is sandboxed. The TUI client is still a user-launched OpenCode process, and consistent shell resolution avoids surprising policy differences between the two handoff paths.

### Do not add an absolute-path retry

If the integrated terminal cannot resolve `opencode`, the terminal's normal shell error remains the visible failure. The extension must not recover by sending the resolved absolute path, since that would silently bypass the user's shell policy. The existing import failure path may still offer the existing attach choice; that attach command must also remain shell-resolved.

### Keep command construction shell-safe

The command name is intentionally unqualified, but dynamic values such as the companion URL, session ID, and export path continue to be quoted before being sent to the shell. Tests should cover spaces and shell metacharacters in those values without changing the established terminal command mechanism.

The canonical continuation form should remain `opencode --continue`; `opencode -c` is equivalent where supported, but no CLI flag change is required by this fix.

## Risks / Trade-offs

- [Risk] The VS Code integrated terminal may use a shell other than zsh or may not load the user's expected startup file. -> [Mitigation] Use the configured default terminal shell, document that the command must be resolvable there, and do not add an absolute fallback.
- [Risk] A user's shell wrapper may reject the command or alter its interactive behavior. -> [Mitigation] Preserve the existing visible terminal/error path and treat that as the user's shell policy; test the normal no-wrapper PATH case.
- [Risk] The extension host and integrated terminal may have different PATH values. -> [Mitigation] Keep the direct import preflight on the resolved extension-host binary, while making the final terminal command intentionally depend on terminal-shell resolution.
- [Risk] The direct import preflight remains outside a zshrc/nono hook. -> [Mitigation] Keep this change explicitly scoped to the interactive TUI/attach terminal commands; handle import sandboxing separately if it becomes a requirement.
- [Risk] Shell quoting changes could introduce injection or break existing paths. -> [Mitigation] Change only the executable token, retain safe quoting for dynamic arguments, and add focused command-construction tests.

## Migration Plan

1. Update the existing handoff and attach terminal command builders to use `opencode` as the executable token.
2. Add focused extension-host tests asserting the sent terminal commands contain `opencode` and do not contain a resolved absolute OpenCode path.
3. Verify existing import failure, attach fallback, shell-readiness, and companion-connected behavior remain unchanged.
4. Run focused extension tests, the full test suite, Biome checks, build, and strict OpenSpec validation.
5. Roll back by restoring the previous terminal command token only if a supported terminal environment cannot resolve `opencode`; do not introduce an automatic absolute-path fallback.

## Open Questions

None. The remaining choice between `--continue` and `-c` does not change the specified shell-resolution behavior; retain the existing `--continue` form unless focused CLI compatibility testing requires the shorthand.
