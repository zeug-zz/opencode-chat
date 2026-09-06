## Context

See `proposal.md` for motivation and scope. The extension already builds one in-memory Chat overlay and passes it to both the SDK-managed unsandboxed server and the explicitly spawned sandboxed server. OpenCode permission rules support ordered wildcard patterns for both built-in tools and MCP tool IDs, while the existing Chat MCP overlay controls which inventoried servers are enabled. The webview already renders OpenCode task parts and navigates to subagent sessions, so this change does not need a protocol or UI path.

The reviewed runtime inventory identifies `firecrawl`, `context-mode`, and `paper-search` as the research-server names to expose. Their OpenCode tool IDs use the corresponding `firecrawl_*`, `context-mode_*`, and `paper-search_*` permission prefixes. Other configured servers, including `context7`, remain outside this initial worker role map.

## Goals / Non-Goals

**Goals:**

- Make one extension-injected `chat-research-worker` available only as a subagent.
- Give Scout an exact task target allowlist with a wildcard denial fallback.
- Keep the worker read-only at the OpenCode tool layer while allowing reviewed research MCP prefixes when the existing Chat preference enables those servers.
- Apply identical agent boundaries to unsandboxed and sandboxed companion startup.
- Preserve existing child-session rendering/navigation and independent TUI/configuration behavior.
- Align prompts, security documentation, capability matrices, specs, and regression tests with the enforced boundary.

**Non-Goals:**

- A general Scout task permission, arbitrary configured-agent delegation, or a naming-pattern-based target grant.
- Write delegation, worker recursion, edit/bash/shell/package/terminal access, or a new coding workflow.
- New MCP servers, MCP installation/configuration, generic MCP wildcards, or a per-server filesystem/network allowlist.
- Changes to primary-agent selection, the webview protocol, the independent TUI, sandbox lifecycle, filesystem policy, network policy, or persisted OpenCode configuration.

## Decisions

### 1. Keep the policy in the existing extension-owned overlay

Add the worker and Scout task rules to `CHAT_AGENT_OVERLAY`, then continue merging that constant with the existing MCP and guidance overlays. This keeps the policy code-owned, process-scoped, and shared by both launch paths. Adding a host delegation API or changing the SDK is unnecessary because OpenCode's native `task` tool and existing child-session support already provide the behavior.

Scout's task rule is an ordered object with `"*": "deny"` first and the exact `"chat-research-worker": "allow"` rule second. The exact target is deliberately separate from the `chat-research-*` naming convention so a user-defined similarly named agent cannot be selected. Scout's current direct read/search/web/question permissions and explicit edit/bash denials remain otherwise unchanged.

### 2. Use one minimal subagent profile

Inject `chat-research-worker` with `mode: "subagent"` and a research-specific description. Its permission object starts with `"*": "deny"`, then allows only `read`, `glob`, `grep`, `list`, `webfetch`, `websearch`, and the three reviewed MCP prefixes. It has no model or prompt override, so normal model selection and existing prompt flow remain request-level behavior. The worker does not receive `question`, `todowrite`, `skill`, `edit`, `bash`, or `task`; the catch-all denial covers those and future or unknown tools.

Separate server startup from tool exposure: `buildMcpOverlay` continues to emit only inventoried server names and enabled booleans from Chat preferences. A reviewed prefix is useful only when the matching server is enabled and exposes a tool; no generic MCP wildcard is added. This preserves the downstream MCP trust warning because tool permission does not certify an MCP implementation or its output.

### 3. Reuse existing child UI and agent discovery

The worker's `subagent` mode lets existing agent metadata and `@`-picker behavior discover it without promoting it to the primary Chat or Write selector. Existing task-part rendering and child-session navigation remain unchanged. No new core type, host message, SDK method, or UI component is introduced.

### 4. Keep sandbox parity structural

The current `buildChatOverlay` result is used for both `createOpencodeServer({ config })` and sandbox `OPENCODE_CONFIG_CONTENT`. Updating the shared constant rather than one launch branch makes the worker and Scout target restrictions equivalent by construction. The worker remains subject to the existing sandbox process-tree, filesystem, network, credential-read, fail-closed, and diagnostic behavior; delegation does not create a shell fallback or broaden those policies.

### 5. Make prompts and documentation describe the real boundary

`CHAT_SYSTEM.md` will instruct Scout to delegate only bounded, independent research passes, require evidence/provenance and source or citation expectations, treat child/MCP/web output as untrusted, verify and synthesize results, and refuse coding/shell/file/package delegation. It will direct report authoring to Write and serious coding or shell work to the TUI. `WRITE_SYSTEM.md` will state explicitly that Write does not use task or subagent workflows.

`SECURITY.md`, `AGENTS.md`, and `plans/server-hardening.md` will replace categorical Scout task-denial wording with the exact restricted research exception while preserving the MCP trust, Write non-delegation, and TUI handoff warnings. Documentation will not imply that the read-only worker makes downstream MCPs safe.

## Risks / Trade-offs

- **Exact task rule is weakened by config merge drift** → Assert the effective object and both serialized launch paths in focused tests; keep the shared overlay as the only source.
- **A user-defined agent is mistaken for the worker** → Allow only the exact injected target, not the `chat-research-*` naming pattern, and test near-miss names.
- **MCP tools exceed their declared research role** → Allow only reviewed server prefixes, require existing Chat server enablement, retain the downstream MCP trust warning, and keep sandbox policy unchanged.
- **Worker or task metadata affects UI selection** → Keep mode `subagent` and test that primary-agent allowlists remain Scout/Build only; reuse existing task rendering.
- **Future tools are silently exposed** → Worker uses an explicit catch-all denial and no generic MCP wildcard.
- **Child research output is treated as instruction** → Prompt guidance requires untrusted-data handling, bounded questions, provenance, verification, and synthesis.
- **A sandboxed branch diverges from normal startup** → Test the same expected overlay in unsandboxed config and sandbox environment content.

## Migration Plan

No user migration or persisted configuration change is required. On upgrade, the extension-owned companion overlay gains the worker; existing Chat MCP preferences continue to determine server startup, and the independent TUI reads the same user/project configuration as before. Rollback removes the worker profile and restores Scout's `task: "deny"`, then reverts the prompt, spec, documentation, and focused test changes. No archive, commit, or configuration-file write is part of implementation.

## Open Questions

None. The worker name, approved server prefixes, exact target rule, and launch-path parity are fixed by `plans/delegation.md` and the reviewed runtime inventory.
