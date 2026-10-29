# Release 0.18.0 CodeQL Alert Review

**Status:** Alerts 6–9 independently reviewed as false positives. The GitHub dismissal status is primary-owned; this note does not claim the alerts are dismissed or the review is complete. No production trust boundary changed, and no finding was fixed by altering fixtures.

## Reviewed alerts

| Alert | Source and evidence | Assessment and dismissal rationale |
|---|---|---|
| 6 | `packages/agents/opencode/src/__tests__/v2-code-mode.integration.test.ts:1169` interpolates `JSON.stringify(nativeFetchURL)` into generated JavaScript. The URL is constructed at line 1333 from a local server's loopback port and fixed `/native-fetch-fixture` path. | Test-only JavaScript literal generation for a fixture URL; there is no attacker-controlled string or HTML/script embedding sink. False positive; dismiss this alert specifically, not the rule generally. |
| 7 | `packages/agents/opencode/src/__tests__/v2-effective-policy.integration.test.ts:992-993` serializes a path and generated nested code. The path is a sentinel under `isolation.paths.cwd` with a fixed filename in the opt-in denied-shell test. | Test-only fixture construction. `JSON.stringify` creates a JavaScript literal here; it is **not** general shell escaping. This weak test-quality distinction does not establish a production vulnerability. False positive; dismiss this alert specifically, not the rule generally. |
| 8 | `packages/agents/opencode/src/__tests__/v2-code-mode.integration.test.ts:1243` | The URL inclusion is an evidence assertion about returned fixture URLs, not a network-host allowlist, fetch control, or authentication route. False positive; dismiss this alert specifically, not the rule generally. |
| 9 | `packages/agents/opencode/src/__tests__/v2-code-mode.integration.test.ts:1244` | The URL inclusion is an evidence assertion about returned fixture URLs, not a network-host allowlist, fetch control, or authentication route. False positive; dismiss this alert specifically, not the rule generally. |

These are narrow alert-level assessments, not blanket tool or rule exclusions. Required CodeQL scanners remain enabled. No claim is made that these test files were executed live for this review.
