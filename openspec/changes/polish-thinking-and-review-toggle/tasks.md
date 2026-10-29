# Tasks

- [x] 1.1 Update `ReasoningPartView` to render model thinking through the existing sanitized `TextPartView` Markdown pipeline; preserve streaming, expand/collapse, show-all, and muted compact styling. Keep `ReasoningAssistRow` statuses plain localized text. Add focused webview tests for sanitized Markdown, streaming updates, visibility controls, and unchanged plain statuses. Verify with `pnpm --filter opencode-scribe exec vitest run --config vitest.config.ts <focused webview tests>` from the repository root. (Requirement: Model thinking is rendered as sanitized Markdown)
- [x] 1.2 Add the compact brain-outline control in the input area's `contextBar` right slot. Reuse the existing `userEnabled` callback and host synchronization; add localized on/off and opt-out tooltip text plus `aria-pressed`. Cover runtime visibility, unloaded-preference disabled state, opt-out disabled state, toggle behavior, and authoritative synchronization with focused webview tests. Verify with `pnpm --filter opencode-scribe exec vitest run --config vitest.config.ts <focused webview tests>` from the repository root. (Requirement: Quick reasoning-review toggle uses the existing preference)
- [x] 2.1 Run `pnpm test`, `pnpm run check`, `pnpm run build`, and `openspec validate polish-thinking-and-review-toggle --strict` from the repository root. (Requirements: Model thinking is rendered as sanitized Markdown; Quick reasoning-review toggle uses the existing preference)

## Verification

- Builder tier: haiku for UI tasks 1.1 and 1.2.
- **Primary full-gate evidence (2026-10-30):** `pnpm test:all`, `pnpm run check`, `pnpm run build`, and `openspec validate polish-thinking-and-review-toggle --strict` passed; see migration `reports/return-to-desk-checklist.md` for counts and logs. The previous lint blocker below is historical and superseded by this full-gate run.
- Primary verification: `pnpm test` passed (86 files, 1918 tests); `pnpm run build` passed; `openspec validate polish-thinking-and-review-toggle --strict` passed.
- Full `pnpm run check` is blocked by concurrent unrelated formatting/import errors in `src/__tests__/reasoning-assist-provider-composition.test.ts` and `src/vibefeld/reasoning-diagnostics.ts`; those files were not modified.
- UI-scoped Biome check passed. VSIX packaging was not run, as explicitly requested.
