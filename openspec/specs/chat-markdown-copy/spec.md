# Capability: chat-markdown-copy

## Purpose

Define the webview behavior for copying the original Markdown source of a rendered assistant chat message, including preservation of KaTeX, Markdown formatting, and code fences, while leaving existing copy paths (code-block copy buttons, native selection copy) and the `copyToClipboard` message transport unchanged.

## Requirements

### Requirement: Assistant message Markdown source copy

The VS Code webview SHALL provide a user-facing action on assistant messages that copies the original Markdown source for the message's visible text parts.

#### Scenario: Copy assistant message with KaTeX

- **WHEN** an assistant message contains rendered KaTeX produced from `$$\\frac{\\partial}{\\partial t}$$`
- **THEN** activating the Markdown copy action SHALL place the original `$$\\frac{\\partial}{\\partial t}$$` source on the clipboard
- **AND** the copied text SHALL NOT be the flattened rendered DOM text for the equation

#### Scenario: Copy assistant message with Markdown formatting

- **WHEN** an assistant message contains headings, lists, code fences, inline math, and display math in visible text parts
- **THEN** activating the Markdown copy action SHALL place those visible text-part sources on the clipboard with Markdown syntax preserved

#### Scenario: Multiple text parts

- **WHEN** an assistant message contains more than one visible text part
- **THEN** activating the Markdown copy action SHALL copy all visible text-part sources in display order
- **AND** adjacent copied text parts SHALL be separated by blank lines to preserve Markdown block boundaries

### Requirement: Existing copy behavior compatibility

The Markdown source copy action SHALL preserve existing copy behaviors outside its explicit action.

#### Scenario: Code block copy remains unchanged

- **WHEN** a user activates an existing code-block copy button inside a rendered assistant message
- **THEN** the clipboard SHALL contain only that code block's text content
- **AND** the new Markdown source copy action SHALL NOT intercept or alter the code-block copy behavior

#### Scenario: Native selection copy remains unchanged

- **WHEN** a user selects rendered content in the webview and uses the native copy command
- **THEN** the native copy behavior SHALL remain rendered-selection copy
- **AND** the new Markdown source copy action SHALL NOT replace native selection copy semantics

### Requirement: Clipboard transport reuse

The Markdown source copy action SHALL use the existing webview `copyToClipboard` message path to write clipboard contents.

#### Scenario: Copy request transport

- **WHEN** the Markdown source copy action is activated
- **THEN** the webview SHALL post a `copyToClipboard` message with the Markdown source as `text`
- **AND** no new extension-host clipboard message type SHALL be required
