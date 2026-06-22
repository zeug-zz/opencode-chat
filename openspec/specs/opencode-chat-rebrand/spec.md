# opencode-chat-rebrand Specification

## Purpose
TBD - created by archiving change rebrand-opencode-chat. Update Purpose after archive.
## Requirements
### Requirement: Preserve Existing opencode-gui Workspace

The rebrand SHALL be implemented in a separate local working copy and SHALL NOT disrupt the existing `/Users/zeug/Projects/opencode-gui` checkout or its upstream PR workflow.

#### Scenario: Separate checkout is created

- **WHEN** implementation work begins
- **THEN** `/Users/zeug/Projects/opencode-chat` SHALL be the implementation working copy
- **AND** `/Users/zeug/Projects/opencode-gui` SHALL retain its existing remotes and PR branches
- **AND** rebrand edits SHALL NOT be applied to `/Users/zeug/Projects/opencode-gui`

#### Scenario: Existing PR workflow is inspected

- **WHEN** git remotes are inspected in `/Users/zeug/Projects/opencode-gui`
- **THEN** the existing upstream/fork remotes SHALL remain available for future `ktmage/opencode-gui` PR work
- **AND** no command in this change SHALL force-push, delete branches, reset hard, or repoint those remotes

### Requirement: Standalone Project Identity

The new `/Users/zeug/Projects/opencode-chat` repository SHALL identify as `opencode-chat` rather than `opencode-gui` in package metadata, documentation, workflow filters, and repository URLs.

#### Scenario: Package metadata is rebranded

- **WHEN** root and VS Code package manifests are inspected
- **THEN** the root package name SHALL be `opencode-chat-monorepo`
- **AND** the VS Code package name SHALL be `opencode-chat`
- **AND** repository, homepage, and bugs URLs SHALL point at `https://github.com/zeug-zz/opencode-chat`

### Requirement: Side-by-side VS Code Extension Identity

The VS Code extension SHALL install as `zeug-zz.opencode-chat` and SHALL NOT reuse the upstream extension identity `ktmage.opencodegui`.

#### Scenario: Extension manifest is packaged

- **WHEN** the built VSIX manifest is inspected
- **THEN** `publisher` SHALL be `zeug-zz`
- **AND** `name` SHALL be `opencode-chat`
- **AND** the display name SHALL be `OpenCode Chat`

#### Scenario: VS Code activates the chat view

- **WHEN** VS Code resolves the contributed chat webview
- **THEN** the activation event SHALL be `onView:opencode-chat.chatView`
- **AND** the registered webview provider SHALL use `opencode-chat.chatView`
- **AND** extension-owned view/container ids SHALL NOT collide with upstream `opencode`/`opencode.chatView` ids

### Requirement: Internal Scope Rename

Internal workspace package imports SHALL use the `@opencode-chat/*` scope.

#### Scenario: TypeScript sources build

- **WHEN** package builds run
- **THEN** imports SHALL resolve from `@opencode-chat/core` and `@opencode-chat/agent-opencode`
- **AND** no source import SHALL depend on `@opencodegui/*`

### Requirement: Preserve Companion Behavior

The rebrand SHALL preserve the current companion-to-TUI runtime behavior and locally aggregated features.

#### Scenario: Extension connects to OpenCode

- **WHEN** the extension activates in a workspace with OpenCode installed
- **THEN** it SHALL continue to connect to OpenCode through the existing SDK adapter
- **AND** it SHALL NOT replace or disable OpenCode TUI usage

#### Scenario: Current additions remain present

- **WHEN** the rebranded project is verified
- **THEN** current additions for Markdown copy, KaTeX rendering, Mermaid rendering, model effort controls, primary-agent default behavior, model selector/search if present, and security hardening SHALL remain present unless explicitly documented as absent from the source rollup

### Requirement: Safe Repository Repointing

Local git configuration in the new `/Users/zeug/Projects/opencode-chat` checkout SHALL target the new `opencode-chat` repository without destructive history operations.

#### Scenario: Remotes are inspected

- **WHEN** `git remote -v` is run in `/Users/zeug/Projects/opencode-chat` after reconfiguration
- **THEN** `origin` SHALL point to `https://github.com/zeug-zz/opencode-chat.git`
- **AND** `/Users/zeug/Projects/opencode-gui` remotes SHALL remain unchanged
- **AND** no command in this change SHALL force-push, delete branches, reset hard, or automatically publish artifacts

