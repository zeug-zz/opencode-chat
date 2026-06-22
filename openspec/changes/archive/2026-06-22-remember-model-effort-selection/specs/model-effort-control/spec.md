## MODIFIED Requirements

### Requirement: Preserve default effort until explicitly selected

The GUI SHALL preserve opencode's default model effort behavior when the user has not explicitly selected an effort in the GUI.

#### Scenario: Sending without explicit effort

- **WHEN** a user sends a chat message after selecting a model but before selecting, restoring, or cycling effort
- **THEN** the GUI SHALL send the model without an explicit effort override
- **AND** opencode SHALL apply its server/config/default effort behavior

#### Scenario: Existing selected model state remains valid

- **WHEN** persisted UI state contains only a provider/model selection from a prior GUI version
- **THEN** the GUI SHALL load the selected model without requiring effort data
- **AND** the next prompt SHALL not include an explicit effort override until the user chooses one or a valid per-model effort is restored from GUI persisted state

### Requirement: Cycle valid effort choices with Ctrl+T

The GUI SHALL support cycling model effort from the message input with `Ctrl+T` when a selected model exposes valid effort choices.

#### Scenario: Cycling effort for a supported model

- **WHEN** focus is in the message input and the selected model has multiple valid effort choices
- **AND** the user presses `Ctrl+T`
- **THEN** the GUI SHALL prevent the browser/default key behavior for that event
- **AND** select the next valid effort in the model's effort order
- **AND** display the selected effort near the selected model

#### Scenario: Cycling from unset default

- **WHEN** the selected model has valid effort choices and the current GUI effort state is unset
- **AND** the user presses `Ctrl+T`
- **THEN** the GUI SHALL choose the first explicit effort in that model's valid effort order
- **AND** subsequent `Ctrl+T` presses SHALL continue cycling through the same valid effort order

#### Scenario: Cycling back to default

- **WHEN** the selected model has valid effort choices
- **AND** the current GUI effort state is the last valid effort in that model's effort order
- **AND** the user presses `Ctrl+T`
- **THEN** the GUI SHALL clear the explicit effort selection
- **AND** the visible effort label SHALL disappear
- **AND** the next prompt SHALL omit effort override unless the user chooses a valid effort again

#### Scenario: Unsupported model

- **WHEN** focus is in the message input and the selected model does not expose valid effort choices
- **AND** the user presses `Ctrl+T`
- **THEN** the GUI SHALL not send any effort override
- **AND** existing text input and send behavior SHALL remain unchanged

### Requirement: Validate effort when the selected model changes

The GUI SHALL validate the selected explicit effort against the currently selected model before displaying or sending it.

#### Scenario: New model supports the same effort

- **WHEN** the user has selected an explicit effort
- **AND** changes to another model that supports the same effort identifier
- **THEN** the GUI MAY keep that explicit effort selected
- **AND** the next prompt SHALL include that effort override

#### Scenario: New model does not support prior effort

- **WHEN** the user has selected an explicit effort
- **AND** changes to another model that does not support that effort identifier
- **THEN** the GUI SHALL clear the explicit effort selection
- **AND** the next prompt SHALL omit effort override unless the user chooses a valid effort for the new model

#### Scenario: Persisted effort is stale

- **WHEN** GUI persisted state contains an effort id for the selected model
- **AND** current provider metadata does not advertise that effort id for the selected model or marks it disabled
- **THEN** the GUI SHALL NOT restore or display that effort
- **AND** the next prompt SHALL omit effort override unless the user chooses a valid effort again

## ADDED Requirements

### Requirement: Remember explicit effort per model

The GUI SHALL remember a valid explicit effort selection per `providerID/modelID` in GUI persisted state.

#### Scenario: Restore remembered effort for selected model

- **WHEN** GUI persisted state contains an effort id for the selected `providerID/modelID`
- **AND** current provider metadata advertises that effort id as a valid variant for the selected model
- **THEN** the GUI SHALL restore the effort selection
- **AND** display the restored effort near the selected model
- **AND** include that effort override in subsequent chat and edit/resend prompt payloads

#### Scenario: Different models remember different efforts

- **WHEN** a user selects one effort for model A
- **AND** selects a different effort for model B
- **THEN** switching between model A and model B SHALL restore each model's own remembered effort when valid

#### Scenario: Clearing effort preserves default state

- **WHEN** a user clears effort by cycling past the last valid effort or otherwise clearing the explicit selection
- **THEN** the GUI SHALL remove the remembered effort for the selected `providerID/modelID`
- **AND** future reloads of that model SHALL start in the unset/default effort state unless a valid effort is selected again

#### Scenario: Existing persisted webview state remains compatible

- **WHEN** GUI persisted state contains locale, input history, sound settings, or no effort map from an earlier version
- **THEN** effort persistence SHALL initialize without error
- **AND** updating effort persistence SHALL preserve unrelated persisted fields

### Requirement: Do not persist effort into opencode configuration

The GUI SHALL NOT write model effort selection into `opencode.json` or other opencode server configuration as part of remembering GUI effort.

#### Scenario: Selecting effort does not update opencode model config

- **WHEN** the user selects or clears model effort in the GUI
- **THEN** the GUI SHALL update only GUI persisted state for effort
- **AND** SHALL NOT send a model config persistence message beyond the existing model-only `setModel` flow
- **AND** SHALL NOT add effort or variant fields to `opencode.json`
