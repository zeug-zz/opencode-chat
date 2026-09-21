import { describe, expect, it } from "vitest";
import { AfCommandError, createAfCommandSchema } from "../vibefeld/af-command-schema";

const schema = createAfCommandSchema({ executable: "/approved/af", workspace: "/extension-storage/review-1" });

describe("AF command schema", () => {
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
    [{ operation: "status" }, ["/approved/af", "status", "--dir", "/extension-storage/review-1", "--format", "json"]],
  ] as const)("encodes the observed %s argv shape", (operation, argv) => {
    const launch = schema.build(operation);
    expect(launch.argv).toEqual(argv);
    expect(launch.shell).toBe(false);
    expect(launch.executable).toBe("/approved/af");
  });

  it("keeps the workspace internal to init and status launch data", () => {
    expect(schema.build({ operation: "init", conjecture: "c", author: "a" }).cwd).toBe("/extension-storage/review-1");
    expect(schema.build({ operation: "status" }).cwd).toBe("/extension-storage/review-1");
  });

  it.each([
    { operation: "get" },
    { operation: "version", flags: ["--shell"] },
    { operation: "status", argv: ["af", "status"] },
    { operation: "status", executable: "/attacker/af" },
    { operation: "status", workspace: "/attacker/workspace" },
    { operation: "status", shell: "af status --format json" },
    { operation: "init", conjecture: "c; touch outside", author: "a" },
    { operation: "init", conjecture: "c", author: "a\nsh -c rm" },
    { operation: "init", conjecture: "", author: "a" },
  ] as const)("rejects unapproved input %#", (operation) => {
    expect(() => schema.build(operation)).toThrow(AfCommandError);
  });

  it("rejects oversized initialization input", () => {
    expect(() => schema.build({ operation: "init", conjecture: "x".repeat(257), author: "a" })).toThrow(AfCommandError);
  });
});
