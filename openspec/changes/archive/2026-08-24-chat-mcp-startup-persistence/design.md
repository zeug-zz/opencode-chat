## Context

See `proposal.md` for motivation and `specs/chat-mcp-settings/spec.md` for
the contract.

Today the Chat companion is launched through `OpenCodeAgent.connect()` with a
`CHAT_AGENT_OVERLAY` that only defines the `scout`/`build` agents
(`opencode-agent.ts:62`, passed as `createOpencodeServer` config or
`OPENCODE_CONFIG_CONTENT` at line 348). Because the overlay carries no `mcp`
section, the companion inherits every MCP from the user's global/project
OpenCode config and eagerly starts the local ones. The webview hook
`useMcp.ts` only remediates after startup: it reads `mcpEnabledByServer`
from webview-local `vscodeApi.getState()` and posts `connectMcp`/
`disconnectMcp` when a status snapshot arrives.

OpenCode config facts this design relies on (verified against OpenCode docs
and config source):

- `OPENCODE_CONFIG_CONTENT` is the "inline config" layer (priority 6) and is
  deep-merged over global and project config, so an overlay can add a `mcp`
  section without replacing the user's other config.
- MCP servers live under a flat `mcp.<name>` map. `"<name>": { "enabled":
  false }` is the documented way to disable an inherited server without
  redefining its command/env/headers — exactly what a secret-free overlay
  needs.
- Config sources searched by a project: global config dir
  (`opencode.json`/`opencode.jsonc`), project `opencode.json`/`opencode.jsonc`
  (walked up from the working directory), `.opencode` dirs, plus managed
  config layers the extension cannot override.

## Goals / Non-Goals

**Goals:**

- The Chat companion starts with zero unselected MCP children on first use,
  and only user-selected servers start.
- The per-server Chat selection lives in workspace-scoped host state,
  survives companion and extension-host restarts, and stays synchronized
  with the webview store (with one-time migration of pre-existing
  webview-only prefs).
- The startup overlay is secret-free by construction (only `enabled` flags).
- OpenCode config `enabled: false` is a TUI-side default; an explicitly
  selected inventoried Chat server may be enabled by the companion-only
  overlay.
- Identical behavior on the sandboxed and unsandboxed launch paths, with
  fail-closed behavior when inventory cannot be resolved.
- Zero writes to `opencode.json`/`.mcp.json`; independent TUI/CLI unaffected.

**Non-Goals:**

- Changing Gear-panel toggle UX, status normalization, or diagnostics
  shape beyond the config-disabled guard.
- Copying, migrating, or transforming any MCP definition (commands, env,
  headers, URLs, keys) into Chat state.
- Per-MCP sandbox policies, autostart scheduling, or inventory watching.
- Changing the sandbox filesystem/network policy or companion lifecycle.
- Reading managed/MDM config layers or remote `.well-known/opencode` config
  (the overlay only ever disables/enables; anything unlisted keeps its
  inherited state, so unread layers cannot leak processes unless they define
  servers the extension cannot see — see Risks).

## Decisions

### 1. Resolve inventory from config files before launch

Before `connectAgent`, the extension host reads the MCP server names from the
same sources the companion will merge:

- Global config dir (`resolveOpenCodePaths().config`): `opencode.json` +
  `opencode.jsonc`.
- Project config: `opencode.json` + `opencode.jsonc` walked up from the
  workspace root to the nearest `.git` boundary (mirrors OpenCode's project
  search).
- Project `.mcp.json` at the workspace root (union of names; a stale name is
  inert, so including it is the fail-safe direction if the installed OpenCode
  does not load it).

For each name, only two facts are kept: that it exists, and whether any
config layer explicitly sets `enabled: false` (later layers win, matching
OpenCode merge order). Server definitions — command, env, headers, url — are
never read into Chat state. Parsing is JSONC-tolerant (comments, trailing
commas) so valid `opencode.jsonc` files do not false-fail.

Alternatives rejected: starting the companion then deriving the inventory
from `/mcp` status (defeats the purpose — children already started) and
asking OpenCode for config before launch (requires a running server).

### 2. Build a sanitized overlay that only sets `enabled`

`buildMcpOverlay(inventory, prefs)` produces

```jsonc
{ "mcp": { "<server>": { "enabled": true | false } } }
```

for every inventoried server, merged with `CHAT_AGENT_OVERLAY` before
launch. Rules:

- No Chat pref → `enabled: false` (first-use default: nothing starts).
- Chat pref `true` → `enabled: true`, including when the lower-layer config
  explicitly disables the server; the server definition is retained by the
  merge and only its Chat overlay enabled flag is overridden.
- Unknown names (not in inventory) are dropped, never invented.

The overlay is delivered as `createOpencodeServer` config (unsandboxed) or
`OPENCODE_CONFIG_CONTENT` (sandboxed). Because it contains only `enabled`
flags, no secret-scanning step is required; a unit test still asserts the
serialized overlay contains no definition values (no-secret invariant).

### 3. Host state is authoritative; webview store is a synchronized cache

Chat MCP prefs move into `context.workspaceState` under a dedicated key
(e.g. `chatMcpPrefsByServer`), giving workspace-scoped persistence that
survives extension-host restarts — consistent with how the webview store
already behaves per workspace, but durable. The webview store
(`vscodeApi.getState().mcpEnabledByServer`) remains as the immediate UI
cache.

Flow:

- `ready` handler: host sends `mcpPrefs { prefs, locked }` (host state +
  config-locked server names). Migration: if host state is empty and the
  webview store has prefs, the host adopts them and sends the adopted map.
- Toggle: `useMcp` updates the webview store and posts `setMcpPrefs { prefs }`;
  the host persists to `workspaceState` and returns the authoritative map via
  `mcpPrefs` (or the existing status flow continues). Re-apply after ready
  stays as convergence for live state (sandbox/network transitions), but
  applies saved preferences to every inventoried server and is no longer the
  primary mechanism — the launch overlay is. The protocol retains
  `locked: []` for compatibility because no server is locked by TUI config
  under this policy.

Automatic re-apply is lifecycle-gated and idempotent. `computeReapplyActions`
may produce a connect action only for `disabled` or `unknown` status; it MUST
not retry `failed`, `needs_auth`, or `needs_client_registration`. A manual
Gear toggle remains an explicit action and may issue `connectMcp` for a failed
or authentication-related server. `useMcp` records the last processed
per-server status/action outcome so an identical host echo cannot repeat the
same connect or disconnect action. The guard is cleared for a fresh
companion/host-pref/ready lifecycle or a genuine status transition, allowing
one saved preference re-apply after restart without timestamps or backoff.

### 4. One overlay path for both launch modes

`OpenCodeLaunchConfiguration` gains a `mcpOverlay` field. `extension.ts`
builds the overlay once per effective launch (at activation and inside
`ChatSandboxController.start`, which already re-creates the launch
configuration on sandbox/network transitions) using the current
`workspaceState` prefs. `opencode-agent.ts` merges
`{ ...CHAT_AGENT_OVERLAY, ...mcpOverlay }` in both `connect()` and
`connectSandboxed()` — parity by construction, and restart restoration
because the controller rebuilds the overlay on every start.

### 5. Fail closed when inventory cannot be resolved

If any inventory source that would contribute server names is unreadable or
unparsable, the extension cannot safely enumerate what to disable, so it
must not launch the companion with the inherited set. Behavior: surface the
existing connect-failure path (reuse `classifyConnectError`-style reporting
and keep the webview provider registered so the sidebar shows an error, as
the `database is locked` path already does), do not start a companion, and
never fall back to an unfiltered launch. No overlay for names that were
never read means no MCP child may start that the filter would have disabled
— there is simply no companion, which is strictly safer than a partial
filter.

### 6. TUI-only defaults and Chat overlay ownership

OpenCode config `enabled: false` governs independent TUI/CLI startup only.
For Chat, no preference means disabled, while an explicit true Chat
preference sets `enabled: true` for that inventoried server in the
companion-only overlay. The overlay must not replace the inherited server
definition, write config files, or affect TUI/CLI processes. Host and webview
re-apply operate on every inventoried server; they carry `locked: []` on the
existing wire shape for compatibility.

### 7. Keep the overlay out of diagnostics and out of disk

`redactDiagnostic` already masks `OPENCODE_CONFIG_CONTENT`; the agent's
bounded stdout/stderr capture is unchanged. No new write path is added: the
`setModel` config-file workaround and `openConfigFile` behavior are
untouched, and tests assert `opencode.json`/`.mcp.json` mtimes/content are
unchanged across a full toggle+restart cycle.

### 8. Converge preferences without retry storms

The re-apply loop is a best-effort convergence step, not a retry scheduler.
It treats `disabled` and `unknown` as states eligible for one automatic
connect, while failed startup and authorization/registration states stop
automatic retries until the user explicitly toggles the Gear control. A
per-server snapshot/action guard suppresses duplicate connect/disconnect
messages from identical status echoes, and a fresh host-pref/ready lifecycle
or real status transition resets the relevant guard. This prevents repeated
npm/npx child spawns, especially under the sandbox, while preserving sticky
restart convergence. Existing bounded diagnostics and MCP error output remain
visible to the user.

## Risks / Trade-offs

- [Version drift] If the installed OpenCode changes overlay merge semantics
  (e.g. `mcp.<name>` per-server replace instead of deep merge), an overlay
  entry could clobber a server's definition or fail to override a lower-layer
  `enabled: false`. Mitigation: explicitly verify that the inline overlay can
  override the disabled flag without replacing the server definition; any
  deviation fails the no-secret/no-clobber tests before release.
- [Unread config layers] Remote `.well-known/opencode`, managed, and MDM
  config layers are not read by the inventory; a server defined only in those
  layers would not be filtered and could start. Mitigation: documented
  limitation (managed config is admin-owned and rare for this audience); the
  Gear panel remains available to disconnect it manually, and the fail-closed
  requirement applies to the layers Chat can read.
- [Migration data loss] A buggy first-ready migration could adopt stale
  webview prefs or drop host prefs. Mitigation: migration only when host
  state is empty; host→webview `mcpPrefs` push re-converges the webview
  store; tests cover both store-order combinations.
- [Startup regression] New launch-time file reads could fail on unusual
  config layouts. Mitigation: JSONC-tolerant parsing, fail-closed error path
  that keeps the webview visible, and recovery-by-reload.
- [UI semantics] Unselected servers now show `disabled` at startup instead
  of `connected`, changing what users see on first open. Mitigation:
  README/panel documentation; toggle UX unchanged.
- [Re-apply spawn storm] A failed local MCP can be echoed repeatedly by the
  host; unconstrained automatic connects would repeatedly spawn npm/npx
  children. Mitigation: lifecycle gating plus deterministic per-server
  snapshot/action idempotence, with a fresh companion reset preserving one
  sticky reapply. Sandbox diagnostics and error output remain visible.

## Migration Plan

1. Add protocol messages and the launch-config `mcpOverlay` field (core +
   agent types) behind additive types only — no behavior change yet.
2. Add the inventory/overlay module with unit tests (precedence, jsonc,
  preference precedence, no-secret invariant).
3. Merge the overlay into both agent launch paths; agent tests assert parity
   and merge content.
4. Add host workspace-state persistence, `ready`-time migration, and
   `mcpPrefs`/`setMcpPrefs` handling with `locked: []`.
5. Wire webview sync (adopt host prefs and notify host on toggle) with
   `useMcp` tests.
6. Fail-closed inventory handling in `extension.ts` with host tests.
7. Update READMEs and, after implementation and verification, sync
   `openspec/specs/chat-mcp-settings/spec.md` from this delta.
8. Focused tests → `npm run check` → `npm run build` → VSIX package +
   install → live verification (zero children first run, sticky selection,
   restart restoration, Chat-selected TUI-disabled servers, TUI isolation, both
   sandbox modes).

Rollback: preferences remain in webview state during the transition window
and the overlay is an additive launch-config field, so reverting the host
changes restores the current post-start re-apply behavior without touching
`opencode.json`.

## Open Questions

None. `.mcp.json` support by the installed OpenCode version is a
verification point, not a design fork: including its names in the inventory
is harmless if unsupported (inert overlay entries) and required if
supported, so the design covers both outcomes.
