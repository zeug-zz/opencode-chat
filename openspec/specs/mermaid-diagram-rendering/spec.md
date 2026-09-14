## Purpose

Provide secure, resilient rendering of Mermaid fenced code blocks in the VS Code webview while keeping the diagram runtime and its transitive dependencies supportable.

## Requirements

### Requirement: Secure Mermaid diagram rendering
The webview SHALL render valid Mermaid fenced code blocks with the supported Mermaid runtime while preserving the existing secure rendering boundary: strict Mermaid security configuration, SVG sanitization before insertion, no external image or link output, source preservation, and non-fatal user-visible errors for invalid or failed diagrams.

#### Scenario: Valid diagram renders through the secure pipeline
- **WHEN** chat Markdown contains a valid Mermaid fenced code block
- **THEN** the webview renders its sanitized SVG in the diagram target and retains the original source for copying

#### Scenario: Diagram rendering fails
- **WHEN** Mermaid rejects a diagram or rendering times out
- **THEN** the webview preserves the original source and displays a concise diagram-specific error without crashing the message view

### Requirement: Future-compatible Mermaid runtime
The webview SHALL use Mermaid v12 or a later compatible release and SHALL accept its documented current rendering defaults rather than emulating Mermaid 11 layout or appearance behavior.

#### Scenario: Mermaid v12 default rendering is used
- **WHEN** a valid Mermaid diagram is rendered without explicit layout or theme directives
- **THEN** its output uses the configured Mermaid v12 runtime behavior without a compatibility shim for Mermaid 11 defaults

### Requirement: Audited Mermaid dependency graph
The package installation SHALL resolve Mermaid's transitive `lodash-es` dependency to version 4.18.0 or later, and the repository's high-severity dependency audit SHALL continue to pass without suppressing the advisory or lowering the audit threshold.

#### Scenario: Dependency audit evaluates the Mermaid graph
- **WHEN** repository dependencies are installed from the committed lockfile and the high-severity audit runs
- **THEN** the Mermaid dependency path does not resolve a vulnerable `lodash-es` version and the audit passes without an exception for that advisory
