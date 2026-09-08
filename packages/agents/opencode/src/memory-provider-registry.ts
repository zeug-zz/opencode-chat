import type {
  MemoryCapabilities,
  MemoryProviderCapabilities,
  MemoryProviderDescriptor,
  MemoryProviderState,
  MemoryProviderStatus,
} from "@opencode-chat/core";
import { NONE_MEMORY_PROVIDER_DESCRIPTOR, normalizeMemoryProviderReason } from "./memory-provider-discovery";

const PROVIDER_ID = /^[a-z][a-z0-9._-]*$/;
const MAX_DISPLAY_NAME_LENGTH = 120;
const DEFAULT_FAILURE_REASON = "Provider detection failed";

export type MemoryProviderRegistryContext = Readonly<Record<string, unknown>>;

export type MemoryProviderAdapter = {
  readonly id: string;
  readonly displayName: string;
  readonly descriptor: MemoryProviderDescriptor;
  readonly priority?: number;
  readonly detect: (context: MemoryProviderRegistryContext) => Promise<MemoryProviderStatus> | MemoryProviderStatus;
};

export type MemoryProviderSelectionRequest = "automatic" | "none" | { readonly providerId: string };

export type MemoryProviderRegistrySelection = Readonly<{
  descriptor: Readonly<MemoryProviderDescriptor>;
  status: MemoryProviderStatus;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validProviderId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ID.test(value) && value !== "none";
}

function normalizeCapabilities(value: unknown): MemoryCapabilities | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.retain !== "boolean" || typeof value.recall !== "boolean" || typeof value.reflect !== "boolean") {
    return undefined;
  }
  return Object.freeze({
    retain: value.retain,
    recall: value.recall,
    reflect: value.reflect,
    automaticSessionRetention: value.automaticSessionRetention === true,
  });
}

function normalizeDescriptor(value: unknown): Readonly<MemoryProviderDescriptor> | undefined {
  if (!isRecord(value) || !validProviderId(value.id) || typeof value.displayName !== "string") return undefined;
  const displayName = value.displayName.trim();
  const capabilities = normalizeCapabilities(value.capabilities);
  if (
    !displayName ||
    displayName.length > MAX_DISPLAY_NAME_LENGTH ||
    !capabilities ||
    typeof value.requiresNetwork !== "boolean" ||
    typeof value.requiresLocalRuntime !== "boolean"
  ) {
    return undefined;
  }

  return Object.freeze({
    id: value.id,
    displayName,
    capabilities,
    requiresNetwork: value.requiresNetwork,
    requiresLocalRuntime: value.requiresLocalRuntime,
  });
}

function normalizeAdapter(value: unknown): Readonly<MemoryProviderAdapter> | undefined {
  if (!isRecord(value) || !validProviderId(value.id) || typeof value.displayName !== "string") return undefined;
  if (typeof value.detect !== "function") return undefined;
  const descriptor = normalizeDescriptor(value.descriptor);
  const displayName = value.displayName.trim();
  if (!descriptor || descriptor.id !== value.id || !displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return undefined;
  }
  const priority = value.priority;
  if (priority !== undefined && (typeof priority !== "number" || !Number.isSafeInteger(priority) || priority < 0)) {
    return undefined;
  }

  return Object.freeze({
    id: value.id,
    displayName,
    descriptor,
    ...(priority === undefined ? {} : { priority }),
    detect: value.detect as MemoryProviderAdapter["detect"],
  });
}

function noProviderStatus(reason?: string): MemoryProviderStatus {
  return {
    id: NONE_MEMORY_PROVIDER_DESCRIPTOR.id,
    displayName: "No memory provider",
    state: "unavailable",
    capabilities: { retain: false, recall: false, reflect: false },
    ...(reason ? { reason } : {}),
  };
}

function safeStatus(adapter: MemoryProviderAdapter, value: unknown): MemoryProviderStatus | undefined {
  if (!isRecord(value)) return undefined;
  if (value.id === "none")
    return noProviderStatus(value.reason === undefined ? undefined : normalizeMemoryProviderReason(value.reason));
  if (value.id !== adapter.id) return undefined;
  const states: MemoryProviderState[] = ["unavailable", "configured", "available", "partial", "blocked", "error"];
  if (!states.includes(value.state as MemoryProviderState) || !isRecord(value.capabilities)) return undefined;
  const capabilities = value.capabilities;
  if (
    typeof capabilities.retain !== "boolean" ||
    typeof capabilities.recall !== "boolean" ||
    typeof capabilities.reflect !== "boolean"
  ) {
    return undefined;
  }
  const reason = value.reason === undefined ? undefined : normalizeMemoryProviderReason(value.reason);
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    state: value.state as MemoryProviderState,
    capabilities: {
      retain: capabilities.retain,
      recall: capabilities.recall,
      reflect: capabilities.reflect,
      automaticSessionRetention: capabilities.automaticSessionRetention === true,
    },
    ...(reason ? { reason } : {}),
  };
}

function usable(status: MemoryProviderStatus): boolean {
  return status.state === "available" || status.state === "partial";
}

function selectedDescriptor(
  adapter: MemoryProviderAdapter,
  status: MemoryProviderStatus,
): Readonly<MemoryProviderDescriptor> {
  return Object.freeze({
    ...adapter.descriptor,
    capabilities: Object.freeze({
      ...status.capabilities,
      automaticSessionRetention: status.capabilities.automaticSessionRetention === true,
    }),
  });
}

export class MemoryProviderRegistry {
  readonly adapters: readonly Readonly<MemoryProviderAdapter>[];

  constructor(adapters: readonly unknown[] = []) {
    const accepted: Readonly<MemoryProviderAdapter>[] = [];
    for (const candidate of adapters) {
      const adapter = normalizeAdapter(candidate);
      if (adapter && !accepted.some((existing) => existing.id === adapter.id)) accepted.push(adapter);
    }
    this.adapters = sortAdapters(accepted);
  }

  register(adapter: unknown): MemoryProviderRegistry {
    const normalized = normalizeAdapter(adapter);
    if (!normalized || this.adapters.some((existing) => existing.id === normalized.id)) return this;
    return new MemoryProviderRegistry([...this.adapters, normalized]);
  }

  async select(
    request: MemoryProviderSelectionRequest = "automatic",
    context: MemoryProviderRegistryContext = {},
  ): Promise<MemoryProviderRegistrySelection> {
    if (request === "none") return { descriptor: NONE_MEMORY_PROVIDER_DESCRIPTOR, status: noProviderStatus() };

    const requestedId = typeof request === "object" ? request.providerId : undefined;
    const candidates = requestedId ? this.adapters.filter((adapter) => adapter.id === requestedId) : this.adapters;
    if (requestedId && candidates.length === 0) {
      return { descriptor: NONE_MEMORY_PROVIDER_DESCRIPTOR, status: noProviderStatus("Provider unavailable") };
    }

    let fallbackStatus: MemoryProviderStatus | undefined;
    for (const adapter of candidates) {
      let status: MemoryProviderStatus | undefined;
      try {
        status = safeStatus(adapter, await adapter.detect(context));
      } catch {
        status = undefined;
      }
      if (status && usable(status)) return { descriptor: selectedDescriptor(adapter, status), status };
      if (requestedId) {
        return {
          descriptor: NONE_MEMORY_PROVIDER_DESCRIPTOR,
          status: status ?? noProviderStatus(DEFAULT_FAILURE_REASON),
        };
      }
      if (status) fallbackStatus ??= status;
    }

    return { descriptor: NONE_MEMORY_PROVIDER_DESCRIPTOR, status: fallbackStatus ?? noProviderStatus() };
  }
}

function sortAdapters(
  adapters: readonly Readonly<MemoryProviderAdapter>[],
): readonly Readonly<MemoryProviderAdapter>[] {
  return Object.freeze(
    adapters
      .map((adapter, index) => ({ adapter, index }))
      .sort((left, right) => (left.adapter.priority ?? 0) - (right.adapter.priority ?? 0) || left.index - right.index)
      .map(({ adapter }) => adapter),
  );
}

export function createMemoryProviderRegistry(adapters: readonly unknown[] = []): MemoryProviderRegistry {
  return new MemoryProviderRegistry(adapters);
}
