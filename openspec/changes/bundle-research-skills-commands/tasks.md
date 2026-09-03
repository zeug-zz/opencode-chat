## 1. Guidance source and resource model

- [x] 1.1 Generalize only the product-specific memory and indexing references in the reviewed `skills-commands/` Markdown, using generic durable-memory-update and indexing/retrieval language while preserving the existing MCP capability routing, optional-tool recommendations, fallback behavior, provenance rules, and command intent; verify with a focused content audit and `git diff --check`
- [x] 1.2 Add an allowlisted, deterministic bundled-resource manifest and loader for the four skills and five commands, including validated names, descriptions, command frontmatter/templates, isolated malformed-resource handling, and bounded diagnostics; verify with focused unit tests for valid resources, missing resources, malformed frontmatter, deterministic ordering, and no out-of-bundle paths

## 2. Extension packaging

- [x] 2.1 Stage the canonical `skills-commands/` resources into the generated VSIX output during the documented build path without committing generated output or copying anything into a workspace; verify a clean build produces all nine expected packaged Markdown paths and fails or reports a bounded error for a missing required source file
- [x] 2.2 Add a VSIX archive smoke test or equivalent packaging verification that confirms the staged skills and commands are inside the extension-owned resource root and that the archive contains no workspace `.opencode` resource requirement; verify with the package command and archive listing

## 3. Companion configuration and sandbox access

- [x] 3.1 Extend the process-scoped OpenCode launch overlay so both unsandboxed and sandboxed Chat companions receive the installed-extension skill discovery path and validated inline command definitions without changing global/project configuration or independent TUI behavior; verify with focused agent tests covering overlay parity, argument templates, ordinary prompts, and no config-file writes
- [x] 3.2 Add the packaged skill directory as a narrow normalized read-only sandbox grant when native discovery is active, preserving existing deny-read overlap checks, write containment, Windows behavior, and fail-closed startup; verify with focused macOS/Linux/Windows policy tests and sandbox launch tests

## 4. Host and protocol integration

- [x] 4.1 Expose validated bundled command metadata and source/type information to the webview while preserving the existing native skill list and message compatibility; verify host/protocol tests for initialization, deterministic metadata, unavailable resources, and unchanged native skill behavior
- [x] 4.2 Add explicit bundled-command invocation handling that applies only the selected command template and typed arguments, retains the selected Scout/Build boundary, and never injects the full guidance corpus into ordinary sends; verify focused host/agent tests for skill selection, command selection, arguments, explicit system overrides, and repeated messages

## 5. Slash-picker experience

- [x] 5.1 Extend the existing slash picker to show bundled skills and commands with distinct type labels, descriptions, filtering, keyboard selection, chips, clearing, and send behavior; verify component and scenario tests for both types, filtering, selection, command arguments, and no workspace file creation

## 6. Documentation and release metadata

- [x] 6.1 Add a clearly labelled optional research-integrations subsection under the VSIX README Requirements section naming context-mode, Firecrawl, Brave Search, PDF readers, paper search, and Playwright as user-installed optional tooling; preserve the statement that these tools are not extension dependencies and verify the README content audit
- [x] 6.2 Update root and extension package release metadata and changelogs for target version `0.9.0`, including the bundled guidance capability and already-completed difit removal without restoring difit integration; verify both manifests agree and the changelog entries are consistent

## 7. Final verification

- [x] 7.1 Run strict OpenSpec validation, the focused resource/config/sandbox/host/UI tests, `npm run check`, `npm run test:all`, `npm run build`, and the VSIX package/archive smoke test; verify the final diff is scoped, `git diff --check` passes, and no generated scratch artifacts or workspace resource copies are present
