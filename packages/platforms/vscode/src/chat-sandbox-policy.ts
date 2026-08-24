import * as os from "node:os";
import * as path from "node:path";

export type ChatSandboxFilesystemPolicy = {
  readWritePaths: readonly string[];
  readOnlyPaths: readonly string[];
  denyReadPaths: readonly string[];
  loopback: {
    host: "127.0.0.1";
    port: 0;
  };
};

export type ChatSandboxNetworkPolicy = {
  enabled: boolean;
  allowedDomains: readonly string[];
  deniedDomains: readonly string[];
  allowLocalBinding: true;
  allowMachLookup: readonly string[];
};

export type ChatSandboxNetworkPolicyInput = {
  allowNetwork?: boolean;
  platform?: NodeJS.Platform;
};

export const MACOS_MACH_LOOKUP_SERVICES = [
  "com.apple.SystemConfiguration.DNSConfiguration",
  "com.apple.trustd.agent",
] as const;

export type ChatSandboxPolicyInput = {
  workspacePath: string;
  openCodePaths?: {
    config?: string;
    auth?: string;
    state?: string;
    cache?: string;
    temp?: string;
  };
  runtimeCachePaths?: readonly string[];
  temporaryPaths?: readonly string[];
  executablePath?: string;
  executablePaths?: readonly string[];
  homePath?: string;
  platform?: NodeJS.Platform;
};

export type OpenCodePaths = {
  config: string;
  state: string;
  cache: string;
  temp: string;
};

export type RuntimeCacheEnvironment = Pick<
  NodeJS.ProcessEnv,
  | "TMPDIR"
  | "TMP"
  | "TEMP"
  | "APPDATA"
  | "LOCALAPPDATA"
  | "XDG_CONFIG_HOME"
  | "XDG_DATA_HOME"
  | "XDG_CACHE_HOME"
  | "XDG_STATE_HOME"
  | "npm_config_cache"
  | "NPM_CONFIG_CACHE"
  | "UV_CACHE_DIR"
>;

const CREDENTIAL_STORE_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", "keychains"]);

function normalizePath(value: string, label: string, platform = process.platform): string {
  if (!value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.normalize(pathApi.resolve(value));
}

function isWithin(candidate: string, parent: string, platform = process.platform): boolean {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const relative = pathApi.relative(parent, candidate);
  return (
    relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative))
  );
}

function isCredentialStorePath(candidate: string, homePath: string, platform = process.platform): boolean {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!isWithin(candidate, homePath, platform)) return false;
  const segments = pathApi.relative(homePath, candidate).split(pathApi.sep).filter(Boolean);
  return segments.some((segment: string) => CREDENTIAL_STORE_SEGMENTS.has(segment.toLowerCase()));
}

function assertNarrowPath(
  candidate: string,
  label: string,
  homePath: string,
  workspacePath: string,
  platform = process.platform,
): void {
  if (candidate === homePath) {
    throw new Error(`${label} must not grant the home-directory root`);
  }
  if (candidate !== workspacePath && isCredentialStorePath(candidate, homePath, platform)) {
    throw new Error(`${label} must not grant credential-store access`);
  }
}

function collectPaths(
  paths: readonly string[],
  label: string,
  homePath: string,
  workspacePath: string,
  platform = process.platform,
): string[] {
  const normalized = paths.map((value) => normalizePath(value, label, platform));
  for (const candidate of normalized) {
    assertNarrowPath(candidate, label, homePath, workspacePath, platform);
  }
  return normalized;
}

function uniqueSorted(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function resolveSafeTemporaryRoot(temporaryPath: string | undefined, platform: NodeJS.Platform): string | undefined {
  if (platform !== "darwin" || temporaryPath === undefined) return undefined;

  const normalizedTemporaryPath = normalizePath(temporaryPath, "temporary path", platform);
  if (path.posix.basename(normalizedTemporaryPath) !== "opencode") return undefined;

  const temporaryRoot = path.posix.dirname(normalizedTemporaryPath);
  const macTemporaryRoots = ["/var/folders", "/private/var/folders"];
  const matchingRoot = macTemporaryRoots.find((root) => isWithin(temporaryRoot, root, platform));
  if (!matchingRoot) return undefined;

  const relativeRoot = path.posix.relative(matchingRoot, temporaryRoot).split(path.posix.sep).filter(Boolean);
  if (relativeRoot.length !== 3 || relativeRoot[2] !== "T" || relativeRoot[0].length !== 2) return undefined;

  return temporaryRoot;
}

export function resolveOpenCodePaths(
  env: RuntimeCacheEnvironment = process.env,
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): OpenCodePaths {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const homePath = normalizePath(homeDir, "homeDir", platform);
  const resolveBasePath = (value: string | undefined, fallback: string): string =>
    pathApi.resolve(pathApi.join(value?.trim() ? value : fallback, "opencode"));
  const isWindows = platform === "win32";
  const configBase = isWindows
    ? (env.APPDATA ?? pathApi.join(homePath, "AppData", "Roaming"))
    : (env.XDG_CONFIG_HOME ?? pathApi.join(homePath, ".config"));
  const dataBase = isWindows
    ? (env.LOCALAPPDATA ?? pathApi.join(homePath, "AppData", "Local"))
    : (env.XDG_DATA_HOME ?? pathApi.join(homePath, ".local", "share"));
  const cacheBase = isWindows
    ? (env.LOCALAPPDATA ?? pathApi.join(homePath, "AppData", "Local"))
    : (env.XDG_CACHE_HOME ?? pathApi.join(homePath, ".cache"));
  const tempBase =
    env.TMPDIR ?? env.TMP ?? env.TEMP ?? (isWindows ? pathApi.join(homePath, "AppData", "Local", "Temp") : os.tmpdir());

  return {
    config: resolveBasePath(configBase, pathApi.join(homePath, ".config")),
    state: resolveBasePath(dataBase, pathApi.join(homePath, ".local", "share")),
    cache: resolveBasePath(cacheBase, pathApi.join(homePath, ".cache")),
    temp: resolveBasePath(tempBase, os.tmpdir()),
  };
}

export function resolveRuntimeCachePaths(
  env: RuntimeCacheEnvironment = process.env,
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const homePath = normalizePath(homeDir, "homeDir", platform);
  const isWindows = platform === "win32";
  const dataRoot =
    env.XDG_DATA_HOME?.trim() ||
    (isWindows
      ? env.LOCALAPPDATA?.trim() || pathApi.join(homePath, "AppData", "Local")
      : platform === "darwin"
        ? pathApi.join(homePath, "Library", "Application Support")
        : pathApi.join(homePath, ".local", "share"));
  const cacheRoot =
    env.XDG_CACHE_HOME?.trim() ||
    (isWindows ? env.LOCALAPPDATA?.trim() : undefined) ||
    (platform === "darwin" ? pathApi.join(homePath, "Library", "Caches") : pathApi.join(homePath, ".cache"));
  const posixCacheRoot = env.XDG_CACHE_HOME?.trim() || pathApi.join(homePath, ".cache");
  const npmCache =
    env.npm_config_cache?.trim() ||
    env.NPM_CONFIG_CACHE?.trim() ||
    (isWindows ? pathApi.join(cacheRoot, "npm-cache") : pathApi.join(homePath, ".npm"));
  const uvCache =
    env.UV_CACHE_DIR?.trim() ||
    (isWindows ? pathApi.join(cacheRoot, "uv", "cache") : pathApi.join(posixCacheRoot, "uv"));
  const macUvCache =
    platform === "darwin" && !env.UV_CACHE_DIR?.trim() && !env.XDG_CACHE_HOME?.trim()
      ? pathApi.join(cacheRoot, "uv")
      : undefined;
  const uvData = isWindows ? undefined : pathApi.join(dataRoot, "uv");
  const posixUvData =
    platform === "darwin"
      ? pathApi.join(env.XDG_DATA_HOME?.trim() || pathApi.join(homePath, ".local", "share"), "uv")
      : undefined;
  const openCodeState = isWindows
    ? undefined
    : pathApi.join(env.XDG_STATE_HOME?.trim() || pathApi.join(homePath, ".local", "state"), "opencode");
  const contextModeSessions = isWindows
    ? undefined
    : pathApi.join(
        env.XDG_CONFIG_HOME?.trim() || pathApi.join(homePath, ".config"),
        "opencode",
        "context-mode",
        "sessions",
      );
  return uniqueSorted(
    [npmCache, uvCache, macUvCache, uvData, posixUvData, openCodeState, contextModeSessions]
      .filter((value): value is string => value !== undefined)
      .map((value) => normalizePath(value, "runtime cache path", platform)),
  );
}

export function buildChatSandboxNetworkPolicy(input: ChatSandboxNetworkPolicyInput = {}): ChatSandboxNetworkPolicy {
  const allowNetwork = input.allowNetwork ?? true;
  const allowMachLookup = input.platform === "darwin" ? [...MACOS_MACH_LOOKUP_SERVICES] : [];

  return allowNetwork
    ? {
        enabled: false,
        allowedDomains: [],
        deniedDomains: [],
        allowLocalBinding: true,
        allowMachLookup,
      }
    : {
        enabled: true,
        allowedDomains: ["localhost", "127.0.0.1"],
        deniedDomains: [],
        allowLocalBinding: true,
        allowMachLookup,
      };
}

export const mapChatSandboxNetworkPolicy = buildChatSandboxNetworkPolicy;

export function buildChatSandboxFilesystemPolicy(input: ChatSandboxPolicyInput): ChatSandboxFilesystemPolicy {
  const platform = input.platform ?? process.platform;
  const workspacePath = normalizePath(input.workspacePath, "workspacePath", platform);
  const homePath = normalizePath(input.homePath ?? os.homedir(), "homePath", platform);
  const openCodePaths = input.openCodePaths ?? {};
  const readOnlyPaths = collectPaths(
    [openCodePaths.config, openCodePaths.auth, input.executablePath, ...(input.executablePaths ?? [])].filter(
      (value): value is string => value !== undefined,
    ),
    "read-only filesystem policy path",
    homePath,
    workspacePath,
    platform,
  );
  const readWritePaths = collectPaths(
    [
      workspacePath,
      openCodePaths.state,
      openCodePaths.cache,
      openCodePaths.temp,
      resolveSafeTemporaryRoot(openCodePaths.temp, platform),
      ...(input.runtimeCachePaths ?? []),
      ...(input.temporaryPaths ?? []),
    ].filter((value): value is string => value !== undefined),
    "filesystem policy path",
    homePath,
    workspacePath,
    platform,
  );
  const readOnlySet = new Set(readOnlyPaths);
  return {
    readWritePaths: uniqueSorted(readWritePaths.filter((value) => !readOnlySet.has(value))),
    readOnlyPaths: uniqueSorted(readOnlyPaths),
    denyReadPaths: [],
    loopback: {
      host: "127.0.0.1",
      port: 0,
    },
  };
}

export const buildChatFilesystemPolicy = buildChatSandboxFilesystemPolicy;
