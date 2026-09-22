## MODIFIED Requirements

### Requirement: Automatic review selection is explicitly enabled and fail-closed

The host SHALL select a response for automatic reasoning review only when
automatic routing is explicitly enabled by activation with a supplied evaluation
that the existing qualification validator reports as qualified, the review
runtime is `available`, the enable flag is set with policy signals passing, the
response is a completed assistant message in the active session, and the response
belongs to a supported Scribe work mode. Missing, stale, malformed, unavailable,
incompatible, disabled, or conflicting prerequisites MUST produce a
non-selection decision and MUST NOT invoke the review controller. Activation MAY
supply the qualified evaluation and the enable flag; it MUST NOT weaken the
qualification thresholds, permit routing without qualification, or turn
automatic review into a response-release gate.

#### Scenario: Default-disabled routing preserves ordinary behavior

- **WHEN** automatic routing is not enabled or no qualified evaluation is supplied
- **THEN** no automatic review is selected, no controller request is made, and ordinary Chat and Write behavior remains unchanged

#### Scenario: Available qualified routing selects an eligible response

- **WHEN** routing is enabled with a qualified evaluation, the runtime is available, and a completed active-session response meets the routing policy
- **THEN** the host returns one automatic-selection decision with a bounded reason and may invoke the existing review controller after response delivery

#### Scenario: Unavailable runtime never routes

- **WHEN** routing is enabled but the runtime is unavailable or incompatible
- **THEN** the host returns a non-selection decision and does not invoke AF, a child model, a process, a plugin, an MCP server, or a response-release gate

#### Scenario: Ordinary work is excluded

- **WHEN** a request is classified as lookup, translation, creative work, coding/shell work, worker output, or an unsupported work mode
- **THEN** the response is not automatically selected, even if routing is enabled and evaluation evidence is qualified

#### Scenario: Activation cannot enable unqualified routing

- **WHEN** activation supplies an evaluation that fails the qualification validator, a disabled enable flag, or an unavailable runtime
- **THEN** the host returns a non-selection decision for every candidate response
- **AND** it does not retry with weaker thresholds or bypass the existing policy gates
