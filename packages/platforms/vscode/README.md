# OpenCode Scribe

> **Historical lineage:** Originally forked from [ktmage/opencode-gui](https://github.com/ktmage/opencode-gui). This package is now maintained as the distinct OpenCode Scribe extension focused on research and writing.

An unofficial VS Code chat, research, and report-writing extension for [OpenCode](https://github.com/anomalyco/opencode), designed to sit alongside the OpenCode TUI rather than replace it.

OpenCode TUI と併用するための、調査とレポート執筆を中心とした非公式 VS Code 拡張機能。

## Table of Contents / 目次

- [English](#english)
- [日本語](#japanese)

<a id="english"></a>

## English

### OpenCode Scribe

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
- **Inherited native plugins** — The extension-owned companion preserves supported OpenCode global and project plugin entries (including opaque options and native plugin-directory discovery) without copying arbitrary OpenCode configuration or writing user/project config. SDK-managed and sandboxed launches use backend-specific process-scoped plugin sources. These plugins are trusted code running in the companion process, not isolated MCP children; the Scout/worker/Write permission boundaries still deny coding, shell, arbitrary task, package, terminal, deletion, administration, and unknown capabilities as applicable. Native `ctx_*` tools are limited to the read-only research worker, while MCP `context-mode_*` tools remain a separate reviewed prefix.
- **Research MCP, chat-scoped** — On first Chat use, all inherited MCPs are disabled/unselected, so no unselected MCP child starts; only an explicit Gear-panel selection starts one. Per-server Gear selections are workspace-scoped and sticky across the Chat extension, sandbox/network, and VS Code/extension-host restarts. An OpenCode config `enabled: false` is a TUI-side default only: Chat’s explicit selection may enable that inventoried server through the extension's in-memory overlay, while unselected servers remain off. Config files are never rewritten, and the independent OpenCode TUI/CLI remains unaffected. If Chat cannot resolve its MCP inventory because config is unreadable or unparsable, it fails closed and reports unavailable with a visible error; repair the config and reload to recover.
- **File-backed editor attachments** — File-backed VS Code custom editors, including Markdown and PDF tabs, appear in the existing picker and active-editor quick-add flow without provider-specific integration.
- **Compatibility Chat sandbox** — The optional Chat sandbox applies one inherited process boundary to the extension's OpenCode server, local MCPs, remote MCP traffic, and descendants. On macOS and Linux, it also applies a static, versioned protected-read baseline for common credentials, shell history/configuration, browser data, and platform-specific keychain/private data. Reads outside that baseline remain broad for compatibility with local MCPs and installed runtimes/dependencies, while writes stay constrained to documented workspace, OpenCode, runtime, and temporary paths. Windows is unsupported: Chat reports the unsupported status and uses its existing unsandboxed path.
- **Optional external nono backend** — On supported macOS/Linux, enabled Chat sandboxing uses an externally installed `nono` with its validated built-in `opencode` profile by default. If discovered custom profiles exist and no choice is stored, one nonblocking picker offers the optional custom-profile choice; dismissal or the default choice keeps `opencode`. Profiles are discovered from `$XDG_CONFIG_HOME/nono/profiles` (default `~/.config/nono/profiles`). Scribe stores only an explicit profile name; it does not parse or modify profile JSON, bundle or install nono, or auto-select a custom profile. Both valid default and custom profiles use native Hindsight. Only unavailable/non-executable nono or an executable/profile preflight failure before launch selects the existing VS Code compatibility sandbox; these are separate policies and are not treated as equivalent without opt-in verification. A selected nono runtime failure fails closed rather than downgrading.
- **Hand off to full TUI** — Export the session and open an independent OpenCode TUI while chat **stays running**. The TUI is the only supported path for serious coding, shell work, and unrestricted Build workflows.
- **Thinking models that actually stream** — Stable CoT / reasoning display for thinking models (no blanking/flicker mid-stream).
- **Research-grade message surface** — Markdown with KaTeX math, Mermaid, syntax-highlighted code, and **copy as Markdown** on replies.
- **Effort + model UX built for many providers** — Searchable models, sticky per-model effort variants, recent-models strip, collapsed providers by default.
- **Context awareness** — In-input chip showing the latest valid prompt-context snapshot, so long research threads stay legible without accumulating prompt work across messages and steps.
- **Questions during active turns** — Interactive question dialogs appear as soon as the active turn asks, without waiting for an unrelated message update.
- **Secure-by-default posture** — Secret scanning, SAST, dependency audit, SHA-pinned CI actions, explicit Scout/Write denials, and a documented MCP trust boundary. When Chat sandboxing is enabled, local MCPs inherit the extension process and write boundary.

#### Optional memory, external nono, and the `AGENTS.md` fallback

Applicable OpenCode-discovered `AGENTS.md` files are ordinary project guidance
and workspace context, not a durable cross-session memory store. Optional
provider-backed memory, currently Hindsight, provides evidence-oriented recall
and reflection through a provider-neutral registry. Enabled sandboxing uses
external `nono` and its built-in `opencode` profile by default; a discovered
custom profile is an optional one-time picker choice. Both valid default and
custom profiles use native Hindsight after preflight before launch. Only
unavailable nono or an executable/profile preflight failure before launch
selects the compatibility fallback. In that fallback, Hindsight is
recall-only: only the exact search/list/read recall tools may be exposed when
all three are detected; reflection, writes, capture, diagnostics,
synchronization, automatic retention, and lifecycle operations are unavailable.
The nono and compatibility policies are separate enforcement boundaries, not
equivalent by implication. Installing and configuring the exact approved
Hindsight provider is the retention opt-in at the provider boundary; there is no
separate Chat retention checkbox or settings opt-in. Explicit durable retention
is available only after the exact
provider, capability, observed-tool, lifecycle, and sandbox gates pass, and
every request requires fresh user confirmation. An `always` or persistent
permission response cannot bypass that confirmation requirement.

Automatic session retention is provider-, lifecycle-, and sandbox-gated and is
active only after verification. It writes only bounded provider-approved
summaries: secrets and credentials, raw tool payloads/transcripts, large or
unrelated/private content, and untrusted retrieved or web content are excluded
or rejected as appropriate. Previously stored `opencode-chat.memoryRetention.*`
disable values are ignored; they are not deleted, migrated, or rewritten. The
extension does not write, promote, or synchronize findings into `AGENTS.md`.

When no approved provider is available, or nono/executable/profile preflight
fails before launch, Chat/Scout and Write/Build remain usable with recall-only
Hindsight where available, normal workspace/request context, and applicable
`AGENTS.md` guidance. No provider retention operation or automatic write occurs,
and there is no unsandboxed retry. Provider failures remain nonfatal and do not
promise external provider availability. A failure after nono is selected leaves
Chat unavailable rather than downgrading to another backend.

#### Optional external nono setup and verification

`nono` is optional external tooling. Scribe neither bundles nor installs it, and
never configures or modifies its profiles. Profiles live at
`$XDG_CONFIG_HOME/nono/profiles` (default `~/.config/nono/profiles`). The built-in
`opencode` profile is used by default. When custom profiles are discovered and
no choice is stored, the extension offers one nonblocking picker; selecting a
custom name, such as `opencode-local`, is optional, and dismissal/default keeps
`opencode`. Scribe stores only an explicit resulting name, never parses profile
JSON, and never auto-selects a custom profile. Each launch validates the
effective profile with:

```sh
nono profile show <name>
```

The nono integration check is opt-in and performs no nono launch by default:

```sh
OPENCODE_CHAT_RUN_NONO_INTEGRATION=1 \
OPENCODE_CHAT_NONO_PROFILE=opencode \
pnpm --filter @opencode-chat/agent-opencode test
```

To test an explicitly selected custom profile, replace `opencode` with that
discovered profile name.

Use `OPENCODE_CHAT_RUN_NONO_NETWORK=1` only for the optional network check.
Policy equivalence between nono and the compatibility sandbox is not claimed
unless this check has been run in the target environment.

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
- Inherited plugins reuse these generic compatibility reads and existing write
  paths. There are no plugin-name-specific grants or broad home/credential
  writes; a plugin requiring an unsupported write path can fail instead.
- Disabling network access prevents remote provider and MCP requests inside the
  sandbox. Enabling it permits network use for the companion and its MCP
  descendants.
- Network-enabled compatibility mode does not protect readable credentials
  from a local MCP or prevent a readable process from transmitting data. It
  does not promise protection against a malicious process.
- Windows does not enforce this read baseline. Chat reports sandboxing as
  unsupported there and uses the existing unsandboxed path.

If inherited plugin loading prevents startup or readiness, the companion retries
at most once with an explicit empty plugin list in the same requested sandbox
mode. It never retries unsandboxed or broadens policy. If the fallback starts,
Chat and Write remain usable and the extension reports only bounded, redacted
diagnostics; failures after readiness remain operation-level failures. Users who
do not configure plugins retain the plugin-free behavior.

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

#### Optional research integrations

The following optional, user-installed runtime/tooling integrations can support research workflows: context-mode, Firecrawl, Brave Search, PDF readers, paper search, and Playwright. These are not extension dependencies; the extension does not install, configure, bundle, or require them.

### Installation

On a trusted machine, download `opencode-scribe-<version>.vsix` from the [GitHub Releases](https://github.com/zeug-zz/opencode-chat/releases) page. In VS Code, open the Command Palette and run **Extensions: Install from VSIX...**, then select the downloaded file.

The Marketplace information for **OpenCode Scribe** (`drmrStudio.opencode-scribe`)
is retained for identity and history. The legacy `zeug-zz.opencode-research`
listing is a separate extension; VS Code will not automatically upgrade it to
the new publisher/name.

### Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/zeug-zz/opencode-chat/blob/main/CONTRIBUTING.md) for details.

### License

[MIT](https://github.com/zeug-zz/opencode-chat/blob/main/LICENSE)
