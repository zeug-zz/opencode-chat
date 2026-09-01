## Purpose

The chat settings panel exposes a Project Config link that opens the real
project-local OpenCode configuration file without writing stray config files
at the workspace root.

## ADDED Requirements

### Requirement: Project Config link opens the local OpenCode configuration

The chat settings panel SHALL expose a Project Config link that requests
opening the project-local OpenCode configuration file at
`<workspace>/.opencode/opencode.json`. Opening a config file MUST NOT create
or write a config file at the workspace root.

#### Scenario: User clicks Project Config with an existing local config

- **WHEN** the user clicks the Project Config link in the settings panel
- **THEN** the webview sends `{ type: "openConfigFile", filePath: "<workspace>/.opencode/opencode.json" }`

#### Scenario: User clicks Project Config without a local config file

- **WHEN** the user clicks the Project Config link and
  `<workspace>/.opencode/opencode.json` does not exist
- **THEN** the host creates only that target path and opens it
- **AND** no `opencode.json` file is created at the workspace root
