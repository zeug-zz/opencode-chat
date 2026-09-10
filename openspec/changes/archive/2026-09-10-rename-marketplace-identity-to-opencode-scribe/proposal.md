## Why

The legacy `zeug-zz` Marketplace publisher is no longer usable for managing the
extension, and the `opencode-research` Marketplace name cannot be reused by the
new publisher. The extension needs a distinct, publishable identity under the
new `drmrStudio` publisher without changing its runtime integration or stable
internal VS Code identifiers.

## What Changes

- **BREAKING** Change the VS Code Marketplace publisher from `DRMR` to
  `drmrStudio`.
- **BREAKING** Change the VS Code package and Marketplace slug from
  `opencode-research` to `opencode-scribe`.
- **BREAKING** Change the visible extension name from `OpenCode Research` to
  `OpenCode Scribe` in the localized manifest resources and current user-facing
  branding.
- Update workspace filters, release packaging, Marketplace badges, install
  instructions, package verification, and current documentation to use the new
  identity.
- Keep the existing repository URLs, `@opencode-chat/*` package scope, and
  `opencode-chat.*` view, configuration, activation, and URI identifiers stable.
- Preserve historical changelog and archived OpenSpec references as records of
  previous Marketplace identities rather than rewriting them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-chat-rebrand`: Replace the current Marketplace identity contract
  with `drmrStudio.opencode-scribe` and `OpenCode Scribe` while preserving stable
  internal extension identifiers and runtime behavior.

## Impact

- `packages/platforms/vscode/package.json` and all localized `package.nls*.json`
  files will define the new publisher, package slug, and display name.
- Root workspace scripts, `.github/workflows/release.yml`, and the VSIX
  verification script will use the renamed workspace/package identity.
- Current README, AGENTS, architecture, security, issue-template, and source
  UI branding references will be updated; repository URLs remain unchanged.
- The packaged extension ID, VSIX filename, Marketplace badge URLs, and manual
  install/search instructions will change to `drmrStudio.opencode-scribe`.
- Marketplace publication for `drmrStudio` will be performed manually through
  the Marketplace publisher portal by uploading the verified VSIX; no PAT or
  Marketplace credential is stored or used by the repository or CI.
- Existing installations under the inaccessible legacy publisher are not
  automatically upgraded by this change because the new publisher and slug form
  a new extension identity.

## Scope, Non-goals, and Compatibility

This change is limited to the public extension identity, packaging metadata,
release plumbing, and current branding needed to publish the existing product
under `drmrStudio`. It does not change agent permissions, sandbox policy, MCP
capabilities, server lifecycle, report-writing behavior, or the independent
OpenCode TUI.

The stable `opencode-chat.*` identifiers remain a compatibility boundary for
existing workspace settings and contributed views. Historical release notes and
archived change artifacts remain unchanged. The new identity is intentionally a
new Marketplace listing, so users of the legacy listing may need to install the
new extension separately.

## Risks and Fallback

The primary risk is an incomplete identity replacement causing package filters,
verification, documentation, or publishing to reference different extensions.
The implementation will verify the embedded VSIX manifest and generated
artifact name before publication. If Marketplace rejects the proposed slug or
publisher credentials, no runtime code or legacy identity will be removed; the
artifact can be corrected and repackaged under another available identity.
