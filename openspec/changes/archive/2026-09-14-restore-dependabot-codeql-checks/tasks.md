## 1. Versioned CodeQL analysis

- [x] 1.1 Add a SHA-pinned advanced CodeQL workflow that runs on `main` pushes and `main` pull requests, produces exactly `Analyze (javascript-typescript)` and `Analyze (actions)`, uses least-privilege permissions, and never uses `pull_request_target`; verify YAML structure, pins, triggers, permissions, and job names with a focused static check.

## 2. Production migration validation

- [x] 2.1 Disable repository-level CodeQL default setup after the workflow PR exists and before re-running its failed jobs; verify default setup reports `not-configured`, re-run the CodeQL jobs, and confirm both required `Analyze (...)` checks pass without weakening or bypassing the ruleset.
- [x] 2.2 Merge the workflow PR after both required checks pass, verify the merged workflow succeeds on `main`, refresh Dependabot PR #69, and verify it receives the two required `Analyze (...)` checks before attempting its normal merge.
