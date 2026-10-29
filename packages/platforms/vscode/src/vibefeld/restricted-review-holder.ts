import type { OpenCodeAgent, RestrictedReviewProvider } from "@opencode-chat/agent-opencode";
import type { ReasoningReviewRuntime } from "@opencode-chat/core";
import { createReasoningDiagnosticClock } from "./reasoning-diagnostics";
import type { IReasoningReviewController } from "./reasoning-review-controller";
import type { ReasoningAssistRestrictedReviewAdapter } from "./restricted-review-adapter";

type RestrictedReviewProviderResolution = Awaited<
  ReturnType<OpenCodeAgent["createRestrictedReviewProviderForNativeDefault"]>
>;

export type RestrictedReviewBinding = Readonly<{
  adapter: ReasoningAssistRestrictedReviewAdapter;
  controller?: IReasoningReviewController;
}>;

export type RestrictedReviewHolderSnapshot = Readonly<{
  runtime: ReasoningReviewRuntime;
  adapter?: ReasoningAssistRestrictedReviewAdapter;
  controller?: IReasoningReviewController;
}>;

export type RestrictedReviewHolderOptions = Readonly<{
  afRuntime: ReasoningReviewRuntime;
  createProvider: () => Promise<RestrictedReviewProviderResolution>;
  createBinding: (provider: RestrictedReviewProvider) => Promise<RestrictedReviewBinding>;
  cancelWork?: () => void;
  onChange?: (snapshot: RestrictedReviewHolderSnapshot) => void;
  report?: (
    stage: "provider" | "adapter",
    outcome: "ready" | "missing-model" | "provider-unavailable" | "readiness-rejected" | "af-unavailable",
    elapsedMs?: number,
  ) => void;
  now?: () => number;
}>;

const CHECKING_RUNTIME: ReasoningReviewRuntime = { state: "checking", reason: "readiness-checking" };
const DISCONNECTED_RUNTIME: ReasoningReviewRuntime = { state: "unavailable", reason: "server-unavailable" };
const AVAILABLE_RUNTIME: ReasoningReviewRuntime = { state: "available" };

function unavailable(reason: string): ReasoningReviewRuntime {
  return { state: "unavailable", reason };
}

function elapsed(now: () => number, startedAt: number): number | undefined {
  try {
    const value = now() - startedAt;
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Owns only the current generation's restricted provider and adapter. AF is a
 * settled activation-time input; every native provider/readiness result is
 * connection-scoped and discarded if a newer lifecycle operation supersedes it.
 */
export class RestrictedReviewHolder {
  private revision = 0;
  private runtime: ReasoningReviewRuntime = DISCONNECTED_RUNTIME;
  private provider: RestrictedReviewProvider | undefined;
  private binding: RestrictedReviewBinding | undefined;
  private cleanup: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly options: RestrictedReviewHolderOptions) {
    this.now = createReasoningDiagnosticClock(options.now);
  }

  getSnapshot(): RestrictedReviewHolderSnapshot {
    const binding = this.runtime.state === "available" ? this.binding : undefined;
    return {
      runtime: this.runtime,
      ...(binding ? { adapter: binding.adapter } : {}),
      ...(binding?.controller ? { controller: binding.controller } : {}),
    };
  }

  async rebind(): Promise<void> {
    const revision = ++this.revision;
    this.cancelWork();
    const cleanup = this.clearCurrent();
    this.publish(CHECKING_RUNTIME);
    await cleanup;
    if (!this.isCurrent(revision)) return;
    if (this.options.afRuntime.state !== "available") {
      this.report("adapter", "af-unavailable");
      this.publish(this.options.afRuntime);
      return;
    }

    const providerStartedAt = this.now();
    let resolution: RestrictedReviewProviderResolution;
    try {
      resolution = await this.options.createProvider();
    } catch {
      this.report("provider", "provider-unavailable", providerStartedAt);
      this.report("adapter", "provider-unavailable", providerStartedAt);
      if (this.isCurrent(revision)) this.publish(unavailable("restricted-review-unavailable"));
      return;
    }
    if (!this.isCurrent(revision)) {
      if (resolution.ok) resolution.provider.invalidate();
      return;
    }
    if (!resolution.ok) {
      const outcome =
        resolution.reason === "model-unavailable" || resolution.reason === "model-invalid"
          ? "missing-model"
          : "provider-unavailable";
      this.report("provider", outcome, providerStartedAt);
      this.report("adapter", outcome, providerStartedAt);
      this.publish(unavailable(resolution.reason));
      return;
    }

    const provider = resolution.provider;
    this.provider = provider;
    let ready = false;
    try {
      ready = (await provider.checkReadiness()) === true && provider.isReady();
    } catch {
      ready = false;
    }
    this.report("provider", ready ? "ready" : "readiness-rejected", providerStartedAt);
    if (!this.isCurrent(revision)) {
      provider.invalidate();
      return;
    }
    if (!ready) {
      this.clearCurrent();
      this.report("adapter", "readiness-rejected", providerStartedAt);
      this.publish(unavailable("restricted-agent-unavailable"));
      return;
    }
    const adapterStartedAt = this.now();
    let binding: RestrictedReviewBinding;
    try {
      binding = await this.options.createBinding(provider);
    } catch {
      if (!this.isCurrent(revision) || this.provider !== provider) {
        provider.invalidate();
        return;
      }
      const cleanup = this.clearCurrent();
      this.report("adapter", "provider-unavailable", adapterStartedAt);
      await cleanup;
      if (this.isCurrent(revision)) this.publish(unavailable("restricted-adapter-unavailable"));
      return;
    }
    if (!this.isCurrent(revision)) {
      provider.invalidate();
      await this.disposeBinding(binding);
      return;
    }
    if (!provider.isReady()) {
      provider.invalidate();
      if (this.provider === provider) this.provider = undefined;
      await this.disposeBinding(binding);
      if (this.isCurrent(revision)) this.publish(unavailable("restricted-agent-unavailable"));
      return;
    }
    this.binding = binding;
    this.provider = provider;
    this.report("adapter", "ready", adapterStartedAt);
    this.publish(this.options.afRuntime.state === "available" ? AVAILABLE_RUNTIME : this.options.afRuntime);
  }

  /** Invalidate the active generation before server stop/failure or teardown. */
  invalidate(reason = "server-unavailable", publish = true): Promise<void> {
    this.revision += 1;
    this.cancelWork();
    const cleanup = this.clearCurrent();
    if (publish) this.publish(unavailable(reason));
    return cleanup;
  }

  async dispose(): Promise<void> {
    await this.invalidate("runtime-unavailable", false);
  }

  private isCurrent(revision: number): boolean {
    return revision === this.revision;
  }

  private cancelWork(): void {
    try {
      this.options.cancelWork?.();
    } catch {
      // Optional host cancellation is best effort; holder revision still rejects late results.
    }
  }

  private publish(runtime: ReasoningReviewRuntime): void {
    this.runtime = runtime;
    try {
      this.options.onChange?.(this.getSnapshot());
    } catch {
      // Readiness publication never changes ordinary Chat behavior.
    }
  }

  private report(
    stage: "provider" | "adapter",
    outcome: "ready" | "missing-model" | "provider-unavailable" | "readiness-rejected" | "af-unavailable",
    startedAt?: number,
  ): void {
    try {
      this.options.report?.(stage, outcome, startedAt === undefined ? undefined : elapsed(this.now, startedAt));
    } catch {
      // Diagnostics are optional and bounded by the caller.
    }
  }

  private clearCurrent(): Promise<void> {
    const provider = this.provider;
    const binding = this.binding;
    this.provider = undefined;
    this.binding = undefined;
    provider?.invalidate();
    if (!binding) return this.cleanup;
    const cleanup = this.cleanup.then(async () => this.disposeBinding(binding));
    this.cleanup = cleanup.catch(() => undefined);
    return this.cleanup;
  }

  private async disposeBinding(binding: RestrictedReviewBinding): Promise<void> {
    try {
      await binding.adapter.dispose();
    } catch {
      // Adapter disposal is bounded and best effort; no stale binding is retained.
    }
  }
}
