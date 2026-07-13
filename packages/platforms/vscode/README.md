# OpenCode Chat

> **Forked from [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui).** Originally based on the upstream opencode-gui project.

An unofficial VS Code chat companion for [OpenCode](https://github.com/anomalyco/opencode), designed to sit alongside the OpenCode TUI rather than replace it.

OpenCode TUI と併用するための非公式 VS Code チャットコンパニオン。

## Table of Contents / 目次

- [English](#english)
- [日本語](#japanese)

<a id="english"></a>

## English

### OpenCode Chat

A research-first OpenCode **chat companion** for VS Code. It runs beside the OpenCode TUI: Scout-based chat for reading, reasoning, and research; optional Build when you need edits; full plan/orchestrate coding stays in the TUI via clean handoff.

> **This is an unofficial, community-developed extension. It is not affiliated with or endorsed by the OpenCode project.**

> [!CAUTION]
> **Disclaimer:**
> This project is experimental and developed primarily through AI-assisted coding. It is provided "as-is" without warranty of any kind. It may contain unexpected behavior, unconventional implementations, or undiscovered defects. Use at your own risk. The authors assume no liability for any damages arising from the use of this software.

### Demo

![Demo](https://raw.githubusercontent.com/zeug-zz/opencode-chat/main/packages/platforms/vscode/media/demo.gif)

### Features

Forked from [opencode-gui](https://github.com/ktmage/opencode-gui) and reshaped for **chat + research**, not clone-of-Cline coding loops.

#### What makes this different

- **Scout-first chat** — Default primary agent is OpenCode **Scout** (shown as **chat**): read-oriented companion with edit/shell denied by default. Switch to **Build** only when you want the agent writing code.
- **Companion-owned OpenCode server** — The extension starts its own `opencode serve` process and injects Scout in memory (no forced edit of your global `opencode.json`). Your independent TUI keeps its normal config and agents.
- **Research MCP, chat-scoped** — Gear panel toggles MCP servers on the **companion process only**, with remembered on/off prefs. Wire paper search, Brave, Context7, etc. for research without dragging the TUI into the same connection set.
- **Hand off to full TUI** — Export the session and open an independent planner/builder TUI while chat **stays running**. Attach-to-chat-server remains a fallback if the project DB is locked.
- **Thinking models that actually stream** — Stable CoT / reasoning display for thinking models (no blanking/flicker mid-stream).
- **Research-grade message surface** — Markdown with KaTeX math, Mermaid, syntax-highlighted code, and **copy as Markdown** on replies.
- **Effort + model UX built for many providers** — Searchable models, sticky per-model effort variants, recent-models strip, collapsed providers by default.
- **Context awareness** — In-input context/token chip so long research threads stay legible.
- **Secure-by-default posture** — Secret scanning, SAST, dependency audit in CI; Scout denials are explicit; MCP trust is called out (user MCP tools are not sandboxed by Scout).

#### Capable OpenCode companion (essentials)

Streaming chat, sessions, tools/permissions/questions, shells when on Build, file chips & diffs, undo/redo, skills, i18n (8 locales), sound cues, and the rest of the OpenCode-native surface — kept sharp so research chat never feels half-boat.

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
