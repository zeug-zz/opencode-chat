## Context

See `proposal.md` for motivation. The extension package is assembled from `packages/platforms/vscode`; `esbuild.mjs` and Vite write generated output, `.vscodeignore` controls the VSIX contents, and `scripts/verify-bundled-research-package.ts` currently validates only bundled research-resource entries. The release workflow builds and tests successfully but packages with a broad `*.vsix` upload glob and does not run the package verifier.

This change is deliberately limited to the distribution pipeline. The nono launch backend, the VS Code compatibility sandbox, agent overlays, MCP/plugin behavior, and runtime process semantics are fixed compatibility boundaries and must remain untouched.

## Goals / Non-Goals

**Goals:**

- Make repeated local and CI builds start from a clean extension-generated output directory without deleting source or user state.
- Keep runtime files required by the extension while excluding development-only compiled tests, source maps, and packaging/build scripts from the VSIX.
- Make package verification inspect the actual archive, not just the resource staging directory, and fail with bounded actionable errors for identity/version or forbidden-entry violations.
- Make CI package and verify one manifest-derived VSIX after a frozen dependency install.
- Keep the root third-party notice as the source copied into the extension package and correct only metadata that can be verified from the repository.

**Non-Goals:**

- No Marketplace upload, support integration, scanner evasion, or change to extension functionality.
- No removal of `shell: true` from the compatibility sandbox path; the current `SandboxManager` API supplies a wrapped command string and the fallback must retain its existing enforcement.
- No dependency upgrades, nono changes, sandbox policy changes, global configuration writes, or changes to release versioning policy.

## Decisions

### 1. Clean only generated extension output before build

Add a cross-platform Node-based cleanup step to the extension build path, targeting only the extension's generated `dist` directory. Run it before esbuild/Vite output is produced, and keep the cleanup idempotent. Do not use shell-specific `rm` commands or remove the entire package directory.

This prevents stale bundles from surviving a rebuild while preserving source files, staged resources, and manually copied notices. A clean directory is preferred over trying to enumerate every stale filename.

### 2. Use package exclusions for development-only files

Extend `packages/platforms/vscode/.vscodeignore` with narrowly scoped patterns for compiled test artifacts, source maps, and package-maintenance scripts. Do not exclude the complete `dist` directory or any runtime bundle/resource needed by `main`, the webview, or bundled research features. Keep the exclusions declarative so `vsce package` applies them identically for local and CI packaging.

The verifier should assert the resulting archive has no excluded classes, so a future ignore-file regression is visible rather than silently accepted.

### 3. Extend the existing verifier rather than add a second packager

Retain the existing ZIP central-directory reader and add the smallest archive-content helpers needed to inspect `extension/package.json`. Validate the package manifest's `name`, `publisher`, `version`, and `main` against the packaged extension manifest, then reject archive entries matching development-only or native-payload patterns. Preserve the existing exact bundled-resource checks.

The verifier should accept an explicit archive path and otherwise resolve the current manifest-derived filename, never choose an arbitrary unrelated VSIX, and produce no file-content or environment diagnostics beyond bounded failure text. Tests should exercise valid entries and each rejection class without requiring Marketplace access.

The native-payload check is a distribution hygiene guard, not a claim that runtime process execution is absent: Scribe intentionally invokes externally installed OpenCode/nono and that behavior remains unchanged.

### 4. Make release packaging manifest-derived and fail closed

Change the release job to use `pnpm install --frozen-lockfile`, invoke the existing package-verification script, and expose exactly the generated `opencode-scribe-<package.version>.vsix` as the GitHub Release asset. The workflow must not upload every VSIX in the directory. The package step may continue copying the root notices into the package workspace, but verification must run after that copy.

This removes ambiguity from stale local artifacts and makes the same named archive the one tested and distributed. It does not add Marketplace credentials or an automated Marketplace publish step.

### 5. Treat the root notice as the source of truth

Update the root `THIRD_PARTY_NOTICES.md` only for demonstrably stale product identity and versions that correspond to the repository's current packaged dependency versions. Keep the package-local copy synchronized through the existing release copy step; do not maintain divergent hand-edited copies. If a dependency version cannot be established from the current lockfile/package metadata, leave it unchanged rather than guessing.

## Risks / Trade-offs

- **A required runtime file matches an exclusion pattern** → build and package verification must run before distribution, and focused tests must confirm expected runtime entries remain present.
- **ZIP parsing is incomplete for an archive form produced by `vsce`** → keep the existing ZIP64 rejection behavior, test the generated archive in the package verification command, and fail closed rather than making unverified claims.
- **Cleaning `dist` removes a developer's untracked debug output** → scope cleanup to generated extension output and document that `dist` is disposable build output.
- **Metadata or notice drift remains elsewhere in historical documentation** → limit this change to the distributed notice and package metadata; do not undertake a broad rebrand or documentation rewrite.
- **The release workflow has multiple VSIX files from an older run** → derive one filename from the package manifest and pass only that path to the release upload action.

## Migration Plan

1. Add cleanup and archive verification tests, then implement the build/package changes.
2. Run local build, full relevant tests, strict OpenSpec validation, and `package:verify` against a freshly generated VSIX.
3. For manual installation, copy only the verified manifest-derived VSIX to each machine and install it through VS Code's Extensions: Install from VSIX command.
4. Rollback is limited to reverting this change; the prior runtime behavior and existing nono/compatibility sandbox configuration remain unaffected.
