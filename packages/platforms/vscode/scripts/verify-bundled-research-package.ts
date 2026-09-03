import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_RESEARCH_RESOURCE_MANIFEST } from "../src/bundled-research-resources.ts";

const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const DEFAULT_RESOURCE_ROOT = "extension/skills-commands/";

export const EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS = BUNDLED_RESEARCH_RESOURCE_MANIFEST.map(
  ({ relativePath }) => `${DEFAULT_RESOURCE_ROOT}${relativePath}`,
);

function normalizeArchivePath(entry: string): string {
  return entry.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function verifyBundledResearchArchiveEntries(entries: readonly string[]): void {
  const normalizedEntries = entries.map(normalizeArchivePath);
  const resourceRoots = new Set(
    normalizedEntries
      .filter((entry) => entry.startsWith("extension/") && entry.includes("skills-commands/"))
      .map((entry) => entry.slice(0, entry.indexOf("skills-commands/") + "skills-commands/".length)),
  );
  if (resourceRoots.size > 1) {
    throw new Error("VSIX contains bundled research resources under multiple extension roots");
  }
  const resourceRoot = resourceRoots.values().next().value ?? DEFAULT_RESOURCE_ROOT;
  const expectedPaths = BUNDLED_RESEARCH_RESOURCE_MANIFEST.map(({ relativePath }) => `${resourceRoot}${relativePath}`);
  const entrySet = new Set(normalizedEntries);
  const missing = expectedPaths.filter((entry) => !entrySet.has(entry));
  const unexpectedResourceEntries = normalizedEntries.filter(
    (entry) => entry.startsWith(resourceRoot) && !expectedPaths.includes(entry) && !entry.endsWith("/"),
  );
  const workspaceResourceEntries = normalizedEntries.filter((entry) => /(^|\/)\.opencode(?:\/|$)/.test(entry));
  const duplicateResourceEntries = expectedPaths.filter(
    (entry) => normalizedEntries.filter((candidate) => candidate === entry).length > 1,
  );

  if (missing.length > 0) throw new Error(`VSIX is missing bundled research resources: ${missing.join(", ")}`);
  if (unexpectedResourceEntries.length > 0) {
    throw new Error(
      `VSIX contains misplaced or unallowlisted research resources: ${unexpectedResourceEntries.join(", ")}`,
    );
  }
  if (workspaceResourceEntries.length > 0) {
    throw new Error("VSIX contains a workspace .opencode resource copy; bundled resources must be extension-owned");
  }
  if (duplicateResourceEntries.length > 0) {
    throw new Error(`VSIX contains duplicate bundled research resources: ${duplicateResourceEntries.join(", ")}`);
  }
}

export function readZipArchiveEntries(archive: Uint8Array): string[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let endOffset = -1;
  for (let offset = archive.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Not a readable VSIX archive: ZIP directory is missing");

  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("VSIX archive uses unsupported ZIP64 metadata");
  }
  if (directoryOffset + directorySize > archive.byteLength) throw new Error("VSIX archive ZIP directory is truncated");

  const decoder = new TextDecoder();
  const entries: string[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("VSIX archive has an invalid ZIP directory entry");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    entries.push(decoder.decode(archive.slice(nameStart, nameStart + nameLength)));
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function resolveArchivePath(argument: string | undefined, packageRoot: string): Promise<string> {
  if (argument) return path.resolve(packageRoot, argument);
  const candidates = (await readdir(packageRoot)).filter((entry) => /^opencode-research-.+\.vsix$/.test(entry)).sort();
  const archive = candidates.at(-1);
  if (!archive) throw new Error("No opencode-research VSIX found; run npm run package first");
  return path.join(packageRoot, archive);
}

async function main(): Promise<void> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const archivePath = await resolveArchivePath(process.argv[2], packageRoot);
  const entries = readZipArchiveEntries(await readFile(archivePath));
  verifyBundledResearchArchiveEntries(entries);
  console.log(
    `VSIX archive verification passed: ${EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.length} bundled research resources`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "VSIX archive verification failed");
    process.exitCode = 1;
  });
}
