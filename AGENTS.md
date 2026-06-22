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
