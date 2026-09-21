import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { type AfCompatibilityInput, classifyAfCompatibility } from "../vibefeld/af-compatibility";
import { AF_DISCOVERY_ROOTS, type AfDiscoveryOptions, discoverAfExecutable } from "../vibefeld/af-discovery";

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const discoverySource = readSource("../vibefeld/af-discovery.ts");
const compatibilitySource = readSource("../vibefeld/af-compatibility.ts");
const extensionSource = readSource("../extension.ts");
const chatViewSource = readSource("../chat-view-provider.ts");
const chatPrompt = readSource("../../CHAT_SYSTEM.md");
const writePrompt = readSource("../../WRITE_SYSTEM.md");

const validVersionFacts = {
  version: "0.1.11",
  commit: "611291b",
  buildDate: "2026-09-21T00:24:48Z",
  goVersion: "go1.27.1",
  format: "1.1",
  policy: "0.1.9",
} as const;

const validCompatibilityInput = (): AfCompatibilityInput => ({
  platform: "darwin",
  architecture: "arm64",
  version: validVersionFacts,
  schema: {
    sections: {
      inference_types: 11,
      node_types: 5,
      workflow_states: 3,
      epistemic_states: 7,
      taint_states: 4,
      challenge_targets: 9,
    },
    totalEntries: 39,
  },
});

const discoveryOptions = (overrides: Partial<AfDiscoveryOptions> = {}) => {
  const stat = vi.fn<AfDiscoveryOptions["stat"]>();
  const access = vi.fn<AfDiscoveryOptions["access"]>();
  return {
    stat,
    access,
    options: {
      platform: "darwin",
      pathValue: "",
      candidateRoots: AF_DISCOVERY_ROOTS,
      stat,
      access,
      ...overrides,
    } satisfies AfDiscoveryOptions,
  };
};

describe("AF activation discovery security negatives", () => {
  it("keeps unsupported platforms dormant before inspecting candidates or attempting a process", () => {
    const { options, stat, access } = discoveryOptions({ platform: "win32" });
    const processAttempt = vi.fn();

    expect(discoverAfExecutable(options)).toEqual({ state: "unavailable", reason: "unsupported-platform" });
    expect(stat).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(processAttempt).not.toHaveBeenCalled();
  });

  it("keeps discovery and preflight free of process, network, VS Code, and write APIs", () => {
    for (const source of [discoverySource, compatibilitySource]) {
      expect(source).not.toMatch(/node:child_process|node:fs|from ["']vscode["']/u);
      expect(source).not.toMatch(/\b(?:spawn|exec|fetch)\s*\(/u);
      expect(source).not.toMatch(/\b(?:writeFile|writeFileSync|appendFile|mkdir|rm|unlink|createWriteStream)\s*\(/u);
    }
  });

  it("does not allocate proof or review-root storage and does not write configuration", () => {
    for (const source of [discoverySource, compatibilitySource]) {
      expect(source).not.toMatch(
        /ProofWorkspaceStore|proofWorkspace|reviewRoot|workspacePath|globalStorageUri|\ballocate\b|proof[-_ ]root/iu,
      );
      expect(source).not.toMatch(
        /configuration\.update|\bnono\b|profile path|pluginSources|mcpOverlay|config(?:uration)?[-_ ]file/iu,
      );
    }
  });

  it("keeps ordinary Chat and Write dormant until activation composition exists", () => {
    for (const source of [extensionSource, chatViewSource]) {
      expect(source).not.toMatch(/af-discovery|af-compatibility/iu);
    }
    for (const prompt of [chatPrompt, writePrompt]) {
      expect(prompt).not.toMatch(/\b(?:af|vibefeld)\b/iu);
    }
  });

  it.each([
    ["unsupported platform", { platform: "win32" }, "unsupported-platform"],
    ["unsupported architecture", { architecture: "riscv64" }, "unsupported-architecture"],
    ["missing version", { version: undefined }, "missing-version-facts"],
    ["missing schema", { schema: undefined }, "missing-schema-facts"],
    ["fixture-envelope version", { version: { fixtureSchema: "af-runtime-fixture-1" } }, "malformed-version-facts"],
    [
      "fixture-envelope schema",
      { schema: { fixtureSchema: "af-runtime-fixture-1", workspaceFormat: "1.0" } },
      "malformed-schema-facts",
    ],
    ["oversized evidence", { version: { ...validVersionFacts, commit: "x".repeat(257) } }, "oversized-evidence"],
    ["unsafe evidence", { version: { ...validVersionFacts, commit: "/private/capture" } }, "unsafe-evidence"],
  ] as const)("classifies %s through a bounded pure result without side effects", (_name, change, reason) => {
    const filesystemSeam = vi.fn();
    const processSeam = vi.fn();
    const result = classifyAfCompatibility({ ...validCompatibilityInput(), ...change } as AfCompatibilityInput);

    expect(result).toMatchObject({ state: "unavailable", reason });
    expect(JSON.stringify(result)).not.toMatch(/(?:path|output|spawn|workspace|proof|review)/iu);
    expect(filesystemSeam).not.toHaveBeenCalled();
    expect(processSeam).not.toHaveBeenCalled();
  });
});
