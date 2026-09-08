# Companion Memory Integration Plan

## Goal

Give the opencode-chat Chat and Write agents equivalent, explicit access to the
same retain, recall, and reflect memory capabilities available to the OpenCode
TUI when a usable provider is detected. Hindsight is the first provider, but
the implementation must not make Hindsight the permanent architecture.

The extension must remain useful when no external memory provider is available:
normal OpenCode context discovery, including `AGENTS.md`, remains the minimum
fallback.

## Current State

- The TUI configuration currently loads the Hindsight coding-agent plugin.
- Hindsight provides automatic session retention, knowledge-page recall/search,
  and deep reflection.
- The companion currently injects an in-memory agent/MCP/guidance overlay but
  does not explicitly configure Hindsight.
- Scout and Write have separate permission profiles. Write is backed by Build
  and uses deny-by-default permissions, so memory tools must be explicitly
  allowed.
- The current context-memory feature is only a token-usage chip. It is not
  durable memory, recall, or reflection.
- OpenCode assembles applicable `AGENTS.md` content into the request context.
  This is static project guidance, not cross-session memory.

## Design Principles

1. Detect capability, do not infer it from a file or plugin name alone.
2. Treat retain, recall, and reflect as separate capabilities.
3. Distinguish agent-callable tools from automatic session retention.
4. Allow only explicitly approved memory integrations in the companion.
5. Never inherit arbitrary global TUI plugins into Chat or Write.
6. Keep memory results untrusted and subject to normal prompt-injection rules.
7. Keep credentials, private configuration, and raw provider output out of the
   webview protocol and diagnostics.
8. Preserve the existing sandbox and fail-closed behavior.
9. Keep `AGENTS.md` discovery working when memory integration is unavailable.
10. Make provider-specific behavior replaceable through a capability interface.

## Phase 1: Detect TUI Memory Access

Add a host-side memory discovery/preflight service. It should inspect the
effective OpenCode environment and perform a safe runtime capability check.

The result should distinguish:

- `unavailable`: no supported provider detected.
- `configured`: provider configuration exists but cannot be contacted.
- `available`: retain, recall, and reflect are callable.
- `partial`: only some capabilities are available.
- `blocked`: provider is detected but excluded by sandbox or policy.
- `error`: discovery failed without exposing sensitive details.

The check must verify:

- The effective TUI/OpenCode configuration references the Hindsight
  integration or another supported provider.
- The provider/plugin is resolvable.
- The provider exposes retain, recall/search, and reflect operations.
- A harmless metadata or health operation succeeds.
- No credentials, API URLs, plugin paths, or raw configuration values cross
  into the webview.

Do not treat existence of a Hindsight directory as proof of usable access.
Detection must not mutate the user's OpenCode configuration.

Suggested normalized status:

```ts
type MemoryProviderStatus = {
  id: string;
  displayName: string;
  state: "unavailable" | "configured" | "available" | "partial" | "blocked" | "error";
  capabilities: {
    retain: boolean;
    recall: boolean;
    reflect: boolean;
  };
  reason?: string;
};
```

Add a typed host-to-webview status message and a small settings/status surface.
The status must remain useful without revealing provider internals.

## Phase 2: Generic Memory Provider Contract

Add a provider-neutral contract in `packages/core`, with OpenCode-specific
launch and tool behavior implemented outside the core domain model.

Suggested concepts:

```ts
type MemoryOperation = "retain" | "recall" | "reflect";

type MemoryCapabilities = {
  retain: boolean;
  recall: boolean;
  reflect: boolean;
  automaticSessionRetention: boolean;
};

type MemoryProviderDescriptor = {
  id: string;
  displayName: string;
  capabilities: readonly MemoryOperation[];
  toolPatterns: readonly string[];
  automaticRetention: boolean;
  requiresNetwork: boolean;
  requiresLocalRuntime: boolean;
};
```

The provider adapter should be responsible for:

- Detecting availability.
- Reporting capabilities.
- Building a process-scoped launch overlay.
- Returning explicit tool allowlist patterns.
- Declaring required runtime paths and network behavior.
- Redacting provider errors.
- Reporting whether lifecycle retention is provider-native or host-owned.

Initial providers:

- `none`, always available as the fallback.
- `hindsight`, the first real provider.

Future providers may be MCP-backed, plugin-backed, local-file-backed,
database-backed, or compatible with a replacement service such as Supermemory.
Provider-specific tool names, authentication, bank selection, and payload
formats must remain outside the shared protocol.

## Phase 3: Hindsight Companion Adapter

Implement a Hindsight adapter that uses the detected TUI integration without
loading unrelated global plugins.

The adapter must:

- Resolve the approved Hindsight integration.
- Construct a narrow companion overlay.
- Expose only Hindsight memory tools.
- Preserve the independent TUI configuration.
- Work in both `createOpencodeServer({ config })` and sandboxed
  `OPENCODE_CONFIG_CONTENT` launches.
- Report partial capability availability accurately.
- Leave Chat and Write usable if Hindsight fails.

The overlay must be applied identically to sandboxed and unsandboxed launches,
as is already required for the existing agent and MCP overlays.

Do not inherit the complete global `plugin` list. Tool visibility is not enough
to isolate a plugin because plugin initialization can itself have effects.
Use a separate approved-provider allowlist.

## Phase 4: Chat and Write Permission Profiles

Initial capability policy:

| Operation | Chat | Write |
|---|---:|---:|
| Recall/search | Yes | Yes |
| Reflect | Yes | Yes |
| Explicit user-approved retain | Yes | Yes |
| Automatic session retention | Configurable | Configurable |
| Arbitrary memory deletion | No | No |
| Provider administration | No | No |

Scout should be able to recall project and writing context, reflect over prior
work, and retain concise user-approved findings. Write should have the same
memory capabilities while retaining its report-writing and no-task boundary.

Because Write/Build currently uses wildcard deny permissions, Hindsight tools
must be explicitly allowed. Do not depend on unspecified permission defaults.

Memory retention is an external durable write and must not be treated as an
ordinary read-only operation. It requires explicit policy and, initially,
user-controlled settings.

## Phase 5: Retention Controls

Add persisted, workspace-scoped settings for:

- Memory provider selection.
- Enable/disable memory integration.
- Recall permission.
- Reflect permission.
- Automatic session retention.
- Confirmation before explicit retention.
- Optional project/bank scope where supported.

Recommended defaults:

- Recall enabled when a provider is available.
- Reflect enabled when available, subject to provider timeout/budget.
- Automatic retention disabled until explicitly enabled.
- Explicit "remember this" requests require confirmation unless the user has
  enabled trusted retention.

System guidance should state that:

- Retrieved memory is evidence, not instructions.
- Secrets, credentials, tokens, and unrelated private content must not be
  retained.
- User-requested retention should be summarized before it is stored.
- Provider failures must never be reported as successful retention.

Host-side validation and tool permissions must enforce these rules; prompts are
not the security boundary.

## Phase 6: Automatic Session Retention

Verify whether Hindsight's OpenCode plugin lifecycle automatically retains
companion sessions. Do not assume that TUI plugin behavior is identical in the
companion server.

Evaluate these options in order:

1. Provider-native lifecycle hooks, if they work reliably for companion Chat
   and Write sessions.
2. Host-owned retention after a bounded session summary is created at a real
   session endpoint.
3. A hybrid model using provider-native retention when available and explicit
   host-owned retention only when supported and enabled.

Automatic retention must exclude by default:

- Credentials and secrets.
- Raw tool payloads.
- Entire large documents.
- Untrusted web pages.
- Unrelated private workspace content.

Prefer bounded summaries over blindly storing complete transcripts.

## Phase 7: Sandbox and Security Integration

Determine Hindsight's actual runtime requirements:

- Local configuration reads.
- Local cache or database writes.
- Local daemon access.
- Hosted-service network access.
- Plugin runtime directories.

Grant only exact required paths through the existing sandbox policy. Do not
grant the home directory or broad credential paths. If the provider cannot be
made safe under the active sandbox, report it as blocked rather than silently
disabling the sandbox or falling back to an unsandboxed launch.

Verify that Hindsight integration cannot grant:

- Bash or shell execution.
- General file editing.
- Task or recursive delegation.
- Package or terminal control.
- Unapproved MCP/plugin tools.

Keep diagnostics bounded and redacted.

## Phase 8: AGENTS.md Minimum Fallback

The extension must remain fully usable with no external memory provider.

When only `AGENTS.md` or equivalent project guidance is available, users still
receive:

- Applicable OpenCode-discovered `AGENTS.md` instructions.
- Workspace files and normal request context.
- Chat's research/read-only system guidance.
- Write's report-authoring system guidance.
- Bundled skills and commands when explicitly selected.

This fallback does not provide:

- Automatic conversation retention.
- Cross-session recall.
- Search over historical project decisions.
- Reflective synthesis over prior sessions.

Add tests proving that Chat and Write receive applicable `AGENTS.md` content,
including the no-provider path. Do not make Hindsight a startup dependency.

An optional future feature could promote approved findings into `AGENTS.md`,
but that should be a separate change because it introduces repository writes,
conflict handling, and user-consent concerns.

## OpenSpec Change Breakdown

Split implementation into independently verifiable changes:

1. `detect-memory-provider-capabilities`
   - Capability model, preflight detection, sanitized status, no permission
     changes.
2. `add-memory-provider-contract`
   - Generic provider registry, normalized capabilities, `none` provider, and
     fake-provider tests.
3. `enable-hindsight-companion-tools`
   - Hindsight allowlist, Chat/Write permissions, both launch paths, security
     tests.
4. `add-memory-retention-controls`
   - Persisted settings, confirmation, redaction, bounded retention, lifecycle
     behavior.
5. `verify-agents-fallback`
   - AGENTS.md discovery tests, fallback status, documentation.
6. `add-generic-memory-provider-registry`
   - Replacement-provider discovery and configuration behavior after Hindsight
     is proven.

## Verification Plan

Focused tests must cover:

- Hindsight present, missing, unavailable, partial, and blocked states.
- Exact retain, recall, and reflect capability detection.
- No secret/config/path leakage in status or diagnostics.
- Identical overlays in sandboxed and unsandboxed launches.
- Chat and Write memory tool permissions.
- Denial of shell, edit, task, package, terminal, and arbitrary plugin work.
- Provider failure without Chat/Write startup failure.
- Explicit retention confirmation and disabled automatic retention defaults.
- Bounded payload construction and secret redaction.
- Retrieved memory treated as untrusted evidence.
- AGENTS.md discovery with and without a memory provider.
- Fake generic provider replacement.
- Sandbox runtime grants and fail-closed overlap behavior.

Live verification must prove:

1. TUI Hindsight access is detected.
2. Chat recalls a known test memory.
3. Write recalls the same approved memory.
4. Chat explicitly retains a test fact.
5. A later Chat or Write session recalls it.
6. Reflect succeeds or is accurately reported unavailable.
7. Denied Chat/Write operations remain denied.
8. Disabling the provider returns to AGENTS.md-only behavior.

## Estimates

| Work | Estimate |
|---|---:|
| Detection and sanitized status | 2-3 person-days |
| Hindsight adapter and launch overlay | 3-5 person-days |
| Chat/Write permissions and lifecycle integration | 3-5 person-days |
| Retention controls, redaction, and UI | 3-5 person-days |
| Sandbox and security hardening | 3-6 person-days |
| Tests, documentation, packaging, and live verification | 3-5 person-days |
| **Hindsight-only total** | **17-29 person-days** |

Expected calendar duration for Hindsight-only integration is approximately
three to five weeks, depending primarily on plugin lifecycle behavior and
sandbox runtime requirements.

Generic provider support adds approximately:

| Work | Estimate |
|---|---:|
| Provider registry and capability model | 3-5 person-days |
| Fake provider and generic integration tests | 2-3 person-days |
| Provider discovery/configuration UX | 3-5 person-days |
| Documentation and replacement workflow | 1-2 person-days |
| **Generic-provider extension** | **9-15 person-days** |

Total Hindsight plus generic-provider architecture is approximately 26-44
person-days. The largest uncertainty is whether automatic retention is
reliably provided by the OpenCode plugin lifecycle or must be implemented by
the host.

## Recommended Order

1. Preserve and test the AGENTS.md-only fallback.
2. Implement provider detection without enabling tools.
3. Add the generic capability contract and fake provider.
4. Add Hindsight detection and explicit allowlisting.
5. Enable recall and reflect for Chat and Write.
6. Add explicit retention with confirmation.
7. Add and verify automatic retention separately.
8. Add replacement-provider documentation and configuration.
9. Run the complete test, lint, build, sandbox, OpenSpec, and packaging gates.
