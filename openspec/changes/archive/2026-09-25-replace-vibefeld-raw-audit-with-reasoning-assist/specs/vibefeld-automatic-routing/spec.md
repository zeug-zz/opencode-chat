# Spec Delta

## REMOVED Requirements

### Requirement: Automatic review selection is explicitly enabled and fail-closed
**Reason**: Post-response automatic review is retired with the raw completed-response
review route, so the host no longer selects completed responses for review.
**Migration**: Eligible prompts use the host-owned `vibefeld-reasoning-assist`
preflight before answer streaming. No automatic selection, review-controller
request, or post-response review invocation remains.

### Requirement: Routing qualification uses bounded reviewed-corpus metrics
**Reason**: Qualification existed only to gate automatic routing; both are retired
with the post-response review path.
**Migration**: No reviewed-corpus qualification, evaluation validator, or
qualification state remains. The replacement capability requires no corpus.

### Requirement: Automatic selections expose a stable bounded rationale
**Reason**: Automatic summaries and their review card are retired, so no
automatic-selection rationale is produced or displayed.
**Migration**: The prompt-scoped `vibefeld-reasoning-assist` summary is the only
bounded assist presentation and carries no routing rationale.

### Requirement: Routing is isolated, deduplicated, and post-response only
**Reason**: No post-response review runs, so response binding, deduplication, and
stale-result rules for automatic routing are obsolete.
**Migration**: Prompt tokens and generation guards in `vibefeld-reasoning-assist`
own cancellation, superseding, and stale-result rejection.

### Requirement: Routing preserves product and security boundaries
**Reason**: The capability is retired; its prohibitions are retained by the
reasoning-assist and restricted-context boundaries rather than by routing.
**Migration**: The `Keep reasoning assistance bounded and host-owned` requirement
in `vibefeld-reasoning-assist` and the restricted-context requirements preserve
the same authority limits.

### Requirement: User-facing routing text is localized and bounded
**Reason**: Routing labels and the review card are retired.
**Migration**: Reasoning-assist progress and summary strings are localized under
`vibefeld-reasoning-assist`.
