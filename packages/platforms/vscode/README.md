# OpenCode Research

> **Historical lineage:** Originally forked from [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui). This package is now maintained as the distinct OpenCode Research extension focused on research and writing.

An unofficial VS Code chat, research, and report-writing extension for [OpenCode](https://github.com/anomalyco/opencode), designed to sit alongside the OpenCode TUI rather than replace it.

OpenCode TUI と併用するための、調査とレポート執筆を中心とした非公式 VS Code 拡張機能。

## Table of Contents / 目次

- [English](#english)
- [日本語](#japanese)

<a id="english"></a>

## English

### OpenCode Research

A research-first OpenCode **chat and writing harness** for VS Code. It runs beside the OpenCode TUI: Scout-based **chat** for reading, reasoning, and research; Build-backed **write** for sourced reports and requested file edits; serious coding stays in the TUI via clean handoff.

> **This is an unofficial, community-developed extension. It is not affiliated with or endorsed by the OpenCode project.**

> [!CAUTION]
> **Disclaimer:**
> This project is experimental and developed primarily through AI-assisted coding. It is provided "as-is" without warranty of any kind. It may contain unexpected behavior, unconventional implementations, or undiscovered defects. Use at your own risk. The authors assume no liability for any damages arising from the use of this software.

### Demo

![Demo](https://raw.githubusercontent.com/zeug-zz/opencode-chat/main/packages/platforms/vscode/media/demo.gif)

### Features

The current product is intentionally focused on **chat + research + writing**, not a clone-of-Cline coding loop. Its prompts, permissions, extension-owned server, MCP controls, and terminal handoff have diverged substantially from the original GUI.

#### What makes this different

- **Scout-first chat** — Default primary agent is OpenCode **Scout** (shown as **chat**): read, reason, and research with edit and shell access denied.
- **Write for requested artifacts** — The user-facing **write** mode is backed by OpenCode Build internally, but has a report-authoring prompt and behavioral requested-artifact guidance within its broad workspace-scoped edit capability. It is not a coding-agent mode.
- **Separate chat and write prompts** — Chat and Write have distinct system prompts so research conversation and report production remain deliberate and predictable.
- **Extension-owned OpenCode server** — The extension starts its own `opencode serve` process and injects its behavior in memory. It does not rewrite global `opencode.json`; the independent TUI keeps its normal config and agents.
- **Research MCP, chat-scoped** — On first Chat use, all inherited MCPs are disabled/unselected, so no unselected MCP child starts; only an explicit Gear-panel selection starts one. Per-server Gear selections are workspace-scoped and sticky across the Chat extension, sandbox/network, and VS Code/extension-host restarts. An OpenCode config `enabled: false` is a TUI-side default only: Chat’s explicit selection may enable that inventoried server through the extension's in-memory overlay, while unselected servers remain off. Config files are never rewritten, and the independent OpenCode TUI/CLI remains unaffected. If Chat cannot resolve its MCP inventory because config is unreadable or unparsable, it fails closed and reports unavailable with a visible error; repair the config and reload to recover.
- **Compatibility Chat sandbox** — The optional Chat sandbox applies one inherited process boundary to the extension's OpenCode server, local MCPs, remote MCP traffic, and descendants. On macOS and Linux, it also applies a static, versioned protected-read baseline for common credentials, shell history/configuration, browser data, and platform-specific keychain/private data. Reads outside that baseline remain broad for compatibility with local MCPs and installed runtimes/dependencies, while writes stay constrained to documented workspace, OpenCode, runtime, and temporary paths. Windows is unsupported: Chat reports the unsupported status and uses its existing unsandboxed path.
- **Hand off to full TUI** — Export the session and open an independent OpenCode TUI while chat **stays running**. The TUI is the only supported path for serious coding, shell work, and unrestricted Build workflows.
- **Thinking models that actually stream** — Stable CoT / reasoning display for thinking models (no blanking/flicker mid-stream).
- **Research-grade message surface** — Markdown with KaTeX math, Mermaid, syntax-highlighted code, and **copy as Markdown** on replies.
- **Effort + model UX built for many providers** — Searchable models, sticky per-model effort variants, recent-models strip, collapsed providers by default.
- **Context awareness** — In-input context/token chip so long research threads stay legible.
- **Secure-by-default posture** — Secret scanning, SAST, dependency audit, SHA-pinned CI actions, explicit Scout/Write denials, and a documented MCP trust boundary. When Chat sandboxing is enabled, local MCPs inherit the extension process and write boundary.

#### Complete research workspace (essentials)

Streaming chat, sessions, permissions/questions, file chips and diffs, undo/redo, skills, i18n (8 locales), sound cues, model effort controls, context awareness, MCP settings, and the OpenCode-native message surface — kept sharp for research and writing instead of codebase churn.

#### Chat sandbox compatibility

Enable Chat sandboxing from the gear settings in the Chat panel. The existing
`inherit`, `on`, and `off` modes control the extension's OpenCode server, while
**Allow network access** applies to the entire extension process tree.

This is a compatibility-first, targeted defense-in-depth sandbox rather than
strict filesystem confidentiality:

- Local MCPs inherit the sandbox automatically. No server-specific path setup
  is required for installed Node, Python, uv, Bun, or other runtimes.
- On macOS and Linux, reads in the static protected baseline are denied. Reads
  outside it remain broad so ordinary MCP configurations and installed runtime
  dependencies can start.
- Writes remain constrained to the active workspace and required OpenCode,
  cache, and temporary paths.
- Disabling network access prevents remote provider and MCP requests inside the
  sandbox. Enabling it permits network use for the companion and its MCP
  descendants.
- Network-enabled compatibility mode does not protect readable credentials
  from a local MCP or prevent a readable process from transmitting data. It
  does not promise protection against a malicious process.
- Windows does not enforce this read baseline. Chat reports sandboxing as
  unsupported there and uses the existing unsandboxed path.

The current expansion adds these exact home-relative credential and private-key leaves on supported macOS/Linux: `.claude.json`, `.claude/.credentials.json`, `.codex/auth.json`, `.gemini/oauth_creds.json`, `.electrum`, `.android/adbkey`, and `.android/adbkey.pub`. These are narrow reviewed paths, not an exhaustive baseline: it does not deny the whole home, generic `.config`, generic application-support data, generic `.android`, `.codex`, or `.gemini` parents, other-user homes, or external volumes. The `.config/op` entry must not be confused with `.config/opencode`; required OpenCode configuration and provider-authentication data remain available.

The extension host records bounded, redacted diagnostics for supported sandbox startup/readiness failures, unexpected companion exits, and failed MCP operations when runtime information is available. Existing user-visible
diagnostics remain bounded, redacted, and transport-aware; exposed denial
wording is retained, while opaque errors remain opaque, and secrets, payloads,
file contents, and unredacted environment/configuration data are not logged.
Process-tree inheritance, write containment, network behavior, MCP compatibility
outside the baseline, fail-closed overlap and no-unsandboxed-fallback semantics,
and the Scout/Write/Build boundaries remain unchanged. The explicit `off` mode
remains the compatibility fallback; there is no MCP-specific exception,
reports directory, or exact report-path restriction.

The protected list is versioned and reviewed as a conservative first-pass
inventory, not an exhaustive protection promise. In addition to the existing
cross-platform leaves, the current expansion selects these narrow paths:

- Cross-platform credential/config: `.config/gh/hosts.yml`,
  `.config/glab-cli/config.yml`, `.config/rclone/rclone.conf`,
  `.config/containers/auth.json`, `.pypirc`, `.cargo/credentials`,
  `.cargo/credentials.toml`, `.config/sops/age/keys.txt`, and
  `.config/age/keys.txt`.
- Cross-platform shell data: `.local/share/fish/fish_history`, `.config/atuin`,
  `.config/nushell`, `.local/share/nushell`, `.zsh_sessions`, and
  `.bash_sessions`.
- macOS variants/private stores: `Library/Application Support/Google/Chrome Beta`,
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
- Linux variants/private stores: `.config/google-chrome-beta`,
  `.config/google-chrome-unstable`, `.config/chromium-browser`,
  `.config/ungoogled-chromium`, `.config/librewolf`, `.config/waterfox`,
  `.config/qutebrowser`, `.config/falkon`, `.config/tor`, `.config/kwalletd`,
  `.config/keepassxc`, `.config/Signal`, `.config/Nextcloud`, `.thunderbird`,
  and `.config/evolution`.

Outside the protected leaves, existing compatibility behavior remains: reads
stay broad, while writes remain available for permitted workspace, OpenCode,
runtime-cache, and temporary paths.

Required read grants that exactly overlap, contain, or are contained by a
protected path fail closed before launch with an actionable error. The deny is
not removed, the grant is not broadened, and Chat does not retry unsandboxed.
Because the complete companion process tree inherits the policy, including
local MCP descendants, an MCP that intentionally reads a newly protected path
may be affected; no MCP-specific exception is added.

Stronger read isolation and advanced MCP grants are intentionally deferred to a
future strict-sandbox mode.

### Requirements

- [OpenCode](https://github.com/anomalyco/opencode) installed
- LLM provider authentication configured in OpenCode

#### Optional

- [difit](https://github.com/yoshiko-pg/difit) — enables the session diff review feature. Install with `npm install -g difit`.

### Installation

Search for **OpenCode Research** in the VS Code Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**.

### Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/zeug-zz/opencode-chat/blob/main/CONTRIBUTING.md) for details.

### License

[MIT](https://github.com/zeug-zz/opencode-chat/blob/main/LICENSE)
