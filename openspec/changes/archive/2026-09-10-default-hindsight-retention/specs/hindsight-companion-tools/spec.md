## MODIFIED Requirements

### Requirement: Gate Hindsight tools by detected capabilities

The companion SHALL expose the exact `hindsight_ingest_document` operation when
the approved Hindsight provider reports `retain: true` and the exact tool is
present in the observed inventory, without requiring a separate workspace
retention setting. The operation SHALL remain confirmation-gated and bounded.
The companion SHALL continue to deny Hindsight deletion, administration,
diagnostics, synchronization, wildcard, and unknown tools.

#### Scenario: Installed capable Hindsight provider

- **WHEN** the exact approved provider is loaded
- **AND** its observed inventory contains the exact retention tool
- **AND** it reports the retain capability
- **THEN** Scout and Build MAY request that exact operation through the existing
  confirmation boundary
- **AND** the research worker SHALL not receive it
- **AND** provider failures SHALL remain nonfatal

#### Scenario: Fully capable Hindsight provider

- **WHEN** the approved provider is loaded and detection reports `recall: true`,
  `reflect: true`, and `retain: true` with the exact observed tools
- **THEN** Chat and Write SHALL receive the exact detected read, reflection, and
  confirmation-gated retention allows
- **AND** the provider's diagnostic, synchronization, deletion, administration,
  and unknown tools SHALL remain denied
- **AND** the research worker SHALL remain excluded from retention

#### Scenario: Partially capable Hindsight provider

- **WHEN** detection reports only a subset of `recall`, `reflect`, and `retain`
  capabilities or observed tools
- **THEN** the companion SHALL expose only the corresponding exact tool subset
- **AND** an unavailable capability SHALL not be represented by an optimistic
  permission
- **AND** Chat and Write SHALL continue to operate with their remaining tools

#### Scenario: Retention prerequisites fail

- **WHEN** the provider is unavailable, blocked, errored, unapproved, missing
  retain capability, or missing the exact observed tool
- **THEN** no Hindsight write operation SHALL be exposed
- **AND** ordinary Chat/Write and exact read/reflect behavior SHALL continue when
  available

### Requirement: Integrate with sandbox policy without weakening it

Automatic and explicit Hindsight retention SHALL continue to use the existing
bounded summary, secret rejection/redaction, exact identity, observed inventory,
lifecycle, and sandbox checks. Enabling the fixed policy SHALL not weaken the
companion sandbox, add provider configuration writes, or alter independent TUI
behavior.

#### Scenario: Exact provider paths are safe to grant

- **WHEN** the approved provider's required runtime/configuration paths pass the
  existing sandbox checks
- **THEN** automatic and explicit retention MAY use those paths
- **AND** the companion SHALL retain its existing deny-read and constrained-write
  policy

#### Scenario: Provider path cannot be safely granted

- **WHEN** a required provider path is missing, unsafe, or conflicts with a
  protected deny-read path
- **THEN** Hindsight retention SHALL be unavailable or blocked
- **AND** the extension SHALL preserve ordinary Chat/Write behavior without
  weakening the sandbox or retrying unsandboxed
