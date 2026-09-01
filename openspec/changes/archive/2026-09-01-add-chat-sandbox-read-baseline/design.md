## Context

The current Chat compatibility policy intentionally leaves reads broad so local MCP executables and their arbitrary Node, Python, uv, Bun, Rust, and other runtime dependencies can start without server-specific grants. `buildChatSandboxFilesystemPolicy` already normalizes required read/write paths and exposes `denyReadPaths`, and the OpenCode agent already forwards that field to `SandboxRuntimeConfig.filesystem.denyRead`; the policy value is currently empty.

See `proposal.md` for motivation and `specs/chat-agent-sandbox/spec.md` for the normative behavior. The prior compatibility change is archived and explicitly chose not to deny reads under the home directory. This change is an additive security baseline that preserves broad compatibility reads outside selected sensitive roots and files.

## Goals / Non-Goals

**Goals:**

- Deny a reviewed, static set of high-value credential, browser, keychain, private-data, shell-history, and shell-configuration paths for sandboxed macOS and Linux Chat process trees.
- Keep policy construction independent of nono installation, user profiles, MCP names, and MCP configuration parsing.
- Preserve the existing workspace/runtime write allowlist, broad compatibility reads outside the baseline, network behavior, process inheritance, lifecycle, and agent permissions.
- Prevent `allowRead` grants from re-enabling a protected path and fail before launch when the workspace or required runtime path conflicts with the baseline.
- Keep unsupported Windows behavior unchanged and explicit in status/UI.

**Non-Goals:**

- A strict whole-home read allowlist or complete credential-confidentiality boundary.
- Windows sandbox enforcement, Windows deny-path design, or an upgrade of `@vscode/sandbox-runtime`.
- Runtime nono discovery, profile synchronization, per-MCP policies, credential mediation, or network-domain policy changes.
- Changes to the independent OpenCode CLI/TUI, VS Code-wide agent sandbox settings, Scout/Build permissions, or companion process ownership.

## Decisions

### 1. Use a static, versioned policy in the extension

The policy builder will own the baseline as code constants. It will select paths by `NodeJS.Platform`, resolve home-relative entries against the supplied normalized `homePath`, add the macOS global `/Library/Keychains` entry only on macOS, and return no baseline for unsupported platforms. The result will pass through the existing `uniqueSorted` helper so output is deterministic.

The baseline mirrors the reviewed `opencode` nono groups without importing or invoking nono:

| Group | Relative or absolute paths |
| --- | --- |
| Cross-platform credentials | `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.gcloud`, `~/.kube`, `~/.docker`, `~/.git-credentials`, `~/.netrc`, `~/.npmrc`, `~/.bunfig.toml`, `~/.config/bun/bunfig.toml`, `~/.vault-token`, `~/.credentials`, `~/.secrets`, `~/.keys`, `~/.pki`, `~/.terraform.d`, `~/.config/op` |
| Cross-platform shell history | `~/.bash_history`, `~/.zsh_history`, `~/.history`, `~/.python_history` |
| Cross-platform shell configuration | `~/.zshrc`, `~/.zprofile`, `~/.zshenv`, `~/.zlogin`, `~/.zlogout`, `~/.bashrc`, `~/.bash_profile`, `~/.bash_login`, `~/.bash_logout`, `~/.profile`, `~/.config/fish`, `~/.env`, `~/.envrc` |
| macOS keychains/password stores | `~/Library/Keychains`, `/Library/Keychains`, `~/.password-store`, `~/.1password`, `~/Library/Group Containers/2BUA8C4S2C.com.1password`, `~/Library/Application Support/1Password`, `~/Library/Containers/com.1password.1password` |
| macOS browser data | `~/Library/Application Support/Google/Chrome`, `~/Library/Application Support/Chromium`, `~/Library/Application Support/Firefox`, `~/Library/Application Support/Microsoft Edge`, `~/Library/Application Support/Arc`, `~/Library/Application Support/BraveSoftware`, `~/Library/Application Support/Vivaldi`, `~/Library/Application Support/com.operasoftware.Opera`, `~/Library/Safari` |
| macOS private data | `~/Library/Messages`, `~/Library/Mail`, `~/Library/Cookies`, `~/Library/Containers/com.apple.Safari`, `~/Library/Application Support/MobileSync` |
| Linux keychains/password stores | `~/.password-store`, `~/.1password`, `~/.op`, `~/.local/share/keyrings` |
| Linux browser data | `~/.config/google-chrome`, `~/.config/chromium`, `~/.mozilla/firefox`, `~/.config/microsoft-edge`, `~/.config/BraveSoftware`, `~/.config/vivaldi`, `~/.config/opera` |

The alternative of reading a nono profile at runtime is rejected because nono is optional, profiles can be user-modified, profile parsing would add a compatibility/trust dependency, and a versioned list is easier to audit and test. The alternative of a strict deny-home/allow-known-path model is rejected because it would reintroduce the local MCP runtime failures that motivated compatibility mode.

### 2. Reject all deny/read-grant overlap before launch

The runtime receives a combined `allowRead` list made from existing `readOnlyPaths` and `readWritePaths`. Because an allow grant can re-enable access within a denied region, the policy builder will compare every protected path with every required read grant in both containment directions. Any exact match, protected ancestor, or required-grant ancestor conflict will throw an actionable policy-construction error. This is intentionally stricter than relying on platform-specific deny precedence and keeps the policy portable to Linux.

The same check will cover the active workspace, executable/PATH entries, OpenCode config/auth paths, state/cache/temp paths, runtime caches, and temporary paths. Existing `assertNarrowPath` write protections remain unchanged. The builder will not silently remove a required grant or broaden another grant to repair a conflict.

### 3. Keep Windows as an unsupported capability, not a partial policy

`loadChatSandboxSettings` already forces `enabled` false when the runtime reports an unsupported platform, and `OpenCodeAgent.connect()` independently checks `SandboxManager.isSupportedPlatform()` before invoking the sandbox runtime. `ToolConfigPanel` already disables changes when `status.supported` is false and renders the localized unsupported message. No Windows policy entries or UI redesign will be added in this change. This avoids claiming that a `denyRead` array is effective when the pinned runtime has no Windows backend.

### 4. Verify policy construction separately from runtime enforcement

Unit tests will assert exact platform-specific path construction, normalization, deterministic ordering, absence of Windows entries, and fail-closed overlap handling. Agent tests will assert that a supplied deny list reaches `SandboxRuntimeConfig` while unsupported platforms still bypass runtime initialization. The existing opt-in macOS/Linux runtime integration will exercise an existing denied path, workspace access, and inheritance by a nested local-MCP-like child; it will remain gated by `OPENCODE_CHAT_RUN_SANDBOX_INTEGRATION=1`.

This split avoids depending on the developer machine's real home contents for unit tests while still testing the OS runtime boundary when explicitly requested.

## Risks / Trade-offs

- **[Static list drift]** New applications or credential stores may not be covered. → Keep the list versioned, documented, and easy to extend without changing the compatibility architecture.
- **[Linux missing-path semantics]** The Linux backend may only install deny rules for paths available during sandbox initialization. → Pass the complete static list to the backend, document the limitation, and test existing protected roots in opt-in integration coverage.
- **[Compatibility regressions]** A runtime may legitimately need a protected path. → Fail with a visible overlap error instead of silently weakening the deny rule; users can explicitly turn Chat sandboxing off.
- **[Incomplete confidentiality]** Broad reads outside the baseline and unrestricted network mode can still expose and transmit data. → Keep the security documentation explicit that this is a targeted defense-in-depth baseline, not strict confidentiality.
- **[Platform mismatch]** Applying macOS or Linux paths on Windows would create false assurance. → Return no Windows baseline and retain the existing unsupported status and unsandboxed fallback.

## Migration Plan

No user migration or data migration is required. Existing `inherit`, `on`, and `off` settings continue to resolve as before on supported platforms, except that reads within the new baseline are denied when the sandbox is active. Existing workspaces and MCP configurations remain readable outside the baseline. If a required path conflicts, the sandbox launch reports the policy error; selecting Chat sandbox `off` restores the prior unsandboxed behavior.

Rollback is configuration-first by selecting `off` or restoring inheritance with the native sandbox disabled. A code rollback removes the deny-baseline constants and overlap check while leaving the existing launch plumbing and dependency unchanged.

## Open Questions

None. Windows behavior, the baseline categories, overlap handling, and the compatibility/security trade-off are specified for this change.
