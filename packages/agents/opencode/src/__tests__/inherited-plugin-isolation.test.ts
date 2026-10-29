import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INHERITED_PLUGIN_CLASSIFICATION,
  inheritedPluginGateStatus,
  MAX_PLUGIN_PACKAGE_JSON_BYTES,
  readSelectedPluginMetadata,
} from "./inherited-plugin-lane.js";
import { createV2TestIsolation } from "./v2-test-isolation.js";

const identity = "@vectorize-io/hindsight-coding-agents";
const version = "1.2.3-fixture";
const source = "selected-disposable-fixture-root";
const isolations: Awaited<ReturnType<typeof createV2TestIsolation>>[] = [];

async function fixturePackage(metadata: Record<string, unknown> = { name: identity, version }) {
  const isolation = await createV2TestIsolation();
  isolations.push(isolation);
  const root = join(isolation.paths.home, "selected-plugin");
  await mkdir(root);
  await writeFile(join(root, "package.json"), JSON.stringify(metadata));
  return { isolation, root, selected: [{ root, source }] as const, expected: { identity, version, source } };
}

afterEach(async () => {
  for (const isolation of isolations.splice(0)) await isolation.dispose();
});

describe("inherited plugin metadata-only lane", () => {
  it("uses owned hermetic state and accepts explicit nonempty identity/source/version metadata only", async () => {
    const { isolation, selected, expected } = await fixturePackage();
    expect(isolation.runtimeEvidence).toBe("NOT_RUN");
    expect(isolation.environment).not.toHaveProperty("PATH");
    const records = await readSelectedPluginMetadata(selected, expected);
    expect(records).toEqual([
      {
        identity,
        version,
        source,
        rootRelativeIdentity: "package.json",
        classification: INHERITED_PLUGIN_CLASSIFICATION,
      },
    ]);
    expect(records[0]?.classification).not.toBe("INHERITED_PLUGIN_RUNTIME_PASS");
  });

  it("rejects missing roots and empty expected identity, version, or source", async () => {
    const fixture = await fixturePackage();
    await expect(readSelectedPluginMetadata([], fixture.expected)).rejects.toThrow(/required/);
    for (const field of ["identity", "version", "source"] as const) {
      await expect(readSelectedPluginMetadata(fixture.selected, { ...fixture.expected, [field]: " " })).rejects.toThrow(
        /required/,
      );
    }
  });

  it("rejects mismatched identity, exact version, and source provenance", async () => {
    const fixture = await fixturePackage();
    await expect(
      readSelectedPluginMetadata(fixture.selected, { ...fixture.expected, identity: "wrong" }),
    ).rejects.toThrow(/does not match/);
    await expect(
      readSelectedPluginMetadata(fixture.selected, { ...fixture.expected, version: "1.2.4" }),
    ).rejects.toThrow(/does not match/);
    await expect(
      readSelectedPluginMetadata([{ ...fixture.selected[0], source: "other" }], fixture.expected),
    ).rejects.toThrow(/does not match/);
  });

  it("rejects malformed, oversized, traversal-like, duplicate, and symlinked selections", async () => {
    const fixture = await fixturePackage();
    await writeFile(join(fixture.selected[0].root, "package.json"), "{");
    await expect(readSelectedPluginMetadata(fixture.selected, fixture.expected)).rejects.toThrow(/malformed/);
    await writeFile(join(fixture.selected[0].root, "package.json"), " ".repeat(MAX_PLUGIN_PACKAGE_JSON_BYTES + 1));
    await expect(readSelectedPluginMetadata(fixture.selected, fixture.expected)).rejects.toThrow(/size bound/);
    await expect(
      readSelectedPluginMetadata(
        [{ root: `${fixture.selected[0].root}/../selected-plugin`, source }],
        fixture.expected,
      ),
    ).rejects.toThrow(/traversal/);
    await writeFile(join(fixture.selected[0].root, "package.json"), JSON.stringify({ name: identity, version }));
    await expect(
      readSelectedPluginMetadata([...fixture.selected, ...fixture.selected], fixture.expected),
    ).rejects.toThrow(/Duplicate/);
    const link = join(fixture.isolation.paths.home, "plugin-link");
    await symlink(fixture.selected[0].root, link, "dir");
    await expect(readSelectedPluginMetadata([{ root: link, source }], fixture.expected)).rejects.toThrow(
      /real directory/,
    );
  });

  it("does not evaluate package code and keeps unresolved host prerequisites blocked", async () => {
    const fixture = await fixturePackage({
      name: identity,
      version,
      main: "sentinel.js",
      scripts: { postinstall: "touch executed" },
    });
    await writeFile(join(fixture.selected[0].root, "sentinel.js"), 'throw new Error("executed")');
    await readSelectedPluginMetadata(fixture.selected, fixture.expected);
    expect(
      inheritedPluginGateStatus({
        vscodeExecutable: false,
        backendWorkspace: false,
        hindsightInjection: false,
        disposableProviderRetention: false,
        soakAgreement: false,
      }),
    ).toEqual({
      vscodeExecutable: "BLOCKED",
      backendWorkspace: "BLOCKED",
      hindsightInjection: "BLOCKED",
      disposableProviderRetention: "BLOCKED",
      soakAgreement: "BLOCKED",
    });
    expect(fixture.isolation.runtimeEvidence).toBe("NOT_RUN");
  });
});
