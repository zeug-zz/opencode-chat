import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const LATEST_RELEASE_URL = "https://api.github.com/repos/zeug-zz/opencode-chat/releases/latest";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const MAX_VSIX_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const ASSET_PREFIX = "opencode-scribe-";
const ASSET_SUFFIX = ".vsix";

export interface GitHubReleaseAsset {
  name: unknown;
  browser_download_url: unknown;
}

export interface GitHubLatestRelease {
  tag_name: unknown;
  draft: unknown;
  prerelease: unknown;
  assets: unknown;
}

export interface AvailablePrivateRelease {
  version: string;
  assetName: string;
  downloadUrl: string;
}

export interface ReleaseUpdateState {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface ReleaseUpdateCheckOptions {
  installedVersion: string;
  globalState: ReleaseUpdateState;
  manual?: boolean;
  fetcher?: ReleaseMetadataFetcher;
  announce: (release: AvailablePrivateRelease) => void;
  reportNoUpdate?: () => void;
  reportFailure?: () => void;
}

/** Runs discovery only; installation is deliberately owned by a later consent flow. */
export async function checkForPrivateReleaseUpdates({
  installedVersion,
  globalState,
  manual = false,
  fetcher,
  announce,
  reportNoUpdate,
  reportFailure,
}: ReleaseUpdateCheckOptions): Promise<AvailablePrivateRelease | undefined> {
  try {
    const metadata = await fetchLatestReleaseMetadataOutcome(fetcher);
    if (metadata.failed) {
      reportFailure?.();
      return undefined;
    }
    const release = findAvailableReleaseFromMetadata(installedVersion, metadata.release);
    if (!release) {
      if (manual) reportNoUpdate?.();
      return undefined;
    }
    const announcementKey = "privateReleaseUpdater.lastAnnouncedVersion";
    const alreadyAnnounced = globalState.get(announcementKey) === release.version;
    if (manual || !alreadyAnnounced) {
      announce(release);
      if (!manual) await globalState.update(announcementKey, release.version);
    }
    return release;
  } catch {
    reportFailure?.();
    return undefined;
  }
}

export type ReleaseMetadataFetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface ExtensionStorageUri {
  fsPath: string;
}

export interface LocalInstallerUri extends ExtensionStorageUri {
  scheme: "file";
  toString(): string;
}

export interface DownloadFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
  unlink(path: string): Promise<unknown>;
}

export interface VsixDownloadOptions {
  fetcher?: ReleaseMetadataFetcher;
  fileSystem?: DownloadFileSystem;
  uriFactory?: (path: string) => LocalInstallerUri;
  maxBytes?: number;
  idFactory?: () => string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function compareSemVer(left: string, right: string): number {
  const a = parseSemVer(left);
  const b = parseSemVer(right);
  if (!a || !b) throw new Error("Invalid SemVer");
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function parseSemVer(value: string, allowLeadingV = false): ParsedVersion | undefined {
  const normalized = allowLeadingV && value.startsWith("v") ? value.slice(1) : value;
  const match = normalized.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return undefined;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

export async function fetchLatestReleaseMetadata(
  fetcher: ReleaseMetadataFetcher = (url, init) => globalThis.fetch(url, init),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<GitHubLatestRelease | undefined> {
  return (await fetchLatestReleaseMetadataOutcome(fetcher, timeoutMs)).release;
}

async function fetchLatestReleaseMetadataOutcome(
  fetcher: ReleaseMetadataFetcher | undefined,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<{ release: GitHubLatestRelease | undefined; failed: boolean }> {
  const request = fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const controller = new AbortController();
  let rejectTimeout: ((reason: Error) => void) | undefined;
  const timeout = setTimeout(() => {
    controller.abort();
    rejectTimeout?.(new Error("release metadata timeout"));
  }, timeoutMs);
  try {
    const response = await Promise.race([
      request(LATEST_RELEASE_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        rejectTimeout = reject;
      }),
    ]);
    if (!response.ok) return { release: undefined, failed: true };
    const data: unknown = await response.json();
    return { release: isLatestRelease(data) ? data : undefined, failed: false };
  } catch {
    return { release: undefined, failed: true };
  } finally {
    clearTimeout(timeout);
  }
}

export async function findAvailablePrivateRelease(
  installedVersion: string,
  fetcher?: ReleaseMetadataFetcher,
): Promise<AvailablePrivateRelease | undefined> {
  const installed = parseSemVer(installedVersion, true);
  if (!installed) return undefined;
  const release = await fetchLatestReleaseMetadata(fetcher);
  return findAvailableReleaseFromMetadata(installedVersion, release);
}

function findAvailableReleaseFromMetadata(
  installedVersion: string,
  release: GitHubLatestRelease | undefined,
): AvailablePrivateRelease | undefined {
  const installed = parseSemVer(installedVersion, true);
  if (!installed) return undefined;
  if (release?.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") {
    return undefined;
  }
  const version = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : release.tag_name;
  const parsedRelease = parseSemVer(version);
  if (!parsedRelease || parsedRelease.prerelease.length > 0 || compareSemVer(version, installedVersion) <= 0) {
    return undefined;
  }
  const assetName = `${ASSET_PREFIX}${version}${ASSET_SUFFIX}`;
  if (!Array.isArray(release.assets)) return undefined;
  const asset = release.assets.find(
    (candidate): candidate is GitHubReleaseAsset =>
      isGitHubReleaseAsset(candidate) &&
      candidate.name === assetName &&
      typeof candidate.browser_download_url === "string",
  );
  if (!asset || typeof asset.browser_download_url !== "string") return undefined;
  return { version, assetName, downloadUrl: asset.browser_download_url };
}

const defaultFileSystem: DownloadFileSystem = { mkdir, writeFile, unlink };
const defaultUriFactory = (path: string): LocalInstallerUri => ({
  fsPath: path,
  scheme: "file",
  toString: () => `file://${path}`,
});

/** Builds a unique, local installer location without trusting a remote filename. */
export function prepareLocalInstallerUri(
  globalStorageUri: ExtensionStorageUri,
  assetName: string,
  id = randomUUID(),
  uriFactory = defaultUriFactory,
): LocalInstallerUri {
  if (!/^[A-Za-z0-9._-]+\.vsix$/.test(assetName)) throw new Error("Invalid VSIX asset name");
  return uriFactory(`${globalStorageUri.fsPath}/.private-release-${id}-${assetName}`);
}

export async function downloadAndValidatePrivateRelease(
  release: AvailablePrivateRelease,
  globalStorageUri: ExtensionStorageUri,
  options: VsixDownloadOptions = {},
): Promise<LocalInstallerUri | undefined> {
  if (!isGitHubReleaseDownloadUrl(release.downloadUrl, release.assetName)) return undefined;
  const maxBytes = options.maxBytes ?? MAX_VSIX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_VSIX_BYTES) return undefined;
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const uri = prepareLocalInstallerUri(
    globalStorageUri,
    release.assetName,
    options.idFactory?.() ?? randomUUID(),
    options.uriFactory,
  );
  let wroteFile = false;
  try {
    const response = await (options.fetcher ?? ((url, init) => globalThis.fetch(url, init)))(release.downloadUrl, {
      headers: { Accept: "application/octet-stream" },
    });
    if (!response.ok) return undefined;
    const declaredLength = response.headers.get("content-length");
    const expectedLength = declaredLength === null ? undefined : Number(declaredLength);
    if (
      declaredLength !== null &&
      (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > maxBytes)
    ) {
      return undefined;
    }
    const bytes = await readResponseBytes(response, maxBytes, expectedLength);
    if (expectedLength !== undefined && bytes.byteLength !== expectedLength) return undefined;
    if (!isMatchingVsixManifest(bytes, release.version)) return undefined;
    await fileSystem.mkdir(globalStorageUri.fsPath, { recursive: true });
    await fileSystem.writeFile(uri.fsPath, bytes);
    wroteFile = true;
    return uri;
  } catch {
    return undefined;
  } finally {
    if (wroteFile === false && uri.fsPath) await safeUnlink(fileSystem, uri.fsPath);
  }
}

/** Removes a prepared artifact when the caller abandons the consented install. */
export async function abandonLocalInstaller(
  installerUri: ExtensionStorageUri,
  fileSystem: DownloadFileSystem = defaultFileSystem,
): Promise<void> {
  await safeUnlink(fileSystem, installerUri.fsPath);
}

async function readResponseBytes(response: Response, maxBytes: number, expectedLength?: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("VSIX exceeds the maximum size");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes || (expectedLength !== undefined && size > expectedLength)) {
        throw new Error("VSIX response is too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isGitHubReleaseDownloadUrl(value: string, assetName: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith("/zeug-zz/opencode-chat/releases/download/") &&
      url.pathname.endsWith(`/${assetName}`)
    );
  } catch {
    return false;
  }
}

function isMatchingVsixManifest(archive: Uint8Array, version: string): boolean {
  try {
    const bytes = readZipEntry(archive, "extension/package.json");
    if (!bytes) return false;
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    return manifest.publisher === "drmrStudio" && manifest.name === "opencode-scribe" && manifest.version === version;
  } catch {
    return false;
  }
}

function readZipEntry(archive: Uint8Array, wantedName: string): Uint8Array | undefined {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let offset = archive.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0 || end + 22 > archive.byteLength) return undefined;
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset + directorySize > archive.byteLength) return undefined;
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > archive.byteLength || view.getUint32(offset, true) !== 0x02014b50) return undefined;
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > archive.byteLength) return undefined;
    const name = new TextDecoder().decode(archive.slice(nameStart, nameStart + nameLength)).replaceAll("\\", "/");
    if (name === wantedName) {
      if (
        (compressionMethod !== 0 && compressionMethod !== 8) ||
        compressedSize > MAX_MANIFEST_BYTES ||
        uncompressedSize > MAX_MANIFEST_BYTES
      ) {
        return undefined;
      }
      const localOffset = view.getUint32(offset + 42, true);
      if (localOffset + 30 > archive.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) return undefined;
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > archive.byteLength) return undefined;
      const compressed = archive.slice(dataStart, dataStart + compressedSize);
      const content =
        compressionMethod === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_MANIFEST_BYTES });
      return content.byteLength === uncompressedSize ? content : undefined;
    }
    offset = next;
  }
  return undefined;
}

async function safeUnlink(fileSystem: DownloadFileSystem, path: string): Promise<void> {
  try {
    await fileSystem.unlink(path);
  } catch {
    // Cleanup is best effort; an abandoned unique file cannot affect the installed extension.
  }
}

function isGitHubReleaseAsset(value: unknown): value is GitHubReleaseAsset {
  return typeof value === "object" && value !== null && "name" in value && "browser_download_url" in value;
}

function isLatestRelease(value: unknown): value is GitHubLatestRelease {
  return (
    typeof value === "object" &&
    value !== null &&
    "tag_name" in value &&
    "draft" in value &&
    "prerelease" in value &&
    "assets" in value
  );
}
