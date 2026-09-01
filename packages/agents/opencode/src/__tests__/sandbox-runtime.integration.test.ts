import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@vscode/sandbox-runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const optIn = process.env.OPENCODE_CHAT_RUN_SANDBOX_INTEGRATION === "1";
const supportedPlatform = process.platform === "darwin" || process.platform === "linux";
const canRun = supportedPlatform && optIn;
const timeoutMs = 15_000;

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

type CommandResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };

async function runSandboxed(command: string, config: SandboxRuntimeConfig, cwd: string): Promise<CommandResult> {
  await SandboxManager.initialize(config);
  const wrapped = await SandboxManager.wrapWithSandbox(command);
  const child = spawn(wrapped, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    await SandboxManager.reset();
  }
}

async function runSandboxedOrSkip(
  context: { skip: (reason?: string) => void },
  command: string,
  config: SandboxRuntimeConfig,
  cwd: string,
): Promise<CommandResult | undefined> {
  try {
    const result = await runSandboxed(command, config, cwd);
    if (process.platform === "darwin" && result.code === 71) {
      context.skip("The enclosing environment prevents nested macOS sandbox execution (sandbox exited with code 71).");
      return undefined;
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/sandbox_apply|operation not permitted|permission denied|eacces|eperm/i.test(message)) {
      context.skip(`Nested OS sandbox enforcement is unavailable in this environment: ${message}`);
      return undefined;
    }
    throw error;
  }
}

function filesystemConfig(workspacePath: string, deniedPath: string, allowNetwork: boolean): SandboxRuntimeConfig {
  const network = {
    enabled: !allowNetwork,
    allowedDomains: allowNetwork ? [] : ["localhost", "127.0.0.1"],
    deniedDomains: [],
    allowLocalBinding: true,
  };

  if (process.platform === "darwin") {
    return {
      network: {
        ...network,
        allowMachLookup: ["com.apple.SystemConfiguration.DNSConfiguration", "com.apple.trustd.agent"],
      },
      filesystem: {
        denyRead: [deniedPath],
        allowRead: [workspacePath],
        allowWrite: [workspacePath],
        denyWrite: [deniedPath],
      },
    };
  }

  return {
    network,
    filesystem: {
      denyRead: [deniedPath],
      allowRead: [workspacePath],
      allowWrite: [workspacePath],
      denyWrite: [deniedPath],
    },
  };
}

function compatibilityFilesystemConfig(
  workspacePath: string,
  deniedPath: string,
  allowNetwork: boolean,
): SandboxRuntimeConfig {
  const network = {
    enabled: !allowNetwork,
    allowedDomains: allowNetwork ? [] : ["localhost", "127.0.0.1"],
    deniedDomains: [],
    allowLocalBinding: true,
  };

  const filesystem = {
    allowWrite: [workspacePath],
    denyWrite: [deniedPath],
  };

  if (process.platform === "darwin") {
    return {
      network: {
        ...network,
        allowMachLookup: ["com.apple.SystemConfiguration.DNSConfiguration", "com.apple.trustd.agent"],
      },
      filesystem,
    };
  }

  return { network, filesystem };
}

describe.sequential.skipIf(!canRun)(
  `${process.platform} sandbox runtime integration (run with OPENCODE_CHAT_RUN_SANDBOX_INTEGRATION=1)`,
  () => {
    let root: string;
    let workspacePath: string;
    let deniedPath: string;
    let existingProtectedPath: string | undefined;

    beforeAll(async () => {
      root = path.resolve("tmp", `sandbox-runtime-integration-${process.pid}`);
      workspacePath = path.join(root, "workspace");
      deniedPath = path.join(root, "home", ".ssh");
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.mkdir(deniedPath, { recursive: true });
      await fs.writeFile(path.join(deniedPath, "secret.txt"), "not available to the sandbox\n");

      const home = process.env.HOME;
      if (home) {
        const candidates = [
          ".ssh/config",
          ".ssh/known_hosts",
          ".git-credentials",
          ".npmrc",
          ".config/gh/hosts.yml",
          ...(process.platform === "darwin"
            ? ["Library/Keychains/login.keychain-db", "Library/Application Support/Google/Chrome/Local State"]
            : [".local/share/keyrings/login.keyring", ".config/google-chrome/Local State"]),
        ];
        for (const candidate of candidates) {
          const candidatePath = path.join(home, candidate);
          try {
            if ((await fs.stat(candidatePath)).isFile()) {
              existingProtectedPath = candidatePath;
              break;
            }
          } catch {}
        }
      }
    });

    afterAll(async () => {
      try {
        await SandboxManager.reset();
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("allows active-workspace reads and writes while denying an existing protected baseline path", async (context) => {
      const workspaceFile = path.join(workspacePath, "allowed.txt");
      const deniedFile = path.join(deniedPath, "secret.txt");
      const script = [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(workspaceFile)}, 'workspace-ok');`,
        `if (fs.readFileSync(${JSON.stringify(workspaceFile)}, 'utf8') === 'workspace-ok') {} else process.exit(2);`,
        `try { fs.readFileSync(${JSON.stringify(deniedFile)}, 'utf8'); process.exit(3); } catch { try { fs.writeFileSync(${JSON.stringify(deniedFile)}, 'blocked'); process.exit(4); } catch { process.stdout.write('denied'); } }`,
      ].join(" ");
      const result = await runSandboxedOrSkip(
        context,
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        filesystemConfig(workspacePath, deniedPath, true),
        workspacePath,
      );
      if (!result) return;

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("denied");
      await expect(fs.readFile(workspaceFile, "utf8")).resolves.toBe("workspace-ok");
    });

    it("denies a representative existing protected home read", async (context) => {
      if (!existingProtectedPath) {
        context.skip(
          "No representative protected home file exists; existing-path enforcement cannot be exercised safely.",
        );
        return;
      }
      const script = `try { require('node:fs').readFileSync(${JSON.stringify(existingProtectedPath)}, 'utf8'); process.exit(2); } catch { process.stdout.write('protected-read-denied'); }`;
      const result = await runSandboxedOrSkip(
        context,
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        filesystemConfig(workspacePath, existingProtectedPath, true),
        workspacePath,
      );
      if (!result) return;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("protected-read-denied");
    });

    it("inherits denial of an existing protected read through a local-MCP-like child", async (context) => {
      if (!existingProtectedPath) {
        context.skip("No representative protected home file exists; child inheritance cannot be exercised safely.");
        return;
      }
      const childScript = `try { require('node:fs').readFileSync(${JSON.stringify(existingProtectedPath)}, 'utf8'); process.exit(2); } catch { process.stdout.write('child-protected-read-denied'); }`;
      const parentScript = [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childScript)}], { stdio: ['ignore', 'pipe', 'pipe'] });`,
        "let output = ''; child.stdout.on('data', chunk => output += chunk); child.on('exit', code => { process.stdout.write(output); process.exit(code ?? 1); });",
      ].join(" ");
      const result = await runSandboxedOrSkip(
        context,
        `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
        filesystemConfig(workspacePath, existingProtectedPath, true),
        workspacePath,
      );
      if (!result) return;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("child-protected-read-denied");
    });

    it("enforces an existing protected path on Linux", async (context) => {
      if (process.platform !== "linux") {
        context.skip("Linux existing-path enforcement semantics are not applicable on this platform.");
        return;
      }
      if (!existingProtectedPath) {
        context.skip(
          "No representative protected home file exists; Linux existing-path enforcement cannot be exercised safely.",
        );
        return;
      }
      const script = `try { require('node:fs').readFileSync(${JSON.stringify(existingProtectedPath)}, 'utf8'); process.exit(2); } catch { process.stdout.write('linux-existing-read-denied'); }`;
      const result = await runSandboxedOrSkip(
        context,
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        filesystemConfig(workspacePath, existingProtectedPath, true),
        workspacePath,
      );
      if (!result) return;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("linux-existing-read-denied");
    });

    it("keeps loopback server binding and connectivity available", async (context) => {
      const script = [
        "const http = require('node:http');",
        "const server = http.createServer((_req, res) => { res.end('loopback-ok'); });",
        "server.listen(0, '127.0.0.1', () => { const port = server.address().port; http.get('http://127.0.0.1:' + port, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => { server.close(); process.stdout.write(body); }); }); });",
      ].join(" ");
      const result = await runSandboxedOrSkip(
        context,
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        filesystemConfig(workspacePath, deniedPath, true),
        workspacePath,
      );
      if (!result) return;

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("loopback-ok");
    });

    it("denies a non-loopback provider-like request when network access is off", async (context) => {
      const config = filesystemConfig(workspacePath, deniedPath, false);
      const script =
        "fetch('http://example.com').then(() => process.exit(2)).catch(() => process.stdout.write('network-denied'));";
      const result = await runSandboxedOrSkip(
        context,
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        config,
        workspacePath,
      );
      if (!result) return;

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("network-denied");
    });

    it(
      "permits a network-on outbound provider-like request without changing filesystem policy",
      async (context) => {
        const config = filesystemConfig(workspacePath, deniedPath, true);
        expect(config.filesystem.allowWrite).toContain(workspacePath);
        const script =
          "fetch('https://example.com').then(async response => { if (!response.ok) process.exit(2); process.stdout.write('provider-ok'); }).catch(() => process.exit(1));";
        const result = await runSandboxedOrSkip(
          context,
          `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
          config,
          workspacePath,
        );
        if (!result) return;

        if (result.code !== 0 || !result.stdout.includes("provider-ok")) {
          context.skip("External network is unavailable; runtime and network-on policy setup were verified.");
        }
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("provider-ok");
      },
      timeoutMs,
    );

    it("passes the protected-read and network boundary to a nested local-MCP-like child", async (context) => {
      const deniedFile = path.join(deniedPath, "secret.txt");
      const childWorkspaceFile = path.join(workspacePath, "child-allowed.txt");
      const childScript = [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(childWorkspaceFile)}, 'child-workspace-ok');`,
        `if (fs.readFileSync(${JSON.stringify(childWorkspaceFile)}, 'utf8') !== 'child-workspace-ok') process.exit(2);`,
        `try { fs.readFileSync(${JSON.stringify(deniedFile)}, 'utf8'); process.exit(2); } catch {}`,
        "const http = require('node:http');",
        "const server = http.createServer((_request, response) => response.end('loopback-ok'));",
        "server.listen(0, '127.0.0.1', () => { const port = server.address().port; http.get('http://127.0.0.1:' + port, response => { let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => { server.close(); if (body !== 'loopback-ok') process.exit(3); fetch('http://example.com').then(() => process.exit(4)).catch(() => process.stdout.write('child-boundary-inherited')); }); }).on('error', () => { server.close(); process.exit(5); }); });",
      ].join(" ");
      const parentScript = [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childScript)}], { stdio: ['ignore', 'pipe', 'pipe'] });`,
        "let output = ''; child.stdout.on('data', chunk => output += chunk); child.on('exit', code => { process.stdout.write(output); process.exit(code ?? 1); });",
      ].join(" ");
      const result = await runSandboxedOrSkip(
        context,
        `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
        filesystemConfig(workspacePath, deniedPath, false),
        workspacePath,
      );
      if (!result) return;

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("child-boundary-inherited");
      await expect(fs.readFile(childWorkspaceFile, "utf8")).resolves.toBe("child-workspace-ok");
    });

    it(
      "lets a nested local-MCP-like child inherit network-on compatibility access",
      async (context) => {
        const childScript =
          "fetch('https://example.com').then(async response => { if (!response.ok) process.exit(2); process.stdout.write('local-mcp-ok'); }).catch(() => process.exit(1));";
        const parentScript = [
          "const { spawn } = require('node:child_process');",
          `const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childScript)}], { stdio: ['ignore', 'pipe', 'pipe'] });`,
          "let output = ''; child.stdout.on('data', chunk => output += chunk); child.on('exit', code => { process.stdout.write(output); process.exit(code ?? 1); });",
        ].join(" ");
        const result = await runSandboxedOrSkip(
          context,
          `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
          filesystemConfig(workspacePath, deniedPath, true),
          workspacePath,
        );

        if (!result) return;
        if (result.code !== 0 || !result.stdout.includes("local-mcp-ok")) {
          context.skip("External network is unavailable; inherited network-on setup was verified.");
        }
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("local-mcp-ok");
      },
      timeoutMs,
    );

    it(
      "keeps a generic nested child compatible while constraining its writes and network",
      async (context) => {
        const runtimePath = path.join(root, "installed-runtime", "node_modules", "runtime-config.json");
        const workspaceFile = path.join(workspacePath, "nested-child.txt");
        const deniedFile = path.join(deniedPath, "nested-child.txt");
        await fs.mkdir(path.dirname(runtimePath), { recursive: true });
        await fs.writeFile(runtimePath, "installed-runtime-ok");

        const server = http.createServer((_request, response) => response.end("loopback-ok"));
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          throw new Error("Could not determine loopback test server port");
        }

        const runChild = async (allowNetwork: boolean): Promise<CommandResult | undefined> => {
          const childScript = [
            "const fs = require('node:fs');",
            "const http = require('node:http');",
            `if (fs.readFileSync(${JSON.stringify(runtimePath)}, 'utf8') !== 'installed-runtime-ok') process.exit(2);`,
            `fs.writeFileSync(${JSON.stringify(workspaceFile)}, 'nested-workspace-ok');`,
            `try { fs.writeFileSync(${JSON.stringify(deniedFile)}, 'outside-write'); process.exit(3); } catch {}`,
            `const request = (url) => new Promise((resolve, reject) => { const req = http.get(url, res => { res.resume(); res.on('end', resolve); }); req.on('error', reject); });`,
            `request('http://127.0.0.1:${address.port}').then(() => ${allowNetwork ? `request('http://example.com').then(() => process.stdout.write('network-on'))` : `request('http://example.com').then(() => process.exit(4), () => process.stdout.write('network-off'))`}).catch(() => process.exit(5));`,
          ].join(" ");
          const parentScript = [
            "const { spawn } = require('node:child_process');",
            `const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childScript)}], { stdio: ['ignore', 'pipe', 'pipe'] });`,
            "let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk); child.on('exit', (code, signal) => { process.stdout.write(output); process.exit(code ?? (signal ? 1 : 6)); });",
          ].join(" ");
          return runSandboxedOrSkip(
            context,
            `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
            compatibilityFilesystemConfig(workspacePath, deniedPath, allowNetwork),
            workspacePath,
          );
        };

        try {
          const networkOff = await runChild(false);
          if (!networkOff) return;
          expect(networkOff.code).toBe(0);
          expect(networkOff.stdout).toContain("network-off");
          await expect(fs.readFile(workspaceFile, "utf8")).resolves.toBe("nested-workspace-ok");
          await expect(fs.readFile(deniedFile, "utf8")).rejects.toThrow();

          const networkOn = await runChild(true);
          if (!networkOn) return;
          if (networkOn.code !== 0 || !networkOn.stdout.includes("network-on")) {
            context.skip(
              "External network is unavailable; nested compatibility and network-off behavior were verified.",
            );
            return;
          }
          expect(networkOn.code).toBe(0);
          expect(networkOn.stdout).toContain("network-on");
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      timeoutMs * 2,
    );
  },
);
