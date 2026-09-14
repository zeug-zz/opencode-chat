## 1. Dependency security migration

- [x] 1.1 Upgrade the VS Code webview `mermaid` dependency from v11 to v12, add only the root pnpm `lodash-es` override required to resolve version 4.18.0 or later, regenerate the lockfile with pnpm 10.16.0, and verify `pnpm install --frozen-lockfile`, `pnpm audit --audit-level=high`, and the resolved Mermaid dependency path pass without audit suppression.

## 2. Secure renderer compatibility

- [x] 2.1 Run the focused Mermaid helper and TextPartView tests against Mermaid v12; make only minimal source or test compatibility changes required by an observed v12 API failure, preserving static import/CSP compatibility, `securityLevel: "strict"`, disabled HTML labels, caller-owned SVG sanitization, source preservation, cancellation, timeout, and concise error behavior; verify focused tests pass.

## 3. Regression validation

- [x] 3.1 Verify the completed migration with `pnpm --filter opencode-scribe test:all`, `pnpm run check`, `pnpm run build`, `git diff --check`, and a lockfile inspection confirming Mermaid and `lodash-es` resolve to the required versions without unrelated dependency changes.
