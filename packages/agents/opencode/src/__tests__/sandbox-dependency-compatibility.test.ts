import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { FilesystemConfigSchema, NetworkConfigSchema, SandboxRuntimeConfigSchema } from "@vscode/sandbox-runtime";
import { loadConfig, loadConfigFromString } from "@vscode/sandbox-runtime/dist/utils/config-loader.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const localRequire = createRequire(import.meta.url);
const sandboxRuntimeEntry = localRequire.resolve("@vscode/sandbox-runtime");
const sandboxRuntimeRequire = createRequire(sandboxRuntimeEntry);
const zodEntry = sandboxRuntimeRequire.resolve("zod");
const zodVersion = JSON.parse(readFileSync(path.join(path.dirname(zodEntry), "package.json"), "utf8")).version;
const sandboxConfigSource = readFileSync(sandboxRuntimeRequire.resolve("./sandbox/sandbox-config.js"), "utf8");

const policy = {
  network: {
    enabled: true,
    allowedDomains: ["localhost", "api.example.test"],
    deniedDomains: ["blocked.example.test"],
    allowLocalBinding: true,
    allowMachLookup: ["com.example.Service"],
  },
  filesystem: {
    denyRead: ["/private", "/home/example/.ssh"],
    allowRead: ["/workspace"],
    allowWrite: ["/workspace"],
    denyWrite: ["/workspace/.git/config"],
  },
  ignoreViolations: {
    "git status": ["/workspace/.git/index"],
  },
};

describe("installed sandbox-runtime dependency compatibility", () => {
  let scratchDirectory: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (scratchDirectory) {
      rmSync(scratchDirectory, { recursive: true, force: true });
      scratchDirectory = undefined;
    }
  });

  it("uses Zod 4 through the sandbox package's declared import path", () => {
    expect(zodVersion).toBe("4.6.6");
    expect(sandboxConfigSource).toMatch(/from ['"]zod['"]/);
    expect(sandboxConfigSource).not.toMatch(/zod\/v3/);
  });

  it("parses a valid Scribe sandbox policy with the exported network and filesystem schemas", () => {
    expect(NetworkConfigSchema.safeParse(policy.network).success).toBe(true);
    expect(FilesystemConfigSchema.safeParse(policy.filesystem).success).toBe(true);
    expect(SandboxRuntimeConfigSchema.safeParse(policy)).toEqual({ success: true, data: policy });
    expect(loadConfigFromString(JSON.stringify(policy))).toEqual(policy);
  });

  it.each([
    ["wrong-typed network switch", { network: { ...policy.network, enabled: "false" } }],
    ["untrusted URL domain", { network: { ...policy.network, allowedDomains: ["https://attacker.example/path"] } }],
    ["overly broad wildcard", { network: { ...policy.network, allowedDomains: ["*.com"] } }],
    ["wrong-typed ignore-violation entry", { ignoreViolations: { "*": ["/workspace", 42] } }],
  ])("rejects %s through the exported schema and string config loader", (_case, replacement) => {
    const invalidPolicy = { ...policy, ...replacement };

    expect(SandboxRuntimeConfigSchema.safeParse(invalidPolicy).success).toBe(false);
    expect(loadConfigFromString(JSON.stringify(invalidPolicy))).toBeNull();
  });

  it("loads a policy file and fails closed with a Zod 4 issue when an untrusted field is invalid", () => {
    mkdirSync(path.resolve("tmp"), { recursive: true });
    scratchDirectory = mkdtempSync(path.resolve("tmp", "sandbox-dependency-compatibility-"));
    const configPath = path.join(scratchDirectory, "sandbox.json");
    writeFileSync(configPath, JSON.stringify(policy));
    expect(loadConfig(configPath)).toEqual(policy);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    writeFileSync(configPath, JSON.stringify({ ...policy, network: { ...policy.network, enabled: "false" } }));

    expect(loadConfig(configPath)).toBeNull();
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("network.enabled");
  });
});
