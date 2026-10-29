## ADDED Requirements

### Requirement: Preserve model and effort in verified V2 prompt requests
The V2 adapter MUST preserve the selected provider/model and explicit effort for normal and edit/resend requests only through the exact verified V2 schema. When effort is unset, it MUST omit the override so the server default applies. Shell operations MUST not receive unsupported effort fields. `setModel` MUST NOT persist user configuration unless a separately authorized existing contract explicitly requires it; the current UI write path is a migration conflict to resolve before acceptance.

#### Scenario: Explicit and default effort
- **WHEN** a prompt has explicit effort or no effort
- **THEN** the verified V2 request preserves the explicit value or omits the field respectively, and model selection reaches the actual request

#### Scenario: Persisted model preference
- **WHEN** the host receives `setModel`
- **THEN** it MUST NOT perform an unapproved persistent server-config write; required UX behavior remains unresolved until an approved non-persistent V2 mechanism is verified
