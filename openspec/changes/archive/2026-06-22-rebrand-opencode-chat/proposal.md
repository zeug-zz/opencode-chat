# Rebrand opencode-gui as opencode-chat

## Problem

This local fork still identifies as upstream `opencode-gui` in git remotes, package metadata, VS Code extension identity, documentation, and internal workspace package scopes. The existing `opencode-gui` checkout also contains PR branches that should remain available for upstream `ktmage/opencode-gui` if the maintainer chooses to take them later. Rebranding in-place would mix those workflows and risk accidental pushes to the wrong project.

## Objective

Create a separate `opencode-chat` working copy from the desired local rollup state, then reconfigure only that new working copy as a standalone VS Code chat companion for OpenCode. The existing `opencode-gui` checkout MUST remain intact for its upstream PR branches. The new project MUST preserve the current chat UI architecture and all locally aggregated additions in the selected rollup, including Markdown copy improvements, KaTeX rendering, Mermaid rendering, model effort controls, primary-agent default behavior, model selector/search additions if present, and security hardening updates.

## Scope

- Create a separate local checkout at `/Users/zeug/Projects/opencode-chat` from the selected `opencode-gui` source commit/branch.
- Rename git/project metadata in the new checkout from `opencode-gui`/`opencodegui` to `opencode-chat`/`opencode-chat`.
- Rename the VS Code extension identity from `ktmage.opencodegui` to `zeug-zz.opencode-chat`.
- Rename side-by-side-sensitive VS Code contribution ids away from `opencode.*` to `opencode-chat.*`.
- Rename internal package scope from `@opencodegui/*` to `@opencode-chat/*`.
- Update docs, workflow filters, package metadata, tests, and lockfiles to match the new identity.
- Configure git remotes in the new `opencode-chat` checkout so future work targets `https://github.com/zeug-zz/opencode-chat.git` and the default branch is `main`.

## Non-goals

- MUST NOT strip current GUI features down to a minimal chat-only implementation.
- MUST NOT change OpenCode SDK/session behavior except where an identifier collision must be avoided.
- MUST NOT publish to the VS Code Marketplace or push to GitHub as part of this change.
- MUST NOT remove upstream attribution or license notices.
- MUST NOT alter the existing `/Users/zeug/Projects/opencode-gui` checkout's remotes, PR branches, or upstream workflow, except for this planning scaffold until it is copied or recreated in the new checkout.

## Compatibility Impact

- Existing installs of `ktmage.opencodegui` SHOULD remain side-by-side because the new extension id is `zeug-zz.opencode-chat`.
- Existing webview persisted state from `ktmage.opencodegui` is not required to migrate because this is a new extension identity.
- OpenCode TUI usage MUST remain unaffected; the extension continues to use the OpenCode CLI/SDK as a companion interface.
- Existing `opencode-gui` PR branches and GitHub PRs MUST remain usable because implementation occurs in a separate local working copy.

## Risks

- Broad renaming can miss imports, tests, workflow filters, localized metadata, or lockfile entries.
- Changing VS Code view ids can break activation/tests if package metadata and provider constants diverge.
- Release workflows can accidentally publish under the new publisher if left enabled and secrets exist.

## Fallback

If a broad internal scope rename causes excessive churn, pause after the VS Code identity rename and verify package/build behavior before continuing. Any git remote changes MUST be limited to `/Users/zeug/Projects/opencode-chat`, non-destructive, and reversible with `git remote set-url`.
