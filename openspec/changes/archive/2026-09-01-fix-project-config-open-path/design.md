# Design

## Goals / Non-Goals

**Goals:**

- The Project Config link opens `<workspace>/.opencode/opencode.json`, the
  file OpenCode actually reads as project-local config.
- No stray `opencode.json` at the workspace root.

**Non-Goals:**

- Changing the Global Config link, the `openConfigFile` protocol message, or
  the host `VscodePlatformServices.openConfigFile` create-if-missing flow.
- Any other settings panel changes.

## Decisions

### 1. Fix the path at the webview call site

`ToolConfigPanel` receives `paths.directory` (the workspace root) in the
`toolConfig`/`init` message. The Project Config link currently sends
`${paths.directory}/opencode.json`; change it to
`${paths.directory}/.opencode/opencode.json`. The Global Config link stays
`${paths.config}/opencode.json`.

Rationale: the webview already knows the workspace root; the protocol and host
layers are correct and shared with Global Config. No new protocol message is
needed.

Rejected: resolving the config path host-side per click — adds a round trip and
state for no benefit, and the host's create-if-missing flow is already the
desired behavior for a genuinely missing local config.

## Risks

- Projects that intentionally keep an `opencode.json` at the workspace root
  (OpenCode also reads that) will now reach `.opencode/opencode.json` from the
  button. This is the requested behavior; the root file is never deleted.

## Rollout

Single small change; no migration, no compatibility flag.

## Compatibility Impact

- Webview scenario test `09-settings` expectation for Project Config changes.
- No protocol or host changes; Global Config unaffected.
