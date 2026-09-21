import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AF_APPROVED_OPERATIONS,
  AF_EXECUTION_REQUIREMENTS,
  AF_PROCESS_BOUNDARY_REQUIREMENTS,
  AF_REVIEW_ROOT_REQUIREMENTS,
  classifyAfRuntimeResult,
  normalizeAfFixture,
  parseAfFixtureJson,
} from "../vibefeld/af-runtime-contract";

const fixtureUrl = (name: string) => new URL(`./fixtures/vibefeld/${name}`, import.meta.url);
const readFixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fixtureUrl(name), "utf8")) as Record<string, unknown>;

const validFixture = {
  fixtureSchema: "af-runtime-fixture-1",
  runtime: {
    executableName: "af",
    version: "0.1.7",
    commit: "5a37413",
    buildDate: "2026-09-08T02:25:39Z",
    goVersion: "go1.27.1",
  },
  capturePlatform: { operatingSystem: "darwin", architecture: "arm64" },
  workspace: { format: "1.0", root: "fixture-workspace" },
  processBoundary: {
    supportedPlatforms: ["darwin", "linux"],
    policy: "dedicated-separate-from-chat-sandbox",
    executableResolution: "host-resolved-fixed-executable",
    operations: ["version", "schema", "init", "status"],
    argv: "typed-fixed-operations",
    shell: false,
    reviewRoot: "context.globalStorageUri",
    deniedWriteDomains: ["repository", "home-directory", "opencode-state", "sibling-review-roots"],
    descendantConfinement: "required",
    pathEscapeProtection: ["traversal", "symlink", "rename"],
    unapprovedChildExecution: "denied",
    boundedInput: true,
    boundedOutput: true,
    timeout: "operation-specific",
    cancellation: "terminate-and-reap-descendants",
    cleanup: "fail-closed",
    downgrade: "never-unsandboxed-or-chat-sandbox",
    failureMode: "fail-closed",
  },
  observedOperations: [
    {
      name: "version",
      argv: ["af", "version", "--json"],
      result: { outcome: "success", exitCode: 0, output: { version: "0.1.7" } },
      workspaceEffects: [],
    },
    {
      name: "invalid-node",
      argv: ["af", "get", "missing", "--dir", "<fixture-workspace>", "--format", "json"],
      result: { outcome: "failure", exitCode: 1, output: { error: "invalid-node-id" } },
      workspaceEffects: [],
    },
  ],
  approvedOperations: [],
};

describe("AF runtime contract defaults", () => {
  it("stays a pure contract module with no execution or configuration imports", () => {
    const source = readFileSync(new URL("../vibefeld/af-runtime-contract.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/(?:child_process|node:(?:child_process|fs|path|process))/);
    for (const forbiddenCall of ["spawn(", "fork(", "fetch(", "mkdir(", "mkdtemp(", "writeFile("]) {
      expect(source).not.toContain(forbiddenCall);
    }
    expect(source).not.toContain("pluginSources");
  });

  it("keeps observed evidence separate from production execution", () => {
    expect(AF_APPROVED_OPERATIONS).toEqual([]);
    expect(AF_EXECUTION_REQUIREMENTS).toMatchObject({
      executable: "host-resolved-fixed-executable",
      argv: "typed-fixed-operations",
      shell: false,
      descendantPolicy: "inherited-by-descendants",
      boundedInput: "required",
      boundedOutput: "required",
      timeout: "operation-specific-required",
      cancellation: "terminate-and-reap-descendants",
      downgrade: "never-unsandboxed-or-chat-sandbox",
    });
  });

  it("requires isolated review roots in extension storage", () => {
    expect(AF_REVIEW_ROOT_REQUIREMENTS).toMatchObject({
      location: "context.globalStorageUri",
      confinement: "unique-descendant-root",
      excludes: ["repository", "home-directory", "opencode-state", "sibling-review-roots"],
      protections: ["traversal", "symlink", "rename", "outside-root-write"],
    });
  });

  it("expresses the complete dedicated macOS/Linux boundary without enabling it", () => {
    const manifest = readFixture("manifest.json");
    expect(manifest.processBoundary).toEqual(AF_PROCESS_BOUNDARY_REQUIREMENTS);
    expect(AF_APPROVED_OPERATIONS).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain("spawn");
  });

  it.each(["unknown", "non-zero", "malformed", "oversized", "timeout", "cancelled", "signaled"] as const)(
    "classifies %s as unavailable without a structural status",
    (kind) => {
      expect(classifyAfRuntimeResult(kind)).toEqual({
        outcome: "unavailable",
        reason: kind,
        structuralStatus: null,
      });
    },
  );

  it.each(["policy-failure", "cleanup-failure", "audit-failure"] as const)(
    "classifies %s as audit-failed without a structural status",
    (kind) => {
      expect(classifyAfRuntimeResult(kind)).toEqual({
        outcome: "audit-failed",
        reason: kind,
        structuralStatus: null,
      });
    },
  );

  it("does not turn an observed success into a structural review status", () => {
    expect(classifyAfRuntimeResult("success")).toEqual({
      outcome: "observed-success",
      structuralStatus: null,
    });
  });
});

describe("AF fixture normalization", () => {
  it("replays the evidence-only corpus without adding an execution route", () => {
    const manifest = readFixture("manifest.json");
    const version = readFixture("version.json");
    const schema = readFixture("schema.json");
    const workspaceInit = readFixture("workspace-init.json");
    const status = readFixture("status.json");
    const failures = readFixture("failures.json");
    const normalized = normalizeAfFixture(manifest);

    expect(manifest).toMatchObject({
      evidenceOnly: true,
      observationStatus: "observed-facts-only",
      approvedOperations: [],
      runtime: {
        executableName: "af",
        version: "0.1.7",
        commit: "5a37413",
        buildDate: "2026-09-08T02:25:39Z",
        goVersion: "go1.27.1",
      },
      workspace: { format: "1.0", root: "fixture-workspace" },
    });
    expect(version).toMatchObject({
      argv: ["af", "version", "--json"],
      runtime: {
        executableName: "af",
        version: "0.1.7",
        commit: "5a37413",
        build_date: "2026-09-08T02:25:39Z",
        go_version: "go1.27.1",
      },
      exitCode: 0,
    });
    expect(schema).toMatchObject({
      argv: ["af", "schema", "--format", "json"],
      workspaceFormat: "1.0",
      schema: {
        inference_types: [],
        node_types: [],
        workflow_states: [],
        epistemic_states: [],
        taint_states: [],
        challenge_targets: [],
      },
      exitCode: 0,
    });
    expect(workspaceInit).toMatchObject({
      argv: [
        "af",
        "init",
        "--conjecture",
        "<fixture-conjecture>",
        "--author",
        "<fixture-author>",
        "--dir",
        "<fixture-workspace>",
      ],
      workspace: { format: "1.0", root: "fixture-workspace" },
      exitCode: 0,
    });
    expect((status.status as Record<string, unknown>).workspaceFormat).toBe("1.0");
    expect((status.status as Record<string, unknown>).root).toEqual({ state: "pending", resolution: "unresolved" });
    expect((status.status as Record<string, unknown>).statistics).toEqual({
      total_nodes: 1,
      epistemic_state: { pending: 1 },
      taint_state: { unresolved: 1 },
      total_challenges: 0,
      open_challenges: 0,
    });
    expect(status.exitCode).toBe(0);

    const failureObservations = failures.observations as Record<string, Record<string, unknown>>;
    expect(failureObservations["invalid-node"]).toMatchObject({
      argv: ["af", "get", "missing", "--dir", "<fixture-workspace>", "--format", "json"],
      outcome: "failure",
      exitCode: 1,
      output: { error: "invalid-node-id" },
    });
    expect(failureObservations["missing-workspace"]).toMatchObject({
      argv: ["af", "status", "--dir", "<missing-workspace>", "--format", "json"],
      outcome: "failure",
      exitCode: 3,
      output: { error: "missing-proof-directory" },
    });

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.evidence.runtime.version).toBe("0.1.7");
    expect(normalized.value.evidence.workspace).toEqual({ format: "1.0", root: "fixture-workspace" });
    expect(normalized.value.evidence.approvedOperations).toEqual([]);
    expect(
      normalized.value.evidence.observedOperations.map(({ name, argv, result }) => ({ name, argv, result })),
    ).toEqual([
      {
        name: "version",
        argv: ["af", "version", "--json"],
        result: { outcome: "success", exitCode: 0, output: null },
      },
      {
        name: "schema",
        argv: ["af", "schema", "--format", "json"],
        result: { outcome: "success", exitCode: 0, output: null },
      },
      {
        name: "init",
        argv: [
          "af",
          "init",
          "--conjecture",
          "<fixture-conjecture>",
          "--author",
          "<fixture-author>",
          "--dir",
          "<fixture-workspace>",
        ],
        result: { outcome: "success", exitCode: 0, output: null },
      },
      {
        name: "status",
        argv: ["af", "status", "--dir", "<fixture-workspace>", "--format", "json"],
        result: { outcome: "success", exitCode: 0, output: null },
      },
      {
        name: "invalid-node",
        argv: ["af", "get", "missing", "--dir", "<fixture-workspace>", "--format", "json"],
        result: { outcome: "failure", exitCode: 1, output: { error: "invalid-node-id" } },
      },
      {
        name: "missing-workspace",
        argv: ["af", "status", "--dir", "<missing-workspace>", "--format", "json"],
        result: { outcome: "failure", exitCode: 3, output: { error: "missing-proof-directory" } },
      },
    ]);
  });

  it("accepts bounded successful JSON and never includes raw payloads in parser errors", () => {
    const manifest = readFixture("manifest.json");
    const parsed = parseAfFixtureJson(JSON.stringify(manifest));
    expect(parsed.ok).toBe(true);

    const malformed = parseAfFixtureJson('{"output":');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok)
      expect(malformed.errors).toEqual([{ code: "malformed-json", message: "fixture JSON is malformed" }]);

    const oversizedPayload = "sensitive raw payload";
    const oversized = parseAfFixtureJson(oversizedPayload.repeat(2_000));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.errors).toEqual([
        { code: "unbounded-value", message: "fixture JSON exceeds the maximum byte length" },
      ]);
      expect(JSON.stringify(oversized.errors)).not.toContain(oversizedPayload);
    }
  });

  it("accepts the observed identity and returns a non-executable contract", () => {
    const result = normalizeAfFixture(validFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence.runtime).toEqual(validFixture.runtime);
    expect(result.value.evidence.observedOperations[1]?.result).toEqual({
      outcome: "failure",
      exitCode: 1,
      output: { error: "invalid-node-id" },
    });
    expect(result.value.evidence.approvedOperations).toEqual([]);
    expect(result.value.processBoundary.shell).toBe(false);
  });

  it("parses JSON-shaped fixtures without filesystem access", () => {
    const result = parseAfFixtureJson(JSON.stringify(validFixture));
    expect(result.ok).toBe(true);
  });

  it.each([
    ["unsupported schema", { fixtureSchema: "af-runtime-fixture-2" }],
    ["wrong runtime", { runtime: { ...validFixture.runtime, version: "0.1.8" } }],
    [
      "absolute path",
      { observedOperations: [{ ...validFixture.observedOperations[0], argv: ["af", "--dir", "/private/workspace"] }] },
    ],
    [
      "escaping path",
      { observedOperations: [{ ...validFixture.observedOperations[0], argv: ["af", "--dir", "../workspace"] }] },
    ],
    [
      "shell command string",
      { observedOperations: [{ ...validFixture.observedOperations[0], argv: ["af status --format json"] }] },
    ],
    ["operation approval", { approvedOperations: ["status"] }],
    ["missing boundary", { processBoundary: undefined }],
    ["incomplete boundary", { processBoundary: { ...validFixture.processBoundary, shell: true } }],
    [
      "wrong review root",
      { processBoundary: { ...validFixture.processBoundary, reviewRoot: "extension-global-storage" } },
    ],
    [
      "missing denied write domain",
      { processBoundary: { ...validFixture.processBoundary, deniedWriteDomains: ["repository"] } },
    ],
    ["weak cleanup", { processBoundary: { ...validFixture.processBoundary, cleanup: "best-effort" } }],
    ["sandbox downgrade", { processBoundary: { ...validFixture.processBoundary, downgrade: "chat-sandbox" } }],
    [
      "unsafe prompt",
      {
        observedOperations: [
          {
            ...validFixture.observedOperations[0],
            result: { outcome: "failure", exitCode: 1, output: { prompt: "do not retain" } },
          },
        ],
      },
    ],
  ] as const)("rejects %s", (_name, change) => {
    const result = normalizeAfFixture({ ...validFixture, ...change });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.every(({ message }) => !message.includes("do not retain"))).toBe(true);
  });

  it("rejects malformed and oversized JSON without exposing its payload", () => {
    expect(parseAfFixtureJson("{").ok).toBe(false);
    const result = parseAfFixtureJson(`${"x".repeat(32_769)}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { code: "unbounded-value", message: "fixture JSON exceeds the maximum byte length" },
    ]);
  });

  it("rejects absolute or escaping paths in normalized JSON fields", () => {
    const result = normalizeAfFixture({
      ...validFixture,
      metadata: { capturedPath: "../outside-review-root" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some(({ code }) => code === "unsafe-value")).toBe(true);
  });
});
