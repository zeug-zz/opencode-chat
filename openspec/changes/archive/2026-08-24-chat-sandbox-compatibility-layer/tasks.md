## 1. Compatibility Policy

- [x] 1.1 Replace the enabled Chat sandbox's strict home-directory read deny
  rules with compatibility filesystem semantics while preserving normalized
  workspace, OpenCode state, runtime-cache, and temporary write paths; verify
  the policy no longer requires MCP-specific read paths and still rejects
  home-root or credential-store write paths.
- [x] 1.2 Remove or retire unused MCP-specific filesystem path plumbing from the
  compatibility launch configuration; verify enabling or disabling an MCP does
  not rebuild the sandbox policy or add a server-name-specific exception.
- [x] 1.3 Preserve global network inheritance for the complete companion tree;
  verify network-disabled mode remains local-only and network-enabled mode
  permits provider and remote/local MCP traffic without a hard-coded domain
  list or unsandboxed retry.
- [x] 1.4 Preserve loopback binding for the Chat companion and document the
  runtime's coarse unrestricted-network behavior; verify the compatibility
  policy does not claim strict outbound-only or credential-confidential
  protection.

## 2. Companion and MCP Diagnostics

- [x] 2.1 Retain bounded, redacted companion stdout/stderr and sandbox
  violation details after readiness so MCP failures can be diagnosed after the
  server has started; verify credential values and configuration payloads are
  not exposed.
- [x] 2.2 Report the affected MCP child, operation, exit/readiness context, and
  available diagnostic output for local MCP startup or write/network failures;
  verify failures remain inside the sandbox and never trigger an unsandboxed
  fallback.
- [x] 2.3 Verify MCP preferences, event subscribers, persisted sessions, and
  webview state survive sandbox and network setting transitions under the
  compatibility policy.
- [x] 2.4 Update `.mcpLifecycle` CSS with `min-width: 0`, `white-space: normal`
  or `pre-wrap`, `overflow-wrap: anywhere`, remove `flex-shrink: 0`, and add
  `user-select: text`; add a focused component test asserting the full
  diagnostic text and the wrap/selectable style contract.

## 3. Automated Coverage

- [x] 3.1 Update sandbox policy unit tests for broad compatibility reads,
  constrained writes, runtime/cache paths, credential-store write rejection,
  and platform-specific policy construction.
- [x] 3.2 Update agent tests for one inherited network policy covering providers,
  remote MCPs, local MCPs, and descendants, including network-off failure and
  network-on success paths.
- [x] 3.3 Add a sandbox integration test with a generic nested local-MCP-like
  child that reads an installed-runtime-like path, writes the workspace, and
  is denied an outside write while inheriting network behavior.
- [x] 3.4 Run representative live MCP checks for a Node/npm local server, a
  non-Node local server, a filesystem MCP with a configured root, Context7 or
  another remote MCP, and the network-off failure path; record status and
  diagnostic results without recording secrets.
- [x] 3.5 Preserve regression coverage for unsupported platforms, disabled Chat
  sandbox startup, Scout/Build permissions, companion cleanup, and independent
  TUI behavior.

## 4. Documentation and Specification

- [x] 4.1 Update the root `openspec/specs/chat-agent-sandbox/spec.md` from this
  delta only after implementation and verification; preserve the deferred
  strict-sandbox scope.
- [x] 4.2 Update the root `README.md` with compatibility sandbox activation,
  inherited MCP behavior, write boundary, network behavior, and the broad-read
  security limitation.
- [x] 4.3 Update `packages/platforms/vscode/README.md` with the same user-facing
  guidance and explicit distinction between compatibility and future strict
  sandboxing.
- [x] 4.4 After task 2.4 verification, sync the new MCP diagnostic
  visibility/selectability scenario into `openspec/specs/chat-agent-sandbox/spec.md`;
  do not alter unrelated specs.
- [x] 4.5 After task 7.4 verification, sync the OpenCode lock/state and
  context-mode session runtime-path requirement/scenarios into
  `openspec/specs/chat-agent-sandbox/spec.md`; preserve unrelated requirements.

## 5. Build and Release Verification

- [x] 5.1 Run focused agent, host, webview, and sandbox integration tests and
  resolve compatibility-policy regressions.
- [x] 5.2 Run `npm run check` and resolve formatting, lint, and type issues.
- [x] 5.3 Run `npm run build` and verify the bundled extension contains the
  compatibility launch path and sandbox runtime.
- [x] 5.4 Run `npm run package`, install the VSIX in a macOS VS Code instance,
  and verify local/remote MCP behavior with both network settings.
- [x] 5.5 Run strict OpenSpec validation and confirm all compatibility scenarios
  are represented before archiving or synchronizing the change.

## 6. Companion Process-Tree Teardown Amendment

No live sandbox retry is allowed until the cleanup implementation and automated
checks in this section pass. Keep the pending live MCP checks and final
validation tasks above open.

- [x] 6.1 Configure sandbox companion spawn with a detached macOS/Unix
  process-group leader covering the wrapper/sandbox shell and `opencode serve`,
  while preserving independent TUI process ownership.
- [x] 6.2 Implement complete companion-group termination with graceful SIGTERM,
  bounded timeout, SIGKILL escalation for survivors, and an awaited cleanup
  result covering all MCP/npm/node descendants.
- [x] 6.3 Add deferred-exit unit tests proving a reconnect cannot spawn a
  replacement companion until the prior process group has finished teardown.
- [x] 6.4 Add host/controller serialization regression coverage for repeated
  sandbox and network transitions, including no orphan trees, no accumulated
  npm/node MCP children, and no project-database race.
- [ ] 6.5 Optionally add an opt-in nested-process integration test for the real
  wrapper/sandbox/serve/MCP tree; this is not required for normal unit test
  runs.

## 7. Live-Diagnosis Compatibility Amendment

Keep all tasks in this section unchecked until implementation and verification
are complete. The live checks and final validation tasks above MUST NOT be
closed before these prerequisites pass.

- [x] 7.1 Extend `resolveRuntimeCachePaths` and the filesystem policy for
  `~/.local/share/uv`, POSIX `~/.cache/uv`, macOS
  `~/Library/Application Support/uv`, and `~/Library/Caches/uv`; add focused
  tests proving the exact derived grants are present, home-root grants are
  absent, credential-store writes remain denied, and independent TUI isolation
  is unchanged.
- [x] 7.2 Add violation-store fallback and child attribution for sandboxed MCP
  diagnostics when the violation command differs from the companion wrapper;
  add focused agent tests proving local child failures are labeled with recent
  bounded/redacted violations while remote and in-process MCPs are not
  mislabeled as child processes.
- [x] 7.3 After 7.1 and 7.2 pass, rerun live MCP checks for git and paper-search
  with sandbox network enabled, and Context7 with sandbox network on/off as
  applicable; record bounded status/diagnostic results without secrets. Keep
  the Brave `BRAVE_API_KEY` launch-environment fix explicitly outside code
  scope.
- [x] 7.4 Extend `resolveRuntimeCachePaths` and the filesystem policy/tests for
  the exact derived OpenCode lock/state directories from
  `XDG_STATE_HOME/opencode` or `~/.local/state/opencode`, and context-mode
  sessions directories from `XDG_CONFIG_HOME/opencode/context-mode/sessions` or
  `~/.config/opencode/context-mode/sessions`; cover XDG overrides and assert
  that home-root and credential-store writes remain denied. After rebuild and
  install, rerun the live Context7 sandbox plus network check.

## 8. Runtime Bootstrap and Temporary-Root Compatibility Amendment

Keep all tasks in this section unchecked until implementation and verification
are complete. Notifier-state denial remains nonfatal diagnostic noise unless
new evidence shows that it blocks Chat or MCP operation.

- [x] 8.1 Derive and grant the safe per-user temporary root for macOS, with
  platform-safe behavior elsewhere; add policy tests for creation of a
  `.ctx-mode-*` child path and assert that no broad `/tmp` grant is emitted.

- [x] 8.2 Confirm by scope review that context-mode plugin/tool profiles and Bun
  bootstrap are intentionally deferred to a follow-up OpenSpec change and must
  not be implemented here; confirm that sandbox compatibility does not broaden
  Scout or the Markdown-only report writer's agent-level permissions or expose
  alternate code/shell execution, and that explicit user-controlled `open in
  tui` remains the coding boundary.

- [x] 8.3 After implementation, sync the main sandbox specification with the
  runtime-state and per-user macOS temporary-root requirements plus the agent
  and execution security boundary, remove the known stray duplicate fragment,
  and leave task 4.5 unchecked until this final synchronization is complete.
