## Context

See `proposal.md` for the motivation and scope. The current VS Code package
uses `name: "opencode-research"`, `publisher: "DRMR"`, and a localized display
name of `OpenCode Research`. The package name is also the workspace package name
used by root scripts and the release workflow, while the VSIX verifier contains
the current artifact prefix explicitly.

The canonical `opencode-chat-rebrand` specification describes that identity, but
the runtime's contributed view, configuration, activation, and URI identifiers
intentionally use the stable `opencode-chat.*` namespace. Repository URLs and
the internal `@opencode-chat/*` package scope are also unrelated to the
Marketplace identity and must remain unchanged.

## Goals / Non-Goals

**Goals:**

- Produce a package whose exact Marketplace identity is
  `drmrStudio.opencode-scribe`.
- Present `OpenCode Scribe` consistently in current manifest resources,
  documentation, and user-facing extension strings.
- Keep workspace builds, release automation, VSIX verification, and Marketplace
  links aligned with the new package name.
- Make the new listing's lack of automatic upgrade compatibility with the legacy
  publisher explicit.

**Non-Goals:**

- Do not change runtime behavior, agent permissions, sandbox policy, MCP access,
  server lifecycle, or TUI integration.
- Do not rename `opencode-chat.*` contribution, configuration, activation, or URI
  identifiers.
- Do not change repository ownership or repository URLs.
- Do not attempt to recover, transfer, delete, or publish into the legacy
  `zeug-zz` listing.
- Do not store Marketplace credentials or alter the credential-handling model.

## Decisions

### Use the manifest publisher and name as the identity source

Set the VS Code manifest fields to `publisher: "drmrStudio"` and
`name: "opencode-scribe"`. Keep the combined identity out of either field; the
packaging tool derives `drmrStudio.opencode-scribe` from them. Preserve the
`%displayName%` indirection in `package.json` and change the value in every
`package.nls*.json` resource to `OpenCode Scribe`.

This uses the publisher ID exactly as registered instead of normalizing its
case, which avoids a mismatch between the manifest, publisher account, and
Marketplace URL.

### Treat the package slug as a workspace rename

Update all active root scripts and release workflow filters from
`opencode-research` to `opencode-scribe`. Update the VSIX verifier's filename
matching and diagnostics as well. Generated workspace state under
`node_modules/` is not edited manually; dependency installation may regenerate
it from the source manifests.

This keeps the package manager, build, release, and verification paths referring
to the same workspace package. The VSIX filename is expected to change to
`opencode-scribe-<version>.vsix`.

### Separate current branding from historical records

Change current README, badges, install instructions, AGENTS guidance,
architecture/security references, issue-template text, package contribution
titles, and user-facing source strings to `OpenCode Scribe` and
`drmrStudio.opencode-scribe`. Do not rewrite archived OpenSpec artifacts or
historical changelog entries; they document identities that were valid for
earlier releases. Add or update only the current release documentation needed
to explain the new listing.

### Preserve stable runtime identifiers

Limit identity replacement to public metadata and current branding. Keep
`opencode-chat.chatView`, `opencode-chat` view/container identifiers,
`opencode-chat.*` settings, activation events, diff URI schemes, and package
scope unchanged. This avoids an unnecessary settings and contributed-view
migration while allowing the extension to be published under a new Marketplace
identity.

### Verify before manual Marketplace upload

Build and test the repository, package from the VS Code platform workspace, and
inspect the embedded VSIX manifest plus localized resources. Verification must
confirm the exact publisher, slug, display name, stable activation/view IDs,
and generated artifact filename before any Marketplace upload.

Marketplace publication is performed manually through the `drmrStudio`
publisher portal by uploading the verified VSIX. CI only builds, packages, and
attaches the VSIX artifact to the GitHub Release; no automated Marketplace
publication is configured, and no PAT or Marketplace credential is stored or
used by the repository or CI.

## Risks / Trade-offs

- [Stale package references] -> Update root filters, workflow filters, verifier
  patterns, current documentation, and badges together; run a targeted search
  for active `opencode-research` and old publisher references before packaging.
- [Marketplace name or publisher rejection] -> Treat the generated VSIX as
  unpublished until Marketplace accepts it; retain the source and package
  fallback path so another available slug can be selected without changing
  runtime identifiers.
- [Existing users do not receive an automatic update] -> Document the new
  extension ID and separate-listing behavior; do not falsely present the new
  package as an update of `zeug-zz.opencode-research`.
- [Publisher casing mismatch] -> Use the registered `drmrStudio` spelling in
  the manifest, package inspection, Marketplace links, and publication login.
- [Historical documentation is rewritten accidentally] -> Scope replacements to
  current identity references and leave archived OpenSpec and released
  changelog records intact.

## Migration Plan

1. Apply the metadata, localization, active branding, workspace, workflow, and
   verifier updates described above.
2. Run formatting/checks, tests, build, VSIX packaging, and embedded-manifest
   verification.
3. Confirm the package reports `drmrStudio.opencode-scribe` and
   `OpenCode Scribe` before uploading it as a new Marketplace listing.
4. Upload the verified VSIX manually through the `drmrStudio` publisher portal,
   then verify the Marketplace URL and a clean installation.

Before publication, rollback means restoring the source metadata and packaging
references without affecting the legacy listing. After publication, a mistake
is corrected by publishing a subsequent version under the same new identity;
the publisher/name pair is not swapped in place.
