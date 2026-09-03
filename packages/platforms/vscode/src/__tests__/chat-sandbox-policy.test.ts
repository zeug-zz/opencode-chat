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
  const homePath = "/home/tester";
  const crossPlatformDenyReadPaths = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".config/gcloud",
    ".gcloud",
    ".kube",
    ".docker",
    ".git-credentials",
    ".netrc",
    ".npmrc",
    ".bunfig.toml",
    ".config/bun/bunfig.toml",
    ".vault-token",
    ".credentials",
    ".secrets",
    ".keys",
    ".pki",
    ".terraform.d",
    ".config/op",
    ".claude.json",
    ".claude/.credentials.json",
    ".codex/auth.json",
    ".gemini/oauth_creds.json",
    ".electrum",
    ".android/adbkey",
    ".android/adbkey.pub",
    ".bash_history",
    ".zsh_history",
    ".history",
    ".python_history",
    ".zshrc",
    ".zprofile",
    ".zshenv",
    ".zlogin",
    ".zlogout",
    ".bashrc",
    ".bash_profile",
    ".bash_login",
    ".bash_logout",
    ".profile",
    ".config/fish",
    ".env",
    ".envrc",
    ".config/gh/hosts.yml",
    ".config/glab-cli/config.yml",
    ".config/rclone/rclone.conf",
    ".config/containers/auth.json",
    ".pypirc",
    ".cargo/credentials",
    ".cargo/credentials.toml",
    ".config/sops/age/keys.txt",
    ".config/age/keys.txt",
    ".local/share/fish/fish_history",
    ".config/atuin",
    ".config/nushell",
    ".local/share/nushell",
    ".zsh_sessions",
    ".bash_sessions",
  ];
  const macosDenyReadPaths = [
    "Library/Keychains",
    "/Library/Keychains",
    ".password-store",
    ".1password",
    "Library/Group Containers/2BUA8C4S2C.com.1password",
    "Library/Application Support/1Password",
    "Library/Containers/com.1password.1password",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Chromium",
    "Library/Application Support/Firefox",
    "Library/Application Support/Microsoft Edge",
    "Library/Application Support/Arc",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Vivaldi",
    "Library/Application Support/com.operasoftware.Opera",
    "Library/Safari",
    "Library/Messages",
    "Library/Mail",
    "Library/Cookies",
    "Library/Containers/com.apple.Safari",
    "Library/Application Support/MobileSync",
    "Library/Application Support/Google/Chrome Beta",
    "Library/Application Support/Google/Chrome Canary",
    "Library/Application Support/Microsoft Edge Beta",
    "Library/Application Support/Microsoft Edge Canary",
    "Library/Application Support/com.operasoftware.Opera GX",
    "Library/Application Support/Orion",
    "Library/Application Support/LibreWolf",
    "Library/Application Support/Waterfox",
    "Library/Application Support/Bitwarden",
    "Library/Application Support/Proton Pass",
    "Library/Application Support/KeePassXC",
    "Library/Calendars",
    "Library/AddressBook",
    "Library/Notes",
    "Library/Accounts",
    "Library/IdentityServices",
    "Library/Application Support/Signal",
    "Library/Thunderbird",
  ];
  const linuxDenyReadPaths = [
    ".password-store",
    ".1password",
    ".op",
    ".local/share/keyrings",
    ".config/google-chrome",
    ".config/chromium",
    ".mozilla/firefox",
    ".config/microsoft-edge",
    ".config/BraveSoftware",
    ".config/vivaldi",
    ".config/opera",
    ".config/google-chrome-beta",
    ".config/google-chrome-unstable",
    ".config/chromium-browser",
    ".config/ungoogled-chromium",
    ".config/librewolf",
    ".config/waterfox",
    ".config/qutebrowser",
    ".config/falkon",
    ".config/tor",
    ".config/kwalletd",
    ".config/keepassxc",
    ".config/Signal",
    ".config/Nextcloud",
    ".thunderbird",
    ".config/evolution",
  ];
  const resolveExpectedDenyReadPaths = (home: string, entries: readonly string[]) =>
    [
      ...new Set(
        [...crossPlatformDenyReadPaths, ...entries].map((entry) =>
          entry.startsWith("/") ? entry : `${home}/${entry}`,
        ),
      ),
    ].sort((left, right) => left.localeCompare(right));

  it("pins the complete cross-platform and macOS conservative inventory", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath,
      platform: "darwin",
    });

    expect(policy.denyReadPaths).toEqual(resolveExpectedDenyReadPaths(homePath, macosDenyReadPaths));
    expect(policy.denyReadPaths).toEqual([...policy.denyReadPaths].sort((left, right) => left.localeCompare(right)));
    expect(new Set(policy.denyReadPaths).size).toBe(policy.denyReadPaths.length);
  });

  it("pins the complete cross-platform and Linux conservative inventory", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath,
      platform: "linux",
    });

    expect(policy.denyReadPaths).toEqual(resolveExpectedDenyReadPaths(homePath, linuxDenyReadPaths));
    expect(policy.denyReadPaths).toEqual([...policy.denyReadPaths].sort((left, right) => left.localeCompare(right)));
    expect(new Set(policy.denyReadPaths).size).toBe(policy.denyReadPaths.length);
  });

  it("keeps platform-specific entries separated and rejects broad parent denies", () => {
    const macosPolicy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath,
      platform: "darwin",
    });
    const linuxPolicy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath,
      platform: "linux",
    });
    const broadParents = [
      homePath,
      `${homePath}/.config`,
      `${homePath}/.local/share`,
      `${homePath}/.cache`,
      `${homePath}/Library`,
      `${homePath}/Documents`,
      `${homePath}/Projects`,
      `${homePath}/.config/opencode`,
      `${homePath}/.config/opencode/cache`,
      `${homePath}/.cache/opencode`,
      `${homePath}/.claude`,
      `${homePath}/.codex`,
      `${homePath}/.gemini`,
      `${homePath}/.android`,
      "/tmp",
      "/private/tmp",
    ];

    expect(macosPolicy.denyReadPaths).toEqual(resolveExpectedDenyReadPaths(homePath, macosDenyReadPaths));
    expect(linuxPolicy.denyReadPaths).toEqual(resolveExpectedDenyReadPaths(homePath, linuxDenyReadPaths));
    expect(macosPolicy.denyReadPaths).not.toEqual(
      expect.arrayContaining(linuxDenyReadPaths.map((entry) => `${homePath}/${entry}`)),
    );
    expect(linuxPolicy.denyReadPaths).not.toEqual(
      expect.arrayContaining(
        macosDenyReadPaths.filter((entry) => entry.startsWith("Library/")).map((entry) => `${homePath}/${entry}`),
      ),
    );
    expect(macosPolicy.denyReadPaths).not.toEqual(expect.arrayContaining(broadParents));
    expect(linuxPolicy.denyReadPaths).not.toEqual(expect.arrayContaining(broadParents));
  });

  it("does not emit the protected baseline on Windows", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "C:\\work\\project",
      homePath: "C:\\Users\\tester",
      platform: "win32",
    });

    expect(policy.denyReadPaths).toEqual([]);
  });

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
    expect(policy.denyReadPaths).not.toContain("/home/tester/.config/opencode");
    expect(policy.denyReadPaths).not.toContain("/home/tester/.config/opencode/auth.json");
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

  it("preserves non-conflicting OpenCode authentication and runtime grants", () => {
    const policy = buildChatSandboxFilesystemPolicy({
      workspacePath: "/workspace/project",
      homePath,
      openCodePaths: {
        config: "/home/tester/.config/opencode",
        auth: "/home/tester/.local/share/opencode/auth.json",
        state: "/home/tester/.local/share/opencode",
        cache: "/home/tester/.cache/opencode",
        temp: "/home/tester/.cache/opencode/tmp",
      },
      runtimeCachePaths: ["/home/tester/.cache/uv"],
    });

    expect(policy.readOnlyPaths).toEqual(
      expect.arrayContaining(["/home/tester/.config/opencode", "/home/tester/.local/share/opencode/auth.json"]),
    );
    expect(policy.readWritePaths).toEqual(
      expect.arrayContaining([
        "/home/tester/.local/share/opencode",
        "/home/tester/.cache/opencode",
        "/home/tester/.cache/opencode/tmp",
        "/home/tester/.cache/uv",
      ]),
    );
    expect(policy.denyReadPaths).not.toEqual(expect.arrayContaining(["/home/tester/.config/opencode"]));
    expect(policy.denyReadPaths).not.toEqual(expect.arrayContaining(["/home/tester/.local/share/opencode"]));
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

  it.each([
    ["OpenCode config", { config: "/Library/Keychains" }, undefined],
    ["executable", undefined, "/Library/Keychains"],
    ["PATH executable", undefined, undefined, ["/Library/Keychains"]],
  ] as const)("rejects an exact protected deny conflict for the %s read-only grant", (label, openCodePaths, executablePath, executablePaths) => {
    let returnedPolicy: ReturnType<typeof buildChatSandboxFilesystemPolicy> | undefined;

    expect(() => {
      returnedPolicy = buildChatSandboxFilesystemPolicy({
        workspacePath: "/workspace/project",
        homePath: "/Users/tester",
        openCodePaths,
        executablePath,
        executablePaths,
        platform: "darwin",
      });
    }).toThrow(
      /deny-read path "\/Library\/Keychains" overlaps required read-only filesystem policy path read grant "\/Library\/Keychains"/,
    );
    expect(returnedPolicy).toBeUndefined();
  });

  it.each([
    ["OpenCode config", { config: "/Library/Keychains/login.keychain-db" }, undefined],
    ["PATH executable", undefined, ["/Library/Keychains/bin/opencode"]],
  ] as const)("rejects a required read-only grant beneath a protected deny path for the %s", (label, openCodePaths, executablePaths) => {
    let returnedPolicy: ReturnType<typeof buildChatSandboxFilesystemPolicy> | undefined;

    expect(() => {
      returnedPolicy = buildChatSandboxFilesystemPolicy({
        workspacePath: "/workspace/project",
        homePath: "/Users/tester",
        openCodePaths,
        executablePaths,
        platform: "darwin",
      });
    }).toThrow(/deny-read path "\/Library\/Keychains" overlaps required read-only filesystem policy path/);
    expect(returnedPolicy).toBeUndefined();
  });

  it.each([
    ["workspace", { workspacePath: "/Library" }],
    ["runtime cache", { workspacePath: "/workspace/project", runtimeCachePaths: ["/Users/tester/Library"] }],
  ] as const)("rejects a workspace or runtime read-write grant containing a protected deny path for the %s", (label, input) => {
    let returnedPolicy: ReturnType<typeof buildChatSandboxFilesystemPolicy> | undefined;

    expect(() => {
      returnedPolicy = buildChatSandboxFilesystemPolicy({
        ...input,
        homePath: "/Users/tester",
        platform: "darwin",
      });
    }).toThrow(/deny-read path.*overlaps required filesystem policy path/);
    expect(returnedPolicy).toBeUndefined();
  });

  it.each([
    ["workspace", { workspacePath: "/Library/Keychains" }],
    ["runtime cache", { workspacePath: "/workspace/project", runtimeCachePaths: ["/Library/Keychains"] }],
    ["temporary path", { workspacePath: "/workspace/project", temporaryPaths: ["/Library/Keychains"] }],
  ] as const)("rejects an exact protected deny conflict for the %s read-write grant", (label, input) => {
    let returnedPolicy: ReturnType<typeof buildChatSandboxFilesystemPolicy> | undefined;

    expect(() => {
      returnedPolicy = buildChatSandboxFilesystemPolicy({
        ...input,
        homePath: "/Users/tester",
        platform: "darwin",
      });
    }).toThrow(/deny-read path "\/Library\/Keychains" overlaps required filesystem policy path/);
    expect(returnedPolicy).toBeUndefined();
  });

  it.each([
    [
      "runtime cache",
      { workspacePath: "/workspace/project", runtimeCachePaths: ["/Users/tester/.config/gh/hosts.yml/child"] },
    ],
    [
      "temporary path",
      { workspacePath: "/workspace/project", temporaryPaths: ["/Users/tester/.config/gh/hosts.yml/child"] },
    ],
  ] as const)("rejects a required read-write grant beneath a protected deny path for the %s", (label, input) => {
    let returnedPolicy: ReturnType<typeof buildChatSandboxFilesystemPolicy> | undefined;

    expect(() => {
      returnedPolicy = buildChatSandboxFilesystemPolicy({
        ...input,
        homePath: "/Users/tester",
        platform: "darwin",
      });
    }).toThrow(/deny-read path "\/Users\/tester\/\.config\/gh\/hosts\.yml" overlaps required filesystem policy path/);
    expect(returnedPolicy).toBeUndefined();
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
