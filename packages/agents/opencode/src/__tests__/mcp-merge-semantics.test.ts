import { describe, expect, it } from "vitest";
import { buildMcpOverlay } from "../mcp-overlay";

describe("native MCP overlay contract", () => {
  it("emits complete selected V2 definitions under mcp.servers", () => {
    const overlay = buildMcpOverlay(
      {
        servers: {
          local: {
            definition: {
              type: "local",
              command: ["node", "fixture.js"],
              cwd: "workspace",
              environment: { TOKEN: "fixture-secret" },
              timeout: { startup: 1500 },
              protocol: "auto",
            },
            source: "fixture.json",
            explicitlyDisabled: false,
            transport: "stdio",
          },
        },
        locked: [],
        qualificationGaps: [],
      },
      { local: true },
    );

    expect(overlay).toEqual({
      mcp: {
        servers: {
          local: {
            type: "local",
            command: ["node", "fixture.js"],
            cwd: "workspace",
            environment: { TOKEN: "fixture-secret" },
            timeout: { startup: 1500 },
            protocol: "auto",
            disabled: false,
          },
        },
      },
    });
    expect(Object.hasOwn(overlay.mcp.servers.local, "codemode")).toBe(false);
  });

  it("marks unselected definitions disabled and does not add an enabled-only V1 shape", () => {
    const overlay = buildMcpOverlay(
      {
        servers: {
          local: {
            definition: { type: "local", command: ["fixture"], codemode: false },
            source: "fixture.json",
            explicitlyDisabled: false,
            transport: "stdio",
          },
        },
        locked: [],
        qualificationGaps: [],
      },
      {},
    );

    expect(overlay.mcp.servers.local).toEqual({ type: "local", command: ["fixture"], codemode: false, disabled: true });
    expect(overlay.mcp).not.toHaveProperty("local");
  });

  it("carries no schema dump, dispatcher, or duplicate tool/provider definitions", () => {
    const overlay = buildMcpOverlay({ servers: {}, locked: [], qualificationGaps: [] }, {});
    expect(overlay).toEqual({ mcp: { servers: {} } });
    expect(overlay).not.toHaveProperty("tools");
    expect(overlay).not.toHaveProperty("execute");
  });
});
