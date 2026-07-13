## Why

OpenCode Chat currently depends on users adding `agent.scout` to their global or project OpenCode configuration before the server advertises a selectable Scout agent. That makes the companion's `chat` agent unavailable on a clean install and, when configured globally, exposes an extra Scout agent in the user's independent TUI.

## What Changes

- Start the companion-owned OpenCode server with an SDK in-memory configuration that creates a read-only `scout` agent in `all` mode.
- Keep the overlay scoped to the server process started by the VS Code extension; never create, rewrite, or merge `opencode.json` as part of activation or VSIX installation.
- Let the existing agent discovery receive the injected Scout and default the companion to `chat` (`scout`) while retaining `build` as the alternate agent.
- Preserve prompt-level model selection, so the GUI model selector overrides Scout's fallback model without requiring a Scout model in user config.
- Remove the uncommitted, incorrect behavior that selected a server-returned Scout even when its mode was `subagent`; the companion overlay guarantees its own Scout is `all`.

## Capabilities

### New Capabilities

- `companion-scoped-scout`: The VS Code companion provides its own server-scoped, user-selectable Scout chat agent without persisting OpenCode configuration changes.

### Modified Capabilities

- `primary-agent-selection`: Continue to prefer Scout when it is an eligible primary or `all` agent, relying on the companion-scoped overlay rather than user-managed configuration.

## Impact

- `packages/agents/opencode/src/opencode-agent.ts` server startup and its tests.
- VS Code initialization behavior/tests and the current agent-selection delta spec.
- No user global/project OpenCode config writes, no TUI agent configuration changes, and no protocol API changes.