import type { AfCommandOperation } from "./af-command-schema";
import type { AfCompatibilityMetadata, AfCompatibilityReason, AfCompatibilityResult } from "./af-compatibility";
import { classifyAfCompatibility } from "./af-compatibility";
import type { AfExecutionPolicyAdapter } from "./af-execution-boundary";
import type { AfLiveInitFacts, AfLiveSchemaFacts, AfLiveStatusFacts, AfLiveVersionFacts } from "./af-live-output";
import { type AfOutputParserSet, createProductionAfOutputParsers } from "./af-parser-mode";
import { type AfProcessExecutor, type AfProcessResult, createAfProcessExecutor } from "./af-process-executor";
import type { ProofWorkspaceHandle, ProofWorkspaceStore } from "./proof-workspace-store";

export type AfBridgeState =
  | "dormant"
  | "preflighting"
  | "unavailable"
  | "incompatible"
  | "ready"
  | "running"
  | "audit-failed";
export type AfBridgeOperation = Extract<AfCommandOperation, { operation: "init" | "status" }>;
export type AfBridgeFacts = AfLiveInitFacts | AfLiveStatusFacts;
export type AfBridgeFailureReason =
  | "unsupported-platform"
  | "missing-executable"
  | "policy-unavailable"
  | "preflight-failed"
  | "runtime-mismatch"
  | "operation-not-ready"
  | "cancelled"
  | "timeout"
  | "malformed"
  | "oversized"
  | "non-zero"
  | "signaled"
  | "cleanup-failure"
  | "audit-failure";

export type AfBridgeResult<T = AfBridgeFacts> = Readonly<{
  state: AfBridgeState;
  structuralStatus: null;
  compatibility?: AfCompatibilityMetadata;
  facts?: T;
  reason?: AfBridgeFailureReason;
  diagnostic?: "platform" | "executable" | "policy" | "preflight" | "operation" | "cleanup" | "audit";
}>;

export type AfBridgeExecutor = Pick<AfProcessExecutor, "execute" | "executePreflight"> &
  Readonly<{ isInvalidated: boolean }>;

export type AfBridgeExecutorOptions = Readonly<{
  adapter: AfExecutionPolicyAdapter | undefined;
  executable: string;
  workspace: string;
  parsers: AfOutputParserSet;
}>;

export type AfRuntimeBridgeOptions = Readonly<{
  platform: NodeJS.Platform;
  architecture: "arm64" | "x64" | "arm" | "ia32";
  resolveExecutable: () => string | undefined | Promise<string | undefined>;
  policy: AfExecutionPolicyAdapter | undefined;
  proofStore: ProofWorkspaceStore;
  /**
   * Mode-selected parsers. The production default is the live parser set, so
   * fixture-shaped evidence is never promoted by a production caller.
   */
  parsers?: AfOutputParserSet;
  preflightCwd: string;
  createExecutor?: (options: AfBridgeExecutorOptions) => AfBridgeExecutor;
}>;

const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;
const SUPPORTED_ARCHITECTURES = ["arm64", "x64", "arm", "ia32"] as const;

const result = <T>(value: Omit<AfBridgeResult<T>, "structuralStatus">): AfBridgeResult<T> => ({
  ...value,
  structuralStatus: null,
});

const failureReason = (value: AfProcessResult<unknown>): AfBridgeFailureReason => {
  if (value.ok) return "operation-not-ready";
  if (value.classification.outcome === "audit-failed")
    return value.diagnostic === "cleanup" ? "cleanup-failure" : "audit-failure";
  return value.diagnostic === "policy" ? "policy-unavailable" : value.diagnostic;
};

const failureDiagnostic = (reason: AfBridgeFailureReason): AfBridgeResult["diagnostic"] =>
  reason === "cleanup-failure"
    ? "cleanup"
    : reason === "audit-failure"
      ? "audit"
      : reason === "preflight-failed" || reason === "runtime-mismatch"
        ? "preflight"
        : reason === "unsupported-platform"
          ? "platform"
          : reason === "missing-executable"
            ? "executable"
            : reason === "policy-unavailable"
              ? "policy"
              : "operation";

/** Missing, malformed, oversized, unsafe, or fixture-shaped live evidence stays dormant. */
const compatibilityFailureReason = (reason: AfCompatibilityReason): AfBridgeFailureReason =>
  reason === "oversized-evidence"
    ? "oversized"
    : reason === "unsupported-platform" || reason === "unsupported-architecture"
      ? "unsupported-platform"
      : "malformed";

const defaultCreateExecutor = (options: AfBridgeExecutorOptions): AfBridgeExecutor =>
  createAfProcessExecutor({
    adapter: options.adapter,
    commandContext: { executable: options.executable, workspace: options.workspace },
    parsers: options.parsers,
  });

/** Host-private AF bridge. Construction is intentionally side-effect free. */
export class VibefeldRuntimeBridge {
  private state: AfBridgeState = "dormant";
  private workspace?: ProofWorkspaceHandle;
  private executor?: AfBridgeExecutor;
  private initialized = false;
  private compatibility?: AfCompatibilityMetadata;
  private readonly parsers: AfOutputParserSet;

  constructor(private readonly options: AfRuntimeBridgeOptions) {
    this.parsers = options.parsers ?? createProductionAfOutputParsers();
  }

  getState(): AfBridgeState {
    return this.state;
  }

  async preflight(): Promise<AfBridgeResult<never>> {
    if (this.state === "audit-failed" || this.state === "ready" || this.state === "running") {
      return result({
        state: this.state,
        ...(this.state === "ready" || this.state === "running" ? { compatibility: this.compatibility } : {}),
        reason: this.state === "audit-failed" ? "audit-failure" : undefined,
        diagnostic: this.state === "audit-failed" ? "audit" : undefined,
      });
    }
    this.state = "preflighting";
    if (
      !SUPPORTED_PLATFORMS.includes(this.options.platform as (typeof SUPPORTED_PLATFORMS)[number]) ||
      !SUPPORTED_ARCHITECTURES.includes(this.options.architecture)
    ) {
      this.state = "unavailable";
      return result({ state: this.state, reason: "unsupported-platform", diagnostic: "platform" });
    }
    if (
      !this.options.policy ||
      this.options.policy.platform !== this.options.platform ||
      this.options.policy.readiness.state !== "ready"
    ) {
      this.state = "unavailable";
      return result({ state: this.state, reason: "policy-unavailable", diagnostic: "policy" });
    }
    let executable: string | undefined;
    try {
      executable = await this.options.resolveExecutable();
    } catch {
      this.state = "unavailable";
      return result({ state: this.state, reason: "missing-executable", diagnostic: "executable" });
    }
    if (!executable) {
      this.state = "unavailable";
      return result({ state: this.state, reason: "missing-executable", diagnostic: "executable" });
    }
    const preflight = this.createPreflightExecutor(executable);
    const version = await preflight.executePreflight<AfLiveVersionFacts>(
      { operation: "version" },
      { cwd: this.options.preflightCwd },
    );
    if (!version.ok) return this.failPreflight(version);
    const schema = await preflight.executePreflight<AfLiveSchemaFacts>(
      { operation: "schema" },
      { cwd: this.options.preflightCwd },
    );
    if (!schema.ok) return this.failPreflight(schema);
    const compatibility = classifyAfCompatibility({
      platform: this.options.platform,
      architecture: this.options.architecture,
      version: version.facts,
      schema: schema.facts,
    });
    if (compatibility.state !== "available") return this.failCompatibility(compatibility);
    this.compatibility = compatibility.metadata;
    // Security ordering: no proof root is allocated until compatibility passes.
    try {
      this.workspace = await this.options.proofStore.allocate();
      const root = this.options.proofStore.resolvePath(this.workspace);
      this.executor = (this.options.createExecutor ?? defaultCreateExecutor)({
        adapter: this.options.policy,
        executable,
        workspace: root,
        parsers: this.parsers,
      });
      this.state = "ready";
      return result({ state: this.state, compatibility: this.compatibility });
    } catch {
      this.state = "audit-failed";
      return result({ state: this.state, reason: "audit-failure", diagnostic: "audit" });
    }
  }

  async run(operation: AfBridgeOperation, signal?: AbortSignal): Promise<AfBridgeResult> {
    if (this.executor?.isInvalidated) {
      this.state = "audit-failed";
      return result({ state: this.state, reason: "audit-failure", diagnostic: "audit" });
    }
    if (this.state !== "ready" || !this.executor || !this.workspace || this.executor.isInvalidated) {
      return result({
        state: this.state === "audit-failed" ? "audit-failed" : "unavailable",
        reason: this.state === "audit-failed" ? "audit-failure" : "operation-not-ready",
        diagnostic: this.state === "audit-failed" ? "audit" : "operation",
      });
    }
    if (operation.operation === "status" && !this.initialized) {
      return result({ state: "ready", reason: "operation-not-ready", diagnostic: "operation" });
    }
    this.state = "running";
    const value = await this.executor.execute(operation, signal);
    if (!value.ok) {
      const reason = failureReason(value);
      this.state = value.classification.outcome === "audit-failed" ? "audit-failed" : "unavailable";
      return result({ state: this.state, reason, diagnostic: failureDiagnostic(reason) });
    }
    this.state = "ready";
    if (operation.operation === "init") this.initialized = true;
    return result({ state: this.state, compatibility: this.compatibility, facts: value.facts as AfBridgeFacts });
  }

  async teardown(): Promise<AfBridgeResult<never>> {
    if (!this.workspace) return result({ state: this.state });
    const cleanup = await this.options.proofStore.cleanup(this.workspace);
    this.workspace = undefined;
    this.executor = undefined;
    if (!cleanup.ok) {
      this.state = "audit-failed";
      return result({ state: this.state, reason: "cleanup-failure", diagnostic: "cleanup" });
    }
    this.state = "unavailable";
    return result({ state: this.state });
  }

  private createPreflightExecutor(executable: string): AfBridgeExecutor {
    return (this.options.createExecutor ?? defaultCreateExecutor)({
      adapter: this.options.policy,
      executable,
      workspace: this.options.preflightCwd,
      parsers: this.parsers,
    });
  }

  private failPreflight(value: AfProcessResult<unknown>): AfBridgeResult<never> {
    const reason = failureReason(value);
    this.state = value.ok || value.classification.outcome !== "audit-failed" ? "unavailable" : "audit-failed";
    return result({
      state: this.state,
      reason: reason === "operation-not-ready" ? "preflight-failed" : reason,
      diagnostic: "preflight",
    });
  }

  private failCompatibility(
    compatibility: Exclude<AfCompatibilityResult, { state: "available" }>,
  ): AfBridgeResult<never> {
    if (compatibility.state === "incompatible") {
      this.state = "incompatible";
      return result({ state: this.state, reason: "runtime-mismatch", diagnostic: "preflight" });
    }
    const reason = compatibilityFailureReason(compatibility.reason);
    this.state = "unavailable";
    return result({
      state: this.state,
      reason,
      diagnostic: reason === "unsupported-platform" ? "platform" : "preflight",
    });
  }
}

export const createVibefeldRuntimeBridge = (options: AfRuntimeBridgeOptions): VibefeldRuntimeBridge =>
  new VibefeldRuntimeBridge(options);
