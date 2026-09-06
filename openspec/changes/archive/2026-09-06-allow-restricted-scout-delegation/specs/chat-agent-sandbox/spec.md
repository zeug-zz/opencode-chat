## MODIFIED Requirements

### Requirement: Agent and execution boundaries remain explicit

Sandbox compatibility MUST NOT broaden agent-level tool permissions or expose alternate code or shell execution to Scout or the Markdown-only Chat report writer. Scout SHALL remain research/read-only except for restricted delegation to the exact injected `chat-research-worker` research profile. The worker SHALL remain read-only and SHALL not edit, execute shell commands, recurse through task, or use unapproved MCP tools. The report writer SHALL only write Markdown reports, and full coding SHALL require the explicit user-controlled `open in tui` handoff. Context-mode plugin/tool profiles and Bun bootstrap are deferred to a separate change and MUST NOT be implemented in this compatibility change.

#### Scenario: Compatibility does not broaden Scout or report-writer execution

- **WHEN** Chat sandbox compatibility is enabled
- **THEN** Scout SHALL retain read-only research behavior
- **AND** Scout SHALL be able to delegate only to the exact injected `chat-research-worker`
- **AND** Scout SHALL not delegate coding, shell, package, terminal, or arbitrary-agent work
- **AND** the delegated worker SHALL retain its read-only tool boundary
- **AND** the Markdown-only report writer SHALL remain limited to writing Markdown reports
- **AND** neither Scout nor the report writer SHALL receive alternate code or shell execution through the compatibility layer

#### Scenario: Coding remains an explicit TUI handoff

- **WHEN** full coding is required from Chat
- **THEN** the user-controlled `open in tui` handoff SHALL remain the coding boundary
- **AND** context-mode plugin/tool profiles and Bun bootstrap SHALL not be implemented as part of this compatibility change
