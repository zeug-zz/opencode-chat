## Context

The webview stores the selected primary agent in `App.tsx` as `selectedPrimaryAgent`. When the extension host sends an `agents` message, the current handler sets this state to the first agent whose mode is `primary` or `all` if no previous selection exists. Because opencode typically returns `build` before `plan`, OpenCodeGUI initializes to Build mode.

## Goals / Non-Goals

**Goals:**

- Make `plan` the initial primary-agent selection when the opencode agent list includes an eligible `plan` agent.
- Keep the existing fallback for environments without an eligible `plan` agent.
- Preserve explicit user selection in the current webview session.
- Keep the change localized to existing webview state initialization.

**Non-Goals:**

- Add a new user setting or `opencode.json` default-agent field.
- Persist primary-agent selection across webview reloads.
- Change agent-list retrieval, agent selector rendering, or prompt transport contracts.

## Decisions

- Prefer exact `name === "plan"` among agents whose mode is `primary` or `all`.
  - Alternative considered: sort all primary agents. Rejected because it would reorder custom agent behavior more broadly than needed.
  - Alternative considered: add a VS Code setting. Rejected for this slice because option B is intentionally the smallest product-default change.
- Keep the existing `if (prev) return prev` guard before any default lookup.
  - This preserves current in-memory user choice and avoids changing behavior after the first initialization.
- Keep fallback to the first `primary`/`all` agent.
  - This preserves compatibility for opencode versions or custom configurations without `plan`.

## Risks / Trade-offs

- Exact-name matching is intentionally narrow; a custom renamed planning agent will not be auto-preferred. The existing fallback covers those environments without guessing.
- Users expecting Build by default will see Plan when available. The primary-agent selector still allows manual switching, and this change is limited to initial selection.

## Migration Plan

- No migration required. The selected primary agent is not persisted.
- Rollback by restoring the current single first-agent lookup in `App.tsx`.

## Open Questions

- None for option B. A future change may add configurable default-agent selection if product direction changes.
