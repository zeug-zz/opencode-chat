import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const fixtureRoot = fileURLToPath(new URL("./fixtures/plugin-config/", import.meta.url));

function readDebugConfig(projectRoot: string, homeRoot: string, overlay?: Record<string, unknown>): string {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: homeRoot,
    XDG_CONFIG_HOME: resolve(homeRoot, ".config"),
  };
  if (overlay) environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(overlay);
  return execFileSync("opencode", ["--pure", "debug", "config"], {
    cwd: projectRoot,
    env: environment,
    encoding: "utf8",
  });
}

function readResolvedPluginSources(
  projectRoot: string,
  homeRoot: string,
  overlay?: Record<string, unknown>,
): unknown[] {
  const output = readDebugConfig(projectRoot, homeRoot, overlay);
  const pluginStart = output.indexOf('"plugin": [');
  if (pluginStart < 0) throw new Error(`OpenCode debug config did not expose a plugin list (${output.length})`);
  const arrayStart = output.indexOf("[", pluginStart);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]" && --depth === 0) return JSON.parse(output.slice(arrayStart, index + 1)) as unknown[];
  }
  throw new Error(`OpenCode debug config returned an unterminated plugin list (${output.length})`);
}

describe("OpenCode native plugin source fixture", () => {
  it("preserves global, project, directory, and OPENCODE_CONFIG_CONTENT sources without executing plugins", async () => {
    if (!existsSync("/opt/homebrew/bin/opencode") && !existsSync("/usr/local/bin/opencode")) return;

    const runtimeParent = resolve(process.cwd(), "tmp");
    await mkdir(runtimeParent, { recursive: true });
    const runtimeRoot = await mkdtemp(resolve(runtimeParent, "opencode-plugin-config-"));
    try {
      const runtimeProject = resolve(runtimeRoot, "project");
      await cp(fixtureRoot, runtimeProject, { recursive: true });
      const runtimeHome = resolve(runtimeProject, "home");
      const configFiles = [
        resolve(runtimeHome, ".config/opencode/opencode.json"),
        resolve(runtimeProject, ".opencode/opencode.json"),
      ];
      const before = configFiles.map((filePath) => ({
        content: readFileSync(filePath, "utf8"),
        mtimeMs: statSync(filePath).mtimeMs,
      }));
      const companionOverlay = {
        plugin: [["overlay-plugin", { opaque: "overlay-option" }], "file:///overlay/plugin.js"],
        agent: { "companion-only-agent": { mode: "all" } },
      };
      const sources = readResolvedPluginSources(runtimeProject, runtimeHome, companionOverlay);
      const independentTuiSources = readResolvedPluginSources(runtimeProject, runtimeHome);
      const companionConfig = readDebugConfig(runtimeProject, runtimeHome, companionOverlay);
      const independentTuiConfig = readDebugConfig(runtimeProject, runtimeHome);

      expect(sources).toEqual([
        "global-plugin",
        ["file:///global/plugin.js", { opaque: "global-option" }],
        pathToFileURL(resolve(runtimeHome, ".config/opencode/plugins/throws-if-executed.js")).href,
        ["project-plugin", { opaque: "project-option" }],
        pathToFileURL(resolve(runtimeProject, ".opencode/project-plugin.ts")).href,
        "file:///project/plugin.js",
        pathToFileURL(resolve(runtimeProject, ".opencode/plugins/throws-if-executed.js")).href,
        ["overlay-plugin", { opaque: "overlay-option" }],
        "file:///overlay/plugin.js",
      ]);
      expect(independentTuiSources).toEqual(sources.slice(0, 7));
      expect(companionConfig).toContain('"companion-only-agent"');
      expect(independentTuiConfig).not.toContain('"companion-only-agent"');
      expect(JSON.stringify(sources)).not.toContain("TASK_1_1_.*_PLUGIN_EXECUTED");
      expect(configFiles.map((filePath) => readFileSync(filePath, "utf8"))).toEqual(before.map((file) => file.content));
      expect(configFiles.map((filePath) => statSync(filePath).mtimeMs)).toEqual(before.map((file) => file.mtimeMs));
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
