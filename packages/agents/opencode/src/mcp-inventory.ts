import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

export type McpTransport = "stdio" | "http" | "sdk" | "unknown";
export type McpServerDefinition = Record<string, unknown> & { type: "local" | "remote" };
export type McpInventory = {
  timeout?: { startup?: number; catalog?: number; execution?: number };
  servers: Record<
    string,
    {
      definition: McpServerDefinition;
      source: string;
      explicitlyDisabled: boolean;
      transport: McpTransport;
    }
  >;
  /**
   * Inventoried servers that higher-authority (system/MDM managed or
   * `integration.use` policy) configuration denies, sorted. Ordinary user
   * `disabled: true` is deliberately not locked.
   */
  locked: readonly string[];
  qualificationGaps: readonly string[];
};

/** Injectable managed-source discovery so tests never read real system paths. */
export type McpInventoryOptions = {
  systemDirectory?: string;
  /** Candidate MDM plists, most specific first; the first present file wins. */
  preferencePaths?: readonly string[];
  /** Returns `plutil -convert json` output for a plist path; may throw. */
  readPreference?: (path: string) => string;
  /**
   * Explicit config file (native `options.file`, from `OPENCODE_CONFIG`). Defaults to the host
   * environment value; the private child inherits it. Relative paths resolve against the workspace
   * because the child runs there.
   */
  explicitConfigFile?: string;
};

type JsonObject = Record<string, unknown>;
type PolicyStatement = { action: string; resource: string; effect: string };

// core/src/config/discovery.ts:25-29 (systemDirectory) and :32-37 (preferencePaths).
function defaultSystemDirectory(): string {
  if (process.platform === "darwin") return "/Library/Application Support/opencode";
  if (process.platform === "win32") return join(process.env.ProgramData || "C:\\ProgramData", "opencode");
  return "/etc/opencode";
}

function defaultPreferencePaths(): string[] {
  if (process.platform !== "darwin") return [];
  let user = "user";
  try {
    user = userInfo().username;
  } catch {
    // Native falls back to "user" as well (discovery.ts:96).
  }
  return [
    join("/Library/Managed Preferences", user, "ai.opencode.managed.plist"),
    "/Library/Managed Preferences/ai.opencode.managed.plist",
  ];
}

function defaultReadPreference(plist: string): string {
  // core/src/config.ts:191-196: plutil with a 10s timeout, no shell.
  return execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// core/src/config/discovery.ts:40-48 and :51-56.
const PREFERENCE_METADATA = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
]);

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// core/src/util/wildcard.ts:3-14, mirrored exactly for policy resources.
function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/");
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`;
  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(normalized);
}

// schema/src/config/policy.ts:6-15: action/effect are closed literal sets.
function readPolicies(config: JsonObject): PolicyStatement[] {
  if (config.policies === undefined) return [];
  if (!Array.isArray(config.policies)) throw new Error("Invalid native MCP configuration");
  return config.policies.map((entry: unknown) => {
    if (
      !isObject(entry) ||
      !["provider.use", "tool.use", "integration.use"].includes(String(entry.action)) ||
      typeof entry.resource !== "string" ||
      (entry.effect !== "allow" && entry.effect !== "deny")
    )
      throw new Error("Invalid native MCP configuration");
    return { action: String(entry.action), resource: entry.resource, effect: entry.effect };
  });
}

// core/src/managed-policy.ts:66-75: the last matching statement wins, default allow.
function policyDecision(statements: readonly PolicyStatement[], resource: string): string {
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const policy = statements[index];
    if (policy.action === "integration.use" && wildcardMatch(resource, policy.resource)) return policy.effect;
  }
  return "allow";
}

function stripJsonc(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inLineComment) {
      if (character === "\n" || character === "\r") {
        inLineComment = false;
        result += character;
      } else result += " ";
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        result += "  ";
        index += 1;
      } else result += character === "\n" || character === "\r" ? character : " ";
      continue;
    }
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === "/" && next === "/") {
      inLineComment = true;
      result += "  ";
      index += 1;
    } else if (character === "/" && next === "*") {
      inBlockComment = true;
      result += "  ";
      index += 1;
    } else result += character;
  }
  if (inBlockComment) throw new Error("invalid");
  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < result.length; index += 1) {
    const character = result[index];
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      normalized += character;
    } else if (character === ",") {
      let next = index + 1;
      while (/\s/.test(result[next] ?? "")) next += 1;
      if (result[next] !== "}" && result[next] !== "]") normalized += character;
    } else normalized += character;
  }
  return normalized;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readConfig(filePath: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(readFileSync(filePath, "utf8")));
    if (!isObject(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error("Unable to read or parse native MCP config");
  }
}

// Native loadFile uses readFileStringSafe, which treats NotFound and access-denied as absent
// (util/src/fs-util.ts:73-79, core/src/config.ts:142-144); parse failures still fail.
function readOptionalConfig(filePath: string): JsonObject | undefined {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM") return undefined;
    throw new Error("Unable to read or parse native MCP config");
  }
  try {
    const parsed: unknown = JSON.parse(stripJsonc(text));
    if (!isObject(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error("Unable to read or parse native MCP config");
  }
}

// Native compares realpath-resolved locations (fs.resolve), falling back to the lexical path.
function realResolve(target: string): string {
  try {
    return realpathSync.native(target);
  } catch {
    return resolve(target);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function validateDefinition(value: unknown): McpServerDefinition | undefined {
  if (!isObject(value) || (value.type !== "local" && value.type !== "remote")) return undefined;
  const normalized =
    typeof value.timeout === "number"
      ? { ...value, timeout: { startup: value.timeout, catalog: value.timeout, execution: value.timeout } }
      : value;
  const allowed = new Set([
    "type",
    "command",
    "cwd",
    "environment",
    "disabled",
    "codemode",
    "timeout",
    "protocol",
    "url",
    "headers",
    "oauth",
  ]);
  if (Object.keys(normalized).some((key) => !allowed.has(key))) return undefined;
  if (normalized.disabled !== undefined && typeof normalized.disabled !== "boolean") return undefined;
  if (normalized.codemode !== undefined && typeof normalized.codemode !== "boolean") return undefined;
  if (normalized.protocol !== undefined && !["legacy", "auto", "2026-07-28"].includes(String(normalized.protocol)))
    return undefined;
  if (
    normalized.timeout !== undefined &&
    (!isObject(normalized.timeout) ||
      Object.keys(normalized.timeout).some((key) => !["startup", "catalog", "execution"].includes(key)) ||
      Object.values(normalized.timeout).some((n) => !Number.isInteger(n) || (n as number) <= 0))
  )
    return undefined;
  if (normalized.type === "local") {
    if (!Array.isArray(normalized.command) || !normalized.command.every((item) => typeof item === "string"))
      return undefined;
    if (normalized.cwd !== undefined && typeof normalized.cwd !== "string") return undefined;
    if (normalized.environment !== undefined && !isStringRecord(normalized.environment)) return undefined;
    if (normalized.url !== undefined || normalized.headers !== undefined || normalized.oauth !== undefined)
      return undefined;
  } else {
    if (typeof normalized.url !== "string") return undefined;
    if (normalized.headers !== undefined && !isStringRecord(normalized.headers)) return undefined;
    if (normalized.oauth !== undefined && normalized.oauth !== false) {
      const oauthFields = new Set([
        "client_id",
        "client_secret",
        "scope",
        "callback_port",
        "redirect_uri",
        "auth_server_metadata_url",
      ]);
      if (!isObject(normalized.oauth) || Object.keys(normalized.oauth).some((key) => !oauthFields.has(key)))
        return undefined;
      if (
        Object.entries(normalized.oauth).some(([key, item]) =>
          key === "callback_port"
            ? !Number.isInteger(item) || (item as number) < 1 || (item as number) > 65535
            : typeof item !== "string",
        )
      )
        return undefined;
    }
    if (normalized.command !== undefined || normalized.cwd !== undefined || normalized.environment !== undefined)
      return undefined;
  }
  return structuredClone(normalized) as McpServerDefinition;
}

function isLegacyDefinition(value: unknown): value is JsonObject {
  return isObject(value) && (value.type === "local" || value.type === "remote");
}

function migrateLegacyDefinition(value: JsonObject): McpServerDefinition | undefined {
  const allowed = new Set(["type", "command", "cwd", "environment", "enabled", "timeout", "url", "headers", "oauth"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return undefined;
  const { enabled, timeout, ...definition } = value;
  const migratedTimeout =
    typeof timeout === "number" ? { startup: timeout, catalog: timeout, execution: timeout } : timeout;
  const oauth = value.oauth;
  const oauthNames: Record<string, string> = {
    clientId: "client_id",
    clientSecret: "client_secret",
    scope: "scope",
    callbackPort: "callback_port",
    redirectUri: "redirect_uri",
  };
  if (isObject(oauth) && Object.keys(oauth).some((key) => !Object.hasOwn(oauthNames, key))) return undefined;
  const migratedOAuth = isObject(oauth)
    ? Object.fromEntries(Object.entries(oauth).map(([key, item]) => [oauthNames[key], item]))
    : oauth;
  const migrated = {
    ...definition,
    ...(enabled === undefined ? {} : { disabled: !enabled }),
    ...(migratedTimeout === undefined ? {} : { timeout: migratedTimeout }),
    ...(migratedOAuth === undefined ? {} : { oauth: migratedOAuth }),
  };
  return validateDefinition(migrated);
}

function migrateTimeout(value: unknown): unknown {
  return typeof value === "number" ? { startup: value, catalog: value, execution: value } : value;
}

function isEnabledOnlyRecord(value: unknown): value is JsonObject {
  return isObject(value) && !Object.hasOwn(value, "type") && typeof value.enabled === "boolean";
}

function projectDirectories(workspaceRoot: string): string[] {
  const directories: string[] = [];
  let current = resolve(workspaceRoot);
  while (true) {
    directories.unshift(current);
    const parent = dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

export function resolveMcpInventory(
  globalConfigDir: string,
  workspaceRoot: string,
  options: McpInventoryOptions = {},
): McpInventory {
  const servers: McpInventory["servers"] = Object.create(null) as McpInventory["servers"];
  const timeout: NonNullable<McpInventory["timeout"]> = {};
  const globalFiles = ["opencode.json", "opencode.jsonc"].map((name) => join(globalConfigDir, name));
  const systemDirectory = options.systemDirectory ?? defaultSystemDirectory();
  const configRoots = [realResolve(systemDirectory), realResolve(globalConfigDir)];
  // Native skips the whole project walk when the workspace is itself the system or global config
  // directory (core/src/config/discovery.ts:76-80); other walked directories that resolve into
  // those roots are hidden (:97-103).
  const directories = configRoots.includes(realResolve(workspaceRoot))
    ? []
    : projectDirectories(workspaceRoot).filter((directory) => !configRoots.includes(realResolve(directory)));
  const directFiles = directories.flatMap((directory) => [
    join(directory, "opencode.json"),
    join(directory, "opencode.jsonc"),
  ]);
  const projectFiles = directories.flatMap((directory) => [
    join(directory, ".opencode", "opencode.json"),
    join(directory, ".opencode", "opencode.jsonc"),
  ]);
  // core/src/config/discovery.ts:129 (explicit = path.resolve(options.file), empty is absent) and
  // cli/src/server-process.ts:131 (file: process.env.OPENCODE_CONFIG); the child cwd is the workspace.
  const explicitSetting = options.explicitConfigFile ?? process.env.OPENCODE_CONFIG;
  const explicitFile = explicitSetting ? resolve(workspaceRoot, explicitSetting) : undefined;
  const gaps: string[] = [];
  // Managed sources load after Scribe's overlay (core/src/config.ts:250-253,289), so their complete
  // definitions replace earlier ones. A custom system directory also skips host MDM preferences
  // (core/src/config/discovery.ts:93-99).
  const preferenceCandidates =
    options.preferencePaths ?? (options.systemDirectory === undefined ? defaultPreferencePaths() : []);
  const managedSources: { file: string; config: JsonObject }[] = ["opencode.json", "opencode.jsonc"]
    .map((name) => join(systemDirectory, name))
    .filter((file) => existsSync(file))
    .map((file) => ({ file, config: readConfig(file) }));
  const preference = preferenceCandidates.find(isFile);
  if (preference) {
    try {
      const parsed: unknown = JSON.parse((options.readPreference ?? defaultReadPreference)(preference));
      if (!isObject(parsed)) throw new Error("invalid");
      managedSources.push({
        file: preference,
        config: Object.fromEntries(Object.entries(parsed).filter(([key]) => !PREFERENCE_METADATA.has(key))),
      });
    } catch (error) {
      // Native ignores a plist that plutil cannot convert (config.ts:197-200) but fails on malformed
      // converted content; mirror both so the inventory never claims a source native would not apply.
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "invalid"))
        throw new Error("Unable to read or parse native MCP config");
      gaps.push("A managed-preference plist could not be converted; native ignores it and so does this inventory.");
    }
  }
  const readExisting = (list: string[]) =>
    list.filter((file) => existsSync(file)).map((file) => ({ file, config: readConfig(file) }));
  const explicitConfig = explicitFile ? readOptionalConfig(explicitFile) : undefined;
  // Load order: global, explicit, direct, project (core/src/config.ts:282-286).
  const fileSources = [
    ...readExisting(globalFiles),
    ...(explicitFile && explicitConfig ? [{ file: explicitFile, config: explicitConfig }] : []),
    ...readExisting(directFiles),
    ...readExisting(projectFiles),
  ];
  const sources = [...fileSources, ...managedSources];
  // Load order is managed policies (reversed) then ordinary files; statements are then built from the
  // reversed document list so the earliest-loaded document wins the final findLast
  // (core/src/config.ts:254-266, 281-290; core/src/managed-policy.ts:50-64).
  const policyDocuments = [
    ...managedSources.map((source) => readPolicies(source.config)).reverse(),
    ...fileSources.map((source) => readPolicies(source.config)),
  ];
  const statements = [...policyDocuments].reverse().flat();
  const managedFiles = new Set(managedSources.map((source) => source.file));
  const lockedByDefinition = new Set<string>();
  for (const { file, config } of sources) {
    if (config.experimental && isObject(config.experimental) && config.experimental.mcp_timeout !== undefined) {
      const experimentalTimeout = config.experimental.mcp_timeout;
      if (typeof experimentalTimeout !== "number" || !Number.isInteger(experimentalTimeout) || experimentalTimeout <= 0)
        throw new Error("Invalid native MCP configuration");
      Object.assign(timeout, { catalog: experimentalTimeout, execution: experimentalTimeout });
    }
    if (config.mcp === undefined) continue;
    if (!isObject(config.mcp) || (config.mcp.servers !== undefined && !isObject(config.mcp.servers))) {
      throw new Error("Invalid native MCP configuration");
    }
    const legacyServers: Record<string, JsonObject> = {};
    const nativeServers: Record<string, unknown> = {};
    for (const [name, candidate] of Object.entries(config.mcp)) {
      if (isEnabledOnlyRecord(candidate)) continue;
      if (name === "timeout" && !isLegacyDefinition(candidate)) {
        const migrated = migrateTimeout(candidate);
        if (
          !isObject(migrated) ||
          Object.keys(migrated).some((key) => !["startup", "catalog", "execution"].includes(key)) ||
          Object.values(migrated).some((n) => !Number.isInteger(n) || (n as number) <= 0)
        )
          throw new Error("Invalid native MCP configuration");
        Object.assign(timeout, migrated);
        continue;
      }
      if (name === "servers" && !isLegacyDefinition(candidate)) {
        if (!isObject(candidate)) throw new Error("Invalid native MCP configuration");
        Object.assign(nativeServers, candidate);
        continue;
      }
      if (isLegacyDefinition(candidate)) {
        legacyServers[name] = candidate;
        continue;
      }
      if (name !== "timeout" && name !== "servers") throw new Error("Invalid native MCP server definition");
    }
    for (const [name, candidate] of Object.entries(legacyServers)) {
      if (candidate === undefined) continue;
      const definition = migrateLegacyDefinition(candidate);
      if (!definition) throw new Error("Invalid native MCP server definition");
      servers[name] = {
        definition,
        source: file,
        explicitlyDisabled: definition.disabled === true,
        transport: definition.type === "local" ? "stdio" : "http",
      };
      if (managedFiles.has(file) && definition.disabled === true) lockedByDefinition.add(name);
      else lockedByDefinition.delete(name);
    }
    for (const [name, candidate] of Object.entries(nativeServers)) {
      const definition = validateDefinition(candidate);
      if (!definition) throw new Error("Invalid native MCP server definition");
      servers[name] = {
        definition,
        source: file,
        explicitlyDisabled: definition.disabled === true,
        transport: definition.type === "local" ? "stdio" : "http",
      };
      if (managedFiles.has(file) && definition.disabled === true) lockedByDefinition.add(name);
      else lockedByDefinition.delete(name);
    }
  }
  const locked = Object.keys(servers)
    .filter((name) => lockedByDefinition.has(name) || policyDecision(statements, `mcp:${name}`) === "deny")
    .sort();
  return {
    ...(Object.keys(timeout).length ? { timeout } : {}),
    servers,
    locked,
    qualificationGaps: [
      ...gaps,
      "OPENCODE_CONFIG_CONTENT, well-known integrations, and connected-organization console policies are not inventoried; their denials are not locally classified.",
      "Inherited/runtime MCP discovery is not inventoried.",
      "Native discovery/merge parity and selected-server startup suppression require runtime qualification.",
    ],
  };
}
