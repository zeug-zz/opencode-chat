## Why

The AF claim-projection runtime can report dormant on a host where `af` is
installed and working. Discovery (`af-discovery.ts`) scans only four system
roots (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`) plus the
extension host's `PATH`. On the development host `af` 0.1.11 lives at
`~/go/bin/af`; a VS Code window launched from the Dock gets a minimal host
`PATH`, so discovery misses it and the review card stays disabled even though AF
exists. Users who install AF outside the four system roots have no supported way
to point the extension at it.

## What Changes

- Add home-relative approved roots (`~/go/bin`, `~/bin`, `~/.local/bin`) to AF
  discovery, behind the existing host-ownership and executable checks. Root
  order stays deterministic; a second distinct valid candidate still fails
  closed as ambiguous.
- Add an optional host-owned `opencode-chat.vibefeld.afPath` setting. When set,
  the absolute executable path is validated with the same host-ownership and
  executable checks and used directly; an invalid value keeps the runtime
  dormant (bounded `missing-af`) and never falls back silently to discovery.
  When unset, discovery is unchanged.
- Read the setting once at activation and thread it into `resolveAfRuntime`;
  status reads still never re-probe.

### Scope and Non-Goals

Scope: discovery roots, the explicit-path setting and its validation, the single
activation read, and focused tests.

Non-goals: no live controller re-selection without a window reload (deferred;
documented behavior), no adversarial/composition change (planned separately in
`plans/adversarial-review.md`), no `packages/core`, protocol, or webview change,
no response gating or automatic routing, no configuration-file writes, no
`PATH` mutation, and no new user-visible agent, tool, plugin, or MCP surface.

## Capabilities

### New Capabilities

- `vibefeld-af-activation`: host-owned AF executable discovery across system and
  home install roots, plus an explicit validated executable-path setting, with
  unchanged bounded activation semantics.

### Modified Capabilities

(none)

## Impact

- Affected code: `packages/platforms/vscode/src/vibefeld/af-discovery.ts`,
  `af-runtime-resolution.ts`, `vibefeld-settings.ts`, and the single activation
  read in `extension.ts`, with focused tests.
- Affected behavior: on a supported host, discovery now also covers the three
  home install roots and an explicitly configured absolute executable; a host
  without AF keeps the bounded dormant result.
- Compatibility: the discovery result shape, failure reasons, ambiguity
  semantics, activation preflight, and all dormant paths are unchanged; no
  runtime, protocol, or webview behavior changes.
