import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveBundledScribeContextPlugin,
  SCRIBE_CONTEXT_PLUGIN_SHA256,
  SCRIBE_CONTEXT_PLUGIN_UNAVAILABLE_REASON,
} from "../scribe-context-plugin";

async function sourcePluginBytes(): Promise<ReadonlyMap<string, Uint8Array>> {
  const entries = await Promise.all([
    ["package.json", new URL("../../../../agents/opencode/src/scribe-context-plugin/package.json", import.meta.url)],
    ["server.js", new URL("../../../../agents/opencode/src/scribe-context-plugin/server.js", import.meta.url)],
  ] as const);
  return new Map(await Promise.all(entries.map(async ([name, url]) => [name, await readFile(url)] as const)));
}

describe("bundled Scribe context plugin verification", () => {
  it("pins the bundled package and source bytes by SHA-256", async () => {
    const files = await sourcePluginBytes();
    const reads: string[] = [];
    const result = await resolveBundledScribeContextPlugin("/installed-extension", async (filePath) => {
      reads.push(filePath);
      const name = path.basename(filePath);
      const bytes = files.get(name);
      if (!bytes) throw new Error("missing fixture bytes");
      return bytes;
    });

    expect(SCRIBE_CONTEXT_PLUGIN_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result).toEqual({ available: true, sourcePath: "/installed-extension/dist/scribe-context-plugin" });
    expect(reads.sort()).toEqual([
      "/installed-extension/dist/scribe-context-plugin/package.json",
      "/installed-extension/dist/scribe-context-plugin/server.js",
    ]);
  });

  it("returns one fixed unavailable reason for digest mismatch or missing bytes", async () => {
    const files = await sourcePluginBytes();
    const mismatch = await resolveBundledScribeContextPlugin("/installed-extension", async (filePath) => {
      const name = path.basename(filePath);
      const bytes = files.get(name);
      if (!bytes) throw new Error("missing fixture bytes");
      return name === "server.js" ? new Uint8Array([...bytes, 0]) : bytes;
    });
    const missing = await resolveBundledScribeContextPlugin("/installed-extension", async () => {
      throw new Error("private filesystem detail");
    });

    expect(mismatch).toEqual({ available: false, reason: SCRIBE_CONTEXT_PLUGIN_UNAVAILABLE_REASON });
    expect(missing).toEqual({ available: false, reason: SCRIBE_CONTEXT_PLUGIN_UNAVAILABLE_REASON });
    expect(JSON.stringify([mismatch, missing])).not.toContain("private filesystem detail");
  });
});
