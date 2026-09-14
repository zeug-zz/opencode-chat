# Design: Attach file-backed custom editor files

## Context and current behavior

The webview already consumes `openEditors` and `activeEditor` messages and
constructs the existing `FileAttachment` values. `ChatViewProvider` currently
derives the active attachment from `window.activeTextEditor` and listens only to
`onDidChangeActiveTextEditor`. `VscodePlatformServices.getOpenEditors()` walks
all tabs but filters exclusively for `TabInputText`. Consequently a custom
editor such as Office Viewer's Markdown editor is invisible despite having a
workspace file behind it.

The architecture already places this behavior in the VS Code platform layer:
`ChatViewProvider` owns host-to-webview routing and active state, while
`VscodePlatformServices` owns editor inventory. Core, the OpenCode adapter, and
the SDK attachment mapping are intentionally outside this change.

## Proposed approach

1. Add a small host-side resolver for a tab input that accepts `TabInputText`
   and `TabInputCustom` only when the input exposes a URI with `scheme ===
   "file"` and a usable filesystem path.
2. Reuse one path-to-`FileAttachment` conversion for picker entries and active
   custom-tab resolution. Preserve the current first-workspace-relative path
   behavior and basename naming, including the no-workspace fallback.
3. Change `getOpenEditors()` to resolve both supported tab input kinds, omit
   unresolved entries, and retain path-based deduplication.
4. Keep the existing active text-editor path as the first choice. When it does
   not yield a usable file attachment, inspect the active VS Code tab and use
   the resolver for a file-backed custom tab. The exact active-tab lookup must
   follow the installed VS Code API typings and must not infer identity from a
   webview label, title, provider ID, or content.
5. Register the tab activation/change event needed for custom tabs and publish
   the existing `activeEditor` message through the same helper used on text
   editor changes. Preserve the initial `ready` message behavior.

The implementation may expose a narrowly typed/testable helper within the
platform package, but it must not add a core type or protocol message. It must
also preserve the repository's existing event ownership pattern; if the
provider currently lacks explicit disposal, the implementation should use the
same host listener convention rather than introducing unrelated lifecycle work.

## API and trust boundary

`TabInputCustom` is a discovery hint, not permission to inspect a custom
editor. Only its backing `file` URI is converted into the already-authorized
workspace-relative attachment. Untitled, output, virtual, remote, and missing
URI cases are rejected by the scheme/path guard. No custom-editor provider is
named or queried, and no webview message, document text, or custom input payload
is read.

## Trade-offs

- **Tab metadata over provider integration:** supports Office Viewer and other
  file-backed custom editors without a dependency or provider-specific branch;
  it intentionally cannot support custom editors that do not expose a file URI.
- **Shared conversion over new attachment types:** preserves all existing UI,
  protocol, agent, and persistence behavior; path conversion remains subject to
  the current first-workspace convention.
- **Host-side filtering over webview filtering:** keeps trust decisions and
  VS Code API handling out of React, while the existing picker and quick-add UX
  remain unchanged.
- **Additional tab event:** necessary because custom tab activation may not
  produce a text-editor event; it may produce duplicate active messages in
  some VS Code transitions, which is harmless and preferable to stale quick-add
  state.

## Compatibility, migration, and rollback

This is additive and requires no migration. Existing text tabs and send payloads
are unchanged. There are no persistence or versioned protocol changes. If a
VS Code version does not expose the expected custom-tab URI shape, the resolver
fails closed and ordinary text behavior continues. Rollback is a source revert
of the platform resolver, picker filter, active-tab listener, and focused tests;
no user data or configuration cleanup is necessary.

## Risks and acceptance evidence

The principal risks are unsafe acceptance of a virtual/custom URI, incorrect
workspace-relative conversion, and stale quick-add state after tab activation.
Focused host tests must cover: Office Viewer-style file-backed custom tab,
ordinary `TabInputText` compatibility, non-file/missing-URI custom negative
case, and active custom-tab refresh. Webview scenario coverage should prove
that the existing picker/quick-add and send payload consume the unchanged
attachment shape. Run the relevant extension-host and webview test commands,
then the repository check/build gate during final verification.
