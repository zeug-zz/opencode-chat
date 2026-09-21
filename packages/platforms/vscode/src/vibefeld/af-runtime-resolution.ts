import { accessSync, constants as fsConstants, statSync } from "node:fs";
import path from "node:path";
import { type AfDirectLauncher, createAfDirectPolicyAdapter } from "./af-direct-policy";
import {
  AF_DISCOVERY_ROOTS,
  type AfDiscoveryAccess,
  type AfDiscoveryOptions,
  type AfDiscoveryResult,
  type AfDiscoveryStat,
  discoverAfExecutable,
} from "./af-discovery";
import type { AfExecutionPolicyAdapter } from "./af-execution-boundary";

/**
 * Host-private production runtime resolution for the activation composition.
 *
 * This module is the only seam that reads real host state for activation:
 * `process.platform`, `process.env.PATH`, and `AF_DISCOVERY_ROOTS`. It accepts
 * no executable, path, environment, or argv value from a model, prompt, plugin,
 * MCP server, or webview input; it never launches AF, allocates a proof
 * workspace, writes configuration, or queries the Chat sandbox. A dormant
 * result carries only a bounded reason, never a host path or raw output.
 */

const isSupportedPlatform = (platform: NodeJS.Platform): boolean => platform === "darwin" || platform === "linux";

const hostUid = (): number | undefined => (typeof process.getuid === "function" ? process.getuid() : undefined);

/** Real stat seam: only a file owned by this host uid passes. */
const defaultStat = (candidate: string): AfDiscoveryStat | undefined => {
  try {
    const metadata = statSync(candidate);
    const uid = hostUid();
    return { isFile: metadata.isFile(), ownedByHost: uid !== undefined && metadata.uid === uid };
  } catch {
    return undefined;
  }
};

/** Real access seam: only an executable candidate passes. */
const defaultAccess = (candidate: string): AfDiscoveryAccess => {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return "executable";
  } catch {
    return "not-executable";
  }
};

export type ResolveAfExecutableOptions = Readonly<{
  platform?: NodeJS.Platform;
  pathValue?: string;
  candidateRoots?: readonly string[];
  stat?: AfDiscoveryOptions["stat"];
  access?: AfDiscoveryOptions["access"];
}>;

/** Resolve the host-owned AF executable, or a bounded dormant discovery result. */
export const resolveAfExecutable = (options: ResolveAfExecutableOptions = {}): AfDiscoveryResult =>
  discoverAfExecutable({
    platform: options.platform ?? process.platform,
    pathValue: options.pathValue ?? process.env.PATH ?? "",
    candidateRoots: options.candidateRoots ?? AF_DISCOVERY_ROOTS,
    stat: options.stat ?? defaultStat,
    access: options.access ?? defaultAccess,
  });

export type AfRuntimeDormancyReason = "unsupported-platform" | "missing-af";

export type AfRuntimeResolution =
  | Readonly<{
      state: "ready";
      /** Fixed host-owned executable captured by discovery; never model-supplied. */
      resolveExecutable: () => string;
      policy: AfExecutionPolicyAdapter;
    }>
  | Readonly<{ state: "dormant"; reason: AfRuntimeDormancyReason }>;

export type ResolveAfRuntimeOptions = Readonly<{
  platform?: NodeJS.Platform;
  pathValue?: string;
  candidateRoots?: readonly string[];
  stat?: AfDiscoveryOptions["stat"];
  access?: AfDiscoveryOptions["access"];
  /** Test seam for the direct-execution adapter's process launcher. */
  launcher?: AfDirectLauncher;
}>;

/**
 * Compose one host-private activation resolution. A macOS/Linux host with a
 * host-owned AF executable resolves `ready` with the fixed executable and a
 * direct-execution adapter whose readiness derives only from the supported
 * platform and the validated executable; everything else resolves dormant with
 * a bounded reason. No AF process, workspace allocation, configuration write,
 * or Chat sandbox query occurs here.
 */
export const resolveAfRuntime = async (options: ResolveAfRuntimeOptions = {}): Promise<AfRuntimeResolution> => {
  const platform = options.platform ?? process.platform;
  if (!isSupportedPlatform(platform)) return { state: "dormant", reason: "unsupported-platform" };

  const af = resolveAfExecutable({
    platform,
    pathValue: options.pathValue ?? process.env.PATH ?? "",
    candidateRoots: options.candidateRoots ?? AF_DISCOVERY_ROOTS,
    stat: options.stat ?? defaultStat,
    access: options.access ?? defaultAccess,
  });
  // A relative PATH entry is not a host-owned resolution and never reaches the adapter.
  if (af.state !== "found" || !path.posix.isAbsolute(af.executable)) return { state: "dormant", reason: "missing-af" };

  const policy = createAfDirectPolicyAdapter({
    platform,
    resolveExecutable: () => af.executable,
    ...(options.launcher ? { launcher: options.launcher } : {}),
  });
  if (policy.readiness.state !== "ready") return { state: "dormant", reason: "missing-af" };

  return { state: "ready", resolveExecutable: () => af.executable, policy };
};
