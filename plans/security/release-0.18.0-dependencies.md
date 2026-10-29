# Release 0.18.0 Dependency Security Correction

**Status:** Compatibility verified for the scoped dependency overrides and requested compatible Dependabot updates. The full audit reports no advisories; no findings are suppressed.

## Scoped remediations and compatibility evidence

| Dependency edge | Declared range | Selected version | Compatibility evidence |
|---|---|---|---|
| `@vscode/sandbox-runtime@0.0.1 > zod` | `^3.24.1` | `4.6.6` | Its installed `dist/sandbox/sandbox-config.js` imports `z` from the ordinary `zod` entry and uses `z.object`, `z.array`, `z.record(z.string(), z.array(z.string()))`, `.refine()`, and `.safeParse()`. The installed config loader reads `result.error.issues`. The focused test exercises those exported schemas and the actual installed loader under Zod 4. |
| `@vscode/vsce@4.0.0 > @azure/identity@4.13.3 > @azure/msal-node` | `^6.0.0` | `7.1.0` | Identity's installed Node implementation uses the MSAL public/confidential client constructors and token-flow methods listed below, plus managed-identity APIs and the listed declaration types. The release compatibility script checks the installed 7.1.0 exports/types and completes synthetic authorization-code and client-credential token flows through an injected fake HTTP client. |
| `mermaid@12.0.0 > katex` | `^0.16.47` | `0.18.11` | The root `mermaid>katex` override selects the patched version only on Mermaid's edge. The compatibility script resolves KaTeX from Mermaid, checks the actual Mermaid `renderToString` call options, and runs both output modes plus unsafe-command checks with default and explicit-false trust. |

These are deliberate declared-major mismatches, not semver-compatible upgrades claimed by either upstream package. They are bounded to the named parent edges in the root `pnpm.overrides`; unrelated consumers are not upgraded by these entries. The MSAL dependency is tooling-only through `vsce`, not a new Scribe runtime authentication feature. Mermaid's KaTeX consumer is covered by the exact-call compatibility test above.

### Exact consumed MSAL surface checked

- `PublicClientApplication`: `acquireTokenByCode`, `acquireTokenByDeviceCode`, `acquireTokenByUsernamePassword`, `acquireTokenSilent`, `acquireTokenInteractive`.
- `ConfidentialClientApplication`: `acquireTokenByCode`, `acquireTokenByClientCredential`, `acquireTokenOnBehalfOf`.
- `ManagedIdentityApplication`: `getManagedIdentitySource`, `acquireToken`.
- Type exports used by Azure Identity's declarations: `INetworkModule`, `NetworkRequestOptions`, `NetworkResponse`, `ICachePlugin`, and `INativeBrokerPlugin`; `LogLevel` is also checked as a runtime export.

The fake-network script constructs `AuthorizationCodeCredential` and `ClientSecretCredential` with synthetic values, confirms construction is offline, then serves two synthetic HTTP 200 responses through the injected client. Unexpected endpoints or grant types fail the test. No user-configured Azure credentials/provider or external token endpoint is used.

## Acceptance results

## Release 0.18.0 queued Dependabot updates

- Updated `@types/node` to `^26.6.5` in the agent and VS Code packages, Vitest to `^5.0.5` in all three workspace packages, `@vitejs/plugin-react` to `^6.1.1`, `marked` to `^18.0.14`, and direct KaTeX to `^0.18.10` (resolving to `0.18.11`). DOMPurify is already `^3.4.17`; Vite is already `^8.3.3` (lockfile resolves a newer compatible version), so neither needed a manifest change.
- Kept `@types/vscode` at `~1.137.0` and the extension engine at `^1.137.0`: the proposed type-only update to 1.140 would raise the development compatibility floor without changing the supported VS Code requirement.
- Pinned CodeQL init/analyze and SARIF upload together to `github/codeql-action@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2` (`v4.38.2`); the annotated tag object `88585263c0627ee42c0e1c5143a112c8d6f4aa18` dereferences to that commit.
- Bumped the existing root `qs` override to `^6.16.1`, the patched same-major release. Existing scoped Zod/MSAL overrides remain unchanged.

- `pnpm install --frozen-lockfile` — passed with pnpm 10.16.0.
- `pnpm --filter @opencode-chat/agent-opencode exec vitest run src/__tests__/sandbox-dependency-compatibility.test.ts` — 7 tests passed against the installed sandbox package and its actual config loader.
- `node packages/platforms/vscode/scripts/test-release-dependency-compatibility.mjs` — passed; 2 synthetic token requests were handled only by the fake HTTP clients.
- `node scripts/test-mermaid-katex-compatibility.mjs` — passed against Mermaid's resolved KaTeX 0.18.11; validated the exact `renderToString` options for both output modes, output structure, and unsafe URL handling with default and `trust: false`.
- Agent, extension-host, and webview TypeScript checks — passed.
- `pnpm run check` — passed (507 files).
- `pnpm run build` — passed.
- `pnpm test:all` — 1,941 webview and 1,577 extension-host tests passed; 4 tests skipped, with one additional extension-host test file skipped by its existing gate.
- `npm run package:verify` from `packages/platforms/vscode` — passed; VSIX archived 93 files and verification confirmed 9 research resources and 2 Scribe plugin resources.
- `pnpm audit` — **0 advisories** after the scoped Mermaid KaTeX override. Before the override, low advisory `GHSA-238p-pmpm-9mq7` resolved through Mermaid's transitive `katex@0.16.47`; the VS Code package's direct KaTeX dependency already resolved to `0.18.11`. The direct version did not remediate Mermaid's separate transitive edge. No suppressions were added.
- `git diff --check` — passed.

## Security boundary and limitations

- The sandbox schema/config-loader tests cover the Scribe policy fields (`network.enabled`, `allowedDomains`, `deniedDomains`, `allowLocalBinding`, `allowMachLookup`, `filesystem.denyRead`, `allowRead`, `allowWrite`, `denyWrite`) and the record schema. Invalid types, URL/broad-wildcard domains, and invalid record values are rejected; both string and file loading remain fail-closed, and file errors are reported through `.issues`.
- No `zod/v3` path or compatibility shim is used. Zod 4.6.6 does **not** add an Scribe-side array bound, and this change does not claim that it fixes unbounded arrays accepted by upstream sandbox-runtime schemas. Such bounds require an upstream fix or a separately scoped policy change.
- Build and package verification emitted existing non-fatal Vite/Node warnings; both commands completed successfully.

Logs are retained under `tmp/scribe-v2-migration/release018/` for this workspace run.
