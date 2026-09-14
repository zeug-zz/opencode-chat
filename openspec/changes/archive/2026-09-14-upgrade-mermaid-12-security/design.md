## Context

The webview imports Mermaid statically because dynamic imports are incompatible with VS Code webview CSP. Its helper already renders in a private scratch element, returns SVG for caller-owned DOMPurify sanitization, uses Mermaid `securityLevel: "strict"`, disables HTML labels, and preserves cancellation, timeout, and concise error behavior.

Mermaid 12 introduces a new rendering baseline and brings `lodash-es` into the transitive graph through Chevrotain. The audit identifies `lodash-es` versions through 4.17.23 as high severity and requires 4.18.0 or later.

## Goals / Non-Goals

**Goals:**
- Upgrade Mermaid to the current v12 release path and make its dependency graph pass the existing high-severity audit.
- Preserve the existing CSP-compatible import strategy and diagram-rendering security invariants.
- Validate the secure renderer and Markdown integration against the upgraded dependency.

**Non-Goals:**
- Emulating Mermaid 11's default layout, look, or browser/runtime support.
- Changing Mermaid's strict security configuration, DOMPurify policy, audit level, or user-facing source/error behavior.
- Refactoring Markdown rendering or adding Mermaid-specific product features.

## Decisions

### 1. Accept Mermaid 12 rendering defaults

Use Mermaid v12 as delivered rather than configuring legacy `dagre`, theme, or classic appearance compatibility. The user selected future compatibility over visual emulation, avoiding a permanent compatibility layer that would mask the new supported baseline.

**Alternative considered:** Configure Mermaid 11-like layout/theme defaults. Rejected because it would preserve an outdated behavior contract and complicate future Mermaid upgrades.

### 2. Resolve `lodash-es` through a root pnpm override

Add the narrow `lodash-es: "^4.18.0"` root override and regenerate the lockfile. The audited vulnerable path is Mermaid → Chevrotain → lodash-es; the override retains Mermaid's declared dependency graph while forcing a patched compatible version.

**Alternative considered:** Suppress the advisory or lower `pnpm audit` enforcement. Rejected because it weakens the repository's security posture. Waiting for an upstream Mermaid/Chevrotain release is also rejected because a patched compatible version is available now.

### 3. Preserve the secure integration contract

Retain the static Mermaid import, strict Mermaid configuration, private scratch rendering container, SVG sanitization in `TextPartView`, disabled external links/images, cancellation, timeout, and source/error fallbacks. The dependency migration must adapt only to an observed Mermaid v12 API incompatibility; it must not relax these controls.

**Alternative considered:** Use Mermaid's default container rendering path. Rejected because it can mutate the document outside the caller-controlled sanitization/insertion boundary.

## Risks / Trade-offs

- **Mermaid 12 changes default diagram layout and appearance** → This is an accepted breaking behavior; tests validate rendering, source preservation, and failure handling rather than pixel-matching Mermaid 11 output.
- **Mermaid 12 requires newer runtime/browser capabilities** → The bundled webview is built and tested with the repository's supported toolchain; packaging and full test checks detect incompatible dependencies.
- **A transitive override can become stale** → Keep it narrow, documented in the manifest, and validate it via the committed lockfile plus `pnpm audit`.
- **Mermaid API changes can break the helper** → Run focused helper/component tests and the full suite; make only minimal source/test compatibility adjustments if an actual failure demonstrates they are necessary.

## Migration Plan

1. Update Mermaid and the root `lodash-es` override, then regenerate the lockfile with the repository pnpm version.
2. Run focused Mermaid helper and Markdown component tests, then the full test, check, build, and high-severity audit commands.
3. Review the resolved lockfile path to confirm `lodash-es >= 4.18.0` and preserve all security controls.
4. If validation fails or unacceptable rendering regressions are found, revert the Mermaid manifest, override, and lockfile changes together to restore Mermaid 11.