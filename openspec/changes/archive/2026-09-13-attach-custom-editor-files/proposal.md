# Attach file-backed custom editor files

## Summary

Extend Scribe's VS Code file-attachment discovery so file-backed custom editor
tabs are treated like ordinary text editor tabs. This fixes the case where an
Office Viewer WYSIWYG Markdown tab represents a workspace `.md` file but is not
currently offered by the open-editor picker or the active-file quick-add
action.

## Scope

- Recognize file-backed `TabInputCustom` tabs alongside existing
  `TabInputText` tabs in the host-side open-editor inventory.
- Resolve the active file for quick-add from an active custom tab when its
  backing URI is a trustworthy `file` URI.
- Preserve workspace-relative `FileAttachment` values and the existing
  webview/agent send payload.
- Refresh active-file state when tab activation changes, while retaining the
  existing text-editor change behavior.
- Add focused extension-host tests and a webview regression where useful.

## Non-goals

- No Office Viewer integration, extension dependency, or provider-specific
  coupling.
- No arbitrary webview access, content extraction, or attachment of tabs that
  lack a trustworthy file URI.
- No changes to core protocol/domain types, SDK attachment mapping, sandbox
  policy, permissions, persistence, or message payload contracts.
- No changes to workspace search semantics or unrelated editor commands.

## Risks and fallback

The main risk is misclassifying a custom webview URI or producing an incorrect
path outside the workspace. The implementation must accept only supported tab
inputs with a `file`-scheme URI and use the existing path conversion; invalid
custom tabs are ignored. If custom-tab metadata is unavailable or an API shape
is not supported by the installed VS Code typings, the existing text-editor
behavior remains the fallback and custom tabs remain undiscoverable rather than
being attached unsafely. The change can be rolled back by reverting only the
host-side tab resolution/listener changes and their tests.

## Compatibility impact

Existing `TabInputText` picker entries, active text-editor quick-add behavior,
deduplication, workspace-relative paths, `FileAttachment` values, and send
payloads remain compatible. File-backed custom tabs add eligible entries; other
custom/webview tabs remain excluded. No migration is required and no persisted
data or public protocol changes are introduced.

## Rollout and verification

Implement in small host-first steps: centralize safe URI/path resolution,
extend the picker, extend active quick-add and tab-change refresh, then add
regression coverage. Verify focused extension-host and webview tests before the
normal repository check/build gate.
