import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AfCompatibilityInput, classifyAfCompatibility } from "../vibefeld/af-compatibility";
import { parseLiveSchemaOutput, parseLiveVersionOutput } from "../vibefeld/af-live-output";
import { parseAfSchemaOutput, parseAfVersionOutput } from "../vibefeld/af-output-schema";

const liveFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/vibefeld/live/af-0.1.11/${name}`, import.meta.url), "utf8");
const fixture = (name: string) => readFileSync(new URL(`./fixtures/vibefeld/${name}`, import.meta.url), "utf8");

const capturedFacts = (): AfCompatibilityInput => {
  const version = parseLiveVersionOutput(liveFixture("version.json"), { exitCode: 0 });
  const schema = parseLiveSchemaOutput(liveFixture("schema.json"), { exitCode: 0 });
  if (!version.ok || !schema.ok) throw new Error("sanitized live captures must parse");
  return { platform: "darwin", architecture: "arm64", version: version.facts, schema: schema.facts };
};

const withVersion = (change: Record<string, unknown>): AfCompatibilityInput => {
  const input = capturedFacts();
  return { ...input, version: { ...(input.version as object), ...change } };
};

describe("AF format-pinned, version-tolerant compatibility preflight", () => {
  it("accepts the real 0.1.11 capture facts and records host-private metadata", () => {
    expect(classifyAfCompatibility(capturedFacts())).toEqual({
      state: "available",
      metadata: { version: "0.1.11", commit: "611291b", format: "1.1", policy: "0.1.9" },
    });
  });

  it("still resolves available for a real-shape capture with an unrelated commit", () => {
    expect(classifyAfCompatibility(withVersion({ commit: "deadbeef" }))).toEqual({
      state: "available",
      metadata: { version: "0.1.11", commit: "deadbeef", format: "1.1", policy: "0.1.9" },
    });
  });

  it.each(["0.1.0", "0.1.7", "0.1.11", "0.1.999"] as const)(
    "accepts the version-tolerant 0.1.x line (%s)",
    (version) => {
      expect(classifyAfCompatibility(withVersion({ version }))).toMatchObject({
        state: "available",
        metadata: { version },
      });
    },
  );

  it("does not gate on build, Go, or policy drift", () => {
    expect(
      classifyAfCompatibility(
        withVersion({ buildDate: "2030-01-01T00:00:00Z", goVersion: "go1.99.0", policy: "9.9.9" }),
      ),
    ).toMatchObject({ state: "available", metadata: { policy: "9.9.9" } });
  });

  it.each(["0.2.0", "1.0.0", "0.0.9", "0.1.1234", "0.1.x"] as const)(
    "classifies the out-of-line or out-of-pattern version %s as incompatible",
    (version) => {
      expect(classifyAfCompatibility(withVersion({ version }))).toEqual({
        state: "incompatible",
        reason: "unsupported-version",
      });
    },
  );

  it.each(["1.0", "1.2", "2.0"] as const)("classifies format %s as incompatible", (format) => {
    expect(classifyAfCompatibility(withVersion({ format }))).toEqual({
      state: "incompatible",
      reason: "format-mismatch",
    });
  });

  it.each([
    ["missing version facts", { version: undefined }, "missing-version-facts"],
    ["missing schema facts", { schema: undefined }, "missing-schema-facts"],
    [
      "non-string version field",
      { version: { ...(capturedFacts().version as object), version: 11 } },
      "malformed-version-facts",
    ],
    [
      "missing commit field",
      { version: { ...(capturedFacts().version as object), commit: undefined } },
      "malformed-version-facts",
    ],
    [
      "malformed version string",
      { version: { ...(capturedFacts().version as object), version: "not-a-version" } },
      "malformed-version-facts",
    ],
    [
      "oversized field",
      { version: { ...(capturedFacts().version as object), commit: "x".repeat(257) } },
      "oversized-evidence",
    ],
    [
      "unsafe field",
      { version: { ...(capturedFacts().version as object), commit: "/private/capture" } },
      "unsafe-evidence",
    ],
    ["malformed schema facts", { schema: { sections: "nope" } }, "malformed-schema-facts"],
  ] as const)("keeps %s dormant as unavailable", (_name, change, reason) => {
    const result = classifyAfCompatibility({ ...capturedFacts(), ...change } as AfCompatibilityInput);
    expect(result).toMatchObject({ state: "unavailable", reason });
    expect(JSON.stringify(result)).not.toMatch(/(?:private|raw|path|output|spawn)/iu);
  });

  it.each([
    ["platform", { platform: "win32" }],
    ["platform", { platform: "windows" }],
    ["architecture", { architecture: "riscv64" }],
  ] as const)("reports unsupported %s as dormant without a process attempt", (_name, change) => {
    const result = classifyAfCompatibility({ ...capturedFacts(), ...change });
    expect(result).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/^unsupported-/u) });
  });

  it("does not accept the synthetic fixture envelope as live evidence", () => {
    const version = parseAfVersionOutput(fixture("version.json"));
    const schema = parseAfSchemaOutput(fixture("schema.json"));
    if (!version.ok || !schema.ok) throw new Error("fixture test-double evidence must parse");

    expect(
      classifyAfCompatibility({
        platform: "darwin",
        architecture: "arm64",
        version: version.facts,
        schema: schema.facts,
      }),
    ).toEqual({ state: "unavailable", reason: "malformed-version-facts" });
    expect(classifyAfCompatibility({ ...capturedFacts(), schema: schema.facts })).toEqual({
      state: "unavailable",
      reason: "malformed-schema-facts",
    });
  });

  it("is pure host-private classification with no process, filesystem, or retired pin surface", () => {
    const source = readFileSync(new URL("../vibefeld/af-compatibility.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:child_process|node:(?:child_process|fs|path|process)|spawn\(|exec\(|fetch\()/);
    expect(source).not.toMatch(/(?:\/private\/|\/Users\/|\/tmp\/|raw preflight output)/i);
    expect(source).not.toContain("5a37413");
    expect(source).not.toContain("0.1.7");
  });
});
