import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chdir, cwd } from "node:process";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { afterEach, describe, expect, it } from "vitest";

const fixtureWorkspace = new URL("./fixtures/agents-md-fallback/", import.meta.url).pathname;
const guidanceMarker = "AGENTS-FALLBACK-FIXTURE-7C91";
const workspaceMarker = "ORDINARY-WORKSPACE-CONTEXT-FIXTURE-4A2E";

let previousWorkingDirectory: string;
let modelServer: ReturnType<typeof createServer> | undefined;
let opencodeProcess: ChildProcess | undefined;
const capturedRequests: Array<Record<string, unknown>> = [];
const capturedPromptOptions: Array<Record<string, unknown>> = [];

async function readRequest(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function sendFakeCompletion(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    `data: ${JSON.stringify({
      id: "fixture-completion",
      choices: [{ delta: { role: "assistant", content: "fixture response" }, index: 0, finish_reason: null }],
    })}\n\n` +
      `data: ${JSON.stringify({
        id: "fixture-completion",
        choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
      })}\n\ndata: [DONE]\n\n`,
  );
}

async function startOpenCodeServer(config: Record<string, unknown>): Promise<string> {
  const child = spawn("opencode", ["serve", "--pure", "--hostname=127.0.0.1", "--port=0"], {
    cwd: fixtureWorkspace,
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  opencodeProcess = child;
  let output = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for fixture OpenCode server")), 15_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/on (https?:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture OpenCode server exited before readiness (${code})`));
    });
  });
}

async function waitForCapturedRequest(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  while (!capturedRequests.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  if (!capturedRequests.length) throw new Error("Fixture model did not receive an OpenCode request");
  return capturedRequests.at(-1)!;
}

afterEach(() => {
  opencodeProcess?.kill("SIGTERM");
  opencodeProcess = undefined;
  modelServer?.close();
  modelServer = undefined;
  capturedRequests.length = 0;
  capturedPromptOptions.length = 0;
  if (previousWorkingDirectory) chdir(previousWorkingDirectory);
});

describe("OpenCode AGENTS.md integration fixture", () => {
  it.each([
    ["scout", "Chat/Scout"],
    ["build", "Write/Build"],
  ] as const)(
    "captures the actual server-assembled request context for %s",
    async (agent, mode) => {
      previousWorkingDirectory = cwd();
      chdir(fixtureWorkspace);
      modelServer = createServer(async (request, response) => {
        capturedRequests.push(JSON.parse(await readRequest(request)) as Record<string, unknown>);
        sendFakeCompletion(response);
      });
      await new Promise<void>((resolve) => modelServer?.listen(0, "127.0.0.1", resolve));
      const address = modelServer.address();
      if (!address || typeof address === "string") throw new Error("Fixture model did not bind to a TCP port");

      const baseUrl = await startOpenCodeServer({
        provider: {
          fixture: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: `http://127.0.0.1:${address.port}` },
            models: { "fixture-model": { name: "fixture-model" } },
          },
        },
        agent: {
          scout: {
            mode: "all",
            description: "Read-only Chat/Scout fixture agent.",
            permission: { "*": "deny", read: "allow" },
          },
          build: {
            description: "Write/Build fixture agent.",
            permission: { "*": "deny", read: "allow", edit: "allow" },
          },
        },
      });
      const client = createOpencodeClient({
        baseUrl,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (request.url.endsWith("/prompt_async")) {
            capturedPromptOptions.push(JSON.parse(await request.clone().text()) as Record<string, unknown>);
          }
          return fetch(request);
        },
      });
      const session = await client.session.create({ title: `${mode} AGENTS fixture request` });
      await client.session.promptAsync({
        sessionID: session.data!.id,
        parts: [{ type: "text", text: `Read ${workspaceMarker} and follow the fixture guidance.` }],
        model: { providerID: "fixture", modelID: "fixture-model" },
        agent,
      });

      expect(capturedPromptOptions).toContainEqual(expect.objectContaining({ agent }));
      const request = await waitForCapturedRequest();
      const messages = (request.messages ?? []) as Array<{ content?: string | Array<{ text?: string }> }>;
      const text = messages
        .flatMap((message) =>
          typeof message.content === "string"
            ? [message.content]
            : (message.content ?? []).map((part) => part.text ?? ""),
        )
        .join("\n");
      expect(text).toContain(guidanceMarker);
      expect(text).toContain(workspaceMarker);
      const messagesResponse = await client.session.messages({ sessionID: session.data!.id });
      expect(JSON.stringify(messagesResponse.data)).toContain("fixture response");
    },
    30_000,
  );
});
