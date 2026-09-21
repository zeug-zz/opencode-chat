import { describe, expect, it, vi } from "vitest";
import { AF_DISCOVERY_ROOTS, type AfDiscoveryOptions, discoverAfExecutable } from "../vibefeld/af-discovery";

const makeDiscovery = (
  files: Record<
    string,
    { isFile?: boolean; ownedByHost?: boolean; access?: "executable" | "not-executable" | "denied" }
  >,
  overrides: Partial<AfDiscoveryOptions> = {},
) => {
  const stat = vi.fn((candidate: string) => {
    const file = files[candidate];
    return file ? { isFile: file.isFile ?? true, ownedByHost: file.ownedByHost ?? true } : undefined;
  });
  const access = vi.fn((candidate: string) => files[candidate]?.access ?? "executable");
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

describe("AF host-owned discovery", () => {
  it("finds a host-owned executable in deterministic fixed-root order", () => {
    const { options } = makeDiscovery({ "/usr/local/bin/af": {} });
    expect(discoverAfExecutable(options)).toEqual({ state: "found", executable: "/usr/local/bin/af" });
  });

  it("uses PATH only after fixed candidate roots", () => {
    const { options, stat } = makeDiscovery({ "/custom/bin/af": {} }, { pathValue: "/custom/bin" });
    expect(discoverAfExecutable(options)).toEqual({ state: "found", executable: "/custom/bin/af" });
    expect(stat.mock.calls.at(-1)?.[0]).toBe("/custom/bin/af");
  });

  it.each([
    ["absent", {}, "absent"],
    ["not executable", { "/usr/bin/af": { access: "not-executable" as const } }, "not-executable"],
    ["not owned", { "/usr/bin/af": { ownedByHost: false } }, "not-owned"],
  ] as const)("returns dormant unavailable for %s", (_name, files, reason) => {
    const { options } = makeDiscovery(files);
    expect(discoverAfExecutable(options)).toEqual({ state: "unavailable", reason });
  });

  it("fails closed when fixed roots and PATH contain distinct candidates", () => {
    const { options } = makeDiscovery({ "/usr/bin/af": {}, "/custom/bin/af": {} }, { pathValue: "/custom/bin" });
    expect(discoverAfExecutable(options)).toEqual({ state: "unavailable", reason: "ambiguous" });
  });

  it("stays dormant on unsupported platforms without inspecting candidates", () => {
    const { options, stat, access } = makeDiscovery({}, { platform: "win32" });
    expect(discoverAfExecutable(options)).toEqual({ state: "unavailable", reason: "unsupported-platform" });
    expect(stat).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
  });

  it("has no model-supplied executable, path, environment, or argv input", () => {
    const { options, stat } = makeDiscovery({}, { pathValue: "" });
    const modelInput = { executable: "/model/af", path: "/model", environment: { PATH: "/model" }, argv: ["--unsafe"] };
    expect(discoverAfExecutable({ ...options, ...modelInput } as AfDiscoveryOptions)).toEqual({
      state: "unavailable",
      reason: "absent",
    });
    expect(stat).toHaveBeenCalledTimes(AF_DISCOVERY_ROOTS.length);
  });

  it("does not expose paths in dormant failure reasons or perform side effects", () => {
    const stat = vi.fn(() => ({ isFile: true, ownedByHost: false }));
    const access = vi.fn<AfDiscoveryOptions["access"]>();
    const options: AfDiscoveryOptions = {
      platform: "linux",
      pathValue: "/private/host/path",
      candidateRoots: ["/private/fixed/root"],
      stat,
      access,
    };
    const result = discoverAfExecutable(options);
    expect(result).toEqual({ state: "unavailable", reason: "not-owned" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(access).not.toHaveBeenCalled();
  });
});
