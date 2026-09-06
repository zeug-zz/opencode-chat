## Why

Scout currently cannot delegate any task, so focused research such as web discovery, context indexing, or paper search must all compete for the supervisor's context. A narrowly allowlisted read-only research worker can parallelize independent evidence gathering without turning Scout into a coding agent, broadening Write, or changing the independent OpenCode TUI.

## What Changes

- Inject one `chat-research-worker` subagent profile into the extension-owned in-memory agent overlay.
- Allow Scout's `task` permission only for the exact injected research-worker target, with wildcard denial as the default; keep arbitrary and user-defined task targets unavailable.
- Give the worker read-only workspace discovery, web research, and reviewed Firecrawl, context-mode, and paper-search MCP prefixes only when those servers are enabled through existing Chat MCP preferences.
- Keep worker edit, shell, bash, recursive task, coding, package, terminal, unknown-tool, and unapproved MCP access denied.
- Add supervisor guidance to `CHAT_SYSTEM.md` and retain an explicit no-task/no-subagent boundary in `WRITE_SYSTEM.md`.
- Update security documentation, capability matrices, and normative OpenSpec requirements to describe restricted delegation and the continuing MCP trust boundary.
- Add focused overlay tests for both companion startup paths, exact target restrictions, worker denials, MCP enablement, unchanged Build/Write boundaries, and independent TUI/config isolation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `companion-scoped-scout`: replace unconditional Scout task denial with exact-target, read-only research delegation while preserving companion-only injection and independent TUI isolation.
- `chat-agent-sandbox`: distinguish read-only delegated research from coding, shell, or unrestricted delegation while preserving sandbox, process-tree, network, and credential-read boundaries.

## Impact

The change affects the in-memory agent overlay in `packages/agents/opencode`, Scout and Write system prompts, security and capability documentation, the two modified capability specs, and focused agent/child-session tests. It adds no protocol field, UI component, SDK dependency, MCP installation, persisted configuration, migration, or independent TUI behavior; existing Chat MCP preferences remain the gate for approved research-server tool prefixes.

## Scope and Non-goals

The scope is one extension-injected research worker and the exact Scout-to-worker delegation boundary. It does not permit arbitrary configured agents, Write delegation, worker recursion or code/shell/package work, primary-agent promotion, new MCP integrations, user/workspace OpenCode configuration changes, or sandbox policy weakening.

## Risks, Fallback, and Compatibility

The principal risks are task-target escalation, MCP capabilities exceeding built-in agent permissions, overlay merge drift, and unverified child evidence. Exact target allowlisting, default denial, reviewed MCP prefixes, equivalent unsandboxed/sandboxed overlays, and source-provenance/synthesis guidance mitigate them. If the boundary cannot be applied safely, rollback removes the worker and restores Scout's unconditional `task: "deny"`; no persisted data migration is required. Existing Scout read/research, Write editing, sandbox behavior, MCP preference flow, and independent TUI behavior remain compatible.
