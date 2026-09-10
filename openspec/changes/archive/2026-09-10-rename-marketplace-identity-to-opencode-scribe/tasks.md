## 1. Manifest and Current Branding

- [x] 1.1 Set the VS Code manifest publisher to `drmrStudio` and package name to `opencode-scribe`, then verify the manifest parses and reports the exact target values.
- [x] 1.2 Change the localized `displayName` value in every `package.nls*.json` file to `OpenCode Scribe`, then verify all locale resources resolve the same current display name.
- [x] 1.3 Update current package contribution titles/descriptions and user-facing extension strings from `OpenCode Research` to `OpenCode Scribe`, then verify no current UI path presents the old product name.

## 2. Workspace and Release Plumbing

- [x] 2.1 Update root workspace scripts and `.github/workflows/release.yml` filters from `opencode-research` to `opencode-scribe`, then verify the new filter resolves the VS Code workspace package.
- [x] 2.2 Update the VSIX verifier's artifact filename matching and diagnostics to use `opencode-scribe`, then verify it recognizes a newly generated `opencode-scribe-<version>.vsix` artifact.
- [x] 2.3 Update current Marketplace badges, install instructions, AGENTS guidance, architecture/security references, issue-template text, and related documentation to use `drmrStudio.opencode-scribe` and `OpenCode Scribe`; verify historical changelog and archived OpenSpec identity records remain unchanged.

## 3. Compatibility and Identity Boundaries

- [x] 3.1 Preserve `opencode-chat.*` view, configuration, activation, and URI identifiers plus the `@opencode-chat/*` package scope, then verify the targeted source search and existing extension tests show no runtime identifier changes.
- [x] 3.2 Document that `drmrStudio.opencode-scribe` is a separate listing from `zeug-zz.opencode-research`, then verify current install instructions do not claim automatic upgrade compatibility.

## 4. Build and Package Verification

- [x] 4.1 Run `pnpm run check`, `pnpm test:all`, and `pnpm run build`, then verify formatting, tests, and the production build pass.
- [x] 4.2 Run `npm run package:verify` from `packages/platforms/vscode`, then verify the embedded VSIX manifest and localized resources report publisher `drmrStudio`, name `opencode-scribe`, display name `OpenCode Scribe`, and stable activation/view identifiers.
- [x] 4.3 Audit active source and documentation references for stale `opencode-research`, `DRMR`, and legacy Marketplace links while allowing explicitly historical records, then verify only the intended identity references remain.

## 5. Marketplace Publication

- [x] 5.1 Remove and verify the PAT-based automated publication route, and document that Marketplace publication uses the manual `drmrStudio` publisher portal without storing or using a PAT or Marketplace credential in the repository or CI.
- [x] 5.2 Manually upload the verified VSIX through the `drmrStudio` publisher portal, then verify the Marketplace page and a clean installation identify the extension as `OpenCode Scribe`.
- [x] 5.3 After implementation and verification are accepted, sync the modified `opencode-chat-rebrand` delta into the canonical spec and archive this OpenSpec change without rewriting historical identity records.
