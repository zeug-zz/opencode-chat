import { describe, expect, it } from "vitest";
import {
  AF_COMMAND_OPERATIONS,
  AF_MAX_REFINE_STATEMENTS,
  AfCommandError,
  type AfCommandOperation,
  createAfCommandSchema,
} from "../vibefeld/af-command-schema";
import { type AfExecutionPolicyAdapter, buildAfPolicyDescriptor } from "../vibefeld/af-execution-boundary";

const schema = createAfCommandSchema({ executable: "/approved/af", workspace: "/extension-storage/review-1" });

const adapter: AfExecutionPolicyAdapter = {
  platform: "darwin",
  readiness: { state: "ready", execution: "direct" },
  launch: async () => ({ outcome: "exited", exitCode: 0 }),
  terminateAndReap: async () => ({ outcome: "reaped" }),
};

const rejectionCode = (operation: unknown): string | undefined => {
  try {
    schema.build(operation as AfCommandOperation);
    return undefined;
  } catch (error) {
    return error instanceof AfCommandError ? error.code : undefined;
  }
};

describe("AF command schema", () => {
  it("exposes exactly the six observed operations", () => {
    expect(AF_COMMAND_OPERATIONS).toEqual(["version", "schema", "init", "claim", "refine", "status"]);
  });

  it.each([
    [{ operation: "version" }, ["/approved/af", "version", "--json"]],
    [{ operation: "schema" }, ["/approved/af", "schema", "--format", "json"]],
    [
      { operation: "init", conjecture: "bounded conjecture", author: "scribe" },
      [
        "/approved/af",
        "init",
        "--conjecture",
        "bounded conjecture",
        "--author",
        "scribe",
        "--dir",
        "/extension-storage/review-1",
      ],
    ],
    [
      { operation: "claim", nodeId: "1", role: "prover" },
      [
        "/approved/af",
        "claim",
        "1",
        "--owner",
        "scribe",
        "--role",
        "prover",
        "--dir",
        "/extension-storage/review-1",
        "--format",
        "json",
      ],
    ],
    [
      { operation: "claim", nodeId: "1.2.3", role: "verifier" },
      [
        "/approved/af",
        "claim",
        "1.2.3",
        "--owner",
        "scribe",
        "--role",
        "verifier",
        "--dir",
        "/extension-storage/review-1",
        "--format",
        "json",
      ],
    ],
    [
      { operation: "refine", parentId: "1", statements: ["first child", "second child"] },
      [
        "/approved/af",
        "refine",
        "1",
        "first child",
        "second child",
        "--owner",
        "scribe",
        "--dir",
        "/extension-storage/review-1",
        "--format",
        "json",
      ],
    ],
    [{ operation: "status" }, ["/approved/af", "status", "--dir", "/extension-storage/review-1", "--format", "json"]],
  ] as const)("encodes the observed %s argv shape", (operation, argv) => {
    const launch = schema.build(operation);
    expect(launch.argv).toEqual(argv);
    expect(launch.shell).toBe(false);
    expect(launch.executable).toBe("/approved/af");
  });

  it("keeps the workspace internal to the fixed launch data", () => {
    expect(schema.build({ operation: "init", conjecture: "c", author: "a" }).cwd).toBe("/extension-storage/review-1");
    expect(schema.build({ operation: "status" }).cwd).toBe("/extension-storage/review-1");
    expect(schema.build({ operation: "claim", nodeId: "1", role: "prover" }).cwd).toBe("/extension-storage/review-1");
    expect(schema.build({ operation: "refine", parentId: "1", statements: ["statement"] }).cwd).toBe(
      "/extension-storage/review-1",
    );
  });

  it.each([
    { operation: "get" },
    { operation: "release" },
    { operation: "accept" },
    { operation: "challenge" },
    { operation: "version", flags: ["--shell"] },
    { operation: "status", argv: ["af", "status"] },
    { operation: "status", executable: "/attacker/af" },
    { operation: "status", workspace: "/attacker/workspace" },
    { operation: "status", shell: "af status --format json" },
    { operation: "init", conjecture: "c; touch outside", author: "a" },
    { operation: "init", conjecture: "c", author: "a\nsh -c rm" },
    { operation: "init", conjecture: "", author: "a" },
    { operation: "claim", role: "prover" },
    { operation: "claim", nodeId: "1" },
    { operation: "claim", nodeId: "1..2", role: "prover" },
    { operation: "claim", nodeId: ".1", role: "prover" },
    { operation: "claim", nodeId: "1.", role: "prover" },
    { operation: "claim", nodeId: "/etc/passwd", role: "prover" },
    { operation: "claim", nodeId: "1; rm -rf /", role: "prover" },
    { operation: "claim", nodeId: "", role: "prover" },
    { operation: "claim", nodeId: "1", role: "admin" },
    { operation: "claim", nodeId: "1", role: "prover", owner: "attacker" },
    { operation: "claim", nodeId: "1", role: "prover", executable: "/attacker/af" },
    { operation: "claim", nodeId: "1", role: "prover", workspace: "/attacker/workspace" },
    { operation: "refine", statements: ["statement"] },
    { operation: "refine", parentId: "1" },
    { operation: "refine", parentId: "1", statements: "statement" },
    { operation: "refine", parentId: "1", statements: [] },
    { operation: "refine", parentId: "1", statements: ["safe", 42] },
    { operation: "refine", parentId: "1", statements: ["", "safe"] },
    { operation: "refine", parentId: "1", statements: ["safe", "rm -rf /; echo"] },
    { operation: "refine", parentId: "1", statements: ["safe"], owner: "attacker" },
    { operation: "refine", parentId: "1", statements: ["safe"], workspace: "/attacker/workspace" },
    { operation: "refine", parentId: "1", statements: ["safe"], rawArgv: ["af", "refine"] },
    { operation: "refine", parentId: "1; rm -rf /", statements: ["safe"] },
  ] as const)("rejects unapproved input %#", (operation) => {
    expect(() => schema.build(operation)).toThrow(AfCommandError);
  });

  it("rejects out-of-bounds identifiers and statements without truncating", () => {
    expect(() => schema.build({ operation: "claim", nodeId: "1".repeat(65), role: "prover" })).toThrow(AfCommandError);
    expect(schema.build({ operation: "claim", nodeId: "1".repeat(64), role: "prover" }).argv[2]).toBe("1".repeat(64));
    expect(() =>
      schema.build({ operation: "refine", parentId: "1", statements: Array.from({ length: 25 }, () => "statement") }),
    ).toThrow(AfCommandError);
    expect(() =>
      schema.build({
        operation: "refine",
        parentId: "1",
        statements: Array.from({ length: AF_MAX_REFINE_STATEMENTS + 1 }, () => "statement"),
      }),
    ).toThrow(AfCommandError);
    expect(() => schema.build({ operation: "refine", parentId: "1", statements: ["x".repeat(257)] })).toThrow(
      AfCommandError,
    );
    expect(schema.build({ operation: "refine", parentId: "1", statements: ["x".repeat(256)] }).argv[3]).toBe(
      "x".repeat(256),
    );
  });

  it("keeps the maximum refine build inside the execution boundary", () => {
    const statements = Array.from({ length: AF_MAX_REFINE_STATEMENTS }, (_, index) => `statement ${index}`);
    const launch = schema.build({ operation: "refine", parentId: "1", statements });
    expect(launch.argv.length).toBeLessThanOrEqual(32);
    expect(launch.argv.every((argument) => argument.length <= 256)).toBe(true);

    const cwd = launch.cwd;
    if (cwd === undefined) throw new Error("expected a bounded refine cwd");
    expect(buildAfPolicyDescriptor(adapter, { executable: launch.executable, argv: launch.argv, cwd })).toEqual({
      available: true,
      descriptor: { executable: "/approved/af", argv: launch.argv, cwd: "/extension-storage/review-1" },
    });

    expect(() =>
      schema.build({ operation: "refine", parentId: "1", statements: [...statements, "one too many"] }),
    ).toThrow(AfCommandError);
  });

  it("never emits a caller-supplied owner identity", () => {
    expect(() => schema.build({ operation: "claim", nodeId: "1", role: "prover", owner: "attacker" } as never)).toThrow(
      AfCommandError,
    );

    const launches = [
      schema.build({ operation: "claim", nodeId: "1", role: "prover" }),
      schema.build({ operation: "claim", nodeId: "1.1", role: "verifier" }),
      schema.build({ operation: "refine", parentId: "1", statements: ["statement"] }),
    ];
    for (const launch of launches) {
      const ownerIndex = launch.argv.indexOf("--owner");
      expect(ownerIndex).toBeGreaterThan(-1);
      expect(launch.argv[ownerIndex + 1]).toBe("scribe");
      expect(launch.argv).not.toContain("attacker");
    }
  });

  it("classifies rejections with the existing error codes", () => {
    expect(rejectionCode({ operation: "get" })).toBe("invalid-operation");
    expect(rejectionCode({ operation: "release" })).toBe("invalid-operation");
    expect(rejectionCode({ operation: "claim", nodeId: "1", role: "prover", owner: "attacker" })).toBe("invalid-input");
    expect(rejectionCode({ operation: "claim", nodeId: "1..2", role: "prover" })).toBe("invalid-input");
    expect(rejectionCode({ operation: "claim", nodeId: "1", role: "admin" })).toBe("invalid-input");
    expect(rejectionCode({ operation: "refine", parentId: "1", statements: [] })).toBe("invalid-input");
    expect(rejectionCode({ operation: "refine", parentId: "1", statements: ["unsafe; token"] })).toBe("invalid-input");
  });

  it("rejects oversized initialization input", () => {
    expect(() => schema.build({ operation: "init", conjecture: "x".repeat(257), author: "a" })).toThrow(AfCommandError);
  });
});
