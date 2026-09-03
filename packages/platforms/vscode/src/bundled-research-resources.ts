import { readFile } from "node:fs/promises";
import * as path from "node:path";

export type BundledResourceType = "skill" | "command";

export type BundledResourceManifestEntry = {
  readonly id: string;
  readonly type: BundledResourceType;
  readonly name: string;
  readonly relativePath: string;
};

export type BundledSkill = {
  readonly type: "skill";
  readonly name: string;
  readonly description: string;
  readonly relativePath: string;
  readonly absolutePath: string;
};

export type BundledCommand = {
  readonly type: "command";
  readonly name: string;
  readonly description: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly template: string;
};

export type BundledResource = BundledSkill | BundledCommand;

export type BundledResourceDiagnostic = {
  readonly resourceId: string;
  readonly type: BundledResourceType;
  readonly reason: "missing" | "invalid-path" | "malformed-frontmatter" | "invalid-template" | "read-failed";
};

export type BundledResourceLoadResult = {
  readonly resources: readonly BundledResource[];
  readonly diagnostics: readonly BundledResourceDiagnostic[];
};

export type BundledResourceLoaderOptions = {
  readonly readFile?: (filePath: string) => Promise<string>;
  readonly manifest?: readonly BundledResourceManifestEntry[];
};

export const BUNDLED_RESEARCH_RESOURCE_MANIFEST = [
  { id: "skill:citation-audit", type: "skill", name: "citation-audit", relativePath: "skills/citation-audit/SKILL.md" },
  {
    id: "skill:evidence-synthesis",
    type: "skill",
    name: "evidence-synthesis",
    relativePath: "skills/evidence-synthesis/SKILL.md",
  },
  { id: "skill:mcp-research", type: "skill", name: "mcp-research", relativePath: "skills/mcp-research/SKILL.md" },
  {
    id: "skill:research-workflow",
    type: "skill",
    name: "research-workflow",
    relativePath: "skills/research-workflow/SKILL.md",
  },
  {
    id: "command:research-answer",
    type: "command",
    name: "research-answer",
    relativePath: "commands/research-answer.md",
  },
  {
    id: "command:research-citations",
    type: "command",
    name: "research-citations",
    relativePath: "commands/research-citations.md",
  },
  { id: "command:research-edit", type: "command", name: "research-edit", relativePath: "commands/research-edit.md" },
  { id: "command:research-plan", type: "command", name: "research-plan", relativePath: "commands/research-plan.md" },
  {
    id: "command:research-report",
    type: "command",
    name: "research-report",
    relativePath: "commands/research-report.md",
  },
] as const satisfies readonly BundledResourceManifestEntry[];

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 300;

function diagnostic(
  entry: BundledResourceManifestEntry,
  reason: BundledResourceDiagnostic["reason"],
): BundledResourceDiagnostic {
  return { resourceId: entry.id, type: entry.type, reason };
}

function resolveManifestPath(root: string, relativePath: string): string | undefined {
  const normalizedManifestPath = relativePath.replaceAll("\\", "/");
  if (
    !root.trim() ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    normalizedManifestPath.startsWith("//")
  )
    return undefined;
  const segments = normalizedManifestPath.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) return undefined;
  const rootPath = path.resolve(root);
  const resolvedPath = path.resolve(rootPath, ...segments);
  const relativeResolvedPath = path.relative(rootPath, resolvedPath);
  if (
    relativeResolvedPath === "" ||
    relativeResolvedPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeResolvedPath)
  ) {
    return undefined;
  }
  return resolvedPath;
}

function isAllowlistedEntry(entry: BundledResourceManifestEntry): boolean {
  return BUNDLED_RESEARCH_RESOURCE_MANIFEST.some(
    (allowed) =>
      allowed.id === entry.id &&
      allowed.type === entry.type &&
      allowed.name === entry.name &&
      allowed.relativePath === entry.relativePath,
  );
}

function parseFrontmatter(content: string): { fields: Map<string, string>; body: string } | undefined {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return undefined;
  const lines = content.split(/\r?\n/);
  const endIndex = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  if (endIndex < 0) return undefined;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, endIndex)) {
    const match = /^(name|description):\s*(\S(?:.*\S)?)$/.exec(line);
    if (!match || fields.has(match[1])) return undefined;
    fields.set(match[1], match[2]);
  }
  return {
    fields,
    body: lines
      .slice(endIndex + 1)
      .join("\n")
      .trim(),
  };
}

function validDescription(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value.length <= MAX_DESCRIPTION_LENGTH;
}

function loadResource(
  entry: BundledResourceManifestEntry,
  root: string,
  content: string,
): BundledResource | BundledResourceDiagnostic {
  const parsed = parseFrontmatter(content);
  if (!parsed) return diagnostic(entry, "malformed-frontmatter");
  const description = parsed.fields.get("description");
  if (!validDescription(description) || !NAME_PATTERN.test(entry.name))
    return diagnostic(entry, "malformed-frontmatter");
  if (entry.type === "skill") {
    if (parsed.fields.get("name") !== entry.name || !parsed.body) return diagnostic(entry, "malformed-frontmatter");
    return {
      type: "skill",
      name: entry.name,
      description,
      relativePath: entry.relativePath,
      absolutePath: path.resolve(root, entry.relativePath),
    };
  }
  if (!parsed.body?.includes("$ARGUMENTS")) return diagnostic(entry, "invalid-template");
  return {
    type: "command",
    name: entry.name,
    description,
    relativePath: entry.relativePath,
    absolutePath: path.resolve(root, entry.relativePath),
    template: parsed.body,
  };
}

export async function loadBundledResearchResources(
  resourceRoot: string,
  options: BundledResourceLoaderOptions = {},
): Promise<BundledResourceLoadResult> {
  const manifest = options.manifest ?? BUNDLED_RESEARCH_RESOURCE_MANIFEST;
  const read = options.readFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const resources: BundledResource[] = [];
  const diagnostics: BundledResourceDiagnostic[] = [];

  for (const entry of manifest) {
    if (!isAllowlistedEntry(entry)) {
      diagnostics.push(diagnostic(entry, "invalid-path"));
      continue;
    }
    const absolutePath = resolveManifestPath(resourceRoot, entry.relativePath);
    if (!absolutePath) {
      diagnostics.push(diagnostic(entry, "invalid-path"));
      continue;
    }
    let content: string;
    try {
      content = await read(absolutePath);
    } catch {
      diagnostics.push(diagnostic(entry, "missing"));
      continue;
    }
    const loaded = loadResource(entry, resourceRoot, content);
    if ("reason" in loaded) diagnostics.push(loaded);
    else resources.push(loaded);
  }

  resources.sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
  diagnostics.sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  return { resources, diagnostics };
}
