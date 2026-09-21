import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AfLiveOutputResult } from "../vibefeld/af-live-output";
import {
  type AfParserOperation,
  createAfOutputParsers,
  createProductionAfOutputParsers,
  resolveAfParserMode,
} from "../vibefeld/af-parser-mode";

const liveFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");

const fixture = (name: string) => readFileSync(new URL(`./fixtures/vibefeld/${name}`, import.meta.url), "utf8");

const readJson = (content: string): Record<string, unknown> => JSON.parse(content) as Record<string, unknown>;

const selectedParsers = (mode: unknown) => {
  const parsers = createAfOutputParsers(mode);
  if (!parsers) throw new Error("expected a parser selection");
  return parsers;
};

const factsOf = <T>(result: AfLiveOutputResult<T>): T => {
  if (!result.ok) throw new Error("expected parser success");
  return result.facts;
};

const unavailableUnknown = {
  ok: false,
  failure: { outcome: "unavailable", reason: "unknown", structuralStatus: null },
} as const;

describe("AF parser mode selection", () => {
  it("resolves only the exact live and fixture mode strings", () => {
    expect(resolveAfParserMode("live")).toBe("live");
    expect(resolveAfParserMode("fixture")).toBe("fixture");
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["unknown", "runtime"],
    ["uppercase", "LIVE"],
    ["case-changed", "Fixture"],
    ["whitespace", " live "],
    ["numeric", 1],
    ["object", { mode: "live" }],
    ["array", ["fixture"]],
  ] as const)("fails closed as unavailable for a %s mode", (_name, value) => {
    expect(resolveAfParserMode(value)).toBeUndefined();
    expect(createAfOutputParsers(value)).toBeUndefined();
  });

  it("produces no parse result when the mode does not resolve", () => {
    const parsers = createAfOutputParsers(undefined);
    let parsed: unknown;
    if (parsers) parsed = parsers.version(liveFixture("version.json"), { exitCode: 0 });
    expect(parsed).toBeUndefined();
  });

  it("selects live parsers that normalize the real captures", () => {
    const parsers = selectedParsers("live");
    expect(factsOf(parsers.version(liveFixture("version.json"), { exitCode: 0 }))).toEqual({
      version: "0.1.11",
      commit: "611291b",
      buildDate: "2026-09-21T00:24:48Z",
      goVersion: "go1.27.1",
      format: "1.1",
      policy: "0.1.9",
    });
    expect(factsOf(parsers.schema(liveFixture("schema.json"), { exitCode: 0 }))).toEqual({
      sections: {
        inference_types: 11,
        node_types: 5,
        workflow_states: 3,
        epistemic_states: 7,
        taint_states: 4,
        challenge_targets: 9,
      },
      totalEntries: 39,
    });
    expect(factsOf(parsers.init(liveFixture("init.txt"), { exitCode: 0 }))).toEqual({ initialized: true });
    expect(factsOf(parsers.status(liveFixture("status.json"), { exitCode: 0 }))).toEqual({
      statistics: { totalNodes: 1, totalChallenges: 0, openChallenges: 0 },
      jobs: { proverJobs: 0, verifierJobs: 1 },
      nodeCount: 1,
    });
  });

  it("selects fixture parsers that normalize the synthetic fixtures", () => {
    const parsers = selectedParsers("fixture");
    expect(factsOf(parsers.version(fixture("version.json")))).toMatchObject({
      fixtureSchema: "af-runtime-fixture-1",
      runtime: { executableName: "af", version: "0.1.7" },
      operatingSystem: "darwin",
      architecture: "arm64",
    });
    expect(factsOf(parsers.schema(fixture("schema.json")))).toMatchObject({
      fixtureSchema: "af-runtime-fixture-1",
      workspaceFormat: "1.0",
    });
    expect(factsOf(parsers.init(fixture("workspace-init.json")))).toMatchObject({
      fixtureSchema: "af-runtime-fixture-1",
      workspaceFormat: "1.0",
      entryCount: 9,
      directoryCount: 7,
      fileCount: 2,
    });
    expect(factsOf(parsers.status(fixture("status.json")))).toMatchObject({
      fixtureSchema: "af-runtime-fixture-1",
      workspaceFormat: "1.0",
      rootState: "pending",
      rootResolution: "unresolved",
      statistics: { totalNodes: 1, pendingNodes: 1, unresolvedNodes: 1, totalChallenges: 0, openChallenges: 0 },
      jobs: { proverJobs: 1, verifierJobs: 0 },
      nodeCount: 1,
      challengeCount: 0,
    });
  });

  it("exposes exactly the four parser operations in both modes and in production", () => {
    const operations: readonly AfParserOperation[] = ["version", "schema", "init", "status"];
    const expected = [...operations].sort();
    expect(Object.keys(selectedParsers("live")).sort()).toEqual(expected);
    expect(Object.keys(selectedParsers("fixture")).sort()).toEqual(expected);
    expect(Object.keys(createProductionAfOutputParsers()).sort()).toEqual(expected);
  });

  it("rejects the synthetic af-runtime-fixture-1 envelope in live mode without falling back", () => {
    const live = selectedParsers("live");
    const fixtures = selectedParsers("fixture");
    const envelope = JSON.stringify({
      fixtureSchema: "af-runtime-fixture-1",
      argv: ["af", "version", "--json"],
      runtime: {
        executableName: "af",
        version: "0.1.7",
        commit: "5a37413",
        build_date: "2026-09-08T02:25:39Z",
        go_version: "go1.27.1",
      },
      platform: { operatingSystem: "darwin", architecture: "arm64" },
      exitCode: 0,
    });
    expect(live.version(envelope)).toEqual(unavailableUnknown);
    expect(live.version(fixture("version.json"))).toEqual(unavailableUnknown);
    expect(live.schema(fixture("schema.json"))).toEqual(unavailableUnknown);
    expect(live.status(fixture("status.json"))).toEqual(unavailableUnknown);
    expect(live.init(fixture("workspace-init.json"))).toEqual(unavailableUnknown);

    // The same inputs parse only under the explicit fixture test double.
    expect(fixtures.version(fixture("version.json")).ok).toBe(true);
    expect(fixtures.schema(fixture("schema.json")).ok).toBe(true);
    expect(fixtures.status(fixture("status.json")).ok).toBe(true);
    expect(fixtures.init(fixture("workspace-init.json")).ok).toBe(true);

    // Fixture schema markers, placeholders, and fixture workspace identity.
    const version = readJson(liveFixture("version.json"));
    expect(live.version(JSON.stringify({ ...version, commit: "<fixture-commit>" }))).toEqual(unavailableUnknown);
    expect(live.init("Proof initialized successfully in <fixture-workspace>")).toEqual(unavailableUnknown);
    const status = readJson(liveFixture("status.json"));
    expect(live.status(JSON.stringify({ ...status, workspace: "fixture-workspace" }))).toEqual(unavailableUnknown);
    expect(JSON.stringify(live.version(fixture("version.json")))).not.toContain("af-runtime-fixture");
    expect(JSON.stringify(live.version(fixture("version.json")))).not.toContain("fixtureSchema");
  });

  it("keeps the fixture envelope out of production evidence", () => {
    expect(createProductionAfOutputParsers).toHaveLength(0);
    const production = createProductionAfOutputParsers();
    expect(factsOf(production.version(liveFixture("version.json"), { exitCode: 0 }))).toMatchObject({
      version: "0.1.11",
      format: "1.1",
      policy: "0.1.9",
    });
    expect(factsOf(production.schema(liveFixture("schema.json"), { exitCode: 0 })).totalEntries).toBe(39);
    expect(factsOf(production.init(liveFixture("init.txt"), { exitCode: 0 }))).toEqual({ initialized: true });
    expect(factsOf(production.status(liveFixture("status.json"), { exitCode: 0 }))).toMatchObject({
      statistics: { totalNodes: 1, totalChallenges: 0, openChallenges: 0 },
      jobs: { proverJobs: 0, verifierJobs: 1 },
      nodeCount: 1,
    });

    const rejected = [
      production.version(fixture("version.json")),
      production.schema(fixture("schema.json")),
      production.init(fixture("workspace-init.json")),
      production.status(fixture("status.json")),
    ];
    for (const result of rejected) expect(result).toEqual(unavailableUnknown);
    const serialized = JSON.stringify(rejected);
    expect(serialized).not.toContain("af-runtime-fixture");
    expect(serialized).not.toContain("fixtureSchema");
    expect(serialized).not.toContain("fixture-workspace");
  });

  it("keeps both parsers as separate modules and the selector free of process, filesystem, and network access", () => {
    const liveSource = readFileSync(new URL("../vibefeld/af-live-output.ts", import.meta.url), "utf8");
    const fixtureSource = readFileSync(new URL("../vibefeld/af-output-schema.ts", import.meta.url), "utf8");
    const selectorSource = readFileSync(new URL("../vibefeld/af-parser-mode.ts", import.meta.url), "utf8");

    expect(liveSource).not.toContain("./af-output-schema");
    expect(fixtureSource).not.toContain("./af-live-output");
    expect(selectorSource).toContain('from "./af-live-output"');
    expect(selectorSource).toContain('from "./af-output-schema"');

    // The selector never re-exports a fixture result or fixture fact type as production evidence.
    expect(selectorSource).not.toMatch(/export\s+\{[^}]*\}\s+from/u);
    for (const fixtureName of [
      "AfOutputResult",
      "AfOutputExecution",
      "AfVersionFacts",
      "AfSchemaFacts",
      "AfInitFacts",
      "AfStatusFacts",
    ]) {
      expect(selectorSource).not.toContain(fixtureName);
    }

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
      "af-runtime-fixture",
    ]) {
      expect(selectorSource).not.toContain(forbidden);
    }
    expect(selectorSource).not.toMatch(/process\.(?:platform|arch|env|argv)/u);
  });
});
