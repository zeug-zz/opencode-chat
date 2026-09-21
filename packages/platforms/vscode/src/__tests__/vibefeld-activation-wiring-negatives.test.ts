import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const activationSources = [
  readSource("../vibefeld/af-discovery.ts"),
  readSource("../vibefeld/af-runtime-resolution.ts"),
  readSource("../vibefeld/af-direct-policy.ts"),
  readSource("../vibefeld/af-execution-boundary.ts"),
  readSource("../vibefeld/af-process-executor.ts"),
  readSource("../vibefeld/vibefeld-activation.ts"),
  readSource("../vibefeld/vibefeld-runtime.ts"),
];
const commandSchemaSource = readSource("../vibefeld/af-command-schema.ts");
const qualificationSources = [
  readSource("../vibefeld/qualification-recorder.ts"),
  readSource("../vibefeld/qualification-store.ts"),
];
const extensionSource = readSource("../extension.ts");
const agentSource = readSource("../../../../agents/opencode/src/opencode-agent.ts");
const launchConfigSource = readSource("../../../../agents/opencode/src/launch-config.ts");
const protocolSource = readSource("../../../../core/src/protocol.ts");
const chatPrompt = readSource("../../CHAT_SYSTEM.md");
const writePrompt = readSource("../../WRITE_SYSTEM.md");

describe("Vibefeld activation wiring security negatives", () => {
  it("keeps runtime inputs host-owned and operations fixed", () => {
    const discoveryOptions = readSource("../vibefeld/af-discovery.ts").match(
      /export type AfDiscoveryOptions[\s\S]*?\n\}>;/u,
    )?.[0];
    const resolutionOptions = readSource("../vibefeld/af-runtime-resolution.ts").match(
      /export type ResolveAfRuntimeOptions[\s\S]*?\n\}>;/u,
    )?.[0];

    expect(discoveryOptions).toBeDefined();
    expect(discoveryOptions).not.toMatch(/^\s*(?:executable|argv|env|override)\??\s*:/imu);
    expect(resolutionOptions).toBeDefined();
    expect(resolutionOptions).not.toMatch(
      /^\s*(?:executable|argv|prompt|webview|model|environmentOverride|argvOverride)\??\s*:/imu,
    );
    expect(readSource("../vibefeld/af-discovery.ts")).toMatch(
      /discoverAfExecutable = \(options: AfDiscoveryOptions\)/u,
    );
    expect(readSource("../vibefeld/af-discovery.ts")).not.toMatch(/discoverAfExecutable\([^)]*,/u);

    const commandSchema = readSource("../vibefeld/af-command-schema.ts");
    expect(commandSchema).toContain('export const AF_COMMAND_OPERATIONS = ["version", "schema", "init", "status"]');
    expect(readSource("../vibefeld/vibefeld-runtime.ts")).toContain(
      'export type AfBridgeOperation = Extract<AfCommandOperation, { operation: "init" | "status" }>',
    );
    expect(readSource("../vibefeld/af-process-executor.ts")).toContain(
      "async execute<T = unknown>(operation: AfCommandOperation",
    );
    expect(readSource("../vibefeld/af-direct-policy.ts")).toContain("descriptor.argv.slice(1)");
    expect(readSource("../vibefeld/af-direct-policy.ts")).toContain("shell: false");
    expect(readSource("../vibefeld/af-direct-policy.ts")).toContain("detached: true");
    expect(readSource("../vibefeld/af-direct-policy.ts")).not.toMatch(
      /options\.argv|options\.executable|options\.override/u,
    );
  });

  it("keeps AF out of model-visible agent, launch, protocol, and prompt surfaces", () => {
    for (const source of [agentSource, launchConfigSource, protocolSource, chatPrompt, writePrompt]) {
      expect(source).not.toMatch(/\b(?:af|vibefeld)\b/iu);
      expect(source).not.toMatch(/(?:runAf|invokeAf|af(?:Argv|Executable|Workspace|Environment))/u);
    }

    expect(extensionSource).not.toMatch(
      /(?:af|vibefeld)[\s\S]{0,160}(?:pluginSources|mcpOverlay|customTools|agentOverlay|IAgent)/iu,
    );
    expect(extensionSource).not.toMatch(/(?:runAf|invokeAf|af(?:Argv|Executable|Workspace|Environment))/u);
    expect(agentSource).toMatch(/"\*":\s*"deny"/u);
    expect(agentSource).toMatch(/"chat-research-worker":\s*"allow"/u);
    expect(writePrompt).toContain("Write never uses task or subagent workflows");
  });

  it("does not reuse Chat sandbox policy construction", () => {
    for (const source of activationSources) {
      expect(source).not.toMatch(/SandboxManager|wrapWithSandbox|buildChatSandbox(?:Filesystem|Network)Policy/u);
    }

    const activationSource = readSource("../vibefeld/vibefeld-activation.ts");
    expect(activationSource).toContain('import { resolveOpenCodePaths } from "../chat-sandbox-policy"');
    expect(activationSource).not.toMatch(/(?:buildChatSandbox|ChatSandboxPolicy|resolveRuntimeCachePaths)/u);
  });

  it("selects no external confinement tool, profile, or runtime grant in the AF path", () => {
    for (const source of activationSources) {
      expect(source).not.toMatch(/nono/iu);
      expect(source).not.toMatch(/--profile|\bprofile\b/iu);
      expect(source).not.toMatch(/--read\b|--allow\b|\bwrap\b/iu);
      expect(source).not.toMatch(/grant|--read\b|--allow\b|denied[-_ ]?domain/iu);
      expect(source).not.toMatch(/\bnested\b/iu);
      expect(source).not.toMatch(/(?:writeFile|mkdir|configuration\.update)\s*\(/u);
      expect(source).not.toMatch(/execFile\s*\(|spawn\s*\(\s*["']nono["']/iu);
    }

    const directPolicySource = readSource("../vibefeld/af-direct-policy.ts");
    expect(directPolicySource).toContain('const ENVIRONMENT_KEYS = ["PATH", "HOME", "XDG_CONFIG_HOME"]');
    expect(directPolicySource).toContain("descriptor.argv.slice(1)");
    expect(directPolicySource).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(directPolicySource).not.toMatch(/shell:\s*true/u);
    expect(directPolicySource).toContain("shell: false");
    expect(directPolicySource).toContain("detached: true");
    expect(commandSchemaSource).toContain('AF_COMMAND_OPERATIONS = ["version", "schema", "init", "status"]');
  });

  it("keeps profile authority absent and does not reuse the Chat sandbox policy", () => {
    for (const source of activationSources) {
      expect(source).not.toMatch(/vibefeld\.nonoProfile|profile-drafts|\/nono\/profiles/iu);
      expect(source).not.toMatch(
        /SandboxManager|wrapWithSandbox|sandbox-exec|buildChatSandbox(?:Filesystem|Network)Policy/u,
      );
    }

    expect(existsSync(new URL("../vibefeld/af-profile-selection.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../../../../docs/vibefeld-nono-profile.md", import.meta.url))).toBe(false);

    const activationSource = readSource("../vibefeld/vibefeld-activation.ts");
    // The path helper is retained only for the host-private OpenCode state
    // location; AF never imports or reuses a Chat sandbox policy.
    expect(activationSource).toContain('import { resolveOpenCodePaths } from "../chat-sandbox-policy"');
    expect(activationSource).not.toMatch(/(?:buildChatSandbox|ChatSandboxPolicy|resolveRuntimeCachePaths)/u);
  });

  it("keeps deferred response-gate, adversarial, Hindsight, and memory-provider paths unactivated", () => {
    for (const source of [...activationSources, ...qualificationSources]) {
      expect(source).not.toMatch(/response[- ]gate|adversarial[- ]review|restricted[- ]context|prover|verifier/iu);
      expect(source).not.toMatch(
        /(?:from\s+["'][^"']*(?:hindsight|memory-provider|memory)[^"']*["']|(?:hindsight_|ctx_|detectMemoryProvider|resolveHindsightPlugin|buildHindsight))/iu,
      );
    }

    expect(readSource("../vibefeld/qualification-recorder.ts")).toContain(
      "Accept exactly `{ latencyMs, status, feedback }`",
    );
    expect(readSource("../vibefeld/qualification-recorder.ts")).toContain(
      'const RECORD_KEYS: readonly string[] = ["latencyMs", "status", "feedback"]',
    );
    expect(readSource("../vibefeld/qualification-store.ts")).toContain("aggregate-only retention");
  });
});
