import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AF_CAPTURE_AUTHOR,
  AF_CAPTURE_CLAIM_ROLE,
  AF_CAPTURE_MANIFEST_FILE,
  AF_CAPTURE_ROOT_NODE_ID,
  AF_CAPTURE_STATEMENT,
  type AfCaptureOperation,
  type AfCaptureSanitizeResult,
  buildCaptureArgv,
  buildCaptureSet,
  CAPTURE_OPERATIONS,
  sanitizeCaptureOutput,
} from "../vibefeld/af-capture-harness";

const WORKSPACE = "/Users/example/Projects/demo/packages/platforms/vscode/tmp/vibefeld-capture-4321/workspace";
const PLACEHOLDER = "<workspace>";
const TIMESTAMP = "2026-09-21T07:23:54Z";
const RUNTIME = Object.freeze({
  version: "0.1.11",
  commit: "611291b",
  build_date: "2026-09-21T00:24:48Z",
  go_version: "go1.27.1",
  format: "1.1",
  policy: "0.1.9",
});

const liveFixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");

const contentsOf = (result: AfCaptureSanitizeResult): string => {
  if (!result.ok) throw new Error(`expected a sanitized capture, received ${result.reason}`);
  return result.contents;
};

const versionJson = (): Record<string, unknown> => JSON.parse(liveFixture("version.json")) as Record<string, unknown>;

const statusJson = (): {
  nodes: Array<Record<string, unknown>>;
  challenges: Array<Record<string, unknown>>;
} =>
  JSON.parse(liveFixture("status.json")) as {
    nodes: Array<Record<string, unknown>>;
    challenges: Array<Record<string, unknown>>;
  };

const CLAIM_CONTEXT = "Node 1 recorded: All primes greater than 2 are odd\nDependencies: none";
const REFINE_STATEMENT = "Every prime greater than 2 is odd";

/** Synthetic claim shape; the stored claim fixture is produced by the gated capture run. */
const claimJson = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  context: CLAIM_CONTEXT,
  expires_at: "2026-09-21T11:23:54Z",
  node_id: AF_CAPTURE_ROOT_NODE_ID,
  owner: AF_CAPTURE_AUTHOR,
  role: AF_CAPTURE_CLAIM_ROLE,
  status: "claimed",
  timeout: 300,
  ...overrides,
});

/** Synthetic refine shape; the stored refine fixture is produced by the gated capture run. */
const refineJson = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  children: [{ id: "2", type: "claim", statement: REFINE_STATEMENT, inference: "assumption" }],
  parent_id: AF_CAPTURE_ROOT_NODE_ID,
  success: true,
  ...overrides,
});

/** Sanitizes the stored live fixtures plus the synthetic claim/refine shapes for set assembly. */
const sanitizedFixtures = (): Record<AfCaptureOperation, string> => {
  const fixtures: Record<AfCaptureOperation, string> = {
    version: liveFixture("version.json"),
    schema: liveFixture("schema.json"),
    init: liveFixture("init.txt"),
    claim: JSON.stringify(claimJson()),
    refine: JSON.stringify(refineJson()),
    status: liveFixture("status.json"),
  };
  const outputs: Record<AfCaptureOperation, string> = {
    version: "",
    schema: "",
    init: "",
    claim: "",
    refine: "",
    status: "",
  };
  for (const shape of CAPTURE_OPERATIONS) {
    outputs[shape.operation] = contentsOf(sanitizeCaptureOutput(shape.operation, fixtures[shape.operation], WORKSPACE));
  }
  return outputs;
};

describe("AF live-capture harness", () => {
  it("pins the six fixed capture command shapes", () => {
    expect(CAPTURE_OPERATIONS.map(({ operation, file }) => [operation, file])).toEqual([
      ["version", "version.json"],
      ["schema", "schema.json"],
      ["init", "init.txt"],
      ["claim", "claim.json"],
      ["refine", "refine.json"],
      ["status", "status.json"],
    ]);
    expect(CAPTURE_OPERATIONS.map(({ argv }) => argv)).toEqual([
      ["version", "--json"],
      ["schema", "--format", "json"],
      ["init", "-c", "<conjecture>", "-a", "<author>", "-d", "<workspace>"],
      ["claim", "<node-id>", "--owner", "<owner>", "--role", "<role>", "-d", "<workspace>", "--format", "json"],
      ["refine", "<parent-id>", "<statement>", "--owner", "<owner>", "-d", "<workspace>", "--format", "json"],
      ["status", "-d", "<workspace>", "--format", "json"],
    ]);
  });

  it("replaces the capture workspace path with a placeholder everywhere", () => {
    const versionResult = sanitizeCaptureOutput(
      "version",
      JSON.stringify({ ...versionJson(), workspace: WORKSPACE }),
      WORKSPACE,
    );
    const versionContents = contentsOf(versionResult);
    expect(versionContents).toContain(PLACEHOLDER);
    expect(versionContents).not.toContain(WORKSPACE);
    expect((JSON.parse(versionContents) as Record<string, unknown>).workspace).toBe(PLACEHOLDER);

    const init = `Proof initialized successfully in ${WORKSPACE}\nConjecture: All primes greater than 2 are odd\nAuthor: capture\n`;
    const initContents = contentsOf(sanitizeCaptureOutput("init", init, WORKSPACE));
    expect(initContents).toContain(`Proof initialized successfully in ${PLACEHOLDER}`);
    expect(initContents).not.toContain(WORKSPACE);
    expect(contentsOf(sanitizeCaptureOutput("init", init, `${WORKSPACE}/`))).not.toContain(WORKSPACE);

    const status = statusJson();
    const statusContents = contentsOf(
      sanitizeCaptureOutput("status", JSON.stringify({ ...status, root: WORKSPACE }), WORKSPACE),
    );
    expect(statusContents).toContain(PLACEHOLDER);
    expect(statusContents).not.toContain(WORKSPACE);
  });

  it("replaces node statements, content hashes, and challenge content with placeholders", () => {
    const status = statusJson();
    // The stored live status fixture is already sanitized, so inject unredacted
    // values to prove the sanitizer replaces them rather than keeping them.
    const statement = "All primes greater than 2 are odd";
    const contentHash = "cfedf56f083914648d5727cb1f99c0b44177b07d8a93fa95792915e6c0fdd9c2";
    status.nodes[0].statement = statement;
    status.nodes[0].content_hash = contentHash;
    status.challenges.push({
      id: "1",
      node: "1",
      statement: "disputed claim",
      content: "ledger body",
      rationale: "because",
    });

    const contents = contentsOf(sanitizeCaptureOutput("status", JSON.stringify(status), WORKSPACE));
    const parsed = JSON.parse(contents) as {
      nodes: Array<Record<string, unknown>>;
      challenges: Array<Record<string, unknown>>;
    };
    const node = parsed.nodes[0];
    expect(node.statement).toBe("<statement>");
    expect(node.content_hash).toBe("<hash>");
    expect(Object.keys(node)).toEqual(Object.keys(status.nodes[0]));
    expect(node.id).toBe("1");
    expect(node.type).toBe("claim");
    expect(parsed.challenges[0]).toMatchObject({
      statement: "<statement>",
      content: "<content>",
      rationale: "<rationale>",
    });
    expect(contents).not.toContain(statement);
    expect(contents).not.toContain(contentHash);
    expect(contents).not.toContain("disputed claim");
    expect(contents).not.toContain("ledger body");
    expect(contents).not.toContain("because");
  });

  it("removes designated content fields before inspection so their values never leak", () => {
    const status = statusJson();
    status.nodes[0].statement = "super-secret-token";
    const contents = contentsOf(sanitizeCaptureOutput("status", JSON.stringify(status), WORKSPACE));
    expect(contents).toContain("<statement>");
    expect(contents).not.toContain("super-secret-token");
  });

  it("redacts claim context and refine child statements before inspection", () => {
    const claimContents = contentsOf(sanitizeCaptureOutput("claim", JSON.stringify(claimJson()), WORKSPACE));
    expect(JSON.parse(claimContents)).toEqual({
      context: "<context>",
      expires_at: "2026-09-21T11:23:54Z",
      node_id: "1",
      owner: "capture",
      role: "prover",
      status: "claimed",
      timeout: 300,
    });
    expect(claimContents).not.toContain(CLAIM_CONTEXT);
    expect(claimContents).not.toContain("All primes greater than 2 are odd");

    const longContext = "n".repeat(8_000);
    const longContents = contentsOf(
      sanitizeCaptureOutput("claim", JSON.stringify(claimJson({ context: longContext })), WORKSPACE),
    );
    expect(JSON.parse(longContents)).toMatchObject({ context: "<context>" });
    expect(longContents).not.toContain(longContext);

    const refineContents = contentsOf(sanitizeCaptureOutput("refine", JSON.stringify(refineJson()), WORKSPACE));
    expect(JSON.parse(refineContents)).toEqual({
      children: [{ id: "2", type: "claim", statement: "<statement>", inference: "assumption" }],
      parent_id: "1",
      success: true,
    });
    expect(refineContents).not.toContain(REFINE_STATEMENT);
  });

  it("rejects unsafe, control-character, shell-token, and oversized claim or refine captures", () => {
    const unsafeCases: ReadonlyArray<readonly [AfCaptureOperation, string, string]> = [
      ["claim", JSON.stringify(claimJson({ node_id: "/etc/passwd" })), "/etc/passwd"],
      ["claim", JSON.stringify(claimJson({ owner: "capture; rm -rf /" })), "capture; rm -rf /"],
      ["refine", JSON.stringify(refineJson({ parent_id: "1\u0000" })), "\u0000"],
      [
        "refine",
        JSON.stringify(
          refineJson({ children: [{ id: "2", type: "claim", statement: "child", inference: "be\u0007cause" }] }),
        ),
        "\u0007",
      ],
    ];
    for (const [operation, stdout, literal] of unsafeCases) {
      const result = sanitizeCaptureOutput(operation, stdout, WORKSPACE);
      expect(result).toEqual({ ok: false, operation, reason: "unsafe-value" });
      expect(JSON.stringify(result)).not.toContain(literal);
    }

    const oversizedClaim = { ok: false, operation: "claim", reason: "oversized" } as const;
    expect(sanitizeCaptureOutput("claim", "x".repeat(32_769), WORKSPACE)).toEqual(oversizedClaim);
    expect(sanitizeCaptureOutput("claim", JSON.stringify(claimJson({ node_id: "a".repeat(300) })), WORKSPACE)).toEqual(
      oversizedClaim,
    );
    expect(sanitizeCaptureOutput("claim", "{", WORKSPACE)).toEqual({
      ok: false,
      operation: "claim",
      reason: "malformed",
    });

    const children = Array.from({ length: 257 }, (_, index) => ({
      id: String(index + 2),
      type: "claim",
      statement: "child",
      inference: "assumption",
    }));
    expect(sanitizeCaptureOutput("refine", "x".repeat(32_769), WORKSPACE)).toEqual({
      ok: false,
      operation: "refine",
      reason: "oversized",
    });
    expect(sanitizeCaptureOutput("refine", JSON.stringify(refineJson({ children })), WORKSPACE)).toEqual({
      ok: false,
      operation: "refine",
      reason: "oversized",
    });
  });

  it("rejects unsafe values with bounded reasons and never echoes them", () => {
    const version = versionJson();
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
      ["absolute path", { ...version, commit: "/etc/passwd" }, "/etc/passwd"],
      ["windows path", { ...version, commit: "C:\\Users\\other\\notes" }, "C:\\Users\\other\\notes"],
      ["secret marker", { ...version, commit: "super-secret-token" }, "super-secret-token"],
      ["shell token", { ...version, policy: "1.1; rm -rf /" }, "1.1; rm -rf /"],
      ["control character", { ...version, go_version: "go1.27.1\u0000" }, "\u0000"],
    ];
    for (const [, input, literal] of cases) {
      const result = sanitizeCaptureOutput("version", JSON.stringify(input), WORKSPACE);
      expect(result).toEqual({ ok: false, operation: "version", reason: "unsafe-value" });
      expect(JSON.stringify(result)).not.toContain(literal);
    }

    const unsafeInit = `Proof initialized successfully in ${WORKSPACE}\nLedger at /Users/other/private/ledger.json\n`;
    expect(sanitizeCaptureOutput("init", unsafeInit, WORKSPACE)).toEqual({
      ok: false,
      operation: "init",
      reason: "unsafe-value",
    });
    expect(sanitizeCaptureOutput("init", "Proof initialized\u0007", WORKSPACE)).toEqual({
      ok: false,
      operation: "init",
      reason: "unsafe-value",
    });
  });

  it("rejects malformed, empty, oversized, and unsupported inputs", () => {
    const malformed = { ok: false, operation: "version", reason: "malformed" } as const;
    expect(sanitizeCaptureOutput("version", "{", WORKSPACE)).toEqual(malformed);
    expect(sanitizeCaptureOutput("version", '"a string"', WORKSPACE)).toEqual(malformed);
    expect(sanitizeCaptureOutput("init", "  \n", WORKSPACE)).toEqual({
      ok: false,
      operation: "init",
      reason: "malformed",
    });

    const oversized = { ok: false, operation: "version", reason: "oversized" } as const;
    expect(sanitizeCaptureOutput("version", "x".repeat(32_769), WORKSPACE)).toEqual(oversized);
    expect(sanitizeCaptureOutput("init", "x".repeat(32_769), WORKSPACE)).toEqual({
      ok: false,
      operation: "init",
      reason: "oversized",
    });
    expect(
      sanitizeCaptureOutput("version", JSON.stringify({ ...versionJson(), commit: "a".repeat(300) }), WORKSPACE),
    ).toEqual(oversized);

    const invalidWorkspace = { ok: false, operation: "version", reason: "invalid-workspace" } as const;
    expect(sanitizeCaptureOutput("version", liveFixture("version.json"), "")).toEqual(invalidWorkspace);
    expect(sanitizeCaptureOutput("version", liveFixture("version.json"), "tmp/../escape")).toEqual(invalidWorkspace);
    expect(sanitizeCaptureOutput("unknown" as AfCaptureOperation, liveFixture("version.json"), WORKSPACE)).toEqual({
      ok: false,
      operation: "unknown",
      reason: "unsupported-operation",
    });
  });

  it("assembles a bounded project-relative capture set with exact command shapes", () => {
    const result = buildCaptureSet(sanitizedFixtures(), RUNTIME, TIMESTAMP);
    expect(result.ok, "the fixture-derived capture set must assemble").toBe(true);
    if (!result.ok) throw new Error(`expected capture set success, received ${result.reason}`);

    expect(result.files.map((file) => file.relativePath)).toEqual([
      "version.json",
      "schema.json",
      "init.txt",
      "claim.json",
      "refine.json",
      "status.json",
      AF_CAPTURE_MANIFEST_FILE,
    ]);
    for (const file of result.files) {
      expect(file.relativePath).toMatch(/^[a-z]+\.(?:json|txt)$/u);
      expect(new TextEncoder().encode(file.contents).length).toBeLessThanOrEqual(32_768);
    }

    expect(result.manifest).toEqual({
      capturedAt: TIMESTAMP,
      runtime: RUNTIME,
      commands: [
        ["af", "version", "--json"],
        ["af", "schema", "--format", "json"],
        ["af", "init", "-c", "<conjecture>", "-a", "<author>", "-d", "<workspace>"],
        ["af", "claim", "<node-id>", "--owner", "<owner>", "--role", "<role>", "-d", "<workspace>", "--format", "json"],
        ["af", "refine", "<parent-id>", "<statement>", "--owner", "<owner>", "-d", "<workspace>", "--format", "json"],
        ["af", "status", "-d", "<workspace>", "--format", "json"],
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(WORKSPACE);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("packages/platforms");
    expect(serialized).not.toContain(CLAIM_CONTEXT);
    expect(serialized).not.toContain(REFINE_STATEMENT);
    expect(serialized.toLowerCase()).not.toContain("af-runtime-fixture");
  });

  it("rejects unsafe, oversized, empty, or unbounded capture-set inputs", () => {
    const outputs = sanitizedFixtures();
    expect(buildCaptureSet({ ...outputs, version: '{"commit":"/etc/passwd"}' }, RUNTIME, TIMESTAMP)).toEqual({
      ok: false,
      reason: "unsafe-value",
    });
    expect(buildCaptureSet({ ...outputs, version: "x".repeat(32_769) }, RUNTIME, TIMESTAMP)).toEqual({
      ok: false,
      reason: "oversized",
    });
    expect(buildCaptureSet({ ...outputs, schema: "   " }, RUNTIME, TIMESTAMP)).toEqual({
      ok: false,
      reason: "invalid-input",
    });
    expect(buildCaptureSet(outputs, { ...RUNTIME, commit: "a".repeat(300) }, TIMESTAMP)).toEqual({
      ok: false,
      reason: "invalid-input",
    });
    expect(buildCaptureSet(outputs, { ...RUNTIME, policy: "0.1.9; rm -rf /" }, TIMESTAMP)).toEqual({
      ok: false,
      reason: "invalid-input",
    });
    expect(buildCaptureSet(outputs, RUNTIME, "yesterday")).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("builds only the fixed argv shapes and rejects unsafe inputs", () => {
    expect(buildCaptureArgv("version", { workspace: WORKSPACE })).toEqual(["version", "--json"]);
    expect(buildCaptureArgv("schema", { workspace: WORKSPACE })).toEqual(["schema", "--format", "json"]);
    expect(buildCaptureArgv("status", { workspace: WORKSPACE })).toEqual([
      "status",
      "-d",
      WORKSPACE,
      "--format",
      "json",
    ]);
    expect(buildCaptureArgv("status", { workspace: `${WORKSPACE}/` })).toEqual([
      "status",
      "-d",
      WORKSPACE,
      "--format",
      "json",
    ]);
    expect(buildCaptureArgv("init", { workspace: WORKSPACE, conjecture: "All primes greater than 2 are odd" })).toEqual(
      ["init", "-c", "All primes greater than 2 are odd", "-a", AF_CAPTURE_AUTHOR, "-d", WORKSPACE],
    );
    expect(buildCaptureArgv("claim", { workspace: WORKSPACE })).toEqual([
      "claim",
      AF_CAPTURE_ROOT_NODE_ID,
      "--owner",
      AF_CAPTURE_AUTHOR,
      "--role",
      AF_CAPTURE_CLAIM_ROLE,
      "-d",
      WORKSPACE,
      "--format",
      "json",
    ]);
    expect(buildCaptureArgv("refine", { workspace: `${WORKSPACE}/` })).toEqual([
      "refine",
      AF_CAPTURE_ROOT_NODE_ID,
      AF_CAPTURE_STATEMENT,
      "--owner",
      AF_CAPTURE_AUTHOR,
      "-d",
      WORKSPACE,
      "--format",
      "json",
    ]);
    expect(AF_CAPTURE_AUTHOR).toBe("capture");
    expect(AF_CAPTURE_ROOT_NODE_ID).toBe("1");
    expect(AF_CAPTURE_CLAIM_ROLE).toBe("prover");
    expect(AF_CAPTURE_STATEMENT).toBe("All primes greater than 2 are odd");
    expect(buildCaptureArgv("init", { workspace: WORKSPACE })).toBeUndefined();
    expect(buildCaptureArgv("init", { workspace: WORKSPACE, conjecture: "rm -rf /; echo" })).toBeUndefined();
    expect(buildCaptureArgv("claim", { workspace: WORKSPACE, conjecture: "ignored" })).toEqual([
      "claim",
      AF_CAPTURE_ROOT_NODE_ID,
      "--owner",
      AF_CAPTURE_AUTHOR,
      "--role",
      AF_CAPTURE_CLAIM_ROLE,
      "-d",
      WORKSPACE,
      "--format",
      "json",
    ]);
    expect(buildCaptureArgv("claim", { workspace: "" })).toBeUndefined();
    expect(buildCaptureArgv("refine", { workspace: "tmp/../escape" })).toBeUndefined();
    expect(buildCaptureArgv("status", { workspace: "" })).toBeUndefined();
    expect(buildCaptureArgv("status", { workspace: "tmp/../escape" })).toBeUndefined();
  });

  it("has no subprocess, filesystem, or network dependency in source", () => {
    const source = readFileSync(new URL("../vibefeld/af-capture-harness.ts", import.meta.url), "utf8");
    for (const forbidden of [
      "node:child_process",
      "child_process",
      "node:fs",
      "node:net",
      "node:http",
      "node:process",
      "node:os",
      "spawn(",
      "execFile",
      "execSync",
      "readFileSync",
      "writeFileSync",
      "fetch(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/process\.(?:platform|arch|env|argv|pid)/u);
    expect(source).not.toMatch(/^\s*import\s/mu);
    expect(source).toContain("CAPTURE_OPERATIONS");
    expect(source).toContain("sanitizeCaptureOutput");
    expect(source).toContain("buildCaptureSet");
  });

  it("keeps the integration harness gated and free of default spawn imports", () => {
    const source = readFileSync(new URL("./af-capture-harness.integration.test.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import\s[^\n]*node:(?:child_process|fs)/mu);
    const gateIndex = source.indexOf("OPENCODE_CHAT_RUN_VIBEFELD_CAPTURE");
    const spawnIndex = source.indexOf("node:child_process");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(spawnIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(spawnIndex);

    const keepIndex = source.indexOf("OPENCODE_CHAT_KEEP_VIBEFELD_CAPTURE");
    expect(keepIndex).toBeGreaterThan(-1);
    expect(keepIndex).toBeLessThan(spawnIndex);
    expect(source).toMatch(/if\s*\(\s*!KEEP_STAGING_ROOT\s*\)\s*await rm\(/u);
  });
});
