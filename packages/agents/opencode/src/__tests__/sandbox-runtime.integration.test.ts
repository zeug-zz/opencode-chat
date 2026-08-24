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

    beforeAll(async () => {
      root = path.resolve("tmp", `sandbox-runtime-integration-${process.pid}`);
      workspacePath = path.join(root, "workspace");
      deniedPath = path.join(root, "outside-policy");
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.mkdir(deniedPath, { recursive: true });
      await fs.writeFile(path.join(deniedPath, "secret.txt"), "not available to the sandbox\n");
    });

    afterAll(async () => {
      await SandboxManager.reset();
      await fs.rm(root, { recursive: true, force: true });
    });

    it("allows active-workspace reads and writes while denying an outside-policy path", async () => {
      const workspaceFile = path.join(workspacePath, "allowed.txt");
      const deniedFile = path.join(deniedPath, "secret.txt");
      const script = [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(workspaceFile)}, 'workspace-ok');`,
        `if (fs.readFileSync(${JSON.stringify(workspaceFile)}, 'utf8') === 'workspace-ok') {} else process.exit(2);`,
        `try { fs.readFileSync(${JSON.stringify(deniedFile)}, 'utf8'); process.exit(3); } catch { try { fs.writeFileSync(${JSON.stringify(deniedFile)}, 'blocked'); process.exit(4); } catch { process.stdout.write('denied'); } }`,
      ].join(" ");
      const result = await runSandboxed(
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        filesystemConfig(workspacePath, deniedPath, true),
        workspacePath,
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("denied");
      await expect(fs.readFile(workspaceFile, "utf8")).resolves.toBe("workspace-ok");
    });

    it("keeps loopback server binding and connectivity available", async () => {
      const script = [
        "const http = require('node:http');",
        "const server = http.createServer((_req, res) => { res.end('loopback-ok'); });",
        "server.listen(0, '127.0.0.1', () => { const port = server.address().port; http.get('http://127.0.0.1:' + port, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => { server.close(); process.stdout.write(body); }); }); });",
      ].join(" ");
      const result = await runSandboxed(
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        filesystemConfig(workspacePath, deniedPath, true),
        workspacePath,
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("loopback-ok");
    });

    it("denies a non-loopback provider-like request when network access is off", async () => {
      const config = filesystemConfig(workspacePath, deniedPath, false);
      const script =
        "fetch('http://example.com').then(() => process.exit(2)).catch(() => process.stdout.write('network-denied'));";
      const result = await runSandboxed(
        `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
        config,
        workspacePath,
      );

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
        const result = await runSandboxed(
          `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
          config,
          workspacePath,
        );

        if (result.code !== 0 || !result.stdout.includes("provider-ok")) {
          context.skip("External network is unavailable; runtime and network-on policy setup were verified.");
        }
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("provider-ok");
      },
      timeoutMs,
    );

    it("passes the denied filesystem and network boundary to a nested local-MCP-like child", async () => {
      const deniedFile = path.join(deniedPath, "secret.txt");
      const childScript = [
        "const fs = require('node:fs');",
        `try { fs.readFileSync(${JSON.stringify(deniedFile)}, 'utf8'); process.exit(2); } catch {}`,
        "fetch('http://example.com').then(() => process.exit(3)).catch(() => process.stdout.write('child-boundary-inherited'));",
      ].join(" ");
      const parentScript = [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childScript)}], { stdio: ['ignore', 'pipe', 'pipe'] });`,
        "let output = ''; child.stdout.on('data', chunk => output += chunk); child.on('exit', code => { process.stdout.write(output); process.exit(code ?? 1); });",
      ].join(" ");
      const result = await runSandboxed(
        `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
        filesystemConfig(workspacePath, deniedPath, false),
        workspacePath,
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("child-boundary-inherited");
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
        const result = await runSandboxed(
          `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
          filesystemConfig(workspacePath, deniedPath, true),
          workspacePath,
        );

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

        const runChild = async (allowNetwork: boolean): Promise<CommandResult> => {
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
          return runSandboxed(
            `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
            compatibilityFilesystemConfig(workspacePath, deniedPath, allowNetwork),
            workspacePath,
          );
        };

        try {
          const networkOff = await runChild(false);
          expect(networkOff.code).toBe(0);
          expect(networkOff.stdout).toContain("network-off");
          await expect(fs.readFile(workspaceFile, "utf8")).resolves.toBe("nested-workspace-ok");
          await expect(fs.readFile(deniedFile, "utf8")).rejects.toThrow();

          const networkOn = await runChild(true);
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
