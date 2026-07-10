<!-- context7 -->
Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Resolve library: `npx ctx7@latest library <name> "<user's question>"` — use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question)
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<user's question>"`
4. Answer using the fetched documentation

You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format. Use the user's full question as the query -- specific and detailed queries return better results than vague single words. Do not run more than 3 commands per question. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use `/org/project/version` from the `library` output (e.g., `/vercel/next.js/v14.3.0`).

If a command fails with a quota error, inform the user and suggest `npx ctx7@latest login` or setting `CONTEXT7_API_KEY` env var for higher limits. Do not silently fall back to training data.
<!-- context7 -->

# OpenCode Chat — AGENTS.md

Unofficial VS Code chat companion for OpenCode. Forked from ktmage/opencode-gui.
Repository: https://github.com/zeug-zz/opencode-chat
Extension ID: `zeug-zz.opencode-chat`

## Project structure

```
packages/
  platforms/vscode/          # VS Code extension (extension host + webview)
    src/                     # Extension host code (ChatViewProvider, platform services)
    webview/                 # React webview (Vite)
      components/            # React components (atoms, molecules, organisms)
      hooks/                 # React hooks
      contexts/              # React context providers
      __tests__/             # Tests (Vitest + Testing Library)
        scenarios/           # Integration/end-to-end scenario tests
        components/          # Component unit tests
        hooks/               # Hook unit tests
        utils/               # Utility tests
  core/                      # Shared types and interfaces
```

## Commands

```sh
npm install                  # Install dependencies
npm run build                # Build extension + webview
npm test                     # Run all tests (webview scenarios, components, hooks, utils)
npm run test:all             # Run all tests + extension host tests
npm run check                # Biome lint + format check
npm run check:fix            # Biome auto-fix
```

To package into VSIX:
```sh
cd packages/platforms/vscode
npm run package              # creates opencode-chat-<version>.vsix
code --install-extension opencode-chat-<version>.vsix --force
```

## Code conventions

- **Lint/format:** Biome v2 (no ESLint, no Prettier). Run `npm run check` before committing.
- **Tests:** Vitest + Testing Library. Scenario tests in `webview/__tests__/scenarios/`, component tests in `__tests__/components/`, hook tests in `__tests__/hooks/`. Extension host tests use their own vitest config (`vitest.config.ext.ts`).
- **TypeScript:** Strict mode. No `any` unless justified.
- **Webview→Host communication:** `postMessage({ type: string, ... })` from webview, `webview.onDidReceiveMessage` switch in `chat-view-provider.ts`.
- **i18n:** Keys in `webview/locales/{en,ja,...}.ts`. Use `useLocale()` hook for translations.
- **VS Code API:** Use `vscode` namespace directly (no abstraction layer between extension host and VS Code APIs).
- **React:** Functional components, hooks, no class components. State management via React context + hooks.
- **No comments:** Do not add comments to code unless explicitly requested.

## Documentation Source Hierarchy (Doc Contract)

1. `AGENTS.md` — stable repo standards and workflow
2. `openspec/changes/*` — active change truth
3. `adrs/` — durable architecture decisions (status-tracked, AGENTS-aligned)
4. `memory-bank/` — deprecated optional legacy context (non-authoritative)

## Recent Changes

### 2026-07-10: Model Effort Menu + Toolbar Density (archived: `2026-07-10-add-model-effort-menu`)

Dedicated effort control for models that advertise variants; keeps sticky per-model selection and `Ctrl+T`.

**UI** (`webview/components/molecules/ModelEffortSelector/` + `InputArea.tsx`):
- Capability-gated effort menu (`Default` + advertised variants) beside the model selector
- Effort value moved out of the model-selector label (no more `Model · Low` suffix)
- Tighter toolbar spacing; progressive hide of secondary tools as the chat pane narrows
- Popovers portaled to `document.body` with fixed positioning so `overflow: hidden` on the toolbar no longer clips menus

**State** (`webview/hooks/useProviders.ts`):
- Exposes shared `selectedModelVariants` from authoritative provider metadata (+ connected fallback)
- Existing `modelEffortByModel` persistence / validation / cycle-to-default semantics unchanged

**OpenSpec**: archived to `openspec/changes/archive/2026-07-10-add-model-effort-menu/`; main spec synced at `openspec/specs/model-effort-control/spec.md`.

**Verified**: webview tests green, Biome clean, build + VSIX package install.

### 2026-07-10: Switch Chat Agent to Scout (archived: `2026-07-10-switch-chat-agent-to-scout`)

Chat companion primary agent moved from OpenCode `plan` to `scout`.

**UI / host**:
- Agent selector allowlist `scout` + `build`; `scout` displays as `chat`
- Default primary-agent init prefers eligible `scout`, else first primary/all
- Extension host injects `CHAT_SYSTEM.md` only when `primaryAgent === "scout"`
- Chat system prompt wording no longer frames as plan mode

**OpenSpec**: archived to `openspec/changes/archive/2026-07-10-switch-chat-agent-to-scout/`; main spec synced at `openspec/specs/primary-agent-selection/spec.md`.

### 2026-07-06: Streaming Reasoning CoT Fix (archived: `2026-07-06-stream-reasoning-cot`)

Streaming reasoning/chain-of-thought display for thinking models (DeepSeek V4 Pro, Kimi, GLM).

**Events handled**: `session.next.reasoning.started`, `session.next.reasoning.delta`, `session.next.reasoning.ended`, `message.part.delta` (server-assigned `prt_*` part IDs).

**Key implementation** (`packages/platforms/vscode/webview/hooks/useMessages.ts`):
- Dual-stream reasoning: `reasoningBuffers` (transient `session.next.reasoning.*` IDs) and `deltaBuffers` (server `prt_*` IDs from `message.part.delta`)
- Canonical reasoning part ID per `sessionID:assistantMessageID` — first `reasoningID` becomes display anchor
- Monotonic text via `getLongestText()` — no event can shrink reasoning text
- `reasoningMessageKeys` Set skips `message.part.updated` snapshots for managed messages
- `mergeSnapshotPreservingReasoning` wrapper on public `setMessages` — preserves managed reasoning text and active `deltaBuffers` entries across full host `messages` snapshot replacement
- `activeReasoningMessageKeys` + 5s post-ended grace window for snapshot omission
- rAF throttling for both reasoning and text delta flushes (coalesce into one render per frame)

**Streaming-safe DOM** (`packages/platforms/vscode/webview/components/organisms/MessageItem/MessageItem.tsx`):
- `ReasoningPartView` uses stable `<div ref>` + `useLayoutEffect` / `textContent` for streaming updates (mirrors `TextPartView` pattern)
- Collapsed by default; spinner + "Thinking…" while active, info icon + "Thought" when complete

**Scroll fix** (`packages/platforms/vscode/webview/hooks/useAutoScroll.ts`):
- Switched scroll effect from `useEffect` to `useLayoutEffect` (pre-paint scroll)

**Agent fix** (`packages/agents/opencode/src/`):
- Switched event subscription from `/event` to `/global/event` (matches TUI)
- V2Event format normalization: copy `data` → `properties` in `mapEvent()`

**Results**: 1715 tests pass, Biome clean, builds green. Live verified with thinking models — no flicker/blanking.
