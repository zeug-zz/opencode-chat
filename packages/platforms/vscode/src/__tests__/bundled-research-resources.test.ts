import { describe, expect, it } from "vitest";
import { stageBundledResearchResources } from "../../scripts/stage-bundled-research-resources";
import {
  EXPECTED_BUNDLED_RESEARCH_ARCHIVE_PATHS,
  verifyBundledResearchArchiveEntries,
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
