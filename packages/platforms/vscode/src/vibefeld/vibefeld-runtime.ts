import type { AfCommandOperation } from "./af-command-schema";
import type { AfExecutionPolicyAdapter } from "./af-execution-boundary";
import type { AfInitFacts, AfSchemaFacts, AfStatusFacts, AfVersionFacts } from "./af-output-schema";
import { type AfProcessExecutor, type AfProcessResult, createAfProcessExecutor } from "./af-process-executor";
import { parseAfFixtureJson } from "./af-runtime-contract";
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
export type AfBridgeFacts = AfInitFacts | AfStatusFacts;
export type AfBridgeFailureReason =
  | "unsupported-platform"
  | "fixture-invalid"
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
  compatibility?: Readonly<{
    fixtureSchema: "af-runtime-fixture-1";
    version: "0.1.7";
    commit: "5a37413";
    workspaceFormat: "1.0";
  }>;
  facts?: T;
  reason?: AfBridgeFailureReason;
  diagnostic?: "fixture" | "platform" | "executable" | "policy" | "preflight" | "operation" | "cleanup" | "audit";
}>;

export type AfBridgeExecutor = Pick<AfProcessExecutor, "execute" | "executePreflight"> &
  Readonly<{ isInvalidated: boolean }>;

export type AfRuntimeBridgeOptions = Readonly<{
  fixtureJson: string;
  platform: NodeJS.Platform;
  architecture: "arm64" | "x64" | "arm" | "ia32";
  resolveExecutable: () => string | undefined | Promise<string | undefined>;
  policy: AfExecutionPolicyAdapter | undefined;
  proofStore: ProofWorkspaceStore;
  readOnlyRuntimeGrants: readonly { path: string }[];
  preflightCwd: string;
  createExecutor?: (options: {
    adapter: AfExecutionPolicyAdapter | undefined;
    executable: string;
    workspace: string;
    readOnlyRuntimeGrants: readonly { path: string }[];
    reviewRootWriteGrant: { path: string };
  }) => AfBridgeExecutor;
}>;

const compatibility = {
  fixtureSchema: "af-runtime-fixture-1",
  version: "0.1.7",
  commit: "5a37413",
  workspaceFormat: "1.0",
} as const;

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
              : reason === "fixture-invalid"
                ? "fixture"
                : "operation";

/** Host-private AF bridge. Construction is intentionally side-effect free. */
export class VibefeldRuntimeBridge {
  private state: AfBridgeState = "dormant";
  private workspace?: ProofWorkspaceHandle;
  private executor?: AfBridgeExecutor;
  private initialized = false;

  constructor(private readonly options: AfRuntimeBridgeOptions) {}

  getState(): AfBridgeState {
    return this.state;
  }

  async preflight(): Promise<AfBridgeResult<never>> {
    if (this.state === "audit-failed" || this.state === "ready" || this.state === "running") {
      return result({
        state: this.state,
        ...(this.state === "ready" || this.state === "running" ? { compatibility } : {}),
        reason: this.state === "audit-failed" ? "audit-failure" : undefined,
        diagnostic: this.state === "audit-failed" ? "audit" : undefined,
      });
    }
    this.state = "preflighting";
    const fixture = parseAfFixtureJson(this.options.fixtureJson);
    if (!fixture.ok) {
      this.state = "incompatible";
      return result({ state: this.state, reason: "fixture-invalid", diagnostic: "fixture" });
    }
    if (this.options.platform !== "darwin" && this.options.platform !== "linux") {
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
    const version = await preflight.executePreflight<AfVersionFacts>(
      { operation: "version" },
      {
        cwd: this.options.preflightCwd,
        readOnlyRuntimeGrants: this.options.readOnlyRuntimeGrants,
      },
    );
    if (!version.ok) return this.failPreflight(version);
    const schema = await preflight.executePreflight<AfSchemaFacts>(
      { operation: "schema" },
      {
        cwd: this.options.preflightCwd,
        readOnlyRuntimeGrants: this.options.readOnlyRuntimeGrants,
      },
    );
    if (!schema.ok) return this.failPreflight(schema);
    if (
      version.facts.operatingSystem !== this.options.platform ||
      version.facts.architecture !== this.options.architecture ||
      schema.facts.workspaceFormat !== "1.0"
    ) {
      this.state = "incompatible";
      return result({ state: this.state, reason: "runtime-mismatch", diagnostic: "preflight" });
    }
    // Security ordering: no proof root is allocated until both compatibility operations pass.
    try {
      this.workspace = await this.options.proofStore.allocate();
      const root = this.options.proofStore.resolvePath(this.workspace);
      this.executor = (
        this.options.createExecutor ??
        ((executorOptions) =>
          createAfProcessExecutor({
            adapter: executorOptions.adapter,
            commandContext: { executable: executorOptions.executable, workspace: executorOptions.workspace },
            readOnlyRuntimeGrants: executorOptions.readOnlyRuntimeGrants,
            reviewRootWriteGrant: executorOptions.reviewRootWriteGrant,
          }))
      )({
        adapter: this.options.policy,
        executable,
        workspace: root,
        readOnlyRuntimeGrants: this.options.readOnlyRuntimeGrants,
        reviewRootWriteGrant: { path: root },
      });
      this.state = "ready";
      return result({ state: this.state, compatibility });
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
    return result({ state: this.state, compatibility, facts: value.facts as AfBridgeFacts });
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
    return (
      this.options.createExecutor ??
      ((executorOptions) =>
        createAfProcessExecutor({
          adapter: executorOptions.adapter,
          commandContext: { executable: executorOptions.executable, workspace: executorOptions.workspace },
          readOnlyRuntimeGrants: executorOptions.readOnlyRuntimeGrants,
          reviewRootWriteGrant: executorOptions.reviewRootWriteGrant,
        }))
    )({
      adapter: this.options.policy,
      executable,
      workspace: this.options.preflightCwd,
      readOnlyRuntimeGrants: this.options.readOnlyRuntimeGrants,
      reviewRootWriteGrant: { path: this.options.preflightCwd },
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
}

export const createVibefeldRuntimeBridge = (options: AfRuntimeBridgeOptions): VibefeldRuntimeBridge =>
  new VibefeldRuntimeBridge(options);
