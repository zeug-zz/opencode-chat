import { rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export async function cleanExtensionDist(outputRoot) {
  await rm(outputRoot, { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await cleanExtensionDist(path.join(packageRoot, "dist"));
}
