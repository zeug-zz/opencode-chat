## 1. Closed AF Operation and Output Contracts

- [x] 1.1 Add a platform-private fixed AF operation union under `packages/platforms/vscode/src/vibefeld/` for only the observed `version`, `schema`, `init`, and `status` operations. Build direct argv with `shell: false` at the boundary, keep executable/workspace ownership internal, bound initialization inputs, and reject unknown verbs, flags, shell strings, executable overrides, workspace overrides, and raw argv. Add focused tests for every supported argv shape and rejected input.
- [x] 1.2 Add bounded parsers/normalizers for the pinned version, schema, initialization, and status JSON fixtures. Preserve only normalized host-private facts, reject malformed/oversized/identity-mismatched output and unsafe values, discard raw stdout/stderr, and keep structural review status null. Add focused tests for success, non-zero, malformed, oversized, timeout, cancellation, and signal facts.

## 2. Dedicated Proof Workspace

- [x] 2.1 Add a private proof-workspace store rooted beneath an injected VS Code global-storage path. Allocate unique session/review roots, expose only opaque internal handles, and enforce repository/home/OpenCode-state/sibling-root separation, real-path containment, no-symlink ancestors, bounded names, and project-compatible cleanup. Do not persist source packets, prompts, credentials, private reasoning, or raw child logs.
- [x] 2.2 Add extension-host tests for workspace allocation, containment, traversal/symlink/rename rejection, sibling isolation, cleanup failure, and non-destructive behavior. Tests must use project-relative `tmp/` artifacts or injected filesystem seams and must not touch a user workspace or global configuration.

## 3. Enforced AF Process Boundary

- [x] 3.1 Add the dedicated macOS/Linux AF policy adapter contract and policy descriptor. It must accept only the host-resolved executable, internal argv, required read-only runtime grants, and one review-root write grant; require descendant confinement, deny unapproved child execution and denied domains, and fail closed when policy support is absent or ambiguous. Do not call, reset, or reuse the Chat `SandboxManager`.
- [x] 3.2 Implement bounded direct-argv execution through the dedicated policy seam with `shell: false`, operation-specific timeouts, bounded stdin/stdout/stderr, abort propagation, descendant termination/reaping, redacted bounded diagnostics, and cleanup invalidation. Add tests proving no unsandboxed/Chat-sandbox retry and correct unavailable/audit-failed classification for policy, timeout, cancellation, signal, malformed, oversized, and cleanup failures.

## 4. Runtime Compatibility Bridge

- [x] 4.1 Add the platform-private runtime bridge that composes pinned fixture validation, host executable resolution, version/schema preflight, policy readiness, proof-root allocation, fixed command execution, output normalization, and cleanup. It must expose only typed host-private results, report unavailable/incompatible until every prerequisite passes, refuse subsequent work after audit failure, and never publish a structural review or raw path/output.
- [x] 4.2 Add focused runtime tests for compatible and incompatible identities, unsupported platforms, missing executable/policy, preflight failures, ready-to-running lifecycle transitions, operation sequencing, proof-root ownership, cancellation, teardown, and no automatic fallback. Keep the existing `UnavailableReasoningReviewController` and normal extension activation path unchanged.

## 5. Dormancy, Security Negatives, and Opt-In Integration

- [x] 5.1 Add negative extension-host coverage proving the bridge is not exposed through OpenCode plugins, MCP, custom tools, Scout, Write, worker delegation, ordinary Chat, `IAgent`, or the webview protocol; it must not modify OpenCode/AF/nono/user sandbox configuration or replace the unavailable manual-review controller in this change.
- [x] 5.2 Add an opt-in AF integration suite requiring `OPENCODE_CHAT_RUN_VIBEFELD_INTEGRATION=1`, an explicitly selected disposable AF executable, and an independently validated dedicated policy. Default runs must skip before resolution/spawn when inputs are absent; gated runs use only project-local disposable artifacts and assert direct argv, bounded output, descendant cleanup, denied escape/write behavior, no downgrade, and no raw diagnostic leakage.

## 6. Verification

- [x] 6.1 Run focused Vibefeld bridge and extension-host tests with the extension-host Vitest configuration, including the default-safe integration skip.
- [x] 6.2 Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`.
- [x] 6.3 Run `openspec validate add-vibefeld-runtime-bridge --strict` and `git diff --check`, inspect the final diff for scope creep, and confirm no prior Vibefeld scaffold/contract task checkbox or unrelated worktree change was modified.
