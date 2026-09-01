## Why

The Chat TUI handoff currently resolves OpenCode to an absolute executable path before sending the terminal command. That bypasses user shell functions and zshrc policy hooks, so a machine that protects `opencode` through a shell wrapper can launch the handed-off TUI outside that protection. This is an immediate security fix for the handoff path; machines without such a shell policy should retain normal OpenCode behavior.

## What Changes

- Send the shell-resolved command name `opencode` for the independent TUI continuation instead of an absolute OpenCode path.
- Send the shell-resolved command name `opencode` for the attach fallback instead of an absolute OpenCode path.
- Preserve shell-safe quoting for all arguments, including snapshot paths, server URLs, and session IDs.
- Preserve the existing export, direct import preflight, shell-readiness wait, progress, error, and attach-fallback behavior.
- Keep absolute executable resolution for extension-host-launched operations where no user terminal shell is involved, including the companion server and the current import preflight.
- Do not add nono detection or bundle a new sandbox dependency for this fix.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec/specs/session-tui-handoff/`: require handoff terminal commands to use the user's shell-resolved `opencode` command so shell policy hooks can apply, while preserving independent session continuation and attach fallback semantics.

## Impact

- Affected implementation: `packages/platforms/vscode/src/vscode-platform-services.ts` and its focused tests.
- The extension host continues to use resolved binaries for direct child-process operations; only commands sent to the integrated terminal change.
- On a machine with an `opencode` zsh function or alias, the handoff can now enter that wrapper and its nono policy.
- On a machine without a wrapper, the integrated terminal resolves `opencode` through its normal PATH and behaves as before.
- If the integrated terminal cannot resolve `opencode`, the failure remains visible and must not trigger an absolute-path retry that would bypass shell policy.
- No changes are required to the companion sandbox, MCP behavior, session export format, independent TUI lifecycle, or VSIX dependencies.
