## 1. Provider-Neutral Routing Metadata and Evaluation Contract

- [x] 1.1 Add bounded provider-neutral reasoning-review routing metadata with an allowlisted reason code, automatic/manual distinction, and optional summary field; verify existing manual summaries and protocol/core type tests remain compatible and the contract contains no AF, path, command, prompt, ledger, source-packet, credential, or private-reasoning fields.
- [x] 1.2 Add the private automatic-routing evaluation types, fixed qualification targets, aggregate-only validator, and in-memory measurement helper; verify qualified corpora require at least 100 cases, p95 latency <= 2,000 ms, expected calibration error <= 0.10, false-challenge rate <= 0.05, and all malformed/non-finite/over-target inputs fail closed without retaining case content.

## 2. Deterministic Automatic-Selection Policy

- [x] 2.1 Implement the host-private automatic-routing policy with explicit enablement, available-runtime and qualified-evaluation gates, completed active-session binding, supported work-mode checks, ordinary-work exclusions, and stable bounded reason explanations; verify eligible argument/evidence/recommendation fixtures select and lookup/translation/creative/coding/worker/incomplete/empty fixtures skip.
- [x] 2.2 Add router lifecycle validation for duplicate suppression, manual-review precedence, generation/session/message binding, bounded input/output, unsafe rationale rejection, and no response-gate transition; verify stale, repeated, malformed, cancelled, timed-out, and terminal inputs produce no automatic controller request or release action.

## 3. Host Post-Response Integration

- [x] 3.1 Add an optional host router/evaluation injection and record only the bounded prompt metadata needed for the latest response; verify extension construction remains compatible and the default path supplies no qualified evaluation or automatic capability.
- [x] 3.2 Integrate automatic selection after authoritative idle completion using the existing bounded visible-text extraction and review controller, annotate selected summaries as automatic with validated routing metadata, and preserve manual precedence and existing session invalidation; verify duplicate idle events make at most one request and an automatic review never delays, rewrites, gates, or releases the original response.
- [x] 3.3 Add focused extension-host tests for eligible selection, unavailable/unqualified fallback, duplicate idle notifications, manual-review precedence, session switching/deletion, cancellation, stale results, and controller failure; verify no raw prompt/source/provider data reaches webview messages or diagnostics.

## 4. User-Facing Rationale and Compatibility Boundaries

- [x] 4.1 Render the bounded automatic-selection label and reason in the existing reasoning review card while preserving manual/unavailable behavior; add synchronized keys to every webview locale and verify localized component and scenario tests cover automatic and manual summaries.
- [x] 4.2 Add security-negative and bootstrap tests proving the automatic-routing implementation does not launch processes, access the network, write proof workspaces or configuration, add AF/plugins/MCP/tools/tasks/agents, broaden permissions, change sandbox/nono/TUI behavior, or wire the unavailable/fixture evaluation as an active production capability.

## 5. Verification

- [x] 5.1 Run focused core, Vibefeld platform, extension-host, and webview tests; verify evaluation qualification, deterministic reasons, routing lifecycle isolation, localized rationale, manual compatibility, and fail-closed security behavior.
- [x] 5.2 Run `pnpm run check`, `pnpm run build`, and `pnpm run test:all`; verify ordinary Chat and Write behavior and existing security boundaries remain unchanged.
- [x] 5.3 Run `openspec validate add-vibefeld-automatic-routing --strict` and `git diff --check`; inspect the final diff for scope creep, project-relative scratch paths, untouched prior changes, no generated artifacts, and no commit/push/archive operations.
