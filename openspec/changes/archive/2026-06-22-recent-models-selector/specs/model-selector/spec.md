## ADDED Requirements

### Requirement: Surface recently used models for quick recall

The model selector SHALL surface the last used models, capped at five, in a `Recent` section pinned at the top of the selector panel, so the user can recall a frequently used model without navigating provider sections or searching.

#### Scenario: Selecting a model records it in Recent

- **WHEN** the user selects a model in the model selector
- **THEN** the GUI SHALL record that model at the front of the recent list in GUI persisted state
- **AND** cap the recent list at five entries
- **AND** the next time the selector panel is opened the selected model SHALL appear in the `Recent` section

#### Scenario: Re-selecting a model moves it to the front

- **WHEN** the user selects a model that is already present in the recent list
- **THEN** the GUI SHALL move that model to the front of the recent list
- **AND** SHALL NOT add a duplicate entry

#### Scenario: Recent list exceeds five entries

- **WHEN** the user selects a sixth distinct model
- **THEN** the GUI SHALL drop the oldest entry so the recent list never exceeds five entries

#### Scenario: Existing persisted state without recent models

- **WHEN** GUI persisted state contains only locale, input history, sound settings, or `modelEffortByModel`
- **THEN** the GUI SHALL load with an empty recent list
- **AND** SHALL NOT require any prior `recentModels` data to function

### Requirement: Render recent models with their provider name

Each row in the `Recent` section SHALL display the model name with its provider name greyed beside it, so the user can distinguish models that share a name across providers.

#### Scenario: Recent row shows model and greyed provider

- **WHEN** the `Recent` section is rendered and a recent model is present in current provider metadata
- **THEN** the row SHALL display the model display name
- **AND** SHALL display the provider display name beside it in a muted color
- **AND** SHALL NOT display an effort label in the recent row

#### Scenario: Stale recent entry is not shown

- **WHEN** GUI persisted state contains a recent entry whose `providerID` or `modelID` no longer appears in current provider metadata
- **THEN** the GUI SHALL NOT render that entry in the `Recent` section
- **AND** SHALL leave the persisted recent list intact (no destructive pruning on read)

### Requirement: Hide the Recent section while searching

The `Recent` section SHALL be hidden while a search query is active, matching the official opencode TUI behavior of only showing recent models when no filter is applied.

#### Scenario: Searching hides the Recent section

- **WHEN** the user types a non-empty query into the model selector search box
- **THEN** the GUI SHALL hide the `Recent` section
- **AND** SHALL show only matching models from provider sections

#### Scenario: Clearing the query restores the Recent section

- **WHEN** the user clears the search query so it becomes empty
- **THEN** the GUI SHALL show the `Recent` section again above the provider sections

### Requirement: Selecting a recent model restores its sticky effort

Selecting a model from the `Recent` section SHALL use the same model-selection path as the main list, so the model's persisted effort (if any) restores through the existing per-model effort logic without new effort-specific wiring.

#### Scenario: Recent selection restores persisted effort

- **WHEN** the user selects a recent model that has a valid persisted effort in `modelEffortByModel`
- **THEN** the GUI SHALL restore that effort through the existing model-effort restoration logic
- **AND** the selector trigger SHALL display the restored effort label next to the model name
- **AND** the next prompt SHALL include that effort override

#### Scenario: Recent selection without persisted effort

- **WHEN** the user selects a recent model that has no persisted effort
- **THEN** the GUI SHALL select the model with default/unset effort
- **AND** the next prompt SHALL omit an effort override
