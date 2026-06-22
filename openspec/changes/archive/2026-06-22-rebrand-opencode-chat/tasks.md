# Tasks

## 0. Separate Working Copy

- [x] 0.1 Select the source branch/commit that contains the intended rollup additions and create `/Users/zeug/Projects/opencode-chat` as a separate working copy from it. Verify the existing `/Users/zeug/Projects/opencode-gui` checkout still has unchanged remotes, branches, and working tree state after the copy is created.
- [x] 0.2 Confirm all implementation commands for subsequent tasks are run from `/Users/zeug/Projects/opencode-chat`, not `/Users/zeug/Projects/opencode-gui`. Verify with `pwd` and `git rev-parse --show-toplevel`.

## 1. Inventory and Safety

- [x] 1.1 In `/Users/zeug/Projects/opencode-chat`, capture current branch/status/remotes and identify the source commit used for the rebrand branch without modifying or reverting unrelated local files. Also verify `/Users/zeug/Projects/opencode-gui` was not changed. Verify with `git status --short`, `git branch --show-current`, `git remote -v`, and `git -C /Users/zeug/Projects/opencode-gui remote -v`.
- [x] 1.2 Confirm the current rollup includes the intended local additions: Markdown copy, KaTeX, Mermaid, model effort controls, primary agent selection, model selector/search if present, and security updates. Verify by searching code/specs and reporting evidence paths.

## 2. VS Code Extension Identity

- [x] 2.1 Rename extension metadata in `packages/platforms/vscode/package.json` and localized `package.nls*.json` files to `opencode-chat`, publisher `zeug-zz`, display name `OpenCode Chat`, and the new repository URLs. Verify package JSON parses.
- [x] 2.2 Rename VS Code activation/contribution/provider ids from `opencode.chatView` and the `opencode` container to `opencode-chat.chatView` and `opencode-chat`. Update tests that assert these ids. Verify with the focused extension test suite.
- [x] 2.3 Rename extension-private virtual document schemes or other collision-prone identifiers from `opencode-*` to `opencode-chat-*` where they are owned by this extension. Verify no upstream-owned command name or OpenCode CLI identifier is renamed accidentally.

## 3. Workspace Package Rename

- [x] 3.1 Rename the root package and VS Code workspace package filters from `opencodegui`/`opencodegui-monorepo` to `opencode-chat`/`opencode-chat-monorepo`. Verify `pnpm --filter opencode-chat --help` resolves the package.
- [x] 3.2 Rename internal workspace package scopes from `@opencodegui/core` and `@opencodegui/agent-opencode` to `@opencode-chat/core` and `@opencode-chat/agent-opencode`. Update imports, dependency declarations, test aliases, comments, and lockfile metadata. Verify TypeScript import resolution with package builds.

## 4. Documentation and Automation

- [x] 4.1 Update root and extension READMEs, CHANGELOG links, CONTRIBUTING, SECURITY, architecture docs, and third-party notices where they refer to `opencode-gui`, `opencodegui`, `OpenCodeGUI`, `ktmage`, or upstream repository URLs. Preserve upstream attribution and license text. Verify no stale project identity remains outside archived historical OpenSpec notes unless intentionally retained.
- [x] 4.2 Update GitHub workflows and package scripts to use `main` and `pnpm --filter opencode-chat`. Keep release publishing manual and do not add credentials. Verify YAML parses where practical.
- [x] 4.3 Update local-only guidance files only if needed for this repo's future workflow, without committing secrets or generated audit reports.

## 5. Git Remote Configuration

- [x] 5.1 In `/Users/zeug/Projects/opencode-chat` only, configure `origin` to target `https://github.com/zeug-zz/opencode-chat.git`. Remove or rename stale upstream/fork remotes only in the new checkout if doing so will not lose useful fetch references. Verify both repos with `git -C /Users/zeug/Projects/opencode-chat remote -v` and `git -C /Users/zeug/Projects/opencode-gui remote -v`.
- [x] 5.2 Ensure the new `opencode-chat` checkout uses `main` for new project work. Do not push. Verify branch state and report the exact command required for a later manual push.

## 6. Verification

- [x] 6.1 Run `pnpm install --lockfile-only` if package names changed, then `pnpm check`. Fix only rebrand-related failures.
- [x] 6.2 Run `pnpm test:all`. Fix only rebrand-related failures.
- [x] 6.3 Run `pnpm --filter opencode-chat build` and `pnpm --filter opencode-chat package`. Inspect the VSIX manifest for `publisher: zeug-zz`, `name: opencode-chat`, and `activationEvents: onView:opencode-chat.chatView`.
- [x] 6.4 Report final changed files, verification results, residual risks, and manual install/push next steps. Do not commit or push unless explicitly requested.
