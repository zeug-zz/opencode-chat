# OpenCode V2 integration migration plan for OpenCode Scribe

**Status:** Revised draft; planning only
**Revised:** 2026-10-19
**Scope:** Migrate Scribe's remaining V1 server integration to the native OpenCode V2 client and server contract in an already V2-only environment.

> This plan does not authorize implementation, extension deployment, user configuration changes, or OpenCode installation changes. Implementation requires review and approval of this plan and the corresponding OpenSpec change.

## 1. Objective and decisions

Move Scribe's adapter to the native V2 server API without changing its product boundary. Scribe remains a read-oriented research and report-writing extension with its own process-scoped server, in-memory overlays, and sandbox controls. General coding, shell, package, and terminal work remains in the independent OpenCode TUI.

1. **V2 is the current platform, not a future cutover.** V1 is deprecated; the stable `opencode` command already runs V2. Existing plugins and configuration have been customized for V2. Do not reintroduce V1 coexistence, V1 fallback, or a migration back to legacy configuration.
2. Use **`@opencode/client`** for the V2 HTTP API. The existing `@opencode-ai/sdk/v2` import belongs to the old SDK package and is not the OpenCode 2 client.
3. Continue to own a private foreground `opencode serve` child process. Do not use `Service.ensure()`, attach to the shared user service, or embed `@opencode/sdk` in the VS Code host.
4. Implement a V2-only adapter. Do not maintain parallel V1/V2 adapters or introduce `opencode2` as a default, dependency, or release requirement.
5. Resolve stable `opencode` for extension-host operations and verify executable/server compatibility. A scoped executable override may select another supported V2 build for testing, not a legacy host.
6. Treat the user's current V2 configuration and plugins as read-only inputs. Scribe must preserve their customizations and express its own restrictions through process-scoped overlays.
7. Installed V2 functionality is not proof of Scribe compatibility. Qualify effective permissions, plugin lifecycle, MCP behavior, and capabilities independently inside Scribe's restricted process.
8. Unsupported or unverified capabilities remain unavailable. Never claim parity or weaken security to make a feature work.
9. Preserve the user's existing working Scribe integrations, explicitly including Vibefeld/AF and Hindsight, as migration requirements rather than new features. Inventory their actual installed behavior and approved boundaries; a V2 regression cannot be accepted merely by relabeling that behavior optional. Any deliberate reduction requires explicit user approval and corresponding OpenSpec changes.

## 2. Relationship to the completed platform migration

The previous plan depended on a wider V1/V2 coexistence, plugin-porting, soak, and command-link cutover. Those are no longer prerequisites for this workstream.

The **2026-10-19 completion record** in `/Users/zeug/Projects/Sandbox/plans/v2-migration.md` is current platform context for this workstream. Its original coexistence, V1 fallback, month-long platform soak, and future-cutover sections are historical and superseded where they conflict with that record. Adopt the recorded host/sandbox/integration outcomes without reopening completed platform migration work or assuming that every historical checklist item passed. This plan does not revise that document.

Remaining work is Scribe integration migration and release qualification. It must not reinstall V1, change Homebrew links, rewrite shared configuration, port externally owned plugins, or restart the user's shared OpenCode service. A working V2 TUI does not establish that the old Scribe adapter works against V2.

## 3. Baseline and evidence

Read-only checks on 2026-10-19 found:

| Surface | Current evidence | Implementation follow-up |
|---|---|---|
| Stable command | `opencode --version` reports `opencode v2.0.32` | Recheck terminal and actual VS Code extension-host resolution |
| Platform configuration/plugins | User reports V2-customized configuration and plugins | Inventory relevant identities, versions, source locations, and effective behavior without exposing values |
| CLI sandbox | Platform completion record reports `opencode-local` with `workdir.access: readwrite`; launcher grants the selected approved workspace root and starts the server within nono | Verify equivalent effective workspace access and server/descendant containment under Scribe's selected backend; do not automatically select or rewrite this profile |
| Hindsight deployment | Completion record reports plugin-managed daemon mode, runtime credential injection, unchanged loopback endpoint and external PostgreSQL mapping | Preserve that deployment contract and verify the GUI/private-child launch receives the approved injection context without reading or persisting credential values |
| Codex quota retry | Completion/deployment reports record a delivered V2 entrypoint/helper, 19/19 provider-free regressions, fixture-composed installed-runtime PASS, and fresh private global-loader PASS | Qualify the deployed implementation in Scribe's actual launch; those reports do not prove Scribe behavior or loading in an already-running process |
| Agent dependency | `@opencode-ai/sdk` `^1.18.18` in `packages/agents/opencode/package.json` | Replace with a verified compatible V2 client |
| Adapter implementation | `opencode-agent.ts` imports `@opencode-ai/sdk/v2` and still calls `createOpencodeServer` | Replace old client/server construction consistently across launch paths |
| MCP inventory | `mcp-inventory.ts` still reads `config.mcpServers ?? config.mcp` | Verify native `mcp.servers` discovery and precedence |
| Working tree | `plans/scribe-v2-migration.md` is untracked | Preserve it and any other user work; recheck before implementation |

The old `1.19.3`/`2.0.29` command snapshots are historical, not current requirements. Version `2.0.32` is an observed candidate, not yet a proven server/client pairing. No private server, provider smoke, or plugin qualification was run during this review.

The platform completion/deployment reports were reviewed, not independently rerun here. They establish the reported cutover and specific integration fixes, not that every configuration document uses native V2 syntax or every historically listed plugin is now compatible. The deployment report records unchanged configuration hashes; preserve supported legacy/native/mixed source formats as found while keeping Scribe's own overlays native V2. Context Mode MCP versus plugin availability still requires separate inventory.

Never copy credential-bearing configuration, auth data, server passwords, prompts, raw payloads, or unredacted environment values into plans or test output.

## 4. Compatibility work still required

### 4.1 Client, API, and domain boundary

The server API is an intentional V2 breaking change. Inventory every `IAgent` operation and host consumer; map it to the selected V2 endpoint, schema, location, auth, cancellation, delivery semantics, and event behavior. Do not mechanically rename methods.

Keep `@opencode/client` imports inside `packages/agents/opencode`. The VS Code host continues to use `IAgent`; keep `packages/core` provider-neutral. Replace broad structural casts in `mappers.ts` with explicit conversions and safe handling of unknown variants.

### 4.2 Private launch, authentication, and cleanup

V2 documents foreground `opencode serve` independently of the shared service. Use loopback-only binding, an ephemeral port, explicit workspace cwd, and the same resolved V2 executable and overlay in nono, VS Code compatibility sandbox, and sandbox-off paths.

Bind executable identity, server-reported version, endpoint, credential, readiness, reconnect, and cleanup to the exact child Scribe starts. Never discover or stop an unrelated shared server as a convenience fallback.

For a nono launch, prove that the private server itself and its tool/MCP descendants start within the selected process boundary and can access only the intended approved workspace grants. The CLI's repaired `opencode-local` workdir behavior is a baseline fact, not evidence that a GUI extension-host launch is protected or authorization to switch Scribe's profile. Resolving the stable binary alone does not invoke shell policy, grant workspace access, or supply credential injection. Preserve backend selection and fail closed if its required effective access/injection contract is unavailable; do not add a second nested sandbox to compensate.

The server may print a password along with its listening URL. Verify the selected version's credential contract and authenticated client setup; do not mistake a generic bearer-token example for proof of standalone-server authentication. Keep server credentials in memory, out of URLs, command arguments, persistent settings, webview messages, diagnostics, and tool/MCP child environments. Verify how child-environment isolation is achieved rather than assuming it.

Preserve bounded readiness diagnostics, process-tree shutdown, startup-failure cleanup, and fail-closed backend behavior. No unsandboxed retry or cross-backend downgrade. Recheck exact CLI flags; do not retain unsupported fixture flags such as legacy `--pure` without evidence.

Distinguish the child-server authentication secret from Hindsight daemon credentials. Preserve the approved runtime-injection route for the integration that needs it without forwarding either secret indiscriminately to model tools or MCP children. Missing injection in a GUI launch is a launch/integration blocker, not a reason to copy credentials from profiles/configuration into environment files or persistent settings.

### 4.3 Native overlays and configuration discovery

The current V2 host and its effective user configuration are the primary target, whether individual source documents retain supported legacy syntax or use native/mixed shapes. Convert Scribe's own overlays to native V2, not the user's files:

| Old integration assumption | Native V2 direction |
|---|---|
| `agent`, agent `prompt` | `agents`, agent `system` |
| `permission` maps | Ordered `permissions` rules using `action`, `resource`, `effect` |
| `bash`, `task`, `write`/`patch` actions | `shell`, `subagent`, `edit`; verify resources and precedence |
| `plugin`, package/options tuples | `plugins`, package/options objects |
| `command`, `subtask` | `commands`, `subagent` |
| `skills.paths`/`skills.urls` | `skills` array |
| Flat `mcp`, `enabled`, one timeout | `mcp.servers`, inverse `disabled`, separate catalog/execution timeouts |
| Singular `provider`, separate variant assumptions | `providers` and verified V2 model/variant contracts |

Configuration discovery must account for system/managed authority, global configuration, ancestor files, nested `.opencode` files, file-based definitions, and process-scoped configuration. Do not assume a private process is automatically isolated from inherited config, plugins, credentials, databases, or other state.

Verify permission last-match behavior, agent/session precedence, and higher-authority policies against effective server behavior. V2 permits `external_directory` by default; explicitly qualify protected and out-of-workspace access rather than assuming V1 defaults survive. Sandbox-off must retain the same agent restrictions as sandbox-on.

Treat the V2 config API as a version-specific document/source contract, not the old merged object. Do not use persistent config writes as an overlay mechanism. Supported legacy-shaped config may be covered with hermetic compatibility fixtures if still part of Scribe's support policy; a live V1 installation is not required.

### 4.4 MCP preferences

Replace flat inventory and enabled-only overlays with a verified native V2 mechanism. Test complete transport definitions and/or a supported integration policy against the pinned release before selecting an approach.

Required invariants: Chat preferences only restrict Scribe; user/system denials remain effective; selected servers retain their transport configuration; unknown tools remain denied; unselected local processes do not start where suppression is intended. Do not ship a guessed overlay or log credential-bearing MCP definitions.

### 4.5 Existing V2 plugins and fallback

Inventory the current V2 plugin set instead of assuming that Hindsight, Context Mode, or Codex retry still awaits a port. Record approved identities, exact versions, loading sources, and required/optional status. Plugins are trusted process code, not isolated MCP children. Do not execute plugin code during metadata preflight or modify externally owned plugin sources.

V2 plugin arrays and discovered local plugins require verified removal/disable semantics. An empty legacy `plugin` array is not a plugin-free retry. Preserve the existing narrowly eligible, one-retry behavior where applicable; prove the effective retry plugin list and removal of provider/lifecycle/retention authority. If required enforcement cannot survive retry, fail closed instead.

Qualify Hindsight's actual V2 implementation, tool inventory, endpoint/bank identity, lifecycle, retention, cancellation, and sandbox requirements. Do not hardcode obsolete plugin versions or operation names from historical records. Keep lifecycle capabilities gated and missing integrations nonfatal. Context Mode MCP and native plugin availability remain separate surfaces. Apply the same Scribe-specific review to any installed Codex retry integration.

The Codex quota-retry V2 implementation is **already delivered and globally deployed**, not an outstanding external port. Qualify that artifact without modifying its owner sources: verify module-evaluation installation before OpenCode captures `fetch`, correct root/child native session correlation and cancellation, removal of private correlation tokens before the provider delegate, and unchanged native retry scheduling. Do not identify children from outgoing `x-session-id` alone; the platform evidence found child headers could identify the root. Add no Scribe retry loop. The adapter remains **HTTP-only and process-alive-only**; WebSocket/other transports pass through and transport preferences must not be forced to manufacture coverage.

Separate deployed-file provenance, fresh private-process plugin loading, fixture-composed behavior, and actual Scribe operation as distinct evidence. Global deployment does not prove that a pre-existing shared/interactive process loaded the new files. Verify Scribe's freshly launched child and any necessary location activation/reload only on its owned server; do not restart/reload the shared service or cancel its pending sessions.

Plugin discovery qualification must not rely on a permissive or empty isolated fixture. The platform's first private loader inventory failed with the expected plugin absent; the successful run explicitly selected the intended global config roots while isolating mutable HOME/data/state/goal paths. Test the selected release's actual config/discovery inputs and location activation in a dedicated inherited-plugin lane, asserting expected identity/source/version and effective policy. Do not blindly copy its environment values or treat an empty inventory as compatibility success. Use mocked credential references or authorized runtime injection without dumping config or writing production state.

The installed-runtime fixture-composed PASS and 19/19 provider-free result are upstream evidence, not live-provider or Scribe acceptance. Application-level canary network guards are not OS-level egress isolation; zero intercepted/blocked requests do not prove that no outbound request escaped. Label each evidence boundary accurately and use the authorized sandbox/network controls required by the test.

### 4.6 Sessions, prompts, events, and capability gaps

Map location-scoped session operations and pagination, agent/model selection, prompt admission/completion, queue versus steer, message/context retrieval, attachments, permissions/forms, abort, fork/revert/compaction, and child-session discovery to the actual V2 contract.

V2 event subscriptions are live-only without automatic reconnect or replay. Re-subscribe and refresh authoritative session/message snapshots; guard against duplicate, stale, and cross-session results. Preserve exactly-once initial prompt submission and queued user intent; never add an extension-side prompt loop.

Do not assume direct equivalents for todos, tool IDs, config/path queries, sharing, questions, undo, or summarize. Map each UI dependency to a proven operation or disable its capability and route. Fixed Scout/Write guidance belongs in agent system instructions. Dynamic reasoning-assist briefs need a verified session-scoped mechanism, not silent conversion into user text.

### 4.7 Independent TUI handoff

Extension-host launch and import preflight use the resolved supported V2 executable. Interactive handoff uses shell-resolved literal `opencode`, preserving the user's shell hooks and policy. Both now target V2; remove the old mixed V2-server/V1-terminal scenario.

Verify V2 session export/import and CLI flags against the selected release. Preserve an independent unrestricted TUI rather than connecting it to Scribe's restricted server. Never pass server credentials in URLs, shell history, or arguments. Disable an unsafe attach fallback; independent import must itself prove session isolation and supported serialization. Do not imply that a restricted authenticated server becomes unrestricted through a different client.

### 4.8 Preserve existing Vibefeld/AF and Hindsight workflows

The user reports that the installed V1-era Vibefeld/AF integration worked well with Scribe and nono. Treat that workflow as the preservation baseline, not as a request to build or enable the full set of historically described Vibefeld capabilities. V1-era here describes the predecessor integration; it does not require reinstalling or launching OpenCode V1 against current V2 configuration.

During baseline inventory, trace the installed Scribe artifact/configuration, current source and synced specs, and user-visible workflow to identify what actually runs. Record each surface as **working/enabled**, **conditional/unavailable under stated prerequisites**, or **dormant/fixture-only**. Where the installed behavior, source, and historical specs differ, reconcile the difference before making capability or acceptance decisions; do not infer that every spec heading is an activated feature.

Cover these existing integration surfaces in the method/scenario map:

- **AF activation and execution:** Host-owned executable discovery and compatibility checks, live versus fixture parsing, bounded execution and cancellation, proof/storage containment, cleanup, runtime status, and availability/preferences/workspace opt-out. Preserve the current supported runtime contract; this OpenCode migration is not an AF upgrade or redesign.
- **Reasoning assistance:** Eligible-prompt classification, architect/critic restricted contexts where currently used, bounded briefs reaching the normal answer through a verified V2 mechanism, AF structure recording where enabled, prompt-scoped progress, and safe ordinary-prompt fallback. Preserve model selection, hidden child-session isolation, no retention of restricted contexts, cancellation/stale-result rejection, and existing diagnostic bounds.
- **Other Vibefeld seams:** Explicitly inventory claim projection, adversarial-review, response-gate, and activation/routing seams. Preserve installed enabled behavior and existing conditional/dormant states; do not activate unavailable claim operations, a transactional response gate, new agents, or fixture-only seams to claim broader migration coverage.
- **Hindsight:** Preserve currently working approved operations, package/config resolution, workspace-derived bank and endpoint identity, session partitioning, lifecycle/retention settings, reflection and cancellation behavior, and sandbox/capability gates. Inventory actual V2 plugin contracts rather than freezing old package versions or guessing operation names. Optional-provider absence remains nonfatal, but success of ordinary Chat without Hindsight does not prove preservation of a configured working Hindsight workflow.

Hindsight's current deployment remains plugin-managed daemon mode with runtime-injected LLM/database credentials, the existing loopback API endpoint, and the existing external PostgreSQL mapping. Scribe must not replace that with embedded/provider-owned database storage, persist credentials, or create a parallel daemon/database arrangement. Preserve the approved mapping/injection context without reading secret values; validate daemon reachability, identity, and configured lifecycle outcomes from Scribe's launch independently of the TUI.

**Boundary invariant:** Keep Scribe's private OpenCode server under the selected existing nono/backend boundary. AF remains host-private and executes directly as a bounded child under any enclosing sandbox already present; it must not invoke nested nono, create/select/promote profiles, reuse or broaden the Chat server's grants, or become an OpenCode plugin, MCP tool, or model-controlled execution route. Preserve Hindsight's existing approved nono/provider boundary independently. No profile or user-config rewrite is authorized by this migration.

**Acceptance rule:** Each enabled baseline workflow needs a corresponding V2 regression result, including authorized real-host/nono evidence where required. Missing prerequisites may truthfully yield blocked/unavailable at runtime without breaking ordinary Chat, but they do not turn an unverified preservation requirement into a passed migration gate. Dormant behavior must remain dormant. Disabling previously working behavior is a release blocker unless the user explicitly approves the reduction.

## 5. Phased implementation and gates

### Phase 0 — Establish the current V2 baseline and test isolation

1. Recheck stable-command resolution/version in terminal and the actual VS Code host, repository status, and relevant OpenSpec changes.
2. Inventory relevant native V2 config sources, installed plugins, MCP sources, selected sandbox backend, and state visibility using redacted/path-only metadata. Do not dump configuration or credentials.
3. Define disposable workspace/config/state and mock-provider fixtures. Verify isolation of global discovery, auth stores, plugin directories, database, and service registration before launching tests; do not assume `cwd` alone isolates them.
4. Document current Scribe incompatibilities honestly. A successful V1 smoke is neither required nor an available fallback. Do not run the legacy adapter against the user's production state simply to establish a baseline.
5. Record versions, capability outcomes, and bounded diagnostics only. Live/provider tests require explicit authorization and disposable data/credentials.
6. Capture the Section 4.8 installed-functionality matrix for Vibefeld/AF and Hindsight, including user-reported successful scenarios, enabled versus conditional/dormant surfaces, current AF compatibility and execution facts, and the selected nono/provider boundaries. Use existing evidence plus current V2-safe inventory; do not recreate a V1 runtime or read credential values to establish the baseline.
7. Record the completed-platform facts from Sections 2–3 and define two explicit test lanes: hermetic API/mock-provider tests with isolated discovery, and inherited-plugin tests with verified intended config sources but isolated mutable state. Identify GUI/backend workspace grants and runtime-injection prerequisites before executing integration tests. Do not infer native-only config or plugin compatibility from the host-cutover verdict.

**Gate:** Reproducible V2 test environment and executable selection; no changes to production configuration, shared service, or user data.

### Phase 1 — Pin and map the V2 contract

1. Select a server release, initially evaluate observed `2.0.32`, and select/pin a compatible `@opencode/client` release. Record the supported version policy; do not infer compatibility from a `2.x` prefix alone.
2. Map every `IAgent`/adapter method, capability, and host consumer to the exact API or an explicit unsupported decision, with a focused test for each behavior.
3. Inspect selected-release OpenAPI and package types. Prototype authenticated readiness, location selection, mock prompts, event framing, model/agent selection, and cancellation against a disposable server.

**Gate:** Reviewed method map and passing version-pinned contract spike, including explicit capability gaps.

### Phase 2 — Unify launch, auth, and lifecycle

1. Replace old SDK-created server paths with consistent private V2 spawning for every intended backend. Keep stable `opencode` as default; retain only generic scoped V2 test overrides where needed.
2. Validate executable version before launch and authenticated server version after readiness. Fail actionably on mismatch; never switch binaries or attach to the shared service silently.
3. Implement loopback/ephemeral-port launch, minimum environment, native process overlay, credential protection, bounded redacted readiness, and child-tree cleanup.
4. Test disconnect, reconnect, startup failure, spaces/quotes in paths, and direct nono argv with `shell: false`. Verify no backend downgrade and no credential leakage to tool/MCP children.
5. Verify selected-approved-workspace access, private server/descendant containment, and approved Hindsight injection from the actual extension host. Do not assume CLI wrapper behavior is inherited merely because the executable resolves; keep profile/config changes and shared-service restarts outside scope.

**Gate:** Every intended backend authenticates only to its own compatible server and cleans up the exact process tree without secret leakage.

### Phase 3 — Native overlays and effective policy

1. Convert Scout, exact research worker, Build-backed Write, restricted-review, bundled command, skill, and relevant provider overlays to native V2.
2. Verify exact worker delegation, worker no-recursion/read-only restrictions, Write no-shell/no-delegation, unknown-tool denial, and effective permission/policy precedence. Include native/MCP Context Mode and nested Code Mode checks where available.
3. Replace partial provider/plugin/MCP inventory with version-correct, location-aware discovery; exercise native V2 config and any explicitly retained legacy-fixture compatibility.
4. Implement MCP selection only after transport, precedence, denial, and process-suppression behavior is proven.
5. Qualify inherited V2 plugin loading and the narrowly eligible plugin-free retry, including removal of provider grants and lifecycle environment without weakening required policy.
6. Assert the same agent/provider restrictions in sandbox-on and sandbox-off modes; only OS/process restrictions may differ.
7. Run the dedicated inherited-plugin loader lane against a fresh owned V2 child with verified discovery roots/location activation. Assert expected global plugin identity/source/version, then fallback removal/effective authority. Preserve initial failures as failures; an empty inventory or fixture-injected plugin alone does not prove native discovery/order.

**Gate:** Positive and negative tests prove effective native V2 behavior with no user config writes or sandbox-policy regression.

### Phase 4 — Port core sessions, prompts, and streaming

1. Implement the verified V2 operations and explicit domain mappers. Preserve text, reasoning, tool lifecycle, retries/errors, attachments, snapshots/diffs, and consumed session metadata.
2. Handle request location, pagination, cancellation, stale-result guards, and permission/form identity explicitly.
3. Implement live-only event recovery and authoritative refresh. Preserve initial prompt exactly once, queue order, and correct completion detection; explicitly test a second prompt during an active response.
4. Test malformed/unknown payloads and listener isolation without broad wire-type casts or terminating ordinary streaming unnecessarily.

**Gate:** Mock-provider integration proves ordinary Chat/Write, session continuity, streaming, attachments, abort, reconnect, prompt order, and permission/form behavior.

### Phase 5 — Qualify capabilities and installed integrations

1. Audit every capability and UI consumer. Unsupported methods and routes remain disabled with honest user-facing behavior.
2. Verify provider/model/effort selection reaches actual model requests and honors current V2 provider policy.
3. Port and qualify the existing Vibefeld/AF reasoning-assist workflow from Section 4.8, including V2 session-scoped briefs, restricted-context isolation, AF activation/execution/recording where enabled, progress, cancellation, cleanup, and existing unavailable states. Do not ship the working baseline disabled merely because the V2 instruction mechanism is unresolved; keep the migration gate blocked pending a fix or explicit scope approval.
4. Qualify installed V2 Hindsight and other relevant plugins end to end, not just through plugin-list or diagnostic presence. Verify no-provider fallback, cancellation, lifecycle gates, and explicitly authorized disposable retention tests.
5. Keep optional failures nonfatal; required enforcement failure blocks startup/release. Integrate externally supplied plugins without taking ownership of their port or source.
6. Verify the installed-functionality matrix end to end: enabled workflows retain their outcomes, conditional workflows retain their prerequisite/failure behavior, and dormant claim/adversarial/response-gate/routing seams are not newly activated. Hindsight recall/reflection and configured retention/lifecycle behavior require their own evidence; ordinary Chat fallback alone is insufficient.
7. Qualify the delivered Codex V2 artifact in Scribe for early loading, native session/child correlation, quota retry and cancellation, token stripping, and HTTP/process-lifetime limits. Preserve native retry ownership and user transport choices. Use the upstream reports as scoped provenance, not as a substitute for Scribe's inherited-loader and behavioral evidence.

**Gate:** Every advertised capability and existing enabled Vibefeld/AF/Hindsight baseline workflow has evidence; integration failures neither fabricate success nor broaden access. Existing workflow regressions block release unless explicitly approved as scope reductions.

### Phase 6 — Verify V2 TUI handoff

1. Test extension-host resolved executable versus independent shell-resolved literal `opencode` in the real VS Code launch environment.
2. Verify selected-release export/import and session isolation, including incompatible serialization and actionable failure behavior. Do not assume an old V1 export format works.
3. Disable unsafe restricted-server attach behavior and prove no credentials enter terminal commands/history. No `opencode2` or V1 terminal dependency remains.

**Gate:** Independent unrestricted V2 handoff works without overriding shell policy, sharing the restricted server, or leaking auth.

### Phase 7 — Security qualification and Scribe release

1. Run focused agent, extension-host, webview, launch, and sandbox tests against the pinned pair. Verify Scout/worker/Write negative boundaries under inherited config/plugins, nested sessions, agent switching, reconnect, and fallback.
2. Verify protected/out-of-workspace paths, unapproved MCP/plugin tools, native/MCP Context Mode, Code Mode, bounded redaction, and no unsandboxed retry. Exercise real sandbox gates only from an authorized environment; blocked/skipped gates are not passes.
3. Run `pnpm run test:all`, `pnpm run check`, and `pnpm run build`; build and verify the VSIX using the repository's package verification procedure. Run live tests only with explicit authorization and disposable inputs.
4. Soak the candidate Scribe release against the already deployed V2 platform for an explicitly agreed, Scribe-specific period and scenario set. Record dated outcomes and regressions, not an inherited one-month platform-cutover requirement.
5. Obtain approval to deploy the qualified extension. Verify fresh launches, actual VS Code executable resolution, private-server cleanup, core workflow, optional capability reporting, and independent V2 TUI handoff after installation.
6. Define a V2-compatible recovery path before deployment: use a previously proven V2-compatible Scribe artifact if one exists; otherwise disable/uninstall the incompatible candidate and continue in the independent V2 TUI while fixing Scribe. Do not assume the old V1 adapter is a working rollback or reinstall V1 against native V2 config.
7. Include the installed Vibefeld/AF and configured Hindsight scenarios in the authorized actual-host/nono qualification and Scribe soak. Prove unchanged boundary selection, bounded AF direct execution without nested nono, enabled reasoning-assist behavior, and configured memory lifecycle outcomes. Do not require dormant features to become available, and do not count missing live prerequisites as preservation success.

**Gate:** Scribe acceptance and release approval pass independently of the completed platform migration; a documented V2-only recovery path is available.

### 5.1 OpenSpec change outline

**Proposed change ID:** `migrate-scribe-opencode-v2` (confirm no overlapping active change before creating it). This is an outline only: this plan revision does not create OpenSpec artifacts, approve their requirements, or start implementation.

Use one change with the existing `spec-driven` schema and KISS rules from `openspec/config.yaml`. Keep existing capability ownership rather than introducing a new spec for every migration phase.

```text
openspec/changes/migrate-scribe-opencode-v2/
  proposal.md
  design.md
  tasks.md
  specs/
    opencode-v2-adapter/spec.md       # One new capability for the V2 wire boundary
    <existing-capability>/spec.md    # Only requirements actually changed by V2
```

**`proposal.md` outline:**

- **Why:** Stable `opencode` already runs V2, while Scribe still uses the legacy server/client contract.
- **Scope:** Native V2 HTTP adapter, private foreground `opencode serve`, native process-scoped policy/config integration, compatible independent V2 TUI handoff, and preservation of existing enabled Vibefeld/AF and Hindsight workflows and their nono/host boundaries.
- **Capabilities:** Add `opencode-v2-adapter` for version/auth/location, explicit domain mapping, event recovery, and honest capability reporting. Modify existing capabilities only where their normative behavior or V1-specific contract must change; justify each delta in one line. This migration spans several existing capabilities, so more than three touched capabilities may be necessary, but overlapping new specs are not.
- **Non-goals:** Shared-service adoption, embedded SDK, V1 support, binary installation/link changes, rewriting user configuration, external plugin ports, AF upgrade/redesign, activation of dormant Vibefeld/AF features, new sandbox/profile arrangements, unrelated UI redesign, and automatic deployment/commit/push.
- **Compatibility and recovery:** Preserve the product/security boundaries; record approved feature gaps and the V2-only recovery procedure from Phase 7. Do not claim the current legacy Scribe release is a valid rollback.

**`design.md` outline:** Pin the server/client contract; map each adapter operation and host consumer; describe private launch/auth/cleanup, overlay discovery/precedence, MCP/plugin handling, event and queue recovery, and session transfer. Record the simplest alternative—renaming old SDK calls—and why incompatible V2 wire/lifecycle contracts make it insufficient. Include only decisions needed by this migration, not a generic provider framework.

**Spec ownership and required reconciliation:**

| Capability | Proposed treatment and acceptance scenarios |
|---|---|
| New `opencode-v2-adapter` | Compatible private-server requests succeed; unsupported/mismatched versions fail; location/auth are bound to the launched child; typed mapping and reconnect preserve session identity; unsupported operations are honestly unavailable |
| `nono-companion-launch-backend`, `chat-agent-sandbox` | Amend V1 launch assumptions where needed; verify private `serve`, exact backend/executable, cleanup, protected paths, and no shared-service or unsandboxed fallback |
| `companion-plugin-runtime`, `companion-scoped-scout` | Replace SDK-managed launch assumptions with private V2 launch parity; preserve native plugin loading, exact research-worker permissions, and bounded fallback authority clearing |
| `chat-mcp-settings` | Explicitly resolve the old names/enabled-only overlay requirement versus V2's supported transport/policy mechanism; preserve no-secret exposure, no config writes, intended child-process suppression, and selected-server behavior |
| `session-tui-handoff` | Amend the required attach fallback and serialization assumptions; prove independent V2 transfer or explicit unavailable behavior without connecting the unrestricted TUI to the restricted server |
| `prompt-queue`, `session-navigation`, `reasoning-streaming`, `model-effort-control`, `question-dialog-rendering` | Reuse existing outcome requirements as regression contracts; add deltas only for unavoidable, reviewed behavior changes, not simply because implementation methods change |
| Memory/provider, Hindsight, and retention specs | Preserve the installed working operation/lifecycle matrix and existing capability gates; prove bank/endpoint/partition identity, cancellation, authorized retention, and nonfatal provider absence; amend only V2-affected requirements |
| `vibefeld-af-activation`, `vibefeld-activation`, `vibefeld-runtime-contract`, `vibefeld-runtime-bridge` | Preserve actual installed discovery/compatibility, host-owned bounded direct execution, live/fixture separation, storage, cleanup, and runtime status; reconcile historical contract differences without adding nested nono or changing the supported AF runtime by assumption |
| `vibefeld-restricted-contexts`, `vibefeld-reasoning-assist`, `vibefeld-adversarial-review` | Preserve currently enabled prompt preflight, restricted architect/critic behavior, bounded briefs and AF recording where enabled, hidden-session/no-retention rules, progress, cancellation, and ordinary-prompt fallback |
| `vibefeld-claim-projection`, `vibefeld-response-gate`, remaining Vibefeld review/activation/routing seams | Map each to the installed-functionality matrix; preserve enabled outcomes and existing capability gates, and explicitly assert that dormant/fixture-only paths stay unactivated; add deltas only for actual migration changes |

Ordinary user-config `disabled` preferences and higher-authority policy denials are not interchangeable. In the MCP decision, reconcile the existing requirement that an explicit Chat selection can enable a config-disabled server with the invariant that enforced user/system policy denials cannot be bypassed. Do not silently redefine either behavior.

Each delta must use the project's requirement/scenario format with explicit pass/fail outcomes. Existing requirements remain binding until an approved delta changes them. In particular, disabling an unsupported capability must not be used to evade a mandatory acceptance requirement without review.

**`tasks.md` outline:** Use the stable task groups in Section 5.2. Each implementation task names its requirement/scenario, dependencies, changed production path, focused verification, and evidence expected. Split a group into smaller tasks when needed for independent verification; do not duplicate the same requirement across phase-specific spec files.

**OpenSpec gate:** Review proposal, design, capability decisions, and all required deltas; validate the change with the installed OpenSpec workflow before implementation. No active change directories were found during this outline review; recheck at creation time. Creating/reviewing the change and implementing it are separate authorization steps.

### 5.2 Goal-ready phased execution roadmap

Section 5's Phases 0–7 define the technical work; this roadmap supplies stable work-unit IDs, dependencies, and completion evidence for a future goal. It does not create or start a goal. Do not maintain a second, divergent implementation checklist in this plan: once approved, `tasks.md` owns task details and the goal plan records their execution/evidence.

**Suggested goal objective, for explicit future authorization:**

> Implement and qualify the approved `migrate-scribe-opencode-v2` OpenSpec change using `plans/scribe-v2-migration.md`: migrate Scribe to the pinned native V2 HTTP client and its own private foreground `opencode serve`, preserve agent/sandbox/configuration boundaries, independent V2 TUI handoff, and existing enabled Vibefeld/AF and Hindsight workflows with their approved nono/host boundaries, and produce a verified release candidate with recorded capability limitations and a V2-only recovery procedure. Do not activate dormant features, silently disable working integrations, modify the shared service or user configuration, deploy, commit, or push. Keep explicitly required live/soak/host gates blocked until authorized and evidenced.

The objective assumes approved OpenSpec artifacts. If they do not yet exist, first request a separate specification-preparation stage; approval of this outline alone is not approval of implementation.

| Work unit | Dependencies | Deliverable / bounded implementation scope | Evidence required before advancing |
|---|---|---|---|
| S.1 — Prepare OpenSpec | Explicit authorization to author the change | Proposal/design, minimal spec deltas, contract questions, and dependency-ordered tasks from Section 5.1 | Artifact validation; all tasks trace to requirements; no unresolved mandatory behavior hidden behind capability disabling |
| S.2 — Review gate | S.1 | Obtain approval for the implementation scope and required versus optional capabilities | Explicit approval recorded; otherwise stop before production-code edits |
| 0.1 — Baseline and isolation | S.2 | Completion-record context, Section 4.8 matrix, and separate hermetic API versus inherited-plugin test lanes | Source-format/discovery inventory, enabled/conditional/dormant scenarios, selected workspace/injection metadata, and isolated mutable state/service registration |
| 1.1 — Contract and capability map | 0.1 | Exact server/client pairing, all `IAgent`/host methods mapped, approved unavailable features, pinned contract fixtures | Reviewed method/scenario map and focused contract tests; approval for any change to mandatory outcomes |
| 1.2 — Disposable API spike | 1.1 | Minimal private-server probe of auth, location, events, prompt admission/completion, agent/model choice, and abort | Mock-provider results plus child cleanup and state-isolation evidence; no production server/provider use |
| 2.1 — Private launch and auth | 1.2 | Unified V2 `serve` launch, selected workspace grants, approved runtime injection, and authenticated client setup across intended backends | Exact binary/child endpoint/version, server/descendant nono containment, GUI launch injection/access checks, redaction/loopback, and no shared-service discovery/start/stop |
| 2.2 — Lifecycle and failure paths | 2.1 | Readiness, disconnect/reconnect, process-tree cleanup, credential isolation, and fail-closed launch behavior | Startup/auth/exit failure tests, path quoting/direct argv tests, descendant cleanup, and no backend downgrade |
| 3.1 — Native agents and policy | 2.2 | Native overlays and version-correct configuration inventory | Effective Scout/worker/Write/restricted-review denials and allowed-operation tests under inherited precedence in both sandbox modes |
| 3.2 — MCP and plugin boundaries | 3.1 | Approved MCP selection, fresh native inherited-plugin discovery/activation, and eligible one-time fallback | Expected identity/source/version rather than empty inventory, local-child suppression, preserved transports/denials, effective fallback plugin list, and cleared provider authority |
| 4.1 — Session/message adapter | 3.2 | Verified session operations, explicit domain mappers, attachments, location/pagination, agent/model selection, and forms | Focused adapter and host tests, malformed payload handling, identity/cancellation checks, and mandatory operation outcomes |
| 4.2 — Streaming, queues, recovery | 4.1 | Event translation, completion detection, authoritative reconnect refresh, and exactly-once/FIFO behavior | Mock-provider streaming, busy second-prompt, duplicate/foreign idle, abort, reconnect, and stale-session regression tests |
| 5.1 — Capability and integration qualification | 4.2 | Phase 5 operations/model effort, existing Vibefeld/AF/Hindsight workflows, and delivered Codex V2 integration | Baseline preservation; daemon/injection/endpoint identity; early-loader/native retry/child cancellation/token privacy evidence with honest HTTP/process-lifetime scope; no silent reductions |
| 6.1 — Independent V2 TUI handoff | 5.1 | Verified export/import and shell-resolved literal `opencode`; remove unsafe restricted-server attach behavior per approved delta | Adapter/host command tests, supported serialization, independent session behavior, actual shell-policy resolution, and no auth in terminal args/history |
| 7.1 — Release-candidate qualification | 6.1 | Full regression/security checks, build, verified VSIX, limitations, and V2-only recovery documentation | Focused and full suites/check/build/package outcomes; real authorized host/sandbox checks; no unresolved mandatory security failures |
| 7.2 — Required external evidence | 7.1 plus explicit permissions/inputs | Agreed disposable live tests and Scribe-specific soak/actual-host/nono matrix, explicitly including installed Vibefeld/AF and Hindsight workflows | Dated preservation/boundary/lifecycle results and required duration; blocked/skipped/unsupported distinguished from pass; requalify affected paths after fixes |
| 7.3 — Completion audit | 7.2 | Audit approved requirements, task evidence, Section 6 acceptance, and release-candidate/recovery outputs | Every required goal criterion proved; no unfinished mandatory task or concealed blocker; deployment remains a separate user action |

The order is deliberately conservative for a single execution lane. Preparing contract fixtures does not authorize running prompts before native policy gates pass. The API spike uses only disposable mock-provider inputs; do not expose an intermediate permissive adapter to normal users.

**Goal checkpoints and continuation rules:**

1. When a goal is explicitly requested, read its current state and persist the overall objective, required criteria, phases, dependencies, and task IDs before implementation. Do not infer authorization to start a goal from this plan edit.
2. Follow the approved OpenSpec execution workflow. Each work unit may be split into one-task implementation slices; a work-unit row is not permission for an unchecked batch. Independently verify the real production path and relevant negative tests before marking tasks or phases complete.
3. At every checkpoint record task/requirement IDs, changed files, exact verification commands and outcomes, pinned server/client/fixture versions, bounded evidence locations, remaining blockers, and the next eligible task. Never include secrets or raw payloads.
4. Continue only an active goal and only after predecessor gates pass. Preserve completed evidence; reopen a completed task only with concrete regression evidence. A failed required gate blocks dependent work, not unrelated verified history.
5. Missing provider credentials, GUI access, authorized sandbox execution, review decisions, or soak time are blockers—not test passes. Ask for the needed authorization/input rather than changing policy, test expectations, or scope to obtain green results.
6. Resolve Section 8 decisions when their phase needs them: pairing/isolation before launch; MCP/policy before overlay work; capability/instruction contracts before optional implementation; plugin guarantees before qualification; soak/recovery before the release audit. Material scope changes require OpenSpec/goal-plan review, not silent deferral.
7. Finish the goal only after auditing evidence against its full objective and approved requirements. Building a VSIX alone does not satisfy live/host/soak criteria. Keep deployment approval, installation, commits/pushes, and OpenSpec archive/sync outside autonomous scope unless separately authorized.

## 6. Acceptance criteria

- Official V2 client and supported executable/server pairing are verified; unsupported versions fail clearly.
- Stable `opencode` V2 works in terminal and the actual extension host, with no `opencode2`, V1 coexistence, or command-link cutover dependency.
- The server is Scribe-owned, private, loopback-only, authenticated, and cleaned up; no shared-service lifecycle is changed.
- Native V2 user configuration and custom plugins remain unchanged; discovery, overlays, and effective higher-authority restrictions are proven.
- Supported user-config source formats are preserved as found; the completion record is not treated as evidence of native-only conversion. Hermetic API tests and native inherited-plugin discovery/behavior tests have distinct, accurately labelled results.
- Actual extension-host launches prove selected-workspace access and server/descendant containment under the selected nono/backend boundary; no CLI-wrapper protection, profile switching, or runtime-injection inheritance is merely assumed.
- Scout, research-worker, Write, and restricted-review restrictions hold across every intended backend, session transition, nested execution path, and fallback.
- MCP preferences and plugin removal/authority clearing pass effective behavior tests, including intended local-process suppression.
- Sessions, prompts, queues, forms, attachments, and event recovery work without duplication, stale cross-session data, or leaked credentials.
- Optional capabilities/integrations are independently qualified or visibly unavailable; ordinary Chat/Write remains usable without optional memory.
- Existing enabled Vibefeld/AF and configured Hindsight workflows have explicit V2 preservation evidence against the installed-functionality matrix. Ordinary Chat fallback does not substitute for integration acceptance, and previously working behavior is not silently reclassified as optional or dropped.
- Hindsight retains its plugin-managed daemon deployment, approved runtime credential injection, loopback endpoint, external PostgreSQL mapping, bank/partition identity, and configured lifecycle outcomes without credential persistence or a replacement daemon/database arrangement.
- The delivered Codex V2 integration is qualified in Scribe's fresh child for early loading, native retry/session correlation/cancellation, and token stripping within its HTTP-only/process-lifetime scope. No forced transport, duplicate Scribe retry loop, or shared-service reload is introduced; fixture/network-guard evidence is not overstated as live-provider or OS isolation proof.
- AF discovery/compatibility, host-owned bounded direct execution, reasoning-assist/restricted-context behavior, runtime status, storage, cancellation/cleanup, and currently enabled recording paths retain their approved outcomes. The selected OpenCode/nono boundary is unchanged; no nested AF nono invocation or profile mutation is introduced, and dormant capabilities remain dormant.
- Independent shell-resolved V2 TUI handoff preserves session and policy separation.
- Focused/security tests, full suites, check, build, package verification, authorized live gates, and the agreed Scribe soak have recorded outcomes. Blocked gates remain incomplete.
- Deployment approval and V2-compatible recovery are explicit; no platform downgrade is required.

## 7. Risks and stop conditions

| Risk | Required response |
|---|---|
| Executable/client/server mismatch | Fail boundedly; qualify a supported pair rather than selecting another service or legacy host |
| Native config discovery or precedence differs from assumptions | Stop overlay work and reverify selected-release behavior; do not patch user config |
| Password or credential leaks into output, args, URLs, history, logs, or child environment | Stop testing, contain the leak, and rotate exposed disposable credentials as appropriate |
| Effective permissions or protected-path behavior weaken | Block release; no prompt-only mitigation, sandbox bypass, or backend downgrade |
| Plugin-free retry retains provider authority or removes required enforcement | Reject retry and fix or disable it; never claim plugin-free operation from empty config alone |
| Installed V2 plugin works in TUI but not Scribe | Qualify within Scribe; disable optional integration or coordinate with owner without broad grants |
| Previously working Vibefeld/AF or configured Hindsight workflow regresses on V2 | Block release; fix within existing boundaries or obtain explicit scope-reduction approval and amend OpenSpec/goal criteria; ordinary Chat fallback is not preservation proof |
| API/serialization capability has no verified V2 equivalent | Disable and document it; do not fabricate parity or silently lose session data |
| Tests affect production config, shared service, auth, database, or sessions | Stop; restore only authorized scoped changes from verified backups and investigate |
| Candidate Scribe fails after deployment | Use proven V2-compatible extension recovery or disable Scribe and use V2 TUI; never assume V1 restoration is safe |

## 8. Open decisions before implementation

1. Which exact server/client pair and supported-version policy will ship? Is observed `2.0.32` the first target?
2. Which disposable config/state/provider arrangement reliably isolates Scribe integration tests from the current V2 installation?
3. Which verified native mechanism implements per-server MCP preferences, higher-authority denials, and local-process suppression?
4. Which API gaps are first-release requirements versus disabled capabilities, including forms, todos, sharing, undo/compaction, config/path inventory, and session transfer?
5. Is independent export/import sufficient for handoff, and what verified serialization and CLI contract will it use?
6. Which V2 session-scoped mechanism supports required dynamic reasoning-assist briefs without treating them as user text?
7. Which currently installed plugin versions and lifecycle guarantees are approved for Scribe, and which integrations are optional?
8. What Scribe-specific soak scenarios/duration, deployment approval, and V2-compatible recovery artifact or disable procedure are required?
9. Which exact installed Vibefeld/AF and Hindsight behaviors comprise the working baseline, and where do installed artifacts/current source/historical specs differ? Resolve the enabled/conditional/dormant matrix and preservation scenarios before implementation changes their behavior; this is inventory of existing functionality, not authorization for additional AF features.
10. Which approved launch contract supplies Scribe's GUI/private child with the selected workspace grants and Hindsight runtime-injection context, and which verified discovery/location inputs distinguish the inherited-plugin lane from hermetic tests? Resolve without changing profiles, reading secrets, or restarting the shared service.

## 9. References

- Repository `AGENTS.md`, `docs/architecture.md`, and `SECURITY.md` — product boundaries, package ownership, validation, and security invariants.
- Relevant active `openspec/changes/` and `openspec/specs/` — authoritative capability requirements; review before implementation.
- `/Users/zeug/Projects/Sandbox/plans/v2-migration.md` — current 2026-10-19 completion record; original planning sections are historical, not outstanding cutover gates.
- `/Users/zeug/Projects/Sandbox/openspec/changes/codex-subscription-native-retry-adapter/reports/v2-verification.md` — scoped provider-free/fixture-composed V2 evidence and preserved failures; not independently rerun here.
- `/Users/zeug/Projects/Sandbox/openspec/changes/codex-subscription-native-retry-adapter/reports/v2-deployment.md` — deployed provenance, fresh private global-loader evidence, discovery correction, and shared-process reload boundary.
- `/Users/zeug/Projects/Sandbox/packages/opencode-codex-quota-retry/README.md` and `/Users/zeug/Projects/Sandbox/sandbox.md` — integration ownership/transport and launcher/injection context; use dated current sections and verify against Scribe, not superseded backend/handoff proposals.
- [V1-to-V2 migration guide](https://opencode.ai/v2/docs/migrate-v1)
- [V2 configuration](https://opencode.ai/v2/docs/config), [permissions](https://opencode.ai/v2/docs/permissions), and [policies](https://opencode.ai/v2/docs/policies)
- [V2 JavaScript client](https://opencode.ai/v2/docs/build/client) and [API reference](https://opencode.ai/v2/docs/api)
- [V2 plugins](https://opencode.ai/v2/docs/build/plugins) and [plugin migration](https://opencode.ai/v2/docs/build/plugins/migrate-v1)
- [V2 CLI](https://opencode.ai/v2/docs/cli) and [foreground server](https://opencode.ai/v2/docs/cli/web)
- Selected-release OpenAPI and client package types — capture exact versioned references in Phase 1 rather than treating the old `2.0.29` contract as current.
