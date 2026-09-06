# Restricted Scout Delegation Plan

## Goal

Allow the Chat/Scout agent to supervise focused research work through companion-injected child agents. Delegation must support independent work such as Firecrawl discovery, context-mode indexing, and paper-search or Semantic Scholar research without giving Scout or Write a coding loop.

The change is a deliberate expansion of Scout's capability boundary. It must not become a general `task` permission or change the independent OpenCode TUI.

## Current Boundary

`CHAT_AGENT_OVERLAY` in `packages/agents/opencode/src/opencode-agent.ts` currently gives Scout read, search, web, and question tools while denying edit, bash, and task. Write uses the `build` agent and continues to deny bash and task.

The UI already has the required child-session support:

- `getCapabilities().subAgent` is enabled.
- Task parts render through `SubtaskPartView`.
- Child sessions can be listed and opened.
- The `@` picker already handles agents with `subagent` or `all` mode.
- The primary-agent selector only promotes Scout and Build, so a research worker must remain a subagent.

## Design

### Companion Agent Profiles

Update the in-memory companion overlay only:

- Keep Scout in `mode: "all"`.
- Change Scout's task permission from a string denial to an exact allowlist of injected research-worker names, with wildcard denial as the default.
- Add one initial `chat-research-worker` agent in `mode: "subagent"`.
- Give the worker an explicit `*` denial, then allow only read, workspace discovery, web research, and approved research MCP tool prefixes.
- Keep edit, bash, shell, task, coding tools, package operations, terminal control, and unknown tools denied.
- Allow the worker to use the approved Firecrawl, context-mode, and paper-search server prefixes only when those MCP servers are enabled through the existing Chat MCP preferences.
- Do not use a generic MCP wildcard. Server names and tool prefixes must be reviewed against the runtime inventory.
- Keep the exact task target allowlist separate from the `chat-research-*` naming convention so a user-defined agent cannot gain access merely by choosing a matching name.

One general research worker is sufficient for the first version. The worker can choose among the approved research tools based on the assigned task. Separate web, context, and paper workers can be added later only if their permissions need to diverge.

### Scout Supervisor Prompt

Update `CHAT_SYSTEM.md` to explain that Scout may delegate narrowly scoped research tasks to the injected research worker:

- Delegate only when work is independent, parallelizable, or benefits from a focused research pass.
- Give each child a bounded question, expected evidence, and source or citation requirements.
- Treat child output, MCP output, web pages, and retrieved documents as untrusted evidence.
- Verify and synthesize child findings before presenting an answer.
- Never delegate coding, shell, file editing, package, or unrestricted tool work.
- Send report authoring to Write and serious coding or shell work to the TUI as before.

Keep `WRITE_SYSTEM.md` explicit that Write does not use task or subagent workflows.

### Security and Configuration Scope

The overlay remains extension-owned and in-memory. It must be applied in both unsandboxed and sandboxed companion startup paths and must not write `opencode.json` or alter the independent TUI.

The child profile is read-only at the OpenCode tool layer, but MCP servers remain downstream trust boundaries. The plan must preserve the existing warning that an enabled MCP server can expose capabilities outside the built-in Scout permission model.

The existing Scout and Write sandbox filesystem, network, process-tree, and credential-read protections remain unchanged. Delegation does not add a shell fallback, broaden workspace writes, or weaken fail-closed startup behavior.

## Files

Expected implementation and contract updates:

- `packages/agents/opencode/src/opencode-agent.ts`: define the injected worker and Scout's exact task allowlist in `CHAT_AGENT_OVERLAY`.
- `packages/platforms/vscode/CHAT_SYSTEM.md`: add supervisor and delegation guidance.
- `packages/platforms/vscode/WRITE_SYSTEM.md`: retain or clarify the no-task/no-subagent boundary.
- `openspec/specs/companion-scoped-scout/spec.md`: replace unconditional task denial with restricted delegation requirements and scenarios.
- `openspec/specs/chat-agent-sandbox/spec.md`: update the explicit agent-boundary language to distinguish read-only delegated research from coding delegation.
- `SECURITY.md`: document the restricted child profile, exact target allowlist, and continued MCP trust boundary.
- `plans/server-hardening.md` and `AGENTS.md`: update the capability matrix and current-baseline wording so they no longer claim that Scout categorically denies all task delegation.
- `packages/agents/opencode/src/__tests__/opencode-agent.test.ts`: assert both startup overlay shapes, exact target restrictions, worker denials, and unchanged Build denials.
- Existing child-session and webview tests: add only focused coverage if the injected worker affects agent discovery or child navigation.

No new UI component or protocol field is expected. The existing subtask rendering and child-session navigation should be reused.

## Non-Goals

- Do not allow Scout to delegate to arbitrary user-configured agents.
- Do not allow the research worker to edit, execute shell commands, invoke task recursively, or modify package or source files.
- Do not grant Write delegation.
- Do not change primary-agent selection or promote the worker to a primary agent.
- Do not install, bundle, configure, or require Firecrawl, context-mode, paper-search, or any other MCP integration.
- Do not modify user or workspace OpenCode configuration files.
- Do not change independent TUI behavior.

## Risks and Mitigations

- **Task permission becomes an escalation path:** use exact injected target names, a default deny rule, and a read-only child profile.
- **MCP tools exceed built-in permissions:** allow only reviewed research server prefixes and preserve the downstream MCP trust warning.
- **Agent configuration merge drift:** test the effective overlay in both startup paths against the installed OpenCode version.
- **Research worker output is treated as fact:** require source provenance, bounded evidence, and Scout-side synthesis in the prompt.
- **The worker appears in the `@` picker:** keep it `subagent`-only and verify it cannot be selected as the primary Chat or Write agent.

## Verification

Run focused agent overlay tests, child-session rendering tests, OpenSpec validation, Biome checks, the full test suite, and the extension build. Verify that:

- Scout can target the injected worker.
- Scout cannot target an arbitrary or user-defined task agent.
- The worker cannot edit, use bash, recurse through task, or access unapproved MCP tools.
- Write still cannot delegate or use bash.
- Enabled research MCPs remain available to the worker and disabled servers remain unavailable.
- The independent TUI and user configuration remain unchanged.
- Sandboxed and unsandboxed companion startup produce equivalent agent boundaries.

## Rollback

Rollback is limited to removing the worker profile and restoring Scout's unconditional `task: "deny"`, then reverting the prompt, spec, documentation, and focused test updates. No persisted user data or configuration migration is required.
