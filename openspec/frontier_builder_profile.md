# Frontier Builder Profile

Purpose: keep OpenSpec artifacts reliable across model tiers (Kimi/Opus-class and GPT-5.3+ class) by separating hard contract from flexible execution guidance.

## Two-Layer Contract

- Contract Layer (MUST)
  - Normative, testable, enforceable statements.
  - Uses SHALL/MUST language for requirements and failure semantics.
  - Defines invariants, compatibility boundaries, and verification expectations.

- Guidance Layer (SHOULD)
  - Preferred implementation sequence, hints, and style guidance.
  - Non-normative notes for performance, readability, or maintainability.
  - Never overrides a MUST contract.

Conflict resolution: If SHOULD conflicts with MUST, follow MUST.

## Minimalism Contract

KISS constrains expansion within the two-layer contract; it never weakens a MUST.

1. Default to smallest. The minimal change satisfying the stated requirement is
   the default; larger designs need an explicit reason.
2. Justify every addition. Each capability, requirement, and task traces to a
   stated need. Untraceable items are removed, not deferred.
3. State the smaller alternative. Every design records the simplest option
   considered and why it was rejected. If none was, the design is not done.
4. Non-goals are enforced. Listed non-goals cannot reappear as requirements or
   tasks.
5. Delete before add. Prefer removing a rule, artifact, or task over adding one.
6. Budgets, not adjectives. Cap the capability count, create one spec file per
   capability and no more, and keep the smallest sufficient task set.
7. Do not invent problems. Speculative risks and hypothetical edge cases are out
   of scope unless an accepted requirement names them.

## Artifact Rules

- proposal.md
  - MUST: problem, objective, scope, non-goals.
  - MUST (when applicable): risks, fallback, compatibility impact — only when the
    change has a failure, migration, or compatibility surface.
  - MUST: smallest capability set, each with a one-line justification. SHOULD:
    at most three capabilities unless the objective requires more.
  - SHOULD: rollout recommendations and sequencing hints.

- design.md
  - MUST: architecture boundaries, key decisions, and the simplest alternative
    considered with why it is insufficient.
  - MUST (when applicable): migration and rollback — only when that surface exists.
  - SHOULD: implementation options and optimization notes.

- specs/*/spec.md
  - MUST: requirements and scenarios with explicit acceptance outcomes.
  - MUST: one spec file per capability; merge overlapping capabilities.
  - SHOULD: non-normative implementation guidance in separate guidance text.

- tasks.md
  - MUST: checkbox steps that are verifiable, dependency-ordered, and traceable
    to a requirement.
  - SHOULD: optional execution tips outside checklist items, and the smallest
    task set that verifies the requirement.

## Style Targets

- Keep MUST statements specific and unambiguous.
- Keep SHOULD guidance concise so stronger models can optimize without drifting from contract.
- Prefer additive compatibility language over rewrite language for merge-safe evolution.
