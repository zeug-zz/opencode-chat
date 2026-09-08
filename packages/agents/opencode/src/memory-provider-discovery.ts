import type {
  MemoryCapabilities,
  MemoryProviderCapabilities,
  MemoryProviderDescriptor,
  MemoryProviderStatus,
} from "@opencode-chat/core";
import { type MemoryProviderAdapter, MemoryProviderRegistry } from "./memory-provider-registry";

export const NONE_MEMORY_PROVIDER_DESCRIPTOR: Readonly<MemoryProviderDescriptor> = Object.freeze({
  id: "none",
  displayName: "OpenCode context (AGENTS.md fallback)",
  capabilities: Object.freeze({
    retain: false,
    recall: false,
    reflect: false,
    automaticSessionRetention: false,
  }),
  requiresNetwork: false,
  requiresLocalRuntime: false,
} as MemoryProviderDescriptor);

export type MemoryProviderProbeResult = {
  reachable: boolean;
  capabilities: MemoryProviderCapabilities;
};

export type MemoryProviderProbe = () => Promise<MemoryProviderProbeResult>;

export type HindsightDetectionInput = {
  configured: boolean;
  blocked?: boolean;
  probe?: MemoryProviderProbe;
};

export type MemoryDetectionContext = {
  hindsight?: HindsightDetectionInput;
};

export type MemoryProviderFactoryContext = MemoryDetectionContext;

export interface MemoryProviderFactory {
  readonly id: string;
  create(
    context: MemoryProviderFactoryContext,
  ): Promise<MemoryProviderDescriptor | null | undefined> | MemoryProviderDescriptor | null | undefined;
}

export type MemoryProviderSelection = Readonly<MemoryProviderDescriptor>;

export interface MemoryProviderDetector {
  readonly id: string;
  readonly displayName: string;
  isConfigured(context: MemoryDetectionContext): boolean;
  detect(context: MemoryDetectionContext): Promise<MemoryProviderStatus>;
}

const HINDSIGHT_METADATA = {
  id: "hindsight",
  displayName: "Hindsight",
} as const;

const HINDSIGHT_REQUIREMENTS = {
  requiresNetwork: true,
  requiresLocalRuntime: true,
} as const;

const MAX_REASON_LENGTH = 160;
const DEFAULT_REASON = "Provider detection failed";

const SAFE_REASONS = new Map([
  ["provider blocked by companion policy", "Provider blocked by companion policy"],
  ["provider is configured but not probeable", "Provider is configured but not probeable"],
  ["provider did not respond to the safe probe", "Provider did not respond to the safe probe"],
  ["provider detection failed", DEFAULT_REASON],
  ["provider unavailable", "Provider unavailable"],
]);

function reasonText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return undefined;
}

export function normalizeMemoryProviderReason(value: unknown): string | undefined {
  const text = reasonText(value)
    ?.replace(/\p{Cc}+/gu, " ")
    .trim();
  if (!text) return value === undefined || value === null ? undefined : DEFAULT_REASON;

  const knownReason = SAFE_REASONS.get(text.toLowerCase());
  if (knownReason) return knownReason;

  const redacted = text
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted URL]")
    .replace(/\b(?:authorization|bearer)\s*[:=]?\s*(?:bearer\s+)?[^\s,;]+/gi, "[redacted credential]")
    .replace(/\b(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)\s*[:=]\s*[\S]+/gi, "[redacted credential]")
    .replace(/\b(?:config|configuration|settings|payload)\s*[:=]\s*\{[^}]*\}/gi, "[redacted payload]")
    .replace(/(?:^|\s)(?:\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)[^\s,;]+/g, "$1[redacted path]")
    .replace(/\{[^{}]*\}|\[[^\]]*\]/g, "[redacted payload]")
    .replace(/\s+/g, " ")
    .trim();

  if (!redacted || redacted.includes("[object Object]")) return DEFAULT_REASON;
  return redacted.length > MAX_REASON_LENGTH ? `${redacted.slice(0, MAX_REASON_LENGTH - 3)}...` : redacted;
}

function noProviderStatus(): MemoryProviderStatus {
  return {
    id: "none",
    displayName: "No memory provider",
    state: "unavailable",
    capabilities: { retain: false, recall: false, reflect: false },
  };
}

function status(
  state: MemoryProviderStatus["state"],
  capabilities: MemoryProviderCapabilities,
  reason?: string,
): MemoryProviderStatus {
  const normalizedReason = normalizeMemoryProviderReason(reason);
  return {
    ...HINDSIGHT_METADATA,
    state,
    capabilities,
    ...(normalizedReason ? { reason: normalizedReason } : {}),
  };
}

function stateForCapabilities(capabilities: MemoryProviderCapabilities): "available" | "partial" {
  return capabilities.retain && capabilities.recall && capabilities.reflect ? "available" : "partial";
}

function noMemoryCapabilities(): MemoryCapabilities {
  return {
    retain: false,
    recall: false,
    reflect: false,
    automaticSessionRetention: false,
  };
}

export function adaptHindsightProviderStatus(status: MemoryProviderStatus): MemoryProviderDescriptor {
  if (status.id !== HINDSIGHT_METADATA.id || status.state === "unavailable") {
    return NONE_MEMORY_PROVIDER_DESCRIPTOR;
  }

  const capabilities =
    status.state === "available" || status.state === "partial"
      ? {
          retain: status.capabilities.retain,
          recall: status.capabilities.recall,
          reflect: status.capabilities.reflect,
          automaticSessionRetention: status.capabilities.automaticSessionRetention === true,
        }
      : noMemoryCapabilities();

  return Object.freeze({
    ...HINDSIGHT_METADATA,
    capabilities: Object.freeze(capabilities),
    ...HINDSIGHT_REQUIREMENTS,
  });
}

export class HindsightProviderDetector implements MemoryProviderDetector {
  readonly id = HINDSIGHT_METADATA.id;
  readonly displayName = HINDSIGHT_METADATA.displayName;

  isConfigured(context: MemoryDetectionContext): boolean {
    return context.hindsight?.configured === true;
  }

  async detect(context: MemoryDetectionContext): Promise<MemoryProviderStatus> {
    const configuration = context.hindsight;
    if (!configuration?.configured) return noProviderStatus();
    if (configuration.blocked) {
      return status(
        "blocked",
        { retain: false, recall: false, reflect: false },
        "Provider blocked by companion policy",
      );
    }
    if (!configuration.probe) {
      return status(
        "configured",
        { retain: false, recall: false, reflect: false },
        "Provider is configured but not probeable",
      );
    }

    try {
      const result = await configuration.probe();
      if (!result.reachable) {
        return status(
          "configured",
          { retain: false, recall: false, reflect: false },
          "Provider did not respond to the safe probe",
        );
      }
      return status(stateForCapabilities(result.capabilities), result.capabilities);
    } catch {
      return status("error", { retain: false, recall: false, reflect: false }, DEFAULT_REASON);
    }
  }
}

export class MemoryProviderDiscovery {
  constructor(private readonly detectors: readonly MemoryProviderDetector[] = [new HindsightProviderDetector()]) {}

  async detect(context: MemoryDetectionContext): Promise<MemoryProviderStatus> {
    const detector = this.detectors.find((candidate) => candidate.isConfigured(context));
    if (!detector) return noProviderStatus();

    try {
      return await detector.detect(context);
    } catch {
      return {
        id: detector.id,
        displayName: detector.displayName,
        state: "error",
        capabilities: { retain: false, recall: false, reflect: false },
        reason: normalizeMemoryProviderReason("Provider detection failed") ?? DEFAULT_REASON,
      };
    }
  }
}

export async function detectMemoryProvider(
  context: MemoryDetectionContext,
  detectors?: readonly MemoryProviderDetector[],
): Promise<MemoryProviderStatus> {
  if (detectors) return new MemoryProviderDiscovery(detectors).detect(context);

  const registry = new MemoryProviderRegistry([defaultHindsightAdapter]);
  return (await registry.select("automatic", context)).status;
}

const defaultHindsightAdapter: MemoryProviderAdapter = {
  id: HINDSIGHT_METADATA.id,
  displayName: HINDSIGHT_METADATA.displayName,
  descriptor: {
    ...HINDSIGHT_METADATA,
    capabilities: {
      retain: true,
      recall: true,
      reflect: true,
      automaticSessionRetention: true,
    },
    ...HINDSIGHT_REQUIREMENTS,
  },
  detect: (context) => new HindsightProviderDetector().detect(context as MemoryDetectionContext),
};

function normalizeProviderDescriptor(value: MemoryProviderDescriptor): MemoryProviderSelection | undefined {
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.displayName !== "string" ||
    !value.capabilities ||
    typeof value.capabilities.retain !== "boolean" ||
    typeof value.capabilities.recall !== "boolean" ||
    typeof value.capabilities.reflect !== "boolean" ||
    typeof value.requiresNetwork !== "boolean" ||
    typeof value.requiresLocalRuntime !== "boolean"
  ) {
    return undefined;
  }

  return Object.freeze({
    id: value.id,
    displayName: value.displayName,
    capabilities: Object.freeze({ ...value.capabilities }),
    requiresNetwork: value.requiresNetwork,
    requiresLocalRuntime: value.requiresLocalRuntime,
  });
}

export async function selectMemoryProvider(
  factories: readonly MemoryProviderFactory[],
  context: MemoryProviderFactoryContext = {},
): Promise<MemoryProviderSelection> {
  for (const factory of factories) {
    try {
      const candidate = await factory.create(context);
      if (!candidate) continue;

      const descriptor = normalizeProviderDescriptor(candidate);
      if (descriptor) return descriptor;
    } catch {}
  }

  return NONE_MEMORY_PROVIDER_DESCRIPTOR;
}
