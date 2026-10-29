import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_HINDSIGHT_PACKAGE,
  type HindsightPackageMetadata,
  readEffectiveOpenCodeConfiguration,
  readHindsightPackageMetadata,
  resolveHindsightPlugin,
} from "../hindsight-plugin-resolver";

const approvedMetadata: HindsightPackageMetadata = {
  name: APPROVED_HINDSIGHT_PACKAGE,
  packageRoot: "/Users/test/.hindsight/coding-agents",
  runtimePaths: ["/Users/test/.hindsight/coding-agents/runtime"],
  configurationPaths: ["/Users/test/.hindsight/config.json"],
};

describe("resolveHindsightPlugin", () => {
  it("reads bounded model layers while preserving plugin behavior", () => {
    const root = resolve(process.cwd(), "tmp/effective-opencode-config");
    const globalConfig = resolve(root, "global");
    const projectConfig = resolve(root, "project");
    mkdirSync(globalConfig, { recursive: true });
    mkdirSync(resolve(projectConfig, ".git"), { recursive: true });
    writeFileSync(
      resolve(globalConfig, "opencode.json"),
      JSON.stringify({ model: "global/provider", plugin: ["global"] }),
    );
    writeFileSync(resolve(projectConfig, "opencode.jsonc"), '{ "model": "project/provider", "plugin": ["project"], }');

    expect(readEffectiveOpenCodeConfiguration(globalConfig, projectConfig)).toEqual({
      model: "project/provider",
      plugins: ["global", "project"],
    });

    writeFileSync(
      resolve(projectConfig, "opencode.jsonc"),
      JSON.stringify({ model: " ", plugin: { malformed: true } }),
    );
    expect(readEffectiveOpenCodeConfiguration(globalConfig, projectConfig)).toEqual({
      model: "global/provider",
      plugins: ["global"],
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("projects legacy and native entries in document order with copied options and source-relative references", () => {
    const root = resolve(process.cwd(), "tmp/scribe-v2-migration/rebaseline-2.1.2/plugin-entry");
    const globalConfig = resolve(root, "global");
    const projectConfig = resolve(root, "project");
    mkdirSync(globalConfig, { recursive: true });
    mkdirSync(resolve(projectConfig, ".git"), { recursive: true });
    const options = { nested: { enabled: true }, unknown: [1, null, { value: "kept" }] };
    writeFileSync(
      resolve(globalConfig, "opencode.json"),
      JSON.stringify({
        plugin: [["../global-plugin", options], "-*"],
        plugins: [{ package: "native-global", options }],
      }),
    );
    writeFileSync(
      resolve(projectConfig, "opencode.jsonc"),
      JSON.stringify({ plugin: ["legacy-project"], plugins: ["../project-plugin", { package: "native-project" }] }),
    );
    const result = readEffectiveOpenCodeConfiguration(globalConfig, projectConfig);
    expect(result.plugins).toEqual([
      { package: resolve(globalConfig, "../global-plugin"), options },
      "-*",
      { package: "native-global", options },
      "legacy-project",
      resolve(projectConfig, "../project-plugin"),
      { package: "native-project" },
    ]);
    expect(result.plugins?.[0]).not.toBe(options);
    const firstEntry = result.plugins?.[0];
    expect(typeof firstEntry === "object" && firstEntry !== null ? firstEntry.options : undefined).not.toBe(options);
    expect(options).toEqual({ nested: { enabled: true }, unknown: [1, null, { value: "kept" }] });
    rmSync(root, { recursive: true, force: true });
  });

  it("ignores malformed siblings and normalizes valid file URLs", () => {
    const root = resolve(process.cwd(), "tmp/scribe-v2-migration/rebaseline-2.1.2/plugin-entry-invalid");
    const globalConfig = resolve(root, "global");
    const project = resolve(root, "project");
    mkdirSync(globalConfig, { recursive: true });
    mkdirSync(resolve(project, ".git"), { recursive: true });
    const local = resolve(project, "local-plugin.js");
    writeFileSync(
      resolve(project, "opencode.json"),
      JSON.stringify({
        plugin: [null, 4, ["bad", null], ["bad", []], ["valid-legacy", { safe: true }]],
        plugins: [
          null,
          {},
          { options: {} },
          { package: 4 },
          { package: "bad-options", options: [] },
          { package: "valid-native", options: { n: 1 } },
          `file://${local}`,
        ],
      }),
    );
    expect(readEffectiveOpenCodeConfiguration(globalConfig, project).plugins).toEqual([
      { package: "valid-legacy", options: { safe: true } },
      { package: "valid-native", options: { n: 1 } },
      local,
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("applies array-only, field-specific legacy and native entry shapes", () => {
    const root = resolve(process.cwd(), "tmp/scribe-v2-migration/rebaseline-2.1.2/plugin-entry");
    const globalConfig = resolve(root, "shape-global");
    const project = resolve(root, "shape-project");
    mkdirSync(globalConfig, { recursive: true });
    mkdirSync(resolve(project, ".git"), { recursive: true });
    writeFileSync(
      resolve(globalConfig, "opencode.json"),
      JSON.stringify({
        plugin: [
          ["legacy-valid", { enabled: true }],
          "legacy-string-valid",
          ["legacy-one-item"],
          ["legacy-extra", {}, "extra"],
          ["legacy-null-options", null],
          ["legacy-array-options", []],
          { package: "legacy-object-invalid", options: {} },
        ],
        plugins: [
          "native-string-valid",
          { package: "native-object-valid", options: { nested: { ok: true } } },
          ["native-tuple-invalid", {}],
          { options: {} },
          { package: 7 },
          { package: "native-array-options", options: [] },
        ],
      }),
    );
    writeFileSync(
      resolve(project, "opencode.jsonc"),
      JSON.stringify({ plugin: "legacy-scalar-invalid", plugins: "native-scalar-invalid" }),
    );

    expect(readEffectiveOpenCodeConfiguration(globalConfig, project).plugins).toEqual([
      { package: "legacy-valid", options: { enabled: true } },
      "legacy-string-valid",
      "native-string-valid",
      { package: "native-object-valid", options: { nested: { ok: true } } },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves nested JSONC options strings while removing only syntactic trailing commas", () => {
    const root = resolve(process.cwd(), "tmp/scribe-v2-migration/rebaseline-2.1.2/plugin-entry");
    const globalConfig = resolve(root, "jsonc-global");
    const project = resolve(root, "jsonc-project");
    mkdirSync(globalConfig, { recursive: true });
    mkdirSync(resolve(project, ".git"), { recursive: true });
    const path = resolve(project, "opencode.jsonc");
    const source = String.raw`{
      // Real line comment.
      "plugin": ["legacy-plugin"],
      "plugins": [
        {
          "package": "native-plugin",
          "options": {
            "nested": { "array": [1, { "url": "https://example.test/a//b", "comment": "quoted /*text*/" },], },
            "strings": [", }", ", ]", "Unicode ☃", "escaped quote: \\\" and slash //", "literal, } and ]",],
            "deep": { "one": { "two": [true, null, { "value": "kept, exactly" },],},},
          },
        },
      ],
    }`;
    writeFileSync(path, source);

    const result = readEffectiveOpenCodeConfiguration(globalConfig, project);
    expect(result.plugins).toEqual([
      "legacy-plugin",
      {
        package: "native-plugin",
        options: {
          nested: { array: [1, { url: "https://example.test/a//b", comment: "quoted /*text*/" }] },
          strings: [", }", ", ]", "Unicode ☃", 'escaped quote: \\" and slash //', "literal, } and ]"],
          deep: { one: { two: [true, null, { value: "kept, exactly" }] } },
        },
      },
    ]);
    expect(readFileSync(path, "utf8")).toBe(source);
    rmSync(root, { recursive: true, force: true });
  });

  it("finds exact package metadata from an absolute file entry through bounded parents", () => {
    const pluginFile = resolve(process.cwd(), "tmp/hindsight-plugin-fixture/dist/index.js");
    const packageRoot = resolve(process.cwd(), "tmp/hindsight-plugin-fixture");
    mkdirSync(resolve(packageRoot, "dist"), { recursive: true });
    writeFileSync(resolve(packageRoot, "package.json"), JSON.stringify({ name: APPROVED_HINDSIGHT_PACKAGE }));
    writeFileSync(pluginFile, "");
    expect(readHindsightPackageMetadata(pluginFile)).toEqual({
      name: APPROVED_HINDSIGHT_PACKAGE,
      packageRoot,
    });
    rmSync(packageRoot, { recursive: true, force: true });
  });

  it("accepts the exact package entry and never copies native options into Hindsight resolution", async () => {
    const readMetadata = vi.fn();

    await expect(
      resolveHindsightPlugin(
        { plugins: [{ package: APPROVED_HINDSIGHT_PACKAGE, options: { secret: "not copied" } }] },
        readMetadata,
      ),
    ).resolves.toEqual({
      packageName: APPROVED_HINDSIGHT_PACKAGE,
      pluginReference: APPROVED_HINDSIGHT_PACKAGE,
      runtimePaths: [],
      configurationPaths: [],
    });
    expect(readMetadata).not.toHaveBeenCalled();
  });

  it("validates an absolute entry through injected metadata", async () => {
    const readMetadata = vi.fn(() => approvedMetadata);

    await expect(
      resolveHindsightPlugin(
        { plugins: [{ package: "/Users/test/.hindsight/coding-agents", options: { arbitrary: true } }] },
        readMetadata,
      ),
    ).resolves.toEqual({
      packageName: APPROVED_HINDSIGHT_PACKAGE,
      pluginReference: "/Users/test/.hindsight/coding-agents",
      packageRoot: approvedMetadata.packageRoot,
      runtimePaths: [],
      configurationPaths: [],
    });
    expect(readMetadata).toHaveBeenCalledOnce();
  });

  it.each([
    "@vectorize-io/hindsight-coding-agents-extra",
    "/Users/test/.hindsight-like-plugin",
    "./hindsight-coding-agents",
  ])("rejects an unapproved Hindsight-like entry: %s", async (plugin) => {
    const readMetadata = vi.fn(() => ({ ...approvedMetadata, name: "other-package" }));
    await expect(resolveHindsightPlugin({ plugins: [plugin] }, readMetadata)).resolves.toBeUndefined();
  });

  it("does not copy native provider paths into the compatibility policy", async () => {
    const readMetadata = vi.fn(() => ({
      ...approvedMetadata,
      runtimePaths: ["/Users/test/.hindsight/../private"],
    }));

    await expect(
      resolveHindsightPlugin({ plugins: ["/Users/test/.hindsight/coding-agents"] }, readMetadata),
    ).resolves.toMatchObject({
      packageName: APPROVED_HINDSIGHT_PACKAGE,
      runtimePaths: [],
      configurationPaths: [],
    });
  });

  it("selects the first approved entry in declared order and never executes entries", async () => {
    const readMetadata = vi.fn((reference: string) =>
      reference === "/Users/test/approved" ? { ...approvedMetadata, packageRoot: reference } : undefined,
    );

    await expect(
      resolveHindsightPlugin(
        {
          plugins: [
            { package: "/Users/test/unapproved", options: { execute: true } },
            { package: "/Users/test/approved", options: { execute: true } },
            { package: APPROVED_HINDSIGHT_PACKAGE, options: { execute: true } },
          ],
        },
        readMetadata,
      ),
    ).resolves.toMatchObject({ pluginReference: "/Users/test/approved" });
    expect(readMetadata).toHaveBeenCalledTimes(2);
  });

  it("returns no provider for absent or malformed configuration", async () => {
    const readMetadata = vi.fn();
    await expect(resolveHindsightPlugin({}, readMetadata)).resolves.toBeUndefined();
    await expect(resolveHindsightPlugin({ plugins: [42, {}, [42]] as never }, readMetadata)).resolves.toBeUndefined();
    expect(readMetadata).not.toHaveBeenCalled();
  });
});
