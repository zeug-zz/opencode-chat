## 1. Static Filesystem Policy

- [x] 1.1 Implement the reviewed static platform-aware read-deny baseline in `packages/platforms/vscode/src/chat-sandbox-policy.ts`, resolving the exact cross-platform, macOS, and Linux paths from the supplied home directory, normalizing/deduplicating/sorting them, returning no baseline for unsupported platforms including Windows, and preserving all existing compatibility write/runtime behavior; verify focused policy tests cover representative and platform-exclusive paths.
- [x] 1.2 Add fail-closed validation that rejects any protected deny path overlapping the workspace, executable, OpenCode, cache, temporary, or other required read grant instead of allowing precedence to re-enable it; verify focused policy tests cover exact, ancestor, and descendant conflicts and retain existing credential-store write rejection.

## 2. Launch and Runtime Coverage

- [x] 2.1 Verify the generated deny list reaches `SandboxRuntimeConfig.filesystem.denyRead` without changing the existing launch architecture, and preserve the unsupported Windows path where `SandboxManager` is not initialized and status remains inactive; add or update focused agent/settings tests and run them.
- [x] 2.2 Extend the opt-in macOS/Linux sandbox integration coverage to prove a protected existing path is unreadable by the companion and a nested local-MCP-like child while workspace access remains functional; keep the integration gated by `OPENCODE_CHAT_RUN_SANDBOX_INTEGRATION=1` and verify the normal test suite remains safe to skip when not opted in.
- Verification note: The normal non-opt-in suite passed safely with 7 tests skipped; opt-in execution was blocked by the enclosing nono sandbox (`sandbox-exec: sandbox_apply: Operation not permitted`, exit 71), so runtime enforcement was not verified here.

## 3. Documentation and Verification

- [x] 3.1 Update `README.md`, `packages/platforms/vscode/README.md`, and `SECURITY.md` to describe the static macOS/Linux protected-read baseline, broad compatibility reads outside it, network-enabled exfiltration limitations, and Windows unsupported behavior; verify wording does not claim strict confidentiality or Windows enforcement.
- [x] 3.2 Run focused affected tests, `npm run check`, `npm run build`, and `openspec validate "add-chat-sandbox-read-baseline" --strict`; inspect the final worktree diff to verify only the approved policy, tests, documentation, and change artifacts are affected.
- Verification note: Focused tests, `npm run check`, `npm run build`, strict OpenSpec validation, and final diff review passed. Opt-in runtime enforcement remained unverified here because the enclosing nono sandbox rejected nested macOS sandbox application; see task 2.2 for the exact exit-71 note.
