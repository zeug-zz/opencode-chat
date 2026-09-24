import { homedir } from "node:os";
import { resolveOpenCodePaths } from "../chat-sandbox-policy";
import type { AfExecutionPolicyAdapter } from "./af-execution-boundary";
import { type AfOutputParserSet, createProductionAfOutputParsers } from "./af-parser-mode";
import {
  createProofWorkspaceStore,
  type ProofWorkspaceFileSystem,
  type ProofWorkspaceStore,
} from "./proof-workspace-store";
import { createVibefeldRuntimeBridge, type VibefeldRuntimeBridge } from "./vibefeld-runtime";

/**
 * Host-private activation composition. It only assembles the proof store and
 * the runtime bridge from host-supplied paths and injected seams: it performs
 * no preflight, spawns no process, writes nothing, and stays dormant whenever a
 * prerequisite (supported host, executable resolver, direct-execution adapter)
 * is absent. This module intentionally has no `vscode` import so ordinary host
 * wiring only has to pass `context.globalStorageUri` and the workspace folder.
 *
 * The default parsers are the production live parsers, so fixture-shaped
 * evidence is never promoted from this path. Injectable parsers exist for
 * explicit test doubles only.
 */

const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;
const SUPPORTED_ARCHITECTURES = ["arm64", "x64", "arm", "ia32"] as const;
const MAX_HOST_PATH_LENGTH = 4_096;

export type VibefeldActivationDormancyReason =
  | "unsupported-platform"
  | "invalid-host-paths"
  | "missing-executable-resolver"
  | "missing-policy";

export type VibefeldActivationOptions = Readonly<{
  globalStoragePath: string;
  repositoryPath: string;
  /** Host-private boundaries; defaults are host-derived and never model-supplied. */
  homePath?: string;
  openCodeStatePath?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  resolveExecutable?: () => string | undefined | Promise<string | undefined>;
  policy?: AfExecutionPolicyAdapter;
  parsers?: AfOutputParserSet;
  /** Preflight working directory; defaults to the host-private global storage root. */
  preflightCwd?: string;
  idFactory?: () => string;
  fileSystem?: ProofWorkspaceFileSystem;
}>;

export type VibefeldActivationComposition =
  | Readonly<{ state: "dormant"; reason: VibefeldActivationDormancyReason }>
  | Readonly<{ state: "composed"; bridge: VibefeldRuntimeBridge; proofStore: ProofWorkspaceStore }>;

const isUsableHostPath = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_HOST_PATH_LENGTH && !value.includes("\0");

/**
 * Compose (never preflight) the proof store beneath extension global storage
 * and the runtime bridge. Any absent prerequisite returns a dormant result
 * without touching the filesystem, a policy, or a process.
 */
export const createVibefeldActivation = (options: VibefeldActivationOptions): VibefeldActivationComposition => {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  if (
    !SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number]) ||
    !SUPPORTED_ARCHITECTURES.includes(architecture as (typeof SUPPORTED_ARCHITECTURES)[number])
  )
    return { state: "dormant", reason: "unsupported-platform" };
  if (!isUsableHostPath(options.globalStoragePath) || !isUsableHostPath(options.repositoryPath))
    return { state: "dormant", reason: "invalid-host-paths" };
  if (typeof options.resolveExecutable !== "function")
    return { state: "dormant", reason: "missing-executable-resolver" };
  if (!options.policy) return { state: "dormant", reason: "missing-policy" };

  try {
    const proofStore = createProofWorkspaceStore({
      globalStoragePath: options.globalStoragePath,
      repositoryPath: options.repositoryPath,
      homePath: options.homePath ?? homedir(),
      openCodeStatePath: options.openCodeStatePath ?? resolveOpenCodePaths().state,
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
      ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
    });
    const bridge = createVibefeldRuntimeBridge({
      platform,
      architecture: architecture as (typeof SUPPORTED_ARCHITECTURES)[number],
      resolveExecutable: options.resolveExecutable,
      policy: options.policy,
      proofStore,
      parsers: options.parsers ?? createProductionAfOutputParsers(),
      preflightCwd: options.preflightCwd ?? options.globalStoragePath,
    });
    return { state: "composed", bridge, proofStore };
  } catch {
    return { state: "dormant", reason: "invalid-host-paths" };
  }
};

/** Release a composed review root; a dormant composition has nothing to release. */
export const teardownVibefeldActivation = async (composition: VibefeldActivationComposition): Promise<void> => {
  if (composition.state !== "composed") return;
  await composition.bridge.teardown();
};
