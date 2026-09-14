## Context

See `proposal.md` for motivation. `main-branch-protection` strictly requires successful `Analyze (javascript-typescript)` and `Analyze (actions)` statuses. Repository-level CodeQL default setup currently analyzes `actions`, `javascript`, `javascript-typescript`, and `typescript`, but Dependabot heads receive only a neutral aggregate `CodeQL` check. There is no checked-in CodeQL workflow, while the repository's security and test workflows use SHA-pinned actions and `pull_request` triggers.

## Goals / Non-Goals

**Goals:**

- Produce the two existing ruleset-required CodeQL check names on ordinary and Dependabot pull requests.
- Version, review, and pin CodeQL workflow behavior in the repository.
- Preserve a least-privilege, untrusted-PR security boundary.
- Retire default setup only after the advanced workflow is merged and proven.

**Non-Goals:**

- Do not weaken, rename, or bypass the active ruleset.
- Do not use `pull_request_target`, checkout a PR head with elevated credentials, expose secrets, or grant write permissions beyond CodeQL result upload.
- Do not change extension/runtime behavior, dependencies, nono, or sandbox policy.
- Do not merge blocked Dependabot PRs until their actual required checks pass.

## Decisions

### 1. Add an advanced CodeQL workflow with required job names

Create `.github/workflows/codeql.yml` triggered by `push` to `main`, `pull_request` targeting `main`, a weekly schedule, and manual dispatch. Use a two-value matrix with literal language labels `javascript-typescript` and `actions`; set the job name to `Analyze (${{ matrix.language }})`. This emits the exact existing ruleset contexts without changing the ruleset.

The matrix replaces default setup's overlapping JavaScript/TypeScript handling with the documented `javascript-typescript` language label and retains GitHub Actions analysis explicitly. A single aggregate `CodeQL` status is insufficient because it does not meet the required context names.

### 2. Preserve untrusted pull-request boundaries

Use only `pull_request`, never `pull_request_target`. Give the workflow global `contents: read`; give the analysis job `security-events: write` and only any additional read permissions required by CodeQL. GitHub reduces token permissions for untrusted Dependabot/fork pull requests, while CodeQL supports result upload for its pull-request analysis path. Checkout uses the normal merge-ref context and does not persist credentials.

This favors a safe PR analysis boundary over workflows that acquire base-repository write authority. It also makes the required checks trustworthy inputs to the ruleset.

### 3. Pin one current CodeQL action revision across init/autobuild/analyze

Pin `github/codeql-action` init, autobuild, and analyze to the resolved commit for v4.38.0, and pin checkout using the project’s current immutable SHA convention. Use CodeQL `init` with the matrix language, run `autobuild` only where required, and submit results with `analyze` using the language category. Actions analysis must skip irrelevant build steps rather than execute a generic project build.

One revision eliminates drift among CodeQL stages. The resolved v4.38.0 tag points through an annotated tag to commit `b96794f015dfd88f77b49b1c93e0fa7110f94c63`.

### 4. Migrate default setup after the workflow proves required checks

Keep default setup configured while the workflow PR is evaluated. After the workflow is merged and GitHub records both required `Analyze (...)` checks as successful on `main` and a real Dependabot PR, disable CodeQL default setup through the repository Code Scanning default-setup API. Re-query the setting and check runs to prove advanced setup is authoritative.

This sequencing preserves coverage and avoids a gap where neither scanner can satisfy required statuses. Rollback is to re-enable default setup via the same repository API if advanced setup fails.

## Risks / Trade-offs

- **Default and advanced setup overlap during rollout** → retain the overlap only through PR validation; disable default setup immediately after evidence of advanced checks.
- **A CodeQL job name differs from the ruleset context** → literal matrix values and status-name verification are mandatory before merge.
- **Dependabot token restrictions prevent a result upload** → validate against existing Dependabot PR #69 before merging any dependency PR; do not introduce `pull_request_target` as a workaround.
- **CodeQL action maintenance changes its pin** → retain immutable SHA comments and update all three action invocations together.
- **Default setup disable operation fails** → leave default setup enabled, investigate without changing required rules, and restore/adjust the advanced workflow through a normal PR.

## Migration Plan

1. Add and statically validate the advanced workflow in a dedicated PR.
2. Confirm its two exact CodeQL checks run successfully on the PR and, after merge, on `main`.
3. Use the repository Code Scanning API to change default setup from `configured` to `not-configured`; re-query it.
4. Refresh Dependabot PR #69 and verify it receives both required checks; merge only after the ruleset permits it.
5. Roll back by re-enabling default setup if the versioned workflow cannot produce valid analyses.
