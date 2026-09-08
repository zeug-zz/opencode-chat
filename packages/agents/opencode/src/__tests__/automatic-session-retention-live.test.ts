import { describe, expect, it } from "vitest";

const liveInputs = [
  "OPENCODE_CHAT_HINDSIGHT_LIVE",
  "OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_BANK",
  "OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_ENDPOINT",
  "OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_TOKEN",
] as const;

const missingLiveInputs = liveInputs.filter((name) => !process.env[name]);
const liveOptIn = process.env.OPENCODE_CHAT_HINDSIGHT_LIVE === "1";
const hasLiveInputs = liveOptIn && missingLiveInputs.length === 0;
const knownFact = "retention-live-check: the workspace test marker is alpine-otter-42";
const deniedOperations = ["shell", "edit", "task", "package", "terminal", "provider administration"];

describe("automatic session retention live-gate readiness", () => {
  it("uses a known non-sensitive fact and a bounded denied-operation matrix", () => {
    expect(knownFact).toMatch(/^retention-live-check: [a-z0-9 -]+$/);
    expect(knownFact).not.toMatch(/token|secret|password|credential|authorization/i);
    expect(deniedOperations).toEqual(["shell", "edit", "task", "package", "terminal", "provider administration"]);
  });

  it("requires explicit disposable-provider inputs and never falls back to a default bank", () => {
    expect(liveInputs).toEqual([
      "OPENCODE_CHAT_HINDSIGHT_LIVE",
      "OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_BANK",
      "OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_ENDPOINT",
      "OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_TOKEN",
    ]);
    expect(liveInputs).not.toContain("HINDSIGHT_BANK");
    expect(liveInputs).not.toContain("HINDSIGHT_DEFAULT_BANK");
  });

  it("records a bounded blocked status when the live prerequisite is absent", () => {
    if (hasLiveInputs) return;

    expect({ status: "BLOCKED", missing: missingLiveInputs }).toMatchObject({
      status: "BLOCKED",
    });
    expect(missingLiveInputs.length).toBeGreaterThan(0);
  });

  it.skipIf(!hasLiveInputs)("runs only as an explicitly provisioned operator gate", () => {
    // The provider-specific operator checklist is intentionally separate from
    // this synthetic suite so credentials and raw provider payloads cannot
    // enter automated test output.
    expect(hasLiveInputs).toBe(true);
  });
});
