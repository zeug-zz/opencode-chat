## 1. Shared contract types

- [x] 1.1 Add provider-neutral memory operation, capability, and descriptor types while preserving existing `MemoryProviderStatus` and protocol compatibility. **Verify:** core type build and focused contract tests.
- [x] 1.2 Add explicit `none` provider metadata representing the AGENTS.md/context-only fallback with every durable-memory capability disabled. **Verify:** fallback unit tests.

## 2. Provider selection and adapters

- [x] 2.1 Add an injectable, deterministic provider-factory/selection boundary with safe exception handling and `none` fallback. **Verify:** fake factories cover first-success, unavailable, blocked, and thrown-factory cases without network or credentials.
- [x] 2.2 Add a Hindsight adapter that maps existing detection status to normalized contract metadata while keeping automatic session retention false and provider-specific details out of shared types. **Verify:** mapping tests for available, partial, configured, blocked, error, and unavailable states.
- [x] 2.3 Export the contract and adapter through existing package entry points without changing launch overlays, permissions, MCP behavior, sandbox policy, or configuration writes. **Verify:** package import/type tests and unchanged launch-shape assertions.

## 3. Compatibility and verification

- [x] 3.1 Add regression coverage proving existing detection status/protocol behavior and AGENTS.md/context fallback remain unchanged and no provider operations are invoked. **Verify:** focused core and agent tests.
- [x] 3.2 Run focused package tests, Biome checks for touched files, strict OpenSpec validation, and final scope/diff review. **Verify:** all commands pass; do not archive or commit.
