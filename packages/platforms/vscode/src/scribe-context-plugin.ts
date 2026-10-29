import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

export const SCRIBE_CONTEXT_PLUGIN_UNAVAILABLE_REASON = "bundled-plugin-unavailable" as const;
export const SCRIBE_CONTEXT_PLUGIN_RPC_ID = "scribe_reasoning_context" as const;

// Updated only when the exact bundled package manifest or plugin source changes.
export const SCRIBE_CONTEXT_PLUGIN_SHA256 = "f3d0027584a268bdd0e909729e3451e15e4e7d3fb1eb6856c209670edd96bd94";

export type BundledScribeContextPluginResolution =
  | Readonly<{ available: true; sourcePath: string }>
  | Readonly<{ available: false; reason: typeof SCRIBE_CONTEXT_PLUGIN_UNAVAILABLE_REASON }>;

type ReadBytes = (filePath: string) => Promise<Uint8Array>;

function digestPluginBytes(packageManifest: Uint8Array, server: Uint8Array): string {
  return createHash("sha256")
    .update("package.json\0")
    .update(packageManifest)
    .update("\0server.js\0")
    .update(server)
    .digest("hex");
}

export async function resolveBundledScribeContextPlugin(
  extensionRoot: string,
  readBytes: ReadBytes = async (filePath) => readFile(filePath),
): Promise<BundledScribeContextPluginResolution> {
  const sourcePath = path.join(extensionRoot, "dist", "scribe-context-plugin");
  try {
    const [packageManifest, server] = await Promise.all([
      readBytes(path.join(sourcePath, "package.json")),
      readBytes(path.join(sourcePath, "server.js")),
    ]);
    if (digestPluginBytes(packageManifest, server) !== SCRIBE_CONTEXT_PLUGIN_SHA256) {
      return { available: false, reason: SCRIBE_CONTEXT_PLUGIN_UNAVAILABLE_REASON };
    }
    return { available: true, sourcePath };
  } catch {
    return { available: false, reason: SCRIBE_CONTEXT_PLUGIN_UNAVAILABLE_REASON };
  }
}
