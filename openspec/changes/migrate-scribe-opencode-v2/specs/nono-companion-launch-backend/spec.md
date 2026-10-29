## ADDED Requirements

### Requirement: Establish V2 server identity and effective backend boundary
The selected backend MUST launch a verified V2 foreground `serve` child on loopback/ephemeral port with explicit workspace cwd and native in-memory overlay. Authenticated readiness MUST verify version and bind endpoint/credential/lifecycle to that child. Actual-host workspace grants, descendant containment, and required Hindsight injection MUST be evidenced. Nested nono, config/profile rewrite, shared service, and backend downgrade are prohibited.

#### Scenario: Selected backend cannot prove access or containment
- **WHEN** actual-host prerequisites, grants, injection, authentication, or containment are missing
- **THEN** that backend's acceptance remains blocked or launch fails closed without switching backend
- **AND** no secrets or config values are copied to diagnostics
