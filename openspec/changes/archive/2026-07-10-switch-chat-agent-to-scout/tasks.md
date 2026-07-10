## 1. Scout Chat Agent Wiring

- [x] 1.1 Switch chat-mode wiring from Plan to Scout in the webview selector, default primary-agent initialization, extension-host chat system prompt injection, chat system prompt wording, and focused tests. Verify with `npm test -- --run packages/platforms/vscode/webview/__tests__/scenarios/01-initialization.test.tsx` and any relevant chat-view-provider tests.

## 2. Validation

- [x] 2.1 Run final validation for the change: `openspec validate "switch-chat-agent-to-scout" --strict`, `npm run check`, and focused or full tests appropriate to the touched files.
