import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER_FILE = ".v2-isolation-owner";
const OUTPUT_LIMIT = 4_096;
const CHILD_TIMEOUT_MS = 2_000;
const CHILD_KILL_GRACE_MS = 250;
const CHILD_REAP_TIMEOUT_MS = 1_000;
const DEFAULT_PROJECT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

export const V2_0_32_ISOLATION_CONTRACT = {
  sourceCommit: "843a6c514e606b436a7fe713422ace0a93ad3d61",
  defaultServeReadsServiceConfig: false,
  defaultServeRegistersService: false,
  defaultServePrintsGeneratedPassword: true,
  systemAndManagedDiscoveryCanBeDisabledByCliFlag: false,
  projectDiscoveryFlag: "OPENCODE_CONFIG_PROJECT_DISABLE",
  projectDiscoveryAlias: "OPENCODE_DISABLE_PROJECT_CONFIG",
  modelsFetchDisableFlag: "OPENCODE_DISABLE_MODELS_FETCH",
  claudeDiscoveryDisableFlag: "OPENCODE_DISABLE_CLAUDE_CODE",
} as const;

export const V2_1_0_ISOLATION_CONTRACT = {
  sourceCommit: "60c68d145a14127ce633e26aa5fdfb882a7baa6d",
  sourceCommitMeaning: "inspected-release-tag",
  defaultServeReadsServiceConfig: false,
  defaultServeRegistersService: false,
  defaultServePrintsGeneratedPassword: true,
  systemAndManagedDiscoveryCanBeDisabledByCliFlag: false,
  projectDiscoveryFlag: "OPENCODE_CONFIG_PROJECT_DISABLE",
  projectDiscoveryAlias: "OPENCODE_DISABLE_PROJECT_CONFIG",
  modelsFetchDisableFlag: "OPENCODE_DISABLE_MODELS_FETCH",
  claudeDiscoveryDisableFlag: "OPENCODE_DISABLE_CLAUDE_CODE",
} as const;

export interface V2TestIsolation {
  readonly root: string;
  readonly paths: {
    readonly home: string;
    readonly config: string;
    readonly data: string;
    readonly cache: string;
    readonly state: string;
    readonly database: string;
    readonly serviceState: string;
    readonly tmp: string;
    readonly cwd: string;
  };
  readonly environment: NodeJS.ProcessEnv;
  readonly ambientConfigGate: AmbientConfigGate;
  readonly staticGate: StaticPrelaunchGate;
  readonly runtimeEvidence: "NOT_RUN";
  dispose(): Promise<void>;
}

export interface AmbientConfigGate {
  readonly status: "CLEAR" | "BLOCKED";
  readonly presentSourceCount: number;
  readonly checkedSourceCount: number;
  readonly inspectionErrorCount: number;
}

export interface StaticPrelaunchGate {
  readonly status: "READY_FOR_DISPOSABLE_SPIKE" | "BLOCKED";
  readonly blockers: readonly string[];
}

export function ambientConfigSourcePaths(
  platform: NodeJS.Platform,
  programData = "C:\\ProgramData",
  username = "user",
): readonly string[] {
  if (platform === "darwin") {
    return [
      "/Library/Application Support/opencode",
      join("/Library/Managed Preferences", username, "ai.opencode.managed.plist"),
      "/Library/Managed Preferences/ai.opencode.managed.plist",
    ];
  }
  if (platform === "win32") return [win32.join(programData, "opencode")];
  return ["/etc/opencode"];
}

export async function inspectAmbientConfigSources(
  paths = ambientConfigSourcePaths(process.platform, process.env.ProgramData, userInfo().username),
  pathExists: (path: string) => Promise<boolean> = async (path) => {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  },
): Promise<AmbientConfigGate> {
  let presentSourceCount = 0;
  let inspectionErrorCount = 0;
  for (const path of paths) {
    try {
      if (await pathExists(path)) presentSourceCount += 1;
    } catch {
      inspectionErrorCount += 1;
    }
  }
  return {
    status: presentSourceCount === 0 && inspectionErrorCount === 0 ? "CLEAR" : "BLOCKED",
    presentSourceCount,
    checkedSourceCount: paths.length,
    inspectionErrorCount,
  };
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
  );
}

async function rejectSymlinkComponents(root: string, candidate: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (!isWithin(resolvedRoot, resolvedCandidate)) throw new Error("Isolation path escapes its owned root");

  let current = resolvedRoot;
  const parts = relative(resolvedRoot, resolvedCandidate).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Isolation path contains a symlink");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function assertOwnedPath(root: string, candidate: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const rootStat = await lstat(resolvedRoot);
  if (rootStat.isSymbolicLink() || (await realpath(resolvedRoot)) !== resolvedRoot) {
    throw new Error("Isolation root is not canonical");
  }
  await rejectSymlinkComponents(resolvedRoot, candidate);
}

export function assertIsolatedEnvironment(environment: NodeJS.ProcessEnv, paths: V2TestIsolation["paths"]): void {
  const expected: Record<string, string> = {
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    OPENCODE_DB: paths.database,
    TMPDIR: paths.tmp,
    OPENCODE_TEST_HOME: paths.home,
    OPENCODE_CONFIG_DIR: join(paths.config, "opencode"),
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  };
  if (
    Object.keys(environment).some((key) => !(key in expected)) ||
    Object.keys(expected).some((key) => environment[key] !== expected[key])
  ) {
    throw new Error("Fixture environment is not the exact isolation allowlist");
  }
  if (Object.keys(environment).some((key) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|AUTH)/i.test(key))) {
    throw new Error("Credential-bearing environment is forbidden");
  }
}

export function evaluateStaticPrelaunchGate(
  environment: NodeJS.ProcessEnv,
  paths: V2TestIsolation["paths"],
  ambientConfigGate: AmbientConfigGate,
): StaticPrelaunchGate {
  const blockers: string[] = [];
  try {
    assertIsolatedEnvironment(environment, paths);
  } catch {
    blockers.push("Fixture environment does not match the exact credential-free isolation allowlist");
  }
  if (ambientConfigGate.status !== "CLEAR") {
    blockers.push("System/managed config path inspection is blocked or unreadable");
  }
  if (ambientConfigGate.checkedSourceCount === 0) {
    blockers.push("No system/managed config paths were checked");
  }
  if (ambientConfigGate.presentSourceCount > 0) {
    blockers.push("A system/managed config path is present");
  }
  if (ambientConfigGate.inspectionErrorCount > 0) {
    blockers.push("A system/managed config path could not be inspected");
  }
  return {
    status: blockers.length === 0 ? "READY_FOR_DISPOSABLE_SPIKE" : "BLOCKED",
    blockers: [...new Set(blockers)],
  };
}

export async function createV2TestIsolation(projectRoot = DEFAULT_PROJECT_ROOT): Promise<V2TestIsolation> {
  const project = await realpath(projectRoot);
  const base = resolve(project, "tmp/scribe-v2-isolation");
  const tmp = resolve(project, "tmp");
  await mkdir(tmp, { recursive: true });
  await rejectSymlinkComponents(project, base);
  await mkdir(base, { recursive: true });
  if ((await lstat(base)).isSymbolicLink() || (await realpath(base)) !== base) {
    throw new Error("Isolation base is not a canonical project-local directory");
  }

  const root = await mkdtemp(join(base, "run-"));
  const owner = randomUUID();
  await writeFile(join(root, OWNER_FILE), owner, { flag: "wx", mode: 0o600 });
  const paths = {
    home: join(root, "home"),
    config: join(root, "xdg-config"),
    data: join(root, "xdg-data"),
    cache: join(root, "xdg-cache"),
    state: join(root, "xdg-state"),
    database: join(root, "database.sqlite"),
    serviceState: join(root, "xdg-state", "opencode"),
    tmp: join(root, "tmp"),
    cwd: join(root, "cwd"),
  };
  for (const directory of [paths.home, paths.config, paths.data, paths.cache, paths.state, paths.tmp, paths.cwd]) {
    await mkdir(directory, { recursive: true });
  }
  await mkdir(join(paths.config, "opencode"), { recursive: true });
  const ambientConfigGate = await inspectAmbientConfigSources();
  const environment: NodeJS.ProcessEnv = {
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    OPENCODE_DB: paths.database,
    TMPDIR: paths.tmp,
    OPENCODE_TEST_HOME: paths.home,
    OPENCODE_CONFIG_DIR: join(paths.config, "opencode"),
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  };
  assertIsolatedEnvironment(environment, paths);
  for (const candidate of [paths.home, paths.config, paths.data, paths.cache, paths.state, paths.tmp, paths.cwd]) {
    await assertOwnedPath(root, candidate);
  }
  await assertOwnedPath(root, paths.database);
  await assertOwnedPath(root, paths.serviceState);
  const staticGate = evaluateStaticPrelaunchGate(environment, paths, ambientConfigGate);

  let disposed = false;
  return {
    root,
    paths,
    environment,
    ambientConfigGate,
    staticGate,
    runtimeEvidence: "NOT_RUN",
    async dispose() {
      if (disposed) return;
      const canonicalRoot = resolve(root);
      if (!isWithin(base, canonicalRoot) || dirname(canonicalRoot) !== base) {
        throw new Error("Refusing to dispose a root not owned by this isolation instance");
      }
      await assertOwnedPath(base, canonicalRoot);
      if ((await readFile(join(canonicalRoot, OWNER_FILE), "utf8")) !== owner) {
        throw new Error("Refusing to dispose an isolation root with a different owner marker");
      }
      await rm(canonicalRoot, { recursive: true, force: false, maxRetries: 0 });
      disposed = true;
    },
  };
}

export async function runNodeFixture(
  isolation: V2TestIsolation,
  source: string,
  timeoutMs = CHILD_TIMEOUT_MS,
): Promise<string> {
  assertIsolatedEnvironment(isolation.environment, isolation.paths);
  await assertOwnedPath(isolation.root, isolation.paths.cwd);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["-e", source], {
      cwd: isolation.paths.cwd,
      env: isolation.environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let overflowed = false;
    let timeout: NodeJS.Timeout | undefined;
    let termination: Promise<void> | undefined;
    let cleanupError: unknown;

    const signalTree = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      } else {
        child.kill(signal);
      }
    };
    const groupExists = () => {
      if (process.platform === "win32" || child.pid === undefined) return child.exitCode === null;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
        throw error;
      }
    };
    const waitForGroupExit = async (durationMs: number) => {
      const deadline = Date.now() + durationMs;
      while (groupExists() && Date.now() < deadline) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      return !groupExists();
    };
    const reapGroup = async () => {
      if (!groupExists()) return;
      signalTree("SIGTERM");
      if (await waitForGroupExit(CHILD_KILL_GRACE_MS)) return;
      signalTree("SIGKILL");
      if (!(await waitForGroupExit(CHILD_REAP_TIMEOUT_MS))) {
        throw new Error("Fixture process group could not be reaped within its bound");
      }
    };
    const terminate = () => {
      if (!termination) {
        termination = reapGroup().catch((error: unknown) => {
          cleanupError = error;
        });
      }
      return termination;
    };
    const append = (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > OUTPUT_LIMIT) {
        overflowed = true;
        void terminate();
        return;
      }
      output.push(Buffer.from(chunk));
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    timeout = setTimeout(() => {
      timedOut = true;
      void terminate();
    }, timeoutMs);
    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      void terminate().then(() => {
        if (cleanupError) reject(cleanupError);
        else if (overflowed) reject(new Error("Fixture child exceeded the output limit"));
        else if (timedOut) reject(new Error("Fixture child exceeded its bounded runtime"));
        else if (code !== 0) reject(new Error(`Fixture child failed (${code ?? signal ?? "unknown"})`));
        else resolvePromise(Buffer.concat(output).toString("utf8"));
      });
    });
  });
}
