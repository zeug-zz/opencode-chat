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
- MCP server trust boundaries (Scout agent permissions)

## MCP Server Trust Model

The OpenCode Research extension launches an extension-owned OpenCode server with a read-only Scout agent
(`packages/agents/opencode/src/opencode-agent.ts`). The Scout config overlay denies edit, bash,
and task permissions. However:

- **MCP servers remain untrusted.** Local MCP processes launched by the sandboxed server
  inherit its process, filesystem, and network restrictions; remote MCPs follow the network
  policy. If you connect MCP servers with command execution capabilities (e.g., aws-mcp-server),
  the agent may invoke tools on those servers. The July 2026 threat landscape includes active
  command injection CVEs in MCP tooling (CVSS 9.8).
- **Treat MCP server input as untrusted.** Verify tool permissions on all connected MCP servers.
- **The Scout read-only overlay is defense-in-depth**, not a sandbox. It limits the Scout
  agent itself; downstream tool execution through MCP servers is the user's responsibility.

## Extension Write Boundary and Coding Handoff

The extension's user-facing Write mode is backed by OpenCode's `build` agent, with behavioral
guidance to produce requested artifacts. Its broad workspace-scoped edit capability is not a
technical report-only path boundary. Write does not receive agent-level Bash or task/subagent
execution. This boundary applies to the extension-owned server process and does not change the independent
OpenCode TUI's normal Build behavior.

For serious coding or shell work, use the existing terminal handoff to open the active session
in an independent OpenCode TUI process. The extension remains available, but terminal handoff
is the supported coding escape hatch rather than an unrestricted command runner in the chat UI.

## Chat Sandbox Filesystem Baseline

When Chat sandboxing is active on macOS or Linux, the extension-owned server process tree uses a static,
versioned protected-read baseline covering common credential stores, shell history and
configuration, browser data, and platform-specific keychain and private application data.
Reads outside that baseline remain broad to support local MCPs and installed runtimes and
dependencies. Writes remain constrained to the documented workspace, OpenCode, runtime, and
temporary paths.

The current versioned, reviewed expansion adds narrow leaves rather than broad
parent denies. The selected additions are:

- Additional cross-platform credential/private-key leaves: `.claude.json`,
  `.claude/.credentials.json`, `.codex/auth.json`, `.gemini/oauth_creds.json`,
  `.electrum`, `.android/adbkey`, and `.android/adbkey.pub`.

- Cross-platform credential/config: `.config/gh/hosts.yml`,
  `.config/glab-cli/config.yml`, `.config/rclone/rclone.conf`,
  `.config/containers/auth.json`, `.pypirc`, `.cargo/credentials`,
  `.cargo/credentials.toml`, `.config/sops/age/keys.txt`, and
  `.config/age/keys.txt`.
- Cross-platform shell data: `.local/share/fish/fish_history`, `.config/atuin`,
  `.config/nushell`, `.local/share/nushell`, `.zsh_sessions`, and
  `.bash_sessions`.
- macOS: `Library/Application Support/Google/Chrome Beta`,
  `Library/Application Support/Google/Chrome Canary`,
  `Library/Application Support/Microsoft Edge Beta`,
  `Library/Application Support/Microsoft Edge Canary`,
  `Library/Application Support/com.operasoftware.Opera GX`,
  `Library/Application Support/Orion`, `Library/Application Support/LibreWolf`,
  `Library/Application Support/Waterfox`,
  `Library/Application Support/Bitwarden`,
  `Library/Application Support/Proton Pass`,
  `Library/Application Support/KeePassXC`, `Library/Calendars`,
  `Library/AddressBook`, `Library/Notes`, `Library/Accounts`,
  `Library/IdentityServices`, `Library/Application Support/Signal`, and
  `Library/Thunderbird`.
- Linux: `.config/google-chrome-beta`, `.config/google-chrome-unstable`,
  `.config/chromium-browser`, `.config/ungoogled-chromium`,
  `.config/librewolf`, `.config/waterfox`, `.config/qutebrowser`,
  `.config/falkon`, `.config/tor`, `.config/kwalletd`, `.config/keepassxc`,
  `.config/Signal`, `.config/Nextcloud`, `.thunderbird`, and
  `.config/evolution`.

The inventory is intentionally not exhaustive and is subject to later review.
These are narrow reviewed paths only: the baseline is not a whole-home deny and does not deny generic `.config`, generic application-support data, generic `.android`, `.codex`, or `.gemini` parents, other-user homes, or external volumes. The `.config/op` entry is not `.config/opencode`; required OpenCode configuration and provider-authentication data remain available.
Required read grants that exactly overlap, contain, or are contained by a
protected path fail closed before launch; the deny is not removed, the grant is
not broadened, and no unsandboxed retry occurs. The complete extension-owned server process
tree, including local MCP descendants, inherits the baseline, so an MCP that
intentionally reads a newly protected path may be affected.

Outside the protected leaves, existing compatibility behavior remains: reads
stay broad, while writes remain available for permitted workspace, OpenCode,
runtime-cache, and temporary paths.

This is targeted defense-in-depth, not strict confidentiality. Broad compatibility reads remain,
and network-enabled sandbox mode can allow a readable local MCP or other process to transmit data
it can read. The baseline does not promise protection against a malicious process.

Windows does not enforce this read baseline. Chat reports sandboxing as unsupported and uses the
existing unsandboxed path there; the Windows path must not be treated as providing sandbox
read-deny protection.

For supported sandbox launches, the extension host records bounded, redacted diagnostics for sandbox startup/readiness failures, unexpected extension-owned server exits, and failed MCP operations when runtime information is available. Existing
user-visible diagnostics remain bounded, redacted, and transport-aware: exposed
denial wording such as `EPERM`, `EACCES`, or `Operation not permitted` is
retained, while opaque errors remain opaque. Secret values, file contents,
authorization material, environment/configuration data, and request payloads
are not logged. Process-tree inheritance, write containment, network behavior,
MCP compatibility outside the baseline, fail-closed overlap and
no-unsandboxed-fallback semantics, and the Scout/Write/Build boundaries remain
unchanged. The explicit `off` mode remains the compatibility fallback; there is
no MCP-specific exception, reports directory, or exact report-path restriction.

## Accepted Risks

| Date       | Finding | Severity | Rationale |
|------------|---------|----------|-----------|
| 2026-07-10 | —       | —        | All audit modes cleared 0 findings. Threat landscape assessed — no stack-relevant actively exploited CVEs. |

## Audit Trail

Security audits are recorded in `scripts/security/last-audit.json`.
Latest audit: **2026-07-10** (workspace, mode: all) — 0 findings, 0 CVEs.
Threat-monitor risk assessments: `plans/security/risk_assessment-*.md`.
Pre-commit hooks: installed (gitleaks v8.30.1).
