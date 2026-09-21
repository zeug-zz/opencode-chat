import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseAfInitOutput,
  parseAfSchemaOutput,
  parseAfStatusOutput,
  parseAfVersionOutput,
} from "../vibefeld/af-output-schema";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/vibefeld/${name}`, import.meta.url), "utf8");

describe("AF output schema", () => {
  it("normalizes the pinned version fixture without exposing raw output", () => {
    const result = parseAfVersionOutput(fixture("version.json"));
    expect(result).toEqual({
      ok: true,
      facts: {
        fixtureSchema: "af-runtime-fixture-1",
        runtime: {
          executableName: "af",
          version: "0.1.7",
          commit: "5a37413",
          buildDate: "2026-09-08T02:25:39Z",
          goVersion: "go1.27.1",
        },
        operatingSystem: "darwin",
        architecture: "arm64",
      },
      structuralStatus: null,
    });
    expect(JSON.stringify(result)).not.toContain("version.json");
  });

  it("normalizes schema, initialization, and status while dropping content and paths", () => {
    expect(parseAfSchemaOutput(fixture("schema.json"))).toMatchObject({
      ok: true,
      facts: {
        workspaceFormat: "1.0",
        schemaKeys: [
          "inference_types",
          "node_types",
          "workflow_states",
          "epistemic_states",
          "taint_states",
          "challenge_targets",
        ],
      },
      structuralStatus: null,
    });
    expect(parseAfInitOutput(fixture("workspace-init.json"))).toMatchObject({
      ok: true,
      facts: { workspaceFormat: "1.0", entryCount: 9, directoryCount: 7, fileCount: 2 },
      structuralStatus: null,
    });
    const status = parseAfStatusOutput(fixture("status.json"));
    expect(status).toMatchObject({
      ok: true,
      facts: {
        workspaceFormat: "1.0",
        rootState: "pending",
        rootResolution: "unresolved",
        nodeCount: 1,
        challengeCount: 0,
        statistics: { totalNodes: 1, pendingNodes: 1, unresolvedNodes: 1 },
      },
      structuralStatus: null,
    });
    expect(JSON.stringify(status)).not.toContain("fixture-conjecture");
    expect(JSON.stringify(status)).not.toContain("contentHash");
  });

  it.each([
    ["non-zero", { exitCode: 1 }, "non-zero"],
    ["timeout", { timedOut: true }, "timeout"],
    ["cancelled", { cancelled: true }, "cancelled"],
    ["signal", { signal: "SIGTERM" }, "signaled"],
  ] as const)("classifies %s as bounded unavailable", (_name, execution, reason) => {
    const result = parseAfVersionOutput(fixture("version.json"), execution);
    expect(result).toEqual({ ok: false, failure: { outcome: "unavailable", reason, structuralStatus: null } });
  });

  it("rejects malformed, oversized, mismatched, and unsafe output without echoing payloads", () => {
    expect(parseAfVersionOutput('{"raw":"')).toEqual({
      ok: false,
      failure: { outcome: "unavailable", reason: "malformed", structuralStatus: null },
    });
    const oversizedSecret = "credential-value".repeat(3_000);
    const oversized = parseAfVersionOutput(oversizedSecret);
    expect(oversized).toEqual({
      ok: false,
      failure: { outcome: "unavailable", reason: "oversized", structuralStatus: null },
    });
    expect(JSON.stringify(oversized)).not.toContain(oversizedSecret);

    const version = JSON.parse(fixture("version.json")) as Record<string, unknown>;
    expect(
      parseAfVersionOutput(
        JSON.stringify({ ...version, runtime: { ...(version.runtime as object), version: "0.1.8" } }),
      ),
    ).toEqual({
      ok: false,
      failure: { outcome: "unavailable", reason: "unknown", structuralStatus: null },
    });

    const init = JSON.parse(fixture("workspace-init.json")) as Record<string, unknown>;
    const workspace = init.workspace as Record<string, unknown>;
    expect(
      parseAfInitOutput(
        JSON.stringify({ ...init, workspace: { ...workspace, entries: [{ path: "../escape", kind: "file" }] } }),
      ),
    ).toEqual({
      ok: false,
      failure: { outcome: "audit-failed", reason: "audit-failure", structuralStatus: null },
    });
  });
});
