## 1. Private Runtime Contract

- [x] 1.1 Add platform-private AF runtime evidence, command observation,
  workspace-effect, failure, compatibility, and dedicated process-boundary
  types under `packages/platforms/vscode/src/vibefeld/`; keep AF-specific
  details out of `packages/core`, the webview protocol, and production launch
  paths.
- [x] 1.2 Define the non-executable contract defaults and conservative result
  classification: no approved production operations in this phase, direct
  argv/`shell: false` required for a future bridge, extension-storage review
  roots, descendant policy inheritance, bounded output/timeout requirements,
  and unavailable/audit-failed fallback for unknown outcomes.

## 2. Observed Fixture Corpus

- [x] 2.1 Add sanitized, project-relative AF fixtures under the extension test
  fixtures directory for the observed external AF `0.1.7` build (`5a37413`,
  build `2026-09-08T02:25:39Z`, Go `go1.27.1`, Darwin arm64, workspace format
  `1.0`), including version JSON, schema JSON, initialized workspace shape,
  normalized `status --format json`, and representative invalid-node and
  missing-workspace failures.
- [x] 2.2 Ensure fixtures contain argv arrays and bounded normalized data only;
  omit host executable paths, secrets, raw prompts, source packets, private
  reasoning, unrestricted stdout/stderr, and user workspace content. Add
  manifest metadata distinguishing observed facts from unapproved future
  operations.

## 3. Fixture Validation and Replay

- [x] 3.1 Add pure fixture loading, normalization, and validation helpers that
  reject unsupported schema/runtime identity, absolute or escaping paths,
  shell command strings, unsafe values, unbounded output, malformed JSON, and
  incomplete boundary requirements without resolving or spawning AF.
- [x] 3.2 Add focused extension-host tests that replay the checked-in fixtures,
  preserve exact observed exit facts, accept bounded successful JSON, keep the
  approved operation set empty, and classify non-zero/malformed/oversized/
  timeout/cancellation/signal cases as bounded non-success.

## 4. Dedicated Boundary Contract

- [x] 4.1 Encode and test the future dedicated macOS/Linux boundary
  requirements: fixed host-resolved executable, typed fixed operations,
  `shell: false`, review roots beneath `context.globalStorageUri`, denied
  repository/home/OpenCode-state/sibling writes, symlink/traversal/rename
  protection, descendant confinement, bounded I/O, timeout/cancellation cleanup,
  and no unsandboxed or Chat-sandbox downgrade.
- [x] 4.2 Keep the contract non-executing and preserve the existing unavailable
  controller and extension initialization. Add negative coverage proving
  activation and ordinary manual review do not import/use process spawning,
  create proof workspaces, change configuration, add plugins/MCP/tools, or
  alter Chat, Write, Scout, worker, MCP, sandbox, reasoning-streaming, or TUI
  permissions.

## 5. Verification

- [x] 5.1 Run focused runtime-contract, unavailable-controller, and extension
  host tests with the extension-host Vitest configuration.
- [x] 5.2 Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`.
- [x] 5.3 Run `openspec validate add-vibefeld-runtime-contract --strict` and
  `git diff --check`, then inspect the final diff for scope creep and confirm
  no existing scaffold task was changed or marked complete by this change.
