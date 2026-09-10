## 1. Fixed Retention Policy

- [x] 1.1 Replace the effective retention policy with
  `enabled: true`, `requireConfirmation: true`, and
  `automaticSessionRetention: true` for the companion. **Verify:** policy
  tests assert the fixed values and no-provider paths remain no-op.
- [x] 1.2 Stop reading legacy workspace retention booleans and ignore existing
  false values without deleting or rewriting user/workspace configuration.
  **Verify:** extension-host tests cover legacy false values and confirm the
  fixed policy remains effective.
- [x] 1.3 Preserve exact Hindsight identity, capability, observed-tool,
  lifecycle, sandbox, and bounded payload gates. **Verify:** unavailable,
  blocked, partial, missing-tool, unsafe-path, secret, empty, and oversized
  cases remain unavailable or rejected without blocking ordinary Chat/Write.

## 2. Explicit Retention Confirmation

- [x] 2.1 Keep `hindsight_ingest_document` as the only explicit retention
  operation and keep it confirmation-gated for every request. **Verify:**
  confirm-once, reject, timeout, provider-failure, and `always`-clamping tests
  pass.
- [x] 2.2 Preserve exact Scout/Build permission behavior and exclude the
  research worker, Hindsight administration, deletion, diagnostics,
  synchronization, wildcard, and unknown tools. **Verify:** agent overlay
  positive and negative permission tests pass.

## 3. Remove Retention Settings Surface

- [x] 3.1 Remove the three `opencode-chat.memoryRetention.*` VS Code setting
  contributions and the workspace policy loading/update path. **Verify:**
  activation tests confirm no retention configuration writes or update handler.
- [x] 3.2 Remove the `MemoryRetentionSection` and related props/state/callbacks
  from the webview settings panel while preserving MCP, sandbox, language,
  thinking, sound, and config-link controls. **Verify:** webview tests assert
  the retention section and checkboxes are absent.
- [x] 3.3 Remove obsolete retention policy/status webview messages and unused
  locale keys, while retaining any host-side state required for permission
  enforcement or bounded diagnostics. **Verify:** core protocol, host, webview,
  and all locale checks pass.

## 4. Automatic Lifecycle Retention

- [x] 4.1 Apply the fixed automatic-retention policy to SDK-managed and sandboxed
  launches after exact provider verification. **Verify:** launch-parity tests
  assert lifecycle environment, plugin/provider identity, agent permissions,
  MCP overlay, and sandbox behavior agree.
- [x] 4.2 Preserve bounded summaries, deduplication, secret exclusion, raw-tool
  payload exclusion, and untrusted-evidence handling. **Verify:** lifecycle
  retention tests cover safe, empty, oversized, unsafe, duplicate, and failed
  session cases.
- [x] 4.3 Keep provider startup/write failures nonfatal and retain the requested
  sandbox mode without unsandboxed retry. **Verify:** failure tests show
  ordinary Chat/Write and AGENTS.md fallback continue.

## 5. Specifications and Documentation

- [x] 5.1 Synchronize the main `memory-retention-controls`,
  `automatic-session-retention`, `hindsight-companion-tools`, and
  `companion-scoped-scout` specs after implementation and verification.
- [x] 5.2 Update root and extension documentation to describe provider
  installation as the retention opt-in, mandatory per-request confirmation,
  bounded automatic summaries, ignored legacy settings, and no-provider
  fallback.

## 6. Verification

- [x] 6.1 Run focused core, agent, extension-host, sandbox, and webview tests,
  including all locale and protocol coverage.
- [x] 6.2 Run `pnpm run check`, `pnpm run build`, `git diff --check`, and strict
  OpenSpec validation.
- [x] 6.3 Perform a final security review confirming that always-on retention
  does not grant deletion, administration, wildcard tools, shell/edit/task
  access, provider configuration writes, or unsandboxed fallback.
