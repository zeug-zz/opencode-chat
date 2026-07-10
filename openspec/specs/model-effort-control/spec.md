# model-effort-control Specification

## Purpose
Sticky model effort/variant selection in the VS Code GUI, persisting per-model effort choices across webview reloads and matching TUI cycle-to-default semantics. Works alongside the TUI's variant cycling and does not write effort into opencode configuration.

## Requirements
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
- **AND** display the selected effort in the dedicated effort control

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
- **AND** the dedicated effort control SHALL display the localized Default label
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

### Requirement: Send explicit effort through GUI protocol
The GUI SHALL propagate explicit effort selections through the webview-to-extension and agent send contracts for chat prompts and edit/resend prompts.

#### Scenario: Chat prompt with explicit effort
- **WHEN** a user sends a chat message with an explicit effort selected
- **THEN** the webview SHALL include that effort in the send message payload
- **AND** the extension host SHALL pass that effort to the opencode agent integration
- **AND** the opencode agent integration SHALL pass the effort to opencode using the verified API-compatible mechanism (top-level `variant` sibling of `model` on `client.session.promptAsync`)

#### Scenario: Edit and resend preserves explicit effort behavior
- **WHEN** a user edits and resends a message while an explicit effort is selected
- **THEN** the resend path SHALL preserve the same explicit effort behavior as normal message send

#### Scenario: Shell command with explicit effort selected
- **WHEN** a user executes a shell command while an explicit GUI effort is selected
- **THEN** the shell path SHALL preserve existing behavior
- **AND** SHALL not send an unsupported effort/variant to `client.session.shell(...)`
- **AND** SHALL not fail because effort is selected

### Requirement: Discover effort choices from provider metadata
The GUI SHALL derive valid effort choices from opencode/provider model metadata rather than hardcoding a single provider's effort list.

#### Scenario: Metadata exposes model variants
- **WHEN** provider model metadata exposes effort or variant choices
- **THEN** the GUI SHALL use those choices to populate the effort cycle for that model
- **AND** labels SHALL reflect the provider/model metadata where available

#### Scenario: Metadata does not expose choices
- **WHEN** provider model metadata does not expose effort or variant choices
- **THEN** the GUI SHALL treat effort as unsupported for that model
- **AND** SHALL not guess effort values from provider or model names

### Requirement: Keep existing model selector behavior
The model effort control SHALL not regress existing model selector behavior.

#### Scenario: Model search still filters models
- **WHEN** a user searches in the model selector
- **THEN** existing connected-provider filtering and no-results behavior SHALL continue to work

#### Scenario: Selecting a model still closes popover
- **WHEN** a user selects a model from the model selector
- **THEN** the GUI SHALL call the existing model select behavior
- **AND** close the popover as before

#### Scenario: Disconnected providers remain disabled
- **WHEN** disconnected providers are shown through existing show-all behavior
- **THEN** their model items SHALL remain disabled
- **AND** effort controls SHALL not make disconnected models selectable

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
