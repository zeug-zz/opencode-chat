# Release 0.18.0 Dependency Security Correction

**Status:** Compatibility verified for the scoped dependency overrides. The workspace audit has no high or critical findings, but still reports four lower-severity advisories (see below); this note does not claim a zero-finding audit.

## Scoped remediations and compatibility evidence

| Dependency edge | Declared range | Selected version | Compatibility evidence |
|---|---|---|---|
| `@vscode/sandbox-runtime@0.0.1 > zod` | `^3.24.1` | `4.6.6` | Its installed `dist/sandbox/sandbox-config.js` imports `z` from the ordinary `zod` entry and uses `z.object`, `z.array`, `z.record(z.string(), z.array(z.string()))`, `.refine()`, and `.safeParse()`. The installed config loader reads `result.error.issues`. The focused test exercises those exported schemas and the actual installed loader under Zod 4. |
| `@vscode/vsce@4.0.0 > @azure/identity@4.13.3 > @azure/msal-node` | `^6.0.0` | `7.1.0` | Identity's installed Node implementation uses the MSAL public/confidential client constructors and token-flow methods listed below, plus managed-identity APIs and the listed declaration types. The release compatibility script checks the installed 7.1.0 exports/types and completes synthetic authorization-code and client-credential token flows through an injected fake HTTP client. |

These are deliberate declared-major mismatches, not semver-compatible upgrades claimed by either upstream package. They are bounded to the named parent edges in the root `pnpm.overrides`; unrelated consumers are not upgraded by these entries. The MSAL dependency is tooling-only through `vsce`, not a new Scribe runtime authentication feature.

### Exact consumed MSAL surface checked

- `PublicClientApplication`: `acquireTokenByCode`, `acquireTokenByDeviceCode`, `acquireTokenByUsernamePassword`, `acquireTokenSilent`, `acquireTokenInteractive`.
- `ConfidentialClientApplication`: `acquireTokenByCode`, `acquireTokenByClientCredential`, `acquireTokenOnBehalfOf`.
- `ManagedIdentityApplication`: `getManagedIdentitySource`, `acquireToken`.
- Type exports used by Azure Identity's declarations: `INetworkModule`, `NetworkRequestOptions`, `NetworkResponse`, `ICachePlugin`, and `INativeBrokerPlugin`; `LogLevel` is also checked as a runtime export.

The fake-network script constructs `AuthorizationCodeCredential` and `ClientSecretCredential` with synthetic values, confirms construction is offline, then serves two synthetic HTTP 200 responses through the injected client. Unexpected endpoints or grant types fail the test. No user-configured Azure credentials/provider or external token endpoint is used.

## Acceptance results

- `pnpm install --frozen-lockfile` — passed with pnpm 10.16.0.
- `pnpm --filter @opencode-chat/agent-opencode exec vitest run src/__tests__/sandbox-dependency-compatibility.test.ts` — 7 tests passed against the installed sandbox package and its actual config loader.
- `node packages/platforms/vscode/scripts/test-release-dependency-compatibility.mjs` — passed; 2 synthetic token requests were handled only by the fake HTTP clients.
- Agent, extension-host, and webview TypeScript checks — passed.
- `pnpm run check` — passed (507 files).
- `pnpm run build` — passed.
- `pnpm test:all` — 1,941 webview and 1,577 extension-host tests passed; 4 tests skipped, with one additional extension-host test file skipped by its existing gate.
- `npm run package:verify` from `packages/platforms/vscode` — passed; VSIX archived 93 files and verification confirmed 9 research resources and 2 Scribe plugin resources.
- `pnpm audit --audit-level high` — completed without a high/critical threshold failure. Full audit output contains **0 high, 0 critical, 1 low, and 3 moderate** findings; none were suppressed. Remaining findings are KaTeX, two `@vitest/mocker` advisories, and `qs`, and are outside this scoped correction.
- `git diff --check` — passed.

## Security boundary and limitations

- The sandbox schema/config-loader tests cover the Scribe policy fields (`network.enabled`, `allowedDomains`, `deniedDomains`, `allowLocalBinding`, `allowMachLookup`, `filesystem.denyRead`, `allowRead`, `allowWrite`, `denyWrite`) and the record schema. Invalid types, URL/broad-wildcard domains, and invalid record values are rejected; both string and file loading remain fail-closed, and file errors are reported through `.issues`.
- No `zod/v3` path or compatibility shim is used. Zod 4.6.6 does **not** add an Scribe-side array bound, and this change does not claim that it fixes unbounded arrays accepted by upstream sandbox-runtime schemas. Such bounds require an upstream fix or a separately scoped policy change.
- Build and package verification emitted existing non-fatal Vite/Node warnings; both commands completed successfully.

Logs are retained under `tmp/scribe-v2-migration/release018/` for this workspace run.
