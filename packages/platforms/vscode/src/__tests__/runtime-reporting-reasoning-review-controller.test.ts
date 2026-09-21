import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  fork: vi.fn(),
  spawn: vi.fn(),
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
import * as fsPromises from "node:fs/promises";
import type { ReasoningReviewRuntime } from "@opencode-chat/core";
import type { IReasoningReviewController } from "../vibefeld/reasoning-review-controller";
import {
  DORMANT_REASONING_REVIEW_RUNTIME,
  deriveReasoningReviewRuntime,
  PREFLIGHT_FAILED_REASONING_REVIEW_RUNTIME,
  RuntimeReportingReasoningReviewController,
} from "../vibefeld/runtime-reporting-reasoning-review-controller";
import { UnavailableReasoningReviewController } from "../vibefeld/unavailable-reasoning-review-controller";

type PreflightOutcome = Parameters<typeof deriveReasoningReviewRuntime>[0];

const readSource = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("deriveReasoningReviewRuntime", () => {
  const cases: ReadonlyArray<readonly [string, PreflightOutcome, ReasoningReviewRuntime]> = [
    ["a ready bridge", { state: "ready" }, { state: "available" }],
    [
      "an incompatible bridge",
      { state: "incompatible", reason: "runtime-mismatch" },
      { state: "incompatible", reason: "runtime-mismatch" },
    ],
    [
      "a missing executable",
      { state: "unavailable", reason: "missing-executable" },
      { state: "unavailable", reason: "missing-executable" },
    ],
    [
      "a policy-unavailable bridge",
      { state: "unavailable", reason: "policy-unavailable" },
      { state: "unavailable", reason: "policy-unavailable" },
    ],
    [
      "an unsupported platform",
      { state: "unavailable", reason: "unsupported-platform" },
      { state: "unavailable", reason: "unsupported-platform" },
    ],
    [
      "a failed preflight",
      { state: "unavailable", reason: "preflight-failed" },
      { state: "unavailable", reason: "preflight-failed" },
    ],
    [
      "an audit-failed bridge",
      { state: "audit-failed", reason: "audit-failure" },
      { state: "unavailable", reason: "audit-failure" },
    ],
    ["an absent reason", { state: "unavailable" }, { state: "unavailable", reason: "runtime-unavailable" }],
  ];

  it.each(cases)("maps %s to its bounded status", (_label, preflight, expected) => {
    expect(deriveReasoningReviewRuntime(preflight)).toEqual(expected);
  });

  it("never reports available for a non-ready bridge state", () => {
    for (const state of ["dormant", "preflighting", "unavailable", "incompatible", "audit-failed"] as const) {
      expect(deriveReasoningReviewRuntime({ state }).state).not.toBe("available");
    }
  });

  it("falls back to a bounded reason instead of echoing foreign detail", () => {
    const foreign = {
      state: "unavailable",
      reason: "/private/review-root/af-0.1.11 raw provider error",
    } as unknown as PreflightOutcome;

    const runtime = deriveReasoningReviewRuntime(foreign);

    expect(runtime).toEqual({ state: "unavailable", reason: "runtime-unavailable" });
  });

  it("drops compatibility metadata, facts, and host paths from the published status", () => {
    const preflight = {
      state: "ready",
      reason: undefined,
      structuralStatus: null,
      compatibility: { version: "0.1.11", commit: "611291b", format: "1.1", policy: "0.1.9" },
      facts: { initialized: true, workspace: "/private/review-root" },
    } as unknown as PreflightOutcome;

    const runtime = deriveReasoningReviewRuntime(preflight);

    expect(runtime).toEqual({ state: "available" });
    expect(Object.keys(runtime)).toEqual(["state"]);
    const published = JSON.stringify(runtime);
    expect(published).not.toContain("/private/review-root");
    expect(published).not.toContain("0.1.11");
    expect(published).not.toContain("611291b");
  });

  it("keeps the dormant and preflight-failure statuses bounded", () => {
    expect(DORMANT_REASONING_REVIEW_RUNTIME).toEqual({ state: "unavailable", reason: "runtime-unavailable" });
    expect(PREFLIGHT_FAILED_REASONING_REVIEW_RUNTIME).toEqual({
      state: "unavailable",
      reason: "preflight-failed",
    });
  });
});

describe("RuntimeReportingReasoningReviewController", () => {
  const createDelegate = (): IReasoningReviewController => ({
    getRuntime: vi.fn().mockRejectedValue(new Error("delegate must not be asked for runtime")),
    review: vi.fn().mockResolvedValue({
      reviewedMessageId: "message-1",
      status: "unavailable" as const,
      invocation: "manual" as const,
      conclusion: "delegated",
      assumptions: [],
      evidenceStatus: "not_assessed" as const,
      openChallenges: [],
    }),
    cancel: vi.fn(),
  });

  it("returns the fixed preflight-derived runtime without asking the delegate", async () => {
    const delegate = createDelegate();
    const runtime: ReasoningReviewRuntime = { state: "incompatible", reason: "runtime-mismatch" };
    const controller = new RuntimeReportingReasoningReviewController(delegate, runtime);

    await expect(controller.getRuntime()).resolves.toEqual(runtime);
    await expect(controller.getRuntime()).resolves.toEqual(runtime);
    expect(delegate.getRuntime).not.toHaveBeenCalled();
  });

  it("delegates manual review and cancellation unchanged", async () => {
    const delegate = createDelegate();
    const controller = new RuntimeReportingReasoningReviewController(delegate, DORMANT_REASONING_REVIEW_RUNTIME);
    const input = { sessionId: "session-1", messageId: "message-1", sourceText: "unreviewed answer" };

    await expect(controller.review(input)).resolves.toMatchObject({
      reviewedMessageId: "message-1",
      status: "unavailable",
      invocation: "manual",
      conclusion: "delegated",
    });
    expect(delegate.review).toHaveBeenCalledWith(input);
    controller.cancel("session-1", "message-1");
    expect(delegate.cancel).toHaveBeenCalledWith("session-1", "message-1");
  });

  it("keeps the manual fallback summary unchanged through the wrapper", async () => {
    const controller = new RuntimeReportingReasoningReviewController(
      new UnavailableReasoningReviewController(),
      PREFLIGHT_FAILED_REASONING_REVIEW_RUNTIME,
    );

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: "unreviewed answer" }),
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
    await expect(controller.getRuntime()).resolves.toEqual({
      state: "unavailable",
      reason: "preflight-failed",
    });
  });

  it("does not cross process, filesystem, or network side-effect boundaries", async () => {
    const controller = new RuntimeReportingReasoningReviewController(
      new UnavailableReasoningReviewController(),
      DORMANT_REASONING_REVIEW_RUNTIME,
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await controller.getRuntime();
    await controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: "visible text" });
    controller.cancel("session-1", "message-1");

    for (const boundary of [
      vi.mocked(childProcess.exec),
      vi.mocked(childProcess.execFile),
      vi.mocked(childProcess.fork),
      vi.mocked(childProcess.spawn),
      vi.mocked(fsPromises.readFile),
      vi.mocked(fsPromises.writeFile),
      vi.mocked(fsPromises.mkdir),
      vi.mocked(fsPromises.mkdtemp),
      vi.mocked(fsPromises.rename),
      vi.mocked(fsPromises.rm),
      vi.mocked(fsPromises.symlink),
      fetch,
    ]) {
      expect(boundary).not.toHaveBeenCalled();
    }
    vi.unstubAllGlobals();
  });

  it("stays host-private, preflight-free, and discovery-free in source", () => {
    const source = readSource("../vibefeld/runtime-reporting-reasoning-review-controller.ts");

    expect(source).not.toMatch(/\.preflight\(/u);
    expect(source).not.toMatch(/\b(?:discover|spawn|exec|execFile|fork|fetch)\s*\(/u);
    expect(source).not.toMatch(/from ["']vscode["']/u);
    expect(source).not.toMatch(/node:child_process|node:fs|node:net|node:http|node:https/u);
    expect(source).not.toMatch(/\.compatibility|\.facts|structuralStatus/u);
    expect(source).toContain('reason: "runtime-unavailable"');
    expect(source).toContain('reason: "preflight-failed"');
    expect(source).toContain('reason: "runtime-mismatch"');
  });
});
