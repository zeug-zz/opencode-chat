/**
 * Opt-in native proof that the restricted architect's `session.generate`
 * still works while the bundled Scribe context plugin is active. Uses a
 * disposable project-relative workspace, an isolated environment, and a
 * loopback mock provider; no user configuration is read or written.
 *
 * OPENCODE_CHAT_RUN_V2_CONTEXT_PLUGIN_GENERATE=1 pnpm --filter
 * @opencode-chat/agent-opencode exec vitest run --pool=forks
 * src/__tests__/scribe-context-plugin-generate.integration.test.ts
 *
 * Set OPENCODE_CHAT_V2_CONTEXT_PLUGIN_VSIX to a project-relative VSIX path to
 * run the same production-plugin checks against its extracted, hash-pinned bytes.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, join, resolve } from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../index";
import {
  CHAT_REASONING_CRITIC_AGENT_NAME,
  CHAT_REASONING_VERIFIER_AGENT_NAME,
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_PROMPT,
} from "../restricted-review-overlay";
import type { RestrictedReviewProvider } from "../restricted-review-provider";
import { assertOwnedPath } from "./v2-test-isolation";

const RUN_ENABLED = process.env.OPENCODE_CHAT_RUN_V2_CONTEXT_PLUGIN_GENERATE === "1";
const EXECUTABLE = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE ?? "/opt/homebrew/bin/opencode";
const PROJECT_ROOT = resolve(__dirname, "../../../../..");
const PLUGIN_DIRECTORY = resolve(PROJECT_ROOT, "packages/agents/opencode/src/scribe-context-plugin");
const FIXTURE_DIRECTORY = "tmp/scribe-v2-migration/context-plugin-generate";
const OWNER_FILE = ".scribe-context-plugin-generate-owner";
const PLUGIN_ID = "drmrStudio.scribe-reasoning-context";
const ARCHITECT_RESULT = '{"kind":"not-argument"}';
const VSIX_PLUGIN_INPUT = process.env.OPENCODE_CHAT_V2_CONTEXT_PLUGIN_VSIX;
const VSIX_PLUGIN_ENTRIES = {
  packageManifest: "extension/dist/scribe-context-plugin/package.json",
  server: "extension/dist/scribe-context-plugin/server.js",
} as const;
const MAX_VSIX_PLUGIN_FILE_BYTES = 256 * 1024;
const EXPECTED_PLUGIN_SHA256 = "f3d0027584a268bdd0e909729e3451e15e4e7d3fb1eb6856c209670edd96bd94";

type RestrictedStage = "architect" | "prover" | "verifier";
type StageObservation = {
  role: RestrictedStage;
  generated: string | null;
  toolDefinitionCount: number;
  toolDefinitionNames: string[];
};
type CleanupObservation = {
  providerClosed: boolean;
  environmentRestored: boolean;
  fixtureRunRootRemoved: boolean;
};
type ArchitectRun = {
  pluginState: "active" | "absent" | "other";
  pluginSha256: string | null;
  cleanup: CleanupObservation;
  stages: StageObservation[];
  directRoleRequests: Array<{ role: string; toolDefinitionCount: number; toolDefinitionNames: string[] }>;
  toolProbeRequests: Array<{
    role: string;
    toolDefinitionCount: number;
    toolDefinitionNames: string[];
    permissionDenied: boolean;
    skillSentinelPresent: boolean;
  }>;
  providerRequests: number;
  nativeGenerateHookFailure?: {
    restrictedProviderRequestDelta: number;
    scoutProviderRequestDelta: number;
    scoutToolDefinitionNames: string[];
  };
  restrictedFilterFailure?: {
    restrictedProviderRequestDelta: number;
    scoutProviderRequestDelta: number;
    scoutToolDefinitionNames: string[];
  };
};

const SKILL_PROBE_ID = "scribe-restricted-tool-probe";
const SKILL_SENTINEL = "SCRIBE_RESTRICTED_TOOL_PROBE_SENTINEL";
const GENERATE_FAILURE_PLUGIN_ID = "fixture.scribe-generate-hook-failure";
const GENERATE_FAILURE_RPC_ID = "scribe_generate_hook_failure_probe";
const GENERATE_FAILURE_RPC_DEFINITION = {
  id: GENERATE_FAILURE_RPC_ID,
  events: {},
  methods: {
    arm: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { armed: { type: "boolean" } },
        required: ["armed"],
        additionalProperties: false,
      },
    },
    armMalformed: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { armed: { type: "boolean" } },
        required: ["armed"],
        additionalProperties: false,
      },
    },
  },
} as const;
const DIRECT_RESTRICTED_ROLES = [
  {
    role: "architect-generate",
    agent: RESTRICTED_REVIEW_AGENT_NAME,
    operation: "generate",
    marker: "SYNTHETIC_RESTRICTED_ROLE_ARCHITECT_GENERATE",
    toolProbeMarker: "SYNTHETIC_RESTRICTED_TOOL_PROBE_ARCHITECT_GENERATE",
  },
  {
    role: "manual-prover-prompt",
    agent: RESTRICTED_REVIEW_AGENT_NAME,
    operation: "prompt",
    marker: "SYNTHETIC_RESTRICTED_ROLE_MANUAL_PROVER",
    toolProbeMarker: "SYNTHETIC_RESTRICTED_TOOL_PROBE_MANUAL_PROVER",
  },
  {
    role: "manual-verifier-prompt",
    agent: RESTRICTED_REVIEW_AGENT_NAME,
    operation: "prompt",
    marker: "SYNTHETIC_RESTRICTED_ROLE_MANUAL_VERIFIER",
    toolProbeMarker: "SYNTHETIC_RESTRICTED_TOOL_PROBE_MANUAL_VERIFIER",
  },
  {
    role: "hidden-critic-prompt",
    agent: CHAT_REASONING_CRITIC_AGENT_NAME,
    operation: "prompt",
    marker: "SYNTHETIC_RESTRICTED_ROLE_HIDDEN_CRITIC",
    toolProbeMarker: "SYNTHETIC_RESTRICTED_TOOL_PROBE_HIDDEN_CRITIC",
  },
  {
    role: "hidden-verifier-prompt",
    agent: CHAT_REASONING_VERIFIER_AGENT_NAME,
    operation: "prompt",
    marker: "SYNTHETIC_RESTRICTED_ROLE_HIDDEN_VERIFIER",
    toolProbeMarker: "SYNTHETIC_RESTRICTED_TOOL_PROBE_HIDDEN_VERIFIER",
  },
] as const;
const UNCHANGED_ROLES = [
  { role: "scout", agent: "scout", marker: "SYNTHETIC_UNCHANGED_ROLE_SCOUT" },
  { role: "worker", agent: "chat-research-worker", marker: "SYNTHETIC_UNCHANGED_ROLE_WORKER" },
  { role: "write", agent: "build", marker: "SYNTHETIC_UNCHANGED_ROLE_WRITE" },
] as const;
const DIRECT_UNCHANGED_GENERATE_ROLES = [
  { role: "scout-generate", agent: "scout", marker: "SYNTHETIC_UNCHANGED_GENERATE_SCOUT" },
  { role: "worker-generate", agent: "chat-research-worker", marker: "SYNTHETIC_UNCHANGED_GENERATE_WORKER" },
  { role: "write-generate", agent: "build", marker: "SYNTHETIC_UNCHANGED_GENERATE_WRITE" },
] as const;

function toolNames(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("tools" in value) || !Array.isArray(value.tools)) return [];
  return value.tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") return [];
    if ("function" in tool && tool.function && typeof tool.function === "object" && "name" in tool.function) {
      return typeof tool.function.name === "string" ? [tool.function.name] : [];
    }
    return "name" in tool && typeof tool.name === "string" ? [tool.name] : [];
  });
}

function rpcArmed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { output?: unknown; armed?: unknown };
  const output = record.output && typeof record.output === "object" ? (record.output as { armed?: unknown }) : record;
  return output.armed === true;
}

function lastToolResultText(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("messages" in value) || !Array.isArray(value.messages)) return null;
  const last = value.messages.at(-1);
  if (!last || typeof last !== "object" || !("role" in last) || last.role !== "tool") return null;
  if (!("content" in last)) return null;
  if (typeof last.content === "string") return last.content;
  if (!Array.isArray(last.content)) return null;
  return last.content
    .flatMap((part: unknown) =>
      part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
}

function skillToolCallSse(callID: string): string {
  const packet = (delta: Record<string, unknown>, finishReason: string | null = null) =>
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
  return `${packet({
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: callID,
        type: "function",
        function: { name: "skill", arguments: JSON.stringify({ id: SKILL_PROBE_ID }) },
      },
    ],
  })}${packet({}, "tool_calls")}data: [DONE]\n\n`;
}

function sse(text: string): string {
  const packet = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
  return `${packet({ role: "assistant" })}${packet({ content: text })}${packet({}, "stop")}data: [DONE]\n\n`;
}

async function pluginState(client: OpenCodeClient, directory: string): Promise<ArchitectRun["pluginState"]> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const listed: unknown = await client.plugin.list({ location: { directory } });
    const data = (listed as { data?: unknown }).data;
    const entry = Array.isArray(data)
      ? (data as Array<{ id?: unknown; state?: { status?: unknown } }>).find((candidate) => candidate.id === PLUGIN_ID)
      : undefined;
    if (entry?.state?.status === "active") return "active";
    if (entry !== undefined) return "other";
    await new Promise((done) => setTimeout(done, 200));
  }
  return "absent";
}

function digestPluginFiles(packageManifest: Uint8Array, server: Uint8Array): string {
  return createHash("sha256")
    .update("package.json\0")
    .update(packageManifest)
    .update("\0server.js\0")
    .update(server)
    .digest("hex");
}

function readVsixPluginEntry(projectRoot: string, vsixPath: string, entry: string, home: string, tmp: string): Buffer {
  return execFileSync("unzip", ["-p", vsixPath, entry], {
    cwd: projectRoot,
    env: { PATH: "/usr/bin:/bin", HOME: home, TMPDIR: tmp },
    maxBuffer: MAX_VSIX_PLUGIN_FILE_BYTES,
  });
}

function environmentMatches(snapshot: NodeJS.ProcessEnv): boolean {
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(process.env)]);
  return [...keys].every((key) => snapshot[key] === process.env[key]);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function runRestrictedStages(withPlugin: boolean, nativeGenerateHookFailure = false): Promise<ArchitectRun> {
  const originalEnvironment = { ...process.env };
  const projectRoot = await realpath(PROJECT_ROOT);
  const fixtureRoot = resolve(projectRoot, FIXTURE_DIRECTORY);
  await assertOwnedPath(projectRoot, fixtureRoot);
  await mkdir(fixtureRoot, { recursive: true });
  await assertOwnedPath(projectRoot, fixtureRoot);
  const runRoot = join(fixtureRoot, `run-${randomUUID()}`);
  await mkdir(runRoot, { recursive: false });
  await assertOwnedPath(fixtureRoot, runRoot);
  const ownerToken = randomUUID();
  await writeFile(join(runRoot, OWNER_FILE), ownerToken, { flag: "wx", mode: 0o600 });
  const cleanup: CleanupObservation = {
    providerClosed: false,
    environmentRestored: false,
    fixtureRunRootRemoved: false,
  };

  try {
    const result = await runRestrictedStagesInRoot(
      runRoot,
      projectRoot,
      withPlugin,
      cleanup,
      nativeGenerateHookFailure,
    );
    if ((await readFile(join(runRoot, OWNER_FILE), "utf8")) !== ownerToken) {
      throw new Error("Fixture run root owner marker changed during the test");
    }
    return result;
  } finally {
    await assertOwnedPath(fixtureRoot, runRoot);
    if ((await readFile(join(runRoot, OWNER_FILE), "utf8")) === ownerToken) {
      await rm(runRoot, { recursive: true, force: false, maxRetries: 0 });
      cleanup.fixtureRunRootRemoved = !(await pathExists(runRoot));
    }
    cleanup.environmentRestored = environmentMatches(originalEnvironment);
  }
}

async function runRestrictedStagesInRoot(
  runRoot: string,
  projectRoot: string,
  withPlugin: boolean,
  cleanup: CleanupObservation,
  nativeGenerateHookFailure = false,
): Promise<ArchitectRun> {
  const paths = {
    home: join(runRoot, "home"),
    config: join(runRoot, "xdg-config"),
    data: join(runRoot, "xdg-data"),
    cache: join(runRoot, "xdg-cache"),
    state: join(runRoot, "xdg-state"),
    tmp: join(runRoot, "tmp"),
    cwd: join(runRoot, "cwd"),
  };
  for (const directory of Object.values(paths)) await mkdir(directory, { recursive: true });
  const configDirectory = join(paths.config, "opencode");
  await mkdir(configDirectory, { recursive: true });
  let pluginDirectory = PLUGIN_DIRECTORY;
  let pluginSha256: string | null = null;
  if (withPlugin) {
    let pluginPackage: Buffer;
    let pluginServer: Buffer;
    if (VSIX_PLUGIN_INPUT === undefined) {
      await assertOwnedPath(projectRoot, PLUGIN_DIRECTORY);
      [pluginPackage, pluginServer] = await Promise.all([
        readFile(join(PLUGIN_DIRECTORY, "package.json")),
        readFile(join(PLUGIN_DIRECTORY, "server.js")),
      ]);
    } else {
      if (isAbsolute(VSIX_PLUGIN_INPUT)) throw new Error("vsix_input_must_be_project_relative");
      const vsixPath = resolve(projectRoot, VSIX_PLUGIN_INPUT);
      await assertOwnedPath(projectRoot, vsixPath);
      if (!(await stat(vsixPath)).isFile()) throw new Error("vsix_input_not_a_file");
      [pluginPackage, pluginServer] = [
        readVsixPluginEntry(projectRoot, vsixPath, VSIX_PLUGIN_ENTRIES.packageManifest, paths.home, paths.tmp),
        readVsixPluginEntry(projectRoot, vsixPath, VSIX_PLUGIN_ENTRIES.server, paths.home, paths.tmp),
      ];
      if (
        pluginPackage.byteLength > MAX_VSIX_PLUGIN_FILE_BYTES ||
        pluginServer.byteLength > MAX_VSIX_PLUGIN_FILE_BYTES
      ) {
        throw new Error("vsix_plugin_entry_exceeds_bound");
      }
      pluginDirectory = join(runRoot, "extracted-scribe-context-plugin");
      await assertOwnedPath(runRoot, pluginDirectory);
      await mkdir(pluginDirectory, { recursive: false });
      await Promise.all([
        writeFile(join(pluginDirectory, "package.json"), pluginPackage, { flag: "wx", mode: 0o600 }),
        writeFile(join(pluginDirectory, "server.js"), pluginServer, { flag: "wx", mode: 0o600 }),
      ]);
    }
    pluginSha256 = digestPluginFiles(pluginPackage, pluginServer);
    if (pluginSha256 !== EXPECTED_PLUGIN_SHA256) throw new Error("production_plugin_sha256_mismatch");
  }
  const generateFailurePluginDirectory = join(runRoot, "generate-hook-failure-plugin");
  if (withPlugin || nativeGenerateHookFailure) {
    await mkdir(generateFailurePluginDirectory, { recursive: true });
    await writeFile(
      join(generateFailurePluginDirectory, "package.json"),
      JSON.stringify({ name: "scribe-generate-hook-failure-probe", private: true, type: "module" }),
      { mode: 0o600 },
    );
    await writeFile(
      join(generateFailurePluginDirectory, "server.js"),
      `const definition = ${JSON.stringify(GENERATE_FAILURE_RPC_DEFINITION)};
export default {
  id: ${JSON.stringify(GENERATE_FAILURE_PLUGIN_ID)},
  async setup(ctx) {
    let failureMode = null;
    const rpc = await ctx.rpc.register(definition, {
      arm: async () => {
        failureMode = "throw";
        return { armed: true };
      },
      armMalformed: async () => {
        failureMode = "malformed";
        return { armed: true };
      },
    });
    const hook = await ctx.session.hook("generate", (event) => {
      if (!failureMode || !event || event.agent !== "vibefeld-restricted-review") return;
      const mode = failureMode;
      failureMode = null;
      if (mode === "malformed") {
        event.tools = null;
        return;
      }
      throw new Error("fixture generate hook failure");
    });
    return async () => Promise.all([rpc.dispose(), hook.dispose()]);
  },
};
`,
      { mode: 0o600 },
    );
  }

  let providerRequests = 0;
  const stages: StageObservation[] = [];
  const directRoleRequests: ArchitectRun["directRoleRequests"] = [];
  const toolProbeRequests: ArchitectRun["toolProbeRequests"] = [];
  const toolProbeRequestCounts = new Map<string, number>();
  const toolDefinitionCounts: number[] = [];
  const toolDefinitionNames: string[][] = [];
  const provider: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const _chunk of request) {
      chunks.push(Buffer.isBuffer(_chunk) ? _chunk : Buffer.from(_chunk));
    }
    providerRequests += 1;
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      body = undefined;
    }
    const names = toolNames(body);
    const definitionCount =
      body && typeof body === "object" && "tools" in body ? (Array.isArray(body.tools) ? body.tools.length : -1) : 0;
    toolDefinitionCounts.push(definitionCount);
    toolDefinitionNames.push(names);
    const serializedBody = JSON.stringify(body);
    const toolProbe = DIRECT_RESTRICTED_ROLES.find(({ toolProbeMarker }) => serializedBody.includes(toolProbeMarker));
    if (toolProbe) {
      const requestCount = (toolProbeRequestCounts.get(toolProbe.role) ?? 0) + 1;
      toolProbeRequestCounts.set(toolProbe.role, requestCount);
      toolProbeRequests.push({
        role: toolProbe.role,
        toolDefinitionCount: definitionCount,
        toolDefinitionNames: names,
        permissionDenied: /permission denied: skill\b/iu.test(lastToolResultText(body) ?? ""),
        skillSentinelPresent: serializedBody.includes(SKILL_SENTINEL),
      });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(requestCount === 1 ? skillToolCallSse(`probe-${toolProbe.role}`) : sse(ARCHITECT_RESULT));
      return;
    }
    const directRole =
      DIRECT_RESTRICTED_ROLES.find(({ marker }) => serializedBody.includes(marker)) ??
      DIRECT_UNCHANGED_GENERATE_ROLES.find(({ marker }) => serializedBody.includes(marker)) ??
      UNCHANGED_ROLES.find(({ marker }) => serializedBody.includes(marker));
    if (directRole)
      directRoleRequests.push({
        role: directRole.role,
        toolDefinitionCount: definitionCount,
        toolDefinitionNames: names,
      });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(sse(ARCHITECT_RESULT));
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const address = provider.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await writeFile(
    join(configDirectory, "opencode.json"),
    JSON.stringify({
      model: "fixture-provider/fixture-model",
      enabledProviders: ["fixture-provider"],
      providers: {
        "fixture-provider": {
          name: "Fixture",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `http://127.0.0.1:${port}/v1` },
          models: { "fixture-model": { name: "Fixture" } },
        },
      },
    }),
    { mode: 0o600 },
  );
  const skillDirectory = join(configDirectory, "skills", SKILL_PROBE_ID);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    `---\nname: ${SKILL_PROBE_ID}\ndescription: Harmless permission denial probe.\n---\n\n${SKILL_SENTINEL}\n`,
    { mode: 0o600 },
  );

  const originalEnvironment = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, {
    PATH: "/usr/bin:/bin",
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    OPENCODE_DB: join(runRoot, "database.sqlite"),
    TMPDIR: paths.tmp,
    OPENCODE_TEST_HOME: paths.home,
    OPENCODE_CONFIG_DIR: configDirectory,
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  });
  const agent = new OpenCodeAgent({
    workspacePath: paths.cwd,
    hostPaths: { config: configDirectory, state: paths.state },
    backend: "sdk",
    sandbox: {
      mode: "off",
      enabled: false,
      allowNetwork: true,
      filesystemPolicy: { readWritePaths: [paths.cwd], readOnlyPaths: [] },
    },
    executable: { path: EXECUTABLE },
    pluginSources: nativeGenerateHookFailure
      ? [{ package: generateFailurePluginDirectory }]
      : withPlugin
        ? [{ package: generateFailurePluginDirectory }, { package: pluginDirectory }]
        : [],
    restrictedReview: { modelResolution: "native-default", prompt: RESTRICTED_REVIEW_PROMPT, maxSteps: 4 },
  });
  let review: RestrictedReviewProvider | undefined;
  let reviewToken: number | undefined;
  try {
    await agent.connect();
    const client = (agent as unknown as { v2Client: OpenCodeClient }).v2Client;
    if (nativeGenerateHookFailure) {
      const location = { location: { directory: paths.cwd } };
      const failureRpc = client.rpc(GENERATE_FAILURE_RPC_DEFINITION);
      const armed = await failureRpc.arm({}, location);
      if (!rpcArmed(armed)) throw new Error("native_generate_hook_probe_not_armed");
      const restricted = await client.session.create({
        title: "context-plugin-native-generate-hook-failure",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        location: { directory: paths.cwd },
      });
      const beforeRestrictedGenerate = providerRequests;
      try {
        await client.session.generate({
          sessionID: restricted.id,
          prompt: "SYNTHETIC_NATIVE_GENERATE_HOOK_FAILURE",
        });
      } catch {
        // The native boundary is qualified by whether the provider receives a request.
      }
      const restrictedProviderRequestDelta = providerRequests - beforeRestrictedGenerate;
      const scout = await client.session.create({
        title: "context-plugin-scout-after-generate-hook-failure",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      const beforeScoutGenerate = providerRequests;
      await client.session.generate({
        sessionID: scout.id,
        prompt: "SYNTHETIC_NATIVE_SCOUT_AFTER_GENERATE_HOOK_FAILURE",
      });
      const scoutProviderRequestDelta = providerRequests - beforeScoutGenerate;
      return {
        pluginState: "absent",
        pluginSha256,
        cleanup,
        stages,
        directRoleRequests,
        toolProbeRequests,
        providerRequests,
        nativeGenerateHookFailure: {
          restrictedProviderRequestDelta,
          scoutProviderRequestDelta,
          scoutToolDefinitionNames: toolDefinitionNames.at(-1) ?? [],
        },
      };
    }
    const state = withPlugin ? await pluginState(client, paths.cwd) : "absent";
    const resolution = await agent.createRestrictedReviewProviderForNativeDefault();
    if (!resolution.ok)
      return {
        pluginState: state,
        pluginSha256,
        cleanup,
        stages,
        directRoleRequests,
        toolProbeRequests,
        providerRequests,
      };
    review = resolution.provider;
    if (!(await review.checkReadiness()))
      return {
        pluginState: state,
        pluginSha256,
        cleanup,
        stages,
        directRoleRequests,
        toolProbeRequests,
        providerRequests,
      };
    reviewToken = await review.beginReview();
    for (const role of ["architect", "prover", "verifier"] as const) {
      const session = await review.createSession(`context-plugin-${role}`);
      if (!session.ok) {
        stages.push({ role, generated: null, toolDefinitionCount: -1, toolDefinitionNames: [] });
        continue;
      }
      const result = await review.runStage(session.sessionId, `fixture packet ${role}`, 30_000, role);
      const observationIndex = stages.length;
      stages.push({
        role,
        generated: result.ok && "text" in result ? result.text : null,
        toolDefinitionCount: toolDefinitionCounts[observationIndex] ?? -1,
        toolDefinitionNames: toolDefinitionNames[observationIndex] ?? [],
      });
    }
    for (const entry of DIRECT_RESTRICTED_ROLES) {
      const session = await client.session.create({
        title: `context-plugin-${entry.role}`,
        agent: entry.agent,
        location: { directory: paths.cwd },
      });
      if (entry.operation === "generate") {
        await client.session.generate({ sessionID: session.id, prompt: entry.marker });
      } else {
        await client.session.prompt({ sessionID: session.id, text: entry.marker });
        await client.session.wait({ sessionID: session.id });
      }
      await client.session.prompt({ sessionID: session.id, text: entry.toolProbeMarker });
      await client.session.wait({ sessionID: session.id });
    }
    for (const entry of UNCHANGED_ROLES) {
      const session = await client.session.create({
        title: `context-plugin-${entry.role}`,
        agent: entry.agent,
        location: { directory: paths.cwd },
      });
      await client.session.prompt({ sessionID: session.id, text: entry.marker });
      await client.session.wait({ sessionID: session.id });
    }
    for (const entry of DIRECT_UNCHANGED_GENERATE_ROLES) {
      const session = await client.session.create({
        title: `context-plugin-${entry.role}`,
        agent: entry.agent,
        location: { directory: paths.cwd },
      });
      await client.session.generate({ sessionID: session.id, prompt: entry.marker });
    }

    let restrictedFilterFailure: ArchitectRun["restrictedFilterFailure"];
    if (withPlugin) {
      const failureRpc = client.rpc(GENERATE_FAILURE_RPC_DEFINITION);
      const armed = await failureRpc.armMalformed({}, { location: { directory: paths.cwd } });
      if (!rpcArmed(armed)) throw new Error("restricted_filter_failure_probe_not_armed");
      const restricted = await client.session.create({
        title: "context-plugin-malformed-restricted-generate-tools",
        agent: RESTRICTED_REVIEW_AGENT_NAME,
        location: { directory: paths.cwd },
      });
      const beforeRestrictedGenerate = providerRequests;
      try {
        await client.session.generate({
          sessionID: restricted.id,
          prompt: "SYNTHETIC_MALFORMED_RESTRICTED_GENERATE_TOOLS",
        });
      } catch {
        // The provider request count below is the decisive native boundary assertion.
      }
      const restrictedProviderRequestDelta = providerRequests - beforeRestrictedGenerate;
      const scout = await client.session.create({
        title: "context-plugin-scout-after-malformed-restricted-tools",
        agent: "scout",
        location: { directory: paths.cwd },
      });
      const beforeScoutGenerate = providerRequests;
      await client.session.generate({
        sessionID: scout.id,
        prompt: "SYNTHETIC_SCOUT_AFTER_MALFORMED_RESTRICTED_TOOLS",
      });
      restrictedFilterFailure = {
        restrictedProviderRequestDelta,
        scoutProviderRequestDelta: providerRequests - beforeScoutGenerate,
        scoutToolDefinitionNames: toolDefinitionNames.at(-1) ?? [],
      };
    }
    return {
      pluginState: state,
      pluginSha256,
      cleanup,
      stages,
      directRoleRequests,
      toolProbeRequests,
      providerRequests,
      ...(restrictedFilterFailure ? { restrictedFilterFailure } : {}),
    };
  } finally {
    if (review && reviewToken !== undefined) await review.cancelReview(reviewToken);
    agent.disconnect();
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
    await new Promise<void>((done) => provider.close(() => done()));
    cleanup.providerClosed = true;
  }
}

describe.skipIf(!RUN_ENABLED)("restricted architect generate with the Scribe context plugin", () => {
  it("preserves architect and manual stages while keeping every restricted request tool-less", async () => {
    const without = await runRestrictedStages(false);
    const withPlugin = await runRestrictedStages(true);

    expect(without).toMatchObject({
      pluginState: "absent",
      stages: [
        { role: "architect", generated: ARCHITECT_RESULT },
        { role: "prover", generated: ARCHITECT_RESULT },
        { role: "verifier", generated: ARCHITECT_RESULT },
      ],
    });
    expect(without.cleanup).toEqual({
      providerClosed: true,
      environmentRestored: true,
      fixtureRunRootRemoved: true,
    });
    expect(withPlugin).toMatchObject({
      pluginState: "active",
      stages: [
        { role: "architect", generated: ARCHITECT_RESULT, toolDefinitionCount: 0, toolDefinitionNames: [] },
        { role: "prover", generated: ARCHITECT_RESULT, toolDefinitionCount: 0, toolDefinitionNames: [] },
        { role: "verifier", generated: ARCHITECT_RESULT, toolDefinitionCount: 0, toolDefinitionNames: [] },
      ],
    });
    expect(withPlugin.pluginSha256).toBe(EXPECTED_PLUGIN_SHA256);
    expect(withPlugin.cleanup).toEqual({
      providerClosed: true,
      environmentRestored: true,
      fixtureRunRootRemoved: true,
    });
    const withRestrictedRoles = withPlugin.directRoleRequests.filter(({ role }) =>
      DIRECT_RESTRICTED_ROLES.some((entry) => entry.role === role),
    );
    expect(withRestrictedRoles).toEqual(
      DIRECT_RESTRICTED_ROLES.map(({ role }) => ({ role, toolDefinitionCount: 0, toolDefinitionNames: [] })),
    );
    expect(without.directRoleRequests.find(({ role }) => role === "architect-generate")).toEqual({
      role: "architect-generate",
      toolDefinitionCount: 1,
      toolDefinitionNames: ["skill"],
    });
    const restrictedToolProbes = withPlugin.toolProbeRequests.filter(({ role }) =>
      DIRECT_RESTRICTED_ROLES.some((entry) => entry.role === role),
    );
    expect(new Set(restrictedToolProbes.map(({ role }) => role)).size).toBe(DIRECT_RESTRICTED_ROLES.length);
    expect(
      restrictedToolProbes.every(
        ({ toolDefinitionCount, toolDefinitionNames }) => toolDefinitionCount === 0 && toolDefinitionNames.length === 0,
      ),
    ).toBe(true);
    expect(restrictedToolProbes.every((entry) => !entry.skillSentinelPresent)).toBe(true);
    const architectPermissionProbe = without.toolProbeRequests.filter(({ role }) => role === "architect-generate");
    expect(architectPermissionProbe.some((entry) => entry.permissionDenied)).toBe(true);
    expect(architectPermissionProbe.every((entry) => !entry.skillSentinelPresent)).toBe(true);
    const withoutUnchanged = without.directRoleRequests.filter(
      ({ role }) =>
        UNCHANGED_ROLES.some((entry) => entry.role === role) ||
        DIRECT_UNCHANGED_GENERATE_ROLES.some((entry) => entry.role === role),
    );
    const withUnchanged = withPlugin.directRoleRequests.filter(
      ({ role }) =>
        UNCHANGED_ROLES.some((entry) => entry.role === role) ||
        DIRECT_UNCHANGED_GENERATE_ROLES.some((entry) => entry.role === role),
    );
    expect(withUnchanged).toEqual(withoutUnchanged);
    const scoutGenerate = withPlugin.directRoleRequests.find(({ role }) => role === "scout-generate");
    expect(scoutGenerate?.toolDefinitionNames).toContain("execute");
    expect(withPlugin.restrictedFilterFailure).toEqual({
      restrictedProviderRequestDelta: 0,
      scoutProviderRequestDelta: 1,
      scoutToolDefinitionNames: expect.arrayContaining(["execute"]),
    });
  }, 120_000);

  it("does not run the provider after a native restricted generate-hook throw and keeps Scout usable", async () => {
    const observation = await runRestrictedStages(false, true);

    expect(observation.nativeGenerateHookFailure).toEqual({
      restrictedProviderRequestDelta: 0,
      scoutProviderRequestDelta: 1,
      scoutToolDefinitionNames: expect.arrayContaining(["execute"]),
    });
    expect(observation.cleanup).toEqual({
      providerClosed: true,
      environmentRestored: true,
      fixtureRunRootRemoved: true,
    });
  }, 120_000);
});
