import { execFile as nodeExecFile } from "node:child_process";
import { accessSync, constants as fsConstants, readdirSync } from "node:fs";
import { homedir as nodeHomedir } from "node:os";
import * as path from "node:path";
import type { OpenCodeLaunchBackend } from "@opencode-chat/agent-opencode";

export type CompanionLaunchBackend = OpenCodeLaunchBackend;

/** Retained as the documented profile name used by compatibility callers. */
export const DOCUMENTED_NONO_PROFILE = "opencode" as const;
const NONO_PREFLIGHT_TIMEOUT_MS = 1_500;
const NONO_PREFLIGHT_MAX_BUFFER = 4_096;

type ExecFile = typeof nodeExecFile;
type ReadDirectory = typeof readdirSync;

export type NonoResolution = {
  backend: CompanionLaunchBackend;
  executablePath?: string;
  profile?: string;
  diagnostic: NonoDiagnostic;
};

export type NonoDiagnostic =
  | "disabled"
  | "unsupported-platform"
  | "resolved-and-preflighted"
  | "missing-executable"
  | "non-executable"
  | "preflight-failed"
  | "preflight-unsupported";

export type NonoResolverOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  access?: typeof accessSync;
  execFile?: ExecFile;
  readDirectory?: ReadDirectory;
  homedir?: typeof nodeHomedir;
  selectedProfile?: string;
};

type CachedResolution = Promise<NonoResolution>;
const resolutionCache = new Map<string, CachedResolution>();

function supportedPlatform(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "linux";
}

function cacheKey(
  enabled: boolean,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  selectedProfile?: string,
): string {
  // Values are used only as a cache key; they are never included in diagnostics.
  return [
    platform,
    enabled ? "on" : "off",
    selectedProfile ?? "",
    env.NONO_BIN ?? "",
    env.PATH ?? "",
    env.XDG_CONFIG_HOME ?? "",
  ].join("\u0000");
}

function executableCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (!supportedPlatform(platform)) return [];

  const candidates = [
    env.NONO_BIN,
    "/opt/homebrew/bin/nono",
    "/usr/local/bin/nono",
    "/usr/bin/nono",
    "/bin/nono",
    ...(env.PATH ?? "")
      .split(":")
      .filter((directory) => path.posix.isAbsolute(directory))
      .map((directory) => path.posix.join(directory, "nono")),
  ];

  return [
    ...new Set(
      candidates.filter((candidate): candidate is string => Boolean(candidate) && path.posix.isAbsolute(candidate)),
    ),
  ];
}

function userProfileDirectory(env: NodeJS.ProcessEnv, homedir: typeof nodeHomedir): string {
  const configHome = env.XDG_CONFIG_HOME;
  return path.join(
    configHome && path.posix.isAbsolute(configHome) ? configHome : path.join(homedir(), ".config"),
    "nono",
    "profiles",
  );
}

function safeProfileName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) && value !== "." && value !== "..";
}

function profileNamesFromListing(stdout: string, directoryEntries: string[]): string[] {
  const entries = new Set(
    directoryEntries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .filter((entry) => entry !== DOCUMENTED_NONO_PROFILE)
      .filter(safeProfileName),
  );
  const names: string[] = [];
  let inUserSection = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (/^\s*User\s*\(/.test(line)) {
      inUserSection = true;
      continue;
    }
    if (inUserSection && /^\s*[A-Za-z][A-Za-z ]*:\s*$/.test(line)) break;
    if (!inUserSection) continue;
    const match = line.match(/^\s{4}([^\s]+)(?:\s{2,}|$)/);
    if (match && safeProfileName(match[1]) && entries.has(match[1])) names.push(match[1]);
  }
  return [...new Set(names)].sort();
}

function boundedDiagnostic(error: unknown): NonoDiagnostic {
  if (!error || typeof error !== "object") return "preflight-failed";
  const code = "code" in error ? error.code : undefined;
  if (code === "ETIMEDOUT") return "preflight-unsupported";
  if (code === "ENOENT" || code === "ENOTSUP" || code === "ENOSYS") return "preflight-unsupported";
  return "preflight-failed";
}

async function preflight(executablePath: string, profile: string, execFile: ExecFile): Promise<NonoDiagnostic> {
  const run = (args: string[]): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      execFile(
        executablePath,
        args,
        {
          timeout: NONO_PREFLIGHT_TIMEOUT_MS,
          maxBuffer: NONO_PREFLIGHT_MAX_BUFFER,
          windowsHide: true,
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
  try {
    await run(["--version"]);
    // This is an inspection-only command. It validates a name returned by
    // nono's profile listing, without reading the profile's policy contents.
    await run(["profile", "show", profile]);
    return "resolved-and-preflighted";
  } catch (error) {
    return boundedDiagnostic(error);
  }
}

export async function discoverNonoProfiles(options: NonoResolverOptions = {}): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  if (!supportedPlatform(platform)) return [];
  const env = options.env ?? process.env;
  const readDirectory = options.readDirectory ?? readdirSync;
  const homedir = options.homedir ?? nodeHomedir;
  const candidates = env.NONO_BIN ? [env.NONO_BIN] : executableCandidates(env, platform);
  for (const candidate of candidates) {
    if (!path.posix.isAbsolute(candidate)) continue;
    try {
      (options.access ?? accessSync)(candidate, fsConstants.X_OK);
    } catch {
      continue;
    }
    const directory = userProfileDirectory(env, homedir);
    let entries: string[];
    try {
      entries = readDirectory(directory);
    } catch {
      continue;
    }
    const result = await new Promise<string[]>((resolve) => {
      (options.execFile ?? nodeExecFile)(
        candidate,
        ["profile", "list"],
        { timeout: NONO_PREFLIGHT_TIMEOUT_MS, maxBuffer: NONO_PREFLIGHT_MAX_BUFFER, windowsHide: true },
        (error, stdout) => resolve(error ? [] : profileNamesFromListing(stdout, entries)),
      );
    });
    if (result.length > 0) return result;
  }
  return [];
}

function effectiveProfile(selectedProfile?: string): string {
  return selectedProfile ?? DOCUMENTED_NONO_PROFILE;
}

async function resolveNonoBackendUncached(
  enabled: boolean,
  options: Required<Pick<NonoResolverOptions, "env" | "platform" | "access" | "execFile">> &
    Pick<NonoResolverOptions, "selectedProfile">,
): Promise<NonoResolution> {
  if (!enabled) return { backend: "sdk", diagnostic: "disabled" };
  if (!supportedPlatform(options.platform)) return { backend: "vscode", diagnostic: "unsupported-platform" };
  const profile = effectiveProfile(options.selectedProfile);
  if (!safeProfileName(profile)) return { backend: "vscode", diagnostic: "missing-executable" };

  const explicitCandidate = options.env.NONO_BIN;
  if (explicitCandidate) {
    if (!path.posix.isAbsolute(explicitCandidate)) {
      return { backend: "vscode", diagnostic: "non-executable" };
    }
    try {
      options.access(explicitCandidate, fsConstants.X_OK);
    } catch {
      return { backend: "vscode", diagnostic: "non-executable" };
    }
    const discovered = options.selectedProfile
      ? await discoverNonoProfiles({ ...options, access: () => undefined })
      : [];
    if (options.selectedProfile && !discovered.includes(profile)) {
      return { backend: "vscode", diagnostic: "missing-executable" };
    }
    const diagnostic = await preflight(explicitCandidate, profile, options.execFile);
    return diagnostic === "resolved-and-preflighted"
      ? {
          backend: "nono",
          executablePath: explicitCandidate,
          profile,
          diagnostic,
        }
      : { backend: "vscode", diagnostic };
  }

  let foundCandidate = false;
  let lastPreflightDiagnostic: NonoDiagnostic = "preflight-failed";
  for (const candidate of executableCandidates(options.env, options.platform)) {
    try {
      options.access(candidate, fsConstants.X_OK);
      foundCandidate = true;
    } catch {
      continue;
    }

    if (options.selectedProfile && !(await discoverNonoProfiles({ ...options, env: options.env })).includes(profile)) {
      lastPreflightDiagnostic = "missing-executable";
      continue;
    }
    const diagnostic = await preflight(candidate, profile, options.execFile);
    lastPreflightDiagnostic = diagnostic;
    if (diagnostic === "resolved-and-preflighted") {
      return {
        backend: "nono",
        executablePath: candidate,
        profile,
        diagnostic,
      };
    }
  }

  return {
    backend: "vscode",
    diagnostic: foundCandidate ? lastPreflightDiagnostic : "missing-executable",
  };
}

/** Resolve once per environment/platform/settings tuple for the connection. */
export function resolveNonoBackend(enabled: boolean, options: NonoResolverOptions = {}): Promise<NonoResolution> {
  const resolved = {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    access: options.access ?? accessSync,
    execFile: options.execFile ?? nodeExecFile,
    readDirectory: options.readDirectory ?? readdirSync,
    homedir: options.homedir ?? nodeHomedir,
    selectedProfile: options.selectedProfile,
  };
  const key = cacheKey(enabled, resolved.env, resolved.platform, resolved.selectedProfile);
  const cached = resolutionCache.get(key);
  if (cached) return cached;

  const resolution = resolveNonoBackendUncached(enabled, resolved);
  resolutionCache.set(key, resolution);
  return resolution;
}

/** Test and connection-lifecycle seam; production callers normally keep the cache. */
export function clearNonoBackendResolutionCache(): void {
  resolutionCache.clear();
}
