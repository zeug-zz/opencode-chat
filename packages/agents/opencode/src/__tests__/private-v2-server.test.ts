import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { PrivateV2ServerError, type PrivateV2ServerOptions, startPrivateV2Server } from "../private-v2-server";

const CWD = "/workspace/project";
const SERVER_URL = "http://127.0.0.1:43123";
const PASSWORD = "unit-test-password_123";
const PID = 7319;

class FakeChild extends EventEmitter {
  pid = PID;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn();
  emitOutput(...chunks: string[]) {
    for (const chunk of chunks) this.stdout.emit("data", Buffer.from(chunk));
  }
}

function output(password = PASSWORD, url = SERVER_URL) {
  return `server listening on ${url}\nserver password ${password}\n`;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function createHarness(
  options: {
    info?: Record<string, unknown>;
    location?: Record<string, unknown>;
    infoStatus?: number;
    locationStatus?: number;
    infoEnvelope?: boolean;
    locationEnvelope?: boolean;
    timeoutMs?: number;
    noOutput?: boolean;
    password?: string;
    expectedVersion?: string;
    versionPolicy?: PrivateV2ServerOptions["versionPolicy"];
    terminateProcessGroup?: NonNullable<PrivateV2ServerOptions["terminateProcessGroup"]>;
    fetcherOverride?: typeof fetch;
    onChildLifecycle?: (event: {
      kind: "exit" | "error";
      code?: number | null;
      signal?: NodeJS.Signals | null;
    }) => void;
  } = {},
) {
  const child = new FakeChild();
  const terminateProcessGroup = vi.fn(options.terminateProcessGroup ?? (async () => undefined));
  const fetcher = vi.fn(
    options.fetcherOverride ??
      (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new globalThis.URL(String(input));
        if (url.pathname === "/api/info") {
          if (
            init?.headers &&
            (init.headers as Record<string, string>).authorization !==
              `Basic ${Buffer.from(`opencode:${options.password ?? PASSWORD}`).toString("base64")}`
          )
            return response({}, 401);
          const info = options.info ?? {
            version: options.expectedVersion ?? "2.0.32",
            pid: PID,
            urls: [SERVER_URL],
          };
          return response(options.infoEnvelope ? { data: info } : info, options.infoStatus);
        }
        if (url.pathname === "/api/location") {
          const location = options.location ?? { directory: CWD };
          return response(options.locationEnvelope ? { data: location } : location, options.locationStatus);
        }
        return response({}, 404);
      }),
  );
  const spawnProcess = vi.fn(() => {
    if (!options.noOutput) queueMicrotask(() => child.emitOutput(output(options.password ?? PASSWORD)));
    return child as never;
  });
  const start = () =>
    startPrivateV2Server({
      command: "/selected/wrapper",
      args: ["wrap", "serve", "--hostname", "127.0.0.1", "--port", "0"],
      shell: false,
      cwd: CWD,
      environment: { PATH: "/usr/bin" },
      expectedVersion: options.expectedVersion ?? "2.0.32",
      ...(options.versionPolicy ? { versionPolicy: options.versionPolicy } : {}),
      spawnProcess,
      fetcher,
      terminateProcessGroup,
      timeoutMs: options.timeoutMs ?? 100,
      onChildLifecycle: options.onChildLifecycle,
    });
  return { child, fetcher, spawnProcess, terminateProcessGroup, start };
}

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateV2ServerError);
    return (error as PrivateV2ServerError).code;
  }
  throw new Error("Expected private V2 startup to reject");
}

describe("startPrivateV2Server", () => {
  it("spawns the supplied wrapped serve command and verifies authenticated child and workspace identity", async () => {
    const harness = createHarness();
    const server = await harness.start();

    expect(harness.spawnProcess).toHaveBeenCalledWith(
      "/selected/wrapper",
      ["wrap", "serve", "--hostname", "127.0.0.1", "--port", "0"],
      expect.objectContaining({
        cwd: CWD,
        shell: false,
        detached: true,
        env: { PATH: "/usr/bin" },
      }),
    );
    expect(harness.fetcher).toHaveBeenCalledTimes(2);
    expect(harness.fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}` },
      redirect: "manual",
    });
    expect(server.url).toBe(SERVER_URL);
    expect(server.headers.authorization).toContain("Basic ");
    harness.child.exitCode = 0;
    await server.close();
    expect(harness.terminateProcessGroup).toHaveBeenCalledWith(PID, harness.child);
  });

  it("handles split password and endpoint output without exposing fragments", async () => {
    const splitPassword = "abc";
    const password = `${splitPassword}def`;
    const harness = createHarness({ noOutput: true, password });
    const starting = harness.start();
    harness.child.emitOutput("server listening on http://127.0.0.1:431");
    expect(harness.fetcher).not.toHaveBeenCalled();
    harness.child.emitOutput("23\nserver password ", splitPassword);
    expect(harness.fetcher).not.toHaveBeenCalled();
    harness.child.emitOutput("def\n");
    await expect(starting).resolves.toMatchObject({ url: SERVER_URL });
  });

  it("parses credentials only from complete stdout lines and never starts on stderr text", async () => {
    const harness = createHarness({ noOutput: true });
    const starting = harness.start();
    harness.child.stderr.emit("data", Buffer.from(output()));
    expect(harness.fetcher).not.toHaveBeenCalled();
    harness.child.stdout.emit(
      "data",
      Buffer.from(`server listening on http://127.0.0.1:43123\nserver password ${PASSWORD}`),
    );
    expect(harness.fetcher).not.toHaveBeenCalled();
    harness.child.stdout.emit("data", Buffer.from("\n"));
    await expect(starting).resolves.toMatchObject({ url: SERVER_URL });
  });

  it.each([
    ["unauthenticated response", { infoStatus: 401 }, "authentication-failed", undefined],
    [
      "wrong server version",
      { info: { version: "2.0.31", pid: PID, urls: [SERVER_URL] } },
      "version-mismatch",
      undefined,
    ],
    [
      "wrong child pid",
      { info: { version: "2.0.32", pid: PID + 1, urls: [SERVER_URL] } },
      "identity-mismatch",
      undefined,
    ],
    [
      "wrong endpoint",
      { info: { version: "2.0.32", pid: PID, urls: ["http://127.0.0.1:2"] } },
      "identity-mismatch",
      undefined,
    ],
    ["wrong workspace", { location: { directory: "/workspace/other" } }, "location-mismatch", undefined],
    ["wrapped info envelope", { infoEnvelope: true }, "readiness-failed", undefined],
    ["wrapped location envelope", { locationEnvelope: true }, "location-mismatch", undefined],
    ["redirect", { infoStatus: 302 }, "redirect-rejected", undefined],
    ["non-loopback URL", {}, "non-loopback-endpoint", "http://192.0.2.1:43123"],
    ["localhost alias", {}, "non-loopback-endpoint", "http://localhost:43123"],
    ["port zero", {}, "malformed-output", "http://127.0.0.1:0"],
    ["path suffix", {}, "malformed-output", "http://127.0.0.1:43123/path"],
  ] as const)("fails closed for %s", async (_label, config, expected, endpoint) => {
    const harness = createHarness(config);
    if (endpoint) {
      harness.spawnProcess.mockImplementationOnce(() => {
        queueMicrotask(() => harness.child.emitOutput(output(PASSWORD, endpoint)));
        return harness.child as never;
      });
    }
    const code = await codeOf(harness.start());
    expect(code).toBe(expected);
    expect(harness.terminateProcessGroup).toHaveBeenCalled();
  });

  it("names the required OpenCode version on mismatch without echoing the observed version", async () => {
    const harness = createHarness({ info: { version: "2.0.31", pid: PID, urls: [SERVER_URL] } });
    const error = await harness.start().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrivateV2ServerError);
    const { message } = error as PrivateV2ServerError;
    expect(message).toContain("Scribe requires OpenCode 2.0.32");
    expect(message).not.toContain("2.0.31");
    expect(harness.terminateProcessGroup).toHaveBeenCalled();
  });

  it.each(["2.1.3", "2.1.4", "2.2.0", "2.99.0"])(
    "accepts canonical stable OpenCode V2 %s under the forward policy",
    async (version) => {
      const harness = createHarness({
        expectedVersion: "2.1.3",
        versionPolicy: "stable-v2-forward",
        info: { version, pid: PID, urls: [SERVER_URL] },
      });
      const server = await harness.start();
      expect(server.url).toBe(SERVER_URL);
      expect(harness.fetcher).toHaveBeenCalledTimes(2);
      await server.close();
    },
  );

  it.each([
    "2.1.2",
    "1.0.0",
    "3.0.0",
    "2.01.3",
    "v2.2.0",
    "2.1.3-beta.1",
    "2.1.3+build.1",
    "2.999999999999999999999999.0",
    "2.1.9007199254740992",
    "2.2",
    " 2.2.0",
    "2.2.0; secret=do-not-echo",
  ])("rejects unsupported or ambiguous forward-policy version %s", async (version) => {
    const harness = createHarness({
      expectedVersion: "2.1.3",
      versionPolicy: "stable-v2-forward",
      info: { version, pid: PID, urls: [SERVER_URL] },
    });
    const error = await harness.start().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrivateV2ServerError);
    expect((error as PrivateV2ServerError).code).toBe("version-mismatch");
    expect((error as Error).message).toContain("Scribe requires stable OpenCode V2 >=2.1.3 and <3.0.0");
    if (version !== "3.0.0") expect((error as Error).message).not.toContain(version);
    expect(harness.terminateProcessGroup).toHaveBeenCalled();
  });

  it.each(["2.1.2", "2.01.3", "3.0.0", "2.1.3; secret=do-not-echo"])(
    "rejects an invalid forward-policy baseline %s before spawning",
    async (expectedVersion) => {
      const harness = createHarness({
        expectedVersion,
        versionPolicy: "stable-v2-forward",
      });
      const error = await harness.start().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PrivateV2ServerError);
      expect((error as PrivateV2ServerError).code).toBe("version-mismatch");
      expect((error as Error).message).toContain("Scribe requires stable OpenCode V2 >=2.1.3 and <3.0.0");
      if (expectedVersion !== "3.0.0") expect((error as Error).message).not.toContain(expectedVersion);
      expect(harness.spawnProcess).not.toHaveBeenCalled();
      expect(harness.terminateProcessGroup).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ infoStatus: 401, info: { version: "2.2.0", pid: PID, urls: [SERVER_URL] } }, "authentication-failed"],
    [{ info: { version: "2.2.0", pid: PID + 1, urls: [SERVER_URL] } }, "identity-mismatch"],
    [
      {
        info: { version: "2.2.0", pid: PID, urls: [SERVER_URL] },
        location: { directory: "/workspace/other" },
      },
      "location-mismatch",
    ],
  ] as const)("keeps private auth and identity checks for eligible newer versions (%s)", async (config, expected) => {
    const harness = createHarness({
      ...config,
      expectedVersion: "2.1.3",
      versionPolicy: "stable-v2-forward",
    });
    expect(await codeOf(harness.start())).toBe(expected);
  });

  it("keeps helper fixtures in exact-version mode unless forward policy is opted into", async () => {
    const harness = createHarness({
      info: { version: "2.0.33", pid: PID, urls: [SERVER_URL] },
    });
    expect(await codeOf(harness.start())).toBe("version-mismatch");
  });

  it("cleans up after early exit and bounds startup waiting", async () => {
    const early = createHarness({ noOutput: true });
    const pending = early.start();
    early.child.emit("exit", 9, null);
    expect(await codeOf(pending)).toBe("early-exit");
    expect(early.terminateProcessGroup).toHaveBeenCalled();

    const timeout = createHarness({ noOutput: true, timeoutMs: 5 });
    expect(await codeOf(timeout.start())).toBe("readiness-timeout");
    expect(timeout.terminateProcessGroup).toHaveBeenCalled();
  });

  it("aborts an in-flight readiness request when the overall startup deadline expires", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new Error("opaque fetch detail")), { once: true });
      });
    });
    const harness = createHarness({ noOutput: true, timeoutMs: 10, fetcherOverride: fetcher });
    const pending = harness.start();
    harness.child.emitOutput(output());
    expect(await codeOf(pending)).toBe("readiness-timeout");
    expect(observedSignal?.aborted).toBe(true);
    expect(harness.terminateProcessGroup).toHaveBeenCalled();
  });

  it.each([
    "null",
    "[]",
    '{"data":null}',
    '{"data":[]}',
    '{"data":{"version":"2.0.32","pid":7319,"urls":["http://127.0.0.1:43123"]}}',
  ])("rejects non-record or wrapped API responses (%s)", async (body) => {
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }));
    const harness = createHarness({ noOutput: true, fetcherOverride: fetcher });
    const pending = harness.start();
    harness.child.emitOutput(output());
    expect(await codeOf(pending)).toBe("readiness-failed");
    expect(harness.terminateProcessGroup).toHaveBeenCalled();
  });

  it("bounds readiness bodies before JSON parsing", async () => {
    const fetcher = vi.fn(
      async () => new Response(`{"data":{"version":"2.0.32","padding":"${"x".repeat(33 * 1024)}"}}`),
    );
    const harness = createHarness({ noOutput: true, fetcherOverride: fetcher });
    const pending = harness.start();
    harness.child.emitOutput(output());
    expect(await codeOf(pending)).toBe("readiness-failed");
    expect(harness.terminateProcessGroup).toHaveBeenCalled();
  });

  it("shares close cleanup, clears public credentials, and preserves cleanup failure", async () => {
    let releaseCleanup: (() => void) | undefined;
    const delayed = createHarness({
      terminateProcessGroup: () =>
        new Promise<void>((resolve) => {
          releaseCleanup = resolve;
        }),
    });
    const server = await delayed.start();
    const headers = server.headers;
    expect(JSON.stringify(server)).not.toContain(headers.authorization);
    const firstClose = server.close();
    const secondClose = server.close();
    expect(firstClose).toBe(secondClose);
    expect(headers.authorization).toBe("");
    releaseCleanup?.();
    await expect(firstClose).resolves.toBeUndefined();

    const failing = createHarness({
      terminateProcessGroup: async () => {
        throw new Error("raw child failure");
      },
    });
    const failingServer = await failing.start();
    const firstFailure = failingServer.close();
    const secondFailure = failingServer.close();
    expect(firstFailure).toBe(secondFailure);
    await expect(firstFailure).rejects.toMatchObject({ code: "cleanup-failed" });
    await expect(secondFailure).rejects.toMatchObject({ code: "cleanup-failed" });
  });

  it("reports only opaque post-ready child lifecycle state and drains later output", async () => {
    const onChildLifecycle = vi.fn();
    const harness = createHarness({ onChildLifecycle });
    const server = await harness.start();
    harness.child.stdout.emit("data", Buffer.from(`server password ${PASSWORD}\npost-ready-secret`));
    harness.child.stderr.emit("data", Buffer.from("later diagnostic secret"));
    harness.child.emit("exit", 17, "SIGTERM");
    harness.child.emit("error", new Error(`later-secret ${PASSWORD}`));
    expect(onChildLifecycle).toHaveBeenCalledWith({ kind: "exit", code: 17, signal: "SIGTERM" });
    expect(onChildLifecycle).toHaveBeenCalledWith({ kind: "error" });
    await server.close();
  });

  it("sanitizes synchronous spawn exceptions", async () => {
    const spawnError = new Error(`secret-path ${PASSWORD}`);
    const start = startPrivateV2Server({
      command: "selected",
      args: [],
      shell: false,
      cwd: CWD,
      environment: {},
      expectedVersion: "2.0.32",
      spawnProcess: () => {
        throw spawnError;
      },
    });
    const error = await codeOf(start);
    expect(error).toBe("spawn-error");
  });

  it("sanitizes a spawn error and rejects malformed startup output without exposing it", async () => {
    const spawnFailure = createHarness({ noOutput: true });
    const failed = spawnFailure.start();
    spawnFailure.child.emit("error", new Error(`opaque-secret: ${PASSWORD}`));
    expect(await codeOf(failed)).toBe("spawn-error");
    expect(spawnFailure.terminateProcessGroup).toHaveBeenCalled();

    const malformed = createHarness({ noOutput: true });
    const pending = malformed.start();
    malformed.child.emitOutput(`server listening at ${SERVER_URL}\nserver password ${PASSWORD}\n`);
    expect(await codeOf(pending)).toBe("readiness-timeout");
    expect(malformed.terminateProcessGroup).toHaveBeenCalled();
  });

  it("rejects oversized output without returning secret chunks", async () => {
    const harness = createHarness({ noOutput: true });
    const pending = harness.start();
    harness.child.emitOutput("server password ", PASSWORD, "\n", "x".repeat(17 * 1024));
    expect(await codeOf(pending)).toBe("output-limit");
    expect(harness.terminateProcessGroup).toHaveBeenCalled();
  });
});

describe("PrivateV2ServerError", () => {
  it("does not append a required version that fails exact-version validation", () => {
    const error = new PrivateV2ServerError("version-mismatch", "2.1.2; rm");
    expect(error.code).toBe("version-mismatch");
    expect(error.message).toBe(
      "Private OpenCode V2 startup failed (version-mismatch); child output and credentials were discarded.",
    );
  });
});
