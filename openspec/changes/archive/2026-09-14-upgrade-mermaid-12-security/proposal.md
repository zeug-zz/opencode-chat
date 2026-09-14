## Why

Mermaid 12 is required for forward compatibility, but its transitive `lodash-es` dependency is currently blocked by a high-severity code-injection advisory. The upgrade must resolve that audit failure without weakening the webview's existing diagram-rendering security controls.

## What Changes

- Upgrade the webview Mermaid runtime from v11 to v12 and accept Mermaid 12's current rendering defaults.
- Pin the transitive `lodash-es` dependency to an audited version through the root pnpm override, without changing the project's audit threshold or suppressing advisories.
- Preserve the existing strict Mermaid configuration, SVG sanitization boundary, source preservation, cancellation, timeout, and user-facing error behavior.
- Add regression coverage that confirms the Mermaid v12 integration continues to render supported diagrams through the existing secure renderer.

## Capabilities

### New Capabilities
- `mermaid-diagram-rendering`: Secure rendering of Mermaid fenced code blocks in the VS Code webview, including dependency compatibility and failure behavior.

### Modified Capabilities
- None.

## Impact

- Affected code: `packages/platforms/vscode/package.json`, root `package.json`, `pnpm-lock.yaml`, Mermaid rendering helper/tests, and third-party notices if generated dependency metadata changes.
- **BREAKING**: Mermaid 12 may change the default layout, appearance, and supported browser/runtime baselines. This change intentionally accepts those future-compatible defaults rather than preserving Mermaid 11 visual output.
- Security: resolves the high-severity `lodash-es` advisory without reducing audit enforcement or relaxing Mermaid/webview sanitization settings.

## Non-goals

- Do not preserve Mermaid 11's legacy layout, theme, or appearance defaults.
- Do not relax `securityLevel: "strict"`, DOMPurify SVG restrictions, CSP assumptions, or the dependency audit policy.
- Do not redesign the Markdown renderer or add new diagram syntax beyond what Mermaid 12 supports.

## Risks and fallback

Mermaid 12 can alter diagram appearance or reject syntax that previously rendered. Focused renderer tests and the full webview suite will validate integration; reverting the dependency and lockfile update restores Mermaid 11 if an unacceptable regression is discovered.