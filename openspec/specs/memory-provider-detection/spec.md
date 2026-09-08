# memory-provider-detection Specification

## Purpose

This capability reports sanitized memory-provider availability and independent capabilities without making memory a startup dependency or replacing ordinary OpenCode guidance.

## Requirements

### Requirement: Report normalized memory-provider capability status

The companion SHALL expose a sanitized memory-provider status containing a stable provider identifier, display name, lifecycle state, and independent retain, recall, and reflect capability flags.

#### Scenario: Hindsight is fully available

- **WHEN** the configured Hindsight integration is discoverable and its safe capability probe confirms retain, recall, and reflect
- **THEN** the companion SHALL report provider state `available`
- **AND** it SHALL report all three capability flags as `true`
- **AND** the status SHALL not include credentials, raw configuration, private paths, or provider payloads

#### Scenario: Hindsight is only partially available

- **WHEN** a provider is discoverable but one or more of retain, recall, or reflect cannot be confirmed
- **THEN** the companion SHALL report provider state `partial`
- **AND** it SHALL report each confirmed capability independently
- **AND** it SHALL not claim unavailable capabilities

### Requirement: Distinguish provider availability failures

The companion SHALL distinguish no provider, configured-but-unavailable, sandbox/policy-blocked, and unexpected detection failure without preventing normal Chat or Write startup.

#### Scenario: No provider is configured

- **WHEN** no supported memory provider is found in the effective OpenCode environment
- **THEN** the companion SHALL report state `unavailable`
- **AND** it SHALL preserve normal Chat and Write operation

#### Scenario: Provider cannot be contacted

- **WHEN** a configured provider cannot complete its safe discovery or health check
- **THEN** the companion SHALL report state `configured` or `error` according to the known failure category
- **AND** it SHALL preserve normal Chat and Write operation
- **AND** it SHALL expose only a bounded, sanitized reason

#### Scenario: Provider is blocked by policy

- **WHEN** the provider is detected but the active companion policy prevents safe use
- **THEN** the companion SHALL report state `blocked`
- **AND** it SHALL not broaden sandbox, filesystem, network, or agent permissions
- **AND** it SHALL preserve normal Chat and Write operation

### Requirement: Detection SHALL not mutate user configuration

Memory detection SHALL be read-only with respect to user and workspace OpenCode configuration.

#### Scenario: Detection runs during companion startup

- **WHEN** the extension starts or refreshes the companion
- **THEN** detection MAY read effective configuration and perform a safe provider probe
- **AND** it SHALL not write `opencode.json`, `opencode.jsonc`, `.mcp.json`, Hindsight configuration, or workspace guidance files
- **AND** it SHALL not enable arbitrary globally configured plugins

### Requirement: Publish status through the existing host boundary

The extension host SHALL publish the normalized memory-provider status through a typed host-to-webview message, and the webview SHALL be able to render the provider state without requiring memory tools to be enabled.

#### Scenario: Webview initializes without a provider

- **WHEN** the webview completes its existing initialization handshake
- **THEN** it SHALL receive a memory status of `unavailable`, `blocked`, `configured`, `partial`, `available`, or `error`
- **AND** absence of a usable provider SHALL not prevent the rest of initialization

### Requirement: Preserve AGENTS.md fallback

Memory-provider detection SHALL not replace or disable normal OpenCode context discovery, including applicable `AGENTS.md` guidance.

#### Scenario: Provider detection fails

- **WHEN** detection returns `unavailable`, `blocked`, or `error`
- **THEN** Chat and Write SHALL continue using ordinary OpenCode context and applicable `AGENTS.md` guidance
- **AND** the companion SHALL not claim that durable memory is available
