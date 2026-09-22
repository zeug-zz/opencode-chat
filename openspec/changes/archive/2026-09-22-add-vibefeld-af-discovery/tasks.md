## 1. Discovery Roots

- [X] 1.1 Extend discovery with home-relative roots: add `createAfDiscoveryRoots(homePath)` in `af-discovery.ts` returning the approved system roots followed by `~/go/bin`, `~/bin`, and `~/.local/bin` when `homePath` is a usable absolute path (deduplicated, deterministic order), thread an optional `homePath` option through `resolveAfExecutable`/`resolveAfRuntime` (default `os.homedir()`), and keep every existing ownership, executable, ambiguity, and reason semantic; verify focused tests cover a home-root-only install resolving found/ready, an invalid homePath falling back to system roots, home candidates that are not owned or not executable keeping their existing reasons, two distinct installs still resolving `ambiguous`, dedup with PATH duplicates, and that discovery performs no process launch, PATH mutation, or write.

## 2. Explicit Executable Setting

- [X] 2.1 Add `readVibefeldAfPath(scope?)` to `vibefeld-settings.ts` (bounded trimmed string, blank/invalid types ignored) and an `explicitExecutable` option to `resolveAfRuntime` that validates an absolute path with the same host-uid-ownership/regular-file/executable seams and, when valid, resolves ready with exactly that executable; an invalid explicit value resolves dormant `missing-af` without consulting other candidates; verify focused tests cover valid absolute path used directly, relative/missing/not-owned/not-executable/blank values failing closed with `missing-af` and no fallback, unset values leaving discovery unchanged, and the setting never being sourced from model/webview input.

## 3. Activation Wiring

- [X] 3.1 Read `vibefeld.afPath` once in the activation step that already resolves the runtime (the same single point that gates on global storage), pass it into `resolveAfRuntime`, and leave every other activation, selection, and status-read path untouched; verify focused extension tests cover the unset case being behavior-identical, the configured case threading the value, no additional discovery or setting read on status reads, a setting change applying only on the next activation, and no configuration or workspace write.

## 4. Verification

- [X] 4.1 Run the focused discovery/resolution/settings/extension suites; verify the default suite launches no process, reads no real host AF, and every dormant and failure path stays bounded. Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`; run `openspec validate add-vibefeld-af-discovery --strict` and `git diff --check`; inspect the final diff for scope creep, project-relative scratch paths only, untouched predecessor changes, no generated artifacts, and no commit, push, or archive operation.
