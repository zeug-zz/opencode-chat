## 1. Wire Compact Action

- [x] 1.1 Add active-session compact callback plumbing from `App.tsx` through `InputArea` to `AgentSelector`, posting the existing `compressSession` message with active `sessionId` and selected model; verify by static inspection and focused tests.
- [x] 1.2 Change `AgentSelector` so `chat` (`plan`) and `build` remain the only selectable primary agents, while `compact` renders as a one-shot action row after them; verify it does not call `onSelect("compaction")` or change the selected label.
- [x] 1.3 Update extension host `compressSession` handler to re-fetch session and messages after `summarizeSession` completes, posting `activeSession` and `messages` back to the webview (same pattern as `revertToMessage`).
- [ ] 1.4 Investigate whether opencode SDK `summarizeSession` actually truncates context or only appends a summary; if latter, file SDK-side task.

## 2. Tests and Verification

- [x] 2.1 Update focused webview tests so the Agents menu order is `chat`, `build`, `compact`, clicking `compact` posts `compressSession`, and subsequent sends preserve the prior primary agent; run the focused initialization scenario test.
- [x] 2.2 Run repository-appropriate verification for this change, including `npm run check`, and record any unrelated pre-existing warnings or failures.
- [ ] 2.3 Add extension host test verifying `compressSession` handler re-fetches session and messages and posts `activeSession` + `messages` back to the webview; run the focused extension host tests.
