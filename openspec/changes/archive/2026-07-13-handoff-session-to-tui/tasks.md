## 1. Export API + format

- [x] 1.1 Add agent (or host-side client) session export that loads companion session info + messages and writes `{ info, messages }` JSON for `opencode import`. Prefer companion HTTP/SDK over a second CLI process. **Verify:** unit test with mocked client output file shape.

## 2. Terminal launcher reliability

- [x] 2.1 Upgrade platform `openTerminal` / new `runInTerminal` helper: absolute `opencode` resolution, workspace cwd, shell-ready wait before sendText, support arbitrary command strings for handoff. **Verify:** unit tests for args construction / binary resolution where mockable.

## 3. Handoff host flow

- [x] 3.1 Replace `openTerminal` companion-fork+attach primary path with: require active session + server; progress; export; launch independent `import && opencode --continue` (or verified equivalent); never disconnect companion. **Verify:** chat-view-provider tests updated (no fork on happy path); success path mocks.

- [x] 3.2 On independent failure / detectable lock: show error; provide attach-fallback to companion active session without fork. **Verify:** test for fallback invocation or error path.

## 4. UX copy

- [x] 4.1 Update eng button title / i18n for handoff semantics where needed (keep concise). **Verify:** locale keys present in en at minimum.

## 5. Gate

- [x] 5.1 Focused tests + `npm run check`; document AGENTS note if behavior changes user-facing. **Verify:** green checks on touched packages.
