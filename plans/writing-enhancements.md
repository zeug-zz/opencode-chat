# Writing Enhancements Plan

## Gap

The TUI is built for code execution loops (diffs, tools, shell) — it is a pair programmer. The chat extension already has the rendering foundation for writing (Markdown, KaTeX, Mermaid, syntax highlighting) but lacks the workflow around document authorship. You can generate great content, but you cannot easily save it, refine it iteratively, or navigate long documents.

## Tier 1 — Core writing workflow

### Export session to `.md` file

Save the conversation (or selected messages) to a `.md` file in the workspace. The rendered content is already clean Markdown; the missing piece is a "Save as..." button.

- Per-message "Save to file" action in MessageItem
- "Export session" action in ChatHeader or session menu
- Extension host handles file dialog and write via `vscode.window.showSaveDialog` + `vscode.workspace.fs`

### Open response in editor tab

Send an assistant response to a VS Code editor tab for further editing. Bridges chat → editor seamlessly.

- Per-message "Open in editor" button
- Extension host creates an untitled document or saves to temp and opens it
- Could use `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument`

### "Continue / Elaborate / Refine" quick actions

One-click follow-up prompts on messages. Keeps the writing flow without retyping instructions.

- Inline action bar on assistant messages with buttons like:
  - "Continue writing"
  - "Make more concise"
  - "Add examples"
  - "Improve clarity"
  - "Fix grammar"
- Each button sends a follow-up message with the action as context
- Configurable action list via `UIPersistedState`

### Word/character count

Shown per-message and in the input area.

- Word count badge on each assistant message
- Live word/character count in InputArea while typing
- Localization-aware word splitting (respect CJK boundaries)

## Tier 2 — Navigation and reuse

### Document outline / heading TOC

Auto-extract headings from long responses, clickable to scroll-to-section.

- Parse headings from rendered Markdown (h1-h3)
- Show a floating TOC sidebar or collapsible panel within the message
- Click to smooth-scroll to that heading

### Writing prompt templates

Save and reuse common writing prompts.

- "Templates" section in a dropdown or popover
- Persist via existing `UIPersistedState`
- Built-in defaults: "Blog post", "README", "Technical doc", "Meeting notes", "Email"
- Custom user-defined templates

### Find within conversation

Search across all messages in a session.

- Search bar (Ctrl+F within webview)
- Highlight matches across messages
- Navigate between matches

### Insert into active editor at cursor

A per-message "Insert" button that puts response content directly at the cursor in the active editor.

- Extension host reads active editor, gets cursor position
- Inserts text via `editor.edit`

## Tier 3 — Polish

### Markdown formatting toolbar

Basic formatting buttons for the input area (bold, italic, headings, lists, code, quote).

- Toolbar row above the textarea
- Insert Markdown syntax at cursor or wrap selection
- Keyboard shortcuts (Ctrl+B, Ctrl+I)

### Reading time estimate

Estimated reading time on responses.

- Simple word-count / WPM calculation
- Small badge near word count

### Collapsible heading sections

Make heading sections collapsible in rendered output.

- Click heading to collapse/expand its section
- Particularly useful for long generated documents

### Diff view between edit-and-resend versions

When a user edits and resends a message, show the diff between the original and new response.

- Reuse the existing `DiffView` component
- Show inline or side-by-side

## Architecture notes

All suggested features fit within the existing architecture:

- Message actions follow the existing `Copy Markdown` / per-code-block copy pattern
- Persistence uses the existing `UIPersistedState` mechanism
- File system operations go through the extension host (`postMessage` → `chat-view-provider.ts` handler)
- Editor integration uses the `vscode` namespace directly in the extension host
- Markdown parsing utilities already exist in `utils/markdown.ts`
