## 1. Core Types and Protocol

- [x] 1.1 Add the `setMcpPrefs` UI→Host message (`{ type: "setMcpPrefs";
  prefs: Record<string, boolean> }`) and the `mcpPrefs` Host→UI message
  (`{ type: "mcpPrefs"; prefs: Record<string, boolean>; locked: string[] }`)
  to `packages/core/src/protocol.ts`; verify with `pnpm --filter opencode-chat
  test:ext -- --run packages/platforms/vscode/src/__tests__` (or
  `npm run check`) that the union types compile and existing protocol tests
  pass.
- [x] 1.2 Add an optional `mcpOverlay?: { mcp: Record<string, { enabled:
  boolean }> }` field to `OpenCodeLaunchConfiguration` in
  `packages/agents/opencode/src/launch-config.ts`; verify `npm run check` and
  that existing agent tests still pass (`pnpm --filter opencode-chat
  test:ext -- --run packages/agents/opencode/src/__tests__/opencode-agent.test.ts`).

## 2. Inventory and Overlay Module

- [x] 2.1 Create `packages/agents/opencode/src/mcp-inventory.ts` with
  `resolveMcpInventory(globalConfigDir, workspaceRoot)` returning
  `{ servers: Record<string, { explicitlyDisabled: boolean }> }` by reading
  `opencode.json`/`opencode.jsonc` from the global config dir, the project
  `opencode.json`/`opencode.jsonc` walked up from `workspaceRoot` to the
  nearest `.git` boundary, and `<workspaceRoot>/.mcp.json`; collect only
  server names and the effective explicit `enabled: false` state (later
  layers win); never retain command/env/header/url/key values; use a
  JSONC-tolerant parser (strip comments/trailing commas) so valid
  `opencode.jsonc` files parse; verify with unit tests covering global-only,
  project-only, precedence, jsonc parsing, `.mcp.json` union, and
  missing-file tolerance.
- [x] 2.2 Add `buildMcpOverlay(inventory, prefs)` in
  `packages/agents/opencode/src/mcp-overlay.ts` returning
  `{ mcp: Record<string, { enabled: boolean }> }` where: no pref → `false`;
  pref `true` and config not explicitly disabled → `true`; config explicitly
  disabled → `false` and the name is added to a returned `locked` list;
  names absent from inventory are dropped; verify with unit tests.
- [x] 2.3 Add a no-secret invariant test asserting the serialized overlay
  (from a fixture config with commands, `env`/`environment`, `headers`, and
  API keys) contains only `{ "<name>": { "enabled": ... } }` entries and
  none of the definition values; verify with `pnpm --filter opencode-chat
  test:ext -- --run packages/agents/opencode/src/__tests__/mcp-inventory.test.ts`
  and similar new test files.

## 3. Agent Launch Integration

- [x] 3.1 Merge the launch overlay into both launch paths in
  `packages/agents/opencode/src/opencode-agent.ts`: in `connect()` pass
  `{ ...CHAT_AGENT_OVERLAY, ...launchConfiguration?.mcpOverlay }` to
  `createOpencodeServer`, and in `connectSandboxed()` serialize the merged
  overlay into `OPENCODE_CONFIG_CONTENT`; verify existing agent tests still
  pass and update the sandboxed-path assertion in
  `opencode-agent.test.ts` (currently around line 364/368) to expect the
  merged overlay.
- [x] 3.2 Add agent tests asserting both launch paths receive the same
  overlay (sandbox/unsandboxed parity) and that an absent `mcpOverlay`
  leaves the current `CHAT_AGENT_OVERLAY`-only behavior unchanged; verify
  with `pnpm --filter opencode-chat test:ext -- --run
  packages/agents/opencode/src/__tests__/opencode-agent.test.ts`.

## 4. Host Persistence, Migration, and Fail-Closed

- [x] 4.1 Add a host-side chat MCP prefs store (new module e.g.
  `packages/platforms/vscode/src/chat-mcp-prefs.ts`) backed by
  `context.workspaceState` under a dedicated key (e.g.
  `chatMcpPrefsByServer`) with `read()` / `write()` helpers; wire it into
  `extension.ts` `activate()`; verify with host unit tests
  (`pnpm --filter opencode-chat test:ext -- --run
  packages/platforms/vscode/src/__tests__`).
- [x] 4.2 In `chat-view-provider.ts` `ready` handler: read host prefs, run
  migration (host state empty + webview store non-empty → adopt webview
  prefs into host state), then post `mcpPrefs { prefs, locked }` where
  `locked` comes from the inventory's explicitly-disabled names; add
  `setMcpPrefs` handling that persists to host state and re-posts the
  authoritative `mcpPrefs`; verify with `chat-view-provider` tests covering
  host-empty/host-populated migration orders and persistence round-trip.
- [x] 4.3 In `extension.ts`, resolve the inventory and build the overlay
  before `connectAgent` at activation AND inside `ChatSandboxController`
  `start` (rebuild on every companion restart, including sandbox/network
  transitions) using current host prefs; pass it through
  `createLaunchConfiguration`; verify host tests assert the overlay is
  present in the launch configuration for both initial activation and
  restart paths.
- [x] 4.4 Add fail-closed handling: when `resolveMcpInventory` throws or
  cannot parse a contributing config file, do not start the companion,
  surface a visible error (reuse the existing connect-failure reporting
  pattern; keep the webview provider registered), and never launch without
  the overlay; verify with host tests asserting no `agent.connect()` call
  and an error surfaced on inventory failure.
- [x] 4.5 Guard `connectMcp` in `chat-view-provider.ts`: refuse connect for
  servers in the locked set with a visible error and no agent call; verify
  with `chat-view-provider` tests (locked connect refused, unlocked connect
  proceeds).

## 5. Webview Synchronization

- [x] 5.1 Update `packages/platforms/vscode/webview/hooks/useMcp.ts`:
  handle the `mcpPrefs` host message (adopt `prefs` into local state and
  webview store, store `locked` names), send `setMcpPrefs` whenever the
  preference map changes, and exclude locked servers from
  `computeReapplyActions` by filtering against the locked set; verify with
  `useMcp.test.ts` additions (host-prefs adoption, toggle→`setMcpPrefs`,
  locked exclusion from re-apply).
- [x] 5.2 Update `packages/platforms/vscode/webview/App.tsx` (and any
  message-dispatch tests) to route `mcpPrefs` into `useMcp`; verify webview
  scenario/component tests pass (`pnpm --filter opencode-chat test`).

## 6. Diagnostics and Security Verification

- [x] 6.1 Verify `redactDiagnostic` still masks `OPENCODE_CONFIG_CONTENT`
  (overlay content must never appear in diagnostics) and add an agent
  diagnostic test asserting a failure after an overlay-filtered launch
  contains no overlay JSON or MCP definition values; run `pnpm --filter
  opencode-chat test:ext -- --run packages/agents/opencode/src/__tests__/opencode-agent.test.ts`.
- [x] 6.2 Add a regression test asserting `opencode.json`/`.mcp.json` are
  not created or modified across a full toggle + companion restart cycle
  (compare file contents/mtime before and after); verify in host tests.

## 7. Documentation

- [x] 7.1 Update `README.md` and `packages/platforms/vscode/README.md`:
  Chat launches with no unselected MCPs, Gear-panel selection is
  workspace-persisted and survives restarts, config `enabled: false` wins,
  and inventory failure makes Chat unavailable (fail closed).
- [x] 7.2 After implementation and verification only, sync
  `openspec/specs/chat-mcp-settings/spec.md` from this delta (do not modify
  `openspec/specs/chat-agent-sandbox/spec.md` or the
  `chat-sandbox-compatibility-layer` change).

## 8. Final Verification

- [x] 8.1 Run focused agent, host, and webview tests
  (`pnpm --filter opencode-chat test` for webview,
  `pnpm --filter opencode-chat test:ext` for host/agent) and resolve
  regressions.
- [x] 8.2 Run `npm run check` and resolve Biome lint/format issues.
- [x] 8.3 Run `npm run build` and verify the extension bundle contains the
  overlay/inventory module.
- [x] 8.4 Run `npm run package` in `packages/platforms/vscode`, install the
  VSIX in a macOS VS Code instance, and live-verify the section 9 amendment:
  Chat-selected `firecrawl`, `brave-search`, `pdf-reader`, and `paper-search`
  can start even when TUI config sets `enabled: false`; verify first-use
  default-off, sticky companion/VS Code restart behavior, sandbox off/on
  parity, TUI isolation, and unchanged config files; verify a failed sandbox
  MCP does not respawn repeatedly and that its diagnostics and error output
  remain visible.
- [x] 8.5 Run `openspec validate "chat-mcp-startup-persistence" --strict`
  and confirm the section 9 and section 10 scenarios and live checks are
  represented before archiving or synchronizing the change, including the
  failed-sandbox no-respawn and visible-diagnostics checks.

## 9. Clarified Chat/TUI MCP policy

- [x] 9.1 Change `buildMcpOverlay` so Chat prefs alone determine enabled flags
  for inventoried names; a true Chat pref overrides `explicitlyDisabled`;
  remove the returned `locked` list/type if safe while retaining protocol
  `locked: []`; update overlay tests.
- [x] 9.2 Remove the host `connectMcp` refusal and locked-server propagation;
  host sends `mcpPrefs.locked: []`; update host/extension tests.
- [x] 9.3 Remove webview locked-server exclusion/state while preserving host-
  pref adoption and sync; update hook/App tests.
- [x] 9.4 Extend no-write/activation/restart tests to cover a TUI-disabled
  server selected in Chat; verify overlay `{ enabled:true }` and unchanged
  config; update both READMEs and re-sync the main spec.
- [x] 9.5 Verify installed OpenCode merge semantics statically and with a safe
  selected-server test before any sandbox live run; include sandbox and
  unsandboxed parity and TUI isolation.

## 10. MCP reapply convergence

- [x] 10.1 Gate `computeReapplyActions` connect actions to `disabled|unknown`;
  add per-server last-processed status/action idempotence in `useMcp`; reset
  appropriately for a fresh companion/host-pref lifecycle; preserve manual
  toggle; add hook/scenario tests for failed, needs_auth,
  needs_client_registration, unknown, identical echoes, status transitions,
  and restart reapply.
