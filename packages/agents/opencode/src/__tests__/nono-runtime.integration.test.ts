import { type ChildProcess, execFile, spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const optIn = process.env.OPENCODE_CHAT_RUN_NONO_INTEGRATION === "1";
const selectedProfile = process.env.OPENCODE_CHAT_NONO_PROFILE?.trim();
const timeoutMs = 20_000;
const diagnosticOutputLimit = 2_048;

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

async function findNono(): Promise<string | undefined> {
  if (process.env.NONO_BIN) {
    try {
      await fs.access(process.env.NONO_BIN, 1);
      return path.isAbsolute(process.env.NONO_BIN) ? process.env.NONO_BIN : undefined;
    } catch {
      return undefined;
    }
  }

  const candidates = [
    "/opt/homebrew/bin/nono",
    "/usr/local/bin/nono",
    "/usr/bin/nono",
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, "nono")),
  ];

  for (const candidate of [...new Set(candidates.filter((value): value is string => Boolean(value)))]) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      await fs.access(candidate, 1);
      return candidate;
    } catch {
      // Try the next documented executable location.
    }
  }
  return undefined;
}

async function verifyProfile(nono: string, profile: string): Promise<boolean> {
  try {
    await execFileAsync(nono, ["profile", "show", profile], {
      timeout: 1_500,
      maxBuffer: 4_096,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
}

function captureOutput(child: ChildProcess): { stdout: () => string; stderr: () => string } {
  let stdout = "";
  let stderr = "";
  const append = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(-diagnosticOutputLimit);
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = append(stdout, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = append(stderr, chunk);
  });
  return { stdout: () => stdout, stderr: () => stderr };
}

function redactDiagnosticOutput(output: string, replacements: string[]): string {
  let redacted = output;
  for (const replacement of replacements) {
    if (replacement) redacted = redacted.split(replacement).join("<redacted-path>");
  }
  return redacted
    .replace(/\b(?:Bearer|Basic)\s+[^\s]+/gi, "<redacted-credential>")
    .replace(/([A-Z][A-Z0-9_-]*(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_-]*)\s*[=:]\s*[^\s]+/gi, "$1=<redacted>")
    .replace(/-----BEGIN[\s\S]*?-----END[^\n]*-----/g, "<redacted-key>")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) ? character : "?";
    })
    .join("")
    .slice(-diagnosticOutputLimit);
}

function formatDiagnostics(result: CommandResult, replacements: string[]): string {
  const stdout = redactDiagnosticOutput(result.stdout, replacements) || "<empty>";
  const stderr = redactDiagnosticOutput(result.stderr, replacements) || "<empty>";
  return [
    `nono child exit: code=${result.code ?? "null"}, signal=${result.signal ?? "null"}`,
    `nono child stdout (last ${diagnosticOutputLimit} chars max): ${stdout}`,
    `nono child stderr (last ${diagnosticOutputLimit} chars max): ${stderr}`,
  ].join("\n");
}

async function waitForExit(
  child: ChildProcess,
  capturedOutput: { stdout: () => string; stderr: () => string },
): Promise<CommandResult> {
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const [code, signal] =
      child.exitCode !== null || child.signalCode !== null
        ? [child.exitCode, child.signalCode]
        : ((await once(child, "exit")) as [number | null, NodeJS.Signals | null]);
    return { code, signal, stdout: capturedOutput.stdout(), stderr: capturedOutput.stderr() };
  } finally {
    clearTimeout(timeout);
  }
}

describe("nono runtime integration", () => {
  it(
    "verifies the documented profile boundary and cleans up its process tree",
    async (context) => {
      if (!optIn) {
        context.skip("Set OPENCODE_CHAT_RUN_NONO_INTEGRATION=1 to opt in; nono was not launched.");
        return;
      }

      if (!selectedProfile || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(selectedProfile)) {
        context.skip(
          "Set OPENCODE_CHAT_NONO_PROFILE to an explicitly selected disposable profile; nono was not launched.",
        );
        return;
      }

      const nono = await findNono();
      if (!nono) {
        context.skip("No executable nono was found in NONO_BIN or the documented POSIX locations.");
        return;
      }
      if (!(await verifyProfile(nono, selectedProfile))) {
        context.skip(
          "The selected nono profile did not pass profile-show preflight; the companion launch was not attempted.",
        );
        return;
      }

      const tempParent = path.resolve("tmp");
      let tempParentExisted = true;
      try {
        await fs.stat(tempParent);
      } catch {
        tempParentExisted = false;
      }
      await fs.mkdir(tempParent, { recursive: true });
      const root = await fs.mkdtemp(path.join(tempParent, "nono-runtime-integration-"));
      const workspace = path.join(root, "workspace");
      const state = path.join(workspace, ".opencode", "state.json");
      const cache = path.join(workspace, ".opencode", "cache", "temp.txt");
      const openCodeConfig = path.join(workspace, ".opencode", "config.json");
      const resultPath = path.join(root, "result.json");
      const descendantPidPath = path.join(root, "descendant.pid");
      const descendantResultPath = path.join(root, "descendant.result");
      const protectedCandidates = [
        path.join(process.env.HOME ?? "", ".ssh", "config"),
        path.join(process.env.HOME ?? "", ".ssh", "known_hosts"),
        path.join(process.env.HOME ?? "", ".git-credentials"),
        path.join(process.env.HOME ?? "", ".npmrc"),
      ];
      const protectedPath = await (async () => {
        for (const candidate of protectedCandidates) {
          try {
            if ((await fs.stat(candidate)).isFile()) return candidate;
          } catch {
            // Protected-read checks must use an existing file, never create one.
          }
        }
        return undefined;
      })();
      if (!protectedPath) {
        await fs.rm(root, { recursive: true, force: true });
        if (!tempParentExisted) await fs.rm(tempParent, { recursive: true, force: true });
        context.skip("No representative existing protected home file is available for a safe denial check.");
        return;
      }

      const childScript = [
        "const fs = require('node:fs');",
        "const http = require('node:http');",
        "const { spawn } = require('node:child_process');",
        `const workspace = ${JSON.stringify(workspace)};`,
        `const state = ${JSON.stringify(state)};`,
        `const cache = ${JSON.stringify(cache)};`,
        `const openCodeConfig = ${JSON.stringify(openCodeConfig)};`,
        `const protectedPath = ${JSON.stringify(protectedPath)};`,
        `const resultPath = ${JSON.stringify(resultPath)};`,
        `const descendantPidPath = ${JSON.stringify(descendantPidPath)};`,
        `const descendantResultPath = ${JSON.stringify(descendantResultPath)};`,
        "fs.mkdirSync(require('node:path').dirname(state), { recursive: true });",
        "fs.mkdirSync(require('node:path').dirname(cache), { recursive: true });",
        "fs.writeFileSync(state, 'state-ok'); fs.writeFileSync(cache, 'cache-ok'); fs.writeFileSync(openCodeConfig, '{\"config\":\"ok\"}');",
        "const protectedReadDenied = (() => { try { fs.readFileSync(protectedPath); return false; } catch { return true; } })();",
        "const server = http.createServer((_request, response) => response.end('loopback-ok'));",
        "server.listen(0, '127.0.0.1', () => {",
        "  const port = server.address().port;",
        "  http.get('http://127.0.0.1:' + port, (response) => {",
        "    let body = ''; response.on('data', (chunk) => body += chunk);",
        "    response.on('end', async () => {",
        "      server.close();",
        `      const descendantScript = ${JSON.stringify(`const fs = require('node:fs'); const pid = process.pid; fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(pid)); try { fs.readFileSync(${JSON.stringify(protectedPath)}); process.exit(2); } catch { fs.writeFileSync(${JSON.stringify(descendantResultPath)}, 'protected-read-denied'); } setInterval(() => {}, 1000);`)};`,
        "      const descendant = spawn(process.execPath, ['-e', descendantScript], { stdio: 'ignore' });",
        "      const networkEnabled = process.env.OPENCODE_CHAT_RUN_NONO_NETWORK === '1';",
        "      let networkBehavior = 'not-requested';",
        "      if (networkEnabled) { try { const response = await fetch('https://example.com', { signal: AbortSignal.timeout(3000) }); networkBehavior = response.ok ? 'allowed' : 'unavailable'; } catch { networkBehavior = 'unavailable'; } }",
        "      const result = { workspaceState: fs.readFileSync(state, 'utf8') === 'state-ok', cacheState: fs.readFileSync(cache, 'utf8') === 'cache-ok', openCodeState: JSON.parse(fs.readFileSync(openCodeConfig, 'utf8')).config === 'ok', protectedReadDenied, loopback: body === 'loopback-ok', networkBehavior, descendantPid: descendant.pid };",
        "      fs.writeFileSync(resultPath, JSON.stringify(result));",
        "    });",
        "  }).on('error', () => process.exit(3));",
        "});",
      ].join(" ");
      const processHandle = spawn(
        nono,
        ["wrap", "--profile", selectedProfile, "--allow-cwd", "--", process.execPath, "-e", childScript],
        {
          cwd: root,
          detached: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        },
      );
      const capturedOutput = captureOutput(processHandle);
      let descendantPid: number | undefined;
      let failure: unknown;
      let childResult: CommandResult | undefined;

      try {
        const result = JSON.parse(await waitForFile(resultPath)) as {
          workspaceState: boolean;
          cacheState: boolean;
          openCodeState: boolean;
          protectedReadDenied: boolean;
          loopback: boolean;
          networkBehavior: string;
          descendantPid: number;
        };
        descendantPid = result.descendantPid;
        await waitForFile(descendantPidPath);
        await waitForFile(descendantResultPath);
        expect(result.workspaceState).toBe(true);
        expect(result.cacheState).toBe(true);
        expect(result.openCodeState).toBe(true);
        expect(result.protectedReadDenied).toBe(true);
        expect(result.loopback).toBe(true);
        if (process.env.OPENCODE_CHAT_RUN_NONO_NETWORK === "1") {
          // External internet is optional and unreliable in CI; the child still records the result.
          expect(["allowed", "unavailable"]).toContain(result.networkBehavior);
        } else {
          expect(result.networkBehavior).toBe("not-requested");
        }
        expect(Number.isInteger(result.descendantPid)).toBe(true);
        expect(await fs.readFile(descendantResultPath, "utf8")).toBe("protected-read-denied");
      } catch (error) {
        failure = error;
      } finally {
        if (descendantPid === undefined) {
          try {
            descendantPid = Number(await fs.readFile(descendantPidPath, "utf8"));
          } catch {
            // The child may have failed before starting its descendant.
          }
        }
        if (processHandle.pid) {
          try {
            process.kill(-processHandle.pid, "SIGTERM");
          } catch {
            processHandle.kill("SIGTERM");
          }
        }
        childResult = await waitForExit(processHandle, capturedOutput);
        if (descendantPid !== undefined) {
          await expect
            .poll(() => {
              try {
                process.kill(descendantPid as number, 0);
                return true;
              } catch {
                return false;
              }
            })
            .toBe(false);
        }
        await fs.rm(root, { recursive: true, force: true });
        if (!tempParentExisted) await fs.rm(tempParent, { recursive: true, force: true });
      }
      if (failure !== undefined) {
        const message = failure instanceof Error ? failure.message : String(failure);
        throw new Error(
          `${message}\n${formatDiagnostics(childResult as CommandResult, [root, process.env.HOME ?? ""])}`,
          { cause: failure },
        );
      }
    },
    timeoutMs * 2,
  );
});
