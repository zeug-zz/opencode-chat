# Proposal

## Why

The `@opencode-chat/agent-opencode` package's TypeScript build currently fails with hundreds of diagnostics, including unresolved Node globals and strict type mismatches in production code and tests. A read-only check with Node ambient types supplied reduces the current checkout's 334 diagnostics to 70, confirming a bounded package type-check repair can address the known remaining build item. The Linux-only Vibefeld fixture failure described alongside it is already fixed and is not part of this change.

## Scope

Make the agent package's existing strict TypeScript build complete with zero diagnostics while retaining type-check coverage of the package's current source and test files. Keep runtime behavior, public APIs, and security boundaries unchanged.

## What Changes

- Provide the package build with its required host type declarations.
- Correct the production and test type mismatches against the current package contracts.
- Preserve strict compiler settings; do not suppress errors or exclude test sources merely to make the build pass.

## Non-goals

- Revisit the already-fixed Linux-only Vibefeld activation fixture failure.
- Change runtime behavior, public contracts, package architecture, or root build composition.
- Refactor unrelated agent code or broaden the package's compiler scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an internal build/type-check repair with no product-behavior requirement change; `skip_specs: true` is set for this reason.

## Impact

`packages/agents/opencode/package.json`, `packages/agents/opencode/tsconfig.json`, the workspace lockfile, and only the production/test files with diagnostics in that package. No user-facing configuration or runtime API changes are intended.
