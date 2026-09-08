## 1. Approved Hindsight adapter

- [x] 1.1 Add an exact approved Hindsight plugin resolver over the effective OpenCode configuration, including safe package-identity validation, deterministic selection, tuple-option stripping, and narrow runtime/configuration path discovery. **Verify:** synthetic config fixtures cover approved absolute/package entries, unapproved Hindsight-like entries, invalid metadata, multiple entries, and no code/plugin execution.
- [x] 1.2 Add the Hindsight companion integration mapping from detected status/tool inventory to exact recall/search and reflection tool patterns, process-scoped lifecycle-hook suppression, conservative metadata, and sanitized failure states. **Verify:** adapter tests cover available, partial, configured, blocked, error, and unavailable cases; write, diagnostic, synchronization, deletion, and unknown tools remain excluded.

## 2. Companion overlay and permissions

- [x] 2.1 Extend the in-memory Scout/Build overlay to merge only capability-derived Hindsight tool allows while preserving Scout’s exact research-worker delegation rule and Build’s wildcard denial. **Verify:** agent permission tests assert positive and negative tool patterns for Chat and Write, including no retention/write or administration access.
- [x] 2.2 Apply one normalized Hindsight overlay through both the SDK-managed unsandboxed launch and sandboxed `OPENCODE_CONFIG_CONTENT` launch. **Verify:** launch-parity tests compare plugin reference, permissions, MCP/guidance overlays, lifecycle environment, and prove no user/workspace configuration writes or unrelated plugin inheritance.

## 3. Host startup and sandbox integration

- [x] 3.1 Resolve the approved provider before companion startup, verify the registered safe tool inventory without invoking memory operations, and preserve normal Chat/Write startup when resolution or initialization fails. **Verify:** extension-host tests cover provider present, absent, partial, blocked, and thrown/fallback paths without changing the requested sandbox mode.
- [x] 3.2 Add only the resolved Hindsight package/configuration runtime paths to the existing sandbox read policy with normalization, deduplication, and fail-closed deny-overlap handling. **Verify:** policy tests cover exact grants, missing/unsafe paths, protected-path conflicts, supported platforms, and no broad home or unsandboxed fallback.

## 4. Security regressions and final verification

- [x] 4.1 Add end-to-end-shaped regression coverage proving Hindsight results remain untrusted evidence, lifecycle retention is disabled, the independent TUI/configuration remains unchanged, and shell/edit/task/package/terminal/provider-admin escalation stays denied. **Verify:** focused core, agent, extension, and sandbox tests pass with synthetic providers and no credentials/network.
- [x] 4.2 Run focused package tests, Biome checks for touched files, strict OpenSpec validation, `git diff --check`, and final scope/diff review. **Verify:** all applicable commands pass; document any pre-existing build baseline; do not archive, commit, or push.
