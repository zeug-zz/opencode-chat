## ADDED Requirements

### Requirement: Prove effective V2 restrictions under inherited policy
Under inherited config/plugins, Scribe MUST enforce native V2 Scout, worker, Write, and reviewer restrictions in sandbox-on/off modes; config readback alone is not proof. On plugin failure, native per-plugin isolation SHALL retain the same backend and restrictions; Scribe MUST NOT retry plugin-free. A failed required integration SHALL be unavailable.

#### Scenario: Inherited policy or tool inventory changes
- **WHEN** inherited config/plugins add tools or alter policy precedence
- **THEN** effective required denials still hold, or startup/release fails closed
- **AND** empty inventory is not accepted as plugin discovery success

#### Scenario: Native fetch is accepted without a false containment claim
- **WHEN** native Code Mode uses `fetch` under an enabled backend
- **THEN** Scribe MUST NOT claim it is governed by the ordinary `webfetch` permission or restricted to read-only HTTP methods
- **AND** existing OS/network backend controls continue to apply
- **AND** sandbox-off MUST NOT be described as OS containment
