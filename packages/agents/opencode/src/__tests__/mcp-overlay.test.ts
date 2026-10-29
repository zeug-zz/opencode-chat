import { describe, expect, it } from "vitest";
import { buildMcpOverlay } from "../mcp-overlay";

describe("buildMcpOverlay", () => {
  it("copies selected full native definitions and suppresses unselected servers", () => {
    const result = buildMcpOverlay(
      {
        servers: {
          selected: {
            definition: { type: "local", command: ["fixture"], environment: { KEY: "fixture-secret" } },
            source: "fixture.json",
            explicitlyDisabled: false,
            transport: "stdio",
          },
          unselected: {
            definition: { type: "remote", url: "https://fixture.invalid", codemode: false },
            source: "fixture.json",
            explicitlyDisabled: false,
            transport: "http",
          },
        },
        locked: [],
        qualificationGaps: [],
      },
      { selected: true },
    );

    expect(result).toEqual({
      mcp: {
        servers: {
          selected: { type: "local", command: ["fixture"], environment: { KEY: "fixture-secret" }, disabled: false },
          unselected: { type: "remote", url: "https://fixture.invalid", codemode: false, disabled: true },
        },
      },
    });
  });

  it("overrides ordinary config-disabled selection without changing Code Mode", () => {
    const result = buildMcpOverlay(
      {
        servers: {
          selected: {
            definition: { type: "remote", url: "https://fixture.invalid", disabled: true },
            source: "fixture.json",
            explicitlyDisabled: true,
            transport: "http",
          },
        },
        locked: [],
        qualificationGaps: [],
      },
      { selected: true },
    );
    expect(result.mcp.servers.selected).toEqual({ type: "remote", url: "https://fixture.invalid", disabled: false });
    expect(Object.hasOwn(result.mcp.servers.selected, "codemode")).toBe(false);
  });

  it("ignores unknown preferences and never emits their definitions", () => {
    const result = buildMcpOverlay(
      {
        servers: {
          known: {
            definition: { type: "local", command: ["fixture"] },
            source: "fixture.json",
            explicitlyDisabled: false,
            transport: "stdio",
          },
        },
        locked: [],
        qualificationGaps: [],
      },
      { known: false, unknown: true },
    );
    expect(result.mcp.servers).toEqual({ known: { type: "local", command: ["fixture"], disabled: true } });
  });
});
