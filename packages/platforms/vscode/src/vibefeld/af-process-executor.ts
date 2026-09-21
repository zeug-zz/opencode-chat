import { type AfCommandContext, type AfCommandOperation, createAfCommandSchema } from "./af-command-schema";
import {
  type AfExecutionPolicyAdapter,
  type AfPolicyExecutionFact,
  type AfPolicyIoLimits,
  type AfPreflightDescriptor,
  buildAfPolicyDescriptor,
  buildAfPreflightDescriptor,
} from "./af-execution-boundary";
import {
  type AfOutputExecution,
  type AfOutputResult,
  parseAfInitOutput,
  parseAfSchemaOutput,
  parseAfStatusOutput,
  parseAfVersionOutput,
} from "./af-output-schema";
import {
  AF_FIXTURE_LIMITS,
  type AfResultClassification,
  type AfRuntimeResultKind,
  classifyAfRuntimeResult,
} from "./af-runtime-contract";

const OPERATION_TIMEOUTS_MS = Object.freeze({ version: 5_000, schema: 5_000, init: 15_000, status: 5_000 });
const CLEANUP_TIMEOUT_MS = 2_000;
const IO_LIMITS: AfPolicyIoLimits = Object.freeze({
  stdinBytes: AF_FIXTURE_LIMITS.jsonBytes,
  stdoutBytes: AF_FIXTURE_LIMITS.jsonBytes,
  stderrBytes: AF_FIXTURE_LIMITS.jsonBytes,
});

type AfOperationName = AfCommandOperation["operation"];
type AfParsedResult = AfOutputResult<unknown>;

export type AfProcessFailure = Readonly<{
  ok: false;
  classification: Extract<AfResultClassification, { outcome: "unavailable" | "audit-failed" }>;
  diagnostic: "policy" | "timeout" | "cancelled" | "signal" | "non-zero" | "malformed" | "oversized" | "cleanup";
}>;

export type AfProcessSuccess<T> = Readonly<{
  ok: true;
  operation: AfOperationName;
  facts: T;
  structuralStatus: null;
}>;

export type AfProcessResult<T = unknown> = AfProcessSuccess<T> | AfProcessFailure;

export type AfProcessExecutorOptions = Readonly<{
  adapter: AfExecutionPolicyAdapter | undefined;
  commandContext: AfCommandContext;
  readOnlyRuntimeGrants: readonly { path: string }[];
  reviewRootWriteGrant: { path: string };
}>;

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

const boundedOutput = (value: string | undefined): boolean =>
  value === undefined || (typeof value === "string" && utf8Bytes(value) <= IO_LIMITS.stdoutBytes);

const executionForParser = (fact: AfPolicyExecutionFact): AfOutputExecution => ({
  exitCode: fact.exitCode,
  signal: fact.signal,
  timedOut: fact.outcome === "timed-out",
  cancelled: fact.outcome === "cancelled",
});

const failure = (
  kind: Exclude<AfRuntimeResultKind, "success">,
  diagnostic: AfProcessFailure["diagnostic"],
): AfProcessFailure => ({
  ok: false,
  classification: classifyAfRuntimeResult(kind) as AfProcessFailure["classification"],
  diagnostic,
});

const parserFor = (operation: AfOperationName) => {
  switch (operation) {
    case "version":
      return parseAfVersionOutput;
    case "schema":
      return parseAfSchemaOutput;
    case "init":
      return parseAfInitOutput;
    case "status":
      return parseAfStatusOutput;
  }
};

const parserFailure = (result: AfParsedResult): AfProcessFailure | undefined => {
  if (result.ok) return undefined;
  const reason = result.failure.reason;
  const diagnostic =
    reason === "timeout"
      ? "timeout"
      : reason === "cancelled"
        ? "cancelled"
        : reason === "signaled"
          ? "signal"
          : reason === "non-zero"
            ? "non-zero"
            : reason === "oversized"
              ? "oversized"
              : "malformed";
  return failure(reason, diagnostic);
};

/**
 * Host-private executor for the fixed AF commands. It has no process fallback:
 * all child creation and termination belongs to the supplied policy adapter.
 */
export class AfProcessExecutor {
  private invalidated = false;
  private cleanupPromise?: Promise<AfProcessFailure | undefined>;
  private readonly options: AfProcessExecutorOptions;
  private readonly commands: ReturnType<typeof createAfCommandSchema>;

  constructor(options: AfProcessExecutorOptions) {
    this.options = options;
    this.commands = createAfCommandSchema(options.commandContext);
  }

  get isInvalidated(): boolean {
    return this.invalidated;
  }

  async execute<T = unknown>(operation: AfCommandOperation, signal?: AbortSignal): Promise<AfProcessResult<T>> {
    if (this.invalidated) return failure("audit-failure", "cleanup");
    if (signal?.aborted) return failure("cancelled", "cancelled");

    const adapter = this.options.adapter;
    let descriptorResult: ReturnType<typeof buildAfPolicyDescriptor>;
    try {
      const launch = this.commands.build(operation);
      descriptorResult = buildAfPolicyDescriptor(adapter, {
        executable: launch.executable,
        argv: launch.argv,
        cwd: launch.cwd ?? this.options.commandContext.workspace,
        readOnlyRuntimeGrants: this.options.readOnlyRuntimeGrants,
        reviewRootWriteGrant: this.options.reviewRootWriteGrant,
      });
    } catch {
      return failure("policy-failure", "policy");
    }
    if (!descriptorResult.available || adapter === undefined) return failure("policy-failure", "policy");

    const controller = new AbortController();
    let resolveCancellation: ((fact: AfPolicyExecutionFact) => void) | undefined;
    const cancellation = new Promise<AfPolicyExecutionFact>((resolve) => {
      resolveCancellation = resolve;
    });
    const abort = () => {
      controller.abort();
      resolveCancellation?.({ outcome: "cancelled" });
    };
    signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    let resolveTimeout: ((fact: AfPolicyExecutionFact) => void) | undefined;
    const deadline = new Promise<AfPolicyExecutionFact>((resolve) => {
      resolveTimeout = resolve;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolveTimeout?.({ outcome: "timed-out" });
    }, OPERATION_TIMEOUTS_MS[operation.operation]);
    const launch = adapter.launch(descriptorResult.descriptor, controller.signal, IO_LIMITS).catch(() => undefined);
    const fact = await Promise.race([launch, deadline, cancellation]);
    if (!fact) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      return failure("policy-failure", "policy");
    }
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);

    const timedOutFact = timedOut || fact.outcome === "timed-out";
    const cancelledFact = !timedOutFact && (signal?.aborted || fact.outcome === "cancelled");
    if (timedOutFact || cancelledFact) {
      const cleanupFailure = await this.terminateAndReapOnce();
      if (cleanupFailure) return cleanupFailure;
      this.cleanupPromise = undefined;
      return failure(timedOutFact ? "timeout" : "cancelled", timedOutFact ? "timeout" : "cancelled");
    }

    if (fact.outcome === "signaled") return failure("signaled", "signal");
    if (!boundedOutput(fact.stdout) || !boundedOutput(fact.stderr ?? "")) return failure("oversized", "oversized");
    const parsed = parserFor(operation.operation)(fact.stdout ?? "", executionForParser(fact));
    if (!parsed.ok) return parserFailure(parsed) as AfProcessFailure;
    return { ok: true, operation: operation.operation, facts: parsed.facts as T, structuralStatus: null };
  }

  /** Execute only version/schema before a proof root is allocated. */
  async executePreflight<T = unknown>(
    operation: Extract<AfCommandOperation, { operation: "version" | "schema" }>,
    preflight: Readonly<{ cwd: string; readOnlyRuntimeGrants: readonly { path: string }[] }>,
    signal?: AbortSignal,
  ): Promise<AfProcessResult<T>> {
    if (this.invalidated || signal?.aborted)
      return failure(signal?.aborted ? "cancelled" : "audit-failure", signal?.aborted ? "cancelled" : "cleanup");
    const adapter = this.options.adapter;
    if (!adapter?.launchPreflight) return failure("policy-failure", "policy");
    let descriptor: AfPreflightDescriptor;
    try {
      const launch = this.commands.build(operation);
      const result = buildAfPreflightDescriptor(adapter, {
        executable: launch.executable,
        argv: launch.argv,
        cwd: preflight.cwd,
        readOnlyRuntimeGrants: preflight.readOnlyRuntimeGrants,
      });
      if (!result.available) return failure("policy-failure", "policy");
      descriptor = result.descriptor;
    } catch {
      return failure("policy-failure", "policy");
    }
    const controller = new AbortController();
    let resolveCancellation: ((fact: AfPolicyExecutionFact) => void) | undefined;
    const cancellation = new Promise<AfPolicyExecutionFact>((resolve) => {
      resolveCancellation = resolve;
    });
    const abort = () => {
      controller.abort();
      resolveCancellation?.({ outcome: "cancelled" });
    };
    signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    let resolveTimeout: ((fact: AfPolicyExecutionFact) => void) | undefined;
    const deadline = new Promise<AfPolicyExecutionFact>((resolve) => {
      resolveTimeout = resolve;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolveTimeout?.({ outcome: "timed-out" });
    }, OPERATION_TIMEOUTS_MS[operation.operation]);
    const launch = adapter.launchPreflight(descriptor, controller.signal, IO_LIMITS).catch(() => undefined);
    const fact = await Promise.race([launch, deadline, cancellation]);
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    if (!fact) return failure("policy-failure", "policy");
    const timedOutFact = timedOut || fact.outcome === "timed-out";
    const cancelledFact = !timedOutFact && (signal?.aborted || fact.outcome === "cancelled");
    if (timedOutFact || cancelledFact) {
      const cleanupFailure = await this.terminateAndReapOnce();
      if (cleanupFailure) return cleanupFailure;
      this.cleanupPromise = undefined;
      return failure(timedOutFact ? "timeout" : "cancelled", timedOutFact ? "timeout" : "cancelled");
    }
    if (fact.outcome === "signaled") return failure("signaled", "signal");
    if (!boundedOutput(fact.stdout) || !boundedOutput(fact.stderr ?? "")) return failure("oversized", "oversized");
    const parsed = parserFor(operation.operation)(fact.stdout ?? "", executionForParser(fact));
    if (!parsed.ok) return parserFailure(parsed) as AfProcessFailure;
    return { ok: true, operation: operation.operation, facts: parsed.facts as T, structuralStatus: null };
  }

  private async terminateAndReapOnce(): Promise<AfProcessFailure | undefined> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = (async () => {
      const adapter = this.options.adapter;
      if (!adapter) {
        this.invalidated = true;
        return failure("audit-failure", "cleanup");
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const cleanup = adapter.terminateAndReap();
        const result = await Promise.race([
          cleanup,
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), CLEANUP_TIMEOUT_MS);
          }),
        ]);
        if (result === "timeout" || result.outcome === "failed") throw new Error("cleanup incomplete");
        return undefined;
      } catch {
        this.invalidated = true;
        return failure("audit-failure", "cleanup");
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    return this.cleanupPromise;
  }
}

export const createAfProcessExecutor = (options: AfProcessExecutorOptions): AfProcessExecutor =>
  new AfProcessExecutor(options);
