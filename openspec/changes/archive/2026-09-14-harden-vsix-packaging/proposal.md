## Why

Manual VSIX installation is now the intended distribution path, so the artifact itself must be deterministic and easy to audit. The current build can retain stale generated output, the package verifier checks only bundled research resources, and release automation does not enforce a frozen install or verify one explicit VSIX; these issues create avoidable provenance and trust ambiguity without requiring any change to Scribe, nono, or the compatibility sandbox.

## What Changes

- Make extension builds remove stale generated output before rebuilding.
- Keep development-only tests, source maps, packaging scripts, and other build residue out of the distributed VSIX.
- Extend the VSIX verifier with focused manifest and archive-hygiene checks, including the expected extension identity/version and forbidden development or native payload entries.
- Make the release workflow install from the lockfile, run package verification, and publish/upload one explicitly identified artifact rather than an ambiguous glob.
- Correct the distributed third-party notice metadata where it is demonstrably stale or uses the former product identity.

### Non-goals and compatibility

- Do not alter the nono backend, the VS Code compatibility sandbox, sandbox permissions, process-launch semantics, inherited plugin/MCP behavior, agent restrictions, or TUI handoff.
- Do not remove security controls or change runtime capabilities to address speculative Marketplace scanner behavior.
- Do not require Marketplace publication; the resulting VSIX must remain suitable for manual installation on trusted machines.
- Do not add dependencies, bundle nono, or modify global OpenCode/Hindsight configuration.

## Capabilities

### New Capabilities

None. This is a packaging, release-tooling, and metadata maintenance change with no new user-facing runtime capability.

### Modified Capabilities

None. No existing runtime requirement changes.

## Impact

Affected areas are `packages/platforms/vscode` packaging configuration and verification scripts, `.github/workflows/release.yml`, and the distributed `THIRD_PARTY_NOTICES.md`. The implementation should add or update focused tests for archive/manifest validation and preserve the existing extension runtime and manual VSIX installation behavior.
