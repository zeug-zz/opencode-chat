## 1. Shell-Resolved Handoff Commands

- [x] 1.1 Update the integrated-terminal command construction in `packages/platforms/vscode/src/vscode-platform-services.ts` so independent continuation sends the literal `opencode --continue` command and attach fallback sends the literal `opencode attach <url> --session <id>` command; preserve the direct resolved-binary import preflight, dynamic-argument shell quoting, shell-readiness wait, and existing error/fallback flow, and verify the extension-host test suite passes.

## 2. Regression Coverage

- [x] 2.1 Add focused extension-host tests for the handoff and attach commands, asserting that terminal text uses `opencode` rather than any resolved absolute path, shell-sensitive dynamic arguments remain safely quoted, the direct import preflight still uses the resolved binary, and existing session/fallback behavior remains intact; verify with `pnpm --filter opencode-chat test:ext`.
