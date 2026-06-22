# katex-math-rendering Specification

## Purpose
Defines how the VS Code webview renders inline (`$...$`) and display (`$$...$$`) math
inside assistant chat messages using KaTeX, integrated into the existing Marked pipeline
in `TextPartView` so that downstream sanitization, linkification, and syntax highlighting
operate on the same HTML pass. The underlying `TextPart.text` source is left intact so
the separate "Copy Markdown" workflow can copy the original LaTeX source verbatim.
## Requirements
### Requirement: Inline math rendering

The VS Code webview `TextPartView` SHALL render inline math delimited by single dollar signs (`$...$`) as KaTeX at Markdown parse time.

#### Scenario: Inline math in a paragraph

- **WHEN** an assistant `TextPart.text` contains `Mass–energy equivalence: $E = mc^2$.`
- **THEN** the rendered HTML SHALL contain a KaTeX-rendered `.katex` element for the `E = mc^2` expression
- **AND** the surrounding paragraph text SHALL remain present in the rendered HTML

#### Scenario: Non-standard LaTeX macro

- **WHEN** an assistant `TextPart.text` contains a non-standard LaTeX macro inside `$...$`
- **THEN** the renderer SHALL NOT throw
- **AND** the renderer SHALL fall back to the original source text for the malformed expression

### Requirement: Display math rendering

The VS Code webview `TextPartView` SHALL render display math delimited by double dollar signs (`$$...$$`) as KaTeX block math at Markdown parse time.

#### Scenario: Display math on its own line

- **WHEN** an assistant `TextPart.text` contains `$$\int_0^1 x\,dx = \tfrac{1}{2}$$` on its own line
- **THEN** the rendered HTML SHALL contain a `.katex-display` block element for the expression
- **AND** the block SHALL be wrapped in a `<div class="markdown">` container (not a `<span>`)

#### Scenario: Display math with stacked fraction

- **WHEN** an assistant `TextPart.text` contains a display equation with a stacked fraction
- **THEN** KaTeX's per-element `style="height:...; vertical-align:...;"` attributes SHALL be honored by the webview CSP
- **AND** the fraction SHALL render with the numerator above the denominator (stacked layout)

### Requirement: Marked pipeline integration

The KaTeX transform SHALL be applied during Marked parsing, not after the fact, so that downstream sanitization, linkification, and syntax highlighting operate on the same HTML pass.

#### Scenario: Single parsing pass

- **WHEN** a `TextPart` is rendered
- **THEN** KaTeX rendering SHALL occur exactly once as part of the Marked extension
- **AND** no second DOM-level `katex.render(...)` call SHALL be issued for the same node

#### Scenario: DOMPurify sanitization

- **WHEN** the rendered HTML reaches the existing DOMPurify pass
- **THEN** KaTeX's emitted classes and inline `style` attributes SHALL survive sanitization
- **AND** no KaTeX-specific hooks SHALL be added to the DOMPurify config

### Requirement: Existing Markdown pipeline compatibility

The KaTeX integration SHALL preserve existing Markdown rendering behavior for content without math delimiters.

#### Scenario: Plain Markdown remains unchanged

- **WHEN** an assistant `TextPart.text` contains headings, lists, code fences, and links but no `$` delimiters
- **THEN** the rendered HTML SHALL be byte-for-byte equivalent to the pre-KaTeX pipeline for that input (apart from the wrapper element tag change)

#### Scenario: Code block inside a paragraph

- **WHEN** an assistant `TextPart.text` contains `` `inline code` `` and no math delimiters
- **THEN** inline code SHALL render exactly as it did before the change
- **AND** no KaTeX classes SHALL be introduced

#### Scenario: File-path linkification

- **WHEN** an assistant `TextPart.text` contains a file-path link in a paragraph with inline math
- **THEN** the link SHALL be rewritten to a clickable openFile link as before
- **AND** the math SHALL continue to render as KaTeX

### Requirement: CSS ownership

KaTeX styles SHALL be imported from the webview entry module and the webview CSP SHALL be tightened via a `style-src` split, not by adding `'unsafe-inline'` to `style-src`.

#### Scenario: CSS bundled by Vite

- **WHEN** `pnpm --filter opencode-chat build` is run
- **THEN** the emitted `dist/webview/assets/index.css` SHALL contain KaTeX's base styles
- **AND** no separate `<link rel="stylesheet">` for KaTeX SHALL be present in the webview HTML

#### Scenario: CSP allows KaTeX style attributes

- **WHEN** the webview HTML is served
- **THEN** the `Content-Security-Policy` meta tag SHALL include `style-src-attr 'unsafe-inline'`
- **AND** the `style-src` and `style-src-elem` directives SHALL remain nonce-bound (no `'unsafe-inline'` on `style-src` or `style-src-elem`)
- **AND** `script-src` SHALL remain nonce-bound

