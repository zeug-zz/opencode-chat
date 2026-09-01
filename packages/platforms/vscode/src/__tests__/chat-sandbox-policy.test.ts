import { describe, expect, it } from "vitest";
import {
  buildChatSandboxFilesystemPolicy,
  buildChatSandboxNetworkPolicy,
  MACOS_MACH_LOOKUP_SERVICES,
  resolveOpenCodePaths,
  resolveRuntimeCachePaths,
} from "../chat-sandbox-policy";

describe("buildChatSandboxNetworkPolicy", () => {
  it.each([true, false])("adds only the required macOS Mach lookups with allowNetwork=%s", (allowNetwork) => {
    const policy = buildChatSandboxNetworkPolicy({ allowNetwork, platform: "darwin" });

    expect(policy.allowMachLookup).toEqual([...MACOS_MACH_LOOKUP_SERVICES]);
    expect(policy.allowMachLookup).not.toContain("com.apple.analyticsd");
    expect(policy.allowMachLookup?.some((service) => service.includes("*"))).toBe(false);
    expect(policy.allowedDomains).toEqual(allowNetwork ? [] : ["localhost", "127.0.0.1"]);
    expect(policy.deniedDomains).toEqual([]);
  });

  it.each(["linux", "win32"] as const)("does not add macOS Mach lookups on %s", (platform) => {
    const policy = buildChatSandboxNetworkPolicy({ allowNetwork: true, platform });

    expect(policy.allowMachLookup).toEqual([]);
    expect(policy).not.toHaveProperty("allowMachLookup", expect.arrayContaining(MACOS_MACH_LOOKUP_SERVICES));
  });
});

describe("resolveOpenCodePaths", () => {
  it("uses XDG overrides", () => {
    expect(
      resolveOpenCodePaths(
        {
          XDG_CONFIG_HOME: "/xdg/config",
          XDG_DATA_HOME: "/xdg/data",
          XDG_CACHE_HOME: "/xdg/cache",
          XDG_STATE_HOME: "/xdg/state",
          TMPDIR: "/tmp/runtime",
        },
        "/home/tester",
      ),
    ).toEqual({
      config: "/xdg/config/opencode",
      state: "/xdg/data/opencode",
      cache: "/xdg/cache/opencode",
      temp: "/tmp/runtime/opencode",
    });
  });

  it("uses home-directory defaults and falls back for empty XDG values", () => {
    expect(resolveOpenCodePaths({}, "/home/tester")).toEqual({
      config: "/home/tester/.config/opencode",
      state: "/home/tester/.local/share/opencode",
      cache: "/home/tester/.cache/opencode",
      temp: expect.stringMatching(/\/opencode$/),
    });
    expect(
      resolveOpenCodePaths(
        {
          XDG_CONFIG_HOME: "",
          XDG_DATA_HOME: "",
          XDG_CACHE_HOME: "",
          XDG_STATE_HOME: "",
        },
        "/home/tester",
      ),
    ).toEqual(resolveOpenCodePaths({}, "/home/tester"));
  });
});

describe("buildChatSandboxFilesystemPolicy", () => {
  it("keeps workspace and OpenCode data paths writable while config is read-only", () => {
    const openCodePaths = resolveOpenCodePaths({}, "/home/tester");
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/home/tester",
      openCodePaths,
      executablePath: "/usr/local/bin/opencode",
    });

    expect(policy.readWritePaths).toEqual(
      expect.arrayContaining(["/workspace/project", openCodePaths.state, openCodePaths.cache, openCodePaths.temp]),
    );
    expect(policy.readOnlyPaths).toEqual(expect.arrayContaining([openCodePaths.config, "/usr/local/bin/opencode"]));
    expect(policy.readWritePaths).not.toContain(openCodePaths.config);
    expect(policy.readWritePaths).not.toContain("/home/tester");
    expect(policy.readOnlyPaths).not.toContain("/home/tester");
    expect(policy.readWritePaths).not.toContain("/home/tester/.ssh");
    expect(policy.readOnlyPaths).not.toContain("/home/tester/.ssh");
    expect(policy.denyReadPaths).toContain("/home/tester/.ssh");
  });

  it("keeps compatibility policy global without MCP-specific filesystem paths", () => {
    const paths = resolveOpenCodePaths({}, "/home/tester");
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/home/tester",
      openCodePaths: paths,
    });

    expect(policy.readWritePaths).toEqual(
      expect.arrayContaining(["/workspace/project", paths.state, paths.cache, paths.temp]),
    );
    expect(policy.readWritePaths).not.toContain("/home/tester");
    expect(policy.denyReadPaths).toContain("/home/tester/.aws");
    expect(policy.readWritePaths).not.toContain("/workspace/project/.mcp/local-server");
    expect(policy.readOnlyPaths).not.toContain("/workspace/project/.mcp/local-server");
    expect(() =>
      buildChatSandboxFilesystemPolicy({
        workspacePath: "/workspace/project",
        homePath: "/home/tester",
        openCodePaths: { state: "/home/tester" },
      }),
    ).toThrow(/home-directory root/);
    expect(() =>
      buildChatSandboxFilesystemPolicy({
        workspacePath: "/workspace/project",
        homePath: "/home/tester",
        openCodePaths: { state: "/home/tester/.ssh" },
      }),
    ).toThrow(/credential-store/);
  });

  it("allows compatibility reads without a home deny rule or MCP-specific read grant", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/home/tester",
    });

    expect(policy.denyReadPaths).toContain("/home/tester/.gnupg");
    expect(policy.readOnlyPaths).toEqual([]);
    expect(policy.readWritePaths).toEqual(["/workspace/project"]);
    expect(policy.readWritePaths).not.toContain("/home/tester");
    expect(policy.readWritePaths).not.toContain("/home/tester/.npm");
  });

  it("preserves runtime cache and temporary write paths while excluding unrelated paths", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/home/tester",
      openCodePaths: {
        state: "/home/tester/.local/share/opencode",
        cache: "/home/tester/.cache/opencode",
        temp: "/home/tester/.cache/opencode/tmp",
      },
      runtimeCachePaths: ["/home/tester/.npm", "/home/tester/.cache/uv"],
      temporaryPaths: ["/var/folders/chat-runtime", "/workspace/project/.tmp"],
    });

    expect(policy.readWritePaths).toEqual(
      expect.arrayContaining([
        "/workspace/project",
        "/home/tester/.local/share/opencode",
        "/home/tester/.cache/opencode",
        "/home/tester/.cache/opencode/tmp",
        "/home/tester/.npm",
        "/home/tester/.cache/uv",
        "/var/folders/chat-runtime",
        "/workspace/project/.tmp",
      ]),
    );
    expect(policy.readWritePaths).not.toContain("/home/tester/Documents");
    expect(policy.readWritePaths).not.toContain("/home/tester/.ssh");
  });

  it.each([".ssh", ".aws", ".gnupg", "keychains"])("rejects credential-store writes under %s", (store) => {
    expect(() =>
      buildChatSandboxFilesystemPolicy({
        workspacePath: "/workspace/project",
        homePath: "/home/tester",
        temporaryPaths: [`/home/tester/${store}/write-target`],
      }),
    ).toThrow(/credential-store/);
  });

  it("rejects an exact protected deny/read-grant match", () => {
    expect(() =>
      buildChatSandboxFilesystemPolicy({
        workspacePath: "/workspace/project",
        homePath: "/Users/tester",
        executablePath: "/Library/Keychains",
        platform: "darwin",
      }),
    ).toThrow(/deny-read path.*read-only.*\/Library\/Keychains/);
  });

  it("rejects a required read grant beneath a protected deny path", () => {
    expect(() =>
      buildChatSandboxFilesystemPolicy({
        workspacePath: "/workspace/project",
        homePath: "/Users/tester",
        executablePath: "/Library/Keychains/login.keychain-db",
        platform: "darwin",
      }),
    ).toThrow(/deny-read path.*read-only.*\/Library\/Keychains/);
  });

  it("rejects a required read grant containing a protected deny path", () => {
    expect(() =>
      buildChatSandboxFilesystemPolicy({
        workspacePath: "/Library",
        homePath: "/Users/tester",
        platform: "darwin",
      }),
    ).toThrow(/deny-read path.*filesystem policy path.*\/Library/);
  });

  it("allows context-mode children beneath the derived macOS per-user temporary root", () => {
    const temporaryPath = "/var/folders/ab/0123456789abcdef/T/opencode";
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/Users/tester",
      openCodePaths: { temp: temporaryPath },
      platform: "darwin",
    });

    expect(policy.readWritePaths).toContain("/var/folders/ab/0123456789abcdef/T");
    expect(policy.readWritePaths).toContain(temporaryPath);
    expect(policy.readWritePaths).not.toContain("/tmp");
    expect(policy.readWritePaths).not.toContain("/private/tmp");
    expect(policy.readWritePaths).not.toContain("/Users/tester");
    expect(policy.readWritePaths).not.toContain("/Users/tester/Library/Keychains");
  });

  it.each([
    "/tmp/opencode",
    "/private/tmp/opencode",
    "/var/folders/ab/0123456789abcdef/cache/opencode",
  ])("does not derive a broad or arbitrary temporary parent from %s", (temporaryPath) => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/Users/tester",
      openCodePaths: { temp: temporaryPath },
      platform: "darwin",
    });

    expect(policy.readWritePaths).not.toContain("/tmp");
    expect(policy.readWritePaths).not.toContain("/private/tmp");
    expect(policy.readWritePaths).not.toContain("/var/folders/ab/0123456789abcdef/cache");
  });

  it("normalizes policy paths before applying write constraints", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project/./nested/..",
      homePath: "/home/tester/./",
      openCodePaths: {
        state: "/home/tester/.local/share/../share/opencode",
      },
      temporaryPaths: ["/workspace/project/cache/../tmp", "/workspace/project/tmp"],
    });

    expect(policy.readWritePaths).toEqual([
      "/home/tester/.local/share/opencode",
      "/workspace/project",
      "/workspace/project/tmp",
    ]);
  });

  it("derives Windows configuration and temporary paths without granting the profile root", () => {
    const paths = resolveOpenCodePaths(
      {
        APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        TEMP: "C:\\Temp",
      },
      "C:\\Users\\tester",
      "win32",
    );

    expect(paths).toEqual({
      config: "C:\\Users\\tester\\AppData\\Roaming\\opencode",
      state: "C:\\Users\\tester\\AppData\\Local\\opencode",
      cache: "C:\\Users\\tester\\AppData\\Local\\opencode",
      temp: "C:\\Temp\\opencode",
    });
  });

  it("constructs the Windows policy with normalized constrained writes and broad reads", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "C:\\work\\project\\.",
      homePath: "C:\\Users\\tester",
      openCodePaths: {
        config: "C:\\Users\\tester\\AppData\\Roaming\\opencode\\..\\opencode",
        state: "C:\\Users\\tester\\AppData\\Local\\opencode",
      },
      runtimeCachePaths: ["C:\\Users\\tester\\AppData\\Local\\npm-cache"],
      platform: "win32",
    });

    expect(policy.readWritePaths).toEqual([
      "C:\\Users\\tester\\AppData\\Local\\npm-cache",
      "C:\\Users\\tester\\AppData\\Local\\opencode",
      "C:\\work\\project",
    ]);
    expect(policy.readOnlyPaths).toEqual(["C:\\Users\\tester\\AppData\\Roaming\\opencode"]);
    expect(policy.denyReadPaths).toEqual([]);
    expect(policy.readWritePaths).not.toContain("C:\\Users\\tester");
  });

  it("constructs the normalized macOS static read-deny baseline", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/Users/tester/./",
      platform: "darwin",
    });

    expect(policy.denyReadPaths).toEqual([...policy.denyReadPaths].sort((left, right) => left.localeCompare(right)));
    expect(new Set(policy.denyReadPaths).size).toBe(policy.denyReadPaths.length);
    expect(policy.denyReadPaths).toEqual(
      expect.arrayContaining([
        "/Users/tester/.ssh",
        "/Users/tester/.config/gcloud",
        "/Users/tester/.zsh_history",
        "/Users/tester/Library/Keychains",
        "/Library/Keychains",
        "/Users/tester/Library/Application Support/Google/Chrome",
        "/Users/tester/Library/Messages",
      ]),
    );
    expect(policy.denyReadPaths).not.toContain("/Users/tester/.local/share/keyrings");
  });

  it("constructs the Linux baseline without macOS-exclusive paths", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/home/tester",
      platform: "linux",
    });

    expect(policy.denyReadPaths).toEqual(
      expect.arrayContaining([
        "/home/tester/.ssh",
        "/home/tester/.password-store",
        "/home/tester/.local/share/keyrings",
        "/home/tester/.config/google-chrome",
        "/home/tester/.mozilla/firefox",
      ]),
    );
    expect(policy.denyReadPaths).not.toContain("/home/tester/Library/Keychains");
    expect(policy.denyReadPaths).not.toContain("/Library/Keychains");
    expect(policy.denyReadPaths).not.toContain("/home/tester/Library/Messages");
  });
});

describe("resolveRuntimeCachePaths", () => {
  it("derives POSIX npm and uv defaults without allowing the home root", () => {
    expect(resolveRuntimeCachePaths({}, "/home/tester", "linux")).toEqual([
      "/home/tester/.cache/uv",
      "/home/tester/.config/opencode/context-mode/sessions",
      "/home/tester/.local/share/uv",
      "/home/tester/.local/state/opencode",
      "/home/tester/.npm",
    ]);
  });

  it("derives macOS UV application-support and cache paths", () => {
    const paths = resolveRuntimeCachePaths({}, "/Users/tester", "darwin");

    expect(paths).toEqual([
      "/Users/tester/.cache/uv",
      "/Users/tester/.config/opencode/context-mode/sessions",
      "/Users/tester/.local/share/uv",
      "/Users/tester/.local/state/opencode",
      "/Users/tester/.npm",
      "/Users/tester/Library/Application Support/uv",
      "/Users/tester/Library/Caches/uv",
    ]);
    expect(paths).not.toContain("/Users/tester");
  });

  it.each([
    ["linux", "/home/tester", ["/home/tester/.cache/uv", "/home/tester/.local/share/uv", "/home/tester/.npm"]],
    [
      "darwin",
      "/Users/tester",
      [
        "/Users/tester/.local/share/uv",
        "/Users/tester/.npm",
        "/Users/tester/.cache/uv",
        "/Users/tester/Library/Application Support/uv",
        "/Users/tester/Library/Caches/uv",
      ],
    ],
  ] as const)("passes derived %s runtime paths through the filesystem policy", (platform, homePath, runtimePaths) => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath,
      runtimeCachePaths: resolveRuntimeCachePaths({}, homePath, platform),
      platform,
    });

    expect(policy.readWritePaths).toEqual(expect.arrayContaining(runtimePaths));
    expect(policy.readWritePaths).not.toContain(homePath);
    expect(policy.readOnlyPaths).not.toContain(homePath);
  });

  it("honors XDG and UV runtime overrides without granting the home root", () => {
    expect(
      resolveRuntimeCachePaths(
        {
          XDG_DATA_HOME: "/xdg/data",
          XDG_CACHE_HOME: "/xdg/cache",
          UV_CACHE_DIR: "/uv/cache",
          npm_config_cache: "/npm/cache",
        },
        "/home/tester",
        "linux",
      ),
    ).toEqual([
      "/home/tester/.config/opencode/context-mode/sessions",
      "/home/tester/.local/state/opencode",
      "/npm/cache",
      "/uv/cache",
      "/xdg/data/uv",
    ]);
    expect(
      resolveRuntimeCachePaths(
        {
          XDG_CONFIG_HOME: "/xdg/config",
          XDG_DATA_HOME: "/xdg/data",
          XDG_CACHE_HOME: "/xdg/cache",
          XDG_STATE_HOME: "/xdg/state",
        },
        "/Users/tester",
        "darwin",
      ),
    ).toEqual([
      "/Users/tester/.npm",
      "/xdg/cache/uv",
      "/xdg/config/opencode/context-mode/sessions",
      "/xdg/data/uv",
      "/xdg/state/opencode",
    ]);
  });

  it("includes exact OpenCode and context-mode paths in the policy without home-root grants", () => {
    const runtimePaths = resolveRuntimeCachePaths({}, "/home/tester", "linux");
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath: "/home/tester",
      runtimeCachePaths: runtimePaths,
      platform: "linux",
    });

    expect(policy.readWritePaths).toEqual(
      expect.arrayContaining([
        "/home/tester/.local/state/opencode",
        "/home/tester/.config/opencode/context-mode/sessions",
      ]),
    );
    expect(policy.readWritePaths).not.toContain("/home/tester");
    expect(policy.readWritePaths).not.toContain("/home/tester/.config/opencode");
    expect(policy.readWritePaths).not.toContain("/home/tester/.ssh");
  });

  it("derives Windows cache defaults and preserves explicit overrides", () => {
    expect(
      resolveRuntimeCachePaths({ LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }, "C:\\Users\\tester", "win32"),
    ).toEqual(["C:\\Users\\tester\\AppData\\Local\\npm-cache", "C:\\Users\\tester\\AppData\\Local\\uv\\cache"]);
    expect(
      resolveRuntimeCachePaths(
        {
          npm_config_cache: "C:\\cache\\npm",
          NPM_CONFIG_CACHE: "C:\\cache\\npm",
          UV_CACHE_DIR: "C:\\cache\\uv",
        },
        "C:\\Users\\tester",
        "win32",
      ),
    ).toEqual(["C:\\cache\\npm", "C:\\cache\\uv"]);
  });

  it("does not add POSIX OpenCode runtime-state grants on Windows", () => {
    expect(
      resolveRuntimeCachePaths(
        {
          APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
          LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        },
        "C:\\Users\\tester",
        "win32",
      ),
    ).toEqual(["C:\\Users\\tester\\AppData\\Local\\npm-cache", "C:\\Users\\tester\\AppData\\Local\\uv\\cache"]);
  });
});
