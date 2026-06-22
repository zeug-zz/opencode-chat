# Design: opencode-chat Rebrand

## Repository Separation

The rebrand MUST be implemented in a separate local working copy at `/Users/zeug/Projects/opencode-chat`. The existing `/Users/zeug/Projects/opencode-gui` checkout MUST remain available for current PR branches and upstream `ktmage/opencode-gui` work.

The source for `/Users/zeug/Projects/opencode-chat` SHOULD be the current intended rollup commit or branch after confirming it contains the desired local additions. The copy/clone operation MUST NOT require force-pushing, deleting branches, resetting hard, or modifying the existing `opencode-gui` remotes.

## Architecture Boundaries

The existing architecture MUST be preserved:

- `packages/core` remains the shared domain/protocol package.
- `packages/agents/opencode` remains the OpenCode SDK adapter.
- `packages/platforms/vscode` remains the VS Code extension and webview package.
- The extension continues to start/connect to an OpenCode server for the current workspace and complements the OpenCode TUI rather than replacing it.

## Key Decisions

1. VS Code extension identity changes to `publisher: "zeug-zz"` and `name: "opencode-chat"`.
2. User-facing display name changes to `OpenCode Chat`.
3. Repository metadata points to `https://github.com/zeug-zz/opencode-chat`.
4. VS Code contribution ids use `opencode-chat` and `opencode-chat.chatView` so this extension can coexist with upstream `ktmage.opencodegui`.
5. Internal package scope changes from `@opencodegui/*` to `@opencode-chat/*` to make the fork self-contained.
6. Release publishing remains manual and MUST NOT be triggered by this change.
7. Git remote changes are applied only in `/Users/zeug/Projects/opencode-chat`; the existing `opencode-gui` checkout keeps its current remotes and PR branch workflow.

## Migration Concerns

- Package manager metadata must be updated via pnpm in `/Users/zeug/Projects/opencode-chat` so `pnpm-lock.yaml` stays consistent.
- Tests that assert `opencode.chatView` must assert `opencode-chat.chatView` after the provider constant changes.
- Docs and workflows must use `pnpm --filter opencode-chat` once the package name changes.
- Existing untracked local OpenSpec/security files in `/Users/zeug/Projects/opencode-gui` are local project context and MUST NOT be swept into the new project unless explicitly selected as part of the source state.

## Rollback Path

Rollback is removing or discarding `/Users/zeug/Projects/opencode-chat` or reverting changes inside that checkout. The existing `/Users/zeug/Projects/opencode-gui` checkout remains the fallback and should not need repair. Git remote changes are local to the new checkout and can be reversed with `git remote set-url origin <old-url>` if needed. Marketplace publication is out of scope, so no published artifact rollback is required.

## SHOULD Guidance

- Prefer small anchored edits for metadata and provider constants before broad import rewrites.
- Use automated project-wide replacement only for exact string changes after reviewing the replacement map.
- Verify early with focused extension tests before running the full suite.
- Use `git worktree` or a fresh clone/copy for the new checkout; choose the least risky method based on current branch cleanliness.
