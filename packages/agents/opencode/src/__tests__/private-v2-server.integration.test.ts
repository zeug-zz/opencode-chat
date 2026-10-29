import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { type PrivateV2Server, PrivateV2ServerError, startPrivateV2Server } from "../private-v2-server.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const RUN_ENABLED = process.env.OPENCODE_CHAT_RUN_V2_LIFECYCLE === "1";
const EXECUTABLE_INPUT = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const EXPECTED_VERSION = "2.2.0";
const OVERALL_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_API_REQUESTS = 6;

type QualificationStatus = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
type Check = { name: string; passed: boolean };
type Manifest = {
  schemaVersion: 1;
  runId: string;
  status: QualificationStatus;
  checks: Check[];
  fixturePath: string | null;
  stateRoot: string | null;
  fixtureRootAbsent: boolean | null;
  stateRootAbsent: boolean | null;
  apiRequestCount: number;
  maxApiRequests: number;
  source: "OPENCODE_CHAT_V2_SPIKE_EXECUTABLE";
  executablePath: string | null;
  sourceCommit: "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
  sourceCommitMeaning: "inspected-release-tag";
  executableSha256: string | null;
  version: string;
  qualification: "PRODUCTION_LIFECYCLE_HELPER_ONLY";
  preflight: "READY_FOR_DISPOSABLE_SPIKE" | "BLOCKED" | "NOT_RUN";
  failureCode?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function readJsonBounded(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("response-limit");
  }
  if (!response.body) throw new Error("response-empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("response-limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("response-json");
  }
}

async function pathIsAbsent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function opaqueFailureCode(error: unknown): string {
  return error instanceof PrivateV2ServerError ? error.code : "unexpected";
}

function sameEnvironment(snapshot: NodeJS.ProcessEnv): boolean {
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(process.env)]);
  for (const key of keys) if (snapshot[key] !== process.env[key]) return false;
  return true;
}

const activeRoots = new Set<V2TestIsolation>();
afterEach(async () => {
  for (const isolation of activeRoots) {
    await isolation.dispose();
  }
  activeRoots.clear();
});

it.skipIf(!RUN_ENABLED)(
  "qualifies the production private V2 lifecycle helper against disposable OpenCode 2.2.0",
  async () => {
    const projectRoot = await realpath(PROJECT_ROOT);
    const lifecycleBase = resolve(projectRoot, "tmp/scribe-v2-migration/lifecycle");
    await mkdir(lifecycleBase, { recursive: true });
    await assertOwnedPath(projectRoot, lifecycleBase);
    const runId = randomUUID();
    const runDirectory = join(lifecycleBase, runId);
    await mkdir(runDirectory, { recursive: false });
    await assertOwnedPath(lifecycleBase, runDirectory);
    const manifestPath = join(runDirectory, "result.json");
    let manifestCreated = false;
    let isolation: V2TestIsolation | undefined;
    let server: PrivateV2Server | undefined;
    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    const overallAbort = new AbortController();
    const parentEnvironment = { ...process.env };
    const checks: Check[] = [];
    let status: QualificationStatus = "RUNNING";
    let preflight: Manifest["preflight"] = "NOT_RUN";
    let failureCode: string | undefined;
    let fixturePath: string | null = null;
    let stateRoot: string | null = null;
    let fixtureRootAbsent: boolean | null = null;
    let stateRootAbsent: boolean | null = null;
    let apiRequestCount = 0;
    let closeCompleted = false;
    let disposeCompleted = false;
    const manifest: Manifest = {
      schemaVersion: 1,
      runId,
      status,
      checks,
      fixturePath,
      stateRoot,
      fixtureRootAbsent,
      stateRootAbsent,
      apiRequestCount,
      maxApiRequests: MAX_API_REQUESTS,
      source: "OPENCODE_CHAT_V2_SPIKE_EXECUTABLE",
      executablePath: EXECUTABLE_INPUT && isAbsolute(EXECUTABLE_INPUT) ? EXECUTABLE_INPUT : null,
      sourceCommit: "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c",
      sourceCommitMeaning: "inspected-release-tag",
      executableSha256: null,
      version: EXPECTED_VERSION,
      qualification: "PRODUCTION_LIFECYCLE_HELPER_ONLY",
      preflight,
    };
    const addCheck = (name: string, passed: boolean) => checks.push({ name, passed });
    const persist = async () => {
      Object.assign(manifest, {
        status,
        checks: [...checks],
        fixturePath,
        stateRoot,
        executablePath: EXECUTABLE_INPUT && isAbsolute(EXECUTABLE_INPUT) ? EXECUTABLE_INPUT : null,
        fixtureRootAbsent,
        stateRootAbsent,
        apiRequestCount,
        preflight,
        ...(failureCode ? { failureCode } : {}),
      });
      const content = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(manifestPath, content, manifestCreated ? { mode: 0o600 } : { flag: "wx", mode: 0o600 });
      manifestCreated = true;
    };

    try {
      addCheck("executable_input_is_absolute", typeof EXECUTABLE_INPUT === "string" && isAbsolute(EXECUTABLE_INPUT));
      if (!EXECUTABLE_INPUT || !isAbsolute(EXECUTABLE_INPUT)) {
        status = "BLOCKED";
        failureCode = "explicit_executable_missing_or_relative";
        throw new Error("blocked-input");
      }
      try {
        await access(EXECUTABLE_INPUT);
        manifest.executableSha256 = createHash("sha256")
          .update(await readFile(EXECUTABLE_INPUT))
          .digest("hex");
        addCheck("selected_executable_exists", true);
      } catch {
        addCheck("selected_executable_exists", false);
        status = "BLOCKED";
        failureCode = "explicit_executable_unavailable";
        throw new Error("blocked-input");
      }

      isolation = await createV2TestIsolation(projectRoot);
      activeRoots.add(isolation);
      fixturePath = relative(projectRoot, isolation.paths.cwd);
      stateRoot = relative(projectRoot, isolation.paths.state);
      addCheck("fixture_paths_are_project_local", fixturePath.startsWith("tmp/") && stateRoot.startsWith("tmp/"));
      addCheck("fixture_cwd_starts_empty", (await readdir(isolation.paths.cwd)).length === 0);
      assertIsolatedEnvironment(isolation.environment, isolation.paths);
      addCheck("fixture_environment_is_exact_allowlist", true);
      addCheck("fixture_has_no_config_overlay", isolation.environment.OPENCODE_CONFIG_CONTENT === undefined);

      // Reinspect system/managed config immediately before starting the real child.
      const ambient = await inspectAmbientConfigSources();
      const freshGate = evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, ambient);
      preflight = freshGate.status;
      addCheck("fresh_ambient_config_gate_clear", freshGate.status === "READY_FOR_DISPOSABLE_SPIKE");
      if (freshGate.status !== "READY_FOR_DISPOSABLE_SPIKE") {
        status = "BLOCKED";
        failureCode = "ambient_preflight_blocked";
        throw new Error("blocked-preflight");
      }
      await assertOwnedPath(isolation.root, isolation.paths.cwd);

      const deadline = Date.now() + OVERALL_TIMEOUT_MS;
      overallTimer = setTimeout(() => overallAbort.abort(), OVERALL_TIMEOUT_MS);
      const environment = { ...isolation.environment };
      const fetcher: typeof fetch = async (input, init) => {
        apiRequestCount += 1;
        if (apiRequestCount > MAX_API_REQUESTS) throw new Error("request-limit");
        if (overallAbort.signal.aborted) throw new Error("overall-timeout");
        const signals = [overallAbort.signal, ...(init?.signal ? [init.signal] : [])];
        return fetch(input, { ...init, signal: AbortSignal.any(signals) });
      };
      const remainingMs = () => Math.max(1, Math.min(OVERALL_TIMEOUT_MS, deadline - Date.now()));
      server = await startPrivateV2Server({
        command: EXECUTABLE_INPUT,
        args: ["serve", "--hostname", "127.0.0.1", "--port", "0"],
        shell: false,
        cwd: isolation.paths.cwd,
        environment,
        expectedVersion: EXPECTED_VERSION,
        timeoutMs: remainingMs(),
        fetcher,
      });
      addCheck("private_helper_ready", true);
      addCheck("helper_launch_is_selected_foreground_serve", true);
      addCheck("process_environment_unchanged_after_launch", sameEnvironment(parentEnvironment));
      addCheck("server_auth_header_is_private_and_nonempty", server.headers.authorization.length > 0);

      const unauthenticated = await fetcher(new URL("/api/info", server.url), {
        method: "GET",
        redirect: "manual",
      });
      const unauthenticatedRejected = unauthenticated.status === 401;
      await unauthenticated.body?.cancel();
      addCheck("unauthenticated_info_is_rejected", unauthenticatedRejected);

      const authenticated = await fetcher(new URL("/api/info", server.url), {
        method: "GET",
        headers: server.headers,
        redirect: "manual",
      });
      let infoValid = false;
      if (authenticated.status === 200 && authenticated.redirected === false) {
        const envelope = await readJsonBounded(authenticated);
        const info = isPlainRecord(envelope) ? envelope : undefined;
        infoValid =
          !!info &&
          info.version === EXPECTED_VERSION &&
          typeof info.pid === "number" &&
          Array.isArray(info.urls) &&
          info.urls.includes(server.url);
      } else {
        await authenticated.body?.cancel();
      }
      addCheck("authenticated_info_binds_version_identity_endpoint", infoValid);
      addCheck("all_api_requests_within_bound", apiRequestCount <= MAX_API_REQUESTS);
      addCheck("process_environment_unchanged_after_probes", sameEnvironment(parentEnvironment));

      status = checks.every((check) => check.passed) ? "PASS" : "FAIL";
      if (status === "FAIL") failureCode = "qualification_check_failed";
      await persist(); // Persist failures before cleanup so cleanup cannot erase the failing evidence.
    } catch (error) {
      const wasBlocked = status === "BLOCKED" || preflight === "BLOCKED";
      status = wasBlocked ? "BLOCKED" : "FAIL";
      failureCode = wasBlocked ? (failureCode ?? "preflight_blocked") : opaqueFailureCode(error);
      addCheck("opted_in_helper_run_completed", false);
      await persist();
    } finally {
      if (server) {
        try {
          await server.close();
          closeCompleted = true;
        } catch {
          status = "FAIL";
          failureCode = "helper_cleanup_failed";
          closeCompleted = false;
        }
        addCheck("helper_close_completed", closeCompleted);
        addCheck("private_authorization_cleared_after_close", server.headers.authorization.length === 0);
      } else {
        addCheck("helper_close_completed", status === "BLOCKED");
      }
      overallAbort.abort();
      if (overallTimer) clearTimeout(overallTimer);
      addCheck("process_environment_unchanged_after_close", sameEnvironment(parentEnvironment));

      if (isolation) {
        try {
          await isolation.dispose();
          disposeCompleted = true;
        } catch {
          status = "FAIL";
          failureCode = "fixture_disposal_failed";
        }
        activeRoots.delete(isolation);
        fixtureRootAbsent = await pathIsAbsent(isolation.root);
        stateRootAbsent = await pathIsAbsent(isolation.paths.state);
        addCheck("isolation_root_removed", fixtureRootAbsent);
        addCheck("mutable_state_root_removed", stateRootAbsent);
        addCheck("isolation_disposal_completed", disposeCompleted);
      } else {
        addCheck("isolation_disposal_completed", true);
      }

      if (status === "PASS" && checks.some((check) => !check.passed)) {
        status = "FAIL";
        failureCode = "teardown_check_failed";
      }
      if (status !== "BLOCKED" && checks.some((check) => !check.passed)) status = "FAIL";
      addCheck(
        "final_status_is_not_inferred_from_preflight",
        status === "PASS" || status === "FAIL" || status === "BLOCKED",
      );
      await persist();
    }

    const persisted = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    expect(persisted.qualification).toBe("PRODUCTION_LIFECYCLE_HELPER_ONLY");
    expect(persisted.status).toBe("PASS");
    expect(persisted.source).toBe("OPENCODE_CHAT_V2_SPIKE_EXECUTABLE");
    expect(persisted.executablePath).toBe(EXECUTABLE_INPUT);
    expect(persisted.sourceCommit).toBe("1097e2668b1e08ad63bdf0b1c4860b9bc01e420c");
    expect(persisted.sourceCommitMeaning).toBe("inspected-release-tag");
    expect(persisted.sourceCommitMeaning).toBe("inspected-release-tag");
    expect(persisted.executableSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(persisted.version).toBe(EXPECTED_VERSION);
    expect(persisted.fixturePath).toMatch(/^tmp\//);
    expect(persisted.stateRoot).toMatch(/^tmp\//);
    expect(persisted.checks.every((check) => check.passed)).toBe(true);
    expect(persisted.apiRequestCount).toBeLessThanOrEqual(MAX_API_REQUESTS);
    expect(persisted.fixtureRootAbsent).toBe(true);
    expect(persisted.stateRootAbsent).toBe(true);
    expect(await pathIsAbsent(runDirectory)).toBe(false);
    expect(await stat(manifestPath)).toBeDefined();
  },
  35_000,
);
