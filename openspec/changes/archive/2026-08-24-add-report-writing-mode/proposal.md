## Why

OpenCode Chat currently exposes a user-facing `write` label backed by the full OpenCode `build` agent, but its behavior remains oriented toward general software development. Users need a safer report-authoring mode that can research and write requested files without turning the chat companion into a coding shell; serious coding should continue through the existing terminal handoff.

## What Changes

- Add a report-writing behavior for the user-facing `write` mode while retaining the internal `build` compatibility value.
- Give Write a dedicated system prompt for research, source evaluation, report drafting, citations, and controlled file output.
- Constrain the companion Write agent to read, workspace search, web research, and edit capabilities; deny agent-level Bash and task/subagent execution.
- Remove the chat webview shell-mode escape path, including `!` command dispatch, so terminal handoff is the only coding escape hatch.
- Preserve the existing handoff flow to an independent OpenCode TUI session.
- Ensure normal sends and edit/resend flows preserve the selected Write mode and its prompt behavior.
- Update user-facing descriptions, stale documentation, specifications, and focused tests.

## Capabilities

### New Capabilities

- `report-writing-mode`: Research-oriented report drafting and file-writing behavior with constrained tools and explicit terminal handoff boundaries.

### Modified Capabilities

- `primary-agent-selection`: Extend the existing chat/write selection contract with Write-specific prompt routing, permission behavior, and mode preservation across message flows.

## Impact

- **Webview:** agent selector description, shell-mode UI and dispatch removal, mode-aware send/edit behavior.
- **Extension host:** companion prompt loading and routing, defensive rejection/removal of direct shell requests, and edit/resend forwarding.
- **OpenCode integration:** companion-scoped read, search, web, and edit permissions for the Build-backed Write mode; no user or project `opencode.json` mutation.
- **Documentation and specs:** `CHAT_SYSTEM.md`, a new Write prompt, security guidance, primary-agent requirements, and report-writing requirements.
- **Tests:** webview scenarios, host protocol tests, OpenCode agent configuration tests, and strict OpenSpec validation.

## Scope and Non-goals

- Scope is limited to the VS Code companion process and its webview protocol.
- The independent OpenCode TUI and its normal Build behavior are not changed.
- This change does not add report templates, document conversion, publishing, or a new provider/model abstraction.
- This change does not grant Write unrestricted shell, task, commit, push, or deployment capabilities.

## Risks and Fallback

- A permission or prompt-routing regression could make Write unable to save reports or accidentally expose coding tools. Mitigate with companion configuration tests, host routing tests, and a focused end-to-end scenario.
- Existing sessions may contain internal `build` selections. Keep `primaryAgent: "build"` on the wire and treat `write` as the user-facing label to preserve compatibility.
- If a report requires shell tooling, the supported fallback is the existing terminal handoff, not a hidden shell path in the companion.

## Compatibility Impact

The public webview-to-host payload continues to use the internal `build` agent identifier. Scout remains the default read-only chat agent and retains its existing prompt and permissions. The only removed companion capability is direct shell-mode execution from the chat UI/protocol; the terminal handoff remains available.
