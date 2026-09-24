# Tasks

## 1. Restore package-owned Node type context

- [x] 1.1 Declare the Node type package as a development dependency of `@opencode-chat/agent-opencode`, select Node ambient types in its strict `tsconfig.json`, and update `pnpm-lock.yaml`; verify the package compiler no longer reports unresolved Node ambient symbols while strict options and source/test inclusion remain unchanged.

## 2. Correct production source diagnostics

- [x] 2.1 Fix the remaining production-source diagnostics in `hindsight-companion-integration.ts` and `opencode-agent.ts` with contract-accurate typing and narrowing, preserving runtime behavior; verify the compiler reports no diagnostics outside `src/__tests__` and focused OpenCode agent tests pass.

## 3. Update smaller test fixtures to current contracts

- [x] 3.1 Correct type errors in `hindsight-companion-integration.test.ts`, `mcp-overlay.test.ts`, and `sandbox-runtime.integration.test.ts` by supplying current contract fields and precise fixture types, without weakening assertions; verify each affected focused test suite passes.

## 4. Repair OpenCode agent test typing

- [x] 4.1 Correct remaining `opencode-agent.test.ts` diagnostics, including overloaded spawn-call observations and stale launch fixtures, using narrow types without `any`, blanket casts, or assertion removal; verify the focused test suite passes and `pnpm --filter @opencode-chat/agent-opencode build` completes with zero TypeScript diagnostics.

## 5. Run final validation

- [x] 5.1 Run `pnpm --filter @opencode-chat/agent-opencode test`, `pnpm run check`, `pnpm run build`, `openspec validate fix-agent-package-typecheck --strict`, and `git diff --check`; confirm strict test coverage remains enabled and the diff changes no runtime behavior or unrelated files.
