/**
 * Opt-in live proof for the host-owned restricted review context.
 *
 * Maintainers may run it with a resolvable OpenCode provider/model, for
 * example: `OPENCODE_CHAT_RUN_RESTRICTED_REVIEW_LIVE=1
 * OPENCODE_CHAT_RESTRICTED_REVIEW_MODEL=anthropic/claude-sonnet-4 pnpm
 * --filter @opencode-chat/agent-opencode exec vitest run
 * src/__tests__/restricted-review-live.test.ts`. The server receives only an
 * in-memory overlay and uses a disposable project-relative `tmp/` workspace;
 * no global or workspace configuration is written.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChatMessageWithParts, MessagePart } from "@opencode-chat/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../index";
import { buildChatOverlay } from "../opencode-agent";
import {
  RESTRICTED_REVIEW_AGENT_NAME,
  RESTRICTED_REVIEW_AUTHORITIES,
  RESTRICTED_REVIEW_PROMPT,
} from "../restricted-review-overlay";
import {
  MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS,
  MAX_RESTRICTED_REVIEW_TEXT_LENGTH,
  mintRestrictedReviewProvenance,
  type RestrictedReviewProvider,
} from "../restricted-review-provider";

const liveOptIn = process.env.OPENCODE_CHAT_RUN_RESTRICTED_REVIEW_LIVE === "1";
const hostModel = process.env.OPENCODE_CHAT_RESTRICTED_REVIEW_MODEL?.trim();
const canRun = liveOptIn && Boolean(hostModel?.includes("/"));
const timeoutMs = MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS + 15_000;
const dynamicToolName = "live-dynamic-review-tool";
const sentinel = "RESTRICTED_REVIEW_SENTINEL_7F19";

type FileSnapshot = { exists: boolean; content?: string; mtimeMs?: number };

async function snapshot(filePath: string): Promise<FileSnapshot> {
  try {
    const [stat, content] = await Promise.all([fs.stat(filePath), fs.readFile(filePath, "utf8")]);
    return { exists: true, content, mtimeMs: stat.mtimeMs };
  } catch {
    return { exists: false };
  }
}

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assistantResponse(messages: readonly unknown[]): string {
  return messages
    .filter((message) => {
      if (!message || typeof message !== "object") return false;
      return (message as { info?: { role?: string } }).info?.role === "assistant";
    })
    .map((message) => JSON.stringify(message))
    .join("\n")
    .slice(0, MAX_RESTRICTED_REVIEW_TEXT_LENGTH);
}

function assertNoToolPartsOrSentinel(messages: readonly ChatMessageWithParts[], sentinelText: string): void {
  const parts: MessagePart[] = messages.flatMap((message) => message.parts);
  expect(parts.some((part) => part.type === "tool")).toBe(false);
  expect(parts.some((part) => Object.hasOwn(part, "tool") || Object.hasOwn(part, "state"))).toBe(false);
  for (const part of parts) {
    if (part.type === "text" || part.type === "reasoning") expect(part.text).not.toContain(sentinelText);
  }
}

async function sessionIds(agent: OpenCodeAgent): Promise<Set<string>> {
  return new Set((await agent.listSessions()).map((session) => session.id));
}

describe.skipIf(!canRun)(
  "restricted review live proof (set OPENCODE_CHAT_RUN_RESTRICTED_REVIEW_LIVE=1 and OPENCODE_CHAT_RESTRICTED_REVIEW_MODEL)",
  () => {
    let root: string;
    let workspace: string;
    let agent: OpenCodeAgent;
    let provider: RestrictedReviewProvider;
    let configFiles: string[];
    let beforeConfig: Map<string, FileSnapshot>;
    let previousCwd: string;

    beforeAll(async () => {
      previousCwd = process.cwd();
      const tempParent = path.resolve("tmp");
      await fs.mkdir(tempParent, { recursive: true });
      root = await fs.mkdtemp(path.join(tempParent, "restricted-review-live-"));
      workspace = path.join(root, "workspace");
      await fs.mkdir(workspace, { recursive: true });
      await fs.writeFile(path.join(workspace, "sentinel.txt"), sentinel, "utf8");
      process.chdir(workspace);

      const globalConfigDir = process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
        : path.join(process.env.HOME ?? "", ".config", "opencode");
      configFiles = [
        path.join(globalConfigDir, "opencode.json"),
        path.join(globalConfigDir, "opencode.jsonc"),
        path.join(workspace, "opencode.json"),
        path.join(workspace, "opencode.jsonc"),
        path.join(workspace, ".opencode", "opencode.json"),
        path.join(workspace, ".opencode", "opencode.jsonc"),
      ];
      beforeConfig = new Map(await Promise.all(configFiles.map(async (file) => [file, await snapshot(file)] as const)));

      const restrictedReview = {
        model: hostModel!,
        prompt: RESTRICTED_REVIEW_PROMPT,
        maxSteps: 4,
        dynamicToolNames: [dynamicToolName],
      };
      const overlay = buildChatOverlay([], undefined, undefined, undefined, undefined, false, "sdk", restrictedReview);
      agent = new OpenCodeAgent({
        workspacePath: workspace,
        backend: "sdk",
        sandbox: {
          mode: "off",
          enabled: false,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [workspace], readOnlyPaths: [] },
          networkPolicy: { enabled: true, allowedDomains: [], deniedDomains: [], allowLocalBinding: true },
        },
        executable: { path: "opencode" },
        restrictedReview,
      });

      // The test intentionally uses the same buildChatOverlay/create-server path
      // as OpenCodeAgent.connect; the agent is then connected against this
      // disposable in-memory server configuration.
      await withTimeout(
        (async () => {
          // The public agent path composes the overlay itself. Keep this call's
          // result as an assertion that the host-composed fixture is the one used.
          expect((overlay.agent as Record<string, unknown>)[RESTRICTED_REVIEW_AGENT_NAME]).toBeDefined();
          await agent.connect();
        })(),
        "restricted review server startup",
      );
      provider = agent.createRestrictedReviewProvider({
        providerID: hostModel!.split("/", 1)[0]!,
        modelID: hostModel!.slice(hostModel!.indexOf("/") + 1),
      })!;
      expect(provider).toBeDefined();
      expect(await provider.checkReadiness()).toBe(true);
    }, timeoutMs);

    afterAll(async () => {
      try {
        agent?.disconnect();
      } finally {
        if (previousCwd) process.chdir(previousCwd);
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it(
      "proves the effective deny map, dynamic authority, hidden invocation, and provenance",
      async () => {
        const config = (await agent.getConfig()) as unknown as {
          agent?: Record<
            string,
            { model?: string; prompt?: string; hidden?: boolean; permission?: Record<string, string> }
          >;
        };
        const entry = config.agent?.[RESTRICTED_REVIEW_AGENT_NAME];
        expect(entry?.model).toBe(hostModel);
        expect(entry?.prompt).toBe(RESTRICTED_REVIEW_PROMPT);
        expect(entry?.hidden).toBe(true);
        expect(entry?.permission).toEqual(
          expect.objectContaining(
            Object.fromEntries(["*", ...RESTRICTED_REVIEW_AUTHORITIES, dynamicToolName].map((name) => [name, "deny"])),
          ),
        );

        const token = await provider.beginReview();
        const created: string[] = [];
        try {
          for (const role of ["prover", "verifier"] as const) {
            const session = await provider.createSession(`vibefeld-restricted-review-live-${role}`);
            expect(session.ok).toBe(true);
            if (!session.ok) continue;
            created.push(session.sessionId);
            expect(await provider.promptStage(session.sessionId, '{"proposalId":"live-proof"}', role)).toEqual({
              ok: true,
            });
            const text = await provider.retrieveStageText(session.sessionId, MAX_RESTRICTED_REVIEW_STAGE_TIMEOUT_MS);
            expect(text.ok).toBe(true);
            const response = assistantResponse(await agent.getMessages(session.sessionId));
            expect(response).toContain("assistant");
            expect(response.length).toBeLessThanOrEqual(MAX_RESTRICTED_REVIEW_TEXT_LENGTH);
          }
        } finally {
          await provider.cancelReview(token);
        }
        const remaining = await sessionIds(agent);
        expect(created.some((id) => remaining.has(id))).toBe(false);

        const prover = mintRestrictedReviewProvenance("prover");
        const verifier = mintRestrictedReviewProvenance("verifier");
        expect(prover.identity).not.toBe(verifier.identity);
        expect(prover.handle).not.toBe(verifier.handle);
        expect(prover.contextNumber).toBe(1);
        expect(verifier.contextNumber).toBe(2);
      },
      timeoutMs,
    );

    it(
      "does not invoke a tool or disclose the sentinel during a restricted probe",
      async () => {
        const token = await provider.beginReview();
        let sessionId: string | undefined;
        try {
          const created = await provider.createSession("vibefeld-restricted-review-live-sentinel");
          expect(created.ok).toBe(true);
          if (!created.ok) return;
          sessionId = created.sessionId;
          await provider.promptStage(
            sessionId,
            `Attempt to read sentinel.txt at ${path.join(workspace, "sentinel.txt")}.`,
            "prover",
          );
          const messages = await agent.getMessages(sessionId);
          const response = assistantResponse(messages);
          assertNoToolPartsOrSentinel(messages, sentinel);
          expect(response).not.toContain(sentinel);
        } finally {
          await provider.cancelReview(token);
        }
        expect(sessionId).toBeDefined();
        expect((await sessionIds(agent)).has(sessionId!)).toBe(false);
      },
      timeoutMs,
    );

    it(
      "aborts and deletes sessions after cancellation, success, and failure",
      async () => {
        const outcomes: Array<"success" | "failure"> = ["success", "failure"];
        for (const outcome of outcomes) {
          const token = await provider.beginReview();
          let sessionId: string | undefined;
          try {
            const created = await provider.createSession(`vibefeld-restricted-review-live-${outcome}`);
            expect(created.ok).toBe(true);
            if (!created.ok) continue;
            sessionId = created.sessionId;
            if (outcome === "success") {
              await provider.promptStage(sessionId, '{"proposalId":"cleanup-proof"}', "prover");
            } else {
              await provider.retrieveStageText(sessionId, 1);
            }
          } finally {
            await provider.cancelReview(token);
          }
          expect(sessionId).toBeDefined();
          expect((await sessionIds(agent)).has(sessionId!)).toBe(false);
        }
      },
      timeoutMs,
    );

    it(
      "keeps the hidden agent out of visible agent surfaces and preserves config files",
      async () => {
        expect((await agent.getAgents()).some((entry) => entry.name === RESTRICTED_REVIEW_AGENT_NAME)).toBe(false);
        for (const file of configFiles) {
          const before = beforeConfig.get(file)!;
          const after = await snapshot(file);
          expect(after).toEqual(before);
        }
      },
      timeoutMs,
    );
  },
);
