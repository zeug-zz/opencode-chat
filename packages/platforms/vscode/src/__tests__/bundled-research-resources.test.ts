import { access, mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanExtensionDist } from "../../scripts/clean-extension-dist.mjs";
import { stageBundledResearchResources } from "../../scripts/stage-bundled-research-resources";
import {
  deriveExpectedExtensionManifest,
  EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS,
  readZipArchiveEntries,
  verifyBundledResearchArchiveEntries,
  verifyVsixArchiveHygiene,
  verifyVsixManifest,
} from "../../scripts/verify-bundled-research-package";
import {
  BUNDLED_RESEARCH_RESOURCE_MANIFEST,
  type BundledResourceManifestEntry,
  loadBundledResearchResources,
} from "../bundled-research-resources";

const validContent = (entry: BundledResourceManifestEntry) =>
  entry.type === "skill"
    ? `---\nname: ${entry.name}\ndescription: Description for ${entry.name}.\n---\n\nSkill body.`
    : `---\ndescription: Description for ${entry.name}.\n---\n\nUse the request: $ARGUMENTS`;

const expectedManifest = deriveExpectedExtensionManifest({
  name: "opencode-scribe",
  publisher: "drmrStudio",
  version: "0.15.0",
  main: "./dist/extension.js",
});

function makeStoredZip(files: Readonly<Record<string, string>>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(value);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    chunks.push(local);

    const record = new Uint8Array(46 + nameBytes.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint16(10, 0, true);
    recordView.setUint32(20, data.length, true);
    recordView.setUint32(24, data.length, true);
    recordView.setUint16(28, nameBytes.length, true);
    recordView.setUint32(42, offset, true);
    record.set(nameBytes, 46);
    central.push(record);
    offset += local.length;
  }
  const directoryOffset = offset;
  chunks.push(...central);
  const directorySize = central.reduce((size, chunk) => size + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, directoryOffset, true);
  chunks.push(end);
  const archive = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    archive.set(chunk, cursor);
    cursor += chunk.length;
  }
  return archive;
}

function makeArchive(extraEntries: Readonly<Record<string, string>> = {}): Uint8Array {
  return makeStoredZip({
    "extension/package.json": JSON.stringify(expectedManifest),
    "extension/dist/extension.js": "bundle",
    ...Object.fromEntries(EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.map((entry) => [entry, "resource"])),
    ...extraEntries,
  });
}

describe("loadBundledResearchResources", () => {
  it("loads all allowlisted skills and commands with metadata and templates", async () => {
    const result = await loadBundledResearchResources("/extension/resources", {
      readFile: async (filePath) => {
        const entry = BUNDLED_RESEARCH_RESOURCE_MANIFEST.find((candidate) => filePath.endsWith(candidate.relativePath));
        if (!entry) throw new Error("unexpected path");
        return validContent(entry);
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.resources).toHaveLength(9);
    expect(result.resources.map(({ type, name }) => `${type}:${name}`)).toEqual([
      "command:research-answer",
      "command:research-citations",
      "command:research-edit",
      "command:research-plan",
      "command:research-report",
      "skill:citation-audit",
      "skill:evidence-synthesis",
      "skill:mcp-research",
      "skill:research-workflow",
    ]);
    expect(result.resources.find((resource) => resource.type === "command")).toMatchObject({
      description: expect.any(String),
      template: expect.stringContaining("$ARGUMENTS"),
    });
    expect(result.resources.filter((resource) => resource.type === "skill")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ body: expect.any(String) })]),
    );
  });

  it("skips a missing resource without affecting valid resources", async () => {
    const missing = "skill:mcp-research";
    const result = await loadBundledResearchResources("/extension/resources", {
      readFile: async (filePath) => {
        if (filePath.endsWith("mcp-research/SKILL.md")) throw new Error("missing");
        const entry = BUNDLED_RESEARCH_RESOURCE_MANIFEST.find((candidate) => filePath.endsWith(candidate.relativePath));
        if (!entry) throw new Error("unexpected path");
        return validContent(entry);
      },
    });

    expect(result.resources).toHaveLength(8);
    expect(result.resources.some(({ name }) => name === "mcp-research")).toBe(false);
    expect(result.diagnostics).toEqual([{ resourceId: missing, type: "skill", reason: "missing" }]);
  });

  it("isolates malformed frontmatter and invalid command templates", async () => {
    const result = await loadBundledResearchResources("/extension/resources", {
      readFile: async (filePath) => {
        const entry = BUNDLED_RESEARCH_RESOURCE_MANIFEST.find((candidate) => filePath.endsWith(candidate.relativePath));
        if (!entry) throw new Error("unexpected path");
        if (entry.name === "citation-audit") return "not frontmatter";
        if (entry.name === "research-plan") return "---\ndescription: Missing template\n---\n\nNo arguments";
        return validContent(entry);
      },
    });

    expect(result.resources).toHaveLength(7);
    expect(result.diagnostics).toEqual([
      { resourceId: "command:research-plan", type: "command", reason: "invalid-template" },
      { resourceId: "skill:citation-audit", type: "skill", reason: "malformed-frontmatter" },
    ]);
  });

  it("rejects traversal, absolute, empty, and out-of-bundle manifest paths", async () => {
    const entries = [
      { id: "skill:traversal", type: "skill", name: "safe", relativePath: "skills/../outside.md" },
      { id: "skill:absolute", type: "skill", name: "safe", relativePath: "/outside.md" },
      { id: "skill:windows-drive", type: "skill", name: "safe", relativePath: "C:\\outside.md" },
      { id: "skill:windows-unc", type: "skill", name: "safe", relativePath: "\\\\server\\share\\outside.md" },
      { id: "skill:empty", type: "skill", name: "safe", relativePath: "" },
      { id: "skill:other", type: "skill", name: "safe", relativePath: "other.md" },
    ] as const satisfies readonly BundledResourceManifestEntry[];
    const readFile = async () => validContent(entries[0]);

    const result = await loadBundledResearchResources("/extension/resources", { manifest: entries, readFile });

    expect(result.resources).toEqual([]);
    expect(result.diagnostics).toEqual(
      entries
        .map(({ id, type }) => ({ resourceId: id, type, reason: "invalid-path" as const }))
        .sort((left, right) => left.resourceId.localeCompare(right.resourceId)),
    );
  });

  it("keeps diagnostics bounded to identifiers and never includes resource content or paths", async () => {
    const result = await loadBundledResearchResources("/extension/resources/private", {
      readFile: async () => {
        throw new Error("/extension/resources/private/skills/citation-audit/SKILL.md token=do-not-log");
      },
    });

    expect(result.resources).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("token=do-not-log");
    expect(JSON.stringify(result)).not.toContain("/extension/resources/private");
    expect(result.diagnostics).toEqual(
      BUNDLED_RESEARCH_RESOURCE_MANIFEST.map(({ id, type }) => ({
        resourceId: id,
        type,
        reason: "missing" as const,
      })).sort((left, right) => left.resourceId.localeCompare(right.resourceId)),
    );
  });
});

describe("stageBundledResearchResources", () => {
  it("reports the bounded resource ID and path when a required source is missing", async () => {
    const missingPath = "skills/mcp-research/SKILL.md";

    await expect(
      stageBundledResearchResources({
        sourceRoot: "/repo/skills-commands",
        outputRoot: "/repo/packages/platforms/vscode/dist/skills-commands",
        readSourceFile: async (filePath) => {
          if (filePath.endsWith(missingPath)) throw new Error("missing");
          return "resource";
        },
      }),
    ).rejects.toThrow("skill:mcp-research (skills/mcp-research/SKILL.md)");
  });
});

describe("cleanExtensionDist", () => {
  it("removes only the generated output and is safe to repeat", async () => {
    const outputRoot = path.resolve("tmp/vscode-build-cleanup-test/dist");
    const sourceRoot = path.resolve("tmp/vscode-build-cleanup-test/src");
    await rm(path.dirname(outputRoot), { recursive: true, force: true });
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(outputRoot, { recursive: true });
    await writeFile(path.join(outputRoot, "stale.js"), "stale", "utf8");
    await writeFile(path.join(sourceRoot, "keep.ts"), "source", "utf8");

    try {
      await cleanExtensionDist(outputRoot);
      await cleanExtensionDist(outputRoot);

      await expect(access(outputRoot)).rejects.toThrow();
      await expect(access(path.join(sourceRoot, "keep.ts"))).resolves.toBeUndefined();
    } finally {
      await rm(path.dirname(outputRoot), { recursive: true, force: true });
    }
  });
});

describe("verifyBundledResearchArchiveEntries", () => {
  it("accepts extension-owned allowlisted resource paths", () => {
    expect(() => verifyBundledResearchArchiveEntries(EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS)).not.toThrow();
    expect(() =>
      verifyBundledResearchArchiveEntries(EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.map((entry) => `./${entry}`)),
    ).not.toThrow();
    expect(() =>
      verifyBundledResearchArchiveEntries(
        EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.map((entry) => entry.replace("extension/", "extension/dist/")),
      ),
    ).not.toThrow();
  });

  it("reports missing, misplaced, and workspace resource copies without bodies", () => {
    expect(() => verifyBundledResearchArchiveEntries(EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.slice(1))).toThrow(
      "VSIX is missing bundled research resources: extension/skills-commands/skills/citation-audit/SKILL.md",
    );
    expect(() =>
      verifyBundledResearchArchiveEntries(
        EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.concat("workspace/.opencode/command/research-answer.md"),
      ),
    ).toThrow("workspace .opencode resource copy");
    expect(() =>
      verifyBundledResearchArchiveEntries(
        EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.concat("extension/skills-commands/unallowlisted.md"),
      ),
    ).toThrow("misplaced or unallowlisted research resources");
  });
});

describe("verify VSIX archive manifest and hygiene", () => {
  it("accepts a valid archive and reads its central-directory entries", () => {
    const archive = makeArchive();
    const entries = readZipArchiveEntries(archive);
    expect(() => verifyVsixManifest(archive, expectedManifest, entries)).not.toThrow();
    expect(() => verifyVsixArchiveHygiene(entries)).not.toThrow();
    expect(() => verifyBundledResearchArchiveEntries(entries)).not.toThrow();
  });

  it.each([
    ["name", { name: "other-extension" }],
    ["publisher", { publisher: "other-publisher" }],
    ["version", { version: "9.9.9" }],
    ["main", { main: "./dist/other.js" }],
  ] as const)("rejects a mismatched manifest %s", (_field, change) => {
    const actual = { ...expectedManifest, ...change };
    const archive = makeStoredZip({
      "extension/package.json": JSON.stringify(actual),
      "extension/dist/extension.js": "bundle",
      ...Object.fromEntries(EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.map((entry) => [entry, "resource"])),
    });
    expect(() => verifyVsixManifest(archive, expectedManifest)).toThrow(/VSIX manifest/);
  });

  it("rejects an archive whose manifest main entry is absent", () => {
    const archive = makeStoredZip({
      "extension/package.json": JSON.stringify(expectedManifest),
      ...Object.fromEntries(EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS.map((entry) => [entry, "resource"])),
    });
    expect(() => verifyVsixManifest(archive, expectedManifest)).toThrow("main entry is missing");
  });

  it.each([
    "extension/__tests__/fixture.js",
    "extension/specs/fixture.ts",
    "extension/dist/fixture.js.map",
    "extension/scripts/package.js",
  ])("rejects development entry %s", (entry) =>
    expect(() => verifyVsixArchiveHygiene(readZipArchiveEntries(makeArchive({ [entry]: "fixture" })))).toThrow(
      "forbidden development or native entries",
    ),
  );

  it.each([
    "extension/native/addon.node",
    "extension/native/library.dylib",
    "extension/native/library.so",
    "extension/native/tool.exe",
  ])("rejects native entry %s", (entry) =>
    expect(() => verifyVsixArchiveHygiene(readZipArchiveEntries(makeArchive({ [entry]: "native" })))).toThrow(
      "forbidden development or native entries",
    ),
  );
});
