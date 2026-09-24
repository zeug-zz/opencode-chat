/**
 * Opt-in live proof for extension-side restricted-session visibility.
 *
 * Run with `OPENCODE_CHAT_RUN_RESTRICTED_REVIEW_LIVE=1` and
 * `OPENCODE_CHAT_RESTRICTED_REVIEW_MODEL=provider/model` plus the extension
 * test command. The OpenCodeAgent composes the restricted overlay in memory;
 * this suite uses only a disposable project-relative `tmp/` workspace.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OpenCodeAgent, RESTRICTED_REVIEW_AGENT_NAME, RESTRICTED_REVIEW_PROMPT } from "@opencode-chat/agent-opencode";
import { describe, expect, it } from "vitest";
import { HIDDEN_SESSION_MARKER_PREFIX, hiddenSessionRegistry } from "../vibefeld/hidden-session-registry";
import { createRestrictedReviewAdapter } from "../vibefeld/restricted-review-adapter";

const liveOptIn = process.env.OPENCODE_CHAT_RUN_RESTRICTED_REVIEW_LIVE === "1";
const hostModel = process.env.OPENCODE_CHAT_RESTRICTED_REVIEW_MODEL?.trim();
const canRun = liveOptIn && Boolean(hostModel?.includes("/"));
const dynamicToolName = "live-dynamic-review-tool";
const timeoutMs = 45_000;

type FileSnapshot = { exists: boolean; content?: string; mtimeMs?: number };

async function snapshot(filePath: string): Promise<FileSnapshot> {
  try {
    const [stat, content] = await Promise.all([fs.stat(filePath), fs.readFile(filePath, "utf8")]);
    return { exists: true, content, mtimeMs: stat.mtimeMs };
  } catch {
    return { exists: false };
  }
}

describe.skipIf(!canRun)(
  "restricted review live visibility (set OPENCODE_CHAT_RUN_RESTRICTED_REVIEW_LIVE=1 and OPENCODE_CHAT_RESTRICTED_REVIEW_MODEL)",
  () => {
    it(
      "filters a real marked child session and hidden agent from extension surfaces",
      async () => {
        const previousCwd = process.cwd();
        const tempParent = path.resolve("tmp");
        await fs.mkdir(tempParent, { recursive: true });
        const root = await fs.mkdtemp(path.join(tempParent, "restricted-review-live-visibility-"));
        const workspace = path.join(root, "workspace");
        await fs.mkdir(workspace, { recursive: true });
        process.chdir(workspace);

        const globalConfigDir = process.env.XDG_CONFIG_HOME
          ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
          : path.join(process.env.HOME ?? "", ".config", "opencode");
        const configFiles = [
          path.join(globalConfigDir, "opencode.json"),
          path.join(globalConfigDir, "opencode.jsonc"),
          path.join(workspace, "opencode.json"),
          path.join(workspace, "opencode.jsonc"),
          path.join(workspace, ".opencode", "opencode.json"),
          path.join(workspace, ".opencode", "opencode.jsonc"),
        ];
        const beforeConfig = new Map(
          await Promise.all(configFiles.map(async (file) => [file, await snapshot(file)] as const)),
        );

        const restrictedReview = {
          model: hostModel!,
          prompt: RESTRICTED_REVIEW_PROMPT,
          maxSteps: 4,
          dynamicToolNames: [dynamicToolName],
        };
        const agent = new OpenCodeAgent({
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
          // OpenCodeAgent.connect composes buildChatOverlay/createOpencodeServer;
          // no overlay or provider configuration is written by this test.
          restrictedReview,
        });

        let adapter: ReturnType<typeof createRestrictedReviewAdapter> | undefined;
        try {
          hiddenSessionRegistry.reset();
          await agent.connect();
          const provider = agent.createRestrictedReviewProvider({
            providerID: hostModel!.split("/", 1)[0]!,
            modelID: hostModel!.slice(hostModel!.indexOf("/") + 1),
          });
          expect(provider).toBeDefined();
          expect(await provider!.checkReadiness()).toBe(true);
          adapter = createRestrictedReviewAdapter({ provider: provider! });
          const context = await adapter.createContext("prover", new AbortController().signal);
          expect(context).toBeDefined();

          const rawSessions = await agent.listSessions();
          const child = rawSessions.find((session) => session.title.startsWith(HIDDEN_SESSION_MARKER_PREFIX));
          expect(child).toBeDefined();
          expect(hiddenSessionRegistry.filterSessions(rawSessions).some((session) => session.id === child!.id)).toBe(
            false,
          );
          expect(
            hiddenSessionRegistry
              .filterAgents(await agent.getAgents())
              .some((entry) => entry.name === RESTRICTED_REVIEW_AGENT_NAME),
          ).toBe(false);
        } finally {
          await adapter?.dispose();
          hiddenSessionRegistry.reset();
          agent.disconnect();
          process.chdir(previousCwd);
          for (const file of configFiles) expect(await snapshot(file)).toEqual(beforeConfig.get(file));
          await fs.rm(root, { recursive: true, force: true });
        }
      },
      timeoutMs,
    );
  },
);
