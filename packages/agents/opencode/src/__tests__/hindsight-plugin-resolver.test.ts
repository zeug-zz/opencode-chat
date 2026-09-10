import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_HINDSIGHT_PACKAGE,
  type HindsightPackageMetadata,
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

  it("accepts the exact package entry and strips tuple options", async () => {
    const readMetadata = vi.fn();

    await expect(
      resolveHindsightPlugin({ plugin: [[APPROVED_HINDSIGHT_PACKAGE, { secret: "not copied" }]] }, readMetadata),
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
      resolveHindsightPlugin({ plugin: [["/Users/test/.hindsight/coding-agents", { arbitrary: true }]] }, readMetadata),
    ).resolves.toEqual({
      packageName: APPROVED_HINDSIGHT_PACKAGE,
      pluginReference: "/Users/test/.hindsight/coding-agents",
      packageRoot: approvedMetadata.packageRoot,
      runtimePaths: ["/Users/test/.hindsight/coding-agents/runtime"],
      configurationPaths: ["/Users/test/.hindsight/config.json"],
    });
    expect(readMetadata).toHaveBeenCalledOnce();
  });

  it.each([
    "@vectorize-io/hindsight-coding-agents-extra",
    "/Users/test/.hindsight-like-plugin",
    "./hindsight-coding-agents",
  ])("rejects an unapproved Hindsight-like entry: %s", async (plugin) => {
    const readMetadata = vi.fn(() => ({ ...approvedMetadata, name: "other-package" }));
    await expect(resolveHindsightPlugin({ plugin: [plugin] }, readMetadata)).resolves.toBeUndefined();
  });

  it("rejects invalid metadata and unsafe paths without guessing", async () => {
    const readMetadata = vi.fn(() => ({
      ...approvedMetadata,
      runtimePaths: ["/Users/test/.hindsight/../private"],
    }));

    await expect(
      resolveHindsightPlugin({ plugin: ["/Users/test/.hindsight/coding-agents"] }, readMetadata),
    ).resolves.toBeUndefined();
  });

  it("selects the first approved entry in declared order and never executes entries", async () => {
    const readMetadata = vi.fn((reference: string) =>
      reference === "/Users/test/approved" ? { ...approvedMetadata, packageRoot: reference } : undefined,
    );

    await expect(
      resolveHindsightPlugin(
        {
          plugin: [
            ["/Users/test/unapproved", { execute: true }],
            ["/Users/test/approved", { execute: true }],
            [APPROVED_HINDSIGHT_PACKAGE, { execute: true }],
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
    await expect(resolveHindsightPlugin({ plugin: [42, {}, [42]] }, readMetadata)).resolves.toBeUndefined();
    expect(readMetadata).not.toHaveBeenCalled();
  });
});
