## Context

See `proposal.md` for motivation and scope. The repository keeps the canonical research guidance in the top-level `skills-commands/` directory, while the VSIX package is rooted at `packages/platforms/vscode`. The extension already loads `CHAT_SYSTEM.md` and `WRITE_SYSTEM.md` from its installed extension location, starts an extension-owned OpenCode companion, applies process-scoped configuration overlays in both sandboxed and unsandboxed launches, and exposes native skills through the webview's slash picker.

The installed local OpenCode CLI is version 1.18.26. A read-only runtime probe accepted an absolute `skills.paths` entry and an inline `command` definition through `OPENCODE_CONFIG_CONTENT`, and discovered the bundled skill documents from the repository path. The probe validates the integration direction but the packaged extension path and sandboxed launch still require focused tests.

## Goals / Non-Goals

**Goals:**

- Make the reviewed skills and commands available from the installed extension without workspace copies.
- Preserve optional tool routing and fallback language while removing only product-specific memory and indexing terminology from the bundled documents.
- Make skills and commands discoverable from the existing slash interaction without injecting their bodies into ordinary prompts.
- Keep the companion overlay process-scoped and compatible with the existing MCP, agent, and sandbox boundaries.
- Package and release the feature with the difit removal already present on `main`.

**Non-Goals:**

- Installing, configuring, enabling, or inventing any MCP server or provider.
- Replacing the user's global or project OpenCode configuration or changing independent TUI behavior.
- Adding every bundled skill or command body to `CHAT_SYSTEM.md`, `WRITE_SYSTEM.md`, or every request.
- Creating a workspace `.opencode` resource copy, a host-mediated report writer, or a new coding path.
- Making agents autonomously choose user-facing command templates.
- Rewriting the research guidance beyond the narrowly scoped memory/indexing terminology cleanup.

## Decisions

### 1. Stage canonical resources into the generated extension output

Keep `skills-commands/` as the canonical source and copy the reviewed allowlisted files during the build into a generated directory such as `packages/platforms/vscode/dist/skills-commands/`. The VSIX then contains the generated resources under its own installation root. This avoids source duplication and avoids any runtime write to a user's workspace. The build must fail or report a bounded error when a required source file is missing rather than silently packaging a partial set.

A manifest will define the initial four skills and five commands, their names, and expected relative paths. Resource enumeration and ordering will be deterministic, and only manifest entries will be exposed.

### 2. Use the existing in-memory OpenCode overlay

Add a guidance overlay to the launch configuration and merge it with the existing agent and MCP overlays for both companion launch paths. The overlay will point OpenCode skill discovery at the absolute installed-extension skill directory and provide command definitions whose templates come from validated command Markdown files. It will not set `OPENCODE_CONFIG_DIR`, because redirecting the global config root could hide or interfere with user configuration, authentication, plugins, or commands.

The overlay will be process-scoped. Existing configuration merge behavior must preserve user/project settings and must not write configuration files. Bundled names and user-defined names must have deterministic, tested precedence without replacing user files.

### 3. Keep skill and command bodies lazy

Native skill discovery receives a path and metadata rather than an eagerly concatenated prompt. Inline command templates remain configuration data until the corresponding slash command is invoked. The ordinary request path will continue to pass only the existing Chat or Write system prompt unless the user selected a guidance item or the agent explicitly loads a skill. If a command refers to a skill, the command invocation may resolve only those referenced skills on demand; it must not preload the complete bundle.

### 4. Extend the existing slash picker with a discriminated guidance item

The current skill picker already owns slash-query detection, filtering, descriptions, selection chips, keyboard behavior, and message submission. Add a small source/type distinction so the UI can present bundled skills and commands without pretending that commands are native skills. The host will provide bundled command metadata separately from the native skill list, and the selected item will carry either a skill invocation or a command invocation through the existing message path.

The command invocation will use the current primary-agent selection and will not bypass Scout or Build permissions. Commands are user-triggered shortcuts; the model may use the resulting command prompt and any skills it is allowed to load, but the extension will not add autonomous command routing.

### 5. Keep external tool recommendations optional and capability-based

Retain the existing recommendations for optional research tooling and its language about inspecting the capabilities exposed by the current runtime, bounded evidence, provenance, untrusted content, and fallbacks. The VSIX README will contain a clearly labelled optional integrations subsection naming context-mode, Firecrawl, Brave Search, PDF readers, paper search, and Playwright. The bundled documents will not require those tools or configure them.

Only direct product-specific memory and indexing references will be generalized to terms such as durable memory updates and indexing/retrieval capabilities. MCP-oriented routing remains because it describes an optional capability class, not an installed dependency.

### 6. Grant only the packaged skill directory to the sandbox

When native skill discovery is used in a supported sandbox, pass the installed extension's bundled skill directory as a narrow read-only filesystem grant. Do not grant write access to the extension root, use the workspace as a staging location, or broaden the home-directory grant. The grant participates in the current normalization, deny-overlap, deterministic-order, and fail-closed checks. Commands parsed by the extension host do not need a companion read grant for their Markdown source.

### 7. Treat malformed optional resources as isolated failures

Validate frontmatter, names, descriptions, and command templates before exposing resources. A malformed resource will be omitted with a bounded diagnostic while valid resources and ordinary Chat/Write remain usable. Missing resources will never trigger a workspace copy or an unsandboxed fallback. This keeps a packaging defect visible without making the optional guidance capability a companion startup dependency.

### 8. Release as a feature version

Advance the root and extension package metadata together to `0.9.0`, update both changelogs, and package after the resource staging build. The release contains the already-landed difit removal; no difit dependency or UI is reintroduced.

## Risks / Trade-offs

- **OpenCode schema drift** → Keep the overlay shape version-aware through focused tests against the supported SDK/CLI family, verify the installed 1.18.26 behavior, and omit only the affected optional guidance resource if the runtime rejects it rather than blocking normal Chat.
- **User command or skill name collision** → Preserve user/project configuration ownership, keep source/type metadata, apply deterministic precedence, and cover duplicate-name behavior with tests before packaging.
- **Prompt or environment bloat** → Send only names/descriptions during initialization and load bodies only for an explicit selection or invocation; never concatenate all skills into base prompts.
- **Sandbox cannot read an installed extension path** → Add only the exact packaged skill directory as read-only, test supported macOS/Linux policy construction, and surface a bounded guidance-unavailable state without broadening access.
- **Generated package resources drift from source** → Use one allowlisted manifest, stage resources during every build, and add a VSIX archive smoke test for exact paths and content.
- **Optional MCP tooling is absent or changes** → Preserve capability detection and fallback wording; do not add package dependencies, server definitions, or installation checks.
- **Content cleanup changes intended guidance** → Limit edits to direct product-specific memory/indexing references and review a source diff before packaging.

## Migration Plan

No user migration is required. On upgrade, the extension reads the bundled resources from its new VSIX installation directory and leaves workspace, global OpenCode, provider-authentication, and MCP files untouched. Rollback is removing the guidance overlay, picker entries, generated package resources, and release metadata; existing Chat, Write, sandbox, MCP, and TUI paths remain available without the bundle.
