# Design

## Context

See `proposal.md` for motivation. `packages/agents/opencode/tsconfig.json` uses strict TypeScript, targets ES2022, emits declarations, and includes `src/**/*`, which currently includes the package's tests. It does not explicitly select Node ambient types. In this checkout, the package check reports 334 diagnostics as configured; a diagnostic-only invocation with `--types node` reduces that to 70. The remaining errors are concentrated in `hindsight-companion-integration.ts`, `opencode-agent.ts`, and four test files with fixtures/mocks that no longer satisfy current contracts.

## Goals / Non-Goals

**Goals:**
- Make the existing package build typecheck all currently included source and test files with zero diagnostics.
- Keep strictness and runtime behavior intact; represent actual contracts instead of suppressing errors.

**Non-Goals:**
- Exclude tests from the package TypeScript program or add a weaker parallel config to hide their diagnostics.
- Change product behavior, public API shapes, or the root build composition.
- Repair the separate Linux-only Vibefeld fixture issue, which is already fixed.

## Decisions

### Declare and select the package's Node types

Add Node type declarations as a direct development dependency of `@opencode-chat/agent-opencode` and explicitly include the Node ambient type package in its TypeScript configuration. This makes the Node-only adapter's types reproducible at the package boundary and addresses the large cascade of unresolved `node:*`, `NodeJS`, `process`, and process API declarations. The current checkout resolves `@types/node` transitively, but relying on that unrelated dependency is insufficient for a package-owned build.

### Keep the existing strict program boundary

Retain strict compiler options and the current source/test inclusion. Fix the remaining diagnostics in production code and test fixtures/mocks to match the existing types and current SDK/package contracts. For overloaded child-process APIs, narrow the selected call signature and type test observations rather than broad-casting. For stale fixtures, supply the fields required by the current contracts and preserve the tests' behavioral assertions.

The simpler alternative of excluding `src/__tests__` from the build would make the command pass without checking code that the current config intentionally includes. Disabling strict checks, adding broad `any` casts, or suppressing diagnostics would similarly conceal stale contracts rather than repair the reported build item.

## Risks / Trade-offs

- [Type-only repairs could weaken an assertion while silencing a diagnostic] → Preserve the existing runtime expectations and use narrow, contract-accurate types; do not use `any`, blanket casts, or reduced strictness.
- [The package gains an explicit development dependency] → Keep it development-only and update the workspace lockfile; runtime dependencies and emitted runtime code remain unchanged.
