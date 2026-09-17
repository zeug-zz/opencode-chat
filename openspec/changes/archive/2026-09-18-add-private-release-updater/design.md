## Context

The extension currently activates its OpenCode agent and related Chat services from the extension entry point, while the release workflow packages `packages/platforms/vscode/package.json` as `opencode-scribe-<manifest.version>.vsix` and uploads that artifact to the GitHub Release. The updater must add a separate, non-Chat lifecycle path around that existing distribution contract. See `proposal.md` and `specs/private-release-updater/spec.md` for the motivation and externally visible behavior.

## Goals / Non-Goals

**Goals:**

- Discover only a newer stable release and its exact compatible VSIX through unauthenticated GitHub Releases metadata.
- Keep startup discovery independent of OpenCode, Chat, MCP, nono, companion, sandbox, and research-worker initialization.
- Provide low-noise availability state and a manual retry/check path.
- Gate the combined download/install action and the later reload behind explicit user consent, with a non-destructive failure path.
- Preserve the release workflow's artifact naming and the extension's publisher/name/version identity.
- Release the user-facing feature with the normal coordinated minor version bump and synchronized root/package changelog and installation-documentation updates.

**Non-Goals:**

- Marketplace or gallery publication, lookup, registration, or use as a private update gallery.
- Automatic installation, forced upgrade, or automatic reload.
- Authenticated/private-repository access, credential acquisition, token storage, or release-source fallback.
- Changes to normal Chat/OpenCode initialization, Marketplace publishing, or the release workflow's packaging semantics. The ordinary release metadata and documentation updates needed for this feature are in scope.

## Decisions

### GitHub latest-release API is the sole discovery source

Use the repository's unauthenticated `GET /repos/{owner}/{repo}/releases/latest` endpoint. Select only a non-draft, non-prerelease response with a valid SemVer tag and exact asset mapping. Normalize an optional leading `v` from the tag, require the normalized tag version to equal the manifest version encoded by `opencode-scribe-<version>.vsix`, and compare it to the installed version using SemVer rather than lexical string comparison. This makes malformed, older, equal, and cross-release artifacts fail closed.

The alternative of querying tags, release lists, Marketplace APIs, or arbitrary download URLs is rejected: those sources either weaken the stable/latest contract, create a second distribution channel, or allow an artifact to be selected without the release metadata and identity checks. No GitHub token is supplied; a private repository that cannot answer anonymously is therefore treated as unavailable, not as a reason to request credentials.

### Keep updater state separate from Chat lifecycle

Register the updater's startup trigger for `onStartupFinished` and keep its HTTP metadata request, validation, notification state, and command handler in a small extension-host service that does not construct or connect the OpenCode agent. The existing Chat activation path remains lazy. The updater must not use OpenCode, nono, MCP, Hindsight, sandbox, or research-worker services as a transport or readiness signal.

Persist the last-announced release identity in `context.globalState`, not workspace state, so notification suppression follows the extension installation across workspaces and extension-host restarts. A newer release identity replaces the suppressed value; a manual check always bypasses notification suppression while preserving the current pending release state.

### Use VS Code's installer only after one validated, consented update decision

After the user chooses the explicit `Update` action for the already-discovered and validated release, stream the exact GitHub asset into extension-managed global storage using a unique temporary filename. Validate response status, size/completeness, and the VSIX manifest's publisher, name, and version against the release identity, then invoke VS Code's `workbench.extensions.installExtension` command with the local VSIX URI as part of that same decision. Offer reload separately through VS Code's reload command only after the user explicitly confirms it. This avoids a redundant installation prompt while preserving a deliberate boundary before window disruption.

VS Code's extension manager cannot be populated as a private update gallery: its gallery/provider model is controlled by VS Code and Marketplace-compatible services, not an extension-owned arbitrary release feed. Directly invoking a remote VSIX URL is also not relied upon because it bypasses the local validation boundary, makes consent and cleanup difficult to control, and leaves transport/installer behavior dependent on a remote URI. A local, validated artifact gives the updater a clear point to stop safely before installation.

### Preserve release identity while allowing the normal feature release updates

Do not change the VSIX packaging format or redesign the release workflow. The existing workflow must continue deriving the asset path from the manifest name and version and uploading that exact file. When this user-facing feature is released, the normal coordinated minor version bump, root and package changelog entries, and installation-documentation updates are allowed and expected; the manifest version and corresponding release tag must remain synchronized. The updater therefore treats `opencode-scribe-<version>.vsix`, publisher `drmrStudio`, name `opencode-scribe`, and the normalized `v<version>` release tag as a compatibility contract. A mismatch is rejected rather than repaired by renaming or guessing.

### Failure and rollback behavior is non-destructive

Network, metadata, validation, download, installer, and reload failures are bounded and non-fatal. Discovery failures clear no working Chat state and do not trigger backend startup. Incomplete or invalid downloads are deleted or abandoned in global storage. No in-place replacement of the installed extension is attempted, so the current version remains the rollback state if installation fails. After an installation attempt, the updater reports the result and leaves a manual retry/check path; it does not loop or automatically retry noisily.

## Risks / Trade-offs

- **Unauthenticated GitHub limits or private repository visibility** → Treat unauthorized/rate-limited responses as unavailable, do not acquire credentials, and retain a manual check path; the current installation remains usable.
- **GitHub metadata and asset drift** → Require stable-release flags, strict SemVer/tag/filename mapping, and VSIX manifest identity validation before installation.
- **Repeated startup notifications** → Store the last-announced release identity in global state and make notifications non-blocking; manual checks remain available.
- **VSIX installation or reload surprises** → Use one explicit `Update` decision for download/install and a separate confirmation before reload; never perform either installation or reload automatically.
- **Extension lifecycle regression** → Keep discovery free of OpenCode/Chat construction and test startup with Chat unopened; discovery errors must be isolated from normal activation.
- **No authenticated fallback** → Some users may receive no update from a source that requires credentials. This is intentional: avoiding credential handling and preserving the private-release security boundary takes precedence over broader reach.

## Migration Plan

The change is additive and requires no migration of user settings or release artifacts. Prepare the feature release with the normal coordinated minor version bump and synchronized root/package changelog and installation-documentation updates, while retaining the existing manifest-derived VSIX name and release workflow behavior. Ship the updater alongside the existing activation behavior; existing installations continue using their current version until a matching release is discovered and the user consents. To roll back, remove or disable the updater entry point and ship a subsequent VSIX through the existing release workflow; no updater-owned in-place rollback or persisted credential state is introduced.

## Open Questions

None. The release source, identity contract, lifecycle boundary, consent sequence, and failure behavior are specified sufficiently for implementation and tests.
