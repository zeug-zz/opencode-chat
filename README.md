# OpenCode Chat

[![Visual Studio Code](https://img.shields.io/badge/VS%20Code-^1.125.0-007ACC?logo=visual-studio-code)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/visual-studio-marketplace/v/zeug-zz.opencode-chat?label=version&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=zeug-zz.opencode-chat)
[![License](https://img.shields.io/github/license/zeug-zz/opencode-chat)](LICENSE)
[![Test](https://img.shields.io/github/actions/workflow/status/zeug-zz/opencode-chat/test.yml?branch=main&logo=github)](https://github.com/zeug-zz/opencode-chat/actions/workflows/test.yml)
[![Security Audit](https://img.shields.io/github/actions/workflow/status/zeug-zz/opencode-chat/security-audit.yml?branch=main&label=security%20audit&logo=github)](https://github.com/zeug-zz/opencode-chat/actions/workflows/security-audit.yml)

An unofficial VS Code chat companion for [OpenCode](https://github.com/anomalyco/opencode), designed to sit alongside the OpenCode TUI rather than replace it.

**Forked from [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui)**.

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

### OpenCode Chat

A focused chat window using your OpenCode models, memory, skills, and MCP servers alongside the excellent OpenCode TUI. The chat adds KaTeX and Mermaid rendering, Markdown copying, model search, effort toggles, and other writing-oriented enhancements that are not otherwise available in the code-oriented TUI.

**This is an unofficial, community-developed extension unaffiliated with or endorsed by the OpenCode project.**

### Documents

| File | Description |
| --- | --- |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contributing guide |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | Third-party licenses |
| [LICENSE](./LICENSE) | MIT License |
| [SECURITY.md](./SECURITY.md) | Security policy |

### Features

- Focused chat UI (send/receive messages, streaming display)
- Markdown rendering with KaTeX math and Mermaid diagrams
- Markdown copy actions for assistant replies
- Tool call collapsible display
- Permission approval UI (Allow / Once / Deny)
- Session management (create, switch, fork, delete)
- Message editing & checkpoint restore
- Model search and selection
- Model effort toggles
- Agent selector for primary agent selection
- File context attachment
- File changes diff view
- Session diff review via [difit](https://github.com/yoshiko-pg/difit) (opens in browser)
- Shell command execution
- Reasoning / thinking display
- Todo display
- Undo / Redo
- Session sharing
- Agent mention (`@` mention)
- Child session navigation (subtask)
- Settings panel
- Keyboard navigation for inline popups (Tab / Arrow keys)
- Subtask display
- Auto-scroll during streaming
- File type icons
- File path links (clickable file chips with extension-based icons)
- Syntax highlighting and copy button for code blocks
- Quick-add button with active editor file
- Input history navigation (ArrowUp / ArrowDown)
- Sound notification on assistant response completion
- Question interaction UI for agent-initiated questions
- i18n support (English, Japanese, Simplified Chinese, Korean, Traditional Chinese, Spanish, Brazilian Portuguese, Russian)

### Requirements

- [OpenCode](https://github.com/anomalyco/opencode) installed
- LLM provider authentication configured in OpenCode

#### Optional

- [difit](https://github.com/yoshiko-pg/difit) — enables the session diff review feature. Install with `npm install -g difit`.

### Installation

Search for **OpenCode Chat** in the VS Code Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**.

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
pnpm --filter opencode-chat run build:ext

# Webview only (from packages/platforms/vscode)
pnpm --filter opencode-chat run build:webview
```

#### Watch Mode

Open two terminals and run each:

```sh
# Terminal 1: Extension watch
pnpm --filter opencode-chat run watch:ext

# Terminal 2: Webview watch
pnpm --filter opencode-chat run watch:webview
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
    vscode/               # opencode-chat — VS Code extension
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
