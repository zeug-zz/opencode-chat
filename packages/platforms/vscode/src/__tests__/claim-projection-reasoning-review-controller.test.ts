import { describe, expect, it, vi } from "vitest";
import { ClaimProjectionReasoningReviewController } from "../vibefeld/claim-projection-reasoning-review-controller";
import type { ClaimProjectionSeam } from "../vibefeld/claim-projection-seam";
import { createFixtureOnlyClaimProjectionSeam } from "../vibefeld/fixture-claim-projection-seam";

const source = "CONCLUSION: claim-1\nCLAIM: claim-1|deductive|A bounded conclusion.";

describe("ClaimProjectionReasoningReviewController", () => {
  it("compiles a bounded source packet and maps an injected fixture outcome", async () => {
    const controller = new ClaimProjectionReasoningReviewController(
      createFixtureOnlyClaimProjectionSeam({
        fixtureId: "claim-fixture",
        fixtureVersion: "v1",
        claimCapability: true,
        outcome: { status: "structurally_checked" },
      }),
    );

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source }),
    ).resolves.toMatchObject({
      reviewedMessageId: "message-1",
      status: "structurally_checked",
      invocation: "manual",
    });
  });

  it("does not invoke the seam for an invalid graph", async () => {
    const project = vi.fn();
    const seam: ClaimProjectionSeam = {
      getCapability: vi.fn(() => ({ supported: true, operation: "claim_projection" })),
      project,
    };
    const controller = new ClaimProjectionReasoningReviewController(seam);

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: "not a claim packet" }),
    ).resolves.toMatchObject({ status: "blocked", evidenceStatus: "not_assessed" });
    expect(seam.getCapability).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
  });

  it("keeps the current unsupported seam unavailable and non-structural", async () => {
    const seam: ClaimProjectionSeam = {
      getCapability: vi.fn(() => ({ supported: false })),
      project: vi.fn(),
    };
    const controller = new ClaimProjectionReasoningReviewController(seam);

    await expect(
      controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source }),
    ).resolves.toMatchObject({
      status: "unavailable",
      conclusion: "Structural review was not performed because the projection capability was unavailable.",
    });
    expect(seam.project).not.toHaveBeenCalled();
  });

  it("aborts only the matching in-flight projection", async () => {
    let resolve!: (value: { status: "structurally_checked" }) => void;
    const project = vi.fn(
      (_graph: unknown, signal: AbortSignal) =>
        new Promise<{ status: "structurally_checked" }>((completion) => {
          resolve = completion;
          signal.addEventListener("abort", () => undefined, { once: true });
        }),
    );
    const seam: ClaimProjectionSeam = {
      getCapability: () => ({ supported: true, operation: "claim_projection" }),
      project: async (graph, signal) => {
        const result = project(graph, signal);
        const cancellation = new Promise<{ status: "unavailable"; reason: "cancelled" }>((completion) =>
          signal?.addEventListener("abort", () => completion({ status: "unavailable", reason: "cancelled" }), {
            once: true,
          }),
        );
        return Promise.race([result, cancellation]);
      },
    };
    const controller = new ClaimProjectionReasoningReviewController(seam);
    const review = controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });
    await vi.waitFor(() => expect(project).toHaveBeenCalledTimes(1));

    controller.cancel("session-1", "message-1");
    await expect(review).resolves.toMatchObject({ status: "unavailable" });
    expect(resolve).toBeDefined();
  });

  it("does not abort another session/message key", async () => {
    type ProjectionResult = { status: "structurally_checked" };
    let resolveFirst!: (value: ProjectionResult) => void;
    let resolveSecond!: (value: ProjectionResult) => void;
    const signals: AbortSignal[] = [];
    const seam: ClaimProjectionSeam = {
      getCapability: () => ({ supported: true, operation: "claim_projection" }),
      project: vi.fn((_graph, signal) => {
        signals.push(signal);
        return new Promise<ProjectionResult>((resolve) => {
          if (signals.length === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        });
      }),
    };
    const controller = new ClaimProjectionReasoningReviewController(seam);
    const first = controller.review({ sessionId: "session-1", messageId: "message-1", sourceText: source });
    const second = controller.review({ sessionId: "session-2", messageId: "message-2", sourceText: source });
    await vi.waitFor(() => expect(seam.project).toHaveBeenCalledTimes(2));

    controller.cancel("session-1", "message-1");
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    resolveFirst({ status: "structurally_checked" });
    resolveSecond({ status: "structurally_checked" });
    await expect(first).resolves.toMatchObject({ status: "structurally_checked" });
    await expect(second).resolves.toMatchObject({ status: "structurally_checked" });
  });
});
