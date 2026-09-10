## MODIFIED Requirements

### Requirement: Standalone Project Identity

The new `/Users/zeug/Projects/opencode-chat` repository SHALL identify as
`opencode-chat` rather than `opencode-gui` in repository metadata, documentation,
workflow filters, and repository URLs. Its VS Code Marketplace package SHALL use
the distinct `drmrStudio.opencode-scribe` identity and the current user-facing
display name `OpenCode Scribe`.

#### Scenario: Package metadata is rebranded

- **WHEN** root and VS Code package manifests are inspected
- **THEN** the root package name SHALL be `opencode-chat-monorepo`
- **AND** the VS Code package name SHALL be `opencode-scribe`
- **AND** the VS Code package publisher SHALL be `drmrStudio`
- **AND** repository, homepage, and bugs URLs SHALL point at
  `https://github.com/zeug-zz/opencode-chat`
- **AND** current workspace scripts and release workflow filters SHALL resolve
  the VS Code package by the `opencode-scribe` workspace name

#### Scenario: Current project branding is presented

- **WHEN** current installation instructions, Marketplace metadata, or
  user-facing extension branding is presented
- **THEN** the extension SHALL be identified as `OpenCode Scribe`
- **AND** current Marketplace links and badges SHALL identify
  `drmrStudio.opencode-scribe`

### Requirement: Side-by-side VS Code Extension Identity

The VS Code extension SHALL install as `drmrStudio.opencode-scribe` and SHALL
NOT reuse the upstream extension identity `ktmage.opencodegui` or the
inaccessible legacy identity `zeug-zz.opencode-research`. The new identity SHALL
be treated as a separate Marketplace listing, so an installation of the legacy
identity SHALL NOT be expected to update automatically to the new identity.

#### Scenario: Extension manifest is packaged

- **WHEN** the built VSIX manifest and localized manifest resources are
  inspected
- **THEN** `publisher` SHALL be `drmrStudio`
- **AND** `name` SHALL be `opencode-scribe`
- **AND** the display name SHALL be `OpenCode Scribe`
- **AND** the packaged extension identity SHALL be
  `drmrStudio.opencode-scribe`

#### Scenario: VS Code activates the chat view

- **WHEN** VS Code resolves the contributed chat webview
- **THEN** the activation event SHALL be `onView:opencode-chat.chatView`
- **AND** the registered webview provider SHALL use `opencode-chat.chatView`
- **AND** extension-owned view/container ids SHALL NOT collide with upstream
  `opencode`/`opencode.chatView` ids

#### Scenario: Legacy and new installations remain distinct

- **WHEN** a user has an installation identified as `zeug-zz.opencode-research`
  and installs `drmrStudio.opencode-scribe`
- **THEN** VS Code SHALL treat the two installations as different extension
  identities
- **AND** the new package SHALL not claim to be an in-place update of the
  legacy publisher's extension
