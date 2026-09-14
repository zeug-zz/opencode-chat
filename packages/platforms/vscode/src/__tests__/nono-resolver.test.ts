import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNonoBackendResolutionCache, discoverNonoProfiles, resolveNonoBackend } from "../nono-resolver";

const executable = "/opt/homebrew/bin/nono";
const listing =
  "nono profile: 2 profiles\n\n  Built-in:\n    default\n\n  User (/home/test/.config/nono/profiles):\n    opencode-local       extends opencode\n    unsafe/name          invalid\n";

function execFor(...args: unknown[]) {
  const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
  const command = args[1] as string[];
  callback(null, command[1] === "list" ? listing : "nono 1.0.0", "policy contents must not escape");
}

describe("nono profile discovery and resolution", () => {
  beforeEach(() => clearNonoBackendResolutionCache());

  it("discovers only safe user profile names through nono introspection", async () => {
    const execFile = vi.fn(execFor);
    await expect(
      discoverNonoProfiles({
        platform: "darwin",
        env: { NONO_BIN: executable, XDG_CONFIG_HOME: "/home/test/.config" },
        access: vi.fn(),
        readDirectory: vi.fn(() => ["opencode-local.json", "unsafe-name.json", "not-a-profile.txt"]),
        homedir: vi.fn(() => "/home/test"),
        execFile,
      }),
    ).resolves.toEqual(["opencode-local"]);
    expect(execFile).toHaveBeenCalledWith(
      executable,
      ["profile", "list"],
      expect.objectContaining({ timeout: 1_500, maxBuffer: 4_096 }),
      expect.any(Function),
    );
  });

  it("reads only the documented XDG/default profile directory", async () => {
    const readDirectory = vi.fn(() => ["opencode-local.json"]);
    await discoverNonoProfiles({
      platform: "linux",
      env: { NONO_BIN: executable },
      access: vi.fn(),
      readDirectory,
      homedir: vi.fn(() => "/home/test"),
      execFile: vi.fn(execFor),
    });
    expect(readDirectory).toHaveBeenCalledWith("/home/test/.config/nono/profiles");
  });

  it("uses the configured XDG profile directory when it is absolute", async () => {
    const readDirectory = vi.fn(() => ["opencode-local.json"]);
    await discoverNonoProfiles({
      platform: "linux",
      env: { NONO_BIN: executable, XDG_CONFIG_HOME: "/custom/config" },
      access: vi.fn(),
      readDirectory,
      homedir: vi.fn(() => "/home/test"),
      execFile: vi.fn(execFor),
    });
    expect(readDirectory).toHaveBeenCalledWith("/custom/config/nono/profiles");
  });

  it("falls back without probing when the profile directory is missing or malformed", async () => {
    const execFile = vi.fn(execFor);
    await expect(
      resolveNonoBackend(true, {
        platform: "linux",
        env: { NONO_BIN: executable },
        selectedProfile: "opencode-local",
        access: vi.fn(),
        readDirectory: vi.fn(() => {
          throw new Error("missing profile directory");
        }),
        homedir: vi.fn(() => "/home/test"),
        execFile,
      }),
    ).resolves.toMatchObject({ backend: "vscode" });
    expect(execFile).not.toHaveBeenCalledWith(
      executable,
      ["profile", "show", "opencode-local"],
      expect.anything(),
      expect.anything(),
    );

    clearNonoBackendResolutionCache();
    await expect(
      resolveNonoBackend(true, {
        platform: "linux",
        env: { NONO_BIN: executable },
        selectedProfile: "opencode-local",
        access: vi.fn(),
        readDirectory: vi.fn(() => ["malformed.json", "../escape.json", "unsafe/name.json"]),
        homedir: vi.fn(() => "/home/test"),
        execFile,
      }),
    ).resolves.toMatchObject({ backend: "vscode" });
    expect(execFile).not.toHaveBeenCalledWith(
      executable,
      ["profile", "show", "opencode-local"],
      expect.anything(),
      expect.anything(),
    );
  });

  it("defaults to the built-in opencode profile without auto-selecting a custom profile", async () => {
    const execFile = vi.fn(execFor);
    await expect(
      resolveNonoBackend(true, {
        platform: "linux",
        env: { NONO_BIN: executable },
        access: vi.fn(),
        readDirectory: vi.fn(() => ["opencode-local.json"]),
        homedir: vi.fn(() => "/home/test"),
        execFile,
      }),
    ).resolves.toMatchObject({ backend: "nono", profile: "opencode" });
    expect(execFile).toHaveBeenCalledWith(
      executable,
      ["profile", "show", "opencode"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("preflights only an explicitly selected discovered profile", async () => {
    const execFile = vi.fn(execFor);
    await expect(
      resolveNonoBackend(true, {
        platform: "darwin",
        env: { NONO_BIN: executable },
        selectedProfile: "opencode-local",
        access: vi.fn(),
        readDirectory: vi.fn(() => ["opencode-local.json"]),
        homedir: vi.fn(() => "/home/test"),
        execFile,
      }),
    ).resolves.toMatchObject({ backend: "nono", profile: "opencode-local" });
    expect(execFile).toHaveBeenCalledWith(
      executable,
      ["profile", "show", "opencode-local"],
      expect.objectContaining({ timeout: 1_500, maxBuffer: 4_096 }),
      expect.any(Function),
    );
  });

  it("rejects an invalid selection before executable or profile discovery", async () => {
    const access = vi.fn();
    const readDirectory = vi.fn();
    const execFile = vi.fn(execFor);

    await expect(
      resolveNonoBackend(true, {
        platform: "darwin",
        env: { NONO_BIN: executable },
        selectedProfile: "unsafe/profile",
        access,
        readDirectory,
        execFile,
      }),
    ).resolves.toMatchObject({ backend: "vscode" });
    expect(access).not.toHaveBeenCalled();
    expect(readDirectory).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("caches the complete selected-profile decision for reconnects", async () => {
    const execFile = vi.fn(execFor);
    const options = {
      platform: "darwin" as const,
      env: { NONO_BIN: executable },
      selectedProfile: "opencode-local",
      access: vi.fn(),
      readDirectory: vi.fn(() => ["opencode-local.json"]),
      homedir: vi.fn(() => "/home/test"),
      execFile,
    };

    const first = await resolveNonoBackend(true, options);
    const second = await resolveNonoBackend(true, options);

    expect(second).toEqual(first);
    expect(second).toMatchObject({ backend: "nono", executablePath: executable, profile: "opencode-local" });
    expect(execFile).toHaveBeenCalledTimes(3);
  });

  it("degrades safely on Windows and sandbox-off without probing", async () => {
    const access = vi.fn();
    const execFile = vi.fn(execFor);
    await expect(
      resolveNonoBackend(true, { platform: "win32", env: { NONO_BIN: "C:\\nono.exe" }, access, execFile }),
    ).resolves.toMatchObject({ backend: "vscode" });
    await expect(
      resolveNonoBackend(false, { platform: "darwin", env: { NONO_BIN: executable }, access, execFile }),
    ).resolves.toMatchObject({ backend: "sdk" });
    expect(access).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });
});
