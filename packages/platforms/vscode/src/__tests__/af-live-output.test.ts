import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AfLiveOutputResult,
  parseLiveInitOutput,
  parseLiveSchemaOutput,
  parseLiveStatusOutput,
  parseLiveVersionOutput,
  resolveLiveHostPlatform,
} from "../vibefeld/af-live-output";

const liveFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");

const legacyFixture = (name: string) => readFileSync(new URL(`./fixtures/vibefeld/${name}`, import.meta.url), "utf8");

const factsOf = <T>(result: AfLiveOutputResult<T>): T => {
  if (!result.ok) throw new Error("expected live output success");
  return result.facts;
};

const readJson = (name: string): Record<string, unknown> => JSON.parse(liveFixture(name)) as Record<string, unknown>;

const withoutKey = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([entryKey]) => entryKey !== key));

describe("AF live output parsers", () => {
  it("normalizes the live version capture into flat host-private facts", () => {
    const facts = factsOf(parseLiveVersionOutput(liveFixture("version.json"), { exitCode: 0 }));
    expect(facts).toEqual({
      version: "0.1.11",
      commit: "611291b",
      buildDate: "2026-09-21T00:24:48Z",
      goVersion: "go1.27.1",
      format: "1.1",
      policy: "0.1.9",
    });
    expect(Object.keys(facts)).toEqual(["version", "commit", "buildDate", "goVersion", "format", "policy"]);
    expect(JSON.stringify(facts)).not.toContain("build_date");
    expect(JSON.stringify(facts)).not.toContain("go_version");
  });

  it("reduces schema output to bounded section counts only", () => {
    const facts = factsOf(parseLiveSchemaOutput(liveFixture("schema.json"), { exitCode: 0 }));
    expect(facts.sections).toEqual({
      inference_types: 11,
      node_types: 5,
      workflow_states: 3,
      epistemic_states: 7,
      taint_states: 4,
      challenge_targets: 9,
    });
    expect(facts.totalEntries).toBe(39);
    expect(Object.keys(facts)).toEqual(["sections", "totalEntries"]);
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain("Modus Ponens");
    expect(serialized).not.toContain("description");
    for (const count of Object.values(facts.sections)) {
      expect(Number.isSafeInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  it("normalizes a success init exit to { initialized: true } and discards the prose", () => {
    const result = parseLiveInitOutput(liveFixture("init.txt"), { exitCode: 0 });
    expect(result).toEqual({ ok: true, facts: { initialized: true }, structuralStatus: null });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("<workspace>");
    expect(serialized).not.toContain("Proof initialized successfully");
    expect(serialized).not.toContain("All primes greater than 2 are odd");
    expect(serialized).not.toContain("af refine");
  });

  it("normalizes status output to bounded numeric aggregates and never retains nodes or challenges", () => {
    const result = parseLiveStatusOutput(liveFixture("status.json"), { exitCode: 0 });
    expect(result).toEqual({
      ok: true,
      facts: {
        statistics: { totalNodes: 1, totalChallenges: 0, openChallenges: 0 },
        jobs: { proverJobs: 0, verifierJobs: 1 },
        nodeCount: 1,
      },
      structuralStatus: null,
    });
    const facts = factsOf(result);
    expect(Object.keys(facts)).toEqual(["statistics", "jobs", "nodeCount"]);
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain("All primes greater than 2 are odd");
    expect(serialized).not.toContain("content_hash");
    expect(serialized).not.toContain("cfedf56f083914648d5727cb1f99c0b44177b07d8a93fa95792915e6c0fdd9c2");
    expect(serialized).not.toContain("assumption");
    expect(serialized).not.toContain("support_");
  });

  it("rejects fixture-shaped evidence in live mode", () => {
    const legacyEnvelope = JSON.stringify({
      fixtureSchema: "af-runtime-fixture-1",
      runtime: { executableName: "af", version: "0.1.7" },
      workspaceFormat: "1.0",
    });
    const rejected = { ok: false, failure: { outcome: "unavailable", reason: "unknown", structuralStatus: null } };
    expect(parseLiveVersionOutput(legacyEnvelope)).toEqual(rejected);
    expect(parseLiveSchemaOutput(legacyEnvelope)).toEqual(rejected);
    expect(parseLiveStatusOutput(legacyEnvelope)).toEqual(rejected);
    expect(parseLiveVersionOutput(legacyFixture("version.json"))).toEqual(rejected);
    expect(parseLiveStatusOutput(legacyFixture("status.json"))).toEqual(rejected);
    expect(parseLiveInitOutput(legacyFixture("workspace-init.json"))).toEqual(rejected);
    expect(parseLiveInitOutput("Proof initialized successfully in <fixture-workspace>")).toEqual(rejected);
  });

  it.each([
    ["non-zero", { exitCode: 1 }, "non-zero"],
    ["timeout", { timedOut: true }, "timeout"],
    ["cancelled", { cancelled: true }, "cancelled"],
    ["signal", { signal: "SIGTERM" }, "signaled"],
  ] as const)("classifies %s as bounded unavailable for every operation", (_name, execution, reason) => {
    const expected = { ok: false, failure: { outcome: "unavailable", reason, structuralStatus: null } };
    expect(parseLiveVersionOutput(liveFixture("version.json"), execution)).toEqual(expected);
    expect(parseLiveSchemaOutput(liveFixture("schema.json"), execution)).toEqual(expected);
    expect(parseLiveInitOutput(liveFixture("init.txt"), execution)).toEqual(expected);
    expect(parseLiveStatusOutput(liveFixture("status.json"), execution)).toEqual(expected);
  });

  it("classifies malformed, oversized, and unrecognized output without echoing the payload", () => {
    const malformed = { ok: false, failure: { outcome: "unavailable", reason: "malformed", structuralStatus: null } };
    const oversized = { ok: false, failure: { outcome: "unavailable", reason: "oversized", structuralStatus: null } };
    expect(parseLiveVersionOutput('{"version":"')).toEqual(malformed);
    expect(parseLiveVersionOutput("[]")).toEqual(malformed);
    expect(parseLiveInitOutput("no recognized success line")).toEqual(malformed);
    const oversizedSecret = "credential-value".repeat(3_000);
    const oversizedResult = parseLiveVersionOutput(oversizedSecret);
    expect(oversizedResult).toEqual(oversized);
    expect(JSON.stringify(oversizedResult)).not.toContain(oversizedSecret);
    expect(parseLiveInitOutput("x".repeat(32_769))).toEqual(oversized);
  });

  it("maps missing, unsafe, and unbounded values to bounded classifications without echoing them", () => {
    const unavailableUnknown = {
      ok: false,
      failure: { outcome: "unavailable", reason: "unknown", structuralStatus: null },
    };
    const auditFailed = {
      ok: false,
      failure: { outcome: "audit-failed", reason: "audit-failure", structuralStatus: null },
    };
    const version = readJson("version.json");
    const status = readJson("status.json");
    const schema = readJson("schema.json");
    const statistics = status.statistics as Record<string, unknown>;

    const unsafeCommit = "super-secret-token";
    const unsafe = parseLiveVersionOutput(JSON.stringify({ ...version, commit: unsafeCommit }));
    expect(unsafe).toEqual(auditFailed);
    expect(JSON.stringify(unsafe)).not.toContain(unsafeCommit);

    expect(parseLiveVersionOutput(JSON.stringify({ ...version, policy: "p".repeat(300) }))).toEqual(auditFailed);
    expect(parseLiveVersionOutput(JSON.stringify(withoutKey(version, "format")))).toEqual(unavailableUnknown);
    expect(
      parseLiveStatusOutput(JSON.stringify({ ...status, statistics: { ...statistics, total_nodes: -1 } })),
    ).toEqual(auditFailed);
    expect(parseLiveStatusOutput(JSON.stringify(withoutKey(status, "nodes")))).toEqual(unavailableUnknown);
    expect(parseLiveSchemaOutput(JSON.stringify(withoutKey(schema, "node_types")))).toEqual(unavailableUnknown);
    expect(parseLiveSchemaOutput(JSON.stringify({ ...schema, challenge_targets: [{ id: "/etc/passwd" }] }))).toEqual(
      auditFailed,
    );
  });

  it("derives platform and architecture from host inputs and never from AF output", () => {
    const host = resolveLiveHostPlatform(process.platform, process.arch);
    if (["darwin", "linux"].includes(process.platform) && ["arm64", "x64", "arm", "ia32"].includes(process.arch)) {
      expect(host).toEqual({ operatingSystem: process.platform, architecture: process.arch });
    } else {
      expect(host).toBeUndefined();
    }
    expect(resolveLiveHostPlatform("win32", "x64")).toBeUndefined();
    expect(resolveLiveHostPlatform("darwin", "mips")).toBeUndefined();

    const spoofed = {
      ...readJson("version.json"),
      operatingSystem: "windows",
      architecture: "mips",
      platform: { operatingSystem: "windows", architecture: "mips" },
    };
    const result = parseLiveVersionOutput(JSON.stringify(spoofed), { exitCode: 0 });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("windows");
    expect(JSON.stringify(result)).not.toContain("mips");
  });

  it("keeps the versioned live captures free of host paths and fixture envelopes", () => {
    for (const name of ["version.json", "schema.json", "init.txt", "status.json", "manifest.json"]) {
      const content = liveFixture(name);
      expect(content).not.toMatch(/\/Users\//u);
      expect(content).not.toContain("vibefeld-capture");
      expect(content).not.toMatch(/packages\/platforms/u);
      expect(content.toLowerCase()).not.toContain("af-runtime-fixture");
    }
    const manifest = readJson("manifest.json") as {
      runtime: Record<string, string>;
      commands: string[][];
    };
    const versionFacts = factsOf(parseLiveVersionOutput(liveFixture("version.json"), { exitCode: 0 }));
    expect(manifest.runtime.version).toBe(versionFacts.version);
    expect(manifest.runtime.commit).toBe(versionFacts.commit);
    expect(manifest.runtime.build_date).toBe(versionFacts.buildDate);
    expect(manifest.runtime.go_version).toBe(versionFacts.goVersion);
    expect(manifest.runtime.format).toBe(versionFacts.format);
    expect(manifest.runtime.policy).toBe(versionFacts.policy);
    expect(manifest.commands).toHaveLength(4);
  });

  it("has no process launch, filesystem, network, or fixture-envelope dependency in source", () => {
    const source = readFileSync(new URL("../vibefeld/af-live-output.ts", import.meta.url), "utf8");
    for (const forbidden of [
      "node:child_process",
      "node:fs",
      "node:net",
      "node:http",
      "node:process",
      "child_process",
      "spawn(",
      "execFile",
      "execSync",
      "readFileSync",
      "writeFileSync",
      "fetch(",
      "./af-output-schema",
      "AF_FIXTURE_LIMITS",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/process\.(?:platform|arch|env|argv)/u);
    expect(source).toContain("classifyAfRuntimeResult");
  });
});
