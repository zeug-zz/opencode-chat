# OpenCode Chat Server Hardening Plan

Status: Proposed implementation plan

## Decision Summary

The Chat companion should be secure by default without adding configuration work
for ordinary users:

- Generate an ephemeral per-companion server password automatically.
- Inject the password into the companion process environment and the SDK client.
- Keep the server bound explicitly to `127.0.0.1` with an OS-assigned port.
- Make Chat sandboxing default to `on` on supported platforms.
- Keep `allowNetwork` defaulting to `true` so providers and configured remote or
  local MCPs continue to work.
- Keep Scout as read-only research and keep Write as a report-authoring profile;
  neither profile should become a general coding or shell agent.
- Preserve the existing MCP inventory and preference model. Do not add a new
  per-MCP security questionnaire or path allowlist.
- Never silently fall back from a failed sandbox or failed authentication check.
- Offer an explicit, clearly labelled `Run without sandbox` recovery action only
  when the sandbox cannot start. Authentication remains required in that mode.

The normal install and first Chat request should require no new user input. A
user should only make a security decision when the secure startup path is
unavailable.

## Additional Review Recommendations

These additions improve the security and usability balance without introducing
per-MCP questionnaires, broad coding permissions, or recurring setup work for
ordinary users. They should be included in implementation review and in the
OpenSpec change before release.

### 1. Make Scout structurally deny-by-default

The Scout permission map should include an explicit `"*": "deny"` catch-all,
followed by the small set of allowed capabilities:

- `read`, `glob`, `grep`, and `list`.
- `webfetch`, `websearch`, and `question`.
- Agent-scoped MCP tools classified as read-only research tools.

This is stronger than enumerating current denials because newly introduced
OpenCode tools cannot silently widen Scout's capability surface. Add a regression
test that an unknown built-in or MCP tool remains denied.

### 2. Add prompt-injection guardrails

`CHAT_SYSTEM.md` and `WRITE_SYSTEM.md` should explicitly state that workspace
files, MCP output, web pages, retrieved documents, and other tool results are
untrusted data. Embedded instructions in those sources must not:

- Override the selected agent profile or permission boundary.
- Request secrets, credentials, or unrelated file contents.
- Enable denied tools or cause a shell, task, plugin, or MCP escalation.
- Change the server, sandbox, authentication, or network policy.

Repository policy files and skills remain deliberate instruction sources, but
they must not grant capabilities that the injected agent profile denies. Suspected
prompt injection should be surfaced as a concise user-visible warning rather
than followed.

### 3. Make the capability model visible and enforceable

The product security model should remain a simple capability lattice:

| Profile | Allowed | Denied |
| --- | --- | --- |
| Scout | Read, search, web, research MCPs | Edit, Bash, task, unknown MCPs |
| Write | Research, report editing, approved report tools | Bash, task, packages, coding loop |
| TUI | Full coding and advanced tools | Explicit user handoff required |

The extension must enforce this model through both OpenCode permission rules and
agent-scoped tool/plugin rules. Prompts explain the model but are not its sole
control. Tests should prove that changing the prompt text cannot enable denied
capabilities.

### 4. Add a persistent protection status indicator

Show a compact status indicator in the Chat surface without requiring users to
open the Gear panel. It should expose:

- Authentication state: `Protected` or an actionable failure state.
- Sandbox state: `Sandboxed`, `Reduced protection`, or unavailable.
- Network state: enabled or disabled.
- Current profile: `Chat`/Scout or `Write`/Build.
- The number of enabled MCP servers, without exposing credentials.

The indicator should be passive during healthy operation and become visually
prominent when protection is degraded. Clicking it can open the detailed status
panel. No normal startup dialog is needed.

### 5. Enforce a minimum version and detect security drift

The extension should resolve the OpenCode executable, read its version using a
non-mutating command, and perform the authenticated readiness probe before
marking Chat ready.

- A server that does not enforce `OPENCODE_SERVER_PASSWORD` is rejected.
- A known affected or below-minimum version is blocked or clearly rejected.
- A below-floor but otherwise authenticated version may show a persistent update
  warning if the documented threat model permits continued use.
- The status and bounded diagnostics should include the OpenCode version and
  bundled SDK version, but never credentials.

Authentication failure must remain a hard stop. The extension must not use the
unsandboxed recovery action to bypass it.

### 6. Use export/import handoff only after authentication

The authenticated Chat password must remain entirely inside the Chat companion
boundary. The existing independent export/import handoff should be the only
supported Chat-to-TUI transition:

- Export the session through the companion client.
- Run independent `opencode import` and `opencode --continue` in the terminal.
- Keep the TUI process independent from the Chat server and its credential.
- Remove or redirect any `opencode attach <serverUrl>` fallback that would need
  the Chat password.

The TUI remains the explicit advanced-user path for shell work, broad code
changes, package operations, and unrestricted plugin/MCP use. The Chat extension
must not pass the password through terminal arguments, environment, URLs, or
handoff state.

### 7. Require confirmation for high-impact sharing and permission actions

Security prompts should appear only for genuinely consequential actions:

- Confirm session sharing with text explaining that the conversation may contain
  workspace excerpts, pasted credentials, or other sensitive content.
- Make one-time permission approval more prominent than persistent `Always`
  approval for Chat tool requests.
- Add a visible `Reset Chat permissions` action where the OpenCode permission API
  supports it. If persistent grants are stored by the server and cannot be
  reset programmatically, document that limitation in the Gear panel.

These controls add a click only to high-impact actions and do not interrupt
ordinary research or report drafting.

### 8. Harden secondary data and diagnostic paths

The main server boundary is not enough if sensitive content leaks through editor
state or diagnostics:

- Keep diff contents out of virtual-document URI query strings. Store content in
  an in-memory map keyed by a random identifier and put only that identifier in
  the URI.
- Apply the existing diagnostic redaction to all error notifications, MCP
  lifecycle output, copyable diagnostics, and authentication failures.
- Provide an on-demand `Copy diagnostics` action containing bounded, redacted
  status, version, sandbox, MCP, and connection information.
- Do not add telemetry or crash reporting that captures conversations, prompts,
  tool output, credentials, or workspace content.

These changes require no normal user setup and reduce accidental disclosure
without expanding agent permissions.

## Security Qualification

This plan assumes the relevant `opencode serve` risk is an unauthenticated
localhost HTTP control plane that allows a local process or web page to drive
server capabilities. Authentication directly addresses that attack path.

Authentication does not repair a command-injection defect that is reachable by
the legitimate authenticated client. If the upstream vulnerability is in
request parsing, command construction, MCP execution, or another trusted-server
path, the effective fix remains an upstream patch, a maintained fork, or a
minimum-version block. This plan does not include an OpenCode v2 migration.

The extension must not claim that this change makes OpenCode safe in general or
transfers all security responsibility to users. The intended claim is narrower:
the extension meaningfully reduces unauthenticated local API abuse and limits
the blast radius of a compromised companion process.

## Validated Prerequisites

The following work is complete, validated, archived, and is the baseline for
this plan. The hardening change must extend these capabilities rather than
recreate their prompts, profile identifiers, sandbox lifecycle, or MCP behavior:

- `openspec/changes/archive/2026-08-24-add-chat-agent-sandbox/` establishes the
  Chat-specific sandbox settings, process-tree boundary, network policy, and
  fail-closed startup behavior.
- `openspec/changes/archive/2026-08-24-chat-sandbox-compatibility-layer/`
  establishes the compatibility filesystem policy, runtime/cache coverage,
  local/remote MCP behavior, and complete companion teardown requirements.
- `openspec/changes/archive/2026-08-24-chat-mcp-startup-persistence/`
  establishes persisted Chat MCP preferences and companion-only startup
  filtering.
- `openspec/changes/archive/2026-08-24-add-report-writing-mode/` establishes
  the user-facing `write` profile backed by internal OpenCode `build`, the
  packaged `WRITE_SYSTEM.md` prompt, read/search/web/edit permissions, denied
  Bash and task/subagent execution, removal of Chat shell mode, and independent
  TUI handoff.
- The synchronized main specifications are authoritative in
  `openspec/specs/chat-agent-sandbox/`,
  `openspec/specs/chat-mcp-settings/`, and
  `openspec/specs/primary-agent-selection/`. The report-writing capability is
  represented by the archived delta and its synchronized primary-agent
  requirements.

The completed sandbox currently preserves the validated `inherit` behavior and
the compatibility network default. Changing the effective Chat default to
secure sandboxing, adding server authentication, adding agent-scoped MCP/plugin
gating, and removing any authenticated-server attach fallback remain future
hardening work in this plan. They must not be described as already delivered by
the archived changes.

## Current Baseline

The validated implementation establishes these boundaries:

- The unsandboxed path uses the SDK `createOpencodeServer()` helper with port
  `0`, then creates an SDK client with only `baseUrl`.
- The sandboxed path launches `opencode serve --hostname 127.0.0.1 --port 0`,
  applies the compatibility sandbox to the complete child tree, and passes the
  Scout/Build overlay through `OPENCODE_CONFIG_CONTENT`.
- Both paths currently bind to loopback, but neither path configures server
  authentication.
- Scout denies `edit`, `bash`, and `task`. Build denies `bash` and `task` while
  allowing the report-writing edit boundary. These are agent permissions, not an
  HTTP authorization boundary.
- MCP startup is controlled by the inventoried server list and persisted Chat
  preferences. The overlay enables only servers explicitly enabled in Chat and
  does not rewrite `opencode.json`.
- The compatibility sandbox constrains writes and process descendants while
  allowing broad reads needed by ordinary MCP runtimes. `allowNetwork=true` is
  intentionally coarse and permits provider, remote MCP, local MCP, and
  descendant network traffic.
- The existing Scout and Write prompts already distinguish research from report
  authoring. The archived report-writing profile is the initial Write contract;
  future report artifact capabilities and agent-specific MCP/plugin gating must
  extend it rather than replace it.
- The MCP overlay currently controls server enablement rather than
  agent-specific MCP tool exposure. An enabled MCP server must not imply that
  every tool it provides is available to every Chat agent.
- Sandbox startup is currently fail-closed. A failed sandbox must not be
  replaced automatically by an unsandboxed companion.
- The current setting default is `inherit`, which normally resolves to the
  native VS Code Chat sandbox state. Native sandboxing is commonly off, so the
  effective current default is often unsandboxed.

The hardening work must preserve the existing compatibility behavior while
closing the unauthenticated companion-server seam.

## User Experience Contract

### Healthy startup

On a supported platform, with a valid OpenCode executable:

1. The extension starts the companion with sandboxing enabled by default.
2. The extension creates a fresh random password in memory.
3. The password is supplied to the child through `OPENCODE_SERVER_PASSWORD`.
4. The SDK client supplies the matching HTTP Basic Authorization header.
5. The server remains bound to `127.0.0.1`.
6. `allowNetwork=true` preserves provider and MCP behavior.
7. Existing MCP preferences are reused without additional prompts.
8. Chat becomes ready without a security dialog.

The webview may show a passive status such as `Protected` or `Sandboxed`, but
normal startup must not require the user to understand passwords, ports, MCP
processes, or sandbox policy.

### Degraded startup

If the secure path fails, the extension must make the degradation explicit:

- Retry the sandboxed startup once with the same policy and a new password.
- If retry fails, keep Chat unavailable and show `Retry`, `Update OpenCode`, and
  `Run without sandbox` actions as applicable.
- `Run without sandbox` is an explicit user action that changes the Chat
  workspace mode to `off` or performs an equivalent one-time recovery.
- The unsandboxed companion still requires authentication.
- The UI must label the fallback as reduced protection and identify why the
  secure path was unavailable.
- No automatic unsandboxed retry is allowed after a sandbox failure.

If authentication cannot be proven, there is no insecure fallback. The only
recovery actions are retry, update, or repair the OpenCode installation.

### Unsupported platforms

When the sandbox runtime is unsupported, the extension should not silently
convert a default `on` request into an unsandboxed launch. It should:

- Register a usable error state in the Chat view rather than leaving a blank
  sidebar.
- Explain that sandboxing is unavailable on the current platform.
- Offer an explicit `Run without sandbox` action.
- Keep authentication enabled if the user chooses that action.
- Remember the explicit workspace decision only if the user selects a persistent
  workspace override.

### MCP compatibility

This change must not add per-server remediation work. All enabled MCPs should
continue to inherit the same companion sandbox and network policy. Existing
MCP preferences remain authoritative, and the extension continues to avoid
writing global or project OpenCode configuration.

The existing first-run behavior where inventoried MCP servers are disabled until
selected may remain unchanged. A separate bulk-enable UX is optional and is not
required for server hardening.

## Agent Capability Contract

Server authentication and sandboxing protect the process boundary. Agent
profiles protect the capability boundary inside an authenticated server. Both
are required. An authenticated HTTP client must still not receive a general
coding agent when the user selected Chat research or report writing.

The internal OpenCode agent identifiers remain `scout` and `build`; the user-facing
labels remain `chat` and `write` as currently defined by the extension.

### Scout: read-only research

Scout is the default research companion. It should be able to gather evidence
without being able to modify the workspace or start arbitrary commands.

Allowed built-in capabilities:

- `read`, `glob`, `grep`, and `list` for workspace and document inspection.
- `webfetch` and `websearch` for external research.
- `question` for clarification when needed.
- MCP tools classified by the extension as read-only research capabilities.

Denied built-in capabilities:

- `edit` and every file-write operation.
- `bash`, shell execution, and command runners.
- `task` or subagent delegation.
- Coding-oriented tools, package management, version-control mutation, and
  terminal control.

Scout requires open outbound network access for providers and research MCPs such
as paper-search, Firecrawl, Context7, and similar retrieval tools. Network
access is not itself a grant to edit files or execute commands; the agent tool
profile and MCP tool allowlist remain the control points.

### Write: report authoring

Write is the report-authoring profile backed internally by OpenCode `build`. It
should have enough capability to research, draft, and assemble useful report
artifacts without becoming a general coding agent.

Allowed capabilities:

- The same read, search, web research, and clarification capabilities as Scout.
- `edit` for requested report outputs, including Markdown and text-based
  artifacts such as SVG and Mermaid.
- MCP tools classified as report-generation or report-assembly capabilities.
- Open network access for research, provider calls, and enabled report MCPs.

Denied capabilities:

- `bash` and arbitrary shell execution.
- `task`, subagent delegation, and unrestricted agent orchestration.
- Package installation, build scripts, arbitrary code execution, and terminal
  control.
- General coding tools that are not needed to produce the requested report.

Images and XLSX require special treatment. Text-oriented `edit` can produce SVG,
Mermaid, Markdown, CSV, and similar files, but it cannot safely create every
binary image or spreadsheet format by itself. The plan must not grant Bash merely
to make those formats possible. Binary report artifacts should be produced by a
trusted, explicitly classified report-generation MCP or a narrowly scoped
artifact writer. If no such capability is available, Write must state that the
format is unavailable rather than silently acquiring coding or shell access.

The report profile should enforce a report-output boundary where the OpenCode
permission system supports path patterns. If the installed server cannot enforce
path-scoped `edit` rules, the extension must either add a host-side report-path
check or document that the report prompt is a behavioral boundary rather than a
hard filesystem boundary. The implementation must not claim that `edit: allow`
alone prevents edits to source code.

### MCP role scoping

MCP server enablement and MCP tool exposure are separate decisions:

- Existing `mcpEnabledByServer` preferences decide which configured servers may
  start in the companion.
- An agent-specific tool map decides which tools from those servers are visible
  to Scout or Write.
- Use the OpenCode `permission` map for built-in tools such as `read`, `edit`,
  `bash`, and `task`, and use the agent `tools` map for MCP/plugin tool names
  and wildcard patterns.
- The extension should use OpenCode's agent `tools` patterns, including wildcard
  patterns for MCP tool prefixes, rather than exposing every enabled server tool
  to every agent.
- Research MCP patterns are available to Scout and, where useful, Write.
- Report-generation MCP patterns are available to Write and not Scout unless
  they are independently classified as read-only research tools.
- Command-capable, mutation-capable, or unknown MCP tool patterns are denied to
  Scout by default.
- Unknown tools should not trigger a new end-user questionnaire. The extension
  owns a small role map for known research and report tools; advanced users can
  use the independent TUI for capabilities outside the Chat profiles.

Tool visibility is not the same as plugin isolation. An agent-specific `tools`
map can hide a plugin-registered tool, but it may not prevent the plugin module
from loading or running initialization code. The Chat companion must therefore
use a separate plugin allowlist or companion config overlay that excludes
coding-oriented plugins by default. Only explicitly approved research or report
plugins should load in Chat. The independent TUI keeps the user's normal plugin
configuration and remains the advanced escape hatch.

The role map is a developer-owned security policy, not a promise that arbitrary
MCP servers are safe. A configured MCP may still contain tools whose behavior is
misleading or whose downstream implementation is vulnerable. The sandbox and
network policy remain the containment layer for enabled MCP descendants.

### TUI handoff boundary

The Chat profiles intentionally do not provide a full coding loop. The existing
session handoff remains the supported path for shell work, broad code changes,
package operations, and other advanced tasks. The TUI is an explicit user action,
has independent process ownership, and must not reuse or expose the Chat server
password.

## Implementation Phases

### Phase 0: Confirm the upstream threat and compatibility floor

Before changing defaults, identify the exact upstream issue, affected versions,
and the behavior that is being mitigated. Record the result in the OpenSpec
proposal and security documentation.

Tasks:

- Confirm whether the exploit requires unauthenticated HTTP access, a specific
  route, a browser origin, a malicious MCP, or a trusted authenticated request.
- Determine the oldest supported OpenCode version that enforces
  `OPENCODE_SERVER_PASSWORD`.
- Determine whether the installed CLI exposes the password only through the
  environment or also through a supported flag. Prefer the environment.
- Define a minimum safe version or a capability probe. Do not assume that a
  future OpenCode v2 release fixes the issue.
- Decide how known affected versions are blocked or warned about. A version that
  does not enforce authentication must not be treated as protected.

Exit criteria:

- The threat model names the exact reachable attack path.
- The extension has a documented minimum compatibility requirement or a
  fail-closed runtime probe.
- Security claims are limited to the attack path actually tested.

### Phase 1: Add automatic companion authentication

The password is a launch-secret, not a user setting. It should be generated and
rotated automatically for every companion process.

Tasks:

- Generate at least 32 bytes of cryptographically secure random data using the
  extension host runtime. Encode it for environment and Basic Auth use without
  introducing shell metacharacter concerns.
- Keep the password in an in-memory launch context only. Do not persist it in
  workspace state, global state, `opencode.json`, the webview, URLs, telemetry,
  crash diagnostics, or terminal command text.
- Pass `OPENCODE_SERVER_PASSWORD` through the child environment. Set an explicit
  username if the installed server supports one; otherwise use the documented
  default username.
- Add the matching Basic Authorization header to every SDK client, including
  the event-stream client path. Use the SDK's supported default-header option.
- Rotate the password on every companion restart and discard it on disconnect.
- Keep the password out of CLI arguments. Process listings expose command-line
  arguments more readily than a child-only environment.
- Keep the password out of `auth_token` query URLs. Query strings can leak into
  logs, diagnostics, browser history, and referrer metadata.
- Extend diagnostic redaction to cover Basic Authorization values and any
  password-shaped environment output.
- Verify whether the OpenCode server passes its environment to MCP children. If
  it does, prevent the server password from being inherited by MCP processes if
  the upstream launch model permits it. If it cannot be filtered, document that
  enabled MCPs are trusted descendants and do not claim that the password is
  isolated from them.

#### Unify normal and sandboxed launch

The sandboxed path already owns an explicit child spawn. The normal path is
currently SDK-managed, which may not provide a per-child environment option.
The implementation must choose one of these safe approaches:

1. Extend or use a supported SDK server-launch option that accepts a child
   environment and preserves lifecycle handling.
2. Replace the normal `createOpencodeServer()` call with the same internal
   explicit launcher abstraction used by the sandboxed path.

Do not temporarily mutate the extension host's global `process.env` around an
SDK call. That is racy, exposes the password to unrelated children, and makes
the security boundary difficult to reason about.

The common launcher should own:

- Executable selection and version discovery.
- `serve`, `--hostname`, `127.0.0.1`, `--port`, and `0` arguments.
- Per-child environment construction.
- `OPENCODE_CONFIG_CONTENT` overlay injection.
- Listening URL discovery and readiness.
- SDK client construction with authenticated headers.
- Process-group teardown and password disposal.

#### Authentication enforcement probe

A server must not be marked ready merely because it printed a listening URL.
After readiness:

- Make a read-only request without credentials and require `401`.
- Make the same or an equivalent request with the generated credentials and
  require the expected success response.
- Make a request with an incorrect credential and require `401`.
- Fail startup if an unauthenticated request succeeds, if the server does not
  support the probe route, or if the authenticated request fails.

The probe must not use a mutating endpoint. The route should be selected from a
stable, documented SDK/server read-only endpoint and covered by a local stub and
a live companion test.

### Phase 2: Make sandboxing secure by default

Change the Chat-specific default from effective `inherit` behavior to effective
`on` on supported platforms. Keep `inherit` as an explicit compatibility choice
for users or managed workspaces that need it, but do not let the native VS Code
setting silently turn the new Chat default off.

Tasks:

- Change the extension configuration default and settings resolver so an
  unspecified Chat sandbox mode resolves to `on` when the runtime supports it.
- Keep `allowNetwork=true` as the default. Explain that this preserves model
  provider and remote MCP traffic but is not a confidentiality boundary.
- Preserve the explicit `off` mode for users who knowingly accept the reduced
  boundary.
- Keep the existing compatibility filesystem policy and complete process-tree
  teardown. Do not broaden read or write grants to make a failing MCP work.
- Keep sandbox startup fail-closed and retain diagnostics.
- Add a bounded retry that restarts only with the sandbox policy. Never retry
  unsandboxed automatically.
- Keep authentication mandatory in both `on` and explicit `off` modes.
- Ensure a server started by the terminal handoff or independent TUI is not
  misclassified as the authenticated Chat companion.

The default change should be shipped only after authentication and sandbox
startup have passed the live verification gates. Otherwise the extension would
make a stronger security promise without having the enforcement mechanism ready.

### Phase 3: Add explicit degraded-mode recovery

The fallback should be one exceptional user decision, not a recurring setup
burden.

Tasks:

- Add structured error codes for missing executable, unsupported platform,
  sandbox initialization failure, server readiness failure, authentication
  enforcement failure, and database lock.
- Register the webview even when companion startup fails so the user sees an
  actionable recovery screen.
- Add `Retry` without changing policy.
- Add `Run without sandbox` only for sandbox capability failures. Require an
  explicit click and state the reduced protection in the button and confirmation
  text.
- Add `Update OpenCode` or `Repair installation` guidance when authentication
  enforcement is unavailable.
- Do not present `Run without sandbox` for an authentication failure.
- Preserve managed-setting behavior. If organization policy requires sandboxing,
  do not offer a bypass that violates the managed policy.
- Consider a one-time workspace fallback versus a persistent `mode=off` choice.
  The recommended default is one explicit workspace-scoped choice with a clear
  way to restore `on`.
- Add a passive Gear-panel status showing whether the current companion is
  authenticated, sandboxed, and network-enabled. Do not expose the password.

### Phase 4: Preserve MCP behavior without per-server security work

The security policy should apply uniformly to all enabled MCPs rather than
asking users to repair each server.

Tasks:

- Keep `buildMcpOverlay()` and host-owned MCP preferences as the source of truth.
- Update `CHAT_AGENT_OVERLAY` so Scout explicitly allows clarification questions
  and the Write/Build profile explicitly allows clarification questions while
  retaining deny-by-default for every non-report capability.
- Keep `CHAT_SYSTEM.md` and `WRITE_SYSTEM.md` aligned with the enforced profiles:
  Scout must describe read-only research, and Write must describe supported
  report artifacts, report-path limits, and TUI handoff for coding work.
- Ensure the same overlay is passed to authenticated sandboxed and unsandboxed
  launches.
- Add an agent-specific `tools` overlay so enabled MCP servers do not expose all
  of their tools to every agent. Use wildcard patterns for the extension-owned
  research and report tool roles.
- Add a companion plugin allowlist. Do not load coding-oriented plugins merely
  because they are installed globally; agent tool denial is not sufficient to
  prevent plugin initialization.
- Allow read-only research MCP patterns to Scout and Write, report-generation
  patterns to Write, and deny command-capable or unknown MCP patterns to Scout.
- Keep the role map developer-owned. It must not add a per-server setup wizard
  for ordinary users, and it must not infer safety from an MCP tool description
  alone.
- Ensure enabled local stdio MCPs and remote MCPs inherit the configured network
  policy without new server-name-specific exceptions.
- Keep all selected MCP descendants inside the sandboxed process tree.
- Keep MCP startup failures visible and attributed to the affected child.
- Preserve the existing no-write-to-`opencode.json` contract.
- Verify Scout can use research MCPs with `allowNetwork=true` without gaining
  edit, shell, task, or report-file capabilities.
- Verify Write can create the supported report artifact classes without gaining
  Bash, task, package, or general coding capabilities. Binary images and XLSX
  must use a trusted report-generation capability rather than an automatic Bash
  grant.
- Add path-scoped edit rules for report outputs where the installed OpenCode
  permission system supports them. Otherwise enforce or explicitly surface the
  report-path limitation in the host rather than claiming that `edit: allow` is
  report-only.
- Add a static, non-blocking trust notice that enabled MCPs remain user-trusted
  and that `allowNetwork=true` permits network exfiltration of data they can
  read. Do not turn this notice into a per-MCP wizard.
- Audit the environment passed to local MCP children so the companion password is
  not unnecessarily exposed.

This phase deliberately does not attempt to inspect or certify arbitrary user
MCP implementations. The general MCP list can continue to work under the
compatibility sandbox with no new case-by-case fixes.

### Phase 5: Harden process construction and lifecycle

Authentication must not be undermined by a new shell interpolation path.

Tasks:

- Use argument arrays for direct `opencode serve` launches.
- Do not add the password to the command line or generated shell wrapper.
- If the sandbox runtime requires a shell wrapper, keep quoting centralized and
  add tests for executable paths, workspace paths, configured arguments, and
  generated environment values.
- Validate the selected executable before starting the companion and preserve
  the existing absolute-path resolution behavior.
- Ensure the authenticated client URL is only accepted from the child that the
  extension just launched. Do not treat an arbitrary localhost URL as a trusted
  Chat server.
- Rotate credentials on reconnect and terminate the complete previous process
  tree before starting the replacement.
- Ensure password-bearing environment and diagnostics are cleared after process
  teardown.
- Preserve independent TUI lifecycle and handoff behavior. TUI access must not
  reuse or expose the Chat companion password.

### Phase 6: Verification, documentation, and release gates

#### Unit and host tests

Add focused coverage for:

- Cryptographically random password generation and per-launch uniqueness.
- No persistence, webview message, command argument, URL, or log exposure.
- Environment injection in both normal and sandboxed launch paths.
- No mutation of the extension host's global environment.
- Authenticated SDK headers on normal requests and event streams.
- Unauthenticated, wrong-password, and authenticated probe outcomes.
- Fail-closed behavior when the server ignores or rejects the password.
- Password rotation across reconnect and disposal.
- Loopback and port `0` arguments in every launch path.
- Scout/Build permission matrix preservation, including denial of shell and task
  capabilities.
- Agent-specific MCP tool scoping for research and report roles.
- Companion plugin allowlist coverage proving coding-oriented plugins are not
  loaded into Chat while approved research/report plugins remain available.
- CHAT/WRITE system-prompt regression coverage for the enforced capability
  boundary and advanced TUI handoff.
- Scout research MCP access with network enabled and no file writes.
- Write report artifact coverage for Markdown, SVG, Mermaid, and the supported
  image/XLSX generation path without Bash or task access.
- Report-path enforcement or an explicit test proving its documented boundary.
- Existing MCP preference and overlay behavior without per-server changes.
- Default sandbox resolution to `on` on supported platforms.
- Explicit unsandboxed recovery and no automatic fallback.
- Unsupported-platform and managed-setting behavior.
- Retry and error-state UI without a blank sidebar.
- Complete process-tree teardown before reconnect.

#### Integration and live tests

Run representative checks with:

- The supported installed OpenCode version.
- A stub server that ignores `OPENCODE_SERVER_PASSWORD`, proving startup fails
  closed.
- A sandboxed local MCP with `allowNetwork=true`.
- A remote MCP with `allowNetwork=true`.
- A network-disabled sandbox path proving remote provider/MCP requests fail inside
  the sandbox rather than retrying outside it.
- A write attempt outside the allowed workspace boundary.
- A local process attempting unauthenticated access to the companion port.
- A wrong-password request.
- A browser-like localhost request without credentials.
- Reconnect and MCP child teardown.
- Terminal handoff and independent TUI behavior.

Tests must report status and bounded diagnostics without recording secrets.

#### Documentation and release

Update:

- `README.md` with the default sandbox, network, authentication, MCP, and
  explicit fallback behavior.
- `packages/platforms/vscode/README.md` with non-technical user guidance and
  the difference between protected Chat and independent TUI behavior.
- `SECURITY.md` with the precise mitigation claim and residual risks.
- The main sandbox specification after the compatibility change is verified.
- A new companion-security OpenSpec specification after this change is verified.

Run the normal release gates:

```text
openspec validate --strict
npm test
npm run test:all
npm run check
npm run build
cd packages/platforms/vscode && npm run package
```

Install the VSIX and perform live macOS smoke tests before changing the default
sandbox setting in a release build.

## Recommended Rollout Order

1. Start from the validated archived sandbox, MCP persistence, compatibility,
   and report-writing baseline; do not recreate those changes.
2. Confirm the exact upstream vulnerability and supported authentication
   behavior.
3. Implement the common authenticated launcher and fail-closed probe while
   leaving the current sandbox default unchanged.
4. Verify normal and sandboxed launches, MCP compatibility, reconnects, and
   terminal handoff.
5. Add the explicit degraded-mode UI and structured errors.
6. Change the Chat default to sandbox `on` on supported platforms.
7. Run the full release and live verification gates.
8. Publish the narrower security claim and residual-risk documentation.

If a known vulnerable OpenCode version cannot enforce authentication, block it
before launch. Do not use the explicit unsandboxed recovery action to bypass an
authentication failure.

## OpenSpec Outline

Proposed change name: `harden-chat-companion-server`

The change should be separate from the existing sandbox compatibility change so
that authentication, default policy, and degraded-mode UX have an independent
verification boundary. It may depend on the compatibility-layer implementation
and should not rewrite its already-established MCP path policy.

The implementation dependency chain is:

1. Use the archived `2026-08-24-add-chat-agent-sandbox` and
   `2026-08-24-chat-sandbox-compatibility-layer` changes as the sandbox baseline.
2. Preserve the archived `2026-08-24-chat-mcp-startup-persistence` preference
   and startup behavior.
3. Extend the archived `2026-08-24-add-report-writing-mode` profile rather than
   creating a second Write/Build prompt or changing the internal `build`
   identifier.
4. Implement authentication, secure-default policy, agent-scoped tool/plugin
   gating, report artifact extensions, status UX, and export/import-only handoff
   as the new hardening delta.

The hardening change must not reopen or duplicate the archived report-writing
shell-removal work. Its handoff requirement changes only the post-authentication
fallback behavior: Chat credentials remain private and the supported transition
is export/import to an independent TUI.

### `proposal.md`

Include:

- The unauthenticated localhost companion-server threat.
- Why loopback alone does not protect against local processes or browser pages.
- The user-facing goal: no setup on healthy startup, explicit choice only on
  degraded startup.
- Automatic per-companion authentication.
- Secure-by-default Chat sandboxing with `allowNetwork=true` compatibility.
- Preservation of existing MCP preferences and no MCP-specific allowlist work.
- Scout research-only and Write report-authoring capability profiles.
- Agent-scoped MCP tool patterns for research and report-generation roles.
- Scout catch-all deny rules and prompt-injection guardrails for untrusted tool
  and workspace content.
- Passive protection status, version-drift visibility, and high-impact action
  confirmation without normal-startup prompts.
- Export/import-only TUI handoff with no Chat credential reuse.
- Secondary data-path privacy for diffs, diagnostics, sharing, and telemetry.
- Fail-closed authentication and sandbox behavior.
- Explicit scope limitation: this does not patch an authenticated upstream
  command-injection bug and does not migrate to OpenCode v2.
- Impacted packages, tests, documentation, and release process.

### `design.md`

Use these sections:

1. Threat model and assumptions.
2. Current normal and sandboxed launch paths.
3. Common companion launcher abstraction.
4. Ephemeral password lifecycle and SDK header injection.
5. Authentication enforcement probe and minimum-version policy.
6. Loopback binding and trusted child URL discovery.
7. Default sandbox resolution and network compatibility.
8. Scout research permissions and network-enabled MCP access.
9. Write report permissions, artifact types, and report-path boundary.
10. Agent-scoped MCP/plugin tool patterns, plugin loading, and unknown-tool
    behavior.
11. Explicit unsandboxed recovery and unsupported-platform behavior.
12. MCP preference preservation, descendant policy, and secret inheritance.
13. Process-group teardown and credential disposal.
14. Protection status, version drift, and error-state UX.
15. Prompt-injection resistance and capability invariants.
16. High-impact sharing, permission consent, and reset behavior.
17. Export/import-only TUI handoff and credential separation.
18. Secondary data-path privacy and bounded diagnostics.
19. Migration, managed settings, and independent TUI boundaries.
20. Security claims, residual risks, and non-goals.

Important design decisions to record:

- The password is generated by the extension host and never requested from the
  user.
- `OPENCODE_SERVER_PASSWORD` is supplied through a child-only environment, not
  global `process.env` or CLI arguments.
- The SDK client sends Basic Auth on all requests and event streams.
- The server is not ready until the unauthenticated and authenticated probes
  prove the expected boundary.
- Scout has no edit, shell, task, or arbitrary MCP command capability.
- Scout uses an explicit catch-all deny rule so new tools do not widen its
  capability surface by default.
- Write has only report-authoring edit and report-generation capabilities; it has
  no Bash, task, package, or general coding loop.
- Enabled MCP servers and agent-visible MCP tools are controlled separately.
- Agent tool gating is not treated as plugin sandboxing; coding-oriented plugins
  are excluded from the companion launch configuration.
- Auth remains enabled when the user explicitly chooses unsandboxed recovery.
- A sandbox failure never silently starts an unsandboxed companion.
- `allowNetwork=true` is retained for compatibility and documented as a coarse
  network boundary.
- No per-MCP path exceptions or security wizard are introduced.
- Workspace files, web content, MCP output, and retrieved documents are treated
  as untrusted data and cannot override capability policy.
- The Chat surface exposes passive protection status and asks for confirmation
  only before high-impact sharing or persistent permission actions.
- The Chat password is never reused by the independent TUI; handoff uses
  export/import only.
- Diff content is not embedded in URI query strings, and diagnostics are bounded
  and redacted without telemetry capture.

### Delta specification outline

Prefer a new capability delta at:

```text
openspec/changes/harden-chat-companion-server/specs/chat-companion-security/spec.md
```

The eventual synchronized main specification can be:

```text
openspec/specs/chat-companion-security/spec.md
```

The delta should define at least these requirements and scenarios.

#### Requirement: Authenticated companion server

The Chat companion MUST use a fresh per-process credential and MUST send the
matching credential on every SDK request and event stream.

Scenarios:

- Healthy authenticated startup succeeds without user input.
- A request without credentials receives `401`.
- A request with the wrong credential receives `401`.
- A request with the generated credential succeeds.
- A reconnect rotates the credential.
- The credential is not persisted or exposed through UI, arguments, URLs, or
  diagnostics.

#### Requirement: Fail-closed authentication enforcement

The extension MUST refuse to mark Chat ready when the server does not enforce
the configured credential or the authenticated readiness probe fails.

Scenarios:

- A server that ignores the password is rejected.
- A missing or unsupported probe route produces an actionable compatibility
  error rather than an unauthenticated fallback.
- An affected or below-minimum OpenCode version is blocked or clearly rejected.

#### Requirement: Loopback-only launch

The companion MUST launch with an explicit loopback hostname and MUST not accept
an arbitrary localhost URL as proof that it owns the server.

Scenarios:

- Normal and sandboxed launches bind to `127.0.0.1`.
- Port `0` is used or a safe equivalent is reserved.
- A server started independently by the TUI is not treated as the Chat server.

#### Requirement: Secure default sandbox

On a supported platform, an unspecified Chat sandbox setting MUST resolve to
enabled. The sandbox MUST cover the companion and its MCP descendants.

Scenarios:

- A default supported startup is sandboxed with network access enabled.
- Providers and configured MCPs continue to work without new per-server setup.
- Writes outside the approved policy remain denied.
- A sandbox startup failure does not start an unsandboxed companion.

#### Requirement: Explicit degraded recovery

The extension MUST require an explicit user action before running Chat without
the sandbox after a sandbox capability failure.

Scenarios:

- Retry uses the sandboxed policy.
- `Run without sandbox` is visible only for relevant sandbox failures.
- The fallback remains authenticated and is labelled as reduced protection.
- Managed sandbox policy cannot be bypassed by the recovery control.
- Unsupported platforms present the same explicit choice.

#### Requirement: MCP compatibility without per-server remediation

The extension MUST preserve host-owned MCP preferences and MUST apply one
companion policy to every enabled MCP descendant.

Scenarios:

- Existing enabled local and remote MCPs continue to start with network enabled.
- No server-name-specific filesystem exception is required.
- MCP configuration ownership remains outside `opencode.json` writes.
- MCP failures remain visible and do not trigger an unsandboxed retry.

#### Requirement: Scout research-only profile

The Scout agent MUST be limited to read, search, web research, clarification,
and explicitly classified read-only research MCP tools. Scout MUST NOT edit or
write workspace files, execute shell commands, delegate tasks, or invoke
command-capable or unknown MCP tools.

Scenarios:

- Scout can use paper-search, Firecrawl, Context7, and equivalent research MCPs
  while network access is enabled.
- Scout can inspect workspace files but cannot create or modify report files.
- Scout cannot invoke Bash, task delegation, package operations, or terminal
  control.
- An enabled MCP server's non-research tools are not exposed to Scout merely
  because the server itself is enabled.

#### Requirement: Write report-authoring profile

The Write agent MUST be limited to research, report drafting, report editing,
and explicitly classified report-generation capabilities. Write MUST NOT receive
general shell, task, package, or coding-loop capabilities.

Scenarios:

- Write can create Markdown, SVG, Mermaid, and other supported text artifacts.
- Write can use a trusted image or XLSX report-generation capability when one is
  configured, without receiving Bash access.
- Write cannot run package installation, arbitrary scripts, shell commands, or
  subagents.
- Write edits only requested report outputs when path-scoped permissions are
  available; otherwise the extension reports the weaker boundary explicitly.

#### Requirement: Agent-scoped MCP and plugin tool exposure

The companion MUST separate MCP server startup preferences from agent-visible
MCP/plugin tool permissions, and MUST keep coding-oriented plugins out of the
Chat companion by default.

Scenarios:

- Existing server preferences continue to determine which MCP processes start.
- Research tool patterns are visible to Scout and Write as appropriate.
- Report-generation tool patterns are visible to Write and not Scout unless they
  are independently read-only.
- Unknown and command-capable MCP patterns are denied to Scout by default.
- Coding-oriented plugins are not loaded into Chat merely because they are
  installed in the user's global OpenCode configuration.
- No new per-MCP end-user questionnaire is required for the default role map.

#### Requirement: Advanced TUI handoff boundary

The Chat companion MUST retain a narrow research and report-writing capability
boundary. Full coding, shell, package, and advanced MCP work remains an explicit
handoff to the independent OpenCode TUI, and Chat-to-TUI handoff MUST use
export/import rather than attaching the TUI to the authenticated Chat server.

Scenarios:

- A user can hand off a session without granting the Chat agent a coding loop.
- The TUI does not reuse the Chat companion credential.
- The handoff does not pass the Chat credential through arguments, environment,
  URLs, or persisted state.
- Chat security status does not classify an independently started TUI server as
  an authenticated Chat companion.

#### Requirement: Prompt and capability invariants

The Chat companion MUST treat workspace files, web content, retrieved documents,
and MCP output as untrusted data. Untrusted content MUST NOT override the
selected agent profile or grant denied capabilities.

Scenarios:

- Prompt-injection text in a workspace file cannot enable edit, Bash, task, or
  unknown MCP tools for Scout.
- Prompt-injection text in an MCP response cannot change authentication,
  sandbox, network, or plugin policy.
- Scout retains catch-all deny behavior when a new OpenCode tool is introduced.
- Write retains its report-only capability boundary when prompt text changes.

#### Requirement: Protection status and security drift

The Chat surface MUST expose passive authentication, sandbox, network, agent, and
MCP status, and MUST surface actionable version or protection drift.

Scenarios:

- Healthy Chat shows a compact protected/sandboxed status without a startup
  dialog.
- A degraded or unsandboxed state is visually apparent and links to recovery.
- The OpenCode and SDK versions are available in bounded diagnostics without
  credentials.
- Authentication enforcement failure remains a hard stop.

#### Requirement: High-impact consent and secondary data privacy

The extension MUST ask for confirmation before high-impact sharing or persistent
permission actions and MUST keep sensitive content out of secondary data paths.

Scenarios:

- Session sharing explains that the conversation may contain workspace excerpts
  or pasted secrets before creating a public link.
- One-time permission approval is more prominent than persistent approval.
- Diff content is not placed in virtual-document URI query strings.
- Copyable diagnostics and error notifications are bounded and redacted.
- Conversation, prompt, tool-output, credential, and workspace content is not
  sent to telemetry or crash-reporting services.

#### Requirement: Secret and diagnostic hygiene

The extension MUST prevent companion credentials from appearing in arguments,
URLs, persisted state, webview messages, logs, telemetry, or unredacted errors.

Scenarios:

- Bounded diagnostics redact authorization and password values.
- Process teardown clears the in-memory credential.
- MCP environment inheritance is tested and either filtered or documented as a
  trusted-descendant residual risk.

#### Requirement: Lifecycle integrity

The extension MUST rotate credentials and await complete companion process-tree
teardown before reconnecting.

Scenarios:

- Repeated sandbox/network transitions do not leave authenticated orphan servers
  or MCP descendants.
- A replacement companion cannot reuse the previous credential.
- Final disposal terminates the companion tree and clears launch state.

### `tasks.md`

Suggested task groups:

1. Threat baseline and minimum-version/capability policy.
2. Common authenticated launcher and child-only environment.
3. SDK Basic Auth headers and readiness probe.
4. Credential redaction, disposal, and MCP environment review.
5. Secure default sandbox resolution and network compatibility.
6. Scout and Write permission profiles, report artifact boundaries, and agent
   scoped MCP tool patterns.
7. Explicit degraded-mode UX and structured startup errors.
8. MCP preference regression and live compatibility checks.
9. Process-tree lifecycle and reconnect tests.
10. Prompt-injection guardrails, protection status, version drift, high-impact
    consent, export/import-only handoff, and secondary data-path privacy.
11. Unit, host, integration, and scenario test coverage.
12. README, `SECURITY.md`, main-spec synchronization, and strict validation.
13. Build, VSIX packaging, installation, and live smoke verification.

Each task should include its verification command or scenario. The change must
not be archived while the live authenticated probe, sandboxed MCP check, and
explicit fallback behavior remain unverified.

## Acceptance Criteria

The plan is complete only when all of the following are true:

- A normal user can install, enable, and use Chat without entering a password or
  configuring a new MCP security setting.
- The companion is authenticated automatically in sandboxed and unsandboxed
  modes.
- The default supported-platform Chat launch is sandboxed with network enabled.
- Authentication and sandbox failures are fail-closed unless the user explicitly
  chooses reduced protection.
- Existing enabled MCPs continue to work without server-specific exceptions.
- Scout can perform network-enabled research without file-write, shell, task, or
  command-capable MCP access.
- Coding-oriented OpenCode plugins are not loaded into the Chat companion.
- Write can produce the supported report artifact set without becoming a general
  coding agent; unsupported binary formats fail clearly instead of granting Bash.
- The TUI handoff remains available as the explicit advanced-user escape hatch.
- No password appears in process arguments, URLs, persisted state, webview
  messages, or diagnostics.
- A local unauthenticated HTTP client cannot drive the companion API.
- A compromised companion or MCP has a materially smaller write/process blast
  radius when sandboxing is available.
- The documentation distinguishes mitigation of unauthenticated API abuse from
  repair of an upstream authenticated command-injection defect.
- The exact upstream vulnerability and any unsupported-version policy are
  documented before release.
