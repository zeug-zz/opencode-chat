# OpenCode Chat

[![Visual Studio Code](<https://img.shields.io/badge/VS%20Code-^1.125.0-007ACC?logo=visual-studio-code>)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/visual-studio-marketplace/v/zeug-zz.opencode-chat?label=version&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=zeug-zz.opencode-chat)
[![License](https://img.shields.io/github/license/zeug-zz/opencode-chat)](LICENSE)
[![Test](https://img.shields.io/github/actions/workflow/status/zeug-zz/opencode-chat/test.yml?branch=main&logo=github)](https://github.com/zeug-zz/opencode-chat/actions/workflows/test.yml)
[![Security Audit](<https://img.shields.io/github/actions/workflow/status/zeug-zz/opencode-chat/security-audit.yml?branch=main&label=security%20audit&logo=github>)](https://github.com/zeug-zz/opencode-chat/actions/workflows/security-audit.yml)

An unofficial VS Code **chat, research, and report-writing harness** for [OpenCode](https://github.com/anomalyco/opencode). It is deliberately not another coding-agent GUI: use it to read workspace context, research with connected sources, discuss findings, and save reports to files. It runs **alongside** the OpenCode TUI, with unrestricted coding and shell work available through **Hand off to TUI** without killing chat.

**This is an unofficial, community-developed extension unaffiliated with or endorsed by the OpenCode project.**

The project began as a fork of [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui), but is now a distinct product with different prompts, permissions, server lifecycle, MCP model, and UX. The upstream GUI is historical lineage, not the direction of this project.

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

#### What makes this different

- **Chat is the product** — The default **Scout** agent appears as **chat**: a clean, read-oriented mode for conversation, workspace reading, reasoning, and research. It does not edit or run shell commands.
- **Write means requested artifacts, not coding loops** — The **write** mode is backed by OpenCode **Build** internally, but uses a dedicated report-authoring prompt. It can read, search, use web research, and edit within its broad workspace-scoped capability; requested-artifact guidance is behavioral, while agent Bash and task/subagent execution are denied.
- **Research-oriented prompts** — Chat and Write have separate system prompts so a read-only research companion is not mixed with a report-writing agent or a coding-agent persona.
- **Companion-owned OpenCode server** — The extension owns its `opencode serve` process and injects companion behavior in memory. It does **not** rewrite your global `opencode.json`; the independent TUI keeps its normal agents and configuration.
- **Research MCP, chat-scoped** — On first Chat use, all inherited MCPs are disabled/unselected, so no unselected MCP child starts; only an explicit Gear-panel selection starts one. Per-server Gear selections are workspace-scoped and sticky across Chat companion, sandbox/network, and VS Code/extension-host restarts. An OpenCode config `enabled: false` is a TUI-side default only: Chat’s explicit sticky Gear selection may enable that inventoried server through the companion-only in-memory overlay, while unselected servers remain off. Config files are never rewritten, and the independent OpenCode TUI/CLI remains unaffected. If Chat cannot resolve its MCP inventory because config is unreadable or unparsable, it fails closed and reports unavailable with a visible error; repair the config and reload to recover.
- **Compatibility Chat sandbox** — The optional Chat sandbox applies one process boundary to the companion, local MCPs, remote MCP traffic, and their descendants. On macOS and Linux, it also applies a static, versioned protected-read baseline for common credentials, shell history/configuration, browser data, and platform-specific keychain/private data. Reads outside that baseline remain broad for compatibility with local MCPs and installed runtimes/dependencies, while writes stay constrained to documented workspace, OpenCode, runtime, and temporary paths. Windows is unsupported: Chat reports the unsupported status and uses its existing unsandboxed path.
- **Report output with controlled scope** — Write is for drafting and saving sourced reports, separating evidence from inference, and updating requested files without turning the chat panel into a general-purpose coding shell.
- **Hand off to full TUI** — Export the session to an independent OpenCode TUI while **chat keeps running**. The TUI is the supported path for serious coding, shell work, and unrestricted Build workflows.
- **Stable thinking / CoT stream** — Reasoning display for thinking models without mid-stream blanking.
- **Research-grade message UI** — Markdown, KaTeX, Mermaid, highlighted code, stable reasoning streams, and **copy as Markdown**.
- **Model + effort UX** — Search, sticky per-model effort, recent models, collapsed providers, and provider-aware model controls.
- **Context chip** — token / context usage in the input area for long research threads.
- **Security posture** — Gitleaks, Semgrep, dependency audit, SHA-pinned CI actions, explicit Scout/Write denials, and a clear MCP trust boundary. When Chat sandboxing is enabled, local MCPs inherit its compatibility process and write boundary.

#### What this is not

- Not a replacement for the OpenCode TUI.
- Not a Cline-style autonomous coding loop in the VS Code sidebar.
- Not a companion shell terminal; use **Hand off to TUI** for coding and command execution.

#### Chat sandbox compatibility

Chat sandboxing is controlled from the gear settings in the Chat panel. The
existing `inherit`, `on`, and `off` modes determine whether the Chat companion
is sandboxed, and **Allow network access** applies to the complete companion
process tree.

The compatibility sandbox is targeted defense-in-depth, not strict filesystem
confidentiality:

- Local MCPs inherit the sandbox automatically. No MCP-specific path allowlist
  is required for Node, Python, uv, Bun, or other installed runtimes.
- On macOS and Linux, reads in the static protected baseline are denied. Reads
  outside it remain broad so ordinary MCP configurations and installed runtime
  dependencies can start.
- Writes remain constrained to the active workspace and required OpenCode,
  cache, and temporary paths.
- With network access disabled, remote providers and MCPs fail inside the
  sandbox. With network access enabled, the companion tree can use provider and
  MCP network services.
- Network-enabled compatibility mode is not a credential-confidentiality
  boundary: a readable local MCP or other process may still read data outside
  the baseline and transmit data it can read. It does not promise protection
  against a malicious process.
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

The protected list is a versioned, reviewed first-pass inventory rather than an
exhaustive protection promise. It retains the existing cross-platform leaves
and adds these selected narrow paths from the current review:

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

If a required read grant exactly overlaps, contains, or is contained by a
protected path, policy construction fails closed before launch with an
actionable error. It does not remove the deny, broaden the grant, or retry
unsandboxed. A configured MCP that intentionally reads a newly protected path
may therefore be affected; there is no MCP-specific exception. The complete
companion process tree, including MCP descendants, inherits the baseline.

Users who need stronger read isolation should wait for the future advanced
strict-sandbox mode rather than adding ad hoc MCP exceptions.

#### A complete chat companion

Streaming sessions, permissions and questions, file chips and diffs, undo/redo, skills, 8-locale i18n, notifications, model effort controls, context awareness, MCP settings, and the OpenCode-native message surface are kept sharp for research and writing rather than codebase churn.

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
