## ADDED Requirements

### Requirement: Select effort from a dedicated supported-model menu
The GUI SHALL render a dedicated model-effort control adjacent to the model selector when, and only when, the selected model exposes one or more valid enabled variants from server-provided metadata. The control SHALL display the currently selected explicit effort label or identifier, or a localized `Default` label when no explicit effort is selected. Its menu SHALL present `Default` and every valid advertised variant in server metadata order as mutually exclusive choices.

#### Scenario: Selecting an advertised effort
- **WHEN** the selected model advertises valid `low`, `medium`, `high`, and `xhigh` variants
- **AND** the user chooses `xhigh` from the dedicated effort menu
- **THEN** the GUI SHALL select and visibly display `xhigh`
- **AND** the next chat and edit/resend prompt SHALL include the normalized `xhigh` effort override

#### Scenario: Selecting Default from the menu
- **WHEN** an explicit effort is selected for the current model
- **AND** the user chooses `Default` from the dedicated effort menu
- **THEN** the GUI SHALL clear the explicit effort selection and remove its remembered value for that model
- **AND** the next chat and edit/resend prompt SHALL omit the effort override

#### Scenario: Unsupported selected model
- **WHEN** the selected model has no valid enabled variants in server-provided metadata
- **THEN** the GUI SHALL not render the dedicated model-effort control
- **AND** effort selection state and existing message-input behavior SHALL remain unchanged

#### Scenario: Menu selection preserves input flow
- **WHEN** the user chooses `Default` or an advertised effort from the dedicated effort menu
- **THEN** the GUI SHALL close the menu and restore focus to the message input
- **AND** existing text in the message input SHALL remain unchanged

### Requirement: Use a single selected-model variant capability source
The GUI SHALL derive the valid selected-model variant list once from the authoritative provider metadata with the existing connected-provider fallback. The dedicated effort menu and `Ctrl+T` cycle behavior SHALL use that same normalized list.

#### Scenario: Provider metadata changes
- **WHEN** the selected model's provider metadata changes to remove or disable a previously available variant
- **THEN** the GUI SHALL remove that variant from the dedicated effort menu and `Ctrl+T` cycle
- **AND** the GUI SHALL not display or send an invalid remembered effort

### Requirement: Present effort only in the dedicated effort control
The GUI SHALL use the dedicated supported-model effort control as the canonical visible presentation of the selected effort. The model selector trigger SHALL display the selected model without a duplicated effort suffix.

#### Scenario: Explicit effort is selected
- **WHEN** the current model has an explicit effort selection
- **THEN** the dedicated effort control SHALL display that effort
- **AND** the model selector trigger SHALL display only the model name
