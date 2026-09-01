# OpenCode Chat

> **Historical lineage:** Originally forked from [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui). This package is now maintained as the distinct opencode-chat research and writing companion.

An unofficial VS Code chat, research, and report-writing companion for [OpenCode](https://github.com/anomalyco/opencode), designed to sit alongside the OpenCode TUI rather than replace it.

OpenCode TUI と併用するための、調査とレポート執筆を中心とした非公式 VS Code チャットコンパニオン。

## Table of Contents / 目次

- [English](#english)
- [日本語](#japanese)

<a id="english"></a>

## English

### OpenCode Chat

A research-first OpenCode **chat and writing harness** for VS Code. It runs beside the OpenCode TUI: Scout-based **chat** for reading, reasoning, and research; Build-backed **write** for sourced reports and requested file edits; serious coding stays in the TUI via clean handoff.

> **This is an unofficial, community-developed extension. It is not affiliated with or endorsed by the OpenCode project.**

> [!CAUTION]
> **Disclaimer:**
> This project is experimental and developed primarily through AI-assisted coding. It is provided "as-is" without warranty of any kind. It may contain unexpected behavior, unconventional implementations, or undiscovered defects. Use at your own risk. The authors assume no liability for any damages arising from the use of this software.

### Demo

![Demo](https://raw.githubusercontent.com/zeug-zz/opencode-chat/main/packages/platforms/vscode/media/demo.gif)

### Features

The current product is intentionally focused on **chat + research + writing**, not a clone-of-Cline coding loop. Its prompts, permissions, companion server, MCP controls, and terminal handoff have diverged substantially from the original GUI.

#### What makes this different

- **Scout-first chat** — Default primary agent is OpenCode **Scout** (shown as **chat**): read, reason, and research with edit and shell access denied.
- **Write for reports** — The user-facing **write** mode is backed by OpenCode Build internally, but has a report-authoring prompt and a constrained read/search/web/edit tool boundary. It is not a coding-agent mode.
- **Separate companion prompts** — Chat and Write have distinct system prompts so research conversation and report production remain deliberate and predictable.
- **Companion-owned OpenCode server** — The extension starts its own `opencode serve` process and injects companion behavior in memory. It does not rewrite global `opencode.json`; the independent TUI keeps its normal config and agents.
- **Research MCP, chat-scoped** — On first Chat use, all inherited MCPs are disabled/unselected, so no unselected MCP child starts; only an explicit Gear-panel selection starts one. Per-server Gear selections are workspace-scoped and sticky across Chat companion, sandbox/network, and VS Code/extension-host restarts. An OpenCode config `enabled: false` is a TUI-side default only: Chat’s explicit sticky Gear selection may enable that inventoried server through the companion-only in-memory overlay, while unselected servers remain off. Config files are never rewritten, and the independent OpenCode TUI/CLI remains unaffected. If Chat cannot resolve its MCP inventory because config is unreadable or unparsable, it fails closed and reports unavailable with a visible error; repair the config and reload to recover.
- **Compatibility Chat sandbox** — The optional Chat sandbox applies one inherited process boundary to the companion, local MCPs, remote MCP traffic, and descendants. On macOS and Linux, it also applies a static, versioned protected-read baseline for common credentials, shell history/configuration, browser data, and platform-specific keychain/private data. Reads outside that baseline remain broad for compatibility with local MCPs and installed runtimes/dependencies, while writes stay constrained to documented workspace, OpenCode, runtime, and temporary paths. Windows is unsupported: Chat reports the unsupported status and uses its existing unsandboxed path.
- **Hand off to full TUI** — Export the session and open an independent OpenCode TUI while chat **stays running**. The TUI is the only supported path for serious coding, shell work, and unrestricted Build workflows.
- **Thinking models that actually stream** — Stable CoT / reasoning display for thinking models (no blanking/flicker mid-stream).
- **Research-grade message surface** — Markdown with KaTeX math, Mermaid, syntax-highlighted code, and **copy as Markdown** on replies.
- **Effort + model UX built for many providers** — Searchable models, sticky per-model effort variants, recent-models strip, collapsed providers by default.
- **Context awareness** — In-input context/token chip so long research threads stay legible.
- **Secure-by-default posture** — Secret scanning, SAST, dependency audit, SHA-pinned CI actions, explicit Scout/Write denials, and a documented MCP trust boundary. When Chat sandboxing is enabled, local MCPs inherit its compatibility process and write boundary.

#### Complete chat companion (essentials)

Streaming chat, sessions, permissions/questions, file chips and diffs, undo/redo, skills, i18n (8 locales), sound cues, model effort controls, context awareness, MCP settings, and the OpenCode-native message surface — kept sharp for research and writing instead of codebase churn.

#### Chat sandbox compatibility

Enable Chat sandboxing from the gear settings in the Chat panel. The existing
`inherit`, `on`, and `off` modes control the companion, while **Allow network
access** applies to the entire companion process tree.

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

Stronger read isolation and advanced MCP grants are intentionally deferred to a
future strict-sandbox mode.

### Requirements

- [OpenCode](https://github.com/anomalyco/opencode) installed
- LLM provider authentication configured in OpenCode

#### Optional

- [difit](https://github.com/yoshiko-pg/difit) — enables the session diff review feature. Install with `npm install -g difit`.

### Installation

Search for **OpenCode Chat** in the VS Code Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**.

### Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/zeug-zz/opencode-chat/blob/main/CONTRIBUTING.md) for details.

### License

[MIT](https://github.com/zeug-zz/opencode-chat/blob/main/LICENSE)
