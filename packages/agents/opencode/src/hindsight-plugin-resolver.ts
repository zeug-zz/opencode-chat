import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, parse, resolve } from "node:path";

export const APPROVED_HINDSIGHT_PACKAGE = "@vectorize-io/hindsight-coding-agents";

export type HindsightPluginEntry = string | readonly [string, ...(readonly unknown[])];

export type EffectiveOpenCodeConfiguration = {
  readonly plugin?: readonly unknown[];
};

export type HindsightPackageMetadata = {
  readonly name: string;
  readonly packageRoot: string;
  readonly runtimePaths?: readonly string[];
  readonly configurationPaths?: readonly string[];
};

export type HindsightPackageMetadataReader = (
  pluginReference: string,
) => HindsightPackageMetadata | undefined | Promise<HindsightPackageMetadata | undefined>;

export type HindsightPluginResolution = Readonly<{
  readonly pluginReference: string;
  readonly packageRoot?: string;
  readonly runtimePaths: readonly string[];
  readonly configurationPaths: readonly string[];
}>;

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;

function parseJsonc(source: string): Record<string, unknown> | undefined {
  if (source.length > MAX_CONFIG_BYTES) return undefined;
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  let blockComment = false;
  let lineComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
        withoutComments += character;
      } else withoutComments += " ";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        withoutComments += "  ";
        index += 1;
      } else withoutComments += character === "\n" || character === "\r" ? character : " ";
      continue;
    }
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      withoutComments += character;
    } else if (character === "/" && next === "/") {
      lineComment = true;
      withoutComments += "  ";
      index += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      withoutComments += "  ";
      index += 1;
    } else withoutComments += character;
  }
  if (blockComment) return undefined;
  try {
    const value: unknown = JSON.parse(withoutComments.replace(/,\s*([}\]])/g, "$1"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function projectConfigDirectories(workspaceRoot: string): string[] {
  const directories: string[] = [];
  let current = resolve(workspaceRoot);
  while (true) {
    directories.push(current);
    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories.reverse();
}

/** Reads config layers only; it never loads or executes a plugin. */
export function readEffectiveOpenCodeConfiguration(
  globalConfigDir: string,
  workspaceRoot: string,
): EffectiveOpenCodeConfiguration {
  const plugin: unknown[] = [];
  const read = (directory: string): void => {
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      try {
        const config = parseJsonc(readFileSync(join(directory, name), "utf8"));
        if (Array.isArray(config?.plugin)) plugin.push(...config.plugin);
      } catch {
        // Missing and malformed optional layers are ignored by the preflight.
      }
    }
  };
  read(globalConfigDir);
  for (const directory of projectConfigDirectories(workspaceRoot)) read(directory);
  return { plugin };
}

/** Safe default reader for local entries. Only package identity and paths escape. */
export function readHindsightPackageMetadata(pluginReference: string): HindsightPackageMetadata | undefined {
  if (!isAbsoluteSafePath(pluginReference)) return undefined;
  let candidate = normalize(pluginReference);
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const raw = readFileSync(join(candidate, "package.json"), "utf8");
      if (raw.length > MAX_METADATA_BYTES) return undefined;
      const metadata: unknown = JSON.parse(raw);
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
      const name = (metadata as { name?: unknown }).name;
      return name === APPROVED_HINDSIGHT_PACKAGE && isAbsoluteSafePath(candidate)
        ? { name, packageRoot: candidate }
        : undefined;
    } catch {
      candidate = dirname(candidate);
    }
  }
  return undefined;
}

function pluginReference(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0];
  return undefined;
}

function isAbsoluteSafePath(value: unknown): value is string {
  if (typeof value !== "string" || !isAbsolute(value)) return false;
  const normalized = normalize(value);
  if (normalized === parse(normalized).root || normalized !== value) return false;
  return !value.split("/").includes("..");
}

function normalizePaths(paths: unknown): readonly string[] | undefined {
  if (paths === undefined) return [];
  if (!Array.isArray(paths)) return undefined;
  const normalized = new Set<string>();
  for (const path of paths) {
    if (!isAbsoluteSafePath(path)) return undefined;
    normalized.add(path);
  }
  return [...normalized].sort();
}

function isApprovedPackageReference(reference: string): boolean {
  return reference === APPROVED_HINDSIGHT_PACKAGE;
}

function isLocalReference(reference: string): boolean {
  return isAbsolute(reference);
}

function metadataIsApproved(metadata: HindsightPackageMetadata | undefined): metadata is HindsightPackageMetadata {
  return Boolean(metadata && metadata.name === APPROVED_HINDSIGHT_PACKAGE && isAbsoluteSafePath(metadata.packageRoot));
}

/**
 * Resolves the one explicitly approved Hindsight entry without loading plugin
 * code. The metadata reader is intentionally the only injectable dependency.
 */
export async function resolveHindsightPlugin(
  configuration: EffectiveOpenCodeConfiguration,
  readPackageMetadata: HindsightPackageMetadataReader,
): Promise<HindsightPluginResolution | undefined> {
  if (!Array.isArray(configuration.plugin)) return undefined;

  for (const entry of configuration.plugin) {
    const reference = pluginReference(entry);
    if (!reference) continue;

    let metadata: HindsightPackageMetadata | undefined;
    if (isApprovedPackageReference(reference)) {
      metadata = undefined;
    } else if (isLocalReference(reference)) {
      try {
        metadata = await readPackageMetadata(reference);
      } catch {
        continue;
      }
      if (!metadataIsApproved(metadata)) continue;
    } else {
      continue;
    }

    const runtimePaths = normalizePaths(metadata?.runtimePaths);
    const configurationPaths = normalizePaths(metadata?.configurationPaths);
    if (runtimePaths === undefined || configurationPaths === undefined) continue;

    return Object.freeze({
      pluginReference: reference,
      ...(metadata ? { packageRoot: metadata.packageRoot } : {}),
      runtimePaths,
      configurationPaths,
    });
  }

  return undefined;
}
