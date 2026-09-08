import type { MemoryCapabilities, MemoryProviderDescriptor } from "@opencode-chat/core";
import { describe, expect, it } from "vitest";
import {
  adaptHindsightProviderStatus,
  type MemoryProviderFactory,
  NONE_MEMORY_PROVIDER_DESCRIPTOR,
  selectMemoryProvider,
} from "../index";

describe("agent package exports", () => {
  it("exports the provider contract types and adapter values from its entry point", async () => {
    const capabilities: MemoryCapabilities = {
      retain: false,
      recall: true,
      reflect: false,
      automaticSessionRetention: false,
    };
    const descriptor: MemoryProviderDescriptor = {
      id: "fake",
      displayName: "Fake memory",
      capabilities,
      requiresNetwork: false,
      requiresLocalRuntime: false,
    };
    const factory: MemoryProviderFactory = {
      id: descriptor.id,
      create: () => descriptor,
    };

    expect(await selectMemoryProvider([factory])).toEqual(descriptor);
    expect(
      adaptHindsightProviderStatus({
        id: "hindsight",
        displayName: "Hindsight",
        state: "partial",
        capabilities: { retain: false, recall: true, reflect: false },
      }),
    ).toMatchObject({ id: "hindsight", capabilities });
    expect(NONE_MEMORY_PROVIDER_DESCRIPTOR.id).toBe("none");
  });
});
