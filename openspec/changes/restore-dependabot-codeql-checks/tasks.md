## 1. Versioned CodeQL analysis

- [x] 1.1 Add a SHA-pinned advanced CodeQL workflow that runs on `main` pushes and `main` pull requests, produces exactly `Analyze (javascript-typescript)` and `Analyze (actions)`, uses least-privilege permissions, and never uses `pull_request_target`; verify YAML structure, pins, triggers, permissions, and job names with a focused static check.

## 2. Production migration validation

- [ ] 2.1 After the workflow PR has both required CodeQL checks passing, merge it without weakening or bypassing the ruleset; verify the merged workflow runs successfully on `main`.
- [ ] 2.2 Disable repository-level CodeQL default setup only after the advanced workflow proves successful; verify default setup reports `not-configured`, refresh Dependabot PR #69, and verify it receives the two required `Analyze (...)` checks before attempting its normal merge.
