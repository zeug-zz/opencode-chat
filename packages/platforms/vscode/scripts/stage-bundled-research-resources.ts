import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_RESEARCH_RESOURCE_MANIFEST } from "../src/bundled-research-resources.ts";

type ReadSourceFile = (filePath: string) => Promise<string>;

export type StageBundledResearchResourcesOptions = {
  readonly sourceRoot: string;
  readonly outputRoot: string;
  readonly readSourceFile?: ReadSourceFile;
};

function resourcePath(sourceRoot: string, relativePath: string): string {
  return path.resolve(sourceRoot, ...relativePath.split("/"));
}

export async function stageBundledResearchResources({
  sourceRoot,
  outputRoot,
  readSourceFile = (filePath) => readFile(filePath, "utf8"),
}: StageBundledResearchResourcesOptions): Promise<void> {
  const resources: Array<{ readonly relativePath: string; readonly content: string }> = [];

  for (const entry of BUNDLED_RESEARCH_RESOURCE_MANIFEST) {
    try {
      resources.push({
        relativePath: entry.relativePath,
        content: await readSourceFile(resourcePath(sourceRoot, entry.relativePath)),
      });
    } catch {
      throw new Error(`Unable to stage required research resource ${entry.id} (${entry.relativePath})`);
    }
  }

  const temporaryRoot = `${outputRoot}.staging`;
  await rm(temporaryRoot, { recursive: true, force: true });
  try {
    await mkdir(temporaryRoot, { recursive: true });
    for (const resource of resources) {
      const destination = path.resolve(temporaryRoot, ...resource.relativePath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, resource.content, "utf8");
    }
    await rm(outputRoot, { recursive: true, force: true });
    await rename(temporaryRoot, outputRoot);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repositoryRoot = path.resolve(packageRoot, "../../..");
  await stageBundledResearchResources({
    sourceRoot: path.join(repositoryRoot, "skills-commands"),
    outputRoot: path.join(packageRoot, "dist/skills-commands"),
  });
}
