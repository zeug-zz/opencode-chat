import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMORY_RETENTION_SETTINGS, resolveMemoryRetentionStatus } from "../memory-retention-settings";

describe("memory retention workspace settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the fixed enabled, confirmation-required, automatic-retention-on defaults", () => {
    expect(DEFAULT_MEMORY_RETENTION_SETTINGS).toEqual({
      policy: { enabled: true, requireConfirmation: true, automaticSessionRetention: true },
      managed: false,
      invalid: false,
    });
  });

  it.each([
    ["unavailable", "unavailable"],
    ["configured", "unavailable"],
    ["available", "active"],
    ["partial", "active"],
    ["blocked", "blocked"],
    ["error", "error"],
  ] as const)("resolves automatic session retention independently for %s provider status", (state, automaticState) => {
    const status = resolveMemoryRetentionStatus(
      {
        policy: { enabled: false, requireConfirmation: true, automaticSessionRetention: true },
        managed: false,
        invalid: false,
      },
      {
        id: "hindsight",
        displayName: "Hindsight",
        state,
        capabilities: { retain: true, recall: true, reflect: true, automaticSessionRetention: true },
      },
    );

    expect(status.policy.automaticSessionRetention).toBe(true);
    expect(status.state).toBe("disabled");
    expect(status.automaticSessionRetention?.state).toBe(automaticState);
  });
});
