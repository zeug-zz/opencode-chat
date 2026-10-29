import type { OpenCodeAgent, RestrictedReviewProvider } from "@opencode-chat/agent-opencode";
import type { ReasoningReviewRuntime } from "@opencode-chat/core";
import { describe, expect, it, vi } from "vitest";
import type { IReasoningReviewController } from "../vibefeld/reasoning-review-controller";
import type { ReasoningAssistRestrictedReviewAdapter } from "../vibefeld/restricted-review-adapter";
import { RestrictedReviewHolder } from "../vibefeld/restricted-review-holder";

type RestrictedReviewProviderResolution = Awaited<
  ReturnType<OpenCodeAgent["createRestrictedReviewProviderForNativeDefault"]>
>;

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeProvider(ready = true) {
  let isReady = ready;
  const provider = {
    checkReadiness: vi.fn(async () => ready),
    isReady: vi.fn(() => isReady),
    invalidate: vi.fn(() => {
      isReady = false;
    }),
  } as unknown as RestrictedReviewProvider;
  return { provider, setReady: (value: boolean) => (isReady = value) };
}

function makeBinding() {
  const adapter = {
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReasoningAssistRestrictedReviewAdapter;
  const controller = {
    getRuntime: vi.fn().mockResolvedValue({ state: "available" }),
  } as unknown as IReasoningReviewController;
  return { adapter, controller };
}

const availableAf: ReasoningReviewRuntime = { state: "available" };

describe("RestrictedReviewHolder", () => {
  it("publishes checking then ready only after generation-bound provider readiness", async () => {
    const { provider } = makeProvider();
    const binding = makeBinding();
    const snapshots: ReasoningReviewRuntime[] = [];
    const report = vi.fn();
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async (): Promise<RestrictedReviewProviderResolution> => ({ ok: true, provider }),
      createBinding: async () => binding,
      onChange: (snapshot) => snapshots.push(snapshot.runtime),
      report,
      now: (() => {
        let now = 10;
        return () => now++;
      })(),
    });

    await holder.rebind();

    expect(snapshots).toEqual([{ state: "checking", reason: "readiness-checking" }, { state: "available" }]);
    expect(holder.getSnapshot()).toEqual({
      runtime: { state: "available" },
      adapter: binding.adapter,
      controller: binding.controller,
    });
  });

  it("keeps a newer ready binding when an older binding construction rejects late", async () => {
    const old = makeProvider();
    const current = makeProvider();
    const oldBinding = deferred<ReturnType<typeof makeBinding>>();
    const currentBinding = makeBinding();
    let providerIndex = 0;
    const createBinding = vi.fn((provider: RestrictedReviewProvider) =>
      provider === old.provider ? oldBinding.promise : Promise.resolve(currentBinding),
    );
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: true, provider: providerIndex++ === 0 ? old.provider : current.provider }),
      createBinding,
    });

    const oldRebind = holder.rebind();
    await vi.waitFor(() => expect(createBinding).toHaveBeenCalledWith(old.provider));
    await holder.rebind();
    expect(holder.getSnapshot()).toEqual({
      runtime: { state: "available" },
      adapter: currentBinding.adapter,
      controller: currentBinding.controller,
    });

    oldBinding.reject(new Error("old adapter construction failed"));
    await oldRebind;

    expect(holder.getSnapshot()).toEqual({
      runtime: { state: "available" },
      adapter: currentBinding.adapter,
      controller: currentBinding.controller,
    });
    expect(old.provider.invalidate).toHaveBeenCalled();
    expect(current.provider.invalidate).not.toHaveBeenCalled();
    expect(currentBinding.adapter.dispose).not.toHaveBeenCalled();
    await holder.dispose();
  });

  it("keeps a newer ready binding when an older not-ready binding disposal resolves late", async () => {
    const old = makeProvider();
    const current = makeProvider();
    const currentBinding = makeBinding();
    const oldDisposal = deferred<void>();
    const oldDispose = vi.fn(() => oldDisposal.promise);
    const oldBinding = {
      ...makeBinding(),
      adapter: { dispose: oldDispose } as unknown as ReasoningAssistRestrictedReviewAdapter,
    };
    let providerIndex = 0;
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: true, provider: providerIndex++ === 0 ? old.provider : current.provider }),
      createBinding: async (provider) => {
        if (provider === old.provider) {
          old.setReady(false);
          return oldBinding;
        }
        return currentBinding;
      },
    });

    const oldRebind = holder.rebind();
    await vi.waitFor(() => expect(oldBinding.adapter.dispose).toHaveBeenCalledTimes(1));
    await holder.rebind();
    expect(holder.getSnapshot()).toEqual({
      runtime: { state: "available" },
      adapter: currentBinding.adapter,
      controller: currentBinding.controller,
    });

    oldDisposal.resolve(undefined);
    await oldRebind;

    expect(holder.getSnapshot()).toEqual({
      runtime: { state: "available" },
      adapter: currentBinding.adapter,
      controller: currentBinding.controller,
    });
    expect(current.provider.invalidate).not.toHaveBeenCalled();
    expect(currentBinding.adapter.dispose).not.toHaveBeenCalled();
    expect(old.provider.invalidate).toHaveBeenCalled();
    await holder.dispose();
  });

  it.each(["false-result", "rejection"] as const)(
    "does not let a stale readiness %s clear the newer binding",
    async (settlement) => {
      const old = makeProvider();
      const current = makeProvider();
      const oldReadiness = deferred<boolean>();
      old.provider.checkReadiness = vi.fn(() => oldReadiness.promise);
      const currentBinding = makeBinding();
      let providerIndex = 0;
      const holder = new RestrictedReviewHolder({
        afRuntime: availableAf,
        createProvider: async () => ({ ok: true, provider: providerIndex++ === 0 ? old.provider : current.provider }),
        createBinding: async () => currentBinding,
      });

      const oldRebind = holder.rebind();
      await vi.waitFor(() => expect(old.provider.checkReadiness).toHaveBeenCalledTimes(1));
      await holder.rebind();
      expect(holder.getSnapshot()).toEqual({
        runtime: { state: "available" },
        adapter: currentBinding.adapter,
        controller: currentBinding.controller,
      });

      if (settlement === "false-result") oldReadiness.resolve(false);
      else oldReadiness.reject(new Error("old readiness failed"));
      await oldRebind;

      expect(holder.getSnapshot()).toEqual({
        runtime: { state: "available" },
        adapter: currentBinding.adapter,
        controller: currentBinding.controller,
      });
      expect(old.provider.invalidate).toHaveBeenCalled();
      expect(current.provider.invalidate).not.toHaveBeenCalled();
      expect(currentBinding.adapter.dispose).not.toHaveBeenCalled();
      await holder.dispose();
    },
  );

  it("keeps readiness available when the injected diagnostic clock and sink throw", async () => {
    const { provider } = makeProvider();
    const binding = makeBinding();
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: true, provider }),
      createBinding: async () => binding,
      now: () => {
        throw new Error("diagnostic clock failed");
      },
      report: () => {
        throw new Error("diagnostic sink failed");
      },
    });

    await expect(holder.rebind()).resolves.toBeUndefined();
    expect(holder.getSnapshot()).toEqual({
      runtime: { state: "available" },
      adapter: binding.adapter,
      controller: binding.controller,
    });
    await holder.dispose();
  });

  it("keeps the fixed AF failure visible and does not bind a reviewer when AF is unavailable", async () => {
    const { provider } = makeProvider();
    const binding = makeBinding();
    const createProvider = vi.fn(async () => ({ ok: true as const, provider }));
    const createBinding = vi.fn(async () => binding);
    const report = vi.fn();
    const holder = new RestrictedReviewHolder({
      afRuntime: { state: "unavailable", reason: "missing-executable" },
      createProvider,
      createBinding,
      report,
    });

    await holder.rebind();

    expect(holder.getSnapshot()).toEqual({
      runtime: { state: "unavailable", reason: "missing-executable" },
    });
    expect(createBinding).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    expect(provider.invalidate).not.toHaveBeenCalled();
    expect(binding.adapter.dispose).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("adapter", "af-unavailable", undefined);
    await holder.dispose();
  });

  it("surfaces fixed model-resolution failures without binding or leaking diagnostics", async () => {
    const snapshots: ReasoningReviewRuntime[] = [];
    const report = vi.fn();
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: false, reason: "model-unavailable" }),
      createBinding: vi.fn(),
      onChange: (snapshot) => snapshots.push(snapshot.runtime),
      report,
    });

    await holder.rebind();

    expect(holder.getSnapshot().runtime).toEqual({ state: "unavailable", reason: "model-unavailable" });
    expect(snapshots).toEqual([
      { state: "checking", reason: "readiness-checking" },
      { state: "unavailable", reason: "model-unavailable" },
    ]);
    expect(report).toHaveBeenCalledWith("provider", "missing-model", expect.any(Number));
    expect(report).toHaveBeenCalledWith("adapter", "missing-model", expect.any(Number));
    expect(report.mock.calls.flat().join(" ")).not.toMatch(/model id|credential|\/workspace/u);
  });

  it("keeps readiness rejection unavailable and never constructs an adapter", async () => {
    const { provider } = makeProvider(false);
    const createBinding = vi.fn();
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: true, provider }),
      createBinding,
    });

    await holder.rebind();

    expect(holder.getSnapshot().runtime).toEqual({ state: "unavailable", reason: "restricted-agent-unavailable" });
    expect(provider.invalidate).toHaveBeenCalled();
    expect(createBinding).not.toHaveBeenCalled();
  });

  it("invalidates a late provider resolution after stop and prevents publication", async () => {
    const pending = deferred<RestrictedReviewProviderResolution>();
    const { provider } = makeProvider();
    const snapshots: ReasoningReviewRuntime[] = [];
    const createBinding = vi.fn();
    const createProvider = vi.fn(() => pending.promise);
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider,
      createBinding,
      onChange: (snapshot) => snapshots.push(snapshot.runtime),
    });
    const rebinding = holder.rebind();
    await vi.waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    await holder.invalidate("server-unavailable");
    pending.resolve({ ok: true, provider });
    await rebinding;

    expect(provider.invalidate).toHaveBeenCalled();
    expect(createBinding).not.toHaveBeenCalled();
    expect(holder.getSnapshot().runtime).toEqual({ state: "unavailable", reason: "server-unavailable" });
    expect(snapshots).not.toContainEqual({ state: "available" });
  });

  it("disposes a binding that finishes after its generation was replaced", async () => {
    const pendingBinding = deferred<ReturnType<typeof makeBinding>>();
    const { provider } = makeProvider();
    const binding = makeBinding();
    const createBinding = vi.fn(() => pendingBinding.promise);
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: true, provider }),
      createBinding,
    });
    const rebinding = holder.rebind();
    await vi.waitFor(() => expect(createBinding).toHaveBeenCalledTimes(1));
    await holder.invalidate("server-unavailable");
    pendingBinding.resolve(binding);
    await rebinding;

    expect(provider.invalidate).toHaveBeenCalled();
    expect(binding.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(holder.getSnapshot().runtime).toEqual({ state: "unavailable", reason: "server-unavailable" });
  });

  it("rechecks provider currency after asynchronous adapter construction", async () => {
    const { provider, setReady } = makeProvider();
    const binding = makeBinding();
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: true, provider }),
      createBinding: async () => {
        setReady(false);
        return binding;
      },
    });

    await holder.rebind();

    expect(holder.getSnapshot().runtime).toEqual({ state: "unavailable", reason: "restricted-agent-unavailable" });
    expect(binding.adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it("cancels work and disposes the replaced adapter on each rebind", async () => {
    const first = makeProvider();
    const second = makeProvider();
    const bindings = [makeBinding(), makeBinding()];
    const cancelWork = vi.fn();
    let index = 0;
    const holder = new RestrictedReviewHolder({
      afRuntime: availableAf,
      createProvider: async () => ({ ok: true, provider: index++ === 0 ? first.provider : second.provider }),
      createBinding: async () => bindings[index - 1]!,
      cancelWork,
    });

    await holder.rebind();
    await holder.rebind();

    expect(cancelWork).toHaveBeenCalledTimes(2);
    expect(first.provider.invalidate).toHaveBeenCalled();
    expect(bindings[0]?.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(holder.getSnapshot()).toMatchObject({ runtime: { state: "available" }, adapter: bindings[1]?.adapter });
    await holder.dispose();
  });
});
