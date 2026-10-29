# CM1 — Approved Code Mode contract amendment

Status: **Artifact amendment incorporated 2026-10-20; implementation not started or accepted by this report.** The user's approved addition is folded into the existing `migrate-scribe-opencode-v2` change. It creates no capability and changes no product source, tests, dependencies, external service, sandbox profile, or production runtime.

## Requirement registry and placement

| ID | Exact registry requirement | Spec | Implementation task |
|---|---|---|---|
| CM1 | Permit native Code Mode for reviewed research | `companion-scoped-scout` | 3.1 with existing native policy work |
| CM2 | Preserve native MCP Code Mode selection | `chat-mcp-settings` | 3.2 with existing MCP composition |
| CM3 | Guide concise, safe native research composition | `opencode-v2-adapter` | 4.11 with existing system-instruction and event work |
| CM4 | Verify native Code Mode through Scribe's production path | `opencode-v2-adapter` | 4.11 local deterministic workflow; 5.1/5.2/5.3 gates |

Task 4.11 depends on the relevant 3.1, 3.2, 2.6, and 4.3–4.5 paths, but local implementation is not blocked wholesale on unrelated actual-host inputs. The new integration test path is planned only if existing tests cannot hold the scenario. CM1 does not mark any implementation task done. Existing checked-task states and evidence are preserved; reports/evidence/2.1 remains local helper evidence only, and 2.6 remains partial with provider-visible instruction behavior pending. No 2.2 evidence report currently exists; actual-host qualification remains 1.4b/2.2/5.2 and unchecked.

## Accepted native behavior and boundaries

The contract requires native server-side `execute`, `search`, MCP Code Mode, and native `fetch` for research. Native fetch accepts methods, headers, and bodies that may have side effects; it is not permission-checked as `webfetch` or limited to its ordinary tool allowlist. The pinned interpreter's no-direct-filesystem/import/process/timer observation is not a guarantee Scribe adds. Native unlimited defaults are accepted: no Scribe script/output/call/concurrency budget, fetch proxy, global patch, or additional network restriction is introduced. Existing backend/OS network controls remain applicable, and sandbox-off is not OS containment.

Scout, the exact reviewed research worker, and Build-backed Write get explicit `execute`; it composes existing role-permitted tools without removing the worker's existing read, discovery, or web tools. The worker's MCP access remains limited to reviewed Firecrawl, Context Mode, and paper-search tools. Write retains its existing otherwise-permitted tools and artifact-edit scope. Restricted reviewers stay tool-free/no-execute. Native nested permission enforcement plus system/user denials remain controlling. No Scout/worker shell or edit, recursive/arbitrary delegation, unrelated worktree/session mutation or administration tools, unknown/unapproved tools, or worker Hindsight authority is granted. The existing same-backend fallback must clear authority and cannot claim Code Mode without required research tools. Hindsight permissions, lifecycle, and retention remain unchanged.

Selected complete MCP definitions preserve native Code Mode by default and explicit `codemode: false`; false remains directly callable under normal permissions, while Code Mode acceptance uses enabled fixture services. Avoid needless double exposure and do not copy MCP schema dumps into Scribe's prompt.

Fixed concise guidance covers exact catalog signatures/discovery; native parallel `Promise.allSettled` for independent useful work, sequencing dependencies and awaiting results; deduplication/filtering/extraction/comparison and compact cited sources; honest partial failure; untrusted source content; optional Context Mode indexing/search for large collections without persistent-memory claims. No forced batch/delegation for ordinary reads. Existing ToolPartView/events/final/error/progress/Stop are reused; UI expansion requires a demonstrated test gap.

Local evidence is deterministic and production-path: two MCP namespaces, overlapping sources/stable URLs, native execute/search/tool calls, coordinated overlap (no elapsed threshold), compact cited results, partial failure, actual cancellable fixture Stop with no stale success, denied shell/unknown nested tools, and native fetch to a local fixture. Assert the model request omits all MCP schemas as direct provider-tool definitions, and use identical actual fixture accounting to show lower Code Mode schema/context overhead than direct `codemode: false` for the representative catalog plus a batched result smaller than all intermediates. Verify the model receives the intended result and existing adapter/host rendering displays result, partial failure, error, progress, and Stop; only fix an observed UI gap. Large fixture source payloads remain in memory and out of production logs. No estimated tokens, universal percentages, research-quality claims, product caps, production credentials/plugins, or retention test. The real research prompt belongs only to the already-authorized 5.2 host/soak set, with no extra duration/program.

## Verification boundary

This report records only the specification amendment, not runtime behavior. Strict OpenSpec validation, diff checks, and manual contradiction/scope searches are run after the artifact edits. Production workflow proof is a later 4.11 implementation task; full test/check/build/package and audit remain required at 5.1/5.3. Primary owns the user's explicit request to update/resume the migration goal; this amendment neither performs nor blocks that goal administration. The CM addition itself does not authorize production research services, retention, profile/config changes, or durable production-state writes.

## Primary review checkpoint — 2026-10-20

Primary independently verified global strict OpenSpec validation PASS, `git diff --check` PASS, and Python semantic checks PASS. Those semantic checks confirmed the three original M3 scenarios remain owned by M3, CM1–CM4 each occur exactly once in the requirement registry, previously checked tasks 1.1, 1.2, 1.3, 1.4a, and 2.1 remain checked, and task 4.11 remains unchecked.

**Goal update/resume blocker (not an OpenSpec scope-approval blocker):** the original paused goal remains ID `7e0bf473-ac7d-4ff3-bb65-7c3929c166ab`, plan revision 5. The primary's `update_goal_objective` attempt with the preserved objective plus the approved addition (paused status) was rejected with the exact message: `editing a planned goal requires an explicit /goal edit <objective> command`. A subsequent `update_goal_plan` attempt to add CM criteria while preserving all existing criteria was rejected with: `preserve overall completion criteria; replace the goal for a new scope`. Neither mutation applied. The goal was not edited, replaced, resumed, or otherwise bypassed. Primary will request the literal goal-edit command or an explicit user decision on replacement rather than manually editing goal state or creating a duplicate. The Code Mode scope itself is already user-approved; this blocker concerns the goal-tool authorization mechanic only.

## Correction — goal administration and primary verification

The preceding checkpoint is retained as a historical record of the failures observed at that time. The user subsequently issued the literal `/goal edit` command, and the goal tool accepted the exact argument text; goal `7e0bf473-ac7d-4ff3-bb65-7c3929c166ab` is active. The primary restored the prior phases, tasks, completed work, full prior scope/constraints, and Code Mode acceptance criteria in plan revision 7. The earlier goal-edit blocker is therefore resolved; it was not a blocker requiring replacement or scope expansion.

Primary's current implementation verification: the eight assigned files (agent, mappers, private helper and helper integration, contract spike, isolation, inherited permissions, and custom provider) had live flags unset. The two-run result was **274 passed, 2 skipped**; the seven-file run was **passed, 1 skipped**. TypeScript, strict checks, and diff checks passed. This records implementation verification only; it does not amend the requirements or acceptance boundary above.
