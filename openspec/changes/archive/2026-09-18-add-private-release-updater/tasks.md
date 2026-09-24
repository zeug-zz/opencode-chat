## 1. Release metadata and asset validation

- [x] 1.1 Implement isolated unauthenticated latest-release metadata, SemVer, stable-release, exact asset-name, and installed-version validation with bounded failure handling; add focused unit tests for valid newer releases, prereleases, drafts, malformed tags, missing assets, older/equal versions, unauthorized responses, and no credential/fallback behavior; verify with `pnpm --filter opencode-scribe run test:ext -- src/__tests__/private-release-updater.test.ts`

## 2. VSIX download and identity validation

- [x] 2.1 Implement validated local VSIX download into extension-managed global storage with response/size/completeness checks and publisher/name/version manifest identity validation against the discovered release; add tests for successful downloads, incomplete or invalid artifacts, mismatched manifest identity, cleanup/abandonment, and exact local installer URI preparation; verify with `pnpm --filter opencode-scribe run test:ext -- src/__tests__/private-release-updater.test.ts`

## 3. Lazy startup and command wiring

- [x] 3.1 Wire the updater to `onStartupFinished` and a manual check/retry command without constructing, connecting, or using Chat, OpenCode, MCP, nono, companion, sandbox, or research-worker services; add extension-host tests proving startup checks are independent of unopened Chat, failures are non-fatal, duplicate announcements use global state, and manual checks bypass suppression; verify with `pnpm --filter opencode-scribe run test:ext -- src/__tests__/extension.test.ts`

## 4. Consent-gated installation and reload UX

- [x] 4.1 Integrate non-blocking update availability UX with one explicit `Update` consent for the already validated download/install and a separate explicit reload confirmation, using VS Code's local VSIX install and reload commands only after consent; add host tests for accept/decline/cancel at each boundary, successful install/reload sequencing, bounded failures, retry availability, and no automatic install or reload; verify with `pnpm --filter opencode-scribe run test:ext -- src/__tests__/extension.test.ts`

## 5. Release-facing metadata and documentation

- [x] 5.1 Add synchronized manifest localization entries, apply the coordinated minor version and root/package changelog updates, update README installation/update guidance, and preserve the existing manifest-derived VSIX naming and GitHub Release workflow semantics without Marketplace or credential changes; verify with `node -e 'const fs=require("fs"); for (const p of ["package.json","packages/platforms/vscode/package.json"]) JSON.parse(fs.readFileSync(p,"utf8"));'`, a workflow asset-path inspection, and `git diff --check`

## 6. Broad required verification

- [x] 6.1 Run the complete required verification after all implementation tasks: focused updater and extension-host tests, `pnpm run test:all`, `pnpm run check`, `pnpm run build`, package verification, `git diff --check`, and `openspec validate add-private-release-updater --strict`; verify `openspec status --change add-private-release-updater --json` reports the expected completed task state and confirm no Marketplace lookup, credentials, automatic install/reload, or Chat/OpenCode startup occurs during background checking
