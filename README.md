# OpenCode Scribe

[![Visual Studio Code](<https://img.shields.io/badge/VS%20Code-^1.134.0-007ACC?logo=visual-studio-code>)](https://code.visualstudio.com/)
[![License](https://img.shields.io/github/license/zeug-zz/opencode-chat)](LICENSE)
[![Test](https://img.shields.io/github/actions/workflow/status/zeug-zz/opencode-chat/test.yml?branch=main&logo=github)](https://github.com/zeug-zz/opencode-chat/actions/workflows/test.yml)
[![Security Audit](<https://img.shields.io/github/actions/workflow/status/zeug-zz/opencode-chat/security-audit.yml?branch=main&label=security%20audit&logo=github>)](https://github.com/zeug-zz/opencode-chat/actions/workflows/security-audit.yml)

An unofficial VS Code **chat, research, and report-writing harness** for [OpenCode](https://github.com/anomalyco/opencode). It is deliberately not another coding-agent GUI: use it to read workspace context, research with connected sources, discuss findings, and save reports to files. It runs **alongside** the OpenCode TUI, with unrestricted coding and shell work available through **Hand off to TUI** without killing chat.

**This extension project began as a fork of [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui) and is not affiliated with or endorsed by the OpenCode project.**

---

### Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Development](#development)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

### Documents

| File                                              | Description          |
| ------------------------------------------------- | -------------------- |
| [CONTRIBUTING.md](./CONTRIBUTING.md)               | Contributing guide   |
| [CHANGELOG.md](./CHANGELOG.md)                     | Release history      |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | Third-party licenses |
| [LICENSE](./LICENSE)                               | MIT License          |
| [SECURITY.md](./SECURITY.md)                       | Security policy      |

### Features

Research is the product. Scribe is a read-oriented chat workspace that runs
alongside the OpenCode TUI, not another coding-agent sidebar.

**Research-first chat**

- **Scout (chat)** — Read-only agent for conversation, workspace reading, and research. No edits, no shell.
- **Write** — Report authoring backed by OpenCode Build. Reads, searches, and edits requested artifacts within the workspace; agent Bash and subagent execution are denied.
- **Purpose-built prompts** — Separate chat and write system prompts, so a read-only research assistant is never mixed with a report writer or coding-agent persona.
- **Hand off to TUI** — Export the session to an independent OpenCode TUI while chat keeps running. The supported path for coding, shell, and unrestricted Build work.

**Interface**

- Markdown, KaTeX, Mermaid, highlighted code, stable reasoning streams, and copy as Markdown.
- Model search, per-model effort, recent models, collapsed providers, and provider-aware controls.
- Context chip showing the latest valid prompt-context snapshot.
- Questions and permission dialogs surface as soon as a turn requests them.
- File-backed editor attachments (including Markdown and PDF) via the picker or active-editor quick-add.
- Streaming sessions, undo/redo, skills, 8-locale i18n, notifications, and diffs.

**Extension-owned runtime**

- **Process-scoped server** — The extension owns its `opencode serve` process and injects behavior in memory. Your global `opencode.json` and the standalone TUI stay untouched.
- **MCP on demand** — Inherited MCP servers start only when explicitly selected in the Gear panel. Selections are workspace-scoped and sticky across restarts; unreadable config fails closed with a visible error.
- **Native plugins inherited** — Supported global and project plugin entries are preserved, subject to the same Scout/Write permission boundaries.

**Optional integrations**

Scribe works without any of these; each is external tooling detected at runtime.

- **Sandbox — [nono](https://github.com/nolabs-ai/nono)** — When Chat sandboxing is enabled on macOS/Linux, one process boundary covers the extension's OpenCode server, local and remote MCPs, and their descendants, with a versioned deny baseline for credentials, shell history, and browser/private data. Uses nono and its built-in `opencode` profile when available, otherwise the VS Code compatibility sandbox; fails closed with no unsandboxed retry. Unsupported on Windows.
- **Memory — [Hindsight](https://github.com/vectorize-io/hindsight)** — Provider-backed recall and reflection when the approved provider is detected. `AGENTS.md` stays ordinary project guidance, not session memory. Writes follow provider, lifecycle, and sandbox gates: explicit retention is confirmation-gated, and automatic summaries exclude secrets, raw tool payloads, and untrusted content.
- **Logic — [Vibefeld](https://github.com/tobiasosborne/vibefeld)** — Optional, inspectable reasoning review of completed answers on request: explicit assumptions, dependencies, and calibrated structural conclusions. Not a theorem prover or evidence verifier; it activates only when a compatible `af` runtime is detected, and any workspace can opt out.

**Security posture**

- Gitleaks, Semgrep, dependency audit, and SHA-pinned CI actions.
- Explicit Scout and Write denials; connected MCP servers remain untrusted downstream boundaries. See [SECURITY.md](./SECURITY.md) for the full sandbox policy, protected-path inventory, and fail-closed behavior.

#### What this is not

- Not a replacement for the OpenCode TUI.
- Not an autonomous coding loop in the VS Code sidebar.
- Not a shell terminal — use **Hand off to TUI** for coding and command execution.

### Requirements

- [OpenCode](https://github.com/anomalyco/opencode) installed
- LLM provider authentication configured in OpenCode
- Optional integrations, detected at runtime:
  - **Sandbox** — [nono](https://github.com/nolabs-ai/nono), external sandbox for enabled Chat sandboxing
  - **Memory** — [Hindsight](https://github.com/vectorize-io/hindsight), provider-backed recall and reflection
  - **Logic** — [Vibefeld](https://github.com/tobiasosborne/vibefeld), reasoning review when a compatible `af` runtime is present

#### Recommended MCP research tools

Optional research tooling, enabled per server in the Chat Gear panel; the extension does not install, configure, or require any of it.

- [context-mode](https://github.com/mksglu/context-mode) — context-window optimization with sandboxed tool output, indexed search, and session continuity
- [Firecrawl](https://github.com/firecrawl/firecrawl-mcp-server) — web search, scraping, crawling, and multi-source research
- [Brave Search](https://github.com/brave/brave-search-mcp-server) — web, news, image, video, and local search
- [PDF Reader](https://github.com/SylphxAI/pdf-reader-mcp) — PDF text, tables, structure, and OCR extraction
- [Paper Search](https://github.com/openags/paper-search-mcp) — academic paper search, download, and full-text reading
- [Playwright](https://github.com/microsoft/playwright-mcp) — browser automation for interactive pages

### Installation

GitHub Releases is the private distribution source for OpenCode Scribe. On a trusted machine, download `opencode-scribe-<version>.vsix` from the [GitHub Releases](https://github.com/zeug-zz/opencode-chat/releases) page. In VS Code, open the Command Palette and run **Extensions: Install from VSIX...**, then select the downloaded file.

After startup, the extension checks stable GitHub Releases without starting Chat or OpenCode. When an update is available, choose **Update** to opt into the
combined download/install action, then separately confirm whether to reload.

Use the **OpenCode Scribe: Check for Updates** command in the Command Palette for a manual check.

### Development

#### Prerequisites

- Node.js v22+
- [pnpm](https://pnpm.io/) v10+

#### Setup

```sh
pnpm install
pnpm run build
```

#### Build

```sh
# Full build (all packages)
pnpm run build

# Extension only (from packages/platforms/vscode)
pnpm --filter opencode-scribe run build:ext

# Webview only (from packages/platforms/vscode)
pnpm --filter opencode-scribe run build:webview
```

#### Watch Mode

Open two terminals and run each:

```sh
# Terminal 1: Extension watch
pnpm --filter opencode-scribe run watch:ext

# Terminal 2: Webview watch
pnpm --filter opencode-scribe run watch:webview
```

#### Lint & Format

```sh
pnpm run check
```

#### Debug

1. Run `pnpm run build`
2. Press `F5` in VS Code to launch the Extension Development Host
3. Click the OpenCode icon in the sidebar to open the chat panel

#### Test

```sh
pnpm test
```

### Project Structure

This project is a pnpm monorepo with the following packages:

```
packages/
  core/                   # @opencode-chat/core — Domain types, interfaces & protocol
    src/
      domain.ts           # Domain types (messages, sessions, tools, permissions)
      agent.interface.ts  # IAgent interface
      platform.interface.ts # IPlatformServices interface
      protocol.ts         # Webview ↔ Extension messaging protocol

  agents/
    opencode/             # @opencode-chat/agent-opencode — OpenCode SDK adapter
      src/
        opencode-agent.ts # IAgent implementation for OpenCode
        mappers.ts        # SDK ↔ domain type mappers

  platforms/
    vscode/               # opencode-scribe — VS Code extension
      src/
        extension.ts      # Extension entry point
        chat-view-provider.ts   # Webview panel & messaging
        vscode-platform-services.ts # IPlatformServices implementation
      webview/            # Webview (Browser, React)
        App.tsx           # State management & SSE event handling
        components/       # React components (Atoms / Molecules / Organisms)
        hooks/            # Custom React hooks
        contexts/         # React Context providers
        locales/          # i18n locale files
        utils/            # Utility functions
        __tests__/        # Tests (unit, scenario)
```

### Contributing

Contributions to this project are welcome. For details, please refer to [CONTRIBUTING.md](CONTRIBUTING.md).

### License

[MIT](LICENSE)
