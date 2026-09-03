## Context

The existing Chat sandbox policy already derives normalized, deterministic
`denyReadPaths` from literal cross-platform, macOS, and Linux constants. It
passes the resulting policy through the existing launch path in `extension.ts`
and the agent adapter to the sandbox runtime. Required `allowRead` paths are
also represented by the current read-only and read-write grants, so
`assertNoDenyReadOverlap()` must continue to reject exact matches and both
containment directions before launch.

See `proposal.md` for the motivation and
`specs/chat-agent-sandbox/spec.md` for the normative contract. This design is
an additive expansion of the existing list, not a new sandbox architecture.

## Goals / Non-Goals

**Goals:**

- Add a conservative, reviewed inventory of narrow credential, shell-data,
  browser, keychain, and private-application paths to the existing literal
  platform constants.
- Preserve lexical normalization, deduplication, deterministic ordering,
  platform separation, fail-closed overlap validation, and the current launch
  and process-tree behavior.
- Keep ordinary workspace, OpenCode, executable/PATH, runtime-cache, temporary,
  network, MCP startup, and lifecycle compatibility unchanged when paths do not
  conflict.
- Make the compatibility impact explicit: `denyRead` is process-wide for
  Scout, Write, and MCP descendants, while Write remains broad workspace-scoped
  `edit: "allow"` with behavioral requested-artifact guidance.

**Non-Goals:**

- Runtime nono discovery, profile parsing, user-specific policy generation,
  recursive home denies, glob rules, broad parent denies, or a new dependency.
- Denying `~/.config`, `~/.local/share`, `~/.cache`, `~/Library`,
  `~/Library/Application Support`, editor state, CloudStorage, Documents,
  Projects, PATH, OpenCode, UV/npm, or temporary roots as broad parents.
- A reports-directory convention, host-mediated or staging writer,
  exact-report-path enforcement, or MCP-specific filesystem allowlists.
- Changing Write's broad workspace-scoped `edit: "allow"`, agent permissions,
  network policy, MCP startup, process inheritance, lifecycle, or Windows
  unsupported behavior.

## Decisions

### 1. Extend the existing static constants

Add reviewed entries to `CROSS_PLATFORM_DENY_READ_PATHS`,
`MACOS_DENY_READ_PATHS`, and `LINUX_DENY_READ_PATHS` in
`chat-sandbox-policy.ts`. Resolve relative entries against the effective home
using the existing lexical POSIX normalization, retain absolute `/Library`
entries only where already established for macOS, and continue returning no
deny baseline on unsupported platforms. No runtime filesystem probing is used;
this keeps policy construction deterministic and avoids making protection
dependent on whether a path currently exists.

The first pass selects these candidate categories:

| Category | Selected narrow paths | Why selected |
| --- | --- | --- |
| Cross-platform credential/config leaves | `.config/gh/hosts.yml`, `.config/glab-cli/config.yml`, `.config/rclone/rclone.conf`, `.config/containers/auth.json`, `.pypirc`, `.cargo/credentials`, `.cargo/credentials.toml`, `.config/sops/age/keys.txt`, `.config/age/keys.txt` | These are named credential, registry, authentication, or private-key files. They are high-value leaves rather than parent configuration trees, so ordinary unrelated configuration remains readable. |
| Cross-platform/private shell data | `.local/share/fish/fish_history`, `.config/atuin`, `.config/nushell`, `.local/share/nushell`, `.zsh_sessions`, `.bash_sessions` | These locations contain command history or shell state that commonly embeds tokens and secrets. The entries are limited to the shell-specific roots and do not deny all XDG data or shell-adjacent files. |
| macOS browser variants and private stores | `Library/Application Support/Google/Chrome Beta`, `Library/Application Support/Google/Chrome Canary`, `Library/Application Support/Microsoft Edge Beta`, `Library/Application Support/Microsoft Edge Canary`, `Library/Application Support/com.operasoftware.Opera GX`, `Library/Application Support/Orion`, `Library/Application Support/LibreWolf`, `Library/Application Support/Waterfox`, `Library/Application Support/Bitwarden`, `Library/Application Support/Proton Pass`, `Library/Application Support/KeePassXC` | These are application-specific siblings of already protected browser/password-store roots and are narrowly scoped to apps that can contain cookies, tokens, profiles, or vault data. No `~/Library` or generic Application Support parent is added. |
| macOS private application data | `Library/Calendars`, `Library/AddressBook`, `Library/Notes`, `Library/Accounts`, `Library/IdentityServices`, `Library/Application Support/Signal`, `Library/Thunderbird` | These are named stores containing communications, contacts, identities, messages, or mail credentials. Each is a specific store or application root, not a broad Library parent. |
| Linux browser variants and private/keychain stores | `.config/google-chrome-beta`, `.config/google-chrome-unstable`, `.config/chromium-browser`, `.config/ungoogled-chromium`, `.config/librewolf`, `.config/waterfox`, `.config/qutebrowser`, `.config/falkon`, `.config/tor`, `.config/kwalletd`, `.config/keepassxc`, `.config/Signal`, `.config/Nextcloud`, `.thunderbird`, `.config/evolution` | These are application-specific browser profiles, password/keychain stores, or private sync/mail data. They complement the existing Linux entries without denying all of `.config`, `.local/share`, or `.cache`. |

The inventory is intentionally not exhaustive. Candidates with ambiguous
placement or a broad parent shape are deferred rather than approximated. In
particular, no editor-state, CloudStorage, Documents, Projects, PATH, OpenCode,
UV/npm, or temporary-root entry is selected. The exact constants remain easy to
review and extend in a later change.

### 2. Preserve fail-closed overlap semantics

Keep `assertNoDenyReadOverlap()` unchanged in meaning and continue invoking it
after all required paths are normalized. Its `isWithin()` checks must cover
exact, deny-ancestor-of-grant, and grant-ancestor-of-deny conflicts. A conflict
with the workspace, OpenCode configuration/state/cache, executable or PATH
dependency, runtime cache, temporary path, or any other required grant fails
before launch with the existing actionable error.

The implementation must never remove a deny, broaden a grant, retry with a
different policy, or fall back unsandboxed. This lexical check is required even
when a path is absent: Linux runtime enforcement has an existing limitation
where missing paths may not receive deny rules during initialization, so the
complete static list is still passed to the backend and tests distinguish policy
construction from enforcement of existing paths.

### 3. Keep compatibility grants and write behavior intact

Do not alter `allowRead` derivation, `allowWrite` derivation, OpenCode state or
config handling, npm/UV/runtime caches, temporary-root validation, loopback or
network policy, MCP inventory/startup, process inheritance, or teardown. A
non-conflicting workspace must remain readable and writable, and compatible
runtime/MCP paths outside the selected baseline must remain available without a
server-specific exception.

Write remains broad workspace-scoped `edit: "allow"`; requested-artifact
guidance remains behavioral. This change adds no `reports/` convention, writer
proxy, staging area, exact report path, or MCP-specific filesystem allowlist.
Because `denyRead` applies to the entire companion process tree, including
Scout, Write, and MCP descendants, an MCP intentionally reading a newly
protected path may be affected. Core Chat and Write functionality remains
available for non-conflicting paths, but arbitrary-MCP compatibility is not
promised after adding a protected path.

### 4. Verify policy, launch mapping, and runtime enforcement separately

The focused policy tests will assert:

- exact selected entries, normalized home-relative resolution, sorted and
  deduplicated output, and macOS/Linux platform separation;
- unchanged workspace, OpenCode, executable/PATH, runtime-cache, temporary,
  and network-related grants, plus Windows `denyReadPaths: []`;
- exact, deny-ancestor, and grant-ancestor conflicts for both read-only and
  read-write grants, including workspace and runtime examples; and
- no broad parent entries such as home, generic XDG, Library, Documents,
  Projects, OpenCode, cache, or temporary roots.

Launch mapping tests will verify that the computed `denyReadPaths` reaches the
runtime `SandboxRuntimeConfig.filesystem.denyRead`, that all companion
descendants inherit the same policy, and that overlap/startup failure does not
invoke an unsandboxed replacement. Unsupported Windows behavior will continue
to bypass sandbox-runtime initialization and retain its existing unsandboxed
path.

Opt-in macOS/Linux runtime tests, gated by
`OPENCODE_CHAT_RUN_SANDBOX_INTEGRATION=1`, will use existing protected paths to
verify denied reads, protected-read inheritance through a nested
local-MCP-like child, workspace/runtime read-write behavior, and the existing
Linux existing-path semantics. Normal test runs may skip these tests; a skip is
reported as an environment limitation, not as proof of OS enforcement.

## Risks / Trade-offs

- **[MCP compatibility loss]** An intentionally configured MCP may read a newly
  protected store. → Keep the inventory narrow and explicit, surface the
  existing diagnostic, and let the user select the existing sandbox `off`
  setting when compatibility is required; do not add an MCP exception.
- **[Static inventory drift]** New applications or renamed profile directories
  will not be covered. → Keep constants versioned, reviewed, deterministic,
  and covered by platform-specific unit tests.
- **[Linux missing-path limitation]** A deny rule may not be installed for a
  path absent at sandbox initialization. → Pass the full static list, test
  existing paths in opt-in runtime coverage, and document that policy presence
  is not equivalent to enforcement for missing paths.
- **[Incomplete confidentiality]** Broad reads outside the baseline and
  network-enabled operation can still expose or transmit data. → Describe the
  feature as targeted defense-in-depth, not strict confidentiality or
  protection against malicious processes.
- **[Grant conflict]** A workspace or required runtime may intentionally be
  placed under a selected store. → Preserve both-direction overlap rejection
  and fail before launch rather than weakening the deny or broadening access.
- **[Platform false assurance]** A platform-specific path could be emitted on
  the wrong OS. → Keep separate constants, assert platform separation, and
  retain no-baseline Windows behavior.

## Migration Plan

No data or configuration migration is required. Existing `inherit`, `on`, and
`off` settings continue to resolve as before; on supported macOS/Linux launches,
the newly selected paths become denied only when the Chat sandbox is active.
Non-conflicting workspace, OpenCode, runtime, temporary, network, and MCP
behavior remains unchanged. A required-grant overlap is a visible pre-launch
failure and does not trigger an unsandboxed retry.

Rollback is configuration-first: select Chat sandbox `off` (or restore
inheritance while the native sandbox is disabled) to use the existing
unsandboxed compatibility path. A code rollback can remove only the newly added
static entries while retaining the existing policy plumbing and fail-closed
overlap handling. Rollback must not weaken conflict validation or introduce a
broad grant.
