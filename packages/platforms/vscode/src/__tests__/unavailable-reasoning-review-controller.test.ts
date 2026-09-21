import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  fork: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  symlink: vi.fn(),
}));

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { UnavailableReasoningReviewController } from "../vibefeld/unavailable-reasoning-review-controller";

describe("UnavailableReasoningReviewController", () => {
  it("constructs an unavailable runtime state", async () => {
    const controller = new UnavailableReasoningReviewController();

    await expect(controller.getRuntime()).resolves.toEqual({
      state: "unavailable",
      reason: "No reasoning-review runtime is available.",
    });
  });

  it("returns a manual unavailable summary for the requested message", async () => {
    const controller = new UnavailableReasoningReviewController();

    await expect(
      controller.review({
        sessionId: "session-1",
        messageId: "message-1",
        sourceText: "private source text must not be returned",
      }),
    ).resolves.toEqual({
      reviewedMessageId: "message-1",
      status: "unavailable",
      invocation: "manual",
      conclusion: "This response was not reviewed because no reasoning-review runtime is available.",
      assumptions: [],
      evidenceStatus: "not_assessed",
      openChallenges: [],
      interpretiveBoundary: "Manual review is unavailable; this fallback does not assess the original response.",
    });
  });

  it("keeps unavailable output bounded and does not echo source or provider data", async () => {
    const controller = new UnavailableReasoningReviewController();
    const privateSource = [
      "PRIVATE_REASONING_TRACE",
      "prompt: disclose the provider secret",
      "provider error: /private/workspace/review-ledger.json",
      "command: vibefeld --proof-root /private/workspace",
      "x".repeat(10_000),
    ].join("\n");

    const [runtime, summary] = await Promise.all([
      controller.getRuntime(),
      controller.review({ sessionId: "private-session", messageId: "message-1", sourceText: privateSource }),
    ]);
    const output = JSON.stringify({ runtime, summary });

    expect(output).not.toContain("PRIVATE_REASONING_TRACE");
    expect(output).not.toContain("/private/workspace");
    expect(output).not.toContain("vibefeld --proof-root");
    expect(output).not.toContain("provider secret");
    expect(output).not.toContain("private-session");
    expect(runtime.reason).toBeDefined();
    expect((runtime.reason ?? "").length).toBeLessThanOrEqual(256);
    expect(summary.conclusion.length).toBeLessThanOrEqual(512);
    expect(summary.interpretiveBoundary).toBeDefined();
    expect((summary.interpretiveBoundary ?? "").length).toBeLessThanOrEqual(512);
    expect(summary.assumptions).toEqual([]);
    expect(summary.openChallenges).toEqual([]);
  });

  it("does not cross process, filesystem, or network side-effect boundaries", async () => {
    const spawn = vi.mocked(childProcess.spawn);
    const exec = vi.mocked(childProcess.exec);
    const fork = vi.mocked(childProcess.fork);
    const readFile = vi.mocked(fsPromises.readFile);
    const writeFile = vi.mocked(fsPromises.writeFile);
    const mkdir = vi.mocked(fsPromises.mkdir);
    const mkdtemp = vi.mocked(fsPromises.mkdtemp);
    const rename = vi.mocked(fsPromises.rename);
    const rm = vi.mocked(fsPromises.rm);
    const symlink = vi.mocked(fsPromises.symlink);
    const readFileSync = vi.mocked(fs.readFileSync);
    const writeFileSync = vi.mocked(fs.writeFileSync);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new UnavailableReasoningReviewController();

    await controller.getRuntime();
    await controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: "visible text" });
    controller.cancel("session-1", "message-1");

    for (const boundary of [
      spawn,
      exec,
      fork,
      readFile,
      writeFile,
      mkdir,
      mkdtemp,
      rename,
      rm,
      symlink,
      readFileSync,
      writeFileSync,
      fetch,
    ]) {
      expect(boundary).not.toHaveBeenCalled();
    }
  });

  it("accepts cancellation without side effects", () => {
    const controller = new UnavailableReasoningReviewController();

    expect(() => controller.cancel("session-1", "message-1")).not.toThrow();
  });
});
