## Why

Private VSIX distributions do not have a Marketplace channel that can provide quiet, reliable release discovery. Add a low-noise updater that checks the configured private GitHub Releases source without starting OpenCode or Chat merely to perform an update check, while leaving installation under explicit user control.

## What Changes

- Introduce a `private-release-updater` capability for stable-release discovery from GitHub Releases only.
- Perform release discovery in the background at an appropriate low-noise cadence, with failures treated as non-fatal and without prompting on every check.
- Present an available stable VSIX update for an explicit user decision; installation and reload occur only after the user consents.
- Keep update checks independent of OpenCode/chat startup so deferred Chat/OpenCode startup remains preserved.
- Use the published private-release artifact and its GitHub Release metadata as the sole update source; do not add a Marketplace dependency.

### Scope

This change covers stable-release detection, user-visible availability state/notification, and the consent-gated VSIX install/reload flow for the private GitHub Releases distribution. It includes the compatibility behavior needed when GitHub is unavailable, no release is applicable, or the VSIX cannot be installed.

### Non-goals

- Automatic VSIX installation, automatic reload, or forced upgrades.
- Marketplace publication, Marketplace lookup, or a second public update channel.
- Starting an OpenCode process, Chat session, or companion server solely to check for updates.
- Credential acquisition, token storage, authenticated GitHub API use, or private repository access requiring user credentials.
- Updating unrelated capabilities or changing normal OpenCode/chat lifecycle behavior.

## Capabilities

### New Capabilities

- `private-release-updater`: Low-noise background discovery of stable VSIX releases from GitHub Releases, with explicit user-consented installation and reload and deferred Chat/OpenCode startup preserved.

### Modified Capabilities

None.

## Impact

- Affected systems: the VS Code extension host's activation/update lifecycle and the private VSIX release distribution path.
- New external dependency: GitHub Releases as the only release-discovery source; no Marketplace dependency and no credentials.
- User experience: users may receive a quiet update-available indication, but installation and reload remain opt-in. Existing startup, chat, OpenCode, and TUI handoff behavior must remain unchanged.
- Failure/fallback: network, metadata, artifact, compatibility, or installation failures must leave the current installation usable, avoid repeated noisy prompts, and provide a manual/retry path rather than altering or disabling Chat/OpenCode startup.
- Compatibility impact: existing installations continue to work without an available update or network access; the updater must be safely inert when the private release source is unavailable and must not require OpenCode/chat initialization.
- Risks: stale or malformed release metadata, unavailable GitHub, incompatible VSIX artifacts, repeated notifications, and accidental user surprise during reload. Mitigations are stable-release filtering, bounded low-noise checks, explicit consent, validation before install, and a non-destructive fallback to the current version.
