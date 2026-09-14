## Why

The active `main-branch-protection` ruleset requires successful `Analyze (javascript-typescript)` and `Analyze (actions)` CodeQL checks. Repository-level CodeQL default setup produces only a neutral aggregate `CodeQL` status for Dependabot pull requests, leaving otherwise-passing dependency updates permanently unmergeable without an unsafe policy bypass.

## What Changes

- Replace the repository-default CodeQL path with a versioned advanced CodeQL workflow that runs on `push` to `main` and `pull_request` targeting `main`.
- Emit the exact two required job names: `Analyze (javascript-typescript)` and `Analyze (actions)`.
- Pin all CodeQL and checkout actions to immutable SHAs and grant only the permissions required for code scanning.
- Preserve untrusted pull-request execution under `pull_request`; do not use `pull_request_target`, checkout a Dependabot head under elevated trust, or weaken the ruleset.
- After the versioned workflow is merged and its required checks pass, disable repository-level CodeQL default setup and verify advanced setup is the only active CodeQL path.

## Capabilities

### New Capabilities

None. This is repository CI/security tooling with no extension runtime behavior change.

### Modified Capabilities

None.

## Impact

Affected systems are `.github/workflows/`, repository CodeQL configuration, and the existing `main-branch-protection` required-status policy. This unblocks eligible Dependabot pull requests while preserving required checks and the security boundary for untrusted pull-request code.

## Risks, fallback, and compatibility

A misnamed job would remain blocked by the existing ruleset, so the exact required names are a release gate. Running pull-request code with `pull_request_target` would expose elevated repository credentials and is prohibited. If advanced setup fails after migration, restore default setup through the repository CodeQL configuration rather than weakening required checks. No extension, sandbox, nono, or user-facing behavior changes.