## ADDED Requirements

### Requirement: Preserve the approved Hindsight deployment and lifecycle boundary
V2 qualification MUST preserve the current plugin-managed daemon, runtime credential injection, loopback endpoint, external PostgreSQL mapping, bank/session identity, and configured lifecycle/retention outcomes. Scribe MUST NOT read/persist secrets, replace daemon/database, or count ordinary Chat fallback as Hindsight preservation. Existing exact identity, inventory, backend, sandbox and capability gates remain binding.

#### Scenario: Approved integration is configured
- **WHEN** the fresh private child receives the approved injection context and exact provider identity/inventory
- **THEN** qualified operations preserve current identity/lifecycle outcomes without exposing credentials or changing deployment configuration

#### Scenario: Injection or required provider contract is missing
- **WHEN** actual Scribe launch cannot prove injection, endpoint/bank identity, or a required configured operation
- **THEN** that integration gate remains blocked; secrets are not copied from configuration and ordinary Chat success is not counted as preservation
