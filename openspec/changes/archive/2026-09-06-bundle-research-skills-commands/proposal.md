## Why

OpenCode Research already has research and report-writing guidance in `skills-commands/`, but those resources are not available to the packaged companion. Users must currently maintain or copy guidance into project configuration, and the Chat UI cannot invoke the bundled command templates. This change makes the guidance extension-owned, available on demand to Chat and its agents, without adding the full guidance corpus to every prompt or requiring workspace files.

## What Changes

- Package the current research skills and command Markdown files with the VSIX through extension-local build staging.
- Configure the companion with an absolute extension-local skill path through the existing in-memory OpenCode configuration overlay.
- Register bundled command templates in memory so users can invoke them without `.opencode/command` files in the workspace.
- Add bundled skills and commands to the existing `/` picker with clear type distinction and collision handling.
- Load skill and command bodies only when selected or invoked; do not append the full corpus to ordinary Chat or Write prompts.
- Preserve optional, capability-oriented MCP guidance and tool recommendations; do not add MCP/provider dependencies or configuration writes.
- Generalize only product-specific memory and indexing references in the bundled guidance, while otherwise preserving its existing routing, fallback, and optional-tool wording.
- Add the extension-local resource directory as a narrow sandbox read-only grant when native skill discovery needs it; never grant it write access or copy resources into a workspace.
- Document optional research integrations in the VSIX README Requirements section, including context-mode, Firecrawl, Brave Search, PDF readers, paper search, and Playwright.
- Prepare the next feature release metadata, including the root and extension package versions and changelogs; target version `0.9.0` because the picker and bundled guidance are user-visible functionality. The already-completed difit removal remains included in the release and is not restored.

## Capabilities

### New Capabilities

- `bundled-research-guidance`: Extension-owned research skills and command templates that are discoverable and invocable on demand by users and available to the companion agent without workspace copying or per-message prompt bloat.

### Modified Capabilities

- `openspec/specs/chat-agent-sandbox/spec.md`: Permit the packaged extension guidance directory as a narrow non-workspace read-only compatibility grant while preserving sandbox write restrictions, deny-read protections, and fail-closed behavior.

## Impact

- Affected extension packaging/build staging, extension-host launch configuration, OpenCode agent configuration overlays, sandbox filesystem policy, core/UI protocol types, slash-picker components, and focused tests.
- The VSIX gains a small static Markdown resource set and the extension package version advances beyond the currently published `0.8.1`.
- Existing user OpenCode configuration, global/project files, independent TUI processes, and optional MCP installations remain owned by the user and are not modified.
- If recommended external tools are unavailable, commands continue through the capabilities and fallback guidance exposed by the current runtime; no bundled tool installation or server-specific exception is required.
