import { describe, expect, it, vi } from "vitest";
import {
  abandonLocalInstaller,
  compareSemVer,
  downloadAndValidatePrivateRelease,
  fetchLatestReleaseMetadata,
  findAvailablePrivateRelease,
  parseSemVer,
  prepareLocalInstallerUri,
  type ReleaseMetadataFetcher,
} from "../private-release-updater";

const validDownloadUrl =
  "https://github.com/zeug-zz/opencode-chat/releases/download/v0.16.0/opencode-scribe-0.16.0.vsix";

function storedZip(
  path: string,
  content: Uint8Array,
  compressionMethod = 0,
  compressedSize = content.length,
  uncompressedSize = content.length,
): Uint8Array {
  const encoder = new TextEncoder();
  const name = encoder.encode(path);
  const local = new Uint8Array(30 + name.length + content.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(8, compressionMethod, true);
  localView.setUint16(8, 0, true);
  localView.setUint32(18, content.length, true);
  localView.setUint32(22, content.length, true);
  localView.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(content, 30 + name.length);
  const central = new Uint8Array(46 + name.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(10, compressionMethod, true);
  centralView.setUint32(20, compressedSize, true);
  centralView.setUint32(24, uncompressedSize, true);
  centralView.setUint16(28, name.length, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);
  const archive = new Uint8Array(local.length + central.length + end.length);
  archive.set(local);
  archive.set(central, local.length);
  archive.set(end, local.length + central.length);
  return archive;
}

const vsix = (overrides: Record<string, unknown> = {}) =>
  storedZip(
    "extension/package.json",
    new TextEncoder().encode(
      JSON.stringify({ publisher: "drmrStudio", name: "opencode-scribe", version: "0.16.0", ...overrides }),
    ),
  );

const downloadResponse = (bytes: Uint8Array, length = bytes.byteLength) =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": String(length) }),
    arrayBuffer: async () => bytes.buffer,
  }) as Response;

const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: "v0.16.0",
  draft: false,
  prerelease: false,
  assets: [{ name: "opencode-scribe-0.16.0.vsix", browser_download_url: "https://github.com/example/update.vsix" }],
  ...overrides,
});

const fetcherFor = (body: unknown, status = 200): ReleaseMetadataFetcher =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response);

describe("private release updater", () => {
  it("accepts a newer stable release with its exact asset", async () => {
    await expect(findAvailablePrivateRelease("0.15.2", fetcherFor(release()))).resolves.toEqual({
      version: "0.16.0",
      assetName: "opencode-scribe-0.16.0.vsix",
      downloadUrl: "https://github.com/example/update.vsix",
    });
  });

  it.each([
    ["prerelease", { prerelease: true }],
    ["draft", { draft: true }],
    ["malformed tag", { tag_name: "release-0.16" }],
    ["missing asset", { assets: [] }],
    ["mismatched asset", { assets: [{ name: "other.vsix", browser_download_url: "https://example.test/other" }] }],
  ])("rejects a %s", async (_, overrides) => {
    await expect(findAvailablePrivateRelease("0.15.2", fetcherFor(release(overrides)))).resolves.toBeUndefined();
  });

  it.each(["0.16.0", "0.17.0"])("rejects an installed version that is %s or newer", async (installed) => {
    await expect(findAvailablePrivateRelease(installed, fetcherFor(release()))).resolves.toBeUndefined();
  });

  it("uses only the unauthenticated latest endpoint and no credential or fallback source", async () => {
    const fetcher = fetcherFor(release());
    await findAvailablePrivateRelease("0.15.2", fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/zeug-zz/opencode-chat/releases/latest",
      expect.objectContaining({ headers: { Accept: "application/vnd.github+json" } }),
    );
    expect(fetcher).not.toHaveBeenCalledWith(
      expect.stringContaining("/releases"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.anything() }) }),
    );
  });

  it.each([401, 403, 429])("treats HTTP %s as no update", async (status) => {
    await expect(findAvailablePrivateRelease("0.15.2", fetcherFor({}, status))).resolves.toBeUndefined();
  });

  it("bounds network and JSON failures as no update", async () => {
    const networkFailure = vi.fn(async () => {
      throw new Error("network");
    }) as ReleaseMetadataFetcher;
    const invalidJson = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error("invalid json");
      },
    })) as ReleaseMetadataFetcher;
    await expect(findAvailablePrivateRelease("0.15.2", networkFailure)).resolves.toBeUndefined();
    await expect(findAvailablePrivateRelease("0.15.2", invalidJson)).resolves.toBeUndefined();
  });

  it("compares strict SemVer precedence", () => {
    expect(parseSemVer("v1.2.3")).toBeUndefined();
    expect(compareSemVer("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareSemVer("1.0.0-rc.1", "1.0.0-beta.2")).toBeGreaterThan(0);
  });

  it("returns bounded no-update results when metadata fetch times out", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as ReleaseMetadataFetcher;
    await expect(fetchLatestReleaseMetadata(fetcher, 1)).resolves.toBeUndefined();
  });

  it("prepares a unique local installer URI under global storage", () => {
    expect(prepareLocalInstallerUri({ fsPath: "/global" }, "opencode-scribe-0.16.0.vsix", "test-id")).toEqual(
      expect.objectContaining({
        fsPath: "/global/.private-release-test-id-opencode-scribe-0.16.0.vsix",
        scheme: "file",
      }),
    );
  });

  it("downloads and validates a VSIX before returning its local installer URI", async () => {
    const files = new Map<string, Uint8Array>();
    const fileSystem = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string, bytes: Uint8Array) => void files.set(path, bytes)),
      unlink: vi.fn(async () => undefined),
    };
    const release = { version: "0.16.0", assetName: "opencode-scribe-0.16.0.vsix", downloadUrl: validDownloadUrl };
    const result = await downloadAndValidatePrivateRelease(
      release,
      { fsPath: "/global" },
      {
        fetcher: vi.fn(async () => downloadResponse(vsix())),
        fileSystem,
        idFactory: () => "fixed",
      },
    );
    expect(result?.fsPath).toBe("/global/.private-release-fixed-opencode-scribe-0.16.0.vsix");
    expect(files.has(result?.fsPath ?? "")).toBe(true);
  });

  it.each([
    ["incomplete response", vsix(), vsix().byteLength - 1],
    ["invalid archive", new TextEncoder().encode("not a zip"), undefined],
    ["mismatched publisher", vsix({ publisher: "other" }), undefined],
    ["mismatched name", vsix({ name: "other" }), undefined],
    ["mismatched version", vsix({ version: "0.17.0" }), undefined],
  ])("rejects and cleans up %s", async (_, bytes, length) => {
    const fileSystem = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    };
    const result = await downloadAndValidatePrivateRelease(
      { version: "0.16.0", assetName: "opencode-scribe-0.16.0.vsix", downloadUrl: validDownloadUrl },
      { fsPath: "/global" },
      {
        fetcher: vi.fn(async () => downloadResponse(bytes, length ?? bytes.byteLength)),
        fileSystem,
        idFactory: () => "fixed",
      },
    );
    expect(result).toBeUndefined();
    expect(fileSystem.unlink).toHaveBeenCalledWith("/global/.private-release-fixed-opencode-scribe-0.16.0.vsix");
  });

  it("rejects non-GitHub release download origins without fetching", async () => {
    const fetcher = vi.fn();
    await expect(
      downloadAndValidatePrivateRelease(
        {
          version: "0.16.0",
          assetName: "opencode-scribe-0.16.0.vsix",
          downloadUrl: "https://example.test/update.vsix",
        },
        { fsPath: "/global" },
        { fetcher },
      ),
    ).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["oversized compressed metadata", 0, 1024 * 1024 + 1, vsix()],
    ["oversized uncompressed metadata", 0, vsix().byteLength, vsix(), 1024 * 1024 + 1],
    ["unsupported compression method", 99, vsix().byteLength, vsix()],
  ])(
    "rejects %s before manifest inflation or allocation",
    async (_, method, compressedSize, bytes, uncompressedSize) => {
      const fileSystem = {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => undefined),
        unlink: vi.fn(async () => undefined),
      };
      const archive = storedZip("extension/package.json", bytes, method, compressedSize, uncompressedSize);
      const result = await downloadAndValidatePrivateRelease(
        { version: "0.16.0", assetName: "opencode-scribe-0.16.0.vsix", downloadUrl: validDownloadUrl },
        { fsPath: "/global" },
        { fetcher: vi.fn(async () => downloadResponse(archive)), fileSystem, idFactory: () => "fixed" },
      );
      expect(result).toBeUndefined();
      expect(fileSystem.writeFile).not.toHaveBeenCalled();
    },
  );

  it("can safely abandon a prepared installer", async () => {
    const unlink = vi.fn(async () => undefined);
    await abandonLocalInstaller({ fsPath: "/global/update.vsix" }, { mkdir: vi.fn(), writeFile: vi.fn(), unlink });
    expect(unlink).toHaveBeenCalledWith("/global/update.vsix");
  });
});
