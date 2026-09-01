## 1. Host session ordering and publication

- [x] 1.1 Add monotonic active-session and session-list request coordination for normal create, select, refresh, and list flows so stale active-session and list results are ignored; add deferred extension-host tests for out-of-order selection and create-versus-refresh completion, and verify the focused ChatViewProvider tests pass.
- [x] 1.2 Route every host path that publishes active-session state through the guarded publication logic, including compaction, compression, revert/edit, fork, share/unshare, undo, and redo; ensure stale message snapshots are not published and update focused provider tests to verify one current transition load.

## 2. Webview session transition behavior

- [x] 2.1 Make the initialization handshake independent of active-session ID changes, use current-session references for response filtering, clear prior session messages and auxiliary state on a non-null session switch, and remove competing automatic message loads; add or update webview scenario tests for no extra ready cycle, stale messages, and coherent switching.
- [x] 2.2 Keep the session-list dismissal surface below the ChatHeader interaction area so the visible new-session button works while the list is open; add a regression test for the header action and preserve list selection/outside-click dismissal behavior.

## 3. Final regression coverage

- [x] 3.1 Add or complete cross-layer regression coverage for create/select/refresh ordering and session-list interaction, then verify the affected webview and extension-host test suites, Biome checks, and project build pass without unrelated changes.
