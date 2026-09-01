## Why

The compatibility Chat sandbox currently permits broad filesystem reads so arbitrary local MCP runtimes can start, but that also leaves common credential, browser, keychain, and shell-configuration data readable by the sandboxed companion and its descendants. Add a static, auditable read-deny baseline for the supported macOS and Linux backends without returning to MCP-specific allowlists or requiring nono to be installed.

## What Changes

- Add a versioned static `denyRead` baseline for supported macOS and Linux Chat sandbox launches, derived from nono's general sensitive-data deny groups.
- Deny common credential stores, shell history/configuration, browser data, and platform-specific keychain/private application data while retaining compatibility reads for arbitrary MCP runtimes and dependencies elsewhere.
- Normalize, deduplicate, and deterministically order derived deny paths from the effective home directory and platform.
- Reject deny/read-grant overlaps so required workspace, executable, OpenCode, cache, and temporary paths cannot accidentally re-allow protected data; preserve the existing constrained-write policy.
- Keep Windows unsupported: an explicit Chat sandbox request reports the existing unsupported status, leaves the sandbox inactive, and uses the existing unsandboxed launch path. Do not add Windows deny paths or claim Windows enforcement.
- Add focused policy, launch, unsupported-platform, and opt-in runtime inheritance coverage.
- Document that the baseline reduces accidental sensitive-data exposure but is not a strict confidentiality boundary, especially when network access is enabled.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-agent-sandbox`: Change the compatibility filesystem contract to include a static platform-aware read-deny baseline while preserving broad reads for non-protected runtime dependencies, constrained writes, inherited MCP restrictions, and unsupported Windows behavior.

## Scope

This change covers the extension-owned companion process tree launched through `@vscode/sandbox-runtime` on macOS and Linux. It covers policy construction, runtime mapping, tests, and user-facing/specification documentation for the read-deny baseline.

## Non-Goals

- Installing, invoking, parsing, or discovering a nono profile at runtime.
- Adding a Windows sandbox backend or Windows-specific enforcement before the dependency supports it.
- Replacing compatibility mode with a complete strict filesystem confidentiality model.
- Adding per-MCP exceptions, credential brokers, domain allowlists, or changes to the independent OpenCode TUI.
- Expanding agent-level permissions or changing the Scout/Build or terminal-handoff boundaries.

## Impact

Affected areas include `packages/platforms/vscode/src/chat-sandbox-policy.ts`, the OpenCode agent launch-policy tests and runtime integration coverage, the existing Windows capability/status tests, the root and VS Code package security documentation, and the `chat-agent-sandbox` OpenSpec delta. The existing `denyReadPaths` launch plumbing and pinned `@vscode/sandbox-runtime` dependency remain in place; no new runtime dependency is required.

## Risks and Fallback

A static baseline can become incomplete as operating systems and applications change, and Linux enforcement can only deny paths available to the backend when the sandbox initializes. If a protected deny path overlaps a required grant, policy construction must fail closed with an actionable error rather than broaden access. Users can explicitly select Chat sandbox `off` to return to the existing unsandboxed behavior; unsupported Windows continues to report unavailable rather than claiming protection.

## Compatibility Impact

Supported macOS and Linux users retain broad reads for ordinary MCP runtimes and dependencies, existing workspace/runtime write paths, network controls, process-tree inheritance, and lifecycle behavior. Reads within the protected baseline will fail inside the sandbox. Windows behavior remains unchanged: sandbox activation is refused with an unsupported status and Chat uses the existing unsandboxed launch path.
