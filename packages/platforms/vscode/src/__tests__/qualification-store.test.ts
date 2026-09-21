import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATIC_ROUTING_EVALUATION_TARGETS,
  type AutomaticRoutingMeasurementCase,
} from "../vibefeld/automatic-routing-evaluation";
import { createQualificationFileStore } from "../vibefeld/qualification-store";

const roots: string[] = [];
const validCase: AutomaticRoutingMeasurementCase = {
  latencyMs: 4,
  confidence: 0.9,
  correct: true,
  challenged: false,
  falseChallenge: false,
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storageRoot(): string {
  const root = mkdtempSync(path.join("tmp", "qualification-store-"));
  roots.push(root);
  return root;
}

describe("createQualificationFileStore", () => {
  it("round-trips bounded aggregate cases beneath global storage", () => {
    const root = storageRoot();
    const store = createQualificationFileStore({ globalStoragePath: root });

    store.save([validCase]);

    expect(store.load()).toEqual([validCase]);
    expect(readFileSync(path.join(root, "vibefeld", "qualification.json"), "utf8")).not.toContain("prompt");
  });

  it("does not write when global storage is absent", () => {
    const root = path.join(storageRoot(), "missing");
    const store = createQualificationFileStore({ globalStoragePath: root });

    store.save([validCase]);

    expect(store.load()).toEqual([]);
  });

  it("degrades malformed and oversized content to empty", () => {
    const root = storageRoot();
    const directory = path.join(root, "vibefeld");
    mkdirSync(directory);
    const file = path.join(directory, "qualification.json");
    writeFileSync(file, "not-json");
    expect(createQualificationFileStore({ globalStoragePath: root }).load()).toEqual([]);

    writeFileSync(file, "x".repeat(2 * 1024 * 1024 + 1));
    expect(createQualificationFileStore({ globalStoragePath: root }).load()).toEqual([]);
  });

  // The 10,000-case load test gets an explicit bound for parallel suite load.
  it("bounds persisted cases to the recorder maximum", () => {
    const root = storageRoot();
    const store = createQualificationFileStore({ globalStoragePath: root });

    store.save(Array.from({ length: AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount + 1 }, () => validCase));

    expect(store.load()).toHaveLength(AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount);
  }, 20_000);

  it("keeps the production path independent from repository, home, and OpenCode state", () => {
    const source = readFileSync(new URL("../vibefeld/qualification-store.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env|homedir|opencode-state|repositoryPath/iu);
    expect(source).toContain("globalStoragePath");
  });
});
