import { describe, expect, it } from "vitest";
import { buildMcpOverlay } from "../mcp-overlay";

describe("buildMcpOverlay", () => {
  it("emits every inventoried server with unselected servers disabled", () => {
    const result = buildMcpOverlay(
      {
        servers: {
          selected: { explicitlyDisabled: false },
          unselected: { explicitlyDisabled: false },
        },
      },
      { selected: true },
    );

    expect(result).toEqual({
      mcp: {
        selected: { enabled: true },
        unselected: { enabled: false },
      },
      locked: [],
    });
  });

  it("lets a true Chat preference override an explicitly disabled server", () => {
    const result = buildMcpOverlay(
      {
        servers: {
          zebra: { explicitlyDisabled: true },
          alpha: { explicitlyDisabled: true },
          enabled: { explicitlyDisabled: false },
        },
      },
      { alpha: true, enabled: true, zebra: true },
    );

    expect(result).toEqual({
      mcp: {
        alpha: { enabled: true },
        enabled: { enabled: true },
        zebra: { enabled: true },
      },
      locked: [],
    });
  });

  it("ignores preferences for names absent from the inventory", () => {
    const result = buildMcpOverlay(
      { servers: { known: { explicitlyDisabled: false } } },
      { known: false, unknown: true },
    );

    expect(result).toEqual({ mcp: { known: { enabled: false } }, locked: [] });
    expect(JSON.stringify(result)).not.toContain("unknown");
  });
});
