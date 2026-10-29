import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const localRequire = createRequire(import.meta.url);
const vsceEntry = localRequire.resolve("@vscode/vsce");
const vsceRequire = createRequire(vsceEntry);
const identityPackagePath = vsceRequire.resolve("@azure/identity/package.json");
const identityEntry = vsceRequire.resolve("@azure/identity");
const identityRequire = createRequire(identityEntry);
const msalPackagePath = identityRequire.resolve("@azure/msal-node/package.json");
const identityPackage = localRequire(identityPackagePath);
const msalPackage = identityRequire(msalPackagePath);
const identity = vsceRequire("@azure/identity");
const msal = identityRequire("@azure/msal-node");
const msalTypes = readFileSync(path.resolve(path.dirname(msalPackagePath), msalPackage.types), "utf8");
const restPipelineEntry = identityRequire.resolve("@azure/core-rest-pipeline");
const restPipelineRequire = createRequire(restPipelineEntry);
const { createHttpHeaders } = restPipelineRequire("@azure/core-rest-pipeline");

assert.match(identityPackage.version, /^4\.13\./, "vsce should retain Azure Identity 4.13.x");
assert.equal(msalPackage.version, "7.1.0", "the scoped override should select patched MSAL 7.1.0");

for (const [name, methods] of [
  [
    "PublicClientApplication",
    [
      "acquireTokenByCode",
      "acquireTokenByDeviceCode",
      "acquireTokenByUsernamePassword",
      "acquireTokenSilent",
      "acquireTokenInteractive",
    ],
  ],
  ["ConfidentialClientApplication", ["acquireTokenByCode", "acquireTokenByClientCredential", "acquireTokenOnBehalfOf"]],
]) {
  const Application = msal[name];
  assert.equal(typeof Application, "function", `MSAL must export ${name}`);
  for (const method of methods) {
    assert.equal(typeof Application.prototype[method], "function", `${name}.${method} must remain available`);
  }
}
assert.equal(typeof msal.ManagedIdentityApplication, "function", "Azure Identity uses ManagedIdentityApplication");
for (const method of ["getManagedIdentitySource", "acquireToken"]) {
  assert.equal(
    typeof msal.ManagedIdentityApplication.prototype[method],
    "function",
    `ManagedIdentityApplication.${method} must remain available`,
  );
}
assert.ok(msal.LogLevel, "Azure Identity uses MSAL LogLevel");
for (const typeName of [
  "INetworkModule",
  "NetworkRequestOptions",
  "NetworkResponse",
  "ICachePlugin",
  "INativeBrokerPlugin",
]) {
  assert.ok(msalTypes.includes(typeName), `MSAL type declarations must export ${typeName}`);
}

const tokenResponse = JSON.stringify({
  access_token: "synthetic-release-compatibility-token",
  token_type: "Bearer",
  expires_in: 3600,
  ext_expires_in: 3600,
  scope: "https://graph.microsoft.com/.default",
});
const tenantId = "00000000-0000-0000-0000-000000000001";
const clientId = "00000000-0000-0000-0000-000000000002";

function createFakeHttpClient(expectedGrantType) {
  const requests = [];
  return {
    requests,
    async sendRequest(request) {
      const url = new URL(request.url);
      assert.equal(url.hostname, "login.microsoftonline.com");
      assert.equal(url.pathname, `/${tenantId}/oauth2/v2.0/token`);
      assert.equal(request.method, "POST");
      const form = new URLSearchParams(String(request.body));
      assert.equal(form.get("grant_type"), expectedGrantType);
      requests.push({ method: request.method, path: url.pathname, grantType: form.get("grant_type") });
      return {
        request,
        status: 200,
        headers: createHttpHeaders({ "content-type": "application/json" }),
        bodyAsText: tokenResponse,
      };
    },
  };
}

const authCodeHttpClient = createFakeHttpClient("authorization_code");
const authorizationCodeCredential = new identity.AuthorizationCodeCredential(
  tenantId,
  clientId,
  "synthetic-authorization-code",
  "http://localhost/callback",
  { httpClient: authCodeHttpClient, disableInstanceDiscovery: true },
);
assert.equal(authCodeHttpClient.requests.length, 0, "credential construction must not make a request");
const authorizationCodeToken = await authorizationCodeCredential.getToken(["https://graph.microsoft.com/.default"]);
assert.equal(authorizationCodeToken.token, "synthetic-release-compatibility-token");
assert.equal(authCodeHttpClient.requests.length, 1, "authorization-code token exchange must use only the fake client");

const clientSecretHttpClient = createFakeHttpClient("client_credentials");
const clientSecretCredential = new identity.ClientSecretCredential(tenantId, clientId, "synthetic-secret", {
  httpClient: clientSecretHttpClient,
  disableInstanceDiscovery: true,
});
assert.equal(clientSecretHttpClient.requests.length, 0, "credential construction must not make a request");
const clientSecretToken = await clientSecretCredential.getToken(["https://graph.microsoft.com/.default"]);
assert.equal(clientSecretToken.token, "synthetic-release-compatibility-token");
assert.equal(
  clientSecretHttpClient.requests.length,
  1,
  "client-credential token exchange must use only the fake client",
);

console.log(
  `Offline compatibility passed: @azure/identity ${identityPackage.version}, @azure/msal-node ${msalPackage.version}; ${authCodeHttpClient.requests.length + clientSecretHttpClient.requests.length} fake token requests, no provider/network access.`,
);
