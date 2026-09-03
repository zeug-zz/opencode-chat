## ADDED Requirements

### Requirement: Extension-owned guidance resources are read-only sandbox inputs

When Chat sandboxing is enabled and native bundled skill discovery is active, the filesystem policy SHALL grant the packaged extension guidance directory read access for the companion process tree. The grant SHALL be narrow, deterministic, and outside the active workspace resource model. It SHALL NOT grant write access to the guidance directory, the extension root, or the user's home directory. The grant SHALL participate in the existing deny-read overlap validation and SHALL never be used as a reason to remove a protected deny or fall back to an unsandboxed launch.

#### Scenario: Sandboxed companion reads packaged guidance

- **WHEN** Chat sandboxing is enabled and the companion loads a bundled skill
- **THEN** the companion and its descendants SHALL be able to read the packaged skill resource
- **AND** the allowed path SHALL resolve from the installed extension location
- **AND** the path SHALL be present only as a read-only compatibility grant

#### Scenario: Packaged guidance cannot be written

- **WHEN** a sandboxed companion, shell, or local MCP attempts to write the packaged guidance directory
- **THEN** the write SHALL fail at the sandbox boundary
- **AND** the policy SHALL retain workspace and documented runtime write grants
- **AND** the extension SHALL not broaden the guidance grant or copy resources into the workspace

#### Scenario: Guidance grant conflicts fail closed

- **WHEN** the packaged guidance grant overlaps a protected deny path or another incompatible policy boundary
- **THEN** filesystem policy construction SHALL fail before sandbox launch
- **AND** the extension SHALL report the failure through the existing sandbox error path
- **AND** it SHALL not remove the deny, broaden the grant, or launch an unsandboxed replacement

#### Scenario: Unsupported Windows behavior remains unchanged

- **WHEN** Chat runs on Windows
- **THEN** the extension SHALL make no sandbox enforcement claim
- **AND** bundled guidance may remain available through the existing unsandboxed companion path
- **AND** the change SHALL not alter the existing Windows compatibility behavior
