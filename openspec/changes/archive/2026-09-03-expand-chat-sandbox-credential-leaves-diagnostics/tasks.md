## 1. Protected credential baseline

- [x] 1.1 Extend the supported macOS/Linux static protected-read baseline with `.claude.json`, `.claude/.credentials.json`, `.codex/auth.json`, `.gemini/oauth_creds.json`, `.electrum`, `.android/adbkey`, and `.android/adbkey.pub`; update focused policy tests to verify normalized deterministic platform behavior, Windows omission, non-conflicting OpenCode authentication/runtime grants, and rejection of broad-parent substitutions. Verify with `npm run test:ext -- src/__tests__/chat-sandbox-policy.test.ts` from `packages/platforms/vscode` and `npm exec biome check src/chat-sandbox-policy.ts src/__tests__/chat-sandbox-policy.test.ts` from that package.

## 2. Host-side denial diagnostics

- [x] 2.1 Add bounded, redacted extension-host logging for supported sandbox startup/readiness failures, unexpected companion exits, and failed MCP operations when denial information is available; preserve existing user-visible diagnostics, transport attribution, fail-closed behavior, and opaque-error semantics. Add focused tests for operation/stage context, exposed denial reasons, redaction, bounded output, and no unsandboxed fallback. Verify with `npm test -- src/__tests__/opencode-agent.test.ts` from `packages/agents/opencode` and `npm exec biome check src/opencode-agent.ts src/__tests__/opencode-agent.test.ts` from that package.

## 3. Security documentation

- [x] 3.1 Update `SECURITY.md`, `README.md`, and `packages/platforms/vscode/README.md` to describe the newly protected credential leaves, host-side bounded/redacted denial diagnostics, the explicit OpenCode-auth compatibility exception, and the unchanged compatibility-sandbox limitations. Verify all three documents contain consistent claims and run `git diff --check`.
