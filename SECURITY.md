# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| main    | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Report via GitHub private vulnerability reporting:
https://github.com/zeug-zz/opencode-chat/security/advisories/new

Expect a response within 72 hours. Please include:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Any potential mitigations you've identified

## Scope

This policy covers:
- The application code and its dependencies
- API key handling and configuration management
- CI/CD pipeline security
- Dependency supply chain (pnpm/npm)
- VS Code extension security (webview ↔ host message protocol)
- MCP server trust boundaries (Scout companion agent permissions)

## MCP Server Trust Model

The OpenCode Chat extension launches a companion OpenCode server with a read-only Scout agent
(`packages/agents/opencode/src/opencode-agent.ts`). The Scout config overlay denies edit, bash,
and task permissions. However:

- **User-installed MCP servers are not sandboxed.** If you connect MCP servers with command
  execution capabilities (e.g., aws-mcp-server), the agent may invoke tools on those servers.
  The July 2026 threat landscape includes active command injection CVEs in MCP tooling (CVSS 9.8).
- **Treat MCP server input as untrusted.** Verify tool permissions on all connected MCP servers.
- **The Scout read-only overlay is defense-in-depth**, not a sandbox. It limits the companion
  agent itself; downstream tool execution through MCP servers is the user's responsibility.

## Companion Write Boundary and Coding Handoff

The companion's user-facing Write mode is backed by OpenCode's `build` agent, but its
companion permissions are limited to reading files, searching the workspace, configured web
research, and editing requested report files. Write does not receive agent-level Bash or
task/subagent execution. This boundary applies to the companion process and does not change
the independent OpenCode TUI's normal Build behavior.

For serious coding or shell work, use the existing terminal handoff to open the active session
in an independent OpenCode TUI process. The companion remains available, but terminal handoff
is the supported coding escape hatch rather than an unrestricted command runner in the chat UI.

## Chat Sandbox Filesystem Baseline

When Chat sandboxing is active on macOS or Linux, the companion process tree uses a static,
versioned protected-read baseline covering common credential stores, shell history and
configuration, browser data, and platform-specific keychain and private application data.
Reads outside that baseline remain broad to support local MCPs and installed runtimes and
dependencies. Writes remain constrained to the documented workspace, OpenCode, runtime, and
temporary paths.

This is targeted defense-in-depth, not strict confidentiality. Broad compatibility reads remain,
and network-enabled sandbox mode can allow a readable local MCP or other process to transmit data
it can read. The baseline does not promise protection against a malicious process.

Windows does not enforce this read baseline. Chat reports sandboxing as unsupported and uses the
existing unsandboxed path there; the Windows path must not be treated as providing sandbox
read-deny protection.

## Accepted Risks

| Date       | Finding | Severity | Rationale |
|------------|---------|----------|-----------|
| 2026-07-10 | —       | —        | All audit modes cleared 0 findings. Threat landscape assessed — no stack-relevant actively exploited CVEs. |

## Audit Trail

Security audits are recorded in `scripts/security/last-audit.json`.
Latest audit: **2026-07-10** (workspace, mode: all) — 0 findings, 0 CVEs.
Threat-monitor risk assessments: `plans/security/risk_assessment-*.md`.
Pre-commit hooks: installed (gitleaks v8.30.1).
