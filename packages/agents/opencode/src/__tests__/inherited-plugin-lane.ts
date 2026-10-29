import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export const INHERITED_PLUGIN_CLASSIFICATION = "METADATA_ONLY_NOT_RUNTIME_QUALIFIED" as const;
export const MAX_PLUGIN_PACKAGE_JSON_BYTES = 64 * 1024;

export interface ExpectedPluginMetadata {
  readonly identity: string;
  readonly version: string;
  readonly source: string;
}

export interface SelectedPluginRoot {
  readonly root: string;
  readonly source: string;
}

export interface PluginMetadataRecord extends ExpectedPluginMetadata {
  readonly rootRelativeIdentity: string;
  readonly classification: typeof INHERITED_PLUGIN_CLASSIFICATION;
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function assertNoSymlink(root: string): Promise<void> {
  const canonicalRoot = resolve(root);
  const rootStat = await lstat(canonicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Selected plugin root is not a real directory");
  let current = parse(canonicalRoot).root;
  for (const component of relative(current, canonicalRoot).split(sep).filter(Boolean)) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Selected plugin root contains a symlink");
  }
}

/** Reads only package.json at explicitly selected package roots; it never loads plugin code. */
export async function readSelectedPluginMetadata(
  roots: readonly SelectedPluginRoot[],
  expected: ExpectedPluginMetadata,
): Promise<readonly PluginMetadataRecord[]> {
  if (!roots.length || !expected.identity.trim() || !expected.version.trim() || !expected.source.trim()) {
    throw new Error("Explicit roots and nonempty expected identity, version, and source are required");
  }
  const seenRoots = new Set<string>();
  const records: PluginMetadataRecord[] = [];
  for (const selection of roots) {
    if (!selection.source.trim() || !selection.root.trim() || !isAbsolute(selection.root)) {
      throw new Error("Selected roots must be absolute and have nonempty source provenance");
    }
    if (selection.root !== resolve(selection.root))
      throw new Error("Selected plugin root contains traversal components");
    const root = resolve(selection.root);
    if (seenRoots.has(root)) throw new Error("Duplicate/ambiguous selected plugin root");
    seenRoots.add(root);
    await assertNoSymlink(root);
    const packagePath = join(root, "package.json");
    const stat = await lstat(packagePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Selected package.json is not a regular file");
    if (stat.size > MAX_PLUGIN_PACKAGE_JSON_BYTES) throw new Error("Selected package.json exceeds size bound");
    const raw = await readFile(packagePath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_PLUGIN_PACKAGE_JSON_BYTES)
      throw new Error("Selected package.json exceeds size bound");
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("Selected package.json is malformed");
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Selected package metadata is not an object");
    const { name, version } = data as { name?: unknown; version?: unknown };
    if (typeof name !== "string" || !name.trim() || typeof version !== "string" || !version.trim()) {
      throw new Error("Selected package identity/version is empty");
    }
    const source = selection.source.trim();
    if (name !== expected.identity || version !== expected.version || source !== expected.source) {
      throw new Error("Selected plugin metadata does not match expected identity/version/source");
    }
    records.push({
      identity: name,
      version,
      source,
      rootRelativeIdentity: relative(root, packagePath),
      classification: INHERITED_PLUGIN_CLASSIFICATION,
    });
  }
  if (!records.length || new Set(records.map(({ identity }) => identity)).size !== records.length) {
    throw new Error("Expected nonempty, unambiguous plugin metadata inventory");
  }
  return records;
}

export function inheritedPluginGateStatus(inputs: {
  readonly vscodeExecutable: boolean;
  readonly backendWorkspace: boolean;
  readonly hindsightInjection: boolean;
  readonly disposableProviderRetention: boolean;
  readonly soakAgreement: boolean;
}): Readonly<Record<keyof typeof inputs, "PASS" | "BLOCKED">> {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value ? "PASS" : "BLOCKED"])) as Record<
    keyof typeof inputs,
    "PASS" | "BLOCKED"
  >;
}
