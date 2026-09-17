## Purpose

Provide a credential-free, low-noise update path for the privately distributed VSIX while keeping release discovery independent from OpenCode/Chat startup and keeping installation and reload under explicit user control.

## ADDED Requirements

### Requirement: Discover only a compatible stable GitHub Release update

The updater MUST use the GitHub Releases `latest` metadata for the configured repository as its only discovery source and MUST make the request without credentials. It MUST accept a release only when the release is stable, has a valid SemVer version newer than the installed extension, and contains the exact VSIX asset whose name maps to that version and the extension identity. It MUST reject malformed, prerelease, draft, older, equal, or otherwise incompatible release metadata and MUST treat an unavailable or unauthorized source as having no applicable update rather than acquiring credentials or using another source.

#### Scenario: New stable release with the exact VSIX is discovered
- **WHEN** the unauthenticated latest-release response is published, stable, has tag `v0.16.0`, and contains `opencode-scribe-0.16.0.vsix`
- **AND** the installed extension version is `0.15.2`
- **THEN** the updater records `0.16.0` as available and retains the exact asset download URL for a later consent-gated installation

#### Scenario: Prerelease, draft, malformed, or missing-asset release is ignored
- **WHEN** the latest-release response is a prerelease or draft, has an invalid tag/version, or does not contain the exact versioned VSIX asset
- **THEN** the updater reports no applicable update, does not notify the user, and does not download an artifact

#### Scenario: Older or equal release is ignored
- **WHEN** a stable release resolves to a version less than or equal to the installed extension version
- **THEN** the updater reports no applicable update and does not notify, download, install, or reload

#### Scenario: Discovery cannot proceed without credentials
- **WHEN** GitHub is unavailable, the response is unauthorized/rate-limited, or the source would require a token or other credential
- **THEN** the updater makes no credential request or storage change, leaves the current installation usable, and exposes a manual retry/check action without selecting a fallback release source

### Requirement: Present update availability with low-noise retryable notification

The updater MUST surface an applicable update through a non-blocking, low-noise notification or equivalent update-available indicator. It MUST suppress duplicate notifications for the same release across extension-host restarts using persisted global state, while retaining an explicit manual check/retry action that can be invoked without opening Chat or starting OpenCode.

#### Scenario: An available release is announced once
- **WHEN** discovery finds an applicable release that has not previously been announced
- **THEN** the updater presents a non-blocking update-available indication and records that release as announced in global state

#### Scenario: Repeated checks do not create notification noise
- **WHEN** background checks or extension-host restarts rediscover the same applicable release after it was announced
- **THEN** the updater does not show another duplicate notification, but the user can still invoke the manual check/retry action and access the pending update

#### Scenario: Manual retry performs an independent check
- **WHEN** the user invokes the manual check/retry action
- **THEN** the updater performs a fresh GitHub latest-release check without starting Chat/OpenCode and reports success, no applicable update, or a bounded non-fatal failure without blocking normal extension use

### Requirement: Require explicit consent for VSIX update and reload

The updater MUST present one explicit `Update` decision that authorizes downloading and installing the already-discovered and validated exact VSIX. It MUST download only that asset to extension-managed global storage, validate the downloaded artifact against the discovered release identity before installation, and invoke VS Code's VSIX installation flow only after the `Update` decision. Reloading the VS Code window MUST require a separate explicit confirmation. It MUST never install, reload, or force an upgrade automatically.

#### Scenario: User consents through the complete update flow
- **WHEN** the user chooses `Update` for an available release and then confirms the separate reload prompt after the exact VSIX has been downloaded, validated, and installed
- **THEN** the updater invokes VS Code's install-from-VSIX command as part of the `Update` decision and reloads only after the user has separately consented to reload

#### Scenario: User declines or cancels at any consent point
- **WHEN** the user declines the `Update` decision or the separate reload confirmation
- **THEN** the updater performs no step not authorized by that decision, leaves the current installation usable, and preserves a manual path to retry later

#### Scenario: Download, validation, installation, or reload fails
- **WHEN** the network download fails, the artifact is not the validated versioned VSIX, VS Code rejects installation, or reload cannot be completed
- **THEN** the updater reports a bounded non-fatal failure, removes or abandons the incomplete artifact as appropriate, does not replace or corrupt the current installation, and leaves Chat/OpenCode startup and manual retry available

### Requirement: Check after startup without initializing OpenCode or Chat

The updater MUST schedule its background check at `onStartupFinished` and MUST perform discovery without initializing an OpenCode server, Chat view/provider, MCP, nono, companion, sandbox, or research worker. Update-discovery failure MUST NOT change or delay the existing OpenCode/Chat lifecycle, and opening Chat later MUST remain the event that initializes that backend.

#### Scenario: Startup update check is independent of Chat
- **WHEN** VS Code reaches `onStartupFinished` and the Chat view has not been opened
- **THEN** the updater may perform its unauthenticated metadata check, but no OpenCode/Chat backend, MCP, nono, companion, sandbox, or research worker is initialized

#### Scenario: Update discovery fails before Chat is opened
- **WHEN** the startup check times out, receives invalid data, or cannot reach GitHub
- **THEN** the extension remains available for normal use, no backend is started as a recovery action, and opening Chat later retains its existing lazy initialization behavior

### Requirement: Preserve release tag and VSIX identity compatibility

The updater MUST require the release tag, release version, VSIX filename, and installed extension identity to agree: a `v`-prefixed release tag MUST normalize to the same SemVer as the VSIX filename `opencode-scribe-<version>.vsix`, and the artifact MUST identify the `opencode-scribe` extension published by `drmrStudio` with the same version. The updater MUST reject any mismatch rather than guessing, renaming, or installing an artifact from a different release.

#### Scenario: Matching tag, asset, and manifest are accepted
- **WHEN** the release tag is `v0.16.0`, the asset is `opencode-scribe-0.16.0.vsix`, and the VSIX manifest identifies publisher `drmrStudio`, name `opencode-scribe`, and version `0.16.0`
- **THEN** the artifact passes identity compatibility checks and remains eligible for the consent-gated flow

#### Scenario: Any identity mismatch is rejected
- **WHEN** the tag, asset filename, manifest version, publisher, or extension name differs from the expected identity
- **THEN** the updater rejects the release or artifact, does not install or reload, and keeps the current installation usable

### Requirement: Keep the private release source deliberately bounded

The updater MUST NOT use Marketplace or gallery update services, MUST NOT populate or treat VS Code's extension manager as a private update gallery, MUST NOT perform automatic installation or reload, and MUST NOT fall back to another release source. It MUST not acquire, prompt for, store, or transmit GitHub credentials.

#### Scenario: No prohibited update path is available
- **WHEN** the updater is enabled and performs discovery or installation
- **THEN** it uses only unauthenticated GitHub latest-release metadata and the validated release asset, with no Marketplace lookup, gallery registration, automatic install/reload, or release-source fallback
