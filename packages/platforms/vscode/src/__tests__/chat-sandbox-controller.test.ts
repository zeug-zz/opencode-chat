import type { ChatSandboxSettings, ChatSandboxStatus } from "@opencode-chat/core";
import { describe, expect, it } from "vitest";
import { ChatSandboxController } from "../chat-sandbox-controller";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const firstSettings: ChatSandboxSettings = { mode: "on", allowNetwork: true };
const secondSettings: ChatSandboxSettings = { mode: "off", allowNetwork: false };

function status(settings: ChatSandboxSettings, applying: boolean, error?: string): ChatSandboxStatus {
  return {
    ...settings,
    enabled: settings.mode === "on",
    inherited: settings.mode === "inherit",
    applying,
    managed: false,
    supported: true,
    error,
  };
}

describe("ChatSandboxController", () => {
  it("runs concurrent updates in order without overlap and returns each result", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const starts: ChatSandboxSettings[] = [];
    let active = 0;
    let maximumActive = 0;
    const controller = new ChatSandboxController<string>(async (settings) => {
      starts.push(settings);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const result = settings === firstSettings ? await first.promise : await second.promise;
      active -= 1;
      return result;
    });

    const firstResult = controller.update(firstSettings);
    const secondResult = controller.update(secondSettings);
    await Promise.resolve();

    expect(starts).toEqual([firstSettings]);
    expect(maximumActive).toBe(1);

    first.resolve("first result");
    await expect(firstResult).resolves.toBe("first result");
    await Promise.resolve();
    expect(starts).toEqual([firstSettings, secondSettings]);

    second.resolve("second result");
    await expect(secondResult).resolves.toBe("second result");
    expect(maximumActive).toBe(1);
  });

  it("continues in order after a rejected transition", async () => {
    const first = deferred<never>();
    const second = deferred<string>();
    const starts: ChatSandboxSettings[] = [];
    const controller = new ChatSandboxController<string>((settings) => {
      starts.push(settings);
      return settings === firstSettings ? first.promise : second.promise;
    });

    const firstResult = controller.update(firstSettings);
    const secondResult = controller.update(secondSettings);
    await Promise.resolve();
    expect(starts).toEqual([firstSettings]);

    const failure = new Error("transition failed");
    first.reject(failure);
    await expect(firstResult).rejects.toBe(failure);
    await Promise.resolve();
    expect(starts).toEqual([firstSettings, secondSettings]);

    second.resolve("later result");
    await expect(secondResult).resolves.toBe("later result");
  });

  it("publishes applying before stopping and the final status after starting", async () => {
    const stopped = deferred<void>();
    const started = deferred<ChatSandboxStatus>();
    const events: string[] = [];
    const published: ChatSandboxStatus[] = [];
    const controller = new ChatSandboxController<ChatSandboxStatus>({
      stop: async () => {
        events.push("stop");
        await stopped.promise;
        events.push("stopped");
      },
      start: async (settings) => {
        events.push(`start:${settings.mode}`);
        return started.promise;
      },
      publishStatus: (next) => {
        events.push(`status:${next.applying}`);
        published.push(next);
      },
    });

    const update = controller.update(firstSettings);
    await Promise.resolve();
    expect(controller.isApplying()).toBe(true);
    expect(() => controller.assertRequestsAllowed()).toThrow("applying");
    expect(events).toEqual(["status:true", "stop"]);

    stopped.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["status:true", "stop", "stopped", "start:on"]);
    started.resolve(status(firstSettings, false));
    await expect(update).resolves.toEqual(status(firstSettings, false));
    expect(events).toEqual(["status:true", "stop", "stopped", "start:on", "status:false"]);
    expect(published).toEqual([status(firstSettings, true), status(firstSettings, false)]);
    expect(controller.isApplying()).toBe(false);
    expect(() => controller.assertRequestsAllowed()).not.toThrow();
  });

  it("starts exactly the requested target and does not use a fallback after failure", async () => {
    const startedTargets: ChatSandboxSettings[] = [];
    const fallback = { called: false };
    const published: ChatSandboxStatus[] = [];
    const failure = new Error("sandbox startup failed");
    const controller = new ChatSandboxController<never>({
      stop: () => undefined,
      start: (settings) => {
        startedTargets.push(settings);
        return Promise.reject(failure);
      },
      publishStatus: (next) => published.push(next),
    });

    await expect(controller.update(secondSettings)).rejects.toBe(failure);
    expect(startedTargets).toEqual([secondSettings]);
    expect(fallback.called).toBe(false);
    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({ applying: true, ...secondSettings });
    expect(published[1]).toMatchObject({ applying: false, enabled: false, error: failure.message });
    expect(controller.isApplying()).toBe(false);
  });

  it("publishes an unavailable status and reports stop, start, and refresh failures", async () => {
    const failure = new Error("sandbox transition failed");
    const errors: unknown[] = [];
    const published: ChatSandboxStatus[] = [];
    const controller = new ChatSandboxController<void>({
      stop: () => Promise.reject(failure),
      start: () => undefined,
      publishStatus: (next) => published.push(next),
      onError: (error) => errors.push(error),
    });

    await expect(controller.update(firstSettings)).rejects.toBe(failure);
    expect(errors).toEqual([failure]);
    expect(published.at(-1)).toMatchObject({ applying: false, enabled: false, error: failure.message });
    expect(controller.isApplying()).toBe(false);
  });

  it("awaits reconnect refresh before publishing the final status", async () => {
    const events: string[] = [];
    const controller = new ChatSandboxController<void>({
      stop: () => undefined,
      start: () => {
        events.push("start");
      },
      refresh: async (next) => {
        events.push(`refresh:${next.applying}`);
        await Promise.resolve();
        events.push("refreshed");
      },
      publishStatus: (next) => events.push(`status:${next.applying}`),
    });

    await controller.update(firstSettings);

    expect(events).toEqual(["status:true", "start", "refresh:false", "refreshed", "status:false"]);
  });

  it("serializes lifecycle transitions and keeps admission blocked across queued updates", async () => {
    const firstStop = deferred<void>();
    const firstStart = deferred<void>();
    const secondStop = deferred<void>();
    const secondStart = deferred<void>();
    const events: string[] = [];
    const controller = new ChatSandboxController<void>({
      stop: async () => {
        events.push("stop");
        await (events.length === 1 ? firstStop.promise : secondStop.promise);
        events.push("stopped");
      },
      start: async (settings) => {
        events.push(`start:${settings.mode}`);
        await (settings === firstSettings ? firstStart.promise : secondStart.promise);
      },
      publishStatus: () => undefined,
    });

    const first = controller.update(firstSettings);
    const second = controller.update(secondSettings);
    await Promise.resolve();
    expect(events).toEqual(["stop"]);
    expect(() => controller.assertRequestsAllowed()).toThrow();

    firstStop.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["stop", "stopped", "start:on"]);
    firstStart.resolve();
    await first;
    await Promise.resolve();
    expect(events).toEqual(["stop", "stopped", "start:on", "stop"]);

    secondStop.resolve();
    secondStart.resolve();
    await second;
    expect(events).toEqual(["stop", "stopped", "start:on", "stop", "stopped", "start:off"]);
    expect(controller.isApplying()).toBe(false);
  });

  it("stops the old companion before restarting with the new network policy and refreshes state", async () => {
    const events: string[] = [];
    const refreshed: ChatSandboxStatus[] = [];
    const controller = new ChatSandboxController<ChatSandboxStatus>({
      stop: () => {
        events.push("stop");
      },
      start: async (settings) => {
        events.push(`start:${settings.allowNetwork}`);
        return status(settings, false);
      },
      publishStatus: (next) => events.push(`status:${next.applying}`),
      onReconnected: (next) => {
        refreshed.push(next);
        events.push("refresh");
      },
    });

    await controller.update(firstSettings);
    await controller.update(secondSettings);

    expect(events).toEqual([
      "status:true",
      "stop",
      "start:true",
      "refresh",
      "status:false",
      "status:true",
      "stop",
      "start:false",
      "refresh",
      "status:false",
    ]);
    expect(refreshed).toEqual([status(firstSettings, false), status(secondSettings, false)]);
  });
});
