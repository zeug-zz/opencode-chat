## 1. Context Snapshot Logic

- [ ] 1.1 Replace the per-session context token accumulator in `packages/platforms/vscode/webview/App.tsx` with a single latest valid snapshot, calculating prompt context as `input + cache.read` once and selecting the newest assistant message state without summing older messages; verify the implementation contains no cumulative context update path.
- [ ] 1.2 Update context-related event and compaction handling in `App.tsx` so non-zero server context text is authoritative for its update, assistant and step snapshots replace rather than add, `session.updated` aggregate tokens are ignored, and compaction/session changes clear and release snapshot state correctly; verify the source-priority and compaction scenarios pass.

## 2. Regression Coverage

- [ ] 2.1 Update `packages/platforms/vscode/webview/__tests__/scenarios/28-compaction-context-guard.test.tsx` to assert that the latest assistant snapshot replaces older values and that loaded assistant messages are not summed; verify duplicate and multi-step inputs remain at the latest snapshot value.
- [ ] 2.2 Add or extend webview scenario coverage for non-zero and zero `context.updated` text, ignored cumulative `session.updated` tokens, zero/incomplete fallback tokens, active-session filtering, compaction reset/repopulation, and token-limit percentage formatting; verify each case through the rendered context-memory chip.

## 3. Validation

- [ ] 3.1 Run the focused webview test command for the changed scenarios and verify all context-memory and compaction assertions pass.
- [ ] 3.2 Run `openspec validate --change "fix-context-memory-accounting" --strict`, `pnpm run check`, and `pnpm run build`; verify the change validates cleanly and the extension/webview build succeeds.
