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

## Accepted Risks

| Date       | Finding | Severity | Rationale |
|------------|---------|----------|-----------|
| 2026-07-10 | —       | —        | All audit modes cleared 0 findings. Threat landscape assessed — no stack-relevant actively exploited CVEs. |

## Audit Trail

Security audits are recorded in `scripts/security/last-audit.json`.
Latest audit: **2026-07-10** (workspace, mode: all) — 0 findings, 0 CVEs.
Threat-monitor risk assessments: `plans/security/risk_assessment-*.md`.
Pre-commit hooks: installed (gitleaks v8.30.1).
