import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { BUNDLED_RESEARCH_RESOURCE_MANIFEST } from "../src/bundled-research-resources.ts";

const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const DEFAULT_RESOURCE_ROOT = "extension/skills-commands/";
const MAX_DIAGNOSTIC_ENTRIES = 5;

export interface ExtensionManifest {
  name: string;
  publisher: string;
  version: string;
  main: string;
}

export function deriveExpectedExtensionManifest(packageManifest: Record<string, unknown>): ExtensionManifest {
  const fields = ["name", "publisher", "version", "main"] as const;
  for (const field of fields) {
    if (typeof packageManifest[field] !== "string" || packageManifest[field].length === 0) {
      throw new Error(`Extension package.json has an invalid ${field} field`);
    }
  }
  return {
    name: packageManifest.name as string,
    publisher: packageManifest.publisher as string,
    version: packageManifest.version as string,
    main: packageManifest.main as string,
  };
}

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
  return readZipArchiveDirectory(archive).map(({ name }) => name);
}

interface ZipDirectoryEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readZipArchiveDirectory(archive: Uint8Array): ZipDirectoryEntry[] {
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
  const entries: ZipDirectoryEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("VSIX archive has an invalid ZIP directory entry");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    entries.push({
      name: decoder.decode(archive.slice(nameStart, nameStart + nameLength)),
      compressionMethod: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipArchiveFile(archive: Uint8Array, entryName: string): Uint8Array | undefined {
  const entry = readZipArchiveDirectory(archive).find(({ name }) => normalizeArchivePath(name) === entryName);
  if (!entry) return undefined;
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const localOffset = entry.localHeaderOffset;
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("VSIX archive has an invalid local entry");
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = archive.slice(dataStart, dataStart + entry.compressedSize);
  const content = entry.compressionMethod === 0 ? compressed : inflateRawSync(compressed);
  if (content.byteLength !== entry.uncompressedSize) throw new Error("VSIX archive entry size is invalid");
  return content;
}

function boundedEntries(entries: readonly string[]): string {
  return entries.slice(0, MAX_DIAGNOSTIC_ENTRIES).join(", ");
}

export function verifyVsixManifest(
  archive: Uint8Array,
  expectedManifest: ExtensionManifest,
  entries: readonly string[] = readZipArchiveEntries(archive),
): void {
  const manifestPath = "extension/package.json";
  const manifestBytes = readZipArchiveFile(archive, manifestPath);
  if (!manifestBytes) throw new Error("VSIX is missing extension/package.json");
  let actualManifest: Record<string, unknown>;
  try {
    actualManifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<string, unknown>;
  } catch {
    throw new Error("VSIX extension/package.json is not valid JSON");
  }
  for (const field of ["name", "publisher", "version", "main"] as const) {
    if (actualManifest[field] !== expectedManifest[field]) {
      throw new Error(`VSIX manifest ${field} does not match the extension package manifest`);
    }
  }
  const mainEntry = normalizeArchivePath(`extension/${expectedManifest.main.replace(/^\.\//, "")}`);
  if (!entries.map(normalizeArchivePath).includes(mainEntry)) {
    throw new Error("VSIX manifest main entry is missing from the archive");
  }
}

export function verifyVsixArchiveHygiene(entries: readonly string[]): void {
  const normalizedEntries = entries.map(normalizeArchivePath);
  const forbidden = normalizedEntries.filter((entry) =>
    /(^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[^/]+$|\.map$|(^|\/)scripts(?:\/|$)|\.(?:dylib|so|dll|exe|node|a|lib)$/i.test(
      entry,
    ),
  );
  if (forbidden.length > 0) {
    throw new Error(`VSIX contains forbidden development or native entries: ${boundedEntries(forbidden)}`);
  }
}

async function resolveArchivePath(argument: string | undefined, packageRoot: string): Promise<string> {
  if (argument) return path.resolve(packageRoot, argument);
  const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const expected = deriveExpectedExtensionManifest(packageManifest);
  const archivePath = path.join(packageRoot, `${expected.name}-${expected.version}.vsix`);
  try {
    await readFile(archivePath);
  } catch {
    throw new Error(`Expected VSIX ${expected.name}-${expected.version}.vsix was not found; run npm run package first`);
  }
  return archivePath;
}

async function main(): Promise<void> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const archivePath = await resolveArchivePath(process.argv[2], packageRoot);
  const archive = await readFile(archivePath);
  const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const expectedManifest = deriveExpectedExtensionManifest(packageManifest);
  const entries = readZipArchiveEntries(archive);
  verifyVsixManifest(archive, expectedManifest, entries);
  verifyVsixArchiveHygiene(entries);
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
