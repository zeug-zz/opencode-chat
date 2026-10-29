# Chat reasoning UI

## ADDED Requirements

### Requirement: Model thinking is rendered as sanitized Markdown

The chat UI MUST render model thinking parts using the existing sanitized `TextPartView` Markdown pipeline, without changing Scribe-generated reasoning-assist status text or stored content. Rendering MUST preserve streaming updates, per-part expand/collapse, global show-all behavior, and muted compact styling.

#### Scenario: Markdown and unsafe content

- **WHEN** a model thinking part contains Markdown including unsafe markup
- **THEN** it is rendered as Markdown through the existing sanitization pipeline, and unsafe content is not executed or rendered unsanitized

#### Scenario: Streaming and visibility controls

- **WHEN** a model thinking part updates while streaming or is shown/hidden by collapse or the global show-all control
- **THEN** the rendered content updates and the existing expansion and show-all behavior is retained

#### Scenario: Reasoning-assist statuses

- **WHEN** a Scribe-generated `ReasoningAssistRow` status is displayed
- **THEN** it remains plain localized text, with no provenance inferred from text and no stored content modified

### Requirement: Quick reasoning-review toggle uses the existing preference

The input area's compact brain-outline toggle MUST update the same `userEnabled` preference through the existing callback used by settings. It MUST expose localized on/off tooltip text and `aria-pressed`, reflect host-authoritative preference updates, and MUST NOT change `workspaceOptOut`.

#### Scenario: Toggle and host synchronization

- **WHEN** the user toggles the brain control or the host sends an authoritative preference update
- **THEN** the control and settings checkbox reflect the same `userEnabled` value

#### Scenario: Runtime and preference loading

- **WHEN** the runtime is unavailable or the host preference has not loaded
- **THEN** the control is respectively hidden or disabled

#### Scenario: Workspace opt-out

- **WHEN** workspace opt-out is active
- **THEN** the control is disabled and its localized tooltip explains opt-out, without changing `workspaceOptOut`
