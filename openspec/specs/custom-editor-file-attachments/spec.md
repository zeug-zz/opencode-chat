# custom-editor-file-attachments Specification

## Purpose

Make file-backed VS Code custom editor tabs available to Scribe's existing file
attachment picker and active-file quick-add flow without expanding access to
arbitrary webviews or changing the attachment contract.

## Requirements

### Requirement: Open-editor inventory includes trustworthy file-backed custom tabs

The VS Code platform open-editor inventory MUST include files represented by
`TabInputText` and file-backed `TabInputCustom` tabs. A custom tab MUST be
eligible only when its input exposes a trustworthy URI with scheme `file`.
Entries MUST retain the existing `FileAttachment` shape and workspace-relative
path conversion, and duplicate file paths MUST continue to be returned once.

#### Scenario: Office Viewer Markdown custom tab is discoverable

- **WHEN** an open tab has a `TabInputCustom` input whose URI is
  `file:///workspace/docs/guide.md`
- **THEN** `getOpenEditors()` MUST include
  `{ filePath: "docs/guide.md", fileName: "guide.md" }`
- **AND** the result MUST be usable by the existing picker without a new
  protocol or payload field

#### Scenario: Ordinary text editor remains compatible

- **WHEN** an open tab has a `TabInputText` input whose URI is
  `file:///workspace/src/main.ts`
- **THEN** `getOpenEditors()` MUST continue to include
  `{ filePath: "src/main.ts", fileName: "main.ts" }`
- **AND** existing duplicate filtering and path behavior MUST remain unchanged

#### Scenario: Non-file custom webview is ignored

- **WHEN** an open tab has a `TabInputCustom` input with no URI or with a URI
  whose scheme is not `file`
- **THEN** `getOpenEditors()` MUST omit that tab
- **AND** the host MUST NOT read webview content, grant webview access, or
  throw solely because the tab is custom

### Requirement: Active-file quick-add supports active custom tabs

The host MUST derive the active-file attachment from the active text editor as
before and MUST also derive it from the active file-backed custom tab when no
usable active text-editor document represents the active tab. The resulting
attachment MUST use the existing workspace-relative `filePath` and basename
`fileName` values.

#### Scenario: Active Office Viewer Markdown tab is quick-add eligible

- **WHEN** the active tab is a file-backed custom editor for
  `file:///workspace/docs/guide.md`
- **THEN** the host MUST post the existing
  `{ type: "activeEditor", file: { filePath: "docs/guide.md", fileName: "guide.md" } }`
  message
- **AND** the existing quick-add control MUST be able to attach that file

#### Scenario: Active custom webview is not quick-add eligible

- **WHEN** the active tab is a custom/webview tab without a trustworthy `file`
  URI
- **THEN** the host MUST post `{ type: "activeEditor", file: null }`
- **AND** the quick-add control MUST be hidden or otherwise remain unavailable
- **AND** no arbitrary webview resource MUST be attached

#### Scenario: Existing active text editor behavior remains intact

- **WHEN** the active text editor has a file-scheme document
- **THEN** the host MUST continue posting its existing `FileAttachment`
- **AND** an active-editor change MUST continue to refresh the quick-add state

### Requirement: Active tab changes refresh quick-add state

The host MUST refresh the existing active-file message when VS Code tab
activation changes, including changes between ordinary text and custom editor
tabs. The listener MUST be disposed through the existing provider lifecycle
mechanism or use the host's established event-listener ownership pattern.

#### Scenario: Switching between custom files updates quick-add

- **WHEN** the user activates a different file-backed custom editor tab
- **THEN** the host MUST post an updated `activeEditor` message for the newly
  active file
- **AND** the webview MUST replace the prior quick-add candidate

#### Scenario: Switching to a non-file tab clears quick-add

- **WHEN** the user activates a custom/webview tab without a trustworthy file
  URI
- **THEN** the host MUST post `activeEditor` with `file: null`
- **AND** a previously shown quick-add candidate MUST no longer be active

### Requirement: Attachment and security boundaries remain unchanged

This capability MUST preserve the existing `FileAttachment` type, UI-host
protocol messages, agent/SDK attachment mapping, workspace path semantics,
sandbox policy, permissions, and persistence behavior. It MUST NOT couple to
Office Viewer or any specific custom-editor provider. It MUST not expose
arbitrary webview content or attach a custom tab whose file identity cannot be
trusted.

#### Scenario: Send payload remains unchanged

- **WHEN** a user selects a custom-editor-backed Markdown file and sends a
  message
- **THEN** the webview MUST send the existing `files` array containing
  `{ filePath: "docs/guide.md", fileName: "guide.md" }`
- **AND** the host and agent MUST forward the same attachment shape to the
  existing send path
- **AND** no core protocol or SDK attachment contract change MUST be needed

#### Scenario: Non-file custom data never crosses the attachment boundary

- **WHEN** a custom tab has only webview state, an `untitled` URI, or another
  non-file resource
- **THEN** no attachment MUST be emitted for that tab by either picker or
  quick-add
- **AND** no sandbox or permission exception MUST be introduced
